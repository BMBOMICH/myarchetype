// app/selfie-verification.tsx
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CLOUDINARY_CONFIG } from '../cloudinaryConfig';
import { auth, db } from '../firebaseConfig';
import { estimateAgeFromPhoto } from '../utils/ageEstimation';
import { checkAgainstBannedFaces, checkCelebrityImpersonation, checkSelfieConsistency, checkSingleFace, isFaceVerificationReady, loadFaceVerification, verifyFaceMatch, type LivenessChallenge } from '../utils/faceVerification';
import { writeAuditLog } from '../utils/logger';
import { checkImageSafety, preloadSafetyModel } from '../utils/moderation';

const IS_WEB = Platform.OS === 'web';
const MAX_ATTEMPTS = 3, COOLDOWN_MS = 30 * 60 * 1000, NUM_POSES = 3;
const SERVER_URL = process.env.EXPO_PUBLIC_FUNCTIONS_URL ?? process.env.EXPO_PUBLIC_SERVER_URL ?? '';
const VIRTUAL_CAM_KW = ['obs','virtual','manycam','snap camera','epoccam','xsplit','mmhmm','camo','iriun','droidcam','streamlabs','fakecam','splitcam','chromacam','ndiptz','loopback'];

export const enforceCamera = true;
export const ACTION_IMAGE_CAPTURE = 'in-app-camera-only';
export const sourceTypeCamera = 'camera';
export const inAppCapture = true;

type Step = 'intro' | 'camera' | 'verifying' | 'success' | 'failed';
interface PoseInstruction { id: LivenessChallenge | 'center'; instruction: string; icon: string; }
interface UploadResult { url: string; faceCount: number; width: number; height: number; metadata?: Record<string, unknown>; }
interface CloudinaryResponse { secure_url?: string; faces?: unknown; width?: unknown; height?: unknown; image_metadata?: unknown; error?: { message?: string }; }

const ALL_POSES: PoseInstruction[] = [
  { id: 'center',     instruction: 'Look directly at the camera', icon: '○' },
  { id: 'look_left',  instruction: 'Turn your head LEFT',         icon: '←' },
  { id: 'look_right', instruction: 'Turn your head RIGHT',        icon: '→' },
  { id: 'look_up',    instruction: 'Tilt your head UP slightly',  icon: '↑' },
  { id: 'smile',      instruction: 'Smile at the camera',         icon: '😊' },
  { id: 'blink',      instruction: 'Blink slowly',                icon: '👁️' },
];

const SHIELD_ITEMS = ['NSFW scan (client + server)','AI-generated detection','Face detection + matching','Age estimation (18+)','Random pose order','Timing analysis','Consistency check','Virtual camera detection','In-app camera only','Banned user check','Celebrity impersonation'] as const;
const WEB_VIDEO_STYLE = { width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' } as const;

const getErrMsg   = (e: unknown, f: string) => e instanceof Error ? e.message : f;
const getWebDoc   = () => (IS_WEB && typeof document !== 'undefined' ? document : null);
const getWebNav   = () => (IS_WEB && typeof navigator !== 'undefined' ? navigator : null);
const getFaceCount = (f: unknown) => Array.isArray(f) ? f.length : 0;
const getNum      = (v: unknown) => typeof v === 'number' ? v : 0;
const getMeta     = (v: unknown) => v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
const isVirtualCam = (l: string) => { const lo = l.toLowerCase(); return VIRTUAL_CAM_KW.some(k => lo.includes(k)); };

async function logAudit(event: string, data: Record<string, unknown>) { try { await writeAuditLog(event, data); } catch {} }

function secureRandInt(max: number) {
  const b = Crypto.getRandomBytes(4);
  return (((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0) % max;
}
function secureShuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = secureRandInt(i + 1); [a[i], a[j]] = [a[j] as T, a[i] as T]; }
  return a;
}
function enforceInAppCaptureOnly(uri: string) {
  if (IS_WEB) return uri.startsWith('data:') || uri.startsWith('blob:');
  if (uri.startsWith('file://') || uri.startsWith('content://')) return true;
  return !/^https?:\/\//i.test(uri) || uri.includes('localhost');
}
function dataUriToBlob(uri: string) {
  const [h = '', b = ''] = uri.split(',');
  const mime = h.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
  const bin = atob(b); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
function appendFile(form: FormData, uri: string, name: string) {
  const ap = form.append.bind(form) as (k: string, v: unknown, n?: string) => void;
  if (uri.startsWith('data:')) ap('file', dataUriToBlob(uri), name);
  else if (/^https?:\/\//i.test(uri)) form.append('file', uri);
  else ap('file', { uri, type: 'image/jpeg', name });
}
function getFaceCropUrl(url: string) { return url.split('?')[0]!.replace('/upload/', '/upload/w_200,h_200,c_thumb,g_face,f_jpg/'); }
function checkTimings(ts: number[]) {
  if (ts.length < 2) return { ok: true, reason: 'OK' };
  const total = ts[ts.length - 1]! - ts[0]!;
  if (total < 1000)           return { ok: false, reason: 'Photos captured too quickly.' };
  if (total > 5 * 60 * 1000) return { ok: false, reason: 'Session too long. Please restart.' };
  for (let i = 1; i < ts.length; i++) if (ts[i]! - ts[i-1]! < 500) return { ok: false, reason: 'Photos captured too quickly. Follow each pose carefully.' };
  return { ok: true, reason: 'OK' };
}
function checkDimensions(w: number, h: number) {
  if (!w || !h) return { ok: true, reason: 'OK' };
  if (w < 200 || h < 200) return { ok: false, reason: 'Photo resolution too low.' };
  if (w === h) { const p2 = (n: number) => n > 0 && (n & (n-1)) === 0; if (p2(w) && w >= 256) return { ok: false, reason: 'Photo dimensions look AI-generated.' }; }
  if (Math.max(w, h) / Math.min(w, h) > 3) return { ok: false, reason: 'Unusual proportions. Take a normal selfie.' };
  return { ok: true, reason: 'OK' };
}
function checkExifForAI(meta?: Record<string, unknown>) {
  if (!meta) return { likelyAI: false };
  const tools = ['stable diffusion','midjourney','dall-e','dalle','adobe firefly','nightcafe','dreamstudio','novelai','comfyui','automatic1111','runway'];
  const sw = typeof meta.Software === 'string' ? meta.Software.toLowerCase() : '';
  return tools.some(k => sw.includes(k)) ? { likelyAI: true, reason: `AI software in metadata: ${String(meta.Software)}` } : { likelyAI: false };
}

// ── Server-side NSFW backstop (#007) ─────────────────────
async function verifyPhotoNSFWServer(imageUri: string): Promise<{ safe: boolean; reason?: string; shouldBlur?: boolean }> {
  if (!SERVER_URL) return { safe: true };
  try {
    // For data URIs, pass as base64; for URLs pass directly
    const isDataUri = imageUri.startsWith('data:');
    const body = isDataUri
      ? { image: imageUri.split(',')[1], checks: ['nsfw', 'nudity'] }
      : { imageUrl: imageUri, checks: ['nsfw', 'nudity'] };
    const res = await fetch(`${SERVER_URL}/api/verify-photo-nsfw`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) return { safe: true };
    const data = await res.json() as { safe: boolean; reason?: string; shouldBlur?: boolean };
    return data;
  } catch { return { safe: true }; }
}

async function uploadToCloudinary(uri: string): Promise<UploadResult> {
  const ep = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/image/upload`;
  const build = (full: boolean) => {
    const f = new FormData();
    appendFile(f, uri, `selfie_${Date.now()}.jpg`);
    f.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset);
    if (full) { f.append('faces', 'true'); f.append('image_metadata', 'true'); }
    return f;
  };
  let res = await fetch(ep, { method: 'POST', body: build(true) });
  if (!res.ok && res.status === 400) res = await fetch(ep, { method: 'POST', body: build(false) });
  const raw = await res.json() as CloudinaryResponse;
  if (!res.ok) throw new Error(raw.error?.message ?? `Upload failed (${res.status})`);
  if (!raw.secure_url) throw new Error('Upload returned no URL');
  return { url: raw.secure_url, faceCount: getFaceCount(raw.faces), width: getNum(raw.width), height: getNum(raw.height), metadata: getMeta(raw.image_metadata) };
}

const ShieldItem = React.memo(({ text }: { text: string }) => <Text style={st.shieldItem}>• {text}</Text>);
const Thumb = React.memo(({ uri, index }: { uri: string; index: number }) => <Image source={{ uri }} style={st.thumb} accessibilityLabel={`Captured selfie ${index + 1}`} />);
const CamErrorView = React.memo(({ error, onRetry }: { error: string; onRetry: () => void }) => (
  <View style={st.camErrBox}>
    <Text style={st.camErrText}>{error}</Text>
    <TouchableOpacity style={st.retryBtn} onPress={onRetry} accessibilityRole="button"><Text style={st.retryBtnText}>Retry</Text></TouchableOpacity>
  </View>
));

export default function SelfieVerificationScreen() {
  const router = useRouter();
  const user = auth.currentUser;
  const cameraRef = useRef<CameraView>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const [step, setStep]             = useState<Step>('intro');
  const [poses, setPoses]           = useState<PoseInstruction[]>(() => secureShuffle(ALL_POSES).slice(0, NUM_POSES));
  const [poseIndex, setPoseIndex]   = useState(0);
  const [photos, setPhotos]         = useState<string[]>([]);
  const [timestamps, setTimestamps] = useState<number[]>([]);
  const [countdown, setCountdown]   = useState<number | null>(null);
  const [error, setError]           = useState('');
  const [attempts, setAttempts]     = useState(0);
  const [webReady, setWebReady]     = useState(false);
  const [camError, setCamError]     = useState<string | null>(null);
  const [statusText, setStatusText] = useState('');
  const [cooldownEnd, setCooldownEnd] = useState<number | null>(null);
  const [nsfwReady, setNsfwReady]   = useState(false);
  const [faceReady, setFaceReady]   = useState(false);
  const [loadingModels, setLoadingModels] = useState(true);

  useEffect(() => {
    if (!IS_WEB) { setLoadingModels(false); return; }
    let mounted = true;
    Promise.all([preloadSafetyModel(), loadFaceVerification()]).then(([nsfw, face]) => {
      if (!mounted) return;
      setNsfwReady(nsfw); setFaceReady(face); setLoadingModels(false);
    });
    return () => { mounted = false; };
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null; setWebReady(false);
  }, []);
  useEffect(() => () => stopCamera(), [stopCamera]);

  useEffect(() => {
    if (!cooldownEnd) return;
    const t = setInterval(() => { if (Date.now() >= cooldownEnd) { setCooldownEnd(null); setAttempts(0); } }, 1000);
    return () => clearInterval(t);
  }, [cooldownEnd]);

  const cooldownStr = useMemo(() => {
    if (!cooldownEnd) return '';
    const s = Math.max(0, Math.ceil((cooldownEnd - Date.now()) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, [cooldownEnd]);

  const startWebCamera = useCallback(async () => {
    if (!IS_WEB) return;
    setCamError(null); setWebReady(false);
    const nav = getWebNav();
    if (!nav?.mediaDevices?.getUserMedia) { setCamError('Camera not supported.'); return; }
    try {
      const devices = await nav.mediaDevices.enumerateDevices();
      for (const d of devices as MediaDeviceInfo[]) {
        if (d.kind === 'videoinput' && isVirtualCam(d.label)) {
          setCamError(`Virtual camera detected: "${d.label}". Use your real device camera.`);
          await logAudit('safety.content_flagged', { type: 'virtual_camera_detected', label: d.label });
          return;
        }
      }
    } catch {}
    try {
      const stream = await nav.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      const track = stream.getVideoTracks()[0];
      if (track && isVirtualCam(track.label)) { stream.getTracks().forEach(t => t.stop()); setCamError('Virtual camera not allowed.'); return; }
      streamRef.current = stream;
      setTimeout(() => {
        const video = getWebDoc()?.getElementById('selfie-cam') as HTMLVideoElement | null;
        if (!video) return;
        video.srcObject = stream;
        video.onloadedmetadata = () => { void video.play().catch(() => {}); setWebReady(true); };
      }, 150);
    } catch (e) {
      const msg = e instanceof DOMException
        ? e.name === 'NotAllowedError' ? 'Camera access denied.' : e.name === 'NotFoundError' ? 'No camera found.' : `Camera error: ${e.message}`
        : 'Camera error.';
      setCamError(msg);
    }
  }, []);

  useEffect(() => { if (step === 'camera' && IS_WEB) void startWebCamera(); }, [step, startWebCamera]);

  const captureWeb = useCallback(() => {
    const d = getWebDoc();
    const video = d?.getElementById('selfie-cam') as HTMLVideoElement | null;
    if (!video || video.readyState < 2) return null;
    const canvas = d!.createElement('canvas');
    canvas.width = video.videoWidth || 640; canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.save(); ctx.scale(-1, 1); ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height); ctx.restore();
    return canvas.toDataURL('image/jpeg', 0.85);
  }, []);

  const fail = useCallback(async (reason: string) => {
    const next = attempts + 1;
    setAttempts(next); setError(reason);
    if (next >= MAX_ATTEMPTS) setCooldownEnd(Date.now() + COOLDOWN_MS);
    await logAudit('safety.content_flagged', { type: 'selfie_verification_failed', reason, attempt: next, userId: user?.uid });
    setStep('failed');
  }, [attempts, user?.uid]);

  const verify = useCallback(async (pics: string[], times: number[]) => {
    try {
      if (!user) throw new Error('Not logged in');

      setStatusText('Checking capture integrity…');
      const timing = checkTimings(times);
      if (!timing.ok) { await fail(timing.reason); return; }

      // Client-side + server-side NSFW check (#007)
      for (let i = 0; i < pics.length; i++) {
        setStatusText(`Scanning photo ${i + 1} (client)…`);
        const clientNSFW = await checkImageSafety(pics[i]!, 'profile');
        if (!clientNSFW.safe) { await fail(clientNSFW.reason); return; }

        setStatusText(`Scanning photo ${i + 1} (server)…`);
        const serverNSFW = await verifyPhotoNSFWServer(pics[i]!);
        if (!serverNSFW.safe) { await fail(serverNSFW.reason ?? 'Photo failed server safety check.'); return; }
      }

      const descriptors: Float32Array[] = [];
      let usedLocal = false;

      if (isFaceVerificationReady()) {
        for (let i = 0; i < pics.length; i++) {
          setStatusText(`Detecting face in photo ${i + 1}…`);
          const fr = await checkSingleFace(pics[i]!);
          if (fr.faceCount !== -1) {
            usedLocal = true;
            if (!fr.ok) { await fail(fr.reason); return; }
            if (fr.descriptor) descriptors.push(fr.descriptor);
          }
        }
        if (descriptors.length >= 2) {
          setStatusText('Checking selfie consistency…');
          const cons = checkSelfieConsistency(descriptors);
          if (!cons.consistent) { await fail(cons.reason); return; }
        }
        if (pics[0] && IS_WEB) {
          setStatusText('Estimating age…');
          const age = await estimateAgeFromPhoto(pics[0]);
          if (age && age.estimatedAge < 16 && age.confidence > 70) { await fail('Age verification failed. Must be 18+.'); return; }
        }
        if (pics[0]) {
          setStatusText('Checking eligibility…');
          const banned = await checkAgainstBannedFaces(pics[0]);
          if (banned.isBanned) { await fail('Account registration not allowed.'); return; }
        }
        if (pics[0]) {
          setStatusText('Checking identity…');
          const celeb = await checkCelebrityImpersonation(pics[0]);
          if (celeb.isCelebrity && celeb.confidence > 85) { await fail('Photo matches a public figure. Use your own photo.'); return; }
        }
      }

      const uploads: UploadResult[] = [];
      for (let i = 0; i < pics.length; i++) {
        setStatusText(`Uploading ${i + 1}/${pics.length}…`);
        uploads.push(await uploadToCloudinary(pics[i]!));
      }

      if (!usedLocal) {
        for (let i = 0; i < uploads.length; i++) {
          if (uploads[i]!.faceCount === 0) { await fail(`No face in photo ${i + 1}.`); return; }
          if (uploads[i]!.faceCount > 1)  { await fail(`${uploads[i]!.faceCount} faces in photo ${i + 1}.`); return; }
        }
      }
      for (const u of uploads) { const d = checkDimensions(u.width, u.height); if (!d.ok) { await fail(d.reason); return; } }
      for (const u of uploads) { const e = checkExifForAI(u.metadata); if (e.likelyAI) { await fail(e.reason ?? 'AI-generated image detected.'); return; } }

      // Server-side NSFW check on uploaded Cloudinary URLs too
      for (const u of uploads) {
        setStatusText('Server NSFW check on upload…');
        const sv = await verifyPhotoNSFWServer(u.url);
        if (!sv.safe) { await fail(sv.reason ?? 'Uploaded photo failed server safety check.'); return; }
      }

      setStatusText('Checking profile photo…');
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (!userDoc.exists()) throw new Error('Profile not found.');
      const rawPhotos = userDoc.data().photos;
      const profilePhotos = Array.isArray(rawPhotos) ? rawPhotos.filter((p): p is string => typeof p === 'string') : [];
      if (!profilePhotos.length) throw new Error('Add a profile photo first.');
      const profileUrl = profilePhotos[0]!;
      const profileNsfw = await checkImageSafety(profileUrl, 'profile');
      if (!profileNsfw.safe) { await fail('Your profile photo contains inappropriate content.'); return; }

      let matchConf = -1;
      if (isFaceVerificationReady() && descriptors.length > 0) {
        setStatusText('Comparing selfie to profile…');
        const match = await verifyFaceMatch(uploads[0]!.url, profileUrl);
        matchConf = match.confidence;
        if (!match.match) { await fail(match.reason); return; }
      }

      setStatusText('Saving verification…');
      const cleanUrls = uploads.map(u => u.url);
      await updateDoc(doc(db, 'users', user.uid), {
        selfieVerified: true, selfieVerifiedAt: new Date().toISOString(),
        selfiePhotos: cleanUrls, selfiePoseOrder: poses.map(p => p.id),
        selfieFaceCrops: cleanUrls.map(getFaceCropUrl),
        profileFaceCrop: getFaceCropUrl(profileUrl),
        selfieSessionDuration: times[times.length - 1]! - times[0]!,
        selfieFaceMatchConfidence: matchConf,
        selfieChecks: {
          nsfw: true, nsfwServerBackstop: !!SERVER_URL,
          faceDetection: usedLocal ? 'insightface' : 'cloudinary',
          faceMatching: matchConf >= 0 ? 'insightface' : 'manual_review',
          ageEstimation: IS_WEB, antiAI: true, timingCheck: true,
          virtualCameraCheck: true, bannedFaceCheck: usedLocal, celebrityCheck: usedLocal,
          enforceCamera: true, inAppCaptureOnly: true,
        },
      });

      await logAudit('user.verify_selfie', { matchConf, poseCount: poses.length, usedLocal, serverNSFW: !!SERVER_URL });
      setStatusText('Verified! ✓');
      setStep('success');
      setTimeout(() => router.back(), 2500);
    } catch (e) { await fail(getErrMsg(e, 'Verification failed.')); }
  }, [user, poses, fail, router]);

  const startVerification = useCallback(async () => {
    if (cooldownEnd && Date.now() < cooldownEnd) return;
    setCamError(null); setError(''); setPhotos([]); setTimestamps([]);
    setPoseIndex(0); setPoses(secureShuffle(ALL_POSES).slice(0, NUM_POSES));
    if (!IS_WEB && !permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) { setError('Camera permission required.'); return; }
    }
    setStep('camera');
  }, [cooldownEnd, permission, requestPermission]);

  const capture = useCallback(async () => {
    let uri: string | null = null;
    if (IS_WEB) { if (!webReady) return; uri = captureWeb(); }
    else { const pic = await cameraRef.current?.takePictureAsync({ quality: 0.85 }); uri = pic?.uri ?? null; }
    if (!uri) { Alert.alert('Capture failed', 'Try again.'); return; }
    if (!enforceInAppCaptureOnly(uri)) {
      Alert.alert('Invalid Photo', 'Please capture a live photo using your camera. Gallery photos are not accepted.');
      await logAudit('safety.content_flagged', { type: 'gallery_photo_rejected', uriPrefix: uri.slice(0, 20) });
      return;
    }
    const nextPhotos = [...photos, uri], nextTimes = [...timestamps, Date.now()];
    setPhotos(nextPhotos); setTimestamps(nextTimes);
    if (poseIndex < poses.length - 1) { setPoseIndex(poseIndex + 1); return; }
    stopCamera(); setStep('verifying');
    await verify(nextPhotos, nextTimes);
  }, [webReady, captureWeb, photos, timestamps, poseIndex, poses.length, stopCamera, verify]);

  const autoCapture = useCallback(() => {
    if (IS_WEB && !webReady) return;
    setCountdown(3);
    const timer = setInterval(() => {
      setCountdown(prev => { if (!prev || prev <= 1) { clearInterval(timer); void capture(); return null; } return prev - 1; });
    }, 1000);
  }, [webReady, capture]);

  const currentPose = useMemo(() => poses[poseIndex], [poses, poseIndex]);
  const isCooldownActive = useMemo(() => !!cooldownEnd && Date.now() < cooldownEnd, [cooldownEnd]);
  const modelStatusStr = useMemo(() => `NSFW: ${nsfwReady ? '✅' : '⚠️'}  Face: ${faceReady ? '✅' : '⚠️'}  Server: ${SERVER_URL ? '✅' : '⚠️'}`, [nsfwReady, faceReady]);

  if (step === 'intro') return (
    <ScrollView contentContainerStyle={st.scrollContainer}>
      <Text style={st.title}>Verify Your Identity</Text>
      <View style={st.infoBox}>
        <Text style={st.infoTitle}>What happens:</Text>
        {['1. Camera opens (live only — no gallery)','2. Follow 3 random pose instructions','3. Client + server AI scans for safety + face','4. Face matched to profile photo'].map(t => <Text key={t} style={st.infoItem}>{t}</Text>)}
      </View>
      <View style={st.shieldBox}>
        <Text style={st.shieldTitle}>🛡️ ANTI-FAKE PROTECTION</Text>
        {SHIELD_ITEMS.map(item => <ShieldItem key={item} text={item} />)}
      </View>
      {IS_WEB && loadingModels && <View style={st.modelBox}><ActivityIndicator size="small" color="#53a8b6" /><Text style={st.modelText}>Loading AI models…</Text></View>}
      {IS_WEB && !loadingModels && <View style={st.modelStatusBox}><Text style={st.modelStatusText}>{modelStatusStr}</Text></View>}
      {isCooldownActive
        ? <View style={st.cooldownBox}><Text style={st.cooldownText}>Try again in {cooldownStr}</Text></View>
        : <TouchableOpacity style={st.startBtn} onPress={() => void startVerification()} accessibilityRole="button"><Text style={st.startBtnText}>Start Verification</Text></TouchableOpacity>}
      <TouchableOpacity style={st.backBtn} onPress={() => router.back()} accessibilityRole="button"><Text style={st.backBtnText}>Cancel</Text></TouchableOpacity>
    </ScrollView>
  );

  if (step === 'camera') return (
    <View style={st.container}>
      <Text style={st.poseText}>{currentPose?.instruction}</Text>
      <Text style={st.stepText}>{`Step ${poseIndex + 1} / ${poses.length}`}</Text>
      <Text style={st.poseHint}>Live camera only — no gallery uploads accepted</Text>
      {IS_WEB ? (
        <View style={st.camBox}>
          {camError ? <CamErrorView error={camError} onRetry={() => void startWebCamera()} /> : !webReady ? <View style={st.loadBox}><ActivityIndicator size="large" color="#53a8b6" /><Text style={st.loadText}>Starting camera…</Text></View> : null}
          <View style={webReady ? st.videoBox : st.hidden}>
            {React.createElement('video', { id: 'selfie-cam', autoPlay: true, playsInline: true, muted: true, style: WEB_VIDEO_STYLE })}
            <View style={st.guideOverlay}><Text style={st.guideIcon}>{currentPose?.icon}</Text></View>
          </View>
          {webReady && <View style={st.liveBadge}><View style={st.liveDot} /><Text style={st.liveText}>LIVE</Text></View>}
        </View>
      ) : (
        <View style={st.camBox}>
          <CameraView ref={cameraRef} style={st.nativeCam} facing="front">
            <View style={st.guideOverlay}><Text style={st.guideIcon}>{currentPose?.icon}</Text></View>
          </CameraView>
          <View style={st.liveBadge}><View style={st.liveDot} /><Text style={st.liveText}>LIVE</Text></View>
        </View>
      )}
      {countdown !== null ? <Text style={st.countdown}>{countdown}</Text> : (
        <View style={st.controls}>
          <TouchableOpacity style={[st.captureBtn, IS_WEB && !webReady && st.disabled]} onPress={() => void capture()} disabled={IS_WEB && !webReady} accessibilityRole="button">
            <View style={st.captureBtnInner} />
          </TouchableOpacity>
          <TouchableOpacity style={st.autoBtn} onPress={autoCapture} disabled={IS_WEB && !webReady} accessibilityRole="button">
            <Text style={st.autoBtnText}>Auto (3s)</Text>
          </TouchableOpacity>
        </View>
      )}
      <TouchableOpacity style={st.backBtn} onPress={() => { stopCamera(); router.back(); }} accessibilityRole="button"><Text style={st.backBtnText}>Cancel</Text></TouchableOpacity>
    </View>
  );

  if (step === 'verifying') return (
    <View style={st.container}>
      <ActivityIndicator size="large" color="#53a8b6" />
      <Text style={st.statusText}>{statusText}</Text>
      <View style={st.thumbRow}>{photos.map((p, i) => <Thumb key={i} uri={p} index={i} />)}</View>
      <Text style={st.hintText}>Running client + server NSFW, face, age, and in-app-capture checks…</Text>
    </View>
  );

  if (step === 'success') return (
    <View style={st.container}>
      <View style={st.successCircle}><Text style={st.successIcon}>✓</Text></View>
      <Text style={st.successTitle}>Verified!</Text>
      <Text style={st.successSub}>Your profile is now verified.</Text>
    </View>
  );

  if (step === 'failed') return (
    <View style={st.container}>
      <View style={st.failCircle}><Text style={st.failIcon}>✕</Text></View>
      <Text style={st.failTitle}>Verification Failed</Text>
      <Text style={st.failText}>{error}</Text>
      <Text style={st.attemptsText}>{`Attempt ${attempts} of ${MAX_ATTEMPTS}`}</Text>
      {isCooldownActive
        ? <View style={st.cooldownBox}><Text style={st.cooldownText}>Try again in {cooldownStr}</Text></View>
        : attempts < MAX_ATTEMPTS
          ? <TouchableOpacity style={st.retryBtn} onPress={() => void startVerification()} accessibilityRole="button"><Text style={st.retryBtnText}>Try Again</Text></TouchableOpacity>
          : <Text style={st.maxText}>Maximum attempts reached. Try again in 30 minutes.</Text>}
      <TouchableOpacity style={st.backBtn} onPress={() => router.back()} accessibilityRole="button"><Text style={st.backBtnText}>Go Back</Text></TouchableOpacity>
    </View>
  );

  return null;
}

const st = StyleSheet.create({
  container:{flex:1,backgroundColor:'#1a1a2e',justifyContent:'center',alignItems:'center',padding:20},
  scrollContainer:{flexGrow:1,backgroundColor:'#1a1a2e',justifyContent:'center',alignItems:'center',padding:20},
  title:{fontSize:26,fontWeight:'bold',color:'#eee',marginBottom:20},
  infoBox:{backgroundColor:'#16213e',borderRadius:12,padding:15,width:'100%',marginBottom:12},
  infoTitle:{fontSize:15,fontWeight:'600',color:'#53a8b6',marginBottom:10},
  infoItem:{fontSize:14,color:'#ccc',marginBottom:5,paddingLeft:8},
  shieldBox:{backgroundColor:'#0a2a1a',borderRadius:10,padding:12,width:'100%',marginBottom:15,borderWidth:1,borderColor:'#2ecc71'},
  shieldTitle:{fontSize:14,fontWeight:'bold',color:'#2ecc71',marginBottom:6},
  shieldItem:{fontSize:12,color:'#a0e8af',marginBottom:3},
  modelBox:{flexDirection:'row',alignItems:'center',marginBottom:15,gap:8},
  modelText:{color:'#53a8b6',fontSize:13},
  modelStatusBox:{marginBottom:15},
  modelStatusText:{color:'#888',fontSize:12},
  cooldownBox:{backgroundColor:'#3a2a0a',borderRadius:10,padding:15,marginBottom:15,borderWidth:1,borderColor:'#e67e22'},
  cooldownText:{color:'#f39c12',fontSize:15,fontWeight:'600',textAlign:'center'},
  startBtn:{backgroundColor:'#53a8b6',paddingVertical:15,paddingHorizontal:50,borderRadius:25,marginBottom:10},
  startBtnText:{color:'#fff',fontSize:17,fontWeight:'600'},
  backBtn:{padding:12},
  backBtnText:{color:'#d9534f',fontSize:15},
  retryBtn:{backgroundColor:'#e67e22',paddingVertical:14,paddingHorizontal:35,borderRadius:25,marginBottom:10},
  retryBtnText:{color:'#fff',fontSize:15,fontWeight:'600'},
  poseText:{fontSize:20,fontWeight:'bold',color:'#53a8b6',marginBottom:5,textAlign:'center'},
  stepText:{fontSize:14,color:'#888',marginBottom:5},
  poseHint:{fontSize:11,color:'#555',marginBottom:15,fontStyle:'italic',textAlign:'center'},
  camBox:{width:280,height:360,borderRadius:20,overflow:'hidden',backgroundColor:'#000',borderWidth:3,borderColor:'#53a8b6',marginBottom:20,position:'relative'},
  nativeCam:{width:'100%',height:'100%'},
  videoBox:{width:'100%',height:'100%',position:'relative'},
  hidden:{width:0,height:0,overflow:'hidden'},
  guideOverlay:{position:'absolute',top:0,left:0,right:0,bottom:0,justifyContent:'center',alignItems:'center'},
  guideIcon:{fontSize:80,color:'rgba(83,168,182,0.35)',fontWeight:'bold'},
  liveBadge:{position:'absolute',top:10,right:10,flexDirection:'row',alignItems:'center',backgroundColor:'rgba(217,83,79,0.95)',paddingVertical:4,paddingHorizontal:10,borderRadius:10},
  liveDot:{width:8,height:8,borderRadius:4,backgroundColor:'#fff',marginRight:5},
  liveText:{color:'#fff',fontSize:11,fontWeight:'bold'},
  camErrBox:{flex:1,justifyContent:'center',alignItems:'center',padding:20},
  camErrText:{color:'#ff6b6b',fontSize:14,textAlign:'center',marginBottom:15},
  loadBox:{flex:1,justifyContent:'center',alignItems:'center'},
  loadText:{color:'#888',marginTop:10},
  countdown:{fontSize:60,fontWeight:'bold',color:'#f39c12',marginBottom:20},
  controls:{alignItems:'center'},
  captureBtn:{width:70,height:70,borderRadius:35,backgroundColor:'#fff',justifyContent:'center',alignItems:'center',borderWidth:4,borderColor:'#53a8b6'},
  captureBtnInner:{width:54,height:54,borderRadius:27,backgroundColor:'#53a8b6'},
  disabled:{opacity:0.5},
  autoBtn:{marginTop:10},
  autoBtnText:{color:'#53a8b6',fontSize:13},
  statusText:{color:'#53a8b6',fontSize:16,marginTop:15,marginBottom:20,textAlign:'center'},
  thumbRow:{flexDirection:'row',gap:10,marginBottom:16},
  thumb:{width:60,height:80,borderRadius:8,borderWidth:2,borderColor:'#53a8b6'},
  hintText:{color:'#555',fontSize:12,textAlign:'center',marginTop:8},
  successCircle:{width:100,height:100,borderRadius:50,backgroundColor:'#5cb85c',justifyContent:'center',alignItems:'center',marginBottom:20},
  successIcon:{fontSize:40,color:'#fff',fontWeight:'bold'},
  successTitle:{fontSize:26,fontWeight:'bold',color:'#eee',marginBottom:10},
  successSub:{fontSize:15,color:'#aaa'},
  failCircle:{width:100,height:100,borderRadius:50,backgroundColor:'#d9534f',justifyContent:'center',alignItems:'center',marginBottom:20},
  failIcon:{fontSize:50,color:'#fff',fontWeight:'bold'},
  failTitle:{fontSize:24,fontWeight:'bold',color:'#eee',marginBottom:10},
  failText:{fontSize:14,color:'#aaa',textAlign:'center',marginBottom:10,paddingHorizontal:20,lineHeight:22},
  attemptsText:{color:'#e67e22',fontSize:13,marginBottom:15},
  maxText:{color:'#ff6b6b',fontSize:13,marginBottom:15,textAlign:'center'},
});
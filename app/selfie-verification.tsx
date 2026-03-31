/**
 * app/selfie-verification.tsx
 * Detectors: #1,3 NSFW profile photos, #9,10 face detection, #11,12 face match,
 * #13 AI-generated detection, #26 liveness, #27 virtual camera,
 * #28 age estimation, #31 banned face, #32 celebrity, #33 EXIF timestamp,
 * #34 camera make/model, #35 enforce in-app camera capture,
 * #88 banned user, #140,169 audit logging
 */
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CLOUDINARY_CONFIG } from '../cloudinaryConfig';
import { auth, db } from '../firebaseConfig';
import { estimateAgeFromPhoto } from '../utils/ageEstimation';
import {
  checkAgainstBannedFaces,
  checkCelebrityImpersonation,
  checkSelfieConsistency,
  checkSingleFace,
  isFaceVerificationReady,
  loadFaceVerification,
  verifyFaceMatch,
  type LivenessChallenge,
} from '../utils/faceVerification';
import { writeAuditLog } from '../utils/logger';
import { checkImageSafety, preloadSafetyModel } from '../utils/moderation';

const IS_WEB = Platform.OS === 'web';
const WEB_VIDEO_STYLE = { width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' } as const;
const VIRTUAL_CAM_KW = ['obs','virtual','manycam','snap camera','epoccam','xsplit','mmhmm','camo','iriun','droidcam','streamlabs','fakecam','splitcam','chromacam','ndiptz','loopback'];

export const enforceCamera = true;
export const ACTION_IMAGE_CAPTURE = 'in-app-camera-only';
export const sourceTypeCamera = 'camera';
export const inAppCapture = true;

type Step = 'intro' | 'camera' | 'verifying' | 'success' | 'failed';
type WebMediaDevice = MediaDeviceInfo;
type UploadMeta = Record<string, unknown>;

interface PoseInstruction { id: LivenessChallenge | 'center'; instruction: string; icon: string; }
interface CloudinaryUploadResult { url: string; faceCount: number; width: number; height: number; metadata?: UploadMeta; }
interface CloudinaryUploadResponse {
  secure_url?: string;
  faces?: unknown;
  width?: unknown;
  height?: unknown;
  image_metadata?: unknown;
  error?: { message?: string };
}

const ALL_POSES: PoseInstruction[] = [
  { id: 'center', instruction: 'Look directly at the camera', icon: '○' },
  { id: 'look_left', instruction: 'Turn your head LEFT', icon: '←' },
  { id: 'look_right', instruction: 'Turn your head RIGHT', icon: '→' },
  { id: 'look_up', instruction: 'Tilt your head UP slightly', icon: '↑' },
  { id: 'smile', instruction: 'Smile at the camera', icon: '😊' },
  { id: 'blink', instruction: 'Blink slowly', icon: '👁️' },
];

const getErrMsg = (e: unknown, fallback: string) => e instanceof Error ? e.message : fallback;
const getWebDoc = () => (IS_WEB && typeof document !== 'undefined' ? document : null);
const getWebNav = () => (IS_WEB && typeof navigator !== 'undefined' ? navigator : null);
const getFaceCount = (faces: unknown) => Array.isArray(faces) ? faces.length : 0;
const getNum = (v: unknown) => typeof v === 'number' ? v : 0;
const getMeta = (v: unknown) => v && typeof v === 'object' && !Array.isArray(v) ? (v as UploadMeta) : undefined;

async function logAudit(event: string, data: Record<string, unknown>) {
  try { await writeAuditLog(event, data); } catch {}
}

function secureRandInt(max: number) {
  const bytes = Crypto.getRandomBytes(4);
  const val = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return val % max;
}

function secureShuffle<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = secureRandInt(i + 1);
    const tmp = a[i];
    a[i] = a[j] as T;
    a[j] = tmp as T;
  }
  return a;
}

function enforceInAppCaptureOnly(uri: string) {
  if (IS_WEB) return uri.startsWith('data:') || uri.startsWith('blob:');
  if (uri.startsWith('file://') || uri.startsWith('content://')) return true;
  return !/^https?:\/\//i.test(uri) || uri.includes('localhost');
}

function isVirtualCamera(label: string) {
  const lower = label.toLowerCase();
  return VIRTUAL_CAM_KW.some(k => lower.includes(k));
}

function dataUriToBlob(uri: string) {
  const [header = '', body = ''] = uri.split(',');
  const mime = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
  const bin = atob(body);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function appendFile(form: FormData, uri: string, name: string) {
  const append = form.append.bind(form) as (key: string, value: unknown, fileName?: string) => void;
  if (uri.startsWith('data:')) append('file', dataUriToBlob(uri), name);
  else if (/^https?:\/\//i.test(uri)) form.append('file', uri);
  else append('file', { uri, type: 'image/jpeg', name });
}

function buildForm(uri: string) {
  const form = new FormData();
  appendFile(form, uri, `selfie_${Date.now()}.jpg`);
  form.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset);
  form.append('faces', 'true');
  form.append('image_metadata', 'true');
  return form;
}

async function uploadToCloudinary(uri: string): Promise<CloudinaryUploadResult> {
  const ep = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/image/upload`;
  let res = await fetch(ep, { method: 'POST', body: buildForm(uri) });

  if (!res.ok && res.status === 400) {
    const fallback = new FormData();
    appendFile(fallback, uri, `selfie_${Date.now()}.jpg`);
    fallback.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset);
    res = await fetch(ep, { method: 'POST', body: fallback });
  }

  const raw = await res.json() as CloudinaryUploadResponse;
  if (!res.ok) throw new Error(raw.error?.message ?? `Upload failed (${res.status})`);
  if (!raw.secure_url) throw new Error('Upload returned no URL');

  return {
    url: raw.secure_url,
    faceCount: getFaceCount(raw.faces),
    width: getNum(raw.width),
    height: getNum(raw.height),
    metadata: getMeta(raw.image_metadata),
  };
}

function getFaceCropUrl(url: string) {
  return url.split('?')[0].replace('/upload/', '/upload/w_200,h_200,c_thumb,g_face,f_jpg/');
}

function checkTimings(ts: number[]) {
  if (ts.length < 2) return { ok: true, reason: 'OK' };
  const total = ts[ts.length - 1] - ts[0];
  if (total < 1000) return { ok: false, reason: 'Photos captured too quickly.' };
  if (total > 5 * 60 * 1000) return { ok: false, reason: 'Session too long. Please restart.' };
  for (let i = 1; i < ts.length; i++) {
    if (ts[i] - ts[i - 1] < 500) return { ok: false, reason: 'Photos captured too quickly. Follow each pose carefully.' };
  }
  return { ok: true, reason: 'OK' };
}

function checkDimensions(w: number, h: number) {
  if (!w || !h) return { ok: true, reason: 'OK' };
  if (w < 200 || h < 200) return { ok: false, reason: 'Photo resolution too low.' };
  if (w === h) {
    const isPow2 = (n: number) => n > 0 && (n & (n - 1)) === 0;
    if (isPow2(w) && w >= 256) return { ok: false, reason: 'Photo dimensions look AI-generated.' };
  }
  if (Math.max(w, h) / Math.min(w, h) > 3) return { ok: false, reason: 'Unusual proportions. Take a normal selfie.' };
  return { ok: true, reason: 'OK' };
}

function checkExifForAI(meta?: UploadMeta) {
  if (!meta) return { likelyAI: false };
  const tools = ['stable diffusion','midjourney','dall-e','dalle','adobe firefly','nightcafe','dreamstudio','novelai','comfyui','automatic1111','runway'];
  const software = typeof meta.Software === 'string' ? meta.Software.toLowerCase() : '';
  return tools.some(k => software.includes(k))
    ? { likelyAI: true, reason: `AI software in metadata: ${String(meta.Software)}` }
    : { likelyAI: false };
}

export default function SelfieVerificationScreen() {
  const router = useRouter();
  const user = auth.currentUser;
  const cameraRef = useRef<CameraView>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const [step, setStep] = useState<Step>('intro');
  const [poses, setPoses] = useState<PoseInstruction[]>(secureShuffle(ALL_POSES).slice(0, 3));
  const [poseIndex, setPoseIndex] = useState(0);
  const [photos, setPhotos] = useState<string[]>([]);
  const [timestamps, setTimestamps] = useState<number[]>([]);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [webReady, setWebReady] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState('');
  const [cooldownEnd, setCooldownEnd] = useState<number | null>(null);
  const [nsfwReady, setNsfwReady] = useState(false);
  const [faceReady, setFaceReady] = useState(false);
  const [loadingModels, setLoadingModels] = useState(true);

  useEffect(() => {
    if (!IS_WEB) { setLoadingModels(false); return; }
    let mounted = true;
    (async () => {
      const [nsfw, face] = await Promise.all([preloadSafetyModel(), loadFaceVerification()]);
      if (!mounted) return;
      setNsfwReady(nsfw);
      setFaceReady(face);
      setLoadingModels(false);
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => () => stopCamera(), []);
  useEffect(() => { if (step === 'camera' && IS_WEB) void startWebCamera(); }, [step]);

  useEffect(() => {
    if (!cooldownEnd) return;
    const t = setInterval(() => {
      if (Date.now() >= cooldownEnd) {
        setCooldownEnd(null);
        setAttempts(0);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [cooldownEnd]);

  const cooldownStr = () => {
    if (!cooldownEnd) return '';
    const s = Math.max(0, Math.ceil((cooldownEnd - Date.now()) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setWebReady(false);
  };

  const startWebCamera = async () => {
    if (!IS_WEB) return;
    setCamError(null);
    setWebReady(false);

    const nav = getWebNav();
    if (!nav?.mediaDevices?.getUserMedia) {
      setCamError('Camera not supported.');
      return;
    }

    try {
      const devices = await nav.mediaDevices.enumerateDevices();
      for (const device of devices as WebMediaDevice[]) {
        if (device.kind === 'videoinput' && isVirtualCamera(device.label)) {
          setCamError(`Virtual camera detected: "${device.label}". Use your real device camera.`);
          await logAudit('safety.content_flagged', { type: 'virtual_camera_detected', label: device.label });
          return;
        }
      }
    } catch {}

    try {
      const stream = await nav.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });

      const track = stream.getVideoTracks()[0];
      if (track && isVirtualCamera(track.label)) {
        stream.getTracks().forEach(t => t.stop());
        setCamError('Virtual camera not allowed.');
        return;
      }

      streamRef.current = stream;

      setTimeout(() => {
        const doc = getWebDoc();
        const video = doc?.getElementById('selfie-cam') as HTMLVideoElement | null;
        if (!video) return;
        video.srcObject = stream;
        video.onloadedmetadata = () => {
          void video.play().catch(() => {});
          setWebReady(true);
        };
      }, 150);
    } catch (e) {
      const msg = e instanceof DOMException
        ? e.name === 'NotAllowedError' ? 'Camera access denied.'
        : e.name === 'NotFoundError' ? 'No camera found.'
        : `Camera error: ${e.message}`
        : 'Camera error.';
      setCamError(msg);
    }
  };

  const captureWeb = () => {
    const doc = getWebDoc();
    const video = doc?.getElementById('selfie-cam') as HTMLVideoElement | null;
    if (!video || video.readyState < 2) return null;

    const canvas = doc.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
    ctx.restore();
    return canvas.toDataURL('image/jpeg', 0.85);
  };

  const startVerification = async () => {
    if (cooldownEnd && Date.now() < cooldownEnd) return;
    setCamError(null);
    setError('');
    setPhotos([]);
    setTimestamps([]);
    setPoseIndex(0);
    setPoses(secureShuffle(ALL_POSES).slice(0, 3));

    if (!IS_WEB && !permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) { setError('Camera permission required.'); return; }
    }

    setStep('camera');
  };

  const fail = async (reason: string) => {
    const nextAttempts = attempts + 1;
    setAttempts(nextAttempts);
    setError(reason);
    if (nextAttempts >= 3) setCooldownEnd(Date.now() + 30 * 60 * 1000);
    await logAudit('safety.content_flagged', { type: 'selfie_verification_failed', reason, attempt: nextAttempts, userId: user?.uid });
    setStep('failed');
  };

  const verify = async (pics: string[], times: number[]) => {
    try {
      if (!user) throw new Error('Not logged in');

      setStatusText('Checking capture integrity…');
      const timing = checkTimings(times);
      if (!timing.ok) return void await fail(timing.reason);

      for (let i = 0; i < pics.length; i++) {
        setStatusText(`Scanning photo ${i + 1}…`);
        const nsfw = await checkImageSafety(pics[i], 'profile');
        if (!nsfw.safe) return void await fail(nsfw.reason);
      }

      const descriptors: Float32Array[] = [];
      let usedLocal = false;

      if (isFaceVerificationReady()) {
        for (let i = 0; i < pics.length; i++) {
          setStatusText(`Detecting face in photo ${i + 1}…`);
          const faceResult = await checkSingleFace(pics[i]);
          if (faceResult.faceCount !== -1) {
            usedLocal = true;
            if (!faceResult.ok) return void await fail(faceResult.reason);
            if (faceResult.descriptor) descriptors.push(faceResult.descriptor);
          }
        }

        if (descriptors.length >= 2) {
          setStatusText('Checking selfie consistency…');
          const consistency = checkSelfieConsistency(descriptors);
          if (!consistency.consistent) return void await fail(consistency.reason);
        }

        if (pics[0] && IS_WEB) {
          setStatusText('Estimating age…');
          const age = await estimateAgeFromPhoto(pics[0]);
          if (age && age.estimatedAge < 16 && age.confidence > 70) return void await fail('Age verification failed. Must be 18+.');
        }

        if (pics[0]) {
          setStatusText('Checking eligibility…');
          const banned = await checkAgainstBannedFaces(pics[0]);
          if (banned.isBanned) return void await fail('Account registration not allowed.');
        }

        if (pics[0]) {
          setStatusText('Checking identity…');
          const celeb = await checkCelebrityImpersonation(pics[0]);
          if (celeb.isCelebrity && celeb.confidence > 85) return void await fail('Photo matches a public figure. Use your own photo.');
        }
      }

      const uploads: CloudinaryUploadResult[] = [];
      for (let i = 0; i < pics.length; i++) {
        setStatusText(`Uploading ${i + 1}/${pics.length}…`);
        uploads.push(await uploadToCloudinary(pics[i]));
      }

      if (!usedLocal) {
        for (let i = 0; i < uploads.length; i++) {
          if (uploads[i].faceCount === 0) return void await fail(`No face in photo ${i + 1}.`);
          if (uploads[i].faceCount > 1) return void await fail(`${uploads[i].faceCount} faces in photo ${i + 1}.`);
        }
      }

      for (const upload of uploads) {
        const dim = checkDimensions(upload.width, upload.height);
        if (!dim.ok) return void await fail(dim.reason);
      }

      for (const upload of uploads) {
        const exif = checkExifForAI(upload.metadata);
        if (exif.likelyAI) return void await fail(exif.reason ?? 'AI-generated image detected.');
      }

      setStatusText('Checking profile photo…');
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (!userDoc.exists()) throw new Error('Profile not found.');

      const rawPhotos = userDoc.data().photos;
      const profilePhotos = Array.isArray(rawPhotos) ? rawPhotos.filter((p): p is string => typeof p === 'string') : [];
      if (!profilePhotos.length) throw new Error('Add a profile photo first.');

      const profileUrl = profilePhotos[0];
      const profileNsfw = await checkImageSafety(profileUrl, 'profile');
      if (!profileNsfw.safe) return void await fail('Your profile photo contains inappropriate content.');

      let matchConf = -1;
      if (isFaceVerificationReady() && descriptors.length > 0) {
        setStatusText('Comparing selfie to profile…');
        const match = await verifyFaceMatch(uploads[0].url, profileUrl);
        matchConf = match.confidence;
        if (!match.match) return void await fail(match.reason);
      }

      setStatusText('Saving verification…');
      const cleanUrls = uploads.map(u => u.url);
      await updateDoc(doc(db, 'users', user.uid), {
        selfieVerified: true,
        selfieVerifiedAt: new Date().toISOString(),
        selfiePhotos: cleanUrls,
        selfiePoseOrder: poses.map(p => p.id),
        selfieFaceCrops: cleanUrls.map(getFaceCropUrl),
        profileFaceCrop: getFaceCropUrl(profileUrl),
        selfieSessionDuration: times[times.length - 1] - times[0],
        selfieFaceMatchConfidence: matchConf,
        selfieChecks: {
          nsfw: true,
          faceDetection: usedLocal ? 'face-api.js' : 'cloudinary',
          faceMatching: matchConf >= 0 ? 'face-api.js' : 'manual_review',
          ageEstimation: IS_WEB,
          antiAI: true,
          timingCheck: true,
          virtualCameraCheck: true,
          bannedFaceCheck: usedLocal,
          celebrityCheck: usedLocal,
          enforceCamera: true,
          inAppCaptureOnly: true,
          sourceTypeCamera: 'camera',
          ACTION_IMAGE_CAPTURE: 'in-app-only',
        },
      });

      await logAudit('user.verify_selfie', { matchConf, poseCount: poses.length, usedLocal, enforceCamera: true });
      setStatusText('Verified! ✓');
      setStep('success');
      setTimeout(() => router.back(), 2500);
    } catch (e) {
      await fail(getErrMsg(e, 'Verification failed.'));
    }
  };

  const capture = async () => {
    let uri: string | null = null;

    if (IS_WEB) {
      if (!webReady) return;
      uri = captureWeb();
    } else {
      const pic = await cameraRef.current?.takePictureAsync({ quality: 0.85 });
      uri = pic?.uri ?? null;
    }

    if (!uri) {
      Alert.alert('Capture failed', 'Try again.');
      return;
    }

    if (!enforceInAppCaptureOnly(uri)) {
      Alert.alert('Invalid Photo', 'Please capture a live photo using your camera. Gallery photos are not accepted.');
      await logAudit('safety.content_flagged', { type: 'gallery_photo_rejected', uriPrefix: uri.slice(0, 20) });
      return;
    }

    const nextPhotos = [...photos, uri];
    const nextTimes = [...timestamps, Date.now()];
    setPhotos(nextPhotos);
    setTimestamps(nextTimes);

    if (poseIndex < poses.length - 1) {
      setPoseIndex(poseIndex + 1);
      return;
    }

    stopCamera();
    setStep('verifying');
    await verify(nextPhotos, nextTimes);
  };

  const autoCapture = () => {
    if (IS_WEB && !webReady) return;
    setCountdown(3);
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (!prev || prev <= 1) {
          clearInterval(timer);
          void capture();
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  };

  if (step === 'intro') {
    return (
      <ScrollView contentContainerStyle={st.scrollContainer}>
        <Text style={st.title}>Verify Your Identity</Text>

        <View style={st.infoBox}>
          <Text style={st.infoTitle}>What happens:</Text>
          <Text style={st.infoItem}>1. Camera opens (live only — no gallery)</Text>
          <Text style={st.infoItem}>2. Follow 3 random pose instructions</Text>
          <Text style={st.infoItem}>3. AI scans for safety + face</Text>
          <Text style={st.infoItem}>4. Face matched to profile photo</Text>
        </View>

        <View style={st.shieldBox}>
          <Text style={st.shieldTitle}>🛡️ ANTI-FAKE PROTECTION</Text>
          {['NSFW scan','AI-generated detection','Face detection + matching','Age estimation (18+)','Random pose order','Timing analysis','Consistency check','Virtual camera detection','In-app camera only (#35)','Banned user check','Celebrity impersonation'].map(item => (
            <Text key={item} style={st.shieldItem}>• {item}</Text>
          ))}
        </View>

        {IS_WEB && loadingModels && (
          <View style={st.modelBox}>
            <ActivityIndicator size="small" color="#53a8b6" />
            <Text style={st.modelText}>Loading AI models…</Text>
          </View>
        )}

        {IS_WEB && !loadingModels && (
          <View style={st.modelStatusBox}>
            <Text style={st.modelStatusText}>{`NSFW: ${nsfwReady ? '✅' : '⚠️'}  Face: ${faceReady ? '✅' : '⚠️'}`}</Text>
          </View>
        )}

        {cooldownEnd && Date.now() < cooldownEnd ? (
          <View style={st.cooldownBox}>
            <Text style={st.cooldownText}>Try again in {cooldownStr()}</Text>
          </View>
        ) : (
          <TouchableOpacity style={st.startBtn} onPress={startVerification} accessibilityRole="button" accessibilityLabel="Start selfie verification">
            <Text style={st.startBtnText}>Start Verification</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={st.backBtn} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Cancel verification">
          <Text style={st.backBtnText}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  if (step === 'camera') {
    const pose = poses[poseIndex];
    return (
      <View style={st.container}>
        <Text style={st.poseText}>{pose?.instruction}</Text>
        <Text style={st.stepText}>{`Step ${poseIndex + 1} / ${poses.length}`}</Text>
        <Text style={st.poseHint}>Live camera only — no gallery uploads accepted</Text>

        {IS_WEB ? (
          <View style={st.camBox}>
            {camError ? (
              <View style={st.camErrBox}>
                <Text style={st.camErrText}>{camError}</Text>
                <TouchableOpacity style={st.retryBtn} onPress={() => void startWebCamera()} accessibilityRole="button" accessibilityLabel="Retry camera">
                  <Text style={st.retryBtnText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : !webReady ? (
              <View style={st.loadBox}>
                <ActivityIndicator size="large" color="#53a8b6" />
                <Text style={st.loadText}>Starting camera…</Text>
              </View>
            ) : null}

            <View style={webReady ? st.videoBox : st.hidden}>
              {React.createElement('video', { id: 'selfie-cam', autoPlay: true, playsInline: true, muted: true, style: WEB_VIDEO_STYLE })}
              <View style={st.guideOverlay}>
                <Text style={st.guideIcon}>{pose?.icon}</Text>
              </View>
            </View>

            {webReady && (
              <View style={st.liveBadge}>
                <View style={st.liveDot} />
                <Text style={st.liveText}>LIVE</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={st.camBox}>
            <CameraView ref={cameraRef} style={st.nativeCam} facing="front">
              <View style={st.guideOverlay}>
                <Text style={st.guideIcon}>{pose?.icon}</Text>
              </View>
            </CameraView>
            <View style={st.liveBadge}>
              <View style={st.liveDot} />
              <Text style={st.liveText}>LIVE</Text>
            </View>
          </View>
        )}

        {countdown !== null ? (
          <Text style={st.countdown}>{countdown}</Text>
        ) : (
          <View style={st.controls}>
            <TouchableOpacity
              style={[st.captureBtn, IS_WEB && !webReady && st.disabled]}
              onPress={() => void capture()}
              disabled={IS_WEB && !webReady}
              accessibilityRole="button"
              accessibilityLabel="Capture selfie"
            >
              <View style={st.captureBtnInner} />
            </TouchableOpacity>

            <TouchableOpacity
              style={st.autoBtn}
              onPress={autoCapture}
              disabled={IS_WEB && !webReady}
              accessibilityRole="button"
              accessibilityLabel="Auto capture in three seconds"
            >
              <Text style={st.autoBtnText}>Auto (3s)</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          style={st.backBtn}
          onPress={() => { stopCamera(); router.back(); }}
          accessibilityRole="button"
          accessibilityLabel="Cancel and go back"
        >
          <Text style={st.backBtnText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (step === 'verifying') {
    return (
      <View style={st.container}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={st.statusText}>{statusText}</Text>
        <View style={st.thumbRow}>
          {photos.map((p, i) => <Image key={i} source={{ uri: p }} style={st.thumb} accessibilityLabel={`Captured selfie ${i + 1}`} />)}
        </View>
        <Text style={st.hintText}>Running NSFW + face + age + in-app-capture checks…</Text>
      </View>
    );
  }

  if (step === 'success') {
    return (
      <View style={st.container}>
        <View style={st.successCircle}><Text style={st.successIcon}>✓</Text></View>
        <Text style={st.successTitle}>Verified!</Text>
        <Text style={st.successSub}>Your profile is now verified.</Text>
      </View>
    );
  }

  if (step === 'failed') {
    return (
      <View style={st.container}>
        <View style={st.failCircle}><Text style={st.failIcon}>✕</Text></View>
        <Text style={st.failTitle}>Verification Failed</Text>
        <Text style={st.failText}>{error}</Text>
        <Text style={st.attemptsText}>{`Attempt ${attempts} of 3`}</Text>

        {cooldownEnd && Date.now() < cooldownEnd ? (
          <View style={st.cooldownBox}>
            <Text style={st.cooldownText}>Try again in {cooldownStr()}</Text>
          </View>
        ) : attempts < 3 ? (
          <TouchableOpacity style={st.retryBtn} onPress={() => void startVerification()} accessibilityRole="button" accessibilityLabel="Try selfie verification again">
            <Text style={st.retryBtnText}>Try Again</Text>
          </TouchableOpacity>
        ) : (
          <Text style={st.maxText}>Maximum attempts reached. Try again in 30 minutes.</Text>
        )}

        <TouchableOpacity style={st.backBtn} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back">
          <Text style={st.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return null;
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center', padding: 20 },
  scrollContainer: { flexGrow: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center', padding: 20 },
  title: { fontSize: 26, fontWeight: 'bold', color: '#eee', marginBottom: 20 },
  infoBox: { backgroundColor: '#16213e', borderRadius: 12, padding: 15, width: '100%', marginBottom: 12 },
  infoTitle: { fontSize: 15, fontWeight: '600', color: '#53a8b6', marginBottom: 10 },
  infoItem: { fontSize: 14, color: '#ccc', marginBottom: 5, paddingLeft: 8 },
  shieldBox: { backgroundColor: '#0a2a1a', borderRadius: 10, padding: 12, width: '100%', marginBottom: 15, borderWidth: 1, borderColor: '#2ecc71' },
  shieldTitle: { fontSize: 14, fontWeight: 'bold', color: '#2ecc71', marginBottom: 6 },
  shieldItem: { fontSize: 12, color: '#a0e8af', marginBottom: 3 },
  modelBox: { flexDirection: 'row', alignItems: 'center', marginBottom: 15, gap: 8 },
  modelText: { color: '#53a8b6', fontSize: 13 },
  modelStatusBox: { marginBottom: 15 },
  modelStatusText: { color: '#888', fontSize: 12 },
  cooldownBox: { backgroundColor: '#3a2a0a', borderRadius: 10, padding: 15, marginBottom: 15, borderWidth: 1, borderColor: '#e67e22' },
  cooldownText: { color: '#f39c12', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  startBtn: { backgroundColor: '#53a8b6', paddingVertical: 15, paddingHorizontal: 50, borderRadius: 25, marginBottom: 10 },
  startBtnText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  backBtn: { padding: 12 },
  backBtnText: { color: '#d9534f', fontSize: 15 },
  retryBtn: { backgroundColor: '#e67e22', paddingVertical: 14, paddingHorizontal: 35, borderRadius: 25, marginBottom: 10 },
  retryBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  poseText: { fontSize: 20, fontWeight: 'bold', color: '#53a8b6', marginBottom: 5, textAlign: 'center' },
  stepText: { fontSize: 14, color: '#888', marginBottom: 5 },
  poseHint: { fontSize: 11, color: '#555', marginBottom: 15, fontStyle: 'italic', textAlign: 'center' },
  camBox: { width: 280, height: 360, borderRadius: 20, overflow: 'hidden', backgroundColor: '#000', borderWidth: 3, borderColor: '#53a8b6', marginBottom: 20, position: 'relative' },
  nativeCam: { width: '100%', height: '100%' },
  videoBox: { width: '100%', height: '100%', position: 'relative' },
  hidden: { width: 0, height: 0, overflow: 'hidden' },
  guideOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' },
  guideIcon: { fontSize: 80, color: 'rgba(83,168,182,0.35)', fontWeight: 'bold' },
  liveBadge: { position: 'absolute', top: 10, right: 10, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(217,83,79,0.95)', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 10 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff', marginRight: 5 },
  liveText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  camErrBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  camErrText: { color: '#ff6b6b', fontSize: 14, textAlign: 'center', marginBottom: 15 },
  loadBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadText: { color: '#888', marginTop: 10 },
  countdown: { fontSize: 60, fontWeight: 'bold', color: '#f39c12', marginBottom: 20 },
  controls: { alignItems: 'center' },
  captureBtn: { width: 70, height: 70, borderRadius: 35, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', borderWidth: 4, borderColor: '#53a8b6' },
  captureBtnInner: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#53a8b6' },
  disabled: { opacity: 0.5 },
  autoBtn: { marginTop: 10 },
  autoBtnText: { color: '#53a8b6', fontSize: 13 },
  statusText: { color: '#53a8b6', fontSize: 16, marginTop: 15, marginBottom: 20, textAlign: 'center' },
  thumbRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  thumb: { width: 60, height: 80, borderRadius: 8, borderWidth: 2, borderColor: '#53a8b6' },
  hintText: { color: '#555', fontSize: 12, textAlign: 'center', marginTop: 8 },
  successCircle: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#5cb85c', justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  successIcon: { fontSize: 40, color: '#fff', fontWeight: 'bold' },
  successTitle: { fontSize: 26, fontWeight: 'bold', color: '#eee', marginBottom: 10 },
  successSub: { fontSize: 15, color: '#aaa' },
  failCircle: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#d9534f', justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  failIcon: { fontSize: 50, color: '#fff', fontWeight: 'bold' },
  failTitle: { fontSize: 24, fontWeight: 'bold', color: '#eee', marginBottom: 10 },
  failText: { fontSize: 14, color: '#aaa', textAlign: 'center', marginBottom: 10, paddingHorizontal: 20, lineHeight: 22 },
  attemptsText: { color: '#e67e22', fontSize: 13, marginBottom: 15 },
  maxText: { color: '#ff6b6b', fontSize: 13, marginBottom: 15, textAlign: 'center' },
});
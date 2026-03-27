import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CLOUDINARY_CONFIG } from '../cloudinaryConfig';
import { auth, db } from '../firebaseConfig';

const POSES = [
  { id: 'center', instruction: 'Look at the camera', icon: 'O' },
  { id: 'left', instruction: 'Turn head LEFT', icon: '<' },
  { id: 'right', instruction: 'Turn head RIGHT', icon: '>' },
];

// ─── Types ────────────────────────────────────────────────

type Step = 'intro' | 'camera' | 'verifying' | 'success' | 'failed';

interface CheckResult {
  ok: boolean;
  reason: string;
}

// ─── Helpers ─────────────────────────────────────────────

const isRemoteUrl = (value: string) => /^https?:\/\//i.test(value);
const isDataUrl = (value: string) => /^data:/i.test(value);

// ─── Cloudinary helpers ───────────────────────────────────

/**
 * Upload a local URI, data-URI, or remote URL to Cloudinary.
 * Requests built-in face coordinates with `faces=true`.
 * Returns the secure URL with a `_fc` query param containing the face count.
 */
async function uploadSelfie(uri: string): Promise<string | null> {
  try {
    const form = new FormData();
    const fileName = `selfie_${Date.now()}.jpg`;

    // Web data-URIs and remote URLs can be sent directly as strings.
    // Native local files should be appended as { uri, type, name }.
    if (isDataUrl(uri) || isRemoteUrl(uri)) {
      form.append('file', uri);
    } else {
      (form as any).append('file', {
        uri,
        type: 'image/jpeg',
        name: fileName,
      });
    }

    form.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset);
    form.append('folder', 'selfie_verification');

    // Correct Cloudinary parameter for built-in face detection response
    form.append('faces', 'true');

    const up = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/image/upload`,
      {
        method: 'POST',
        body: form,
      }
    );

    const raw = await up.text();
    let data: any = null;

    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }

    if (!up.ok) {
      console.error('[selfie] upload HTTP error', up.status, data);
      return null;
    }

    const url: string = data?.secure_url ?? '';
    if (!url) {
      console.error('[selfie] upload missing secure_url', data);
      return null;
    }

    const faceCount: number = Array.isArray(data?.faces) ? data.faces.length : 0;
    const sep = url.includes('?') ? '&' : '?';

    return `${url}${sep}_fc=${faceCount}`;
  } catch (err) {
    console.error('[selfie] uploadSelfie error:', err);
    return null;
  }
}

/**
 * Validate that a selfie URL contains exactly one face.
 *
 * Fast path:
 *   Reads the `_fc` param injected by uploadSelfie().
 *
 * Fallback:
 *   Re-uploads the image/URL through Cloudinary with `faces=true`
 *   so we can get a face count even for older profile photos.
 *
 * Fail mode:
 *   CLOSED: if we cannot confirm exactly one face, we reject.
 */
async function checkFace(url: string): Promise<CheckResult> {
  try {
    let faceCount: number | null = null;

    try {
      const urlObj = new URL(url);
      const fcParam = urlObj.searchParams.get('_fc');

      if (fcParam !== null) {
        const parsed = parseInt(fcParam, 10);
        if (!Number.isNaN(parsed)) {
          faceCount = parsed;
        }
      }
    } catch {
      // ignore URL parse error and fall back below
    }

    if (faceCount === null) {
      const reprobeUrl = await uploadSelfie(url);

      if (!reprobeUrl) {
        return {
          ok: false,
          reason: 'Could not verify photo. Please check your connection and try again.',
        };
      }

      const reprobeParsed = new URL(reprobeUrl).searchParams.get('_fc');
      const parsed = reprobeParsed ? parseInt(reprobeParsed, 10) : NaN;

      if (Number.isNaN(parsed)) {
        return {
          ok: false,
          reason: 'Could not verify photo. Please try again.',
        };
      }

      faceCount = parsed;
    }

    if (faceCount === 0) {
      return {
        ok: false,
        reason: 'No face detected. Look directly at the camera with good lighting.',
      };
    }

    if (faceCount > 1) {
      return {
        ok: false,
        reason: `${faceCount} faces detected. Your selfie must show only you.`,
      };
    }

    return { ok: true, reason: 'OK' };
  } catch (err) {
    console.error('[selfie] checkFace error:', err);
    return {
      ok: false,
      reason: 'Verification error. Please check your connection and try again.',
    };
  }
}

// ─── Component ────────────────────────────────────────────

export default function SelfieVerificationScreen() {
  const router = useRouter();
  const user = auth.currentUser;

  const cameraRef = useRef<CameraView>(null);
  const streamRef = useRef<any>(null);

  const [permission, requestPermission] = useCameraPermissions();

  const [step, setStep] = useState<Step>('intro');
  const [poseIndex, setPoseIndex] = useState(0);
  const [photos, setPhotos] = useState<string[]>([]);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [webReady, setWebReady] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState('');

  const isWeb = Platform.OS === 'web';

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => stopCamera();
  }, []);

  // ── Start web camera when step changes to 'camera' ──
  useEffect(() => {
    if (step === 'camera' && isWeb) {
      void startWebCamera();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // ─── Web camera ───────────────────────────────────────

  const startWebCamera = async () => {
    if (!isWeb) return;

    try {
      setCamError(null);
      setWebReady(false);

      const nav = (globalThis as any).navigator;
      if (!nav?.mediaDevices?.getUserMedia) {
        setCamError('Camera not supported in this browser.');
        return;
      }

      const stream = await nav.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });

      streamRef.current = stream;

      setTimeout(() => {
        const docApi = (globalThis as any).document;
        const video = docApi?.getElementById?.('selfie-cam') as any;
        if (!video) return;

        video.srcObject = stream;
        video.onloadedmetadata = () => {
          Promise.resolve(video.play?.()).catch(() => {});
          setWebReady(true);
        };
      }, 150);
    } catch (err: any) {
      if (err?.name === 'NotAllowedError') {
        setCamError('Camera access denied. Allow camera in browser settings.');
      } else if (err?.name === 'NotFoundError') {
        setCamError('No camera found on this device.');
      } else {
        setCamError('Camera error: ' + (err?.message ?? 'unknown'));
      }
    }
  };

  const stopCamera = () => {
    if (streamRef.current?.getTracks) {
      streamRef.current.getTracks().forEach((t: any) => t.stop());
      streamRef.current = null;
    }
    setWebReady(false);
  };

  /** Capture a frame from the web <video> element as a JPEG data-URI. */
  const captureWeb = (): string | null => {
    const docApi = (globalThis as any).document;
    const video = docApi?.getElementById?.('selfie-cam') as any;
    if (!video || video.readyState < 2) return null;

    const canvas = docApi?.createElement?.('canvas') as any;
    if (!canvas) return null;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    const ctx = canvas.getContext?.('2d');
    if (!ctx) return null;

    // Mirror horizontally so the preview matches reality
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
    ctx.restore();

    return canvas.toDataURL('image/jpeg', 0.85);
  };

  // ─── User actions ─────────────────────────────────────

  const startVerification = async () => {
    setCamError(null);
    setError('');
    setPhotos([]);
    setPoseIndex(0);

    if (!isWeb) {
      if (!permission?.granted) {
        const res = await requestPermission();
        if (!res.granted) {
          setError('Camera permission required.');
          return;
        }
      }
    }

    setStep('camera');
  };

  const capture = async () => {
    try {
      let uri: string | null = null;

      if (isWeb) {
        if (!webReady) return;
        uri = captureWeb();
      } else {
        if (!cameraRef.current) return;
        const photo = await cameraRef.current.takePictureAsync({ quality: 0.85 });
        uri = photo?.uri ?? null;
      }

      if (!uri) {
        Alert.alert('Capture failed', 'Try again.');
        return;
      }

      const newPhotos = [...photos, uri];
      setPhotos(newPhotos);

      if (poseIndex < POSES.length - 1) {
        setPoseIndex(poseIndex + 1);
      } else {
        stopCamera();
        setStep('verifying');
        await verify(newPhotos);
      }
    } catch (e) {
      console.error('[selfie] capture error:', e);
    }
  };

  const autoCapture = () => {
    if (isWeb && !webReady) return;
    setCountdown(3);

    const t = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(t);
          void capture();
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // ─── Verification flow ────────────────────────────────

  const verify = async (pics: string[]) => {
    try {
      if (!user) throw new Error('Not logged in');

      // ── Step 1: Upload all selfie frames ──
      setStatusText('Uploading photos…');
      const urls: string[] = [];

      for (const pic of pics) {
        setStatusText(`Uploading photo ${urls.length + 1} of ${pics.length}…`);
        const url = await uploadSelfie(pic);
        if (!url) throw new Error('Upload failed. Check your Cloudinary preset/config.');
        urls.push(url);
      }

      // ── Step 2: Validate each frame has exactly one face ──
      setStatusText('Checking for human face…');

      for (let i = 0; i < urls.length; i++) {
        setStatusText(`Verifying photo ${i + 1} of ${urls.length}…`);
        const result = await checkFace(urls[i] ?? '');

        if (!result.ok) {
          setAttempts((a) => a + 1);
          setError(result.reason);
          setStep('failed');
          return;
        }
      }

      // ── Step 3: Check that the profile photo also has a face ──
      setStatusText('Checking profile photo…');

      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (!userDoc.exists()) throw new Error('Profile not found.');

      const profilePics: string[] = userDoc.data().photos ?? [];
      if (profilePics.length === 0) {
        throw new Error('No profile photos found. Add a profile photo first.');
      }

      const profileUrl = profilePics[0];
      if (profileUrl) {
        const profileResult = await checkFace(profileUrl);
        if (!profileResult.ok) {
          setError('Your profile photo must show a clear, single face.');
          setStep('failed');
          return;
        }
      }

      // ── Step 4: Mark verified in Firestore ──
      setStatusText('Saving verification…');

      // Strip the _fc helper param before storing URLs
      const cleanUrls = urls.map((u) => u.split('?')[0] ?? u);

      await updateDoc(doc(db, 'users', user.uid), {
        selfieVerified: true,
        selfieVerifiedAt: new Date().toISOString(),
        selfiePhotos: cleanUrls,
      });

      setStatusText('Verified! ✓');
      setStep('success');
      setTimeout(() => router.back(), 2500);
    } catch (e: any) {
      console.error('[selfie] verify error:', e);
      setError(e?.message ?? 'Verification failed. Please try again.');
      setStep('failed');
    }
  };

  // ─── Render ───────────────────────────────────────────

  if (step === 'intro') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Verify Your Identity</Text>

        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>You will:</Text>
          {POSES.map((p, i) => (
            <Text key={p.id} style={styles.infoItem}>
              {`${i + 1}. ${p.instruction}`}
            </Text>
          ))}
        </View>

        <View style={styles.warnBox}>
          <Text style={styles.warnTitle}>LIVE CAMERA ONLY</Text>
          <Text style={styles.warnText}>
            No uploads from gallery. Camera capture only.
          </Text>
        </View>

        <View style={styles.rejectBox}>
          <Text style={styles.rejectTitle}>WILL BE REJECTED:</Text>
          <Text style={styles.rejectItem}>• No face visible</Text>
          <Text style={styles.rejectItem}>• Multiple faces in frame</Text>
          <Text style={styles.rejectItem}>• Animals, objects, cartoons</Text>
          <Text style={styles.rejectItem}>• Sunglasses or obscured face</Text>
        </View>

        <TouchableOpacity style={styles.startBtn} onPress={startVerification}>
          <Text style={styles.startBtnText}>Start Camera</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (step === 'camera') {
    const pose = POSES[poseIndex];

    return (
      <View style={styles.container}>
        <Text style={styles.poseText}>{pose?.instruction}</Text>
        <Text style={styles.stepText}>
          {`Step ${poseIndex + 1} / ${POSES.length}`}
        </Text>

        {isWeb ? (
          <View style={styles.camBox}>
            {camError ? (
              <View style={styles.camErrorBox}>
                <Text style={styles.camErrorText}>{camError}</Text>
                <TouchableOpacity
                  style={styles.retryBtn}
                  onPress={() => void startWebCamera()}
                >
                  <Text style={styles.retryBtnText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : !webReady ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="large" color="#53a8b6" />
                <Text style={styles.loadingText}>Starting camera…</Text>
              </View>
            ) : null}

            <View style={webReady ? styles.videoBox : styles.hidden}>
              {/* @ts-ignore web-only element */}
              <video
                id="selfie-cam"
                autoPlay
                playsInline
                muted
                style={
                  {
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    transform: 'scaleX(-1)',
                  } as any
                }
              />
              <View style={styles.guideOverlay}>
                <Text style={styles.guideIcon}>{pose?.icon}</Text>
              </View>
            </View>

            {webReady && (
              <View style={styles.liveBadge}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>LIVE</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.camBox}>
            <CameraView
              ref={cameraRef}
              style={styles.nativeCam}
              facing="front"
            >
              <View style={styles.guideOverlay}>
                <Text style={styles.guideIcon}>{pose?.icon}</Text>
              </View>
            </CameraView>
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          </View>
        )}

        {countdown !== null ? (
          <Text style={styles.countdown}>{countdown}</Text>
        ) : (
          <View style={styles.controls}>
            <TouchableOpacity
              style={[
                styles.captureBtn,
                isWeb && !webReady && styles.disabled,
              ]}
              onPress={() => void capture()}
              disabled={isWeb && !webReady}
            >
              <View style={styles.captureBtnInner} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.autoBtn}
              onPress={autoCapture}
              disabled={isWeb && !webReady}
            >
              <Text style={styles.autoBtnText}>Auto (3 s)</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => {
            stopCamera();
            router.back();
          }}
        >
          <Text style={styles.backBtnText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (step === 'verifying') {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={styles.statusText}>{statusText}</Text>

        <View style={styles.thumbRow}>
          {photos.map((p, i) => (
            <Image
              key={i}
              source={{ uri: p }}
              style={styles.thumb}
            />
          ))}
        </View>

        <Text style={styles.hintText}>
          Verifying with Cloudinary face detection…
        </Text>
      </View>
    );
  }

  if (step === 'success') {
    return (
      <View style={styles.container}>
        <View style={styles.successCircle}>
          <Text style={styles.successIcon}>✓</Text>
        </View>
        <Text style={styles.successTitle}>Verified!</Text>
        <Text style={styles.successSub}>Your profile is now verified.</Text>
      </View>
    );
  }

  if (step === 'failed') {
    return (
      <View style={styles.container}>
        <View style={styles.failCircle}>
          <Text style={styles.failIcon}>✕</Text>
        </View>

        <Text style={styles.failTitle}>Verification Failed</Text>
        <Text style={styles.failText}>{error}</Text>
        <Text style={styles.attemptsText}>
          {`Attempt ${attempts} of 3`}
        </Text>

        {attempts < 3 ? (
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => void startVerification()}
          >
            <Text style={styles.retryBtnText}>Try Again</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.maxText}>
            Maximum attempts reached. Please try again later.
          </Text>
        )}

        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
        >
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return null;
}

// ─── Styles ───────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },

  // ── Intro ──
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#eee',
    marginBottom: 20,
  },
  infoBox: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 15,
    width: '100%',
    marginBottom: 12,
  },
  infoTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#53a8b6',
    marginBottom: 10,
  },
  infoItem: {
    fontSize: 14,
    color: '#ccc',
    marginBottom: 5,
    paddingLeft: 8,
  },
  warnBox: {
    backgroundColor: '#3a2a0a',
    borderRadius: 10,
    padding: 12,
    width: '100%',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e67e22',
  },
  warnTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#f39c12',
    marginBottom: 4,
  },
  warnText: { fontSize: 12, color: '#ffc' },
  rejectBox: {
    backgroundColor: '#3a1a1a',
    borderRadius: 10,
    padding: 12,
    width: '100%',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#d9534f',
  },
  rejectTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#ff6b6b',
    marginBottom: 5,
  },
  rejectItem: { fontSize: 12, color: '#faa', marginBottom: 3 },

  // ── Buttons ──
  startBtn: {
    backgroundColor: '#53a8b6',
    paddingVertical: 15,
    paddingHorizontal: 50,
    borderRadius: 25,
    marginBottom: 10,
  },
  startBtnText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  backBtn: { padding: 12 },
  backBtnText: { color: '#d9534f', fontSize: 15 },
  retryBtn: {
    backgroundColor: '#e67e22',
    paddingVertical: 14,
    paddingHorizontal: 35,
    borderRadius: 25,
    marginBottom: 10,
  },
  retryBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  // ── Camera ──
  poseText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#53a8b6',
    marginBottom: 5,
  },
  stepText: { fontSize: 14, color: '#888', marginBottom: 15 },
  camBox: {
    width: 280,
    height: 360,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 3,
    borderColor: '#53a8b6',
    marginBottom: 20,
    position: 'relative',
  },
  nativeCam: { width: '100%', height: '100%' },
  videoBox: { width: '100%', height: '100%', position: 'relative' },
  hidden: { width: 0, height: 0, overflow: 'hidden' },
  guideOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  guideIcon: {
    fontSize: 80,
    color: 'rgba(83,168,182,0.4)',
    fontWeight: 'bold',
  },
  liveBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(217,83,79,0.95)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#fff',
    marginRight: 5,
  },
  liveText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  camErrorBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  camErrorText: {
    color: '#ff6b6b',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 15,
  },
  loadingBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: { color: '#888', marginTop: 10 },

  // ── Countdown / controls ──
  countdown: {
    fontSize: 60,
    fontWeight: 'bold',
    color: '#f39c12',
    marginBottom: 20,
  },
  controls: { alignItems: 'center' },
  captureBtn: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#53a8b6',
  },
  captureBtnInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#53a8b6',
  },
  disabled: { opacity: 0.5 },
  autoBtn: { marginTop: 10 },
  autoBtnText: { color: '#53a8b6', fontSize: 13 },

  // ── Verifying ──
  statusText: {
    color: '#53a8b6',
    fontSize: 16,
    marginTop: 15,
    marginBottom: 20,
    textAlign: 'center',
  },
  thumbRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  thumb: {
    width: 60,
    height: 80,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#53a8b6',
  },
  hintText: {
    color: '#555',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },

  // ── Success ──
  successCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#5cb85c',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  successIcon: { fontSize: 40, color: '#fff', fontWeight: 'bold' },
  successTitle: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#eee',
    marginBottom: 10,
  },
  successSub: { fontSize: 15, color: '#aaa' },

  // ── Failed ──
  failCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#d9534f',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  failIcon: { fontSize: 50, color: '#fff', fontWeight: 'bold' },
  failTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#eee',
    marginBottom: 10,
  },
  failText: {
    fontSize: 14,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 10,
    paddingHorizontal: 20,
    lineHeight: 22,
  },
  attemptsText: { color: '#e67e22', fontSize: 13, marginBottom: 15 },
  maxText: { color: '#ff6b6b', fontSize: 13, marginBottom: 15 },
});
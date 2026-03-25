import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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

export default function SelfieVerificationScreen() {
  const router = useRouter();
  const user = auth.currentUser;
  const cameraRef = useRef<CameraView>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [permission, requestPermission] = useCameraPermissions();
  const [step, setStep] = useState<'intro' | 'camera' | 'verifying' | 'success' | 'failed'>('intro');
  const [poseIndex, setPoseIndex] = useState(0);
  const [photos, setPhotos] = useState<string[]>([]);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [webReady, setWebReady] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState('');

  const isWeb = Platform.OS === 'web';

  useEffect(() => {
    return () => stopCamera();
  }, []);

  useEffect(() => {
    if (step === 'camera' && isWeb) {
      startWebCamera();
    }
  }, [step]);

  // ============ WEB CAMERA ============
  const startWebCamera = async () => {
    if (!isWeb) return;

    try {
      setCamError(null);
      setWebReady(false);

      if (!navigator.mediaDevices?.getUserMedia) {
        setCamError('Camera not supported in this browser.');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });

      streamRef.current = stream;

      setTimeout(() => {
        const video = document.getElementById('selfie-cam') as HTMLVideoElement;
        if (video) {
          video.srcObject = stream;
          video.onloadedmetadata = () => {
            video.play();
            setWebReady(true);
          };
        }
      }, 150);
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setCamError('Camera access denied. Allow camera in browser settings.');
      } else if (err.name === 'NotFoundError') {
        setCamError('No camera found on this device.');
      } else {
        setCamError('Camera error: ' + err.message);
      }
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setWebReady(false);
  };

  const captureWeb = (): string | null => {
    const video = document.getElementById('selfie-cam') as HTMLVideoElement;
    if (!video || video.readyState < 2) return null;

    const canvas = document.createElement('canvas');
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

  // ============ ACTIONS ============
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
        uri = photo?.uri || null;
      }

      if (!uri) {
        window.alert('Capture failed. Try again.');
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
      console.error('Capture error:', e);
    }
  };

  const autoCapture = () => {
    if (isWeb && !webReady) return;
    setCountdown(3);
    const t = setInterval(() => {
      setCountdown(prev => {
        if (prev === null || prev <= 1) {
          clearInterval(t);
          capture();
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // ============ VERIFICATION ============
  const verify = async (pics: string[]) => {
    try {
      if (!user) throw new Error('Not logged in');

      setStatusText('Uploading...');
      const urls: string[] = [];
      for (const p of pics) {
        const url = await upload(p);
        if (!url) throw new Error('Upload failed');
        urls.push(url);
      }

      setStatusText('Checking for human face...');
      for (let i = 0; i < urls.length; i++) {
        const res = await checkFace(urls[i]);
        if (!res.ok) {
          setAttempts(a => a + 1);
          setError(res.reason);
          setStep('failed');
          return;
        }
      }

      setStatusText('Checking profile photo...');
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (!userDoc.exists()) throw new Error('Profile not found');

      const profilePics = userDoc.data().photos || [];
      if (profilePics.length === 0) throw new Error('No profile photos');

      const profileRes = await checkFace(profilePics[0]);
      if (!profileRes.ok) {
        setError('Your profile photo must show a clear face.');
        setStep('failed');
        return;
      }

      setStatusText('Done!');
      await updateDoc(doc(db, 'users', user.uid), {
        selfieVerified: true,
        selfieVerifiedAt: new Date().toISOString(),
        selfiePhotos: urls,
      });

      setStep('success');
      setTimeout(() => router.back(), 2500);
    } catch (e: any) {
      setError(e.message || 'Verification failed');
      setStep('failed');
    }
  };

  const upload = async (uri: string): Promise<string | null> => {
    try {
      const res = await fetch(uri);
      const blob = await res.blob();

      const form = new FormData();
      form.append('file', blob);
      form.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset);
      form.append('folder', 'selfie_verification');

      const up = await fetch(
        'https://api.cloudinary.com/v1_1/' + CLOUDINARY_CONFIG.cloudName + '/image/upload',
        { method: 'POST', body: form }
      );

      const data = await up.json();
      return data.secure_url || null;
    } catch (e) {
      return null;
    }
  };

  const checkFace = async (url: string): Promise<{ ok: boolean; reason: string }> => {
    try {
      const res = await fetch('https://api.deepai.org/api/densecap', {
        method: 'POST',
        headers: {
          'api-key': 'quickstart-QUdJIGlzIGNvbWluZy4uLi4K',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image: url }),
      });

      const data = await res.json();
      if (!data.output?.captions?.length) {
        return { ok: false, reason: 'Could not analyze image.' };
      }

      const text = data.output.captions.map((c: any) => c.caption.toLowerCase()).join(' ');

      // Reject non-human
      const rejectList = [
        'dog', 'cat', 'bird', 'animal', 'pet', 'puppy', 'kitten', 'horse', 'cow', 'fish',
        'car', 'truck', 'bus', 'motorcycle', 'bicycle', 'airplane', 'boat',
        'phone', 'laptop', 'computer', 'screen', 'tv', 'monitor',
        'tree', 'flower', 'plant', 'mountain', 'ocean', 'beach', 'sky', 'sunset',
        'building', 'house', 'tower', 'road', 'street', 'city',
        'cartoon', 'drawing', 'anime', 'painting', 'sketch', 'meme', 'logo',
        'food', 'pizza', 'burger', 'cake', 'fruit',
        'chair', 'table', 'bed', 'sofa', 'desk',
        'toy', 'doll', 'robot', 'statue',
      ];

      for (const item of rejectList) {
        if (text.includes(item)) {
          const hasHuman = text.includes('person') || text.includes('man') || text.includes('woman') || text.includes('face');
          if (!hasHuman) {
            return { ok: false, reason: 'Detected "' + item + '" - not a human selfie.' };
          }
        }
      }

      const humanWords = ['person', 'man', 'woman', 'people', 'face', 'guy', 'girl'];
      const faceWords = ['face', 'head', 'eyes', 'nose', 'mouth', 'hair', 'smile'];

      let hScore = 0;
      let fScore = 0;
      for (const w of humanWords) if (text.includes(w)) hScore++;
      for (const w of faceWords) if (text.includes(w)) fScore++;

      if (hScore === 0 && fScore === 0) {
        return { ok: false, reason: 'No human face detected.' };
      }

      if (hScore === 0 && fScore < 2) {
        return { ok: false, reason: 'Face not clear. Use better lighting.' };
      }

      return { ok: true, reason: 'OK' };
    } catch (e) {
      return { ok: false, reason: 'Verification error. Try again.' };
    }
  };

  // ============ RENDER ============

  if (step === 'intro') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Verify Your Identity</Text>

        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>You will:</Text>
          {POSES.map((p, i) => (
            <Text key={p.id} style={styles.infoItem}>{(i + 1) + '. ' + p.instruction}</Text>
          ))}
        </View>

        <View style={styles.warnBox}>
          <Text style={styles.warnTitle}>LIVE CAMERA ONLY</Text>
          <Text style={styles.warnText}>No uploads. No gallery. Camera only.</Text>
        </View>

        <View style={styles.rejectBox}>
          <Text style={styles.rejectTitle}>REJECTED:</Text>
          <Text style={styles.rejectItem}>Animals, objects, cartoons</Text>
          <Text style={styles.rejectItem}>Photos without clear face</Text>
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
        <Text style={styles.poseText}>{pose.instruction}</Text>
        <Text style={styles.stepText}>{'Step ' + (poseIndex + 1) + '/' + POSES.length}</Text>

        {isWeb ? (
          <View style={styles.camBox}>
            {camError ? (
              <View style={styles.camErrorBox}>
                <Text style={styles.camErrorText}>{camError}</Text>
                <TouchableOpacity style={styles.retryBtn} onPress={startWebCamera}>
                  <Text style={styles.retryBtnText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : !webReady ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="large" color="#53a8b6" />
                <Text style={styles.loadingText}>Starting camera...</Text>
              </View>
            ) : null}

            <View style={webReady ? styles.videoBox : styles.hidden}>
              <video
                id="selfie-cam"
                autoPlay
                playsInline
                muted
                style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
              />
              <View style={styles.guideOverlay}>
                <Text style={styles.guideIcon}>{pose.icon}</Text>
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
            <CameraView ref={cameraRef} style={styles.nativeCam} facing="front">
              <View style={styles.guideOverlay}>
                <Text style={styles.guideIcon}>{pose.icon}</Text>
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
              style={[styles.captureBtn, (!webReady && isWeb) && styles.disabled]}
              onPress={capture}
              disabled={isWeb && !webReady}
            >
              <View style={styles.captureBtnInner} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.autoBtn} onPress={autoCapture}>
              <Text style={styles.autoBtnText}>Auto (3s)</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity style={styles.backBtn} onPress={() => { stopCamera(); router.back(); }}>
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
            <Image key={i} source={{ uri: p }} style={styles.thumb} />
          ))}
        </View>
      </View>
    );
  }

  if (step === 'success') {
    return (
      <View style={styles.container}>
        <View style={styles.successCircle}>
          <Text style={styles.successIcon}>OK</Text>
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
          <Text style={styles.failIcon}>X</Text>
        </View>
        <Text style={styles.failTitle}>Failed</Text>
        <Text style={styles.failText}>{error}</Text>
        <Text style={styles.attemptsText}>{'Attempts: ' + attempts + '/3'}</Text>

        {attempts < 3 ? (
          <TouchableOpacity style={styles.retryBtn} onPress={startVerification}>
            <Text style={styles.retryBtnText}>Try Again</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.maxText}>Max attempts. Try later.</Text>
        )}

        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center', padding: 20 },
  title: { fontSize: 26, fontWeight: 'bold', color: '#eee', marginBottom: 20 },

  infoBox: { backgroundColor: '#16213e', borderRadius: 12, padding: 15, width: '100%', marginBottom: 12 },
  infoTitle: { fontSize: 15, fontWeight: '600', color: '#53a8b6', marginBottom: 10 },
  infoItem: { fontSize: 14, color: '#ccc', marginBottom: 5, paddingLeft: 8 },

  warnBox: { backgroundColor: '#3a2a0a', borderRadius: 10, padding: 12, width: '100%', marginBottom: 10, borderWidth: 1, borderColor: '#e67e22' },
  warnTitle: { fontSize: 14, fontWeight: 'bold', color: '#f39c12', marginBottom: 4 },
  warnText: { fontSize: 12, color: '#ffc' },

  rejectBox: { backgroundColor: '#3a1a1a', borderRadius: 10, padding: 12, width: '100%', marginBottom: 20, borderWidth: 1, borderColor: '#d9534f' },
  rejectTitle: { fontSize: 13, fontWeight: 'bold', color: '#ff6b6b', marginBottom: 5 },
  rejectItem: { fontSize: 12, color: '#faa' },

  startBtn: { backgroundColor: '#53a8b6', paddingVertical: 15, paddingHorizontal: 50, borderRadius: 25, marginBottom: 10 },
  startBtnText: { color: '#fff', fontSize: 17, fontWeight: '600' },

  backBtn: { padding: 12 },
  backBtnText: { color: '#d9534f', fontSize: 15 },

  poseText: { fontSize: 20, fontWeight: 'bold', color: '#53a8b6', marginBottom: 5 },
  stepText: { fontSize: 14, color: '#888', marginBottom: 15 },

  camBox: { width: 280, height: 360, borderRadius: 20, overflow: 'hidden', backgroundColor: '#000', borderWidth: 3, borderColor: '#53a8b6', marginBottom: 20, position: 'relative' },
  nativeCam: { width: '100%', height: '100%' },
  videoBox: { width: '100%', height: '100%', position: 'relative' },
  hidden: { width: 0, height: 0, overflow: 'hidden' },

  guideOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' },
  guideIcon: { fontSize: 80, color: 'rgba(83,168,182,0.4)', fontWeight: 'bold' },

  liveBadge: { position: 'absolute', top: 10, right: 10, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(217,83,79,0.95)', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 10 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff', marginRight: 5 },
  liveText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },

  camErrorBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  camErrorText: { color: '#ff6b6b', fontSize: 14, textAlign: 'center', marginBottom: 15 },

  loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#888', marginTop: 10 },

  countdown: { fontSize: 60, fontWeight: 'bold', color: '#f39c12', marginBottom: 20 },

  controls: { alignItems: 'center' },
  captureBtn: { width: 70, height: 70, borderRadius: 35, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', borderWidth: 4, borderColor: '#53a8b6' },
  captureBtnInner: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#53a8b6' },
  disabled: { opacity: 0.5 },
  autoBtn: { marginTop: 10 },
  autoBtnText: { color: '#53a8b6', fontSize: 13 },

  statusText: { color: '#53a8b6', fontSize: 16, marginTop: 15, marginBottom: 20 },
  thumbRow: { flexDirection: 'row', gap: 10 },
  thumb: { width: 60, height: 80, borderRadius: 8, borderWidth: 2, borderColor: '#53a8b6' },

  successCircle: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#5cb85c', justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  successIcon: { fontSize: 40, color: '#fff', fontWeight: 'bold' },
  successTitle: { fontSize: 26, fontWeight: 'bold', color: '#eee', marginBottom: 10 },
  successSub: { fontSize: 15, color: '#aaa' },

  failCircle: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#d9534f', justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  failIcon: { fontSize: 50, color: '#fff', fontWeight: 'bold' },
  failTitle: { fontSize: 24, fontWeight: 'bold', color: '#eee', marginBottom: 10 },
  failText: { fontSize: 14, color: '#aaa', textAlign: 'center', marginBottom: 10, paddingHorizontal: 20 },
  attemptsText: { color: '#e67e22', fontSize: 13, marginBottom: 15 },

  retryBtn: { backgroundColor: '#e67e22', paddingVertical: 14, paddingHorizontal: 35, borderRadius: 25, marginBottom: 10 },
  retryBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  maxText: { color: '#ff6b6b', fontSize: 13, marginBottom: 15 },
});
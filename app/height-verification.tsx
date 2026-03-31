import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { doc, updateDoc } from 'firebase/firestore';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { CLOUDINARY_CONFIG } from '../cloudinaryConfig';
import { auth, db } from '../firebaseConfig';
import { checkImageSafety } from '../utils/moderation';

interface UploadResult { url: string; faces: number[][]; width: number; height: number; }
interface AIResult { height: number; confidence: number; }
interface HeightData {
  value: number;
  verificationMethod: VerificationMethod;
  verifiedAt: string;
  proofPhotoUrl?: string;
  confidence?: number;
  estimationMethod?: 'cloudinary-face-anthropometrics';
}
type VerificationMethod = 'self-reported' | 'manual-measured' | 'ai-estimated';

const isWeb = Platform.OS === 'web';
const webVideoStyle = { width: '100%', height: '100%', objectFit: 'cover' } satisfies React.CSSProperties;
const getErrorMessage = (e: unknown) => e instanceof Error ? e.message : 'Something went wrong';

const measurementInstructions = [
  { step: 1, title: 'Stand Against a Wall', description: 'Find a flat wall with no baseboard. Stand with heels touching the wall.' },
  { step: 2, title: 'Remove Shoes and Stand Straight', description: 'Take off your shoes. Stand up straight with your head level.' },
  { step: 3, title: 'Mark Your Height', description: 'Use a book or ruler on top of your head. Mark the wall with a pencil.' },
  { step: 4, title: 'Measure from Floor to Mark', description: 'Use a measuring tape from the floor to the mark. Read the measurement.' },
  { step: 5, title: 'Take a Photo', description: 'Take a clear photo showing the measuring tape, the mark, and your feet for reference.' },
];

export default function HeightVerificationScreen() {
  const router = useRouter();
  const user = auth.currentUser;
  const cameraRef = useRef<CameraView>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [method, setMethod] = useState<VerificationMethod>('self-reported');
  const [height, setHeight] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoData, setPhotoData] = useState<UploadResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiEstimating, setAiEstimating] = useState(false);
  const [aiResult, setAiResult] = useState<AIResult | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [webCameraReady, setWebCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [captureTarget, setCaptureTarget] = useState<'manual' | 'ai'>('manual');

  const selectMethod = useCallback((next: VerificationMethod) => {
    setMethod(next);
    setAiResult(null);
  }, []);

  const stopWebCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setWebCameraReady(false);
  }, []);

  useEffect(() => () => stopWebCamera(), [stopWebCamera]);

  const uploadPhoto = useCallback(async (photoUri: string): Promise<UploadResult | null> => {
    try {
      try {
        const safety = await checkImageSafety(photoUri);
        if (!safety.safe) {
          Alert.alert('Inappropriate Content', safety.reason || 'This photo was flagged.');
          return null;
        }
      } catch {}

      const response = await fetch(photoUri);
      const blob = await response.blob();
      const formData = new FormData();
      formData.append('file', blob, 'height.jpg');
      formData.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset);
      formData.append('cloud_name', CLOUDINARY_CONFIG.cloudName);
      formData.append('faces', 'true');

      const uploadResponse = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/image/upload`, {
        method: 'POST',
        body: formData,
      });
      const uploadData = await uploadResponse.json();

      if (!uploadResponse.ok || !uploadData?.secure_url) {
        Alert.alert('Upload Failed', 'Could not upload photo. Try again.');
        return null;
      }

      return {
        url: uploadData.secure_url,
        faces: Array.isArray(uploadData.faces) ? uploadData.faces : [],
        width: typeof uploadData.width === 'number' ? uploadData.width : 0,
        height: typeof uploadData.height === 'number' ? uploadData.height : 0,
      };
    } catch (e) {
      console.error('[height] uploadPhoto:', e);
      Alert.alert('Error', 'Error uploading photo. Check your connection.');
      return null;
    }
  }, []);

  const startWebCamera = useCallback(async () => {
    if (!isWeb) return;
    try {
      setCameraError(null);
      setWebCameraReady(false);

      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Camera not supported');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });

      streamRef.current = stream;
      setTimeout(() => {
        const video = document.getElementById('height-camera') as HTMLVideoElement | null;
        if (!video) return;
        video.srcObject = stream;
        video.onloadedmetadata = () => {
          void video.play();
          setWebCameraReady(true);
        };
      }, 100);
    } catch (e) {
      const msg = e instanceof Error && e.name === 'NotAllowedError' ? 'Camera blocked' : 'Camera error';
      setCameraError(msg);
    }
  }, []);

  const closeCamera = useCallback(() => {
    stopWebCamera();
    setCameraOpen(false);
    setCameraError(null);
  }, [stopWebCamera]);

  const openCamera = useCallback(async (target: 'manual' | 'ai') => {
    setCaptureTarget(target);
    if (!isWeb && !permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        Alert.alert('Permission Required', 'Camera permission is needed');
        return;
      }
    }
    setCameraOpen(true);
    if (isWeb) setTimeout(() => { void startWebCamera(); }, 200);
  }, [permission, requestPermission, startWebCamera]);

  const capturePhoto = useCallback(async () => {
    try {
      let uri: string | null = null;

      if (isWeb) {
        if (!webCameraReady) return;
        const video = document.getElementById('height-camera') as HTMLVideoElement | null;
        if (!video || (video.readyState ?? 0) < 2) return;

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          Alert.alert('Error', 'Could not access the camera frame');
          return;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        uri = canvas.toDataURL('image/jpeg', 0.85);
      } else {
        const pic = await cameraRef.current?.takePictureAsync({ quality: 0.85 });
        uri = pic?.uri || null;
      }

      if (!uri) {
        Alert.alert('Error', 'Failed to capture photo');
        return;
      }

      closeCamera();
      setUploading(true);
      const result = await uploadPhoto(uri);
      if (result) {
        setPhoto(result.url);
        setPhotoData(result);
      }
    } catch (e) {
      console.error('[height] capturePhoto:', e);
      Alert.alert('Error', 'Error capturing photo');
    } finally {
      setUploading(false);
    }
  }, [closeCamera, uploadPhoto, webCameraReady]);

  const runAIEstimation = useCallback(async () => {
    if (!photoData) {
      Alert.alert('No Photo', 'Please take a photo first');
      return;
    }

    setAiEstimating(true);
    try {
      if (!photoData.faces.length) {
        Alert.alert('No Face Detected', 'Please take a clear full-body photo with your face visible and good lighting.');
        return;
      }

      const face = photoData.faces[0] ?? [];
      const faceY = face[1] ?? 0;
      const faceH = face[3] ?? 0;
      const imgH = photoData.height;

      if (faceH <= 0 || imgH <= 0) {
        Alert.alert('Error', 'Could not analyze photo dimensions. Try a different photo.');
        return;
      }

      const faceRatio = faceH / imgH;
      if (faceRatio > 0.35) {
        Alert.alert('Not a Full-Body Photo', 'Your face takes up too much of the photo. Please stand further back so your full body is visible.');
        return;
      }
      if (faceRatio < 0.03) {
        Alert.alert('Too Far Away', 'You are too far from the camera. Stand 2-3 meters away.');
        return;
      }

      const averageFaceCm = 23;
      const headTopY = Math.max(0, faceY - faceH * 0.3);
      const personHeightPixels = imgH - headTopY;
      if (personHeightPixels <= 0) {
        Alert.alert('Error', 'Could not calculate proportions. Try again.');
        return;
      }

      const facesInBody = personHeightPixels / faceH;
      const estimatedHeight = Math.round(facesInBody * averageFaceCm);

      let confidence = 60;
      if (facesInBody >= 6.5 && facesInBody <= 8.5) confidence += 10;
      if (facesInBody >= 7 && facesInBody <= 8) confidence += 5;
      if (estimatedHeight >= 150 && estimatedHeight <= 200) confidence += 5;
      if (estimatedHeight >= 155 && estimatedHeight <= 195) confidence += 5;
      if (faceY / imgH < 0.25) confidence += 5;
      confidence = Math.min(confidence, 85);

      if (estimatedHeight < 130 || estimatedHeight > 230) {
        Alert.alert('Estimation Uncertain', `The AI estimated ${estimatedHeight}cm which seems unlikely. Try a better full-body photo or use manual measurement.`);
        return;
      }

      setAiResult({ height: estimatedHeight, confidence });
      setHeight(String(estimatedHeight));
    } catch (e) {
      console.error('[height] runAIEstimation:', e);
      Alert.alert('Error', 'AI estimation failed. Try manual measurement instead.');
    } finally {
      setAiEstimating(false);
    }
  }, [photoData]);

  const handleSave = useCallback(async () => {
    if (!height) return Alert.alert('Missing Height', 'Please enter your height');

    const heightNum = parseInt(height, 10);
    if (Number.isNaN(heightNum) || heightNum < 100 || heightNum > 250) {
      return Alert.alert('Invalid Height', 'Please enter a valid height between 100-250 cm');
    }
    if (method === 'manual-measured' && !photo) return Alert.alert('Missing Photo', 'Please upload a measurement photo');
    if (method === 'ai-estimated' && !aiResult) return Alert.alert('Missing Estimation', 'Please run AI estimation first');
    if (!user) return Alert.alert('Not Signed In', 'Please sign in again');

    setSaving(true);
    try {
      const heightData: HeightData = { value: heightNum, verificationMethod: method, verifiedAt: new Date().toISOString() };
      if (method === 'manual-measured' && photo) heightData.proofPhotoUrl = photo;
      if (method === 'ai-estimated' && aiResult) {
        heightData.confidence = aiResult.confidence;
        heightData.estimationMethod = 'cloudinary-face-anthropometrics';
      }

      await updateDoc(doc(db, 'users', user.uid), { height: heightData });
      Alert.alert('Success', 'Height verification saved!', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e) {
      console.error('[height] handleSave:', e);
      Alert.alert('Error', getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }, [aiResult, height, method, photo, router, user]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} scrollEnabled={!cameraOpen}>
      <Text style={styles.title}>Height Verification</Text>
      <Text style={styles.subtitle}>Choose how you would like to verify your height</Text>

      <View style={styles.methodContainer}>
        <TouchableOpacity
          style={[styles.methodCard, method === 'self-reported' && styles.methodCardActive]}
          onPress={() => selectMethod('self-reported')}
          accessibilityRole="button"
          accessibilityLabel="Select self reported verification"
          accessibilityHint="Enter your height manually without proof"
        >
          <Text style={styles.methodIcon}>📝</Text>
          <Text style={styles.methodTitle}>Self-Reported</Text>
          <Text style={styles.methodDesc}>Just enter your height</Text>
          <Text style={styles.methodBadge}>Badge: "Self-Reported"</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.methodCard, method === 'manual-measured' && styles.methodCardActive]}
          onPress={() => selectMethod('manual-measured')}
          accessibilityRole="button"
          accessibilityLabel="Select manual measured verification"
          accessibilityHint="Measure your height and upload a proof photo"
        >
          <Text style={styles.methodIcon}>📏</Text>
          <Text style={styles.methodTitle}>Manual Measured</Text>
          <Text style={styles.methodDesc}>Measure with tape, take photo proof</Text>
          <Text style={styles.methodBadge}>Badge: "Verified"</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.methodCard, method === 'ai-estimated' && styles.methodCardActive]}
          onPress={() => selectMethod('ai-estimated')}
          accessibilityRole="button"
          accessibilityLabel="Select AI estimated verification"
          accessibilityHint="Upload a full body photo for AI estimation"
        >
          <Text style={styles.methodIcon}>🤖</Text>
          <Text style={styles.methodTitle}>AI Estimated</Text>
          <Text style={styles.methodDesc}>Full-body photo, AI estimates height</Text>
          <Text style={styles.methodBadge}>Badge: "AI Estimated (±10cm)"</Text>
        </TouchableOpacity>
      </View>

      {method === 'self-reported' && (
        <View style={styles.inputContainer}>
          <Text style={styles.label}>Enter Your Height (cm)</Text>
          <TextInput
            style={styles.input}
            value={height}
            onChangeText={text => setHeight(text.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            placeholder="175"
            placeholderTextColor="#666"
            maxLength={3}
            accessibilityLabel="Height in centimeters"
          />
          <Text style={styles.hint}>Your profile will show: "Self-Reported"</Text>
        </View>
      )}

      {method === 'manual-measured' && (
        <View style={styles.tutorialContainer}>
          <Text style={styles.tutorialTitle}>How to Measure Your Height</Text>

          {measurementInstructions.map(item => (
            <View key={item.step} style={styles.tutorialStep}>
              <View style={styles.stepHeader}>
                <View style={styles.stepNumber}>
                  <Text style={styles.stepNumberText}>{item.step}</Text>
                </View>
                <Text style={styles.stepTitle}>{item.title}</Text>
              </View>
              <Text style={styles.stepDesc}>{item.description}</Text>
            </View>
          ))}

          <TouchableOpacity
            style={styles.uploadButton}
            onPress={() => openCamera('manual')}
            disabled={uploading || saving}
            accessibilityRole="button"
            accessibilityLabel={photo ? 'Retake measurement photo' : 'Take measurement photo'}
          >
            {uploading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.uploadButtonText}>{photo ? '📷 Retake Photo' : '📷 Take Measurement Photo'}</Text>}
          </TouchableOpacity>

          {photo && <Image source={{ uri: photo }} style={styles.previewPhoto} accessibilityLabel="Measurement proof photo preview" />}

          <Text style={styles.label}>Measured Height (cm)</Text>
          <TextInput
            style={styles.input}
            value={height}
            onChangeText={text => setHeight(text.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            placeholder="175"
            placeholderTextColor="#666"
            maxLength={3}
            accessibilityLabel="Measured height in centimeters"
          />

          <Text style={styles.verificationNote}>Your photo will be reviewed within 24 hours</Text>
        </View>
      )}

      {method === 'ai-estimated' && (
        <View style={styles.aiContainer}>
          <Text style={styles.aiTitle}>AI Height Estimation</Text>
          <Text style={styles.aiInstructions}>Take a full-body photo standing straight. The AI will estimate your height using face-to-body proportions.</Text>

          <View style={styles.aiTips}>
            <Text style={styles.aiTipTitle}>Tips for accurate results:</Text>
            <Text style={styles.aiTip}>• Stand straight, feet together</Text>
            <Text style={styles.aiTip}>• Remove shoes</Text>
            <Text style={styles.aiTip}>• Camera at chest height, 2-3 meters away</Text>
            <Text style={styles.aiTip}>• Full body visible from head to feet</Text>
            <Text style={styles.aiTip}>• Good lighting on your face</Text>
          </View>

          <View style={styles.accuracyWarning}>
            <Text style={styles.accuracyWarningTitle}>⚠️ Accuracy Notice</Text>
            <Text style={styles.accuracyWarningText}>AI estimation uses face-to-body proportions and is accurate to approximately ±10cm. For exact results, use Manual Measured instead.</Text>
          </View>

          <TouchableOpacity
            style={styles.uploadButton}
            onPress={() => openCamera('ai')}
            disabled={uploading || saving}
            accessibilityRole="button"
            accessibilityLabel={photo ? 'Retake full body photo' : 'Take full body photo'}
          >
            {uploading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.uploadButtonText}>{photo ? '📷 Retake Photo' : '📷 Take Full-Body Photo'}</Text>}
          </TouchableOpacity>

          {photo && <Image source={{ uri: photo }} style={styles.previewPhoto} accessibilityLabel="Full body photo preview for AI estimation" />}

          {photo && !aiResult && (
            <TouchableOpacity
              style={styles.estimateButton}
              onPress={runAIEstimation}
              disabled={aiEstimating}
              accessibilityRole="button"
              accessibilityLabel="Run AI height estimation"
            >
              {aiEstimating ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={styles.estimateButtonText}>Analyzing proportions…</Text>
                </View>
              ) : (
                <Text style={styles.estimateButtonText}>Run AI Estimation</Text>
              )}
            </TouchableOpacity>
          )}

          {aiResult && (
            <View style={styles.aiResultContainer}>
              <Text style={styles.aiResultTitle}>AI Estimation Result:</Text>
              <Text style={styles.aiResultHeight}>{aiResult.height}cm</Text>
              <Text style={styles.aiResultConfidence}>Confidence: {aiResult.confidence}%</Text>
              <Text style={styles.aiResultNote}>Based on face-to-body anthropometric ratio.{'\n'}Accuracy: ±10cm. Profile will show "AI Estimated"</Text>

              <TouchableOpacity
                style={styles.reEstimateButton}
                onPress={() => { setAiResult(null); setPhoto(null); setPhotoData(null); setHeight(''); }}
                accessibilityRole="button"
                accessibilityLabel="Try again with a new photo"
              >
                <Text style={styles.reEstimateButtonText}>Try Again With New Photo</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      <TouchableOpacity
        style={[styles.saveButton, saving && styles.saveButtonDisabled]}
        onPress={handleSave}
        disabled={saving || uploading || aiEstimating}
        accessibilityRole="button"
        accessibilityLabel="Save height verification"
      >
        <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save Height Verification'}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.cancelButton}
        onPress={() => router.back()}
        disabled={saving}
        accessibilityRole="button"
        accessibilityLabel="Cancel and go back"
      >
        <Text style={styles.cancelButtonText}>Cancel</Text>
      </TouchableOpacity>

      {cameraOpen && (
        <View style={styles.cameraModal}>
          <Text style={styles.cameraTitle}>{captureTarget === 'ai' ? 'Full-Body Photo' : 'Measurement Photo'}</Text>
          <Text style={styles.cameraHint}>{captureTarget === 'ai' ? 'Stand 2-3m away, full body visible' : 'Show tape measure clearly'}</Text>

          {isWeb ? (
            <View style={styles.camBox}>
              {cameraError ? (
                <View style={styles.camErrorBox}>
                  <Text style={styles.camErrorText}>{cameraError}</Text>
                  <TouchableOpacity
                    style={styles.retryBtn}
                    onPress={() => { void startWebCamera(); }}
                    accessibilityRole="button"
                    accessibilityLabel="Retry camera"
                  >
                    <Text style={styles.retryBtnText}>Retry</Text>
                  </TouchableOpacity>
                </View>
              ) : !webCameraReady ? (
                <View style={styles.loadingBox}>
                  <ActivityIndicator size="large" color="#53a8b6" />
                  <Text style={styles.loadingTextCam}>Starting camera…</Text>
                </View>
              ) : null}

              <View style={webCameraReady ? styles.videoBox : styles.hidden}>
                <video id="height-camera" autoPlay playsInline muted style={webVideoStyle} />
              </View>
            </View>
          ) : (
            <View style={styles.camBox}>
              <CameraView ref={cameraRef} style={styles.nativeCam} facing="back" />
            </View>
          )}

          <View style={styles.cameraControls}>
            <TouchableOpacity
              style={[styles.captureBtn, isWeb && !webCameraReady && styles.disabled]}
              onPress={capturePhoto}
              disabled={isWeb && !webCameraReady}
              accessibilityRole="button"
              accessibilityLabel="Capture photo"
            >
              <View style={styles.captureBtnInner} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.closeCamBtn}
            onPress={closeCamera}
            accessibilityRole="button"
            accessibilityLabel="Close camera"
          >
            <Text style={styles.closeCamBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  content: { padding: 20, paddingBottom: 50 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#eee', marginTop: 20, marginBottom: 10, textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#aaa', marginBottom: 30, textAlign: 'center' },

  methodContainer: { marginBottom: 30 },
  methodCard: { backgroundColor: '#16213e', borderRadius: 15, padding: 20, marginBottom: 15, borderWidth: 2, borderColor: '#16213e' },
  methodCardActive: { borderColor: '#53a8b6', backgroundColor: '#0f3460' },
  methodIcon: { fontSize: 40, textAlign: 'center', marginBottom: 10 },
  methodTitle: { fontSize: 18, fontWeight: 'bold', color: '#eee', textAlign: 'center', marginBottom: 5 },
  methodDesc: { fontSize: 13, color: '#aaa', textAlign: 'center', marginBottom: 8 },
  methodBadge: { fontSize: 11, color: '#53a8b6', textAlign: 'center', fontStyle: 'italic' },

  inputContainer: { marginBottom: 30 },
  label: { fontSize: 16, color: '#eee', marginBottom: 10 },
  input: { backgroundColor: '#16213e', color: '#fff', padding: 15, borderRadius: 10, fontSize: 18, textAlign: 'center' },
  hint: { fontSize: 12, color: '#888', marginTop: 10, textAlign: 'center' },

  tutorialContainer: { marginBottom: 30 },
  tutorialTitle: { fontSize: 20, fontWeight: 'bold', color: '#53a8b6', marginBottom: 20, textAlign: 'center' },
  tutorialStep: { backgroundColor: '#16213e', borderRadius: 10, padding: 15, marginBottom: 12 },
  stepHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  stepNumber: { backgroundColor: '#53a8b6', width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  stepNumberText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  stepTitle: { fontSize: 16, fontWeight: '600', color: '#eee', flex: 1 },
  stepDesc: { fontSize: 14, color: '#aaa', lineHeight: 20, paddingLeft: 42 },

  uploadButton: { backgroundColor: '#5cb85c', paddingVertical: 15, borderRadius: 10, alignItems: 'center', marginTop: 20, marginBottom: 15 },
  uploadButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  previewPhoto: { width: '100%', height: 300, borderRadius: 10, marginBottom: 15 },
  verificationNote: { color: '#5cb85c', fontSize: 12, textAlign: 'center', marginTop: 10 },

  aiContainer: { marginBottom: 30 },
  aiTitle: { fontSize: 20, fontWeight: 'bold', color: '#53a8b6', marginBottom: 10, textAlign: 'center' },
  aiInstructions: { fontSize: 14, color: '#aaa', textAlign: 'center', marginBottom: 20, lineHeight: 20 },
  aiTips: { backgroundColor: '#16213e', borderRadius: 10, padding: 15, marginBottom: 15 },
  aiTipTitle: { fontSize: 14, fontWeight: '600', color: '#eee', marginBottom: 10 },
  aiTip: { fontSize: 13, color: '#aaa', marginBottom: 6 },
  accuracyWarning: { backgroundColor: '#3a2a0a', borderRadius: 10, padding: 12, marginBottom: 20, borderWidth: 1, borderColor: '#e67e22' },
  accuracyWarningTitle: { fontSize: 13, fontWeight: 'bold', color: '#f39c12', marginBottom: 5 },
  accuracyWarningText: { fontSize: 12, color: '#daa', lineHeight: 18 },
  estimateButton: { backgroundColor: '#e67e22', paddingVertical: 15, borderRadius: 10, alignItems: 'center', marginTop: 15 },
  estimateButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  aiResultContainer: { backgroundColor: '#0f3460', borderRadius: 15, padding: 20, marginTop: 20, alignItems: 'center' },
  aiResultTitle: { fontSize: 14, color: '#aaa', marginBottom: 10 },
  aiResultHeight: { fontSize: 40, fontWeight: 'bold', color: '#53a8b6', marginBottom: 5 },
  aiResultConfidence: { fontSize: 16, color: '#eee', marginBottom: 10 },
  aiResultNote: { fontSize: 12, color: '#888', textAlign: 'center', lineHeight: 18 },
  reEstimateButton: { backgroundColor: '#16213e', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 15, marginTop: 15 },
  reEstimateButtonText: { color: '#53a8b6', fontSize: 13, fontWeight: '600' },

  saveButton: { backgroundColor: '#5cb85c', paddingVertical: 16, borderRadius: 25, marginTop: 30, alignItems: 'center' },
  saveButtonDisabled: { backgroundColor: '#555' },
  saveButtonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  cancelButton: { paddingVertical: 12, marginTop: 10, alignItems: 'center' },
  cancelButtonText: { color: '#d9534f', fontSize: 16 },

  cameraModal: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center', padding: 20, zIndex: 999 },
  cameraTitle: { fontSize: 22, fontWeight: 'bold', color: '#eee', marginBottom: 8 },
  cameraHint: { fontSize: 13, color: '#888', marginBottom: 20, fontStyle: 'italic' },
  camBox: { width: 300, height: 400, borderRadius: 20, overflow: 'hidden', backgroundColor: '#000', borderWidth: 3, borderColor: '#53a8b6', marginBottom: 20 },
  nativeCam: { width: '100%', height: '100%' },
  videoBox: { width: '100%', height: '100%' },
  hidden: { width: 0, height: 0, overflow: 'hidden' },
  camErrorBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  camErrorText: { color: '#ff6b6b', fontSize: 14, textAlign: 'center', marginBottom: 15 },
  loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingTextCam: { color: '#888', marginTop: 10 },
  cameraControls: { alignItems: 'center', marginBottom: 20 },
  captureBtn: { width: 70, height: 70, borderRadius: 35, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', borderWidth: 4, borderColor: '#53a8b6' },
  captureBtnInner: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#53a8b6' },
  disabled: { opacity: 0.5 },
  closeCamBtn: { padding: 12 },
  closeCamBtnText: { color: '#d9534f', fontSize: 16 },
  retryBtn: { backgroundColor: '#e67e22', paddingVertical: 12, paddingHorizontal: 30, borderRadius: 20 },
  retryBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
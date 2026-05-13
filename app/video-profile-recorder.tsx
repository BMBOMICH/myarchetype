import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { logger } from '../utils/logger';
import { checkImageSafety } from '../utils/moderation';
import { uploadVideoProfile } from '../utils/videoProfiles';

const MAX_DURATION = 15;

export default function VideoProfileRecorderScreen() {
  const router    = useRouter();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const isMounted = useRef(true);
  useEffect(() => { return () => { isMounted.current = false; }; }, []);

  const [isRecording,       setIsRecording]       = useState(false);
  const [recordingTime,     setRecordingTime]      = useState(0);
  const [recordedVideoUri,  setRecordedVideoUri]   = useState<string | null>(null);
  const [uploading,         setUploading]          = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const videoPlayer = useVideoPlayer(recordedVideoUri ?? '', (player) => {
    player.loop = true;
  });

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!recordedVideoUri) return;
    try {
      videoPlayer.play();
    } catch (err: unknown) {
      logger.warn('[VideoRecorder] play error:', err);
    }
  }, [recordedVideoUri, videoPlayer]);

  const uploadButtonStyle = useMemo(
    () => [styles.uploadButton, uploading && styles.uploadButtonDisabled],
    [uploading],
  );

  const startRecording = useCallback(async () => {
    if (!cameraRef.current) return;
    try {
      setIsRecording(true);
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => {
          if (prev >= MAX_DURATION) {
            if (timerRef.current) {
              clearInterval(timerRef.current);
              timerRef.current = null;
            }
            setIsRecording(false);
            try {
              cameraRef.current?.stopRecording();
            } catch (err: unknown) {
              logger.warn('[VideoRecorder] stopRecording error during auto-stop:', err);
            }
            return MAX_DURATION;
          }
          return prev + 1;
        });
      }, 1000);

      const video = await cameraRef.current.recordAsync({
        maxDuration: MAX_DURATION,
      });

      if (video?.uri) {
        setRecordedVideoUri(video.uri);
      }
    } catch (error: unknown) {
      logger.error('[VideoRecorder] Error recording video:', error);
      Alert.alert('Error', 'Failed to record video');
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, []);

  const stopRecording = useCallback(async () => {
    if (!cameraRef.current) return;
    try {
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      await cameraRef.current.stopRecording();
    } catch (error: unknown) {
      logger.error('[VideoRecorder] Error stopping recording:', error);
    }
  }, []);

  const retakeVideo = useCallback(() => {
    setRecordedVideoUri(null);
    setRecordingTime(0);
  }, []);

  const uploadVideo = useCallback(async () => {
    if (!recordedVideoUri) return;
    const safety = await checkImageSafety(recordedVideoUri);
    if (!safety.safe) {
      Alert.alert('Content Not Allowed', safety.reason);
      return;
    }
    setUploading(true);
    const result = await uploadVideoProfile(recordedVideoUri);
    if (isMounted.current) setUploading(false);
    if (result.success) {
      Alert.alert('Success', '✅ Video uploaded!\n\nYour video profile is now live.');
      router.back();
    } else {
      Alert.alert('Upload Failed', '❌ ' + result.error);
    }
  }, [recordedVideoUri, router]);

  const handleGoBack = useCallback(() => router.back(), [router]);

  if (!permission) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#53a8b6" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.permissionText}>Camera permission required</Text>
        <TouchableOpacity
          style={styles.permissionButton}
          onPress={requestPermission}
          accessibilityRole="button"
          accessibilityLabel="Grant camera permission"
        >
          <Text style={styles.permissionButtonText}>Grant Permission</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.backButtonBottom}
          onPress={handleGoBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backButtonBottomText}>← Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleGoBack}
          accessibilityRole="button"
          accessibilityLabel="Cancel recording"
        >
          <Text style={styles.headerBack}>← Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Record Video Profile</Text>
        <View style={styles.headerSpacer} />
      </View>

      {!recordedVideoUri && !isRecording && (
        <View style={styles.instructions}>
          <Text style={styles.instructionsTitle}>📹 Tips for a great video:</Text>
          <Text style={styles.instructionsText}>
            • Be yourself and smile{'\n'}
            • Good lighting (face the light){'\n'}
            • Say what you're looking for{'\n'}
            • Max {MAX_DURATION} seconds{'\n'}
            • No inappropriate content
          </Text>
        </View>
      )}

      <View style={styles.cameraContainer}>
        {recordedVideoUri ? (
          <VideoView
            player={videoPlayer}
            style={styles.videoPreview}
            contentFit="contain"
            nativeControls
          />
        ) : (
          <CameraView ref={cameraRef} style={styles.camera} facing="front" mode="video" />
        )}

        {isRecording && (
          <View style={styles.recordingIndicator}>
            <View style={styles.recordingDot} />
            <Text style={styles.recordingText}>
              {recordingTime}s / {MAX_DURATION}s
            </Text>
          </View>
        )}
      </View>

      {recordedVideoUri ? (
        <View style={styles.controls}>
          <TouchableOpacity
            style={styles.retakeButton}
            onPress={retakeVideo}
            disabled={uploading}
            accessibilityRole="button"
            accessibilityLabel="Retake video"
          >
            <Text style={styles.retakeButtonText}>🔄 Retake</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={uploadButtonStyle}
            onPress={uploadVideo}
            disabled={uploading}
            accessibilityRole="button"
            accessibilityLabel="Upload video"
          >
            {uploading
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.uploadButtonText}>✓ Upload</Text>}
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.controls}>
          {!isRecording ? (
            <TouchableOpacity
              style={styles.recordButton}
              onPress={startRecording}
              accessibilityRole="button"
              accessibilityLabel="Start recording"
            >
              <View style={styles.recordButtonInner} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.stopButton}
              onPress={stopRecording}
              accessibilityRole="button"
              accessibilityLabel="Stop recording"
            >
              <View style={styles.stopButtonInner} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {!recordedVideoUri && !isRecording && (
        <Text style={styles.hint}>Tap the red button to start recording</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:            { flex: 1, backgroundColor: '#000' },
  centerContainer:      { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  header:               { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: 'rgba(0,0,0,0.6)' },
  headerBack:           { color: '#fff', fontSize: 16 },
  headerTitle:          { color: '#fff', fontSize: 16, fontWeight: '600' },
  headerSpacer:         { width: 60 },
  instructions:         { padding: 16, backgroundColor: 'rgba(0,0,0,0.5)' },
  instructionsTitle:    { color: '#fff', fontSize: 15, fontWeight: '600', marginBottom: 8 },
  instructionsText:     { color: '#ccc', fontSize: 14, lineHeight: 22 },
  cameraContainer:      { flex: 1, position: 'relative' },
  camera:               { flex: 1 },
  videoPreview:         { flex: 1 },
  recordingIndicator:   { position: 'absolute', top: 16, left: 16, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  recordingDot:         { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ff3b30' },
  recordingText:        { color: '#fff', fontSize: 14, fontWeight: '600' },
  controls:             { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 24, gap: 24, backgroundColor: 'rgba(0,0,0,0.6)' },
  recordButton:         { width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  recordButtonInner:    { width: 54, height: 54, borderRadius: 27, backgroundColor: '#ff3b30' },
  stopButton:           { width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  stopButtonInner:      { width: 30, height: 30, borderRadius: 4, backgroundColor: '#ff3b30' },
  retakeButton:         { paddingVertical: 14, paddingHorizontal: 28, borderRadius: 12, borderWidth: 1.5, borderColor: '#fff' },
  retakeButtonText:     { color: '#fff', fontSize: 15, fontWeight: '600' },
  uploadButton:         { paddingVertical: 14, paddingHorizontal: 28, borderRadius: 12, backgroundColor: '#53a8b6', alignItems: 'center', justifyContent: 'center', minWidth: 100 },
  uploadButtonDisabled: { opacity: 0.5 },
  uploadButtonText:     { color: '#fff', fontSize: 15, fontWeight: '700' },
  hint:                 { color: '#aaa', fontSize: 13, textAlign: 'center', paddingBottom: 12, backgroundColor: 'rgba(0,0,0,0.6)', paddingTop: 8 },
  permissionText:       { color: '#fff', fontSize: 16, marginBottom: 20, textAlign: 'center' },
  permissionButton:     { paddingVertical: 14, paddingHorizontal: 28, borderRadius: 12, backgroundColor: '#53a8b6', marginBottom: 12 },
  permissionButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  backButtonBottom:     { paddingVertical: 12, paddingHorizontal: 24 },
  backButtonBottomText: { color: '#aaa', fontSize: 15 },
});
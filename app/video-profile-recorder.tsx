import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
// ✅ FIX: Import NSFW check
import { checkImageSafety } from '../utils/moderation';
import { uploadVideoProfile } from '../utils/videoProfiles';
import { logger } from '../utils/logger';

const MAX_DURATION = 15;

export default function VideoProfileRecorderScreen() {
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordedVideoUri, setRecordedVideoUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // expo-video player for preview
  const videoPlayer = useVideoPlayer(recordedVideoUri || '', (player) => {
    player.loop = true;
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  // Auto-play preview when video is recorded
  useEffect(() => {
    if (recordedVideoUri) {
      try {
        videoPlayer.play();
      } catch {}
    }
  }, [recordedVideoUri, videoPlayer]);

  const startRecording = useCallback(async () => {
    if (!cameraRef.current) return;

    try {
      setIsRecording(true);
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => {
          if (prev >= MAX_DURATION) {
            // Auto-stop at max duration
            if (timerRef.current) {
              clearInterval(timerRef.current);
              timerRef.current = null;
            }
            setIsRecording(false);
            try {
              cameraRef.current?.stopRecording();
            } catch {}
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
    } catch (error) {
      logger.error('Error recording video:', error);
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
    } catch (error) {
      logger.error('Error stopping recording:', error);
    }
  }, []);

  const retakeVideo = useCallback(() => {
    setRecordedVideoUri(null);
    setRecordingTime(0);
  }, []);

  // ✅ FIX: Added NSFW check before upload
  const uploadVideo = useCallback(async () => {
    if (!recordedVideoUri) return;

    // NSFW check on video before upload
    // On native, checkImageSafety handles video URIs via Cloudinary fallback
    const safety = await checkImageSafety(recordedVideoUri);
    if (!safety.safe) {
      Alert.alert('Content Not Allowed', safety.reason);
      return;
    }

    setUploading(true);
    const result = await uploadVideoProfile(recordedVideoUri);
    setUploading(false);

    if (result.success) {
      Alert.alert('Success', '✅ Video uploaded!\n\nYour video profile is now live.');
      router.back();
    } else {
      Alert.alert('Upload Failed', '❌ ' + result.error);
    }
  }, [recordedVideoUri, router]);

  // Permission loading
  if (!permission) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#53a8b6" />
      </View>
    );
  }

  // Permission denied
  if (!permission.granted) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.permissionText}>Camera permission required</Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>Grant Permission</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backButtonBottom} onPress={() => router.back()}>
          <Text style={styles.backButtonBottomText}>← Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.headerBack}>← Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Record Video Profile</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Instructions */}
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

      {/* Camera or Preview */}
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

        {/* Recording timer overlay */}
        {isRecording && (
          <View style={styles.recordingIndicator}>
            <View style={styles.recordingDot} />
            <Text style={styles.recordingText}>
              {recordingTime}s / {MAX_DURATION}s
            </Text>
          </View>
        )}
      </View>

      {/* Controls */}
      {recordedVideoUri ? (
        <View style={styles.controls}>
          <TouchableOpacity
            style={styles.retakeButton}
            onPress={retakeVideo}
            disabled={uploading}
          >
            <Text style={styles.retakeButtonText}>🔄 Retake</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.uploadButton, uploading && styles.uploadButtonDisabled]}
            onPress={uploadVideo}
            disabled={uploading}
          >
            {uploading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.uploadButtonText}>✓ Upload</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.controls}>
          {!isRecording ? (
            <TouchableOpacity style={styles.recordButton} onPress={startRecording}>
              <View style={styles.recordButtonInner} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.stopButton} onPress={stopRecording}>
              <View style={styles.stopButtonInner} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Bottom hint */}
      {!recordedVideoUri && !isRecording && (
        <Text style={styles.hint}>Tap the red button to start recording</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  centerContainer: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 50,
    backgroundColor: '#16213e',
  },
  headerBack: {
    color: '#d9534f',
    fontSize: 16,
  },
  headerTitle: {
    color: '#eee',
    fontSize: 18,
    fontWeight: 'bold',
  },
  headerSpacer: {
    width: 70,
  },
  instructions: {
    backgroundColor: '#16213e',
    margin: 20,
    padding: 15,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#53a8b6',
  },
  instructionsTitle: {
    color: '#53a8b6',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  instructionsText: {
    color: '#aaa',
    fontSize: 14,
    lineHeight: 22,
  },
  cameraContainer: {
    flex: 1,
    margin: 20,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#000',
    position: 'relative',
  },
  camera: {
    flex: 1,
  },
  videoPreview: {
    flex: 1,
  },
  recordingIndicator: {
    position: 'absolute',
    top: 20,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  recordingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#d9534f',
  },
  recordingText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
    gap: 20,
  },
  recordButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#d9534f',
  },
  recordButtonInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#d9534f',
  },
  stopButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#d9534f',
  },
  stopButtonInner: {
    width: 30,
    height: 30,
    backgroundColor: '#d9534f',
    borderRadius: 4,
  },
  retakeButton: {
    backgroundColor: '#e67e22',
    paddingVertical: 16,
    paddingHorizontal: 30,
    borderRadius: 25,
  },
  retakeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  uploadButton: {
    backgroundColor: '#5cb85c',
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 25,
    minWidth: 120,
    alignItems: 'center',
  },
  uploadButtonDisabled: {
    backgroundColor: '#555',
  },
  uploadButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  hint: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
  },
  permissionText: {
    color: '#eee',
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 20,
  },
  permissionButton: {
    backgroundColor: '#53a8b6',
    paddingVertical: 15,
    paddingHorizontal: 40,
    borderRadius: 25,
  },
  permissionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  backButtonBottom: {
    marginTop: 20,
  },
  backButtonBottomText: {
    color: '#888',
    fontSize: 16,
  },
});
import { observable } from '@legendapp/state';
import { observer } from '@legendapp/state/react';
import { Audio, AudioModule, RecordingPresets, useAudioRecorder } from 'expo-audio';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { logger } from '../utils/logger';
import {
  deleteVoiceIntro,
  formatVoiceDuration,
  getVoiceIntro,
  MAX_VOICE_INTRO_DURATION,
  uploadVoiceIntro,
  VoiceIntro,
} from '../utils/voiceIntro';

interface PlaybackSound {
  unloadAsync: () => Promise<void>;
  playing: boolean;
  setOnPlaybackStatusUpdate: (cb: (status: { isLoaded: boolean; didJustFinish: boolean }) => void) => void;
}

const screen$ = observable({
  loading:           true,
  uploading:         false,
  deleting:          false,
  existingIntro:     null as VoiceIntro | null,
  isRecording:       false,
  recordingDuration: 0,
  recordedUri:       null as string | null,
  waitingForUri:     false,
  isPlaying:         false,
});

export default observer(function VoiceIntroRecorderScreen() {
  const router = useRouter();

  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playbackSoundRef  = useRef<PlaybackSound | null>(null);
  const audioRecorder     = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const loading           = screen$.loading.get();
  const uploading         = screen$.uploading.get();
  const deleting          = screen$.deleting.get();
  const existingIntro     = screen$.existingIntro.get();
  const isRecording       = screen$.isRecording.get();
  const recordingDuration = screen$.recordingDuration.get();
  const recordedUri       = screen$.recordedUri.get();
  const isPlaying         = screen$.isPlaying.get();

  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const loadExistingIntro = useCallback(async () => {
    const intro = await getVoiceIntro();
    screen$.existingIntro.set(intro);
    screen$.loading.set(false);
  }, []);

  useEffect(() => {
    void loadExistingIntro();
    void AudioModule.requestRecordingPermissionsAsync().catch(
      (err: unknown) => { logger.warn('[VoiceIntro] permission request failed:', err); },
    );
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (playbackSoundRef.current) {
        playbackSoundRef.current.unloadAsync().catch(
          (err: unknown) => { logger.warn('[VoiceIntro] unload failed:', err); },
        );
      }
    };
  }, [loadExistingIntro]);

  useEffect(() => {
    if (screen$.waitingForUri.get() && audioRecorder.uri) {
      screen$.waitingForUri.set(false);
      screen$.recordedUri.set(audioRecorder.uri);
    }
  }, [audioRecorder.uri]);

  useEffect(() => {
    if (!isPlaying || !playbackSoundRef.current) return;
    const check = setInterval(() => {
      try {
        if (!playbackSoundRef.current?.playing) screen$.isPlaying.set(false);
      } catch (err: unknown) {
        logger.warn('[VoiceIntro] playback check error:', err);
        screen$.isPlaying.set(false);
      }
    }, 500);
    return () => clearInterval(check);
  }, [isPlaying]);

  const timerFillStyle = useMemo(
    () => [s.timerFill, { width: `${(recordingDuration / MAX_VOICE_INTRO_DURATION) * 100}%` as `${number}%` }],
    [recordingDuration],
  );

  const saveButtonStyle = useMemo(
    () => [s.saveButton, uploading && s.saveButtonDisabled],
    [uploading],
  );

  const startRecording = useCallback(async () => {
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission Required', 'Microphone permission is required');
        return;
      }
      audioRecorder.record();
      screen$.isRecording.set(true);
      screen$.recordingDuration.set(0);
      screen$.recordedUri.set(null);
      recordingTimerRef.current = setInterval(() => {
        const prev = screen$.recordingDuration.get();
        if (prev >= MAX_VOICE_INTRO_DURATION) {
          if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
          }
          screen$.isRecording.set(false);
          try {
            audioRecorder.stop();
          } catch (err: unknown) {
            logger.warn('[VoiceIntro] stop error during auto-stop:', err);
          }
          screen$.waitingForUri.set(true);
          return;
        }
        screen$.recordingDuration.set(prev + 1);
      }, 1000);
    } catch (error: unknown) {
      logger.error('Failed to start recording:', error);
      Alert.alert('Error', 'Could not start recording');
    }
  }, [audioRecorder]);

  const stopRecording = useCallback(() => {
    if (!screen$.isRecording.get()) return;
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    screen$.isRecording.set(false);
    audioRecorder.stop();
    screen$.waitingForUri.set(true);
  }, [audioRecorder]);

  const cancelRecording = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    screen$.isRecording.set(false);
    screen$.recordingDuration.set(0);
    screen$.waitingForUri.set(false);
    try {
      audioRecorder.stop();
    } catch (err: unknown) {
      logger.warn('[VoiceIntro] stop error during cancel:', err);
    }
  }, [audioRecorder]);

  const playPreview = useCallback(async () => {
    const uri = screen$.recordedUri.get() ?? screen$.existingIntro.get()?.url;
    if (!uri) return;
    try {
      if (playbackSoundRef.current) {
        await playbackSoundRef.current.unloadAsync().catch(
          (err: unknown) => { logger.warn('[VoiceIntro] unload error:', err); },
        );
        playbackSoundRef.current = null;
      }
      if (screen$.isPlaying.get()) { screen$.isPlaying.set(false); return; }
      const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
      const typedSound = sound as unknown as PlaybackSound;
      playbackSoundRef.current = typedSound;
      screen$.isPlaying.set(true);
      typedSound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          screen$.isPlaying.set(false);
          playbackSoundRef.current = null;
        }
      });
    } catch (error: unknown) {
      logger.error('Error playing preview:', error);
      screen$.isPlaying.set(false);
    }
  }, []);

  const handleUpload = useCallback(async () => {
    const uri      = screen$.recordedUri.get();
    const duration = screen$.recordingDuration.get();
    if (!uri) return;
    screen$.uploading.set(true);
    const result = await uploadVoiceIntro(uri, duration);
    screen$.uploading.set(false);
    if (result.success) { Alert.alert('Success', 'Voice intro saved!'); router.back(); }
    else Alert.alert('Error', result.error ?? 'Upload failed');
  }, [router]);

  const handleDelete = useCallback(() => {
    Alert.alert('Delete Voice Intro', 'Delete your voice intro?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        screen$.deleting.set(true);
        const result = await deleteVoiceIntro();
        screen$.deleting.set(false);
        if (result.success) {
          screen$.existingIntro.set(null);
          Alert.alert('Deleted', 'Voice intro deleted');
        }
      }},
    ]);
  }, []);

  const discardRecording = useCallback(() => {
    screen$.recordedUri.set(null);
    screen$.recordingDuration.set(0);
  }, []);

  const handleGoBack = useCallback(() => router.back(), [router]);

  if (loading) return (
    <View style={s.centerContainer}>
      <ActivityIndicator size="large" color="#53a8b6" />
    </View>
  );

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity
          onPress={handleGoBack}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Text style={s.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>🎤 Voice Intro</Text>
        <View style={s.headerSpacer} />
      </View>

      <View style={s.content}>
        <Text style={s.subtitle}>Record a {MAX_VOICE_INTRO_DURATION}-second intro to let matches hear your voice!</Text>

        {existingIntro && !recordedUri && !isRecording && (
          <View style={s.existingContainer}>
            <Text style={s.existingLabel}>Current Voice Intro</Text>
            <Text style={s.existingDuration}>{formatVoiceDuration(existingIntro.duration)}</Text>
            <View style={s.existingButtons}>
              <TouchableOpacity
                style={s.playButton}
                onPress={playPreview}
                accessibilityLabel={isPlaying ? 'Pause' : 'Play voice intro'}
                accessibilityRole="button"
              >
                <Text style={s.playButtonText}>{isPlaying ? '⏸ Pause' : '▶️ Play'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.deleteButton}
                onPress={handleDelete}
                disabled={deleting}
                accessibilityLabel="Delete voice intro"
                accessibilityRole="button"
              >
                <Text style={s.deleteButtonText}>{deleting ? '...' : '🗑️ Delete'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {isRecording && (
          <View style={s.recordingContainer}>
            <View style={s.recordingIndicator}>
              <View style={s.recordingDot} />
              <Text style={s.recordingText}>Recording...</Text>
            </View>
            <Text style={s.timer}>{formatVoiceDuration(recordingDuration)} / {formatVoiceDuration(MAX_VOICE_INTRO_DURATION)}</Text>
            <View style={s.timerBar}>
              <View style={timerFillStyle} />
            </View>
            <View style={s.recordingButtons}>
              <TouchableOpacity
                style={s.cancelButton}
                onPress={cancelRecording}
                accessibilityLabel="Cancel recording"
                accessibilityRole="button"
              >
                <Text style={s.cancelButtonText}>✕ Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.stopRecordButton}
                onPress={stopRecording}
                accessibilityLabel="Stop recording"
                accessibilityRole="button"
              >
                <Text style={s.stopRecordButtonText}>⏹ Stop</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {recordedUri && !isRecording && (
          <View style={s.previewContainer}>
            <Text style={s.previewLabel}>Preview Recording</Text>
            <Text style={s.previewDuration}>{formatVoiceDuration(recordingDuration)}</Text>
            <TouchableOpacity
              style={s.playButton}
              onPress={playPreview}
              accessibilityLabel={isPlaying ? 'Pause' : 'Play recording'}
              accessibilityRole="button"
            >
              <Text style={s.playButtonText}>{isPlaying ? '⏸ Pause' : '▶️ Play'}</Text>
            </TouchableOpacity>
            <View style={s.previewButtons}>
              <TouchableOpacity
                style={s.discardButton}
                onPress={discardRecording}
                accessibilityLabel="Re-record"
                accessibilityRole="button"
              >
                <Text style={s.discardButtonText}>Re-record</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={saveButtonStyle}
                onPress={handleUpload}
                disabled={uploading}
                accessibilityLabel="Save voice intro"
                accessibilityRole="button"
              >
                <Text style={s.saveButtonText}>{uploading ? 'Saving...' : '✓ Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {!isRecording && !recordedUri && (
          <TouchableOpacity
            style={s.startRecordButton}
            onPress={startRecording}
            accessibilityLabel={existingIntro ? 'Record new intro' : 'Start recording'}
            accessibilityRole="button"
          >
            <View style={s.micIcon}><Text style={s.micIconText}>🎤</Text></View>
            <Text style={s.startRecordText}>{existingIntro ? 'Record New Intro' : 'Start Recording'}</Text>
          </TouchableOpacity>
        )}

        <View style={s.tipsContainer}>
          <Text style={s.tipsTitle}>💡 Tips</Text>
          <Text style={s.tipText}>• Introduce yourself naturally</Text>
          <Text style={s.tipText}>• Mention something interesting about you</Text>
          <Text style={s.tipText}>• Be yourself - authenticity wins!</Text>
          <Text style={s.tipText}>• Record in a quiet environment</Text>
        </View>
      </View>
    </View>
  );
});

const s = StyleSheet.create((theme) => ({
  container:            { flex: 1, backgroundColor: theme.colors.background },
  centerContainer:      { flex: 1, backgroundColor: theme.colors.background, justifyContent: 'center', alignItems: 'center' },
  header:               { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 60, backgroundColor: '#16213e' },
  backButton:           { color: theme.colors.primary, fontSize: 16 },
  title:                { fontSize: 20, fontWeight: 'bold', color: theme.colors.text },
  headerSpacer:         { width: 50 },
  content:              { flex: 1, padding: 20 },
  subtitle:             { color: theme.colors.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 30, lineHeight: 22 },
  existingContainer:    { backgroundColor: '#16213e', borderRadius: 15, padding: 20, alignItems: 'center', marginBottom: 30 },
  existingLabel:        { color: '#5cb85c', fontSize: 14, fontWeight: '600' },
  existingDuration:     { color: theme.colors.text, fontSize: 24, fontWeight: 'bold', marginTop: 10 },
  existingButtons:      { flexDirection: 'row', gap: 15, marginTop: 20 },
  playButton:           { backgroundColor: '#53a8b6', paddingVertical: 12, paddingHorizontal: 25, borderRadius: 20 },
  playButtonText:       { color: '#fff', fontSize: 16, fontWeight: '600' },
  deleteButton:         { backgroundColor: '#d9534f', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 20 },
  deleteButtonText:     { color: '#fff', fontSize: 14, fontWeight: '600' },
  recordingContainer:   { backgroundColor: '#16213e', borderRadius: 15, padding: 25, alignItems: 'center', marginBottom: 30 },
  recordingIndicator:   { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 },
  recordingDot:         { width: 12, height: 12, borderRadius: 6, backgroundColor: '#d9534f' },
  recordingText:        { color: '#d9534f', fontSize: 16, fontWeight: '600' },
  timer:                { color: theme.colors.text, fontSize: 32, fontWeight: 'bold', marginBottom: 15 },
  timerBar:             { width: '100%', height: 8, backgroundColor: '#0f3460', borderRadius: 4, marginBottom: 25 },
  timerFill:            { height: '100%', backgroundColor: '#e67e22', borderRadius: 4 },
  recordingButtons:     { flexDirection: 'row', gap: 20 },
  cancelButton:         { backgroundColor: '#0f3460', paddingVertical: 12, paddingHorizontal: 25, borderRadius: 20 },
  cancelButtonText:     { color: theme.colors.textSecondary, fontSize: 16, fontWeight: '600' },
  stopRecordButton:     { backgroundColor: '#d9534f', paddingVertical: 12, paddingHorizontal: 30, borderRadius: 20 },
  stopRecordButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  previewContainer:     { backgroundColor: '#16213e', borderRadius: 15, padding: 25, alignItems: 'center', marginBottom: 30 },
  previewLabel:         { color: '#e67e22', fontSize: 14, fontWeight: '600' },
  previewDuration:      { color: theme.colors.text, fontSize: 28, fontWeight: 'bold', marginVertical: 15 },
  previewButtons:       { flexDirection: 'row', gap: 15, marginTop: 20 },
  discardButton:        { backgroundColor: '#0f3460', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 20 },
  discardButtonText:    { color: theme.colors.textSecondary, fontSize: 14, fontWeight: '600' },
  saveButton:           { backgroundColor: '#5cb85c', paddingVertical: 12, paddingHorizontal: 30, borderRadius: 20 },
  saveButtonDisabled:   { backgroundColor: '#555' },
  saveButtonText:       { color: '#fff', fontSize: 16, fontWeight: '600' },
  startRecordButton:    { backgroundColor: '#e67e22', borderRadius: 20, padding: 30, alignItems: 'center', marginBottom: 30 },
  micIcon:              { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center', marginBottom: 15 },
  micIconText:          { fontSize: 40 },
  startRecordText:      { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  tipsContainer:        { backgroundColor: '#16213e', borderRadius: 15, padding: 20 },
  tipsTitle:            { color: '#53a8b6', fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  tipText:              { color: theme.colors.textSecondary, fontSize: 14, marginBottom: 6 },
}));
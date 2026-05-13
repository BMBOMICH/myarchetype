import React from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { styles } from './styles';

interface InputBarProps {
  inputText: string;
  sending: boolean;
  uploadingMedia: boolean;
  recordingAudio: boolean;
  recordingDuration: number;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onPickImage: () => void;
  onTakePhoto: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
}

export const InputBar = React.memo(({
  inputText, sending, uploadingMedia, recordingAudio, recordingDuration,
  onChangeText, onSend, onPickImage, onTakePhoto, onStartRecording, onStopRecording,
}: InputBarProps) => {
  return (
    <>
      {uploadingMedia && (
        <View style={styles.uploadingBar}>
          <ActivityIndicator size="small" color="#6C63FF" />
          <Text style={styles.uploadingText}>Uploading media…</Text>
        </View>
      )}
      <View style={styles.inputBar}>
        <Pressable onPress={onPickImage} style={styles.inputAction} hitSlop={8} accessibilityRole="button" accessibilityLabel="Attach image">
          <Ionicons name="image-outline" size={22} color="#6C63FF" />
        </Pressable>
        <Pressable onPress={onTakePhoto} style={styles.inputAction} hitSlop={8} accessibilityRole="button" accessibilityLabel="Take photo">
          <Ionicons name="camera-outline" size={22} color="#6C63FF" />
        </Pressable>
        <View style={styles.inputWrap}>
          <TextInput
            style={styles.inputField}
            value={inputText}
            onChangeText={onChangeText}
            placeholder="Type a message…"
            placeholderTextColor="#64648a"
            multiline
            maxLength={2000}
            editable={!sending && !uploadingMedia}
            onSubmitEditing={onSend}
            returnKeyType="send"
            blurOnSubmit={false}
            accessibilityLabel="Message input"
          />
          {inputText.length > 1800 && <Text style={styles.charCount}>{inputText.length}/2000</Text>}
        </View>
        {recordingAudio ? (
          <View style={styles.recordingWrap}>
            <Text style={styles.recordingTimer}>{Math.floor(recordingDuration / 60)}:{String(recordingDuration % 60).padStart(2, '0')}</Text>
            <Pressable onPress={onStopRecording} style={styles.recordingStop} accessibilityRole="button" accessibilityLabel="Stop recording">
              <Ionicons name="stop-circle" size={28} color="#FF6B6B" />
            </Pressable>
          </View>
        ) : !inputText.trim() ? (
          <Pressable onPress={onStartRecording} style={styles.inputAction} hitSlop={8} accessibilityRole="button" accessibilityLabel="Record voice message">
            <Ionicons name="mic-outline" size={22} color="#6C63FF" />
          </Pressable>
        ) : (
          <Pressable
            onPress={onSend}
            style={[styles.sendBtn, (!inputText.trim() || sending) && styles.sendBtnDisabled]}
            disabled={!inputText.trim() || sending}
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            {sending ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="send" size={18} color="#fff" />}
          </Pressable>
        )}
      </View>
    </>
  );
});
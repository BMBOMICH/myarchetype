import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TurboImage from '../TurboImage';
import { EMOJI_REACTIONS } from './constants';
import { styles } from './styles';
import type { Message } from './types';

interface ChatModalsProps {
  core: {
    showOptions: boolean;
    selectedMessageId: string | null;
    showReactionPicker: boolean;
    showReport: boolean;
    reportReason: string;
    submittingReport: boolean;
    showNote: boolean;
    noteText: string;
    savingNote: boolean;
    showPinned: boolean;
    showVideoPrompt: boolean;
    showDateIdeas: boolean;
    loadingDateIdeas: boolean;
    dateIdeas: { text: string; vibe: string }[];
    previewImage: string | null;
    messages: Message[];
    disappearingEnabled: boolean;
  };
  matchName: string;
  formatTime: (d: Date | null) => string;
  onCloseOptions: () => void;
  onPinSelected: () => void;
  onOpenReaction: () => void;
  onOpenReport: () => void;
  onCloseReaction: () => void;
  onCloseReport: () => void;
  onCancelReport: () => void;
  onSubmitReport: () => void;
  onReportReasonChange: (t: string) => void;
  onCloseNote: () => void;
  onSaveNote: () => void;
  onNoteTextChange: (t: string) => void;
  onClosePinned: () => void;
  onCloseVideo: () => void;
  onCloseDateIdeas: () => void;
  onClosePreview: () => void;
  onReaction: (emoji: string) => void;
  onUseDateIdea: (text: string) => void;
  onShuffleDateIdeas: () => void;
}

export const ChatModals = React.memo(({
  core,
  matchName,
  formatTime,
  onCloseOptions,
  onPinSelected,
  onOpenReaction,
  onOpenReport,
  onCloseReaction,
  onCloseReport,
  onCancelReport,
  onSubmitReport,
  onReportReasonChange,
  onCloseNote,
  onSaveNote,
  onNoteTextChange,
  onClosePinned,
  onCloseVideo,
  onCloseDateIdeas,
  onClosePreview,
  onReaction,
  onUseDateIdea,
  onShuffleDateIdeas,
}: ChatModalsProps) => {
  return (
    <>
      {/* ── Options Modal ── */}
      <Modal
        visible={core.showOptions}
        transparent
        animationType="fade"
        onRequestClose={onCloseOptions}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={onCloseOptions}
          accessibilityLabel="Close options"
          accessibilityRole="button"
        >
          <View style={styles.optionsCard}>
            {core.selectedMessageId && (
              <>
                <Pressable
                  style={styles.optionItem}
                  onPress={onPinSelected}
                  accessibilityLabel="Pin message"
                  accessibilityRole="button"
                >
                  <Ionicons name="pin-outline" size={18} color="#9494B8" />
                  <Text style={styles.optionText}>Pin Message</Text>
                </Pressable>

                <Pressable
                  style={styles.optionItem}
                  onPress={onOpenReaction}
                  accessibilityLabel="React to message"
                  accessibilityRole="button"
                >
                  <Ionicons name="happy-outline" size={18} color="#9494B8" />
                  <Text style={styles.optionText}>React</Text>
                </Pressable>

                <Pressable
                  style={styles.optionItem}
                  onPress={onOpenReport}
                  accessibilityLabel="Report message"
                  accessibilityRole="button"
                >
                  <Ionicons name="flag-outline" size={18} color="#FF6B6B" />
                  <Text style={[styles.optionText, styles.optionTextDanger]}>
                    Report
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        </Pressable>
      </Modal>

      {/* ── Reaction Picker Modal ── */}
      <Modal
        visible={core.showReactionPicker}
        transparent
        animationType="fade"
        onRequestClose={onCloseReaction}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={onCloseReaction}
          accessibilityLabel="Close reaction picker"
          accessibilityRole="button"
        >
          <View style={styles.reactionPickerCard}>
            {EMOJI_REACTIONS.map((emoji) => (
              <Pressable
                key={emoji}
                onPress={() => onReaction(emoji)}
                style={styles.reactionPickItem}
                accessibilityLabel={`React with ${emoji}`}
                accessibilityRole="button"
              >
                <Text style={styles.reactionPickEmoji}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* ── Report Modal ── */}
      <Modal
        visible={core.showReport}
        transparent
        animationType="slide"
        onRequestClose={onCloseReport}
      >
        <View style={styles.reportModal}>
          <View style={styles.reportCard}>
            <Text style={styles.reportTitle}>Report Message</Text>
            <TextInput
              style={styles.reportInput}
              value={core.reportReason}
              onChangeText={onReportReasonChange}
              placeholder="Describe the issue…"
              placeholderTextColor="#64648a"
              multiline
              maxLength={500}
              autoFocus
              accessibilityLabel="Report reason input"
            />
            <View style={styles.reportBtns}>
              <Pressable
                style={styles.reportCancel}
                onPress={onCancelReport}
                accessibilityLabel="Cancel report"
                accessibilityRole="button"
              >
                <Text style={styles.reportCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.reportSubmit,
                  (!core.reportReason.trim() || core.submittingReport) &&
                    styles.reportSubmitDisabled,
                ]}
                onPress={onSubmitReport}
                disabled={!core.reportReason.trim() || core.submittingReport}
                accessibilityLabel="Submit report"
                accessibilityRole="button"
              >
                {core.submittingReport
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.reportSubmitText}>Submit</Text>
                }
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Note Modal ── */}
      <Modal
        visible={core.showNote}
        transparent
        animationType="slide"
        onRequestClose={onCloseNote}
      >
        <View style={styles.noteModal}>
          <View style={styles.noteCard}>
            <Text style={styles.noteTitle}>Shared Notes</Text>
            <TextInput
              style={styles.noteInput}
              value={core.noteText}
              onChangeText={onNoteTextChange}
              placeholder="Write notes together…"
              placeholderTextColor="#64648a"
              multiline
              maxLength={500}
              autoFocus
              accessibilityLabel="Note input"
            />
            <Text style={styles.noteCount}>{core.noteText.length}/500</Text>
            <View style={styles.noteBtns}>
              <Pressable
                style={styles.noteCancel}
                onPress={onCloseNote}
                accessibilityLabel="Cancel note"
                accessibilityRole="button"
              >
                <Text style={styles.noteCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.noteSave,
                  core.savingNote && styles.noteSaveDisabled,
                ]}
                onPress={onSaveNote}
                disabled={core.savingNote}
                accessibilityLabel="Save note"
                accessibilityRole="button"
              >
                {core.savingNote
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.noteSaveText}>Save</Text>
                }
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Pinned Messages Modal ── */}
      <Modal
        visible={core.showPinned}
        transparent
        animationType="slide"
        onRequestClose={onClosePinned}
      >
        <View style={styles.pinnedModal}>
          <View style={styles.pinnedCard}>
            <View style={styles.pinnedHeader}>
              <Text style={styles.pinnedTitle}>Pinned Messages</Text>
              <Pressable
                onPress={onClosePinned}
                hitSlop={12}
                accessibilityLabel="Close pinned messages"
                accessibilityRole="button"
              >
                <Ionicons name="close" size={22} color="#9494B8" />
              </Pressable>
            </View>
            {core.messages.filter((m) => m.pinned).length === 0 ? (
              <Text style={styles.pinnedEmpty}>No pinned messages yet.</Text>
            ) : (
              <ScrollView
                style={styles.pinnedList}
                keyboardShouldPersistTaps="handled"
              >
                {core.messages
                  .filter((m) => m.pinned)
                  .map((m) => (
                    <View key={m.id} style={styles.pinnedItem}>
                      <Text style={styles.pinnedItemText}>
                        {m.text ?? '📎 Media'}
                      </Text>
                      <Text style={styles.pinnedItemTime}>
                        {formatTime(m.timestamp)}
                      </Text>
                    </View>
                  ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Video/Audio Call Prompt Modal ── */}
      <Modal
        visible={core.showVideoPrompt}
        transparent
        animationType="fade"
        onRequestClose={onCloseVideo}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={onCloseVideo}
          accessibilityLabel="Close call prompt"
          accessibilityRole="button"
        >
          <View style={styles.videoPromptCard}>
            <Text style={styles.videoPromptTitle}>Start a call?</Text>
            <Text style={styles.videoPromptSub}>
              Choose call type with {matchName}
            </Text>
            <View style={styles.videoPromptBtns}>
              <Pressable
                style={styles.videoBtn}
                onPress={() => {
                  onCloseVideo();
                  Alert.alert('Coming Soon', 'Video calls will be available soon!');
                }}
                accessibilityLabel="Start video call"
                accessibilityRole="button"
              >
                <Ionicons name="videocam" size={22} color="#6C63FF" />
                <Text style={styles.videoBtnText}>Video</Text>
              </Pressable>
              <Pressable
                style={styles.videoBtn}
                onPress={() => {
                  onCloseVideo();
                  Alert.alert('Coming Soon', 'Audio calls will be available soon!');
                }}
                accessibilityLabel="Start audio call"
                accessibilityRole="button"
              >
                <Ionicons name="call" size={22} color="#6C63FF" />
                <Text style={styles.videoBtnText}>Audio</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* ── Date Ideas Modal ── */}
      <Modal
        visible={core.showDateIdeas}
        transparent
        animationType="slide"
        onRequestClose={onCloseDateIdeas}
      >
        <View style={styles.dateModal}>
          <View style={styles.dateCard}>
            <View style={styles.dateHeader}>
              <Text style={styles.dateTitle}>Date Ideas</Text>
              <Pressable
                onPress={onCloseDateIdeas}
                hitSlop={12}
                accessibilityLabel="Close date ideas"
                accessibilityRole="button"
              >
                <Ionicons name="close" size={22} color="#9494B8" />
              </Pressable>
            </View>
            {core.loadingDateIdeas ? (
              <ActivityIndicator
                size="large"
                color="#6C63FF"
                style={styles.dateLoader}
              />
            ) : (
              <>
                {core.dateIdeas.map((idea) => (
                  <Pressable
                    key={idea.text}
                    style={styles.dateIdeaItem}
                    onPress={() => onUseDateIdea(idea.text)}
                    accessibilityLabel={`Use date idea: ${idea.text}`}
                    accessibilityRole="button"
                  >
                    <Text style={styles.dateIdeaVibe}>{idea.vibe}</Text>
                    <Text style={styles.dateIdeaText}>{idea.text}</Text>
                  </Pressable>
                ))}
                <Pressable
                  style={styles.dateRefreshBtn}
                  onPress={onShuffleDateIdeas}
                  accessibilityLabel="Shuffle date ideas"
                  accessibilityRole="button"
                >
                  <Ionicons name="refresh" size={16} color="#6C63FF" />
                  <Text style={styles.dateRefreshText}>Shuffle</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Image Preview Modal ── */}
      <Modal
        visible={!!core.previewImage}
        transparent
        animationType="fade"
        onRequestClose={onClosePreview}
      >
        <View style={styles.previewModal}>
          <Pressable
            style={styles.previewClose}
            onPress={onClosePreview}
            hitSlop={16}
            accessibilityLabel="Close image preview"
            accessibilityRole="button"
          >
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
          {core.previewImage ? (
            <TurboImage
              source={{ uri: core.previewImage }}
              style={styles.previewImage}
              resizeMode="contain"
              cachePolicy="dataCache"
              accessibilityLabel="Full size image preview"
            />
          ) : null}
        </View>
      </Modal>
    </>
  );
});
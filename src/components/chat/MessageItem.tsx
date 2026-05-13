import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { styles } from './styles';
import type { Message } from './types';

interface MessageItemProps {
  item: Message;
  index: number;
  messages: Message[];
  userId?: string;
  matchPhoto?: string;
  matchName: string;
  formatTime: (d: Date | null) => string;
  formatFullTime: (d: Date | null) => string;
  onLongPress: (id: string) => () => void;
  onOpenPreview: (url: string) => () => void;
}

export const MessageItem = React.memo(({
  item, index, messages, userId, matchPhoto, matchName, formatTime, formatFullTime, onLongPress, onOpenPreview,
}: MessageItemProps) => {
  const isMine = item.senderId === userId;
  const prevMsg = index > 0 ? messages[index - 1] : null;
  const sameSenderAsPrev = prevMsg?.senderId === item.senderId;
  const showDateSeparator = !prevMsg || !prevMsg.timestamp || !item.timestamp
    ? index === 0
    : item.timestamp.getTime() - prevMsg.timestamp.getTime() > 300_000;

  if (item.type === 'system') {
    return (
      <View style={styles.systemMessageWrap}>
        <Text style={styles.systemMessageText}>{item.text}</Text>
      </View>
    );
  }

  return (
    <View>
      {showDateSeparator && item.timestamp && (
        <View style={styles.dateSeparator}>
          <View style={styles.dateSepLine} />
          <Text style={styles.dateSepText}>{formatFullTime(item.timestamp)}</Text>
          <View style={styles.dateSepLine} />
        </View>
      )}
      <Pressable
        onLongPress={onLongPress(item.id)}
        delayLongPress={300}
        style={[styles.messageRow, isMine ? styles.messageRowMine : styles.messageRowTheirs, !sameSenderAsPrev && styles.messageRowSpaced]}
        accessibilityLabel={`Message from ${isMine ? 'you' : matchName}: ${item.text ?? ''}`}
        accessibilityRole="text"
      >
        {!isMine && !sameSenderAsPrev && matchPhoto ? (
          <Image
            source={{ uri: matchPhoto }}
            style={styles.avatarSmall}
            accessibilityLabel={`${matchName}'s avatar`}
          />
        ) : !isMine ? <View style={styles.avatarSmallPlaceholder} /> : null}
        <View style={[styles.bubbleWrap, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
          {item.type === 'text' && <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]} selectable>{item.translatedText ?? item.text ?? ''}</Text>}
          {(item.type === 'image' || item.type === 'gif') && item.mediaUrl && (
            <Pressable onPress={onOpenPreview(item.mediaUrl)} accessibilityLabel={item.type === 'gif' ? 'View full GIF' : 'View full image'} accessibilityRole="button">
              <Image
                source={{ uri: item.mediaUrl }}
                style={styles.imageBubble}
                resizeMode="cover"
              />
              {item.type === 'gif' && <Text style={styles.gifLabel}>GIF</Text>}
            </Pressable>
          )}
          {item.type === 'voice' && (
            <View style={styles.voiceRow}>
              <Ionicons name="play-circle" size={28} color={isMine ? '#fff' : '#6C63FF'} />
              <View style={styles.voiceWaveWrap}>
                {(item.voiceWaveform ?? Array.from({ length: 20 }, () => Math.random())).map((v, i) => (
                  <View key={`${item.id}-bar-${i}`} style={[styles.voiceBar, { height: Math.max(4, (v ?? 0.3) * 24), backgroundColor: isMine ? 'rgba(255,255,255,0.6)' : 'rgba(108,99,255,0.5)' }]} />
                ))}
              </View>
              {item.voiceDuration != null && <Text style={[styles.voiceDuration, isMine && styles.voiceDurationMine]}>{Math.ceil(item.voiceDuration / 1000)}s</Text>}
            </View>
          )}
          <View style={styles.bubbleFooter}>
            <Text style={[styles.bubbleTime, isMine && styles.bubbleTimeMine]}>{formatTime(item.timestamp)}</Text>
            {isMine && <Ionicons name={item.read ? 'checkmark-done' : 'checkmark'} size={14} color={item.read ? '#51CF66' : 'rgba(255,255,255,0.5)'} style={styles.readIcon} />}
          </View>
          {item.pinned && <View style={styles.pinnedBadge}><Ionicons name="pin" size={10} color="#FFB347" /><Text style={styles.pinnedText}>Pinned</Text></View>}
          {item.reactions && item.reactions.length > 0 && (
            <View style={styles.reactionsRow}>
              {item.reactions.map((r) => (
                <View key={r.emoji} style={styles.reactionChip}>
                  <Text style={styles.reactionEmoji}>{r.emoji}</Text>
                  {r.userIds.length > 1 && <Text style={styles.reactionCount}>{r.userIds.length}</Text>}
                </View>
              ))}
            </View>
          )}
        </View>
      </Pressable>
    </View>
  );
});
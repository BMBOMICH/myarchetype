import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TurboImage from '../TurboImage';
import { styles } from './styles';
import type { MatchData } from './types';

interface ChatHeaderProps {
  matchName: string;
  matchPhoto?: string;
  matchAge?: number;
  matchVerified: boolean;
  matchOnline: boolean;
  matchLastSeen: Date | null;
  theirTyping: boolean;
  showMenu: boolean;
  onBack: () => void;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onMenuAction: (action: string) => void;
  formatTime: (d: Date | null) => string;
}

export const ChatHeader = React.memo(({
  matchName, matchPhoto, matchAge, matchVerified, matchOnline, matchLastSeen,
  theirTyping, showMenu, onBack, onToggleMenu, onCloseMenu, onMenuAction, formatTime,
}: ChatHeaderProps) => {
  return (
    <>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.headerBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={26} color="#6C63FF" />
        </Pressable>
        <View style={styles.headerCenter}>
          {matchPhoto ? (
            <TurboImage source={{ uri: matchPhoto }} style={styles.headerAvatar} cachePolicy="dataCache" accessibilityLabel={`${matchName}'s photo`} />
          ) : (
            <View style={[styles.headerAvatar, styles.headerAvatarPlaceholder]}>
              <Ionicons name="person" size={20} color="#9494B8" />
            </View>
          )}
          <View style={styles.headerInfo}>
            <View style={styles.headerNameRow}>
              <Text style={styles.headerName} numberOfLines={1}>
                {matchName}{matchAge ? `, ${matchAge}` : ''}
              </Text>
              {matchVerified && <Ionicons name="checkmark-circle" size={14} color="#6C63FF" style={styles.verifiedIcon} />}
            </View>
            <Text style={styles.headerStatus}>
              {theirTyping ? 'typing…' : matchOnline ? 'Online' : matchLastSeen ? `Last seen ${formatTime(matchLastSeen)}` : ''}
            </Text>
          </View>
        </View>
        <Pressable onPress={onToggleMenu} style={styles.headerMenuBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Open chat menu">
          <Ionicons name="ellipsis-vertical" size={22} color="#9494B8" />
        </Pressable>
      </View>
      {showMenu && (
        <Pressable style={styles.menuOverlay} onPress={onCloseMenu} accessibilityLabel="Close menu" accessibilityRole="button">
          <View style={styles.menuCard}>
            <Pressable style={styles.menuItem} onPress={() => onMenuAction('notes')} accessibilityLabel="Shared Notes" accessibilityRole="button">
              <Ionicons name="document-text-outline" size={18} color="#9494B8" />
              <Text style={styles.menuItemText}>Shared Notes</Text>
            </Pressable>
            <Pressable style={styles.menuItem} onPress={() => onMenuAction('pinned')} accessibilityLabel="Pinned Messages" accessibilityRole="button">
              <Ionicons name="pin-outline" size={18} color="#9494B8" />
              <Text style={styles.menuItemText}>Pinned Messages</Text>
            </Pressable>
            <Pressable style={styles.menuItem} onPress={() => onMenuAction('disappearing')} accessibilityLabel="Toggle Disappearing" accessibilityRole="button">
              <Ionicons name="eye-outline" size={18} color="#9494B8" />
              <Text style={styles.menuItemText}>Toggle Disappearing</Text>
            </Pressable>
            <Pressable style={styles.menuItem} onPress={() => onMenuAction('dateIdeas')} accessibilityLabel="Date Ideas" accessibilityRole="button">
              <Ionicons name="heart-outline" size={18} color="#9494B8" />
              <Text style={styles.menuItemText}>Date Ideas</Text>
            </Pressable>
            <Pressable style={styles.menuItem} onPress={() => onMenuAction('call')} accessibilityLabel="Video or Audio Call" accessibilityRole="button">
              <Ionicons name="videocam-outline" size={18} color="#9494B8" />
              <Text style={styles.menuItemText}>Video / Audio Call</Text>
            </Pressable>
            <View style={styles.menuSeparator} />
            <Pressable style={[styles.menuItem, styles.menuItemDanger]} onPress={() => onMenuAction('unmatch')} accessibilityLabel="Unmatch" accessibilityRole="button">
              <Ionicons name="close-circle-outline" size={18} color="#FF6B6B" />
              <Text style={styles.menuItemDangerText}>Unmatch</Text>
            </Pressable>
          </View>
        </Pressable>
      )}
    </>
  );
});
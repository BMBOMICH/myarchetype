// app/my-matches.tsx
import { useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, Modal,
  RefreshControl, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import HeightBadge from '../components/HeightBadge';
import TrustScoreDisplay from '../components/TrustScoreDisplay';
import { app, auth, db } from '../firebaseConfig';
import type { AgeVerification } from '../utils/ageVerification';
import { getAgeVerificationLevel } from '../utils/ageVerification';
import { logger } from '../utils/logger';
import {
  checkIfChatHasMessages, cleanupExpiredMatches,
  formatExpiryWarning, getMatchExpiryInfo,
} from '../utils/matchExpiration';
import { getMatchNote, saveMatchNote } from '../utils/matchNotes';
import type { OpeningLine } from '../utils/openingLines';
import { generateOpeningLines } from '../utils/openingLines';
import { checkPhotoFreshness, dismissPhotoReminder } from '../utils/photoReminders';
import { shouldPromptForRating } from '../utils/ratingSystem';

interface Match {
  uid: string; name: string; age: number; bodyType: string; matchedAt: string;
  photos?: string[]; personalityType?: string;
  height?: number | { value: number; verificationMethod?: string; confidence?: number };
  selfieVerified?: boolean; ageVerified?: boolean; ageVerification?: AgeVerification;
  ratings?: {
    totalRatings: number; averagePhotosMatch: number; heightAccuracyRate: number;
    bodyTypeAccuracyRate: number; ageAccuracyRate: number;
    averagePersonalityMatch: number; averageOverall: number; trustScore: number;
  };
  daysRemaining?: number; isExpired?: boolean; isWarning?: boolean; hasMessages?: boolean;
}

interface FirestoreMatchData {
  name?: string; age?: number; bodyType?: string; photos?: string[];
  personalityType?: string;
  height?: number | { value: number; verificationMethod?: string; confidence?: number };
  selfieVerified?: boolean; ageVerified?: boolean;
  ageVerification?: AgeVerification; ratings?: Match['ratings'];
}

interface MatchCardProps {
  item: Match; ratingPrompts: Set<string>; matchNotes: Map<string, string>;
  unmatchingId: string | null;
  onChat: (uid: string, name: string) => void;
  onRate: (uid: string, name: string) => void;
  onOpenLines: (uid: string) => void;
  onOpenNote: (uid: string) => void;
  onUnmatch: (match: Match) => void;
}

const MatchCard = React.memo(function MatchCard({
  item, ratingPrompts, matchNotes, unmatchingId,
  onChat, onRate, onOpenLines, onOpenNote, onUnmatch,
}: MatchCardProps) {
  const ageBadge       = getAgeVerificationLevel(item.ageVerification);
  const heightIsObj    = typeof item.height === 'object' && item.height !== null;
  const heightVerified = heightIsObj && (item.height as { verificationMethod?: string }).verificationMethod === 'manual-measured';
  const isUnmatching   = unmatchingId === item.uid;

  return (
    <View style={s.matchCard} accessibilityLabel={`Match with ${item.name}, ${item.age} years old`}>
      {item.isWarning === true && item.hasMessages !== true && (
        <View style={s.expiryWarning} accessibilityRole="alert">
          <Text style={s.expiryWarningText}>{formatExpiryWarning(item.daysRemaining ?? 0)}</Text>
        </View>
      )}
      {ratingPrompts.has(item.uid) && (
        <TouchableOpacity style={s.ratingPromptBanner} onPress={() => onRate(item.uid, item.name)}
          accessibilityLabel={`Rate your experience with ${item.name}`} accessibilityRole="button">
          <Text style={s.ratingPromptText}>Did you meet {item.name}? Rate your experience!</Text>
          <Text style={s.ratingPromptArrow} accessibilityElementsHidden>→</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity style={s.matchInfoRow} onPress={() => onChat(item.uid, item.name)}
        accessibilityLabel={`Open chat with ${item.name}`} accessibilityRole="button">
        {item.photos && item.photos.length > 0 ? (
          <View style={s.photoContainer}>
            <Image source={{ uri: item.photos[0] }} style={s.matchPhoto} accessibilityLabel={`Photo of ${item.name}`} />
            {item.selfieVerified === true && (
              <View style={s.miniVerifiedBadge} accessibilityLabel="Verified user">
                <Text style={s.miniVerifiedText} accessibilityElementsHidden>✓</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={s.noPhoto} accessibilityLabel={`${item.name} has no photo`}>
            <Text style={s.noPhotoText} accessibilityElementsHidden>?</Text>
          </View>
        )}
        <View style={s.matchInfo}>
          <View style={s.nameRow}>
            <Text style={s.matchName}>{item.name}, {item.age}</Text>
            {item.selfieVerified === true && <Text style={s.verifiedCheck} accessibilityLabel="Verified">✓</Text>}
          </View>
          {ageBadge.level !== 'unverified' && (
            <View style={[s.ageBadge, { backgroundColor: ageBadge.color }]} accessibilityLabel={`Age verification: ${ageBadge.label}`}>
              <Text style={s.ageBadgeText}>{ageBadge.icon} {ageBadge.label}</Text>
            </View>
          )}
          <Text style={s.matchDetails}>{item.bodyType}</Text>
          {item.height != null && <View style={s.heightContainer}><HeightBadge height={item.height} /></View>}
          {!!item.personalityType && <Text style={s.personalityTag}>{item.personalityType}</Text>}
          {(item.selfieVerified === true || (item.ratings?.totalRatings ?? 0) > 0) && (
            <View style={s.trustScoreContainer}>
              <TrustScoreDisplay
                ratings={item.ratings} selfieVerified={item.selfieVerified}
                ageVerified={item.ageVerification?.verified} heightVerified={heightVerified} size="medium"
              />
            </View>
          )}
          {item.hasMessages !== true && item.isWarning !== true && (
            <Text style={s.noMessagesHint}>💬 Say hi! No messages yet</Text>
          )}
          {matchNotes.has(item.uid) && (
            <View style={s.noteIndicator}>
              <Text style={s.noteIndicatorText}>📝 Note saved</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
      <View style={s.matchActions}>
        <TouchableOpacity style={s.chatButton} onPress={() => onChat(item.uid, item.name)}
          accessibilityLabel={`Chat with ${item.name}`} accessibilityRole="button">
          <Text style={s.chatButtonText}>Chat</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.linesButton} onPress={() => onOpenLines(item.uid)}
          accessibilityLabel="Get conversation starters" accessibilityRole="button">
          <Text style={s.linesButtonText} accessibilityElementsHidden>💬</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.notesButton} onPress={() => onOpenNote(item.uid)}
          accessibilityLabel={matchNotes.has(item.uid) ? 'Edit note' : 'Add note'} accessibilityRole="button">
          <Text style={s.notesButtonText} accessibilityElementsHidden>{matchNotes.has(item.uid) ? '📝' : '📄'}</Text>
        </TouchableOpacity>
        {ratingPrompts.has(item.uid) && (
          <TouchableOpacity style={s.rateButton} onPress={() => onRate(item.uid, item.name)}
            accessibilityLabel={`Rate experience with ${item.name}`} accessibilityRole="button">
            <Text style={s.rateButtonText}>Rate</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[s.unmatchButton, isUnmatching && s.unmatchButtonDisabled]}
          onPress={() => onUnmatch(item)} disabled={isUnmatching}
          accessibilityLabel={`Unmatch with ${item.name}`} accessibilityRole="button"
          accessibilityState={{ disabled: isUnmatching, busy: isUnmatching }}>
          <Text style={s.unmatchButtonText} accessibilityElementsHidden>{isUnmatching ? '...' : 'X'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

export default function MyMatchesScreen() {
  const router    = useRouter();
  const functions = useMemo(() => getFunctions(app, 'europe-west1'), []);

  const [matches, setMatches]                         = useState<Match[]>([]);
  const [loading, setLoading]                         = useState(true);
  const [refreshing, setRefreshing]                   = useState(false);
  const [ratingPrompts, setRatingPrompts]             = useState<Set<string>>(new Set());
  const [showPhotoReminder, setShowPhotoReminder]     = useState(false);
  const [photoReminderMessage, setPhotoReminderMessage] = useState('');
  const [showOpeningLines, setShowOpeningLines]       = useState<string | null>(null);
  const [openingLines, setOpeningLines]               = useState<OpeningLine[]>([]);
  const [showNoteModal, setShowNoteModal]             = useState<string | null>(null);
  const [currentNote, setCurrentNote]                 = useState('');
  const [savingNote, setSavingNote]                   = useState(false);
  const [matchNotes, setMatchNotes]                   = useState<Map<string, string>>(new Map());
  const [unmatchingId, setUnmatchingId]               = useState<string | null>(null);

  const loadMatches = useCallback(async () => {
    try {
      const user = auth.currentUser;
      if (!user) { setTimeout(() => router.replace('/login'), 100); return; }

      const removedCount = await cleanupExpiredMatches(user.uid);
      if (removedCount > 0) logger.log(`[MyMatches] Removed ${removedCount} expired matches`);

      const [snap1, snap2] = await Promise.all([
        getDocs(query(collection(db, 'likes'), where('fromUserId', '==', user.uid), where('status', '==', 'matched'))),
        getDocs(query(collection(db, 'likes'), where('toUserId',   '==', user.uid), where('status', '==', 'matched'))),
      ]);

      const matchedUsers = new Map<string, string>();
      snap1.forEach(d => { const data = d.data(); matchedUsers.set(String(data.toUserId ?? ''), String(data.matchedAt ?? data.createdAt ?? '')); });
      snap2.forEach(d => { const data = d.data(); if (!matchedUsers.has(String(data.fromUserId ?? ''))) matchedUsers.set(String(data.fromUserId ?? ''), String(data.matchedAt ?? data.createdAt ?? '')); });

      const matchDetails: Match[] = [];
      const promptsToShow         = new Set<string>();
      const notesMap              = new Map<string, string>();

      for (const [matchId, matchedAt] of matchedUsers) {
        const userDoc = await getDoc(doc(db, 'users', matchId));
        if (!userDoc.exists()) continue;
        const userData    = userDoc.data() as FirestoreMatchData;
        const hasMessages = await checkIfChatHasMessages(user.uid, matchId);
        const expiryInfo  = getMatchExpiryInfo(matchedAt, hasMessages);
        if (expiryInfo.isExpired) continue;

        matchDetails.push({
          uid: matchId, name: userData.name ?? 'Unknown', age: userData.age ?? 0,
          bodyType: userData.bodyType ?? '', matchedAt, photos: userData.photos ?? [],
          personalityType: userData.personalityType ?? '', height: userData.height,
          selfieVerified: userData.selfieVerified ?? false, ageVerified: userData.ageVerified ?? false,
          ageVerification: userData.ageVerification, ratings: userData.ratings,
          daysRemaining: expiryInfo.daysRemaining, isWarning: expiryInfo.isWarning,
          isExpired: expiryInfo.isExpired, hasMessages,
        });

        const [shouldPrompt, note] = await Promise.all([
          shouldPromptForRating(user.uid, matchId),
          getMatchNote(matchId),
        ]);
        if (shouldPrompt) promptsToShow.add(matchId);
        if (note) notesMap.set(matchId, note);
      }

      matchDetails.sort((a, b) => {
        if (a.isWarning && !b.isWarning) return -1;
        if (!a.isWarning && b.isWarning) return 1;
        return new Date(b.matchedAt).getTime() - new Date(a.matchedAt).getTime();
      });

      setMatches(matchDetails);
      setRatingPrompts(promptsToShow);
      setMatchNotes(notesMap);
    } catch (error) {
      logger.error('[MyMatches] loadMatches error:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  const checkPhotos = useCallback(async () => {
    try {
      const result = await checkPhotoFreshness();
      if (result.shouldRemind) { setShowPhotoReminder(true); setPhotoReminderMessage(result.message); }
    } catch (error) {
      logger.error('[MyMatches] checkPhotos error:', error);
    }
  }, []);

  useEffect(() => { void loadMatches(); void checkPhotos(); }, [loadMatches, checkPhotos]);

  const handleRefresh = useCallback(() => { setRefreshing(true); void loadMatches(); }, [loadMatches]);

  const handleDismissPhotoReminder = useCallback(async () => {
    setShowPhotoReminder(false);
    await dismissPhotoReminder();
  }, []);

  const handleUpdatePhotos  = useCallback(() => { setShowPhotoReminder(false); router.push('/edit-profile'); }, [router]);
  const navigateToChat      = useCallback((matchId: string, matchName: string) => { router.push({ pathname: '/chat', params: { matchId, matchName } }); }, [router]);
  const navigateToRating    = useCallback((matchId: string, matchName: string) => { router.push({ pathname: '/post-date-rating', params: { matchId, matchName } }); }, [router]);

  const loadOpeningLines = useCallback(async (matchId: string) => {
    try {
      const lines = await generateOpeningLines(matchId);
      setOpeningLines(lines);
      setShowOpeningLines(matchId);
    } catch (error) {
      logger.error('[MyMatches] loadOpeningLines error:', error);
      Alert.alert('Error', 'Failed to load conversation starters');
    }
  }, []);

  const handleOpenNoteModal = useCallback(async (matchId: string) => {
    try {
      const note = await getMatchNote(matchId);
      setCurrentNote(note);
      setShowNoteModal(matchId);
    } catch (error) {
      logger.error('[MyMatches] handleOpenNoteModal error:', error);
    }
  }, []);

  const handleSaveNote = useCallback(async () => {
    if (!showNoteModal) return;
    setSavingNote(true);
    try {
      const success = await saveMatchNote(showNoteModal, currentNote);
      if (success) {
        setMatchNotes(prev => new Map(prev).set(showNoteModal, currentNote));
        setShowNoteModal(null);
        Alert.alert('Saved', 'Note saved successfully');
      } else {
        Alert.alert('Error', 'Failed to save note');
      }
    } catch (error) {
      logger.error('[MyMatches] handleSaveNote error:', error);
      Alert.alert('Error', 'Failed to save note');
    } finally {
      setSavingNote(false);
    }
  }, [showNoteModal, currentNote]);

  const doUnmatch = useCallback(async (match: Match) => {
    setUnmatchingId(match.uid);
    try {
      const callable = httpsCallable<{ otherUserId: string }, { success: boolean }>(functions, 'unmatchUsers');
      await callable({ otherUserId: match.uid });
      setMatches(prev => prev.filter(m => m.uid !== match.uid));
      Alert.alert('Done', `You've unmatched with ${match.name}`);
    } catch (error) {
      logger.error('[MyMatches] doUnmatch error:', error);
      Alert.alert('Error', 'Error unmatching');
    } finally {
      setUnmatchingId(null);
    }
  }, [functions]);

  const handleUnmatch = useCallback((match: Match) => {
    Alert.alert(
      `Unmatch with ${match.name}?`,
      "This will:\n- Remove them from your matches\n- Delete your conversation\n- They won't be notified\n\nThis cannot be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unmatch', style: 'destructive', onPress: () => void doUnmatch(match) },
      ],
    );
  }, [doUnmatch]);

  const handleOpenLines = useCallback((uid: string) => { void loadOpeningLines(uid); }, [loadOpeningLines]);
  const handleOpenNote  = useCallback((uid: string) => { void handleOpenNoteModal(uid); }, [handleOpenNoteModal]);

  const renderItem = useCallback(({ item }: { item: Match }) => (
    <MatchCard
      item={item} ratingPrompts={ratingPrompts} matchNotes={matchNotes}
      unmatchingId={unmatchingId} onChat={navigateToChat} onRate={navigateToRating}
      onOpenLines={handleOpenLines} onOpenNote={handleOpenNote} onUnmatch={handleUnmatch}
    />
  ), [ratingPrompts, matchNotes, unmatchingId, navigateToChat, navigateToRating, handleOpenLines, handleOpenNote, handleUnmatch]);

  const keyExtractor = useCallback((item: Match) => item.uid, []);

  if (loading) {
    return (
      <View style={s.container}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={s.loadingText}>Loading your matches...</Text>
      </View>
    );
  }

  if (matches.length === 0) {
    return (
      <View style={s.container}>
        <Text style={s.emptyIcon} accessibilityElementsHidden>💔</Text>
        <Text style={s.emptyTitle} accessibilityRole="header">No Matches Yet</Text>
        <Text style={s.emptyText}>{"Start browsing profiles and like people.\nWhen they like you back, they'll appear here!"}</Text>
        <TouchableOpacity style={s.button} onPress={() => router.push('/matches')}
          accessibilityLabel="Find matches" accessibilityRole="button">
          <Text style={s.buttonText}>Find Matches</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <Text style={s.title} accessibilityRole="header">{`Your Matches (${matches.length})`}</Text>

      {showPhotoReminder && (
        <View style={s.photoReminderCard} accessibilityRole="alert">
          <View style={s.photoReminderContent}>
            <Text style={s.photoReminderIcon} accessibilityElementsHidden>📸</Text>
            <View style={s.photoReminderTextBox}>
              <Text style={s.photoReminderTitle}>Update Your Photos</Text>
              <Text style={s.photoReminderMessage}>{photoReminderMessage}</Text>
            </View>
          </View>
          <View style={s.photoReminderButtons}>
            <TouchableOpacity style={s.photoReminderDismiss} onPress={handleDismissPhotoReminder}
              accessibilityLabel="Dismiss photo reminder, update later" accessibilityRole="button">
              <Text style={s.photoReminderDismissText}>Later</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.photoReminderUpdate} onPress={handleUpdatePhotos}
              accessibilityLabel="Update your photos now" accessibilityRole="button">
              <Text style={s.photoReminderUpdateText}>Update Now</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <FlatList
        data={matches} keyExtractor={keyExtractor} renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#53a8b6" />}
        ListFooterComponent={<Text style={s.pullHint}>Pull down to refresh</Text>}
        removeClippedSubviews
      />

      <Modal visible={!!showOpeningLines} transparent animationType="fade" onRequestClose={() => setShowOpeningLines(null)}>
        <View style={s.modalOverlay}>
          <View style={s.modalContent}>
            <Text style={s.modalTitle} accessibilityRole="header">💬 Conversation Starters</Text>
            <Text style={s.modalSubtitle}>Pick one to start your chat:</Text>
            {openingLines.map((line) => (
              <TouchableOpacity
                key={line.text}
                style={s.openingLineOption}
                onPress={() => { const id = showOpeningLines; setShowOpeningLines(null); if (id) navigateToChat(id, ''); }}
                accessibilityLabel={`Use opening line: ${line.text}`} accessibilityRole="button">
                <Text style={s.openingLineText}>{line.text}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={s.modalCloseButton} onPress={() => setShowOpeningLines(null)}
              accessibilityLabel="Cancel and close" accessibilityRole="button">
              <Text style={s.modalCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={!!showNoteModal} transparent animationType="fade" onRequestClose={() => setShowNoteModal(null)}>
        <View style={s.modalOverlay}>
          <View style={s.modalContent}>
            <Text style={s.modalTitle} accessibilityRole="header">📝 Private Note</Text>
            <Text style={s.modalSubtitle}>Only you can see this note</Text>
            <TextInput
              style={s.noteInput} placeholder="Add notes about this match..."
              placeholderTextColor="#666" value={currentNote} onChangeText={setCurrentNote}
              multiline maxLength={500} accessibilityLabel="Match note input"
            />
            <Text style={s.charCount} accessibilityLabel={`${currentNote.length} of 500 characters used`}>{currentNote.length}/500</Text>
            <View style={s.modalButtons}>
              <TouchableOpacity style={s.modalCancelButton} onPress={() => setShowNoteModal(null)}
                accessibilityLabel="Cancel without saving" accessibilityRole="button">
                <Text style={s.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modalSaveButton, savingNote && s.modalSaveButtonDisabled]}
                onPress={() => void handleSaveNote()} disabled={savingNote}
                accessibilityLabel="Save note" accessibilityRole="button"
                accessibilityState={{ disabled: savingNote, busy: savingNote }}>
                <Text style={s.modalSaveText}>{savingNote ? 'Saving...' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container:                { flex: 1, backgroundColor: '#1a1a2e', padding: 20 },
  loadingText:              { color: '#aaa', marginTop: 15, fontSize: 16, textAlign: 'center' },
  emptyIcon:                { fontSize: 60, textAlign: 'center', marginTop: 100, marginBottom: 20 },
  title:                    { fontSize: 24, fontWeight: 'bold', color: '#eee', marginBottom: 20, marginTop: 10, textAlign: 'center' },
  emptyTitle:               { fontSize: 28, fontWeight: 'bold', color: '#eee', textAlign: 'center', marginBottom: 20 },
  emptyText:                { fontSize: 16, color: '#aaa', textAlign: 'center', marginBottom: 40, lineHeight: 24 },
  button:                   { backgroundColor: '#53a8b6', paddingVertical: 15, paddingHorizontal: 40, borderRadius: 25, alignSelf: 'center' },
  buttonText:               { color: '#fff', fontSize: 18, fontWeight: '600' },
  photoReminderCard:        { backgroundColor: '#16213e', borderRadius: 15, padding: 15, marginBottom: 15, borderWidth: 2, borderColor: '#e67e22' },
  photoReminderContent:     { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  photoReminderIcon:        { fontSize: 30, marginRight: 12 },
  photoReminderTextBox:     { flex: 1 },
  photoReminderTitle:       { color: '#e67e22', fontSize: 14, fontWeight: '600' },
  photoReminderMessage:     { color: '#888', fontSize: 12, marginTop: 3 },
  photoReminderButtons:     { flexDirection: 'row', gap: 10 },
  photoReminderDismiss:     { flex: 1, paddingVertical: 10, borderRadius: 20, alignItems: 'center', backgroundColor: '#0f3460' },
  photoReminderDismissText: { color: '#888', fontSize: 14 },
  photoReminderUpdate:      { flex: 1, paddingVertical: 10, borderRadius: 20, alignItems: 'center', backgroundColor: '#e67e22' },
  photoReminderUpdateText:  { color: '#fff', fontSize: 14, fontWeight: '600' },
  matchCard:                { backgroundColor: '#16213e', borderRadius: 15, padding: 15, marginBottom: 15, borderWidth: 1, borderColor: '#0f3460' },
  expiryWarning:            { backgroundColor: '#e67e22', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, marginBottom: 12 },
  expiryWarningText:        { color: '#fff', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  ratingPromptBanner:       { backgroundColor: '#e67e22', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderRadius: 10, marginBottom: 12 },
  ratingPromptText:         { color: '#fff', fontSize: 13, fontWeight: '600', flex: 1 },
  ratingPromptArrow:        { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  matchInfoRow:             { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  photoContainer:           { position: 'relative' },
  matchPhoto:               { width: 70, height: 90, borderRadius: 10, marginRight: 15 },
  miniVerifiedBadge:        { position: 'absolute', bottom: 3, right: 18, backgroundColor: '#3498db', borderRadius: 10, width: 18, height: 18, justifyContent: 'center', alignItems: 'center' },
  miniVerifiedText:         { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  noPhoto:                  { width: 70, height: 90, borderRadius: 10, backgroundColor: '#0f3460', justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  noPhotoText:              { fontSize: 30, color: '#666' },
  matchInfo:                { flex: 1 },
  nameRow:                  { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  matchName:                { fontSize: 20, fontWeight: 'bold', color: '#eee' },
  verifiedCheck:            { fontSize: 16, color: '#3498db' },
  ageBadge:                 { alignSelf: 'flex-start', paddingVertical: 3, paddingHorizontal: 8, borderRadius: 10, marginBottom: 4 },
  ageBadgeText:             { color: '#fff', fontSize: 10, fontWeight: '600' },
  matchDetails:             { fontSize: 14, color: '#aaa' },
  heightContainer:          { marginTop: 4 },
  personalityTag:           { fontSize: 13, color: '#e67e22', marginTop: 4 },
  trustScoreContainer:      { marginTop: 8 },
  noMessagesHint:           { color: '#53a8b6', fontSize: 12, marginTop: 6, fontStyle: 'italic' },
  noteIndicator:            { backgroundColor: '#9b59b6', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8, alignSelf: 'flex-start', marginTop: 6 },
  noteIndicatorText:        { color: '#fff', fontSize: 10, fontWeight: '600' },
  matchActions:             { flexDirection: 'row', gap: 8 },
  chatButton:               { flex: 2, backgroundColor: '#5cb85c', paddingVertical: 12, borderRadius: 20, alignItems: 'center' },
  chatButtonText:           { color: '#fff', fontSize: 14, fontWeight: '600' },
  linesButton:              { backgroundColor: '#e67e22', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  linesButtonText:          { fontSize: 18 },
  notesButton:              { backgroundColor: '#9b59b6', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  notesButtonText:          { fontSize: 18 },
  rateButton:               { backgroundColor: '#e67e22', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 20, alignItems: 'center' },
  rateButtonText:           { color: '#fff', fontSize: 14, fontWeight: '600' },
  unmatchButton:            { backgroundColor: '#0f3460', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 20, alignItems: 'center' },
  unmatchButtonDisabled:    { opacity: 0.6 },
  unmatchButtonText:        { fontSize: 18, color: '#d9534f', fontWeight: 'bold' },
  pullHint:                 { color: '#555', fontSize: 12, textAlign: 'center', marginTop: 10, marginBottom: 20 },
  modalOverlay:             { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent:             { backgroundColor: '#16213e', borderRadius: 20, padding: 25, width: '100%', maxWidth: 400 },
  modalTitle:               { fontSize: 22, fontWeight: 'bold', color: '#eee', textAlign: 'center', marginBottom: 8 },
  modalSubtitle:            { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 20 },
  openingLineOption:        { backgroundColor: '#0f3460', padding: 15, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: '#53a8b6' },
  openingLineText:          { color: '#eee', fontSize: 15, lineHeight: 22 },
  noteInput:                { backgroundColor: '#0f3460', color: '#fff', padding: 15, borderRadius: 12, fontSize: 15, minHeight: 120, textAlignVertical: 'top', marginBottom: 8 },
  charCount:                { color: '#666', fontSize: 12, textAlign: 'right', marginBottom: 12 },
  modalButtons:             { flexDirection: 'row', gap: 12 },
  modalCancelButton:        { flex: 1, backgroundColor: '#0f3460', paddingVertical: 14, borderRadius: 20, alignItems: 'center' },
  modalCancelText:          { color: '#888', fontSize: 16, fontWeight: '600' },
  modalSaveButton:          { flex: 1, backgroundColor: '#5cb85c', paddingVertical: 14, borderRadius: 20, alignItems: 'center' },
  modalSaveButtonDisabled:  { backgroundColor: '#555' },
  modalSaveText:            { color: '#fff', fontSize: 16, fontWeight: '600' },
  modalCloseButton:         { marginTop: 12, paddingVertical: 12, alignItems: 'center' },
  modalCloseText:           { color: '#d9534f', fontSize: 16 },
});
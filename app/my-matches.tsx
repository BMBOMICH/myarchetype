import { useRouter } from 'expo-router';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import HeightBadge from '../components/HeightBadge';
import TrustScoreDisplay from '../components/TrustScoreDisplay';
import { app, auth, db } from '../firebaseConfig';
import type { AgeVerification } from '../utils/ageVerification';
import { getAgeVerificationLevel } from '../utils/ageVerification';
import {
  checkIfChatHasMessages,
  cleanupExpiredMatches,
  formatExpiryWarning,
  getMatchExpiryInfo,
} from '../utils/matchExpiration';
import { getMatchNote, saveMatchNote } from '../utils/matchNotes';
import type { OpeningLine } from '../utils/openingLines';
import { generateOpeningLines } from '../utils/openingLines';
import {
  checkPhotoFreshness,
  dismissPhotoReminder,
} from '../utils/photoReminders';
import { shouldPromptForRating } from '../utils/ratingSystem';

interface Match {
  uid: string;
  name: string;
  age: number;
  bodyType: string;
  matchedAt: string;
  photos?: string[];
  personalityType?: string;
  height?: number | { value: number; verificationMethod?: string; confidence?: number };
  selfieVerified?: boolean;
  ageVerified?: boolean;
  ageVerification?: AgeVerification;
  ratings?: {
    totalRatings: number;
    averagePhotosMatch: number;
    heightAccuracyRate: number;
    bodyTypeAccuracyRate: number;
    ageAccuracyRate: number;
    averagePersonalityMatch: number;
    averageOverall: number;
    trustScore: number;
  };
  daysRemaining?: number;
  isExpired?: boolean;
  isWarning?: boolean;
  hasMessages?: boolean;
}

export default function MyMatchesScreen() {
  const router = useRouter();
  const functions = useMemo(() => getFunctions(app, 'europe-west1'), []);

  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [ratingPrompts, setRatingPrompts] = useState<Set<string>>(new Set());

  const [showPhotoReminder, setShowPhotoReminder] = useState(false);
  const [photoReminderMessage, setPhotoReminderMessage] = useState('');

  const [showOpeningLines, setShowOpeningLines] = useState<string | null>(null);
  const [openingLines, setOpeningLines] = useState<OpeningLine[]>([]);

  const [showNoteModal, setShowNoteModal] = useState<string | null>(null);
  const [currentNote, setCurrentNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [matchNotes, setMatchNotes] = useState<Map<string, string>>(new Map());
  const [unmatchingId, setUnmatchingId] = useState<string | null>(null);

  useEffect(() => {
    void loadMatches();
    void checkPhotos();
  }, []);

  const checkPhotos = async () => {
    try {
      const result = await checkPhotoFreshness();
      if (result.shouldRemind) {
        setShowPhotoReminder(true);
        setPhotoReminderMessage(result.message);
      }
    } catch (error) {
      console.error('Failed checking photo freshness:', error);
    }
  };

  const handleDismissPhotoReminder = async () => {
    setShowPhotoReminder(false);
    await dismissPhotoReminder();
  };

  const handleUpdatePhotos = () => {
    setShowPhotoReminder(false);
    router.push('/edit-profile');
  };

  const loadMatches = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        setTimeout(() => router.replace('/login'), 100);
        return;
      }

      const removedCount = await cleanupExpiredMatches(user.uid);
      if (removedCount > 0) {
        console.log(`Removed ${removedCount} expired matches`);
      }

      const q1 = query(
        collection(db, 'likes'),
        where('fromUserId', '==', user.uid),
        where('status', '==', 'matched')
      );

      const q2 = query(
        collection(db, 'likes'),
        where('toUserId', '==', user.uid),
        where('status', '==', 'matched')
      );

      const [snapshot1, snapshot2] = await Promise.all([getDocs(q1), getDocs(q2)]);

      const matchedUsers = new Map<string, string>();

      snapshot1.forEach((docSnap) => {
        const data = docSnap.data();
        matchedUsers.set(data.toUserId, data.matchedAt || data.createdAt);
      });

      snapshot2.forEach((docSnap) => {
        const data = docSnap.data();
        if (!matchedUsers.has(data.fromUserId)) {
          matchedUsers.set(data.fromUserId, data.matchedAt || data.createdAt);
        }
      });

      const matchDetails: Match[] = [];
      const promptsToShow = new Set<string>();
      const notesMap = new Map<string, string>();

      for (const [matchId, matchedAt] of matchedUsers) {
        const userDoc = await getDoc(doc(db, 'users', matchId));
        if (!userDoc.exists()) continue;

        const userData = userDoc.data();
        const hasMessages = await checkIfChatHasMessages(user.uid, matchId);
        const expiryInfo = getMatchExpiryInfo(matchedAt, hasMessages);

        if (expiryInfo.isExpired) continue;

        matchDetails.push({
          uid: matchId,
          name: userData.name,
          age: userData.age,
          bodyType: userData.bodyType,
          matchedAt: matchedAt,
          photos: userData.photos || [],
          personalityType: userData.personalityType || '',
          height: userData.height,
          selfieVerified: userData.selfieVerified || false,
          ageVerified: userData.ageVerified || false,
          ageVerification: userData.ageVerification,
          ratings: userData.ratings,
          daysRemaining: expiryInfo.daysRemaining,
          isWarning: expiryInfo.isWarning,
          isExpired: expiryInfo.isExpired,
          hasMessages: hasMessages,
        });

        const shouldPrompt = await shouldPromptForRating(user.uid, matchId);
        if (shouldPrompt) {
          promptsToShow.add(matchId);
        }

        const note = await getMatchNote(matchId);
        if (note) {
          notesMap.set(matchId, note);
        }
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
      console.error('Error loading matches:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    void loadMatches();
  };

  const navigateToChat = (matchId: string, matchName: string) => {
    router.push({
      pathname: '/chat',
      params: { matchId, matchName },
    });
  };

  const navigateToRating = (matchId: string, matchName: string) => {
    router.push({
      pathname: '/post-date-rating',
      params: { matchId, matchName },
    });
  };

  const loadOpeningLines = async (matchId: string) => {
    try {
      const lines = await generateOpeningLines(matchId);
      setOpeningLines(lines);
      setShowOpeningLines(matchId);
    } catch (error) {
      console.error('Failed to load opening lines:', error);
      Alert.alert('Error', 'Failed to load conversation starters');
    }
  };

  const handleOpenNoteModal = async (matchId: string) => {
    try {
      const note = await getMatchNote(matchId);
      setCurrentNote(note);
      setShowNoteModal(matchId);
    } catch (error) {
      console.error('Failed to open note modal:', error);
    }
  };

  const handleSaveNote = async () => {
    if (!showNoteModal) return;

    setSavingNote(true);
    try {
      const success = await saveMatchNote(showNoteModal, currentNote);

      if (success) {
        const newNotes = new Map(matchNotes);
        newNotes.set(showNoteModal, currentNote);
        setMatchNotes(newNotes);
        setShowNoteModal(null);
        Alert.alert('Saved', 'Note saved successfully');
      } else {
        Alert.alert('Error', 'Failed to save note');
      }
    } catch (error) {
      console.error('Save note error:', error);
      Alert.alert('Error', 'Failed to save note');
    } finally {
      setSavingNote(false);
    }
  };

  const doUnmatch = async (match: Match) => {
    const user = auth.currentUser;
    if (!user) return;

    setUnmatchingId(match.uid);

    try {
      const callable = httpsCallable<{ otherUserId: string }, { success: boolean }>(
        functions,
        'unmatchUsers'
      );

      await callable({ otherUserId: match.uid });

      setMatches((prev) => prev.filter((m) => m.uid !== match.uid));
      Alert.alert('Done', `You've unmatched with ${match.name}`);
    } catch (error) {
      console.error('Error unmatching:', error);
      Alert.alert('Error', 'Error unmatching');
    } finally {
      setUnmatchingId(null);
    }
  };

  const handleUnmatch = async (match: Match) => {
    Alert.alert(
      `Unmatch with ${match.name}?`,
      "This will:\n- Remove them from your matches\n- Delete your conversation\n- They won't be notified\n\nThis cannot be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unmatch',
          style: 'destructive',
          onPress: () => {
            void doUnmatch(match);
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={styles.loadingText}>Loading your matches...</Text>
      </View>
    );
  }

  if (matches.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyIcon}>💔</Text>
        <Text style={styles.emptyTitle}>No Matches Yet</Text>
        <Text style={styles.emptyText}>
          {"Start browsing profiles and like people.\nWhen they like you back, they'll appear here!"}
        </Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => router.push('/matches')}
        >
          <Text style={styles.buttonText}>Find Matches</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{`Your Matches (${matches.length})`}</Text>

      {showPhotoReminder && (
        <View style={styles.photoReminderCard}>
          <View style={styles.photoReminderContent}>
            <Text style={styles.photoReminderIcon}>📸</Text>
            <View style={styles.photoReminderTextBox}>
              <Text style={styles.photoReminderTitle}>Update Your Photos</Text>
              <Text style={styles.photoReminderMessage}>{photoReminderMessage}</Text>
            </View>
          </View>
          <View style={styles.photoReminderButtons}>
            <TouchableOpacity
              style={styles.photoReminderDismiss}
              onPress={handleDismissPhotoReminder}
            >
              <Text style={styles.photoReminderDismissText}>Later</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.photoReminderUpdate}
              onPress={handleUpdatePhotos}
            >
              <Text style={styles.photoReminderUpdateText}>Update Now</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <FlatList
        data={matches}
        keyExtractor={(item) => item.uid}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#53a8b6"
          />
        }
        renderItem={({ item }) => {
          const ageBadge = getAgeVerificationLevel(item.ageVerification);

          return (
            <View
              style={[
                styles.matchCard,
                item.isWarning && styles.matchCardWarning,
              ]}
            >
              {item.isWarning && !item.hasMessages && (
                <View style={styles.expiryWarning}>
                  <Text style={styles.expiryWarningText}>
                    {formatExpiryWarning(item.daysRemaining || 0)}
                  </Text>
                </View>
              )}

              {ratingPrompts.has(item.uid) && (
                <TouchableOpacity
                  style={styles.ratingPromptBanner}
                  onPress={() => navigateToRating(item.uid, item.name)}
                >
                  <Text style={styles.ratingPromptText}>
                    Did you meet {item.name}? Rate your experience!
                  </Text>
                  <Text style={styles.ratingPromptArrow}>→</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={styles.matchInfoRow}
                onPress={() => navigateToChat(item.uid, item.name)}
              >
                {item.photos && item.photos.length > 0 ? (
                  <View style={styles.photoContainer}>
                    <Image
                      source={{ uri: item.photos[0] }}
                      style={styles.matchPhoto}
                    />
                    {item.selfieVerified && (
                      <View style={styles.miniVerifiedBadge}>
                        <Text style={styles.miniVerifiedText}>✓</Text>
                      </View>
                    )}
                  </View>
                ) : (
                  <View style={styles.noPhoto}>
                    <Text style={styles.noPhotoText}>?</Text>
                  </View>
                )}

                <View style={styles.matchInfo}>
                  <View style={styles.nameRow}>
                    <Text style={styles.matchName}>
                      {item.name}, {item.age}
                    </Text>
                    {item.selfieVerified && (
                      <Text style={styles.verifiedCheck}>✓</Text>
                    )}
                  </View>

                  {ageBadge.level !== 'unverified' && (
                    <View style={[styles.ageBadge, { backgroundColor: ageBadge.color }]}>
                      <Text style={styles.ageBadgeText}>
                        {ageBadge.icon} {ageBadge.label}
                      </Text>
                    </View>
                  )}

                  <Text style={styles.matchDetails}>{item.bodyType}</Text>

                  {item.height && (
                    <View style={styles.heightContainer}>
                      <HeightBadge height={item.height} />
                    </View>
                  )}

                  {item.personalityType && (
                    <Text style={styles.personalityTag}>{item.personalityType}</Text>
                  )}

                  {(item.selfieVerified || (item.ratings && item.ratings.totalRatings > 0)) && (
                    <View style={styles.trustScoreContainer}>
                      <TrustScoreDisplay
                        ratings={item.ratings}
                        selfieVerified={item.selfieVerified}
                        ageVerified={item.ageVerification?.verified}
                        heightVerified={
                          typeof item.height === 'object' &&
                          item.height.verificationMethod === 'manual-measured'
                        }
                        size="medium"
                      />
                    </View>
                  )}

                  {!item.hasMessages && !item.isWarning && (
                    <Text style={styles.noMessagesHint}>
                      💬 Say hi! No messages yet
                    </Text>
                  )}

                  {matchNotes.has(item.uid) && (
                    <View style={styles.noteIndicator}>
                      <Text style={styles.noteIndicatorText}>📝 Note saved</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>

              <View style={styles.matchActions}>
                <TouchableOpacity
                  style={styles.chatButton}
                  onPress={() => navigateToChat(item.uid, item.name)}
                >
                  <Text style={styles.chatButtonText}>Chat</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.linesButton}
                  onPress={() => void loadOpeningLines(item.uid)}
                >
                  <Text style={styles.linesButtonText}>💬</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.notesButton}
                  onPress={() => void handleOpenNoteModal(item.uid)}
                >
                  <Text style={styles.notesButtonText}>
                    {matchNotes.has(item.uid) ? '📝' : '📄'}
                  </Text>
                </TouchableOpacity>

                {ratingPrompts.has(item.uid) && (
                  <TouchableOpacity
                    style={styles.rateButton}
                    onPress={() => navigateToRating(item.uid, item.name)}
                  >
                    <Text style={styles.rateButtonText}>Rate</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[
                    styles.unmatchButton,
                    unmatchingId === item.uid && styles.unmatchButtonDisabled,
                  ]}
                  onPress={() => void handleUnmatch(item)}
                  disabled={unmatchingId === item.uid}
                >
                  <Text style={styles.unmatchButtonText}>
                    {unmatchingId === item.uid ? '...' : 'X'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
        ListFooterComponent={() => (
          <Text style={styles.pullHint}>Pull down to refresh</Text>
        )}
      />

      <Modal
        visible={!!showOpeningLines}
        transparent
        animationType="fade"
        onRequestClose={() => setShowOpeningLines(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>💬 Conversation Starters</Text>
            <Text style={styles.modalSubtitle}>
              Pick one to start your chat:
            </Text>

            {openingLines.map((line, index) => (
              <TouchableOpacity
                key={index}
                style={styles.openingLineOption}
                onPress={() => {
                  const selectedMatchId = showOpeningLines;
                  setShowOpeningLines(null);
                  if (selectedMatchId) {
                    navigateToChat(selectedMatchId, '');
                  }
                }}
              >
                <Text style={styles.openingLineText}>{line.text}</Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={() => setShowOpeningLines(null)}
            >
              <Text style={styles.modalCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!showNoteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowNoteModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>📝 Private Note</Text>
            <Text style={styles.modalSubtitle}>
              Only you can see this note
            </Text>

            <TextInput
              style={styles.noteInput}
              placeholder="Add notes about this match..."
              placeholderTextColor="#666"
              value={currentNote}
              onChangeText={setCurrentNote}
              multiline
              maxLength={500}
            />

            <Text style={styles.charCount}>{currentNote.length}/500</Text>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => setShowNoteModal(null)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.modalSaveButton,
                  savingNote && styles.modalSaveButtonDisabled,
                ]}
                onPress={() => void handleSaveNote()}
                disabled={savingNote}
              >
                <Text style={styles.modalSaveText}>
                  {savingNote ? 'Saving...' : 'Save'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 20 },
  loadingText: { color: '#aaa', marginTop: 15, fontSize: 16, textAlign: 'center' },
  emptyIcon: { fontSize: 60, textAlign: 'center', marginTop: 100, marginBottom: 20 },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#eee',
    marginBottom: 20,
    marginTop: 10,
    textAlign: 'center',
  },
  emptyTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#eee',
    textAlign: 'center',
    marginBottom: 20,
  },
  emptyText: {
    fontSize: 16,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 40,
    lineHeight: 24,
  },
  button: {
    backgroundColor: '#53a8b6',
    paddingVertical: 15,
    paddingHorizontal: 40,
    borderRadius: 25,
    alignSelf: 'center',
  },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  photoReminderCard: {
    backgroundColor: '#16213e',
    borderRadius: 15,
    padding: 15,
    marginBottom: 15,
    borderWidth: 2,
    borderColor: '#e67e22',
  },
  photoReminderContent: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  photoReminderIcon: { fontSize: 30, marginRight: 12 },
  photoReminderTextBox: { flex: 1 },
  photoReminderTitle: { color: '#e67e22', fontSize: 14, fontWeight: '600' },
  photoReminderMessage: { color: '#888', fontSize: 12, marginTop: 3 },
  photoReminderButtons: { flexDirection: 'row', gap: 10 },
  photoReminderDismiss: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 20,
    alignItems: 'center',
    backgroundColor: '#0f3460',
  },
  photoReminderDismissText: { color: '#888', fontSize: 14 },
  photoReminderUpdate: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 20,
    alignItems: 'center',
    backgroundColor: '#e67e22',
  },
  photoReminderUpdateText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  matchCard: {
    backgroundColor: '#16213e',
    borderRadius: 15,
    padding: 15,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  matchCardWarning: { borderColor: '#e67e22', borderWidth: 2 },
  expiryWarning: {
    backgroundColor: '#e67e22',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  expiryWarningText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  ratingPromptBanner: {
    backgroundColor: '#e67e22',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  ratingPromptText: { color: '#fff', fontSize: 13, fontWeight: '600', flex: 1 },
  ratingPromptArrow: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  matchInfoRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  photoContainer: { position: 'relative' },
  matchPhoto: { width: 70, height: 90, borderRadius: 10, marginRight: 15 },
  miniVerifiedBadge: {
    position: 'absolute',
    bottom: 3,
    right: 18,
    backgroundColor: '#3498db',
    borderRadius: 10,
    width: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  miniVerifiedText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  noPhoto: {
    width: 70,
    height: 90,
    borderRadius: 10,
    backgroundColor: '#0f3460',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  noPhotoText: { fontSize: 30, color: '#666' },
  matchInfo: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  matchName: { fontSize: 20, fontWeight: 'bold', color: '#eee' },
  verifiedCheck: { fontSize: 16, color: '#3498db' },
  ageBadge: {
    alignSelf: 'flex-start',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
    marginBottom: 4,
  },
  ageBadgeText: { color: '#fff', fontSize: 10, fontWeight: '600' },
  matchDetails: { fontSize: 14, color: '#aaa' },
  heightContainer: { marginTop: 4 },
  personalityTag: { fontSize: 13, color: '#e67e22', marginTop: 4 },
  trustScoreContainer: { marginTop: 8 },
  noMessagesHint: { color: '#53a8b6', fontSize: 12, marginTop: 6, fontStyle: 'italic' },
  noteIndicator: {
    backgroundColor: '#9b59b6',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: 6,
  },
  noteIndicatorText: { color: '#fff', fontSize: 10, fontWeight: '600' },
  matchActions: { flexDirection: 'row', gap: 8 },
  chatButton: {
    flex: 2,
    backgroundColor: '#5cb85c',
    paddingVertical: 12,
    borderRadius: 20,
    alignItems: 'center',
  },
  chatButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  linesButton: {
    backgroundColor: '#e67e22',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linesButtonText: { fontSize: 18 },
  notesButton: {
    backgroundColor: '#9b59b6',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notesButtonText: { fontSize: 18 },
  rateButton: {
    backgroundColor: '#e67e22',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 20,
    alignItems: 'center',
  },
  rateButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  unmatchButton: {
    backgroundColor: '#0f3460',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 20,
    alignItems: 'center',
  },
  unmatchButtonDisabled: { opacity: 0.6 },
  unmatchButtonText: { fontSize: 18, color: '#d9534f', fontWeight: 'bold' },
  pullHint: { color: '#555', fontSize: 12, textAlign: 'center', marginTop: 10, marginBottom: 20 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#16213e',
    borderRadius: 20,
    padding: 25,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#eee',
    textAlign: 'center',
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    marginBottom: 20,
  },
  openingLineOption: {
    backgroundColor: '#0f3460',
    padding: 15,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#53a8b6',
  },
  openingLineText: { color: '#eee', fontSize: 15, lineHeight: 22 },
  noteInput: {
    backgroundColor: '#0f3460',
    color: '#fff',
    padding: 15,
    borderRadius: 12,
    fontSize: 15,
    minHeight: 120,
    textAlignVertical: 'top',
    marginBottom: 8,
  },
  charCount: { color: '#666', fontSize: 12, textAlign: 'right', marginBottom: 12 },
  modalButtons: { flexDirection: 'row', gap: 12 },
  modalCancelButton: {
    flex: 1,
    backgroundColor: '#0f3460',
    paddingVertical: 14,
    borderRadius: 20,
    alignItems: 'center',
  },
  modalCancelText: { color: '#888', fontSize: 16, fontWeight: '600' },
  modalSaveButton: {
    flex: 1,
    backgroundColor: '#5cb85c',
    paddingVertical: 14,
    borderRadius: 20,
    alignItems: 'center',
  },
  modalSaveButtonDisabled: { backgroundColor: '#555' },
  modalSaveText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  modalCloseButton: { marginTop: 12, paddingVertical: 12, alignItems: 'center' },
  modalCloseText: { color: '#d9534f', fontSize: 16 },
});
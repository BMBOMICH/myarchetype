import { layout, prepare } from '@chenglou/pretext';
import type { LegendListRenderItemProps } from '@legendapp/list';
import { LegendList } from '@legendapp/list';
import { observable } from '@legendapp/state';
import { observer } from '@legendapp/state/react';
import { useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  InteractionManager,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import TurboImage from '../src/components/TurboImage';
import HeightBadge from '../components/HeightBadge';
import TrustScoreDisplay from '../components/TrustScoreDisplay';
import { app, auth, db } from '../firebaseConfig';
import type { AgeVerification } from '../utils/ageVerification';
import { getAgeVerificationLevel } from '../utils/ageVerification';
import { logger } from '../utils/logger';
import {
  checkIfChatHasMessages,
  cleanupExpiredMatches,
  formatExpiryWarning,
  getMatchExpiryInfo,
} from '../utils/matchExpiration';
import { getMatchNote, saveMatchNote } from '../utils/matchNotes';
import type { OpeningLine } from '../utils/openingLines';
import { generateOpeningLines } from '../utils/openingLines';
import { checkPhotoFreshness, dismissPhotoReminder } from '../utils/photoReminders';
import { shouldPromptForRating } from '../utils/ratingSystem';

const CARD_FONT        = '13px Inter';
const CARD_LINE_HEIGHT = 1.4;

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const MATCH_INFO_WIDTH = SCREEN_WIDTH - 144;

const CARD_FIXED_HEIGHT = 262;

const EXPIRY_WARNING_HEIGHT    = 36;
const RATING_BANNER_HEIGHT     = 44;
const AGE_BADGE_HEIGHT         = 26;
const PERSONALITY_TAG_HEIGHT   = 20;
const NO_MESSAGES_HINT_HEIGHT  = 20;
const NOTE_INDICATOR_HEIGHT    = 18;
const TRUST_SCORE_VERIFIED_ONLY = 36;
const TRUST_SCORE_FULL          = 76;

const pretextCache = new Map<string, number>();

function measureSingleLine(text: string): number {
  const key = `${text}|${MATCH_INFO_WIDTH}`;
  const hit  = pretextCache.get(key);
  if (hit !== undefined) return hit;

  const prepared = prepare(text, CARD_FONT);
  const result   = layout(prepared, MATCH_INFO_WIDTH, CARD_LINE_HEIGHT);

  pretextCache.set(key, result.height);

  if (pretextCache.size > 500) {
    const oldest = pretextCache.keys().next().value;
    if (oldest) pretextCache.delete(oldest);
  }

  return result.height;
}

function measureMatchCardHeight(
  item: Match,
  hasRatingPrompt: boolean,
  hasNote: boolean,
): number {
  let height = CARD_FIXED_HEIGHT;

  if (item.isWarning === true && item.hasMessages !== true) {
    const warningText = formatExpiryWarning(item.daysRemaining ?? 0);
    height += EXPIRY_WARNING_HEIGHT + measureSingleLine(warningText);
  }

  if (hasRatingPrompt) {
    height += RATING_BANNER_HEIGHT;
  }

  const ageBadge = getAgeVerificationLevel(item.ageVerification);
  if (ageBadge.level !== 'unverified') {
    height += AGE_BADGE_HEIGHT;
  }

  if (item.personalityType) {
    height += PERSONALITY_TAG_HEIGHT;
  }

  const hasTrustScore =
    item.selfieVerified === true || (item.ratings?.totalRatings ?? 0) > 0;
  if (hasTrustScore) {
    const hasFullRatings = (item.ratings?.totalRatings ?? 0) > 0;
    height += hasFullRatings ? TRUST_SCORE_FULL : TRUST_SCORE_VERIFIED_ONLY;
  }

  if (item.hasMessages !== true && item.isWarning !== true) {
    height += NO_MESSAGES_HINT_HEIGHT;
  }

  if (hasNote) {
    height += NOTE_INDICATOR_HEIGHT;
  }

  return Math.ceil(height);
}

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

interface FirestoreMatchData {
  name?: string;
  age?: number;
  bodyType?: string;
  photos?: string[];
  personalityType?: string;
  height?: number | { value: number; verificationMethod?: string; confidence?: number };
  selfieVerified?: boolean;
  ageVerified?: boolean;
  ageVerification?: AgeVerification;
  ratings?: Match['ratings'];
}

interface MatchCardProps {
  item: Match;
  ratingPrompts: Set<string>;
  matchNotes: Map<string, string>;
  unmatchingId: string | null;
  onChat:      (uid: string, name: string) => void;
  onRate:      (uid: string, name: string) => void;
  onOpenLines: (uid: string) => void;
  onOpenNote:  (uid: string) => void;
  onUnmatch:   (match: Match) => void;
}

const MatchCard = React.memo(function MatchCard({
  item,
  ratingPrompts,
  matchNotes,
  unmatchingId,
  onChat,
  onRate,
  onOpenLines,
  onOpenNote,
  onUnmatch,
}: MatchCardProps) {
  const ageBadge       = getAgeVerificationLevel(item.ageVerification);
  const heightIsObj    = typeof item.height === 'object' && item.height !== null;
  const heightVerified = heightIsObj &&
    (item.height as { verificationMethod?: string }).verificationMethod === 'manual-measured';
  const isUnmatching   = unmatchingId === item.uid;
  const firstPhoto     = item.photos?.[0];

  const onPressChat       = useCallback(() => onChat(item.uid, item.name),  [onChat,      item.uid, item.name]);
  const onPressRate       = useCallback(() => onRate(item.uid, item.name),  [onRate,      item.uid, item.name]);
  const onPressLines      = useCallback(() => onOpenLines(item.uid),        [onOpenLines, item.uid]);
  const onPressNote       = useCallback(() => onOpenNote(item.uid),         [onOpenNote,  item.uid]);
  const onPressUnmatch    = useCallback(() => onUnmatch(item),              [onUnmatch,   item]);
  const onPressRateBanner = useCallback(() => onRate(item.uid, item.name),  [onRate,      item.uid, item.name]);

  const ageBadgeStyle = useMemo(
    () => [s.ageBadge, { backgroundColor: ageBadge.color }],
    [ageBadge.color],
  );
  const unmatchBtnStyle = useMemo(
    () => [s.unmatchButton, isUnmatching && s.unmatchButtonDisabled],
    [isUnmatching],
  );
  const saveNoteBtnStyle = useMemo(
    () => [s.saveNoteButton, s.saveNoteButtonDisabled],
    [],
  );

  return (
    <View style={s.matchCard} accessibilityLabel={`Match with ${item.name}, ${item.age} years old`}>
      {item.isWarning === true && item.hasMessages !== true && (
        <View style={s.expiryWarning} accessibilityRole="alert">
          <Text style={s.expiryWarningText}>
            {formatExpiryWarning(item.daysRemaining ?? 0)}
          </Text>
        </View>
      )}

      {ratingPrompts.has(item.uid) && (
        <TouchableOpacity
          style={s.ratingPromptBanner}
          onPress={onPressRateBanner}
          accessibilityLabel={`Rate your experience with ${item.name}`}
          accessibilityRole="button"
        >
          <Text style={s.ratingPromptText}>
            Did you meet {item.name}? Rate your experience!
          </Text>
          <Text style={s.ratingPromptArrow} accessibilityElementsHidden>→</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={s.matchInfoRow}
        onPress={onPressChat}
        accessibilityLabel={`Open chat with ${item.name}`}
        accessibilityRole="button"
      >
        {firstPhoto ? (
          <View style={s.photoContainer}>
            <TurboImage
              source={{ uri: firstPhoto }}
              style={s.matchPhoto}
              cachePolicy="dataCache"
              accessibilityLabel={`Photo of ${item.name}`}
            />
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
            {item.selfieVerified === true && (
              <Text style={s.verifiedCheck} accessibilityLabel="Verified">✓</Text>
            )}
          </View>

          {ageBadge.level !== 'unverified' && (
            <View style={ageBadgeStyle} accessibilityLabel={`Age verification: ${ageBadge.label}`}>
              <Text style={s.ageBadgeText}>{ageBadge.icon} {ageBadge.label}</Text>
            </View>
          )}

          <Text style={s.matchDetails}>{item.bodyType}</Text>

          {item.height != null && (
            <View style={s.heightContainer}>
              <HeightBadge height={item.height} />
            </View>
          )}

          {!!item.personalityType && (
            <Text style={s.personalityTag}>{item.personalityType}</Text>
          )}

          {(item.selfieVerified === true || (item.ratings?.totalRatings ?? 0) > 0) && (
            <View style={s.trustScoreContainer}>
              <TrustScoreDisplay
                ratings={item.ratings}
                selfieVerified={item.selfieVerified}
                ageVerified={item.ageVerification?.verified}
                heightVerified={heightVerified}
                size="medium"
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
        <TouchableOpacity
          style={s.chatButton}
          onPress={onPressChat}
          accessibilityLabel={`Chat with ${item.name}`}
          accessibilityRole="button"
        >
          <Text style={s.chatButtonText}>Chat</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={s.linesButton}
          onPress={onPressLines}
          accessibilityLabel="Get conversation starters"
          accessibilityRole="button"
        >
          <Text style={s.linesButtonText} accessibilityElementsHidden>💬</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={s.notesButton}
          onPress={onPressNote}
          accessibilityLabel={matchNotes.has(item.uid) ? 'Edit note' : 'Add note'}
          accessibilityRole="button"
        >
          <Text style={s.notesButtonText} accessibilityElementsHidden>
            {matchNotes.has(item.uid) ? '📝' : '📄'}
          </Text>
        </TouchableOpacity>

        {ratingPrompts.has(item.uid) && (
          <TouchableOpacity
            style={s.rateButton}
            onPress={onPressRate}
            accessibilityLabel={`Rate experience with ${item.name}`}
            accessibilityRole="button"
          >
            <Text style={s.rateButtonText}>Rate</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={unmatchBtnStyle}
          onPress={onPressUnmatch}
          disabled={isUnmatching}
          accessibilityLabel={`Unmatch with ${item.name}`}
          accessibilityRole="button"
          accessibilityState={{ disabled: isUnmatching, busy: isUnmatching }}
        >
          <Text style={s.unmatchButtonText} accessibilityElementsHidden>
            {isUnmatching ? '...' : 'X'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

const screen$ = observable({
  matches:              [] as Match[],
  loading:              true,
  refreshing:           false,
  ratingPrompts:        new Set<string>(),
  showPhotoReminder:    false,
  photoReminderMessage: '',
  showOpeningLines:     null as string | null,
  openingLines:         [] as OpeningLine[],
  showNoteModal:        null as string | null,
  currentNote:          '',
  savingNote:           false,
  matchNotes:           new Map<string, string>(),
  unmatchingId:         null as string | null,
});

export default observer(function MyMatchesScreen() {
  const router    = useRouter();
  const functions = useMemo(() => getFunctions(app, 'europe-west1'), []);
  const isMounted = useRef(true);

  const matches              = screen$.matches.get();
  const loading              = screen$.loading.get();
  const refreshing           = screen$.refreshing.get();
  const ratingPrompts        = screen$.ratingPrompts.get();
  const showPhotoReminder    = screen$.showPhotoReminder.get();
  const photoReminderMessage = screen$.photoReminderMessage.get();
  const showOpeningLines     = screen$.showOpeningLines.get();
  const openingLines         = screen$.openingLines.get();
  const showNoteModal        = screen$.showNoteModal.get();
  const currentNote          = screen$.currentNote.get();
  const savingNote           = screen$.savingNote.get();
  const matchNotes           = screen$.matchNotes.get();
  const unmatchingId         = screen$.unmatchingId.get();

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const loadMatches = useCallback(async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        setTimeout(() => router.replace('/login'), 100);
        return;
      }

      const removedCount = await cleanupExpiredMatches(user.uid);
      if (removedCount > 0) {
        logger.info(`[MyMatches] Removed ${removedCount} expired matches`);
      }

      let snap1: Awaited<ReturnType<typeof getDocs>>;
      let snap2: Awaited<ReturnType<typeof getDocs>>;
      try {
        [snap1, snap2] = await Promise.all([
          getDocs(query(
            collection(db, 'likes'),
            where('fromUserId', '==', user.uid),
            where('status', '==', 'matched'),
          )),
          getDocs(query(
            collection(db, 'likes'),
            where('toUserId', '==', user.uid),
            where('status', '==', 'matched'),
          )),
        ]);
      } catch (err: unknown) {
        logger.error('[MyMatches] Failed to fetch like docs:', err);
        return;
      }

      const matchedUsers = new Map<string, string>();
      snap1.forEach(d => {
        const data = d.data();
        matchedUsers.set(
          String(data['toUserId'] ?? ''),
          String(data['matchedAt'] ?? data['createdAt'] ?? ''),
        );
      });
      snap2.forEach(d => {
        const data   = d.data();
        const fromId = String(data['fromUserId'] ?? '');
        if (!matchedUsers.has(fromId)) {
          matchedUsers.set(fromId, String(data['matchedAt'] ?? data['createdAt'] ?? ''));
        }
      });

      const entries = [...matchedUsers.entries()];

      type MatchResult = {
        matchId: string;
        matchedAt: string;
        userData: FirestoreMatchData;
        hasMessages: boolean;
        daysRemaining: number;
        isWarning: boolean;
        isExpired: boolean;
      };

      let matchResults: Array<MatchResult | null>;
      try {
        matchResults = await Promise.all(
          entries.map(async ([matchId, matchedAt]) => {
            try {
              const [userDoc, hasMessages] = await Promise.all([
                getDoc(doc(db, 'users', matchId)),
                checkIfChatHasMessages(user.uid, matchId),
              ]);
              if (!userDoc.exists()) return null;
              const userData   = userDoc.data() as FirestoreMatchData;
              const expiryInfo = getMatchExpiryInfo(matchedAt, hasMessages);
              if (expiryInfo.isExpired) return null;
              return {
                matchId,
                matchedAt,
                userData,
                hasMessages,
                daysRemaining: expiryInfo.daysRemaining,
                isWarning:     expiryInfo.isWarning,
                isExpired:     expiryInfo.isExpired,
              };
            } catch (e: unknown) {
              logger.error('[MyMatches] Failed to fetch match detail:', e);
              return null;
            }
          }),
        );
      } catch (err: unknown) {
        logger.error('[MyMatches] Failed to fetch match details:', err);
        return;
      }

      const validMatches = matchResults.filter(
        (r): r is NonNullable<typeof r> => r !== null,
      );

      let metaResults: Array<[boolean, string]>;
      try {
        metaResults = await Promise.all(
          validMatches.map(({ matchId }) =>
            Promise.all([
              shouldPromptForRating(user.uid, matchId),
              getMatchNote(matchId),
            ]) as Promise<[boolean, string]>,
          ),
        );
      } catch (err: unknown) {
        logger.error('[MyMatches] Failed to fetch meta:', err);
        metaResults = validMatches.map(() => [false, ''] as [boolean, string]);
      }

      const matchDetails: Match[] = [];
      const promptsToShow         = new Set<string>();
      const notesMap              = new Map<string, string>();

      validMatches.forEach(
        ({ matchId, matchedAt, userData, hasMessages, daysRemaining, isWarning, isExpired }, i) => {
          matchDetails.push({
            uid:             matchId,
            name:            userData.name            ?? 'Unknown',
            age:             userData.age             ?? 0,
            bodyType:        userData.bodyType        ?? '',
            matchedAt,
            photos:          userData.photos          ?? [],
            personalityType: userData.personalityType ?? '',
            height:          userData.height,
            selfieVerified:  userData.selfieVerified  ?? false,
            ageVerified:     userData.ageVerified     ?? false,
            ageVerification: userData.ageVerification,
            ratings:         userData.ratings,
            daysRemaining,
            isWarning,
            isExpired,
            hasMessages,
          });
          const meta = metaResults[i];
          if (!meta) return;
          const [shouldPrompt, note] = meta;
          if (shouldPrompt) promptsToShow.add(matchId);
          if (note)         notesMap.set(matchId, note);
        },
      );

      matchDetails.sort((a, b) => {
        if (a.isWarning && !b.isWarning)  return -1;
        if (!a.isWarning && b.isWarning)  return  1;
        return new Date(b.matchedAt).getTime() - new Date(a.matchedAt).getTime();
      });

      if (!isMounted.current) return;
      screen$.matches.set(matchDetails);
      screen$.ratingPrompts.set(promptsToShow);
      screen$.matchNotes.set(notesMap);
    } catch (err: unknown) {
      logger.error('[MyMatches] loadMatches error:', err);
    } finally {
      if (isMounted.current) {
        screen$.loading.set(false);
        screen$.refreshing.set(false);
      }
    }
  }, [router]);

  const checkPhotos = useCallback(async () => {
    try {
      const result = await checkPhotoFreshness();
      if (result.shouldRemind && isMounted.current) {
        screen$.showPhotoReminder.set(true);
        screen$.photoReminderMessage.set(result.message);
      }
    } catch (err: unknown) {
      logger.error('[MyMatches] checkPhotos error:', err);
    }
  }, []);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      void loadMatches();
      void checkPhotos();
    });
    return () => task.cancel();
  }, [loadMatches, checkPhotos]);

  const handleRefresh = useCallback(() => {
    screen$.refreshing.set(true);
    void loadMatches();
  }, [loadMatches]);

  const handleDismissPhotoReminder = useCallback(async () => {
    screen$.showPhotoReminder.set(false);
    try {
      await dismissPhotoReminder();
    } catch (err: unknown) {
      logger.error('[MyMatches] dismissPhotoReminder error:', err);
    }
  }, []);

  const handleUpdatePhotos = useCallback(() => {
    screen$.showPhotoReminder.set(false);
    router.push('/edit-profile');
  }, [router]);

  const navigateToChat = useCallback((matchId: string, matchName: string) => {
    router.push({ pathname: '/chat', params: { matchId, matchName } });
  }, [router]);

  const navigateToRating = useCallback((matchId: string, matchName: string) => {
    router.push({ pathname: '/post-date-rating', params: { matchId, matchName } });
  }, [router]);

  const loadOpeningLines = useCallback(async (matchId: string) => {
    try {
      const lines = await generateOpeningLines(matchId);
      if (!isMounted.current) return;
      screen$.openingLines.set(lines);
      screen$.showOpeningLines.set(matchId);
    } catch (err: unknown) {
      logger.error('[MyMatches] loadOpeningLines error:', err);
      Alert.alert('Error', 'Failed to load conversation starters');
    }
  }, []);

  const handleOpenNoteModal = useCallback(async (matchId: string) => {
    try {
      const note = await getMatchNote(matchId);
      if (!isMounted.current) return;
      screen$.currentNote.set(note);
      screen$.showNoteModal.set(matchId);
    } catch (err: unknown) {
      logger.error('[MyMatches] handleOpenNoteModal error:', err);
    }
  }, []);

  const handleSaveNote = useCallback(async () => {
    const noteModal = screen$.showNoteModal.get();
    const note      = screen$.currentNote.get();
    if (!noteModal) return;
    screen$.savingNote.set(true);
    try {
      const success = await saveMatchNote(noteModal, note);
      if (!isMounted.current) return;
      if (success) {
        screen$.matchNotes.set(new Map(screen$.matchNotes.get()).set(noteModal, note));
        screen$.showNoteModal.set(null);
        Alert.alert('Saved', 'Note saved successfully');
      } else {
        Alert.alert('Error', 'Failed to save note');
      }
    } catch (err: unknown) {
      logger.error('[MyMatches] handleSaveNote error:', err);
      Alert.alert('Error', 'Failed to save note');
    } finally {
      if (isMounted.current) screen$.savingNote.set(false);
    }
  }, []);

  const doUnmatch = useCallback(async (match: Match) => {
    screen$.unmatchingId.set(match.uid);
    try {
      const callable = httpsCallable<{ otherUserId: string }, { success: boolean }>(
        functions, 'unmatchUsers',
      );
      await callable({ otherUserId: match.uid });
      if (!isMounted.current) return;
      screen$.matches.set(screen$.matches.get().filter(m => m.uid !== match.uid));
      Alert.alert('Done', `You've unmatched with ${match.name}`);
    } catch (err: unknown) {
      logger.error('[MyMatches] doUnmatch error:', err);
      Alert.alert('Error', 'Error unmatching');
    } finally {
      if (isMounted.current) screen$.unmatchingId.set(null);
    }
  }, [functions]);

  const handleUnmatch = useCallback((match: Match) => {
    Alert.alert(
      `Unmatch with ${match.name}?`,
      'This will:\n- Remove them from your matches\n- Delete your conversation\n- Cannot be undone',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unmatch', style: 'destructive', onPress: () => void doUnmatch(match) },
      ],
    );
  }, [doUnmatch]);

  const onCloseLines   = useCallback(() => screen$.showOpeningLines.set(null), []);
  const onCloseNote    = useCallback(() => screen$.showNoteModal.set(null),    []);
  const onNoteChange   = useCallback((t: string) => screen$.currentNote.set(t), []);
  const onSaveNote     = useCallback(() => void handleSaveNote(),               [handleSaveNote]);
  const onOpenLines    = useCallback((uid: string) => void loadOpeningLines(uid),    [loadOpeningLines]);
  const onOpenNote     = useCallback((uid: string) => void handleOpenNoteModal(uid), [handleOpenNoteModal]);

  const keyExtractor = useCallback((item: Match) => item.uid, []);

  const renderItem = useCallback(({ item }: LegendListRenderItemProps<Match>) => (
    <MatchCard
      item={item}
      ratingPrompts={ratingPrompts}
      matchNotes={matchNotes}
      unmatchingId={unmatchingId}
      onChat={navigateToChat}
      onRate={navigateToRating}
      onOpenLines={onOpenLines}
      onOpenNote={onOpenNote}
      onUnmatch={handleUnmatch}
    />
  ), [
    ratingPrompts, matchNotes, unmatchingId,
    navigateToChat, navigateToRating, onOpenLines, onOpenNote, handleUnmatch,
  ]);

  const estimatedItemSize = useMemo(() => {
    if (matches.length === 0) return 262;

    let total   = 0;
    let sampled = 0;
    const step  = Math.max(1, Math.floor(matches.length / Math.min(matches.length, 20)));

    for (let i = 0; i < matches.length; i += step) {
      const match = matches[i];
      if (!match) continue;
      total += measureMatchCardHeight(
        match,
        ratingPrompts.has(match.uid),
        matchNotes.has(match.uid),
      );
      sampled++;
      if (sampled >= 20) break;
    }

    return sampled > 0 ? Math.ceil(total / sampled) : 262;
  }, [matches, ratingPrompts, matchNotes]);

  const refreshControl = useMemo(() => (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={handleRefresh}
      tintColor="#6C63FF"
      colors={['#6C63FF']}
    />
  ), [refreshing, handleRefresh]);

  const saveNoteBtnStyle = useMemo(
    () => [s.saveNoteButton, savingNote && s.saveNoteButtonDisabled],
    [savingNote],
  );

  const currentLinesMatch = matches.find(m => m.uid === showOpeningLines);

  if (loading) {
    return (
      <View style={s.centered}>
        <ActivityIndicator size="large" color="#6C63FF" />
        <Text style={s.loadingText}>Loading matches…</Text>
      </View>
    );
  }

  return (
    <View style={s.container}>
      {showPhotoReminder && (
        <View style={s.photoReminderBanner} accessibilityRole="alert">
          <Text style={s.photoReminderText}>{photoReminderMessage}</Text>
          <View style={s.photoReminderButtons}>
            <TouchableOpacity
              style={s.updatePhotosButton}
              onPress={handleUpdatePhotos}
              accessibilityLabel="Update photos"
              accessibilityRole="button"
            >
              <Text style={s.updatePhotosText}>Update Photos</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.dismissReminderButton}
              onPress={() => void handleDismissPhotoReminder()}
              accessibilityLabel="Dismiss photo reminder"
              accessibilityRole="button"
            >
              <Text style={s.dismissReminderText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {matches.length === 0 ? (
        <View style={s.centered}>
          <Text style={s.emptyTitle}>No matches yet</Text>
          <Text style={s.emptySubtitle}>Keep swiping to find your match!</Text>
          <TouchableOpacity
            style={s.findMatchesButton}
            onPress={() => router.push('/matches')}
            accessibilityLabel="Find matches"
            accessibilityRole="button"
          >
            <Text style={s.findMatchesText}>Find Matches</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <LegendList
          data={matches}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          estimatedItemSize={estimatedItemSize}
          recycleItems={true}
          refreshControl={refreshControl}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}

      <Modal
        visible={showOpeningLines !== null}
        transparent
        animationType="slide"
        onRequestClose={onCloseLines}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>
              Conversation Starters with {currentLinesMatch?.name ?? ''}
            </Text>
            {openingLines.length === 0 ? (
              <ActivityIndicator color="#6C63FF" style={s.linesLoader} />
            ) : (
              openingLines.map((line, i) => (
                <TouchableOpacity
                  key={i}
                  style={s.lineItem}
                  onPress={() => {
                    const chatId = showOpeningLines ?? '';
                    const name   = currentLinesMatch?.name ?? '';
                    onCloseLines();
                    navigateToChat(chatId, name);
                  }}
                  accessibilityLabel={`Use opening line: ${line.text}`}
                  accessibilityRole="button"
                >
                  <Text style={s.lineCategory}>{line.category}</Text>
                  <Text style={s.lineText}>{line.text}</Text>
                </TouchableOpacity>
              ))
            )}
            <TouchableOpacity
              style={s.closeModalButton}
              onPress={onCloseLines}
              accessibilityLabel="Close conversation starters"
              accessibilityRole="button"
            >
              <Text style={s.closeModalText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showNoteModal !== null}
        transparent
        animationType="slide"
        onRequestClose={onCloseNote}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Match Note</Text>
            <TextInput
              style={s.noteInput}
              value={currentNote}
              onChangeText={onNoteChange}
              placeholder="Add a private note about this match…"
              placeholderTextColor="#9494B8"
              multiline
              maxLength={500}
              accessibilityLabel="Match note input"
            />
            <View style={s.noteButtons}>
              <TouchableOpacity
                style={s.cancelNoteButton}
                onPress={onCloseNote}
                accessibilityLabel="Cancel note"
                accessibilityRole="button"
              >
                <Text style={s.cancelNoteText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={saveNoteBtnStyle}
                onPress={onSaveNote}
                disabled={savingNote}
                accessibilityLabel="Save note"
                accessibilityRole="button"
                accessibilityState={{ disabled: savingNote, busy: savingNote }}
              >
                {savingNote
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={s.saveNoteText}>Save</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
});

const s = StyleSheet.create({
  container:               { flex: 1, backgroundColor: '#07070f' },
  centered:                { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 24 },
  loadingText:             { color: '#9494B8', fontSize: 14, marginTop: 8 },
  listContent:             { paddingHorizontal: 12, paddingVertical: 8 },
  matchCard:               { backgroundColor: '#111128', borderRadius: 16, marginBottom: 12, borderWidth: 1, borderColor: '#1e1e48', overflow: 'hidden' },
  expiryWarning:           { backgroundColor: '#FF6B6B22', borderBottomWidth: 1, borderBottomColor: '#FF6B6B44', paddingHorizontal: 16, paddingVertical: 8 },
  expiryWarningText:       { color: '#FF6B6B', fontSize: 12, fontWeight: '600' },
  ratingPromptBanner:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#6C63FF22', borderBottomWidth: 1, borderBottomColor: '#6C63FF44', paddingHorizontal: 16, paddingVertical: 10 },
  ratingPromptText:        { color: '#6C63FF', fontSize: 13, fontWeight: '600', flex: 1 },
  ratingPromptArrow:       { color: '#6C63FF', fontSize: 16, marginLeft: 8 },
  matchInfoRow:            { flexDirection: 'row', padding: 14, gap: 12 },
  photoContainer:          { position: 'relative' },
  matchPhoto:              { width: 80, height: 80, borderRadius: 40 },
  miniVerifiedBadge:       { position: 'absolute', bottom: 0, right: 0, width: 20, height: 20, borderRadius: 10, backgroundColor: '#6C63FF', alignItems: 'center', justifyContent: 'center' },
  miniVerifiedText:        { color: '#fff', fontSize: 10, fontWeight: '800' },
  noPhoto:                 { width: 80, height: 80, borderRadius: 40, backgroundColor: '#1e1e48', alignItems: 'center', justifyContent: 'center' },
  noPhotoText:             { color: '#9494B8', fontSize: 28 },
  matchInfo:               { flex: 1, gap: 4 },
  nameRow:                 { flexDirection: 'row', alignItems: 'center', gap: 6 },
  matchName:               { fontSize: 17, fontWeight: '700', color: '#EDEDFF' },
  verifiedCheck:           { color: '#6C63FF', fontSize: 14, fontWeight: '800' },
  ageBadge:                { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  ageBadgeText:            { fontSize: 11, fontWeight: '700', color: '#fff' },
  matchDetails:            { fontSize: 13, color: '#9494B8' },
  heightContainer:         { marginTop: 2 },
  personalityTag:          { fontSize: 12, color: '#6C63FF', fontWeight: '600' },
  trustScoreContainer:     { marginTop: 4 },
  noMessagesHint:          { fontSize: 12, color: '#64648a', fontStyle: 'italic', marginTop: 2 },
  noteIndicator:           { marginTop: 2 },
  noteIndicatorText:       { fontSize: 11, color: '#9494B8' },
  matchActions:            { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: 14 },
  chatButton:              { flex: 1, backgroundColor: '#6C63FF', paddingVertical: 10, borderRadius: 12, alignItems: 'center' },
  chatButtonText:          { color: '#fff', fontWeight: '700', fontSize: 14 },
  linesButton:             { width: 40, height: 40, borderRadius: 20, backgroundColor: '#1e1e48', alignItems: 'center', justifyContent: 'center' },
  linesButtonText:         { fontSize: 18 },
  notesButton:             { width: 40, height: 40, borderRadius: 20, backgroundColor: '#1e1e48', alignItems: 'center', justifyContent: 'center' },
  notesButtonText:         { fontSize: 18 },
  rateButton:              { paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#FFB34722', borderRadius: 12, borderWidth: 1, borderColor: '#FFB347' },
  rateButtonText:          { color: '#FFB347', fontWeight: '700', fontSize: 13 },
  unmatchButton:           { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FF6B6B22', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FF6B6B44' },
  unmatchButtonDisabled:   { opacity: 0.5 },
  unmatchButtonText:       { color: '#FF6B6B', fontWeight: '800', fontSize: 13 },
  emptyTitle:              { fontSize: 22, fontWeight: '800', color: '#EDEDFF', textAlign: 'center' },
  emptySubtitle:           { fontSize: 15, color: '#9494B8', textAlign: 'center' },
  findMatchesButton:       { marginTop: 8, backgroundColor: '#6C63FF', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 25 },
  findMatchesText:         { color: '#fff', fontWeight: '700', fontSize: 16 },
  photoReminderBanner:     { backgroundColor: '#FFB34722', borderBottomWidth: 1, borderBottomColor: '#FFB34744', paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  photoReminderText:       { color: '#FFB347', fontSize: 13, fontWeight: '600' },
  photoReminderButtons:    { flexDirection: 'row', gap: 8 },
  updatePhotosButton:      { backgroundColor: '#FFB347', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 },
  updatePhotosText:        { color: '#000', fontWeight: '700', fontSize: 13 },
  dismissReminderButton:   { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: '#FFB347' },
  dismissReminderText:     { color: '#FFB347', fontWeight: '600', fontSize: 13 },
  modalOverlay:            { flex: 1, backgroundColor: 'rgba(4,4,12,0.9)', justifyContent: 'flex-end' },
  modalCard:               { backgroundColor: '#111128', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '80%', borderWidth: 1, borderColor: '#1e1e48', gap: 12 },
  modalTitle:              { fontSize: 18, fontWeight: '800', color: '#EDEDFF', marginBottom: 4 },
  linesLoader:             { marginVertical: 24 },
  lineItem:                { backgroundColor: '#0d0d24', borderRadius: 12, padding: 14, gap: 4, borderWidth: 1, borderColor: '#28285a' },
  lineCategory:            { fontSize: 11, color: '#6C63FF', fontWeight: '700', textTransform: 'uppercase' },
  lineText:                { fontSize: 14, color: '#EDEDFF', lineHeight: 20 },
  closeModalButton:        { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  closeModalText:          { color: '#9494B8', fontSize: 15, fontWeight: '600' },
  noteInput:               { backgroundColor: '#0d0d24', borderRadius: 12, padding: 14, fontSize: 15, color: '#EDEDFF', borderWidth: 1, borderColor: '#28285a', minHeight: 100, textAlignVertical: 'top' },
  noteButtons:             { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 4 },
  cancelNoteButton:        { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10 },
  cancelNoteText:          { color: '#9494B8', fontWeight: '600', fontSize: 14 },
  saveNoteButton:          { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10, backgroundColor: '#6C63FF' },
  saveNoteButtonDisabled:  { backgroundColor: '#181834' },
  saveNoteText:            { color: '#fff', fontWeight: '700', fontSize: 14 },
});

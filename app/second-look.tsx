import type { LegendListRenderItemProps } from '@legendapp/list';
import { LegendList } from '@legendapp/list';
import { useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  InteractionManager,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import TurboImage from 'react-native-turbo-image';
import { StyleSheet } from 'react-native-unistyles';
import HeightBadge from '../components/HeightBadge';
import TrustScoreDisplay from '../components/TrustScoreDisplay';
import { auth, db } from '../firebaseConfig';
import { getAgeVerificationLevel } from '../utils/ageVerification';
import { logger } from '../utils/logger';
import {
  formatSkippedTime,
  getSkippedProfiles,
  removeFromSkipped,
  type SkippedProfile,
} from '../utils/secondLook';

const SCREEN_WIDTH = Dimensions.get('window').width;
const PHOTO_WIDTH  = SCREEN_WIDTH - 80;
const PUSH_URL     = 'https://exp.host/--/api/v2/push/send';

interface AgeVerification { verified?: boolean; level?: string; }
interface Ratings         { totalRatings?: number; }
interface HeightValue     { value: number; verificationMethod?: string; }

interface UserProfile {
  uid:               string;
  name:              string;
  age:               number;
  bodyType:          string;
  photos?:           string[];
  personalityType?:  string;
  height?:           number | HeightValue;
  selfieVerified?:   boolean;
  ageVerification?:  AgeVerification;
  bio?:              string;
  location?:         { city?: string };
  ratings?:          Ratings;
  pushToken?:        string;
  icebreaker?:       string;
  icebreakerPrompt?: string;
}

interface FirestoreUserData {
  name?:             string;
  age?:              number;
  bodyType?:         string;
  photos?:           string[];
  personalityType?:  string;
  height?:           number | HeightValue;
  selfieVerified?:   boolean;
  ageVerification?:  AgeVerification;
  bio?:              string;
  location?:         { city?: string };
  ratings?:          Ratings;
  pushToken?:        string;
  icebreaker?:       string;
  icebreakerPrompt?: string;
}

async function sendPush(token: string, title: string, body: string, type: string): Promise<void> {
  try {
    await fetch(PUSH_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ to: token, title, body, sound: 'default', data: { type } }),
    });
  } catch (err: unknown) {
    logger.warn('[SecondLook] sendPush failed:', err);
  }
}

const PhotoItem = React.memo(function PhotoItem({
  uri, index, name, photoCount,
}: { uri: string; index: number; name: string; photoCount: number }) {
  const photoStyle = useMemo(() => [styles.photo, { width: PHOTO_WIDTH }], []);
  return (
    <TurboImage
      source={{ uri }}
      style={photoStyle}
      resizeMode="cover"
      cachePolicy="dataCache"
      accessibilityLabel={`${name}'s photo ${index + 1} of ${photoCount}`}
    />
  );
});

export default function SecondLookScreen() {
  const router = useRouter();

  const [loading,           setLoading]       = useState(true);
  const [skippedList,       setSkippedList]   = useState<SkippedProfile[]>([]);
  const [profiles,          setProfiles]      = useState<UserProfile[]>([]);
  const [currentIndex,      setCurrentIndex]  = useState(0);
  const [currentPhotoIndex, setPhotoIndex]    = useState(0);
  const [actionLoading,     setActionLoading] = useState(false);

  const isMounted = useRef(true);
  const user      = auth.currentUser;

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const loadSkippedProfiles = useCallback(async () => {
    if (!user) { router.replace('/login'); return; }
    try {
      const skipped = await getSkippedProfiles();
      if (!isMounted.current) return;
      setSkippedList(skipped);
      if (skipped.length === 0) { setLoading(false); return; }

      const loadedProfiles: UserProfile[] = [];
      for (const s of skipped) {
        const uid = s.uid;
        let userDoc:  Awaited<ReturnType<typeof getDoc>>;
        let likeSnap: Awaited<ReturnType<typeof getDocs>>;
        try {
          [userDoc, likeSnap] = await Promise.all([
            getDoc(doc(db, 'users', uid).catch((e: unknown) => { if (__DEV__) console.error(e); throw e; })),
            getDocs(query(
              collection(db, 'likes'),
              where('fromUserId', '==', user.uid),
              where('toUserId',   '==', uid),
            )),
          ]);
        } catch (err: unknown) {
          logger.error('[SecondLook] Failed to fetch profile data:', err);
          continue;
        }
        if (!userDoc.exists() || !likeSnap.empty) continue;
        const data = userDoc.data() as FirestoreUserData;
        loadedProfiles.push({
          uid,
          name:             data.name             ?? 'Unknown',
          age:              data.age              ?? 0,
          bodyType:         data.bodyType         ?? '',
          photos:           data.photos           ?? [],
          personalityType:  data.personalityType  ?? '',
          height:           data.height,
          selfieVerified:   data.selfieVerified   ?? false,
          ageVerification:  data.ageVerification,
          bio:              data.bio              ?? '',
          location:         data.location,
          ratings:          data.ratings,
          pushToken:        data.pushToken,
          icebreaker:       data.icebreaker,
          icebreakerPrompt: data.icebreakerPrompt,
        });
      }
      if (isMounted.current) setProfiles(loadedProfiles);
    } catch (error: unknown) {
      logger.error('[SecondLook] Error loading skipped profiles:', error);
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, [user, router]);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      void loadSkippedProfiles();
    }, []);
    return () => task.cancel();
  }, [loadSkippedProfiles]);

  useEffect(() => {
    if (isMounted.current) setPhotoIndex(0);
  }, [currentIndex]);

  const nextProfile = useCallback(() => setCurrentIndex(prev => prev + 1), []);

  const handleLike = useCallback(async () => {
    if (!user || actionLoading) return;
    const profile = profiles[currentIndex];
    if (!profile) return;
    setActionLoading(true);
    try {
      let theirLikeSnap: Awaited<ReturnType<typeof getDocs>>;
      try {
        theirLikeSnap = await getDocs(query(
          collection(db, 'likes'),
          where('fromUserId', '==', profile.uid),
          where('toUserId',   '==', user.uid),
        ));
      } catch (err: unknown) {
        logger.error('[SecondLook] Like fetch error:', err);
        Alert.alert('Error', 'Error sending like. Please try again.');
        return;
      }

      if (!theirLikeSnap.empty) {
        const theirDoc = theirLikeSnap.docs[0];
        if (!theirDoc) throw new Error('Like doc missing');
        try {
          await Promise.all([
            setDoc(doc(db, 'likes', theirDoc.id).catch((e: unknown) => { if (__DEV__) console.error(e); throw e; }), {
              ...theirDoc.data(),
              status:    'matched',
              matchedAt: new Date().toISOString(),
            }),
            setDoc(doc(db, 'likes', `${user.uid}_${profile.uid}`), {
              fromUserId: user.uid,
              toUserId:   profile.uid,
              status:     'matched',
              createdAt:  new Date().toISOString(),
              matchedAt:  new Date().toISOString(),
            }),
          ]);
        } catch (err: unknown) {
          logger.error('[SecondLook] Match write error:', err);
          Alert.alert('Error', 'Error sending like. Please try again.');
          return;
        }
        if (profile.pushToken) {
          try {
            const senderDoc  = await getDoc(doc(db, 'users', user.uid));
            const senderName = senderDoc.exists()
              ? ((senderDoc.data() as { name?: string }).name ?? 'Someone')
              : 'Someone';
            await sendPush(profile.pushToken, "It's a Match! 💕", `${senderName} likes you too!`, 'match');
          } catch (err: unknown) {
            logger.warn('[SecondLook] Push notification failed:', err);
          }
        }
        Alert.alert("It's a Match! 💕", `You and ${profile.name} like each other!`);
      } else {
        try {
          await setDoc(doc(db, 'likes', `${user.uid}_${profile.uid}`), {
            fromUserId: user.uid,
            toUserId:   profile.uid,
            status:     'pending',
            createdAt:  new Date().toISOString(),
          });
        } catch (err: unknown) {
          logger.error('[SecondLook] Pending like write error:', err);
          Alert.alert('Error', 'Error sending like. Please try again.');
          return;
        }
        if (profile.pushToken) {
          await sendPush(profile.pushToken, 'Someone likes you! 💝', 'Open the app to see who!', 'like');
        }
        Alert.alert('Like Sent! 💝', `Like sent to ${profile.name}!`);
      }
      try {
        await removeFromSkipped(profile.uid);
      } catch (err: unknown) {
        logger.warn('[SecondLook] removeFromSkipped failed:', err);
      }
      nextProfile();
    } catch (error: unknown) {
      logger.error('[SecondLook] Error liking profile:', error);
      Alert.alert('Error', 'Error sending like. Please try again.');
    } finally {
      if (isMounted.current) setActionLoading(false);
    }
  }, [user, actionLoading, profiles, currentIndex, nextProfile]);

  const handleSkipAgain = useCallback(() => nextProfile(), [nextProfile]);

  const handleRemove = useCallback(async () => {
    const profile = profiles[currentIndex];
    if (!profile) return;
    setActionLoading(true);
    try {
      await removeFromSkipped(profile.uid);
      if (!isMounted.current) return;
      setProfiles(prev => {
        const next = prev.filter((_, i) => i !== currentIndex);
        if (currentIndex >= next.length && next.length > 0) {
          setCurrentIndex(next.length - 1);
        }
        return next;
      });
    } catch (error: unknown) {
      logger.error('[SecondLook] Error removing profile:', error);
    } finally {
      if (isMounted.current) setActionLoading(false);
    }
  }, [profiles, currentIndex]);

  const handlePhotoScroll = useCallback(
    (event: { nativeEvent: { contentOffset: { x: number } } }) => {
      setPhotoIndex(Math.round(event.nativeEvent.contentOffset.x / PHOTO_WIDTH));
    },
    [],
  );

  const onGoMatches = useCallback(() => router.push('/matches'), [router]);
  const onGoBack    = useCallback(() => router.back(),           [router]);
  const onLike      = useCallback(() => void handleLike(),       [handleLike]);
  const onRemove    = useCallback(() => void handleRemove(),     [handleRemove]);

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={styles.loadingText}>Loading profiles...</Text>
      </View>
    );
  }

  if (profiles.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyIcon} accessibilityElementsHidden>👀</Text>
        <Text style={styles.emptyTitle} accessibilityRole="header">No Profiles to Review</Text>
        <Text style={styles.emptyText}>
          When you skip someone while browsing,{'\n'}they'll appear here for a second chance.
        </Text>
        <TouchableOpacity
          style={styles.browseButton}
          onPress={onGoMatches}
          accessibilityLabel="Browse profiles"
          accessibilityRole="button"
        >
          <Text style={styles.browseButtonText}>Browse Profiles</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.backButton}
          onPress={onGoBack}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (currentIndex >= profiles.length) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyIcon} accessibilityElementsHidden>✓</Text>
        <Text style={styles.emptyTitle} accessibilityRole="header">All Done!</Text>
        <Text style={styles.emptyText}>
          You've reviewed all your skipped profiles.{'\n'}Check back later for more!
        </Text>
        <TouchableOpacity
          style={styles.browseButton}
          onPress={onGoMatches}
          accessibilityLabel="Find more matches"
          accessibilityRole="button"
        >
          <Text style={styles.browseButtonText}>Find More Matches</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.backButton}
          onPress={onGoBack}
          accessibilityLabel="Go back home"
          accessibilityRole="button"
        >
          <Text style={styles.backButtonText}>← Back Home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const profile              = profiles[currentIndex]!;
  const skippedInfo          = skippedList.find(sk => sk.uid === profile.uid);
  const photoCount           = profile.photos?.length ?? 0;
  const ageVerificationBadge = getAgeVerificationLevel(profile.ageVerification);
  const heightIsObject       = typeof profile.height === 'object' && profile.height !== null;
  const heightVerified       = heightIsObject &&
    (profile.height as HeightValue).verificationMethod === 'manual-measured';

  const ageBadgeStyle = [styles.ageBadge, { backgroundColor: ageVerificationBadge.color }];
  const likeBtnStyle  = [styles.likeButton, actionLoading && styles.likeButtonDisabled];

  const renderPhoto = ({ item: uri, index: i }: LegendListRenderItemProps<string>) => (
    <PhotoItem uri={uri} index={i} name={profile.name} photoCount={photoCount} />
  );

  const photoKeyExtractor = (uri: string, i: number) => `${uri}_${i}`;

  return (
    /*
      data={[profile]} — single-item LegendList used to get scrollable
      card body with the profile as the only item. This replaces the
      previous pattern of data={profiles} with an isCurrentProfile guard
      inside renderItem (which rendered null for all non-current items —
      wasteful virtualization of the entire profiles array).
      recycleItems={false} — profile card JSX is unique per profile.
    */
    <LegendList
      data={[profile]}
      keyExtractor={(item) => item.uid}
      recycleItems={false}
      estimatedItemSize={800}
      showsVerticalScrollIndicator={false}
      renderItem={({ item: currentProfile }: LegendListRenderItemProps<UserProfile>) => (
        <View style={styles.scrollContent}>
          <View style={styles.header}>
            <TouchableOpacity
              onPress={onGoBack}
              accessibilityLabel="Go back"
              accessibilityRole="button"
            >
              <Text style={styles.headerBack}>← Back</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle} accessibilityRole="header">👀 Second Look</Text>
            <Text
              style={styles.headerCount}
              accessibilityLabel={`Profile ${currentIndex + 1} of ${profiles.length}`}
            >
              {currentIndex + 1} of {profiles.length}
            </Text>
          </View>

          {skippedInfo && (
            <View
              style={styles.skippedBadge}
              accessibilityLabel={`Skipped ${formatSkippedTime(skippedInfo.skippedAt)}`}
            >
              <Text style={styles.skippedBadgeText}>
                Skipped {formatSkippedTime(skippedInfo.skippedAt)}
              </Text>
            </View>
          )}

          <View style={styles.card}>
            {photoCount > 0 ? (
              <View style={styles.photoContainer}>
                <LegendList
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  data={currentProfile.photos ?? []}
                  keyExtractor={photoKeyExtractor}
                  onScroll={handlePhotoScroll}
                  scrollEventThrottle={16}
                  renderItem={renderPhoto}
                  recycleItems={true}
                  estimatedItemSize={PHOTO_WIDTH}
                  accessibilityLabel={`${currentProfile.name}'s photos, ${photoCount} total`}
                />
                {photoCount > 1 && (
                  <View style={styles.photoIndicator} accessibilityElementsHidden>
                    {(currentProfile.photos ?? []).map((_, index) => (
                      <View
                        key={index}
                        style={[styles.dot, currentPhotoIndex === index && styles.dotActive]}
                      />
                    ))}
                  </View>
                )}
                {currentProfile.selfieVerified && (
                  <View style={styles.verifiedBadge} accessibilityLabel="Identity verified">
                    <Text style={styles.verifiedText} accessibilityElementsHidden>✓</Text>
                  </View>
                )}
              </View>
            ) : (
              <View style={styles.noPhoto} accessibilityLabel={`${currentProfile.name} has no photo`}>
                <Text style={styles.noPhotoText}>No Photo</Text>
              </View>
            )}

            <View style={styles.nameRow}>
              <Text style={styles.name} accessibilityRole="header">
                {currentProfile.name}, {currentProfile.age}
              </Text>
              {currentProfile.selfieVerified && (
                <Text style={styles.verifiedCheck} accessibilityLabel="Verified">✓</Text>
              )}
            </View>

            {ageVerificationBadge.level !== 'unverified' && (
              <View
                style={ageBadgeStyle}
                accessibilityLabel={`Age verification: ${ageVerificationBadge.label}`}
              >
                <Text style={styles.ageBadgeText}>{ageVerificationBadge.label}</Text>
              </View>
            )}

            {currentProfile.location?.city && (
              <Text
                style={styles.location}
                accessibilityLabel={`Location: ${currentProfile.location.city}`}
              >
                📍 {currentProfile.location.city}
              </Text>
            )}

            {currentProfile.icebreaker && (
              <View
                style={styles.icebreakerSection}
                accessibilityLabel={`Icebreaker: ${currentProfile.icebreakerPrompt ?? 'Question'}: ${currentProfile.icebreaker}`}
              >
                <Text style={styles.icebreakerLabel}>
                  💬 {currentProfile.icebreakerPrompt ?? 'Icebreaker'}
                </Text>
                <Text style={styles.icebreakerText}>{currentProfile.icebreaker}</Text>
              </View>
            )}

            {currentProfile.bio ? (
              <Text style={styles.bio} accessibilityLabel={`Bio: ${currentProfile.bio}`}>
                "{currentProfile.bio}"
              </Text>
            ) : null}

            <View style={styles.infoSection}>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Body Type</Text>
                <Text style={styles.infoValue}>{currentProfile.bodyType}</Text>
              </View>
              {currentProfile.height != null && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Height</Text>
                  <HeightBadge height={currentProfile.height} />
                </View>
              )}
              {currentProfile.personalityType && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Personality</Text>
                  <Text style={styles.personalityTag}>{currentProfile.personalityType}</Text>
                </View>
              )}
            </View>

            {(currentProfile.selfieVerified === true || (currentProfile.ratings?.totalRatings ?? 0) > 0) && (
              <View style={styles.trustSection}>
                <TrustScoreDisplay
                  ratings={currentProfile.ratings}
                  selfieVerified={currentProfile.selfieVerified}
                  ageVerified={currentProfile.ageVerification?.verified}
                  heightVerified={heightVerified}
                  size="small"
                />
              </View>
            )}
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.removeButton}
              onPress={onRemove}
              disabled={actionLoading}
              accessibilityLabel="Remove from second look list"
              accessibilityRole="button"
              accessibilityState={{ disabled: actionLoading }}
            >
              <Text style={styles.removeButtonText} accessibilityElementsHidden>✕</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.skipAgainButton}
              onPress={handleSkipAgain}
              disabled={actionLoading}
              accessibilityLabel={`Skip ${currentProfile.name} again`}
              accessibilityRole="button"
              accessibilityState={{ disabled: actionLoading }}
            >
              <Text style={styles.skipAgainButtonText}>Skip Again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={likeBtnStyle}
              onPress={onLike}
              disabled={actionLoading}
              accessibilityLabel={`Like ${currentProfile.name}`}
              accessibilityRole="button"
              accessibilityState={{ disabled: actionLoading, busy: actionLoading }}
            >
              <Text style={styles.likeButtonText}>{actionLoading ? '...' : '♥ Like'}</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.hint}>
            Give them another chance - you might have swiped too fast!
          </Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  container:           { flex: 1, backgroundColor: theme.colors.background, justifyContent: 'center', alignItems: 'center', padding: 20 },
  scrollContent:       { padding: 20, paddingBottom: 40 },
  loadingText:         { color: theme.colors.textSecondary, fontSize: 16, marginTop: 15 },
  emptyIcon:           { fontSize: 60, marginBottom: 20 },
  emptyTitle:          { fontSize: 24, fontWeight: 'bold', color: theme.colors.text, marginBottom: 15, textAlign: 'center' },
  emptyText:           { fontSize: 16, color: theme.colors.textSecondary, textAlign: 'center', lineHeight: 24, marginBottom: 30 },
  browseButton:        { backgroundColor: '#53a8b6', paddingVertical: 15, paddingHorizontal: 40, borderRadius: 25, marginBottom: 15 },
  browseButtonText:    { color: '#fff', fontSize: 18, fontWeight: '600' },
  backButton:          { padding: 10 },
  backButtonText:      { color: theme.colors.textSecondary, fontSize: 16 },
  header:              { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, marginBottom: 15 },
  headerBack:          { color: '#53a8b6', fontSize: 16 },
  headerTitle:         { color: theme.colors.text, fontSize: 18, fontWeight: 'bold' },
  headerCount:         { color: theme.colors.textSecondary, fontSize: 14 },
  skippedBadge:        { backgroundColor: '#0f3460', alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 16, borderRadius: 15, marginBottom: 15 },
  skippedBadgeText:    { color: theme.colors.textSecondary, fontSize: 12 },
  card:                { backgroundColor: '#16213e', borderRadius: 20, padding: 20, marginBottom: 20, borderWidth: 2, borderColor: '#9b59b6' },
  photoContainer:      { position: 'relative', borderRadius: 15, overflow: 'hidden', marginBottom: 15 },
  photo:               { height: 350, borderRadius: 15 },
  photoIndicator:      { position: 'absolute', bottom: 15, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot:                 { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotActive:           { backgroundColor: '#fff', width: 10, height: 10, borderRadius: 5 },
  verifiedBadge:       { position: 'absolute', top: 10, right: 10, backgroundColor: '#3498db', borderRadius: 15, width: 30, height: 30, justifyContent: 'center', alignItems: 'center' },
  verifiedText:        { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  noPhoto:             { height: 350, borderRadius: 15, backgroundColor: '#0f3460', justifyContent: 'center', alignItems: 'center', marginBottom: 15 },
  noPhotoText:         { color: '#666', fontSize: 18 },
  nameRow:             { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 },
  name:                { fontSize: 26, fontWeight: 'bold', color: theme.colors.text },
  verifiedCheck:       { fontSize: 20, color: '#3498db' },
  ageBadge:            { alignSelf: 'center', paddingVertical: 4, paddingHorizontal: 12, borderRadius: 12, marginBottom: 10 },
  ageBadgeText:        { color: '#fff', fontSize: 11, fontWeight: '600' },
  location:            { color: theme.colors.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 15 },
  icebreakerSection:   { backgroundColor: '#0f3460', borderRadius: 12, padding: 12, marginBottom: 15 },
  icebreakerLabel:     { color: '#e67e22', fontSize: 12, fontWeight: '600', marginBottom: 4 },
  icebreakerText:      { color: theme.colors.text, fontSize: 14, fontStyle: 'italic', lineHeight: 20 },
  bio:                 { color: theme.colors.textSecondary, fontSize: 15, textAlign: 'center', fontStyle: 'italic', marginBottom: 15, lineHeight: 22 },
  infoSection:         { borderTopWidth: 1, borderTopColor: '#0f3460', paddingTop: 15 },
  infoRow:             { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  infoLabel:           { color: theme.colors.textSecondary, fontSize: 14 },
  infoValue:           { color: theme.colors.text, fontSize: 14, fontWeight: '600' },
  personalityTag:      { color: '#e67e22', fontSize: 14, fontWeight: '600' },
  trustSection:        { borderTopWidth: 1, borderTopColor: '#0f3460', paddingTop: 15, marginTop: 5 },
  actions:             { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 15, marginBottom: 15 },
  removeButton:        { width: 50, height: 50, borderRadius: 25, backgroundColor: '#0f3460', justifyContent: 'center', alignItems: 'center' },
  removeButtonText:    { color: theme.colors.textSecondary, fontSize: 24, fontWeight: 'bold' },
  skipAgainButton:     { backgroundColor: '#e67e22', paddingVertical: 14, paddingHorizontal: 25, borderRadius: 25 },
  skipAgainButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  likeButton:          { backgroundColor: '#5cb85c', paddingVertical: 14, paddingHorizontal: 30, borderRadius: 25 },
  likeButtonDisabled:  { backgroundColor: '#555' },
  likeButtonText:      { color: '#fff', fontSize: 18, fontWeight: '600' },
  hint:                { color: '#666', fontSize: 13, textAlign: 'center', fontStyle: 'italic' },
}));
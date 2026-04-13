import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Dimensions, FlatList,
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import HeightBadge from '../components/HeightBadge';
import TrustScoreDisplay from '../components/TrustScoreDisplay';
import { auth, db } from '../firebaseConfig';
import { getAgeVerificationLevel } from '../utils/ageVerification';
import { logger } from '../utils/logger';
import { formatSkippedTime, getSkippedProfiles, removeFromSkipped, type SkippedProfile } from '../utils/secondLook';

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
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: token, title, body, sound: 'default', data: { type } }),
    });
  } catch (err) { logger.warn('[SecondLook] sendPush failed:', err); }
}

export default function SecondLookScreen() {
  const router = useRouter();

  const [loading, setLoading]             = useState(true);
  const [skippedList, setSkippedList]     = useState<SkippedProfile[]>([]);
  const [profiles, setProfiles]           = useState<UserProfile[]>([]);
  const [currentIndex, setCurrentIndex]   = useState(0);
  const [currentPhotoIndex, setPhotoIndex] = useState(0);
  const [actionLoading, setActionLoading] = useState(false);

  const user = auth.currentUser;

  const loadSkippedProfiles = useCallback(async () => {
    if (!user) { router.replace('/login'); return; }
    try {
      const skipped = await getSkippedProfiles();
      setSkippedList(skipped);
      if (skipped.length === 0) { setLoading(false); return; }

      const loadedProfiles: UserProfile[] = [];
      for (const s of skipped) {
        const uid = s.uid;
        const userDoc = await getDoc(doc(db, 'users', uid));
        if (!userDoc.exists()) continue;
        const data = userDoc.data() as FirestoreUserData;
        const likeSnap = await getDocs(query(
          collection(db, 'likes'),
          where('fromUserId', '==', user.uid),
          where('toUserId',   '==', uid),
        ));
        if (!likeSnap.empty) continue;
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
      setProfiles(loadedProfiles);
    } catch (error) {
      logger.error('[SecondLook] Error loading skipped profiles:', error);
    } finally {
      setLoading(false);
    }
  }, [user, router]);

  useEffect(() => { void loadSkippedProfiles(); }, [loadSkippedProfiles]);
  useEffect(() => { setPhotoIndex(0); }, [currentIndex]);

  const nextProfile = useCallback(() => setCurrentIndex(prev => prev + 1), []);

  const handleLike = useCallback(async () => {
    if (!user || actionLoading) return;
    const profile = profiles[currentIndex];
    if (!profile) return;
    setActionLoading(true);
    try {
      const theirLikeSnap = await getDocs(query(
        collection(db, 'likes'),
        where('fromUserId', '==', profile.uid),
        where('toUserId',   '==', user.uid),
      ));

      if (!theirLikeSnap.empty) {
        const theirDoc = theirLikeSnap.docs[0];
        if (!theirDoc) throw new Error('Like doc missing');
        await setDoc(doc(db, 'likes', theirDoc.id), {
          ...theirDoc.data(), status: 'matched', matchedAt: new Date().toISOString(),
        });
        await setDoc(doc(db, 'likes', `${user.uid}_${profile.uid}`), {
          fromUserId: user.uid, toUserId: profile.uid,
          status: 'matched', createdAt: new Date().toISOString(), matchedAt: new Date().toISOString(),
        });
        if (profile.pushToken) {
          const senderDoc  = await getDoc(doc(db, 'users', user.uid));
          const senderName = senderDoc.exists() ? ((senderDoc.data() as { name?: string }).name ?? 'Someone') : 'Someone';
          await sendPush(profile.pushToken, "It's a Match! 💕", `${senderName} likes you too!`, 'match');
        }
        Alert.alert("It's a Match! 💕", `You and ${profile.name} like each other!`);
      } else {
        await setDoc(doc(db, 'likes', `${user.uid}_${profile.uid}`), {
          fromUserId: user.uid, toUserId: profile.uid,
          status: 'pending', createdAt: new Date().toISOString(),
        });
        if (profile.pushToken) await sendPush(profile.pushToken, 'Someone likes you! 💝', 'Open the app to see who!', 'like');
        Alert.alert('Like Sent! 💝', `Like sent to ${profile.name}!`);
      }
      await removeFromSkipped(profile.uid);
      nextProfile();
    } catch (error) {
      logger.error('[SecondLook] Error liking profile:', error);
      Alert.alert('Error', 'Error sending like. Please try again.');
    } finally {
      setActionLoading(false);
    }
  }, [user, actionLoading, profiles, currentIndex, nextProfile]);

  const handleSkipAgain = useCallback(() => nextProfile(), [nextProfile]);

  const handleRemove = useCallback(async () => {
    const profile = profiles[currentIndex];
    if (!profile) return;
    setActionLoading(true);
    try {
      await removeFromSkipped(profile.uid);
      setProfiles(prev => {
        const next = prev.filter((_, i) => i !== currentIndex);
        if (currentIndex >= next.length && next.length > 0) setCurrentIndex(next.length - 1);
        return next;
      });
    } catch (error) {
      logger.error('[SecondLook] Error removing profile:', error);
    } finally {
      setActionLoading(false);
    }
  }, [profiles, currentIndex]);

  const handlePhotoScroll = useCallback((event: { nativeEvent: { contentOffset: { x: number } } }) => {
    setPhotoIndex(Math.round(event.nativeEvent.contentOffset.x / PHOTO_WIDTH));
  }, []);

  if (loading) return (
    <View style={s.container}>
      <ActivityIndicator size="large" color="#53a8b6" />
      <Text style={s.loadingText}>Loading profiles...</Text>
    </View>
  );

  if (profiles.length === 0) return (
    <View style={s.container}>
      <Text style={s.emptyIcon} accessibilityElementsHidden>👀</Text>
      <Text style={s.emptyTitle} accessibilityRole="header">No Profiles to Review</Text>
      <Text style={s.emptyText}>When you skip someone while browsing,{'\n'}they'll appear here for a second chance.</Text>
      <TouchableOpacity style={s.browseButton} onPress={() => router.push('/matches')} accessibilityLabel="Browse profiles" accessibilityRole="button">
        <Text style={s.browseButtonText}>Browse Profiles</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.backButton} onPress={() => router.back()} accessibilityLabel="Go back" accessibilityRole="button">
        <Text style={s.backButtonText}>← Back</Text>
      </TouchableOpacity>
    </View>
  );

  if (currentIndex >= profiles.length) return (
    <View style={s.container}>
      <Text style={s.emptyIcon} accessibilityElementsHidden>✓</Text>
      <Text style={s.emptyTitle} accessibilityRole="header">All Done!</Text>
      <Text style={s.emptyText}>You've reviewed all your skipped profiles.{'\n'}Check back later for more!</Text>
      <TouchableOpacity style={s.browseButton} onPress={() => router.push('/matches')} accessibilityLabel="Find more matches" accessibilityRole="button">
        <Text style={s.browseButtonText}>Find More Matches</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.backButton} onPress={() => router.back()} accessibilityLabel="Go back home" accessibilityRole="button">
        <Text style={s.backButtonText}>← Back Home</Text>
      </TouchableOpacity>
    </View>
  );

  const profile              = profiles[currentIndex]!;
  const skippedInfo          = skippedList.find(sk => sk.uid === profile.uid);
  const photoCount           = profile.photos?.length ?? 0;
  const ageVerificationBadge = getAgeVerificationLevel(profile.ageVerification);
  const heightIsObject       = typeof profile.height === 'object' && profile.height !== null;
  const heightVerified       = heightIsObject && (profile.height as HeightValue).verificationMethod === 'manual-measured';

  return (
    <ScrollView style={s.scrollContainer} contentContainerStyle={s.scrollContent}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Go back" accessibilityRole="button">
          <Text style={s.headerBack}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle} accessibilityRole="header">👀 Second Look</Text>
        <Text style={s.headerCount} accessibilityLabel={`Profile ${currentIndex + 1} of ${profiles.length}`}>
          {currentIndex + 1} of {profiles.length}
        </Text>
      </View>

      {skippedInfo && (
        <View style={s.skippedBadge} accessibilityLabel={`Skipped ${formatSkippedTime(skippedInfo.skippedAt)}`}>
          <Text style={s.skippedBadgeText}>Skipped {formatSkippedTime(skippedInfo.skippedAt)}</Text>
        </View>
      )}

      <View style={s.card}>
        {photoCount > 0 ? (
          <View style={s.photoContainer}>
            <FlatList
              horizontal pagingEnabled showsHorizontalScrollIndicator={false}
              data={profile.photos} keyExtractor={(uri, i) => `${uri}_${i}`}
              onScroll={handlePhotoScroll} scrollEventThrottle={16}
              renderItem={({ item: uri, index: i }) => (
                <Image source={{ uri }} style={[s.photo, { width: PHOTO_WIDTH }]} contentFit="cover"
                  accessibilityLabel={`${profile.name}'s photo ${i + 1} of ${photoCount}`} />
              )}
              accessibilityLabel={`${profile.name}'s photos, ${photoCount} total`}
            />
            {photoCount > 1 && (
              <View style={s.photoIndicator} accessibilityElementsHidden>
                {profile.photos!.map((_, index) => (
                  <View key={index} style={[s.dot, currentPhotoIndex === index && s.dotActive]} />
                ))}
              </View>
            )}
            {profile.selfieVerified && (
              <View style={s.verifiedBadge} accessibilityLabel="Identity verified">
                <Text style={s.verifiedText} accessibilityElementsHidden>✓</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={s.noPhoto} accessibilityLabel={`${profile.name} has no photo`}>
            <Text style={s.noPhotoText}>No Photo</Text>
          </View>
        )}

        <View style={s.nameRow}>
          <Text style={s.name} accessibilityRole="header">{profile.name}, {profile.age}</Text>
          {profile.selfieVerified && <Text style={s.verifiedCheck} accessibilityLabel="Verified">✓</Text>}
        </View>

        {ageVerificationBadge.level !== 'unverified' && (
          <View style={[s.ageBadge, { backgroundColor: ageVerificationBadge.color }]} accessibilityLabel={`Age verification: ${ageVerificationBadge.label}`}>
            <Text style={s.ageBadgeText}>{ageVerificationBadge.label}</Text>
          </View>
        )}

        {profile.location?.city && (
          <Text style={s.location} accessibilityLabel={`Location: ${profile.location.city}`}>📍 {profile.location.city}</Text>
        )}

        {profile.icebreaker && (
          <View style={s.icebreakerSection} accessibilityLabel={`Icebreaker: ${profile.icebreakerPrompt ?? 'Question'}: ${profile.icebreaker}`}>
            <Text style={s.icebreakerLabel}>💬 {profile.icebreakerPrompt ?? 'Icebreaker'}</Text>
            <Text style={s.icebreakerText}>{profile.icebreaker}</Text>
          </View>
        )}

        {profile.bio ? <Text style={s.bio} accessibilityLabel={`Bio: ${profile.bio}`}>"{profile.bio}"</Text> : null}

        <View style={s.infoSection}>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Body Type</Text>
            <Text style={s.infoValue}>{profile.bodyType}</Text>
          </View>
          {profile.height != null && (
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Height</Text>
              <HeightBadge height={profile.height} />
            </View>
          )}
          {profile.personalityType && (
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Personality</Text>
              <Text style={s.personalityTag}>{profile.personalityType}</Text>
            </View>
          )}
        </View>

        {(profile.selfieVerified === true || (profile.ratings?.totalRatings ?? 0) > 0) && (
          <View style={s.trustSection}>
            <TrustScoreDisplay
              ratings={profile.ratings} selfieVerified={profile.selfieVerified}
              ageVerified={profile.ageVerification?.verified} heightVerified={heightVerified} size="small"
            />
          </View>
        )}
      </View>

      <View style={s.actions}>
        <TouchableOpacity style={s.removeButton} onPress={handleRemove} disabled={actionLoading}
          accessibilityLabel="Remove from second look list" accessibilityRole="button"
          accessibilityState={{ disabled: actionLoading }}>
          <Text style={s.removeButtonText} accessibilityElementsHidden>✕</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.skipAgainButton} onPress={handleSkipAgain} disabled={actionLoading}
          accessibilityLabel={`Skip ${profile.name} again`} accessibilityRole="button"
          accessibilityState={{ disabled: actionLoading }}>
          <Text style={s.skipAgainButtonText}>Skip Again</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.likeButton, actionLoading && s.likeButtonDisabled]}
          onPress={handleLike} disabled={actionLoading}
          accessibilityLabel={`Like ${profile.name}`} accessibilityRole="button"
          accessibilityState={{ disabled: actionLoading, busy: actionLoading }}>
          <Text style={s.likeButtonText}>{actionLoading ? '...' : '♥ Like'}</Text>
        </TouchableOpacity>
      </View>

      <Text style={s.hint}>Give them another chance - you might have swiped too fast!</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container:           { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center', padding: 20 },
  scrollContainer:     { flex: 1, backgroundColor: '#1a1a2e' },
  scrollContent:       { padding: 20, paddingBottom: 40 },
  loadingText:         { color: '#aaa', fontSize: 16, marginTop: 15 },
  emptyIcon:           { fontSize: 60, marginBottom: 20 },
  emptyTitle:          { fontSize: 24, fontWeight: 'bold', color: '#eee', marginBottom: 15, textAlign: 'center' },
  emptyText:           { fontSize: 16, color: '#888', textAlign: 'center', lineHeight: 24, marginBottom: 30 },
  browseButton:        { backgroundColor: '#53a8b6', paddingVertical: 15, paddingHorizontal: 40, borderRadius: 25, marginBottom: 15 },
  browseButtonText:    { color: '#fff', fontSize: 18, fontWeight: '600' },
  backButton:          { padding: 10 },
  backButtonText:      { color: '#888', fontSize: 16 },
  header:              { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, marginBottom: 15 },
  headerBack:          { color: '#53a8b6', fontSize: 16 },
  headerTitle:         { color: '#eee', fontSize: 18, fontWeight: 'bold' },
  headerCount:         { color: '#888', fontSize: 14 },
  skippedBadge:        { backgroundColor: '#0f3460', alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 16, borderRadius: 15, marginBottom: 15 },
  skippedBadgeText:    { color: '#888', fontSize: 12 },
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
  name:                { fontSize: 26, fontWeight: 'bold', color: '#eee' },
  verifiedCheck:       { fontSize: 20, color: '#3498db' },
  ageBadge:            { alignSelf: 'center', paddingVertical: 4, paddingHorizontal: 12, borderRadius: 12, marginBottom: 10 },
  ageBadgeText:        { color: '#fff', fontSize: 11, fontWeight: '600' },
  location:            { color: '#888', fontSize: 14, textAlign: 'center', marginBottom: 15 },
  icebreakerSection:   { backgroundColor: '#0f3460', borderRadius: 12, padding: 12, marginBottom: 15 },
  icebreakerLabel:     { color: '#e67e22', fontSize: 12, fontWeight: '600', marginBottom: 4 },
  icebreakerText:      { color: '#eee', fontSize: 14, fontStyle: 'italic', lineHeight: 20 },
  bio:                 { color: '#ddd', fontSize: 15, textAlign: 'center', fontStyle: 'italic', marginBottom: 15, lineHeight: 22 },
  infoSection:         { borderTopWidth: 1, borderTopColor: '#0f3460', paddingTop: 15 },
  infoRow:             { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  infoLabel:           { color: '#888', fontSize: 14 },
  infoValue:           { color: '#eee', fontSize: 14, fontWeight: '600' },
  personalityTag:      { color: '#e67e22', fontSize: 14, fontWeight: '600' },
  trustSection:        { borderTopWidth: 1, borderTopColor: '#0f3460', paddingTop: 15, marginTop: 5 },
  actions:             { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 15, marginBottom: 15 },
  removeButton:        { width: 50, height: 50, borderRadius: 25, backgroundColor: '#0f3460', justifyContent: 'center', alignItems: 'center' },
  removeButtonText:    { color: '#888', fontSize: 24, fontWeight: 'bold' },
  skipAgainButton:     { backgroundColor: '#e67e22', paddingVertical: 14, paddingHorizontal: 25, borderRadius: 25 },
  skipAgainButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  likeButton:          { backgroundColor: '#5cb85c', paddingVertical: 14, paddingHorizontal: 30, borderRadius: 25 },
  likeButtonDisabled:  { backgroundColor: '#555' },
  likeButtonText:      { color: '#fff', fontSize: 18, fontWeight: '600' },
  hint:                { color: '#666', fontSize: 13, textAlign: 'center', fontStyle: 'italic' },
});
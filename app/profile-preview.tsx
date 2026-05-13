import type { LegendListRenderItemProps } from '@legendapp/list';
import { LegendList } from '@legendapp/list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
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
import TurboImage from '../src/components/TurboImage';
import { StyleSheet } from 'react-native-unistyles';
import HeightBadge from '../components/HeightBadge';
import TrustScoreDisplay from '../components/TrustScoreDisplay';
import VerificationBadge from '../components/VerificationBadge';
import { db } from '../firebaseConfig';
import { getAgeVerificationLevel } from '../utils/ageVerification';
import { logger } from '../utils/logger';

const SCREEN_WIDTH = Dimensions.get('window').width;
const PHOTO_WIDTH  = SCREEN_WIDTH - 80;

const LOCAL = {
  white:          '#ffffff',
  cardSurface:    '#16213e',
  deepSurface:    '#0f3460',
  purple:         '#9b59b6',
  verifiedBlue:   '#3498db',
  warning:        '#e67e22',
  textMuted:      '#666666',
  overlayPhoto:   'rgba(0,0,0,0.6)',
  dotInactive:    'rgba(255,255,255,0.4)',
} as const;

interface UserRatings {
  totalRatings:            number;
  averagePhotosMatch:      number;
  heightAccuracyRate:      number;
  bodyTypeAccuracyRate:    number;
  ageAccuracyRate:         number;
  averagePersonalityMatch: number;
  averageOverall:          number;
  trustScore:              number;
}

interface UserData {
  name:              string;
  age:               number;
  bio?:              string;
  bodyType?:         string;
  lookingFor?:       string;
  photos?:           string[];
  selfieVerified?:   boolean;
  ageVerification?:  { verified?: boolean };
  height?:           number | { value: number; verificationMethod?: string };
  location?:         { city?: string };
  icebreaker?:       string;
  icebreakerPrompt?: string;
  religiousViews?:   string;
  lifestyle?:        string;
  relationshipGoal?: string;
  personalityType?:  string;
  ratings?:          UserRatings;
}

const isHeightVerified = (h: UserData['height']): boolean =>
  typeof h === 'object' && h !== null && h.verificationMethod === 'manual-measured';

interface PhotoPageProps { uri: string; index: number; total: number; }
const PhotoPage = React.memo(function PhotoPage({ uri, index, total }: PhotoPageProps) {
  return (
    <TurboImage
      source={{ uri }}
      style={[styles.matchPhoto, { width: PHOTO_WIDTH }]}
      cachePolicy="dataCache"
      accessibilityLabel={`Your photo ${index + 1} of ${total}`}
    />
  );
});

interface InfoRowProps { label: string; children: React.ReactNode; }
const InfoRow = React.memo(function InfoRow({ label, children }: InfoRowProps) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
});

interface ValueTagProps { value: string; }
const ValueTag = React.memo(function ValueTag({ value }: ValueTagProps) {
  return <Text style={styles.tag}>{value}</Text>;
});

interface SectionProps { title: string; children: React.ReactNode; bordered?: boolean; }
const Section = React.memo(function Section({ title, children, bordered }: SectionProps) {
  return (
    <View style={bordered ? styles.borderedSection : undefined}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
});

interface TipItemProps { text: string; }
const TipItem = React.memo(function TipItem({ text }: TipItemProps) {
  return <Text style={styles.tipText}>• {text}</Text>;
});

const TIPS = [
  'Check your photos - are they clear and recent?',
  'Read your bio - does it represent you well?',
  'Review your prompts - are they engaging?',
  'Make sure all info is up to date',
  'Add a video profile for better matches',
] as const;

interface PhotoCarouselProps {
  photos:            string[];
  currentPhotoIndex: number;
  onPhotoScroll:     (event: { nativeEvent: { contentOffset: { x: number } } }) => void;
  selfieVerified?:   boolean;
  ratings?:          UserRatings;
}

const PhotoCarousel = React.memo(function PhotoCarousel({
  photos,
  currentPhotoIndex,
  onPhotoScroll,
  selfieVerified,
  ratings,
}: PhotoCarouselProps) {
  const photoCount = photos.length;

  const renderPhoto = useCallback(
    ({ item, index }: LegendListRenderItemProps<string>) => (
      <PhotoPage uri={item} index={index} total={photoCount} />
    ),
    [photoCount],
  );

  const keyExtractor = useCallback((_: string, i: number) => `photo-${i}`, []);

  return (
    <View style={styles.photoCarouselContainer}>
      <LegendList
        data={photos}
        renderItem={renderPhoto}
        keyExtractor={keyExtractor}
        horizontal
        pagingEnabled
        recycleItems={true}
        estimatedItemSize={PHOTO_WIDTH}
        showsHorizontalScrollIndicator={false}
        onScroll={onPhotoScroll}
        scrollEventThrottle={16}
        style={styles.photoScroll}
        accessibilityLabel={`Your photos, ${photoCount} total`}
      />
      {photoCount > 1 && (
        <>
          <View style={styles.photoCountBadge}>
            <Text style={styles.photoCountText}>
              {currentPhotoIndex + 1} / {photoCount}
            </Text>
          </View>
          <View style={styles.photoIndicator} accessibilityElementsHidden>
            {photos.map((_, index) => (
              <View
                key={index}
                style={[styles.dot, currentPhotoIndex === index && styles.dotActive]}
              />
            ))}
          </View>
        </>
      )}
      {selfieVerified && (
        <View style={styles.photoVerifiedBadge}>
          <VerificationBadge
            selfieVerified={selfieVerified}
            ratings={ratings}
            size="small"
          />
        </View>
      )}
    </View>
  );
});

interface ProfileItem { type: 'profile'; userData: UserData; }
type ListItem = ProfileItem;

// ─── Profile card — extracted so hooks are never called after an early return ──

interface ProfileCardProps {
  userData:          UserData;
  currentPhotoIndex: number;
  onPhotoScroll:     (event: { nativeEvent: { contentOffset: { x: number } } }) => void;
  ageBadge:          ReturnType<typeof getAgeVerificationLevel> | null;
  heightVerified:    boolean;
  hasValues:         boolean;
  hasTrust:          boolean;
}

const ProfileCard = React.memo<ProfileCardProps>(({
  userData: u,
  currentPhotoIndex,
  onPhotoScroll,
  ageBadge,
  heightVerified,
  hasValues,
  hasTrust,
}) => {
  const photoCount = u.photos?.length ?? 0;
  return (
    <View style={styles.scrollContent}>
      <View style={styles.card}>
        {photoCount > 0 ? (
          <PhotoCarousel
            photos={u.photos!}
            currentPhotoIndex={currentPhotoIndex}
            onPhotoScroll={onPhotoScroll}
            selfieVerified={u.selfieVerified}
            ratings={u.ratings}
          />
        ) : (
          <View style={styles.noPhotoPlaceholder} accessibilityLabel="No photos added yet">
            <Text style={styles.noPhotoText}>No Photo</Text>
          </View>
        )}

        <View style={styles.nameSection}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{u.name}, {u.age}</Text>
            {u.selfieVerified && (
              <Text style={styles.verifiedCheckmark} accessibilityLabel="Verified">✓</Text>
            )}
          </View>
          {ageBadge && ageBadge.level !== 'unverified' && (
            <View
              style={[styles.ageBadge, { backgroundColor: ageBadge.color }]}
              accessibilityLabel={`Age verification: ${ageBadge.label}`}
            >
              <Text style={styles.ageBadgeIcon} accessibilityElementsHidden>
                {ageBadge.icon}
              </Text>
              <Text style={styles.ageBadgeText}>{ageBadge.label}</Text>
            </View>
          )}
        </View>

        <Text style={styles.lastSeenText}>Online status hidden in preview</Text>

        {u.icebreaker && (
          <View
            style={styles.icebreakerSection}
            accessibilityLabel={`Icebreaker: ${u.icebreakerPrompt ?? 'Question'}: ${u.icebreaker}`}
          >
            <Text style={styles.icebreakerLabel}>
              💬 {u.icebreakerPrompt ?? 'Icebreaker'}
            </Text>
            <Text style={styles.icebreakerText}>{u.icebreaker}</Text>
          </View>
        )}

        {u.bio && (
          <Section title="About Me">
            <Text style={styles.bioText}>"{u.bio}"</Text>
          </Section>
        )}

        <View style={styles.infoSection}>
          <InfoRow label="Height"><HeightBadge height={u.height} /></InfoRow>
          <InfoRow label="Body Type"><Text style={styles.value}>{u.bodyType}</Text></InfoRow>
          <InfoRow label="Looking For"><Text style={styles.value}>{u.lookingFor}</Text></InfoRow>
          {u.location?.city && (
            <InfoRow label="Location">
              <Text style={styles.value}>{u.location.city}</Text>
            </InfoRow>
          )}
        </View>

        {hasTrust && (
          <Section title="Trust & Verification" bordered>
            <TrustScoreDisplay
              ratings={u.ratings}
              selfieVerified={u.selfieVerified}
              ageVerified={u.ageVerification?.verified}
              heightVerified={heightVerified}
              size="small"
            />
          </Section>
        )}

        {hasValues && (
          <Section title="Beliefs & Values" bordered>
            {u.religiousViews && (
              <InfoRow label="Views"><ValueTag value={u.religiousViews} /></InfoRow>
            )}
            {u.lifestyle && (
              <InfoRow label="Lifestyle"><ValueTag value={u.lifestyle} /></InfoRow>
            )}
            {u.relationshipGoal && (
              <InfoRow label="Goal"><ValueTag value={u.relationshipGoal} /></InfoRow>
            )}
          </Section>
        )}

        {u.personalityType && (
          <Section title="Personality" bordered>
            <View style={styles.personalityBadge}>
              <Text style={styles.personalityText}>{u.personalityType}</Text>
            </View>
          </Section>
        )}
      </View>
    </View>
  );
});
ProfileCard.displayName = 'ProfileCard';

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProfilePreviewScreen() {
  const router = useRouter();
  const { userId } = useLocalSearchParams();

  const [userData,          setUserData]  = useState<UserData | null>(null);
  const [loading,           setLoading]   = useState(true);
  const [currentPhotoIndex, setPhotoIndex] = useState(0);
  const isMounted                          = useRef(true);

  const loadProfile = useCallback(async () => {
    if (!userId || typeof userId !== 'string') {
      Alert.alert('Error', 'Invalid user ID');
      router.back();
      return;
    }
    try {
      const snap = await getDoc(doc(db, 'users', userId));
      if (!isMounted.current) return;
      if (snap.exists()) { setUserData(snap.data() as UserData); }
      else { Alert.alert('Not Found', 'Profile not found'); router.back(); }
    } catch (error) {
      logger.error('[ProfilePreview] loadProfile error:', error);
      if (!isMounted.current) return;
      Alert.alert('Error', 'Error loading profile');
      router.back();
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, [userId, router]);

  useEffect(() => {
    isMounted.current = true;
    const task = InteractionManager.runAfterInteractions(() => {
      void loadProfile();
    });
    return () => {
      isMounted.current = false;
      task.cancel();
    };
  }, [loadProfile]);

  const handleBack = useCallback(() => router.back(), [router]);

  const handlePhotoScroll = useCallback(
    (event: { nativeEvent: { contentOffset: { x: number } } }) => {
      setPhotoIndex(Math.round(event.nativeEvent.contentOffset.x / PHOTO_WIDTH));
    },
    [],
  );

  // All hooks called unconditionally before any early return
  const ageBadge       = useMemo(() => userData ? getAgeVerificationLevel(userData.ageVerification) : null, [userData]);
  const heightVerified = useMemo(() => userData ? isHeightVerified(userData.height) : false, [userData]);
  const hasValues      = useMemo(() => !!(userData?.religiousViews || userData?.lifestyle || userData?.relationshipGoal), [userData]);
  const hasTrust       = useMemo(() => !!(userData?.selfieVerified || (userData?.ratings?.totalRatings ?? 0) > 0), [userData]);

  const ListHeader = useMemo(() => (
    <>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack}
          style={styles.backButtonContainer}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile Preview</Text>
        <View style={styles.headerSpacer} />
      </View>
      <View style={styles.notice}>
        <Text style={styles.noticeIcon} accessibilityElementsHidden>👁️</Text>
        <Text style={styles.noticeText}>This is how others see your profile</Text>
      </View>
    </>
  ), [handleBack]);

  const ListFooter = useMemo(() => (
    <View style={styles.footerPad}>
      <View style={styles.tipBox}>
        <Text style={styles.tipTitle}>💡 Tips to improve your profile:</Text>
        {TIPS.map((tip) => <TipItem key={tip} text={tip} />)}
      </View>
      <TouchableOpacity
        style={styles.editButton}
        onPress={handleBack}
        accessibilityLabel="Edit your profile"
        accessibilityRole="button"
      >
        <Text style={styles.editButtonText}>✏️ Edit Profile</Text>
      </TouchableOpacity>
    </View>
  ), [handleBack]);

  const keyExtractor = useCallback((item: ListItem) => item.type, []);

  const renderItem = useCallback(
    ({ item }: LegendListRenderItemProps<ListItem>) => (
      <ProfileCard
        userData={item.userData}
        currentPhotoIndex={currentPhotoIndex}
        onPhotoScroll={handlePhotoScroll}
        ageBadge={ageBadge}
        heightVerified={heightVerified}
        hasValues={hasValues}
        hasTrust={hasTrust}
      />
    ),
    [currentPhotoIndex, handlePhotoScroll, ageBadge, heightVerified, hasValues, hasTrust],
  );

  // Early returns come AFTER all hooks
  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={styles.loadingText}>Loading your profile...</Text>
      </View>
    );
  }

  if (!userData) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Profile not found</Text>
      </View>
    );
  }

  const profileData: ListItem[] = [{ type: 'profile', userData }];

  return (
    <View style={styles.container}>
      <LegendList
        data={profileData}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        estimatedItemSize={900}
        recycleItems={false}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={ListFooter}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container:              { flex: 1, backgroundColor: theme.colors.background },

  header:                 { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 15, backgroundColor: LOCAL.cardSurface, borderBottomWidth: 1, borderBottomColor: LOCAL.deepSurface },
  backButtonContainer:    { padding: 5 },
  backButtonText:         { color: theme.colors.primary, fontSize: 16, fontWeight: '600' },
  headerTitle:            { color: theme.colors.text, fontSize: 20, fontWeight: 'bold' },
  headerSpacer:           { width: 60 },

  notice:                 { backgroundColor: LOCAL.purple, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 12 },
  noticeIcon:             { fontSize: 20 },
  noticeText:             { color: LOCAL.white, fontSize: 14, fontWeight: '600' },

  loadingText:            { color: theme.colors.textSecondary, fontSize: 16, marginTop: 20, textAlign: 'center' },
  errorText:              { color: theme.colors.error, fontSize: 16 },

  scrollContent:          { padding: 20, alignItems: 'center' },
  footerPad:              { paddingHorizontal: 20, paddingBottom: 40, alignItems: 'center', width: '100%' },

  card:                   { backgroundColor: LOCAL.cardSurface, borderRadius: 20, padding: 20, marginBottom: 15, borderWidth: 2, borderColor: LOCAL.deepSurface, width: '100%' },

  photoCarouselContainer: { position: 'relative', marginBottom: 15, borderRadius: 15, overflow: 'hidden' },
  photoScroll:            { borderRadius: 15 },
  matchPhoto:             { height: 400, borderRadius: 15 },
  photoCountBadge:        { position: 'absolute', top: 10, right: 10, backgroundColor: LOCAL.overlayPhoto, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12 },
  photoCountText:         { color: LOCAL.white, fontSize: 12, fontWeight: '600' },
  photoIndicator:         { position: 'absolute', bottom: 15, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot:                    { width: 8, height: 8, borderRadius: 4, backgroundColor: LOCAL.dotInactive },
  dotActive:              { backgroundColor: LOCAL.white, width: 10, height: 10, borderRadius: 5 },
  photoVerifiedBadge:     { position: 'absolute', top: 10, left: 10 },
  noPhotoPlaceholder:     { width: '100%', height: 400, borderRadius: 15, backgroundColor: LOCAL.deepSurface, justifyContent: 'center', alignItems: 'center', marginBottom: 15 },
  noPhotoText:            { color: LOCAL.textMuted, fontSize: 18 },

  nameSection:            { alignItems: 'center', marginBottom: 10 },
  nameRow:                { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  name:                   { fontSize: 30, fontWeight: 'bold', color: theme.colors.text, textAlign: 'center' },
  verifiedCheckmark:      { fontSize: 24, color: LOCAL.verifiedBlue },
  ageBadge:               { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 12, borderRadius: 12 },
  ageBadgeIcon:           { fontSize: 14, marginRight: 4, color: LOCAL.white },
  ageBadgeText:           { color: LOCAL.white, fontSize: 12, fontWeight: '600' },

  lastSeenText:           { color: theme.colors.textSecondary, fontSize: 12, textAlign: 'center', marginBottom: 5, fontStyle: 'italic' },

  icebreakerSection:      { backgroundColor: LOCAL.deepSurface, borderRadius: 15, padding: 15, marginBottom: 15 },
  icebreakerLabel:        { color: LOCAL.warning, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  icebreakerText:         { color: theme.colors.text, fontSize: 15, fontStyle: 'italic', lineHeight: 22 },

  borderedSection:        { borderTopWidth: 1, borderTopColor: LOCAL.deepSurface, paddingTop: 15, marginTop: 10, marginBottom: 5 },
  bioText:                { color: theme.colors.textSecondary, fontSize: 15, lineHeight: 22, fontStyle: 'italic' },
  infoSection:            { marginBottom: 5 },
  sectionTitle:           { color: theme.colors.primary, fontSize: 16, fontWeight: '600', marginBottom: 12 },
  infoRow:                { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  label:                  { color: theme.colors.textSecondary, fontSize: 15 },
  value:                  { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
  tag:                    { backgroundColor: LOCAL.deepSurface, color: theme.colors.textSecondary, paddingVertical: 5, paddingHorizontal: 14, borderRadius: 12, fontSize: 14 },

  personalityBadge:       { backgroundColor: LOCAL.warning, paddingVertical: 8, paddingHorizontal: 24, borderRadius: 20, marginBottom: 8, alignSelf: 'center' },
  personalityText:        { color: LOCAL.white, fontSize: 16, fontWeight: 'bold' },

  tipBox:                 { backgroundColor: LOCAL.cardSurface, borderRadius: 15, padding: 16, marginTop: 20, marginBottom: 15, borderWidth: 1, borderColor: theme.colors.primary, width: '100%' },
  tipTitle:               { color: theme.colors.primary, fontSize: 16, fontWeight: 'bold', marginBottom: 10 },
  tipText:                { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 22 },

  editButton:             { backgroundColor: LOCAL.verifiedBlue, paddingVertical: 15, paddingHorizontal: 40, borderRadius: 25, marginBottom: 20 },
  editButtonText:         { color: LOCAL.white, fontSize: 16, fontWeight: 'bold' },
}));
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Dimensions, FlatList, Image,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import HeightBadge from '../components/HeightBadge';
import TrustScoreDisplay from '../components/TrustScoreDisplay';
import VerificationBadge from '../components/VerificationBadge';
import { db } from '../firebaseConfig';
import { getAgeVerificationLevel } from '../utils/ageVerification';
import { logger } from '../utils/logger';

const SCREEN_WIDTH = Dimensions.get('window').width;
const PHOTO_WIDTH  = SCREEN_WIDTH - 80;

// ─── Types ────────────────────────────────────────────────

interface UserRatings {
  totalRatings: number; averagePhotosMatch: number; heightAccuracyRate: number;
  bodyTypeAccuracyRate: number; ageAccuracyRate: number; averagePersonalityMatch: number;
  averageOverall: number; trustScore: number;
}

interface UserData {
  name: string; age: number; bio?: string; bodyType?: string; lookingFor?: string;
  photos?: string[]; selfieVerified?: boolean; ageVerification?: { verified?: boolean };
  height?: number | { value: number; verificationMethod?: string };
  location?: { city?: string };
  icebreaker?: string; icebreakerPrompt?: string;
  religiousViews?: string; lifestyle?: string; relationshipGoal?: string;
  personalityType?: string; ratings?: UserRatings;
}

// ─── Helpers ──────────────────────────────────────────────

const isHeightVerified = (h: UserData['height']): boolean =>
  typeof h === 'object' && h !== null && h.verificationMethod === 'manual-measured';

// ─── Sub-components ───────────────────────────────────────

interface PhotoPageProps { uri: string; index: number; total: number; }
const PhotoPage = React.memo(function PhotoPage({ uri, index, total }: PhotoPageProps) {
  return <Image source={{ uri }} style={[styles.matchPhoto, { width: PHOTO_WIDTH }]} accessibilityLabel={`Your photo ${index + 1} of ${total}`} />;
});

interface InfoRowProps { label: string; children: React.ReactNode; }
const InfoRow = React.memo(function InfoRow({ label, children }: InfoRowProps) {
  return <View style={styles.infoRow}><Text style={styles.label}>{label}</Text>{children}</View>;
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

// ─── Main Component ───────────────────────────────────────

export default function ProfilePreviewScreen() {
  const router = useRouter();
  const { userId } = useLocalSearchParams();

  const [userData, setUserData]            = useState<UserData | null>(null);
  const [loading, setLoading]              = useState(true);
  const [currentPhotoIndex, setPhotoIndex] = useState(0);

  const loadProfile = useCallback(async () => {
    if (!userId || typeof userId !== 'string') {
      Alert.alert('Error', 'Invalid user ID');
      router.back();
      return;
    }
    try {
      const snap = await getDoc(doc(db, 'users', userId));
      if (snap.exists()) { setUserData(snap.data() as UserData); }
      else { Alert.alert('Not Found', 'Profile not found'); router.back(); }
    } catch (error) {
      logger.error('[ProfilePreview] loadProfile error:', error);
      Alert.alert('Error', 'Error loading profile');
      router.back();
    } finally { setLoading(false); }
  }, [userId, router]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const handleBack = useCallback(() => router.back(), [router]);

  const handlePhotoScroll = useCallback((event: { nativeEvent: { contentOffset: { x: number } } }) => {
    setPhotoIndex(Math.round(event.nativeEvent.contentOffset.x / PHOTO_WIDTH));
  }, []);

  // ── FlatList renderers ────────────────────────────────
  const renderPhoto = useCallback(({ item, index }: { item: string; index: number }) => (
    <PhotoPage uri={item} index={index} total={userData?.photos?.length ?? 0} />
  ), [userData?.photos?.length]);

  const photoKeyExtractor = useCallback((_: string, i: number) => `photo-${i}`, []);

  // ── Derived data ──────────────────────────────────────
  const photoCount = userData?.photos?.length ?? 0;
  const ageBadge   = useMemo(() => userData ? getAgeVerificationLevel(userData.ageVerification) : null, [userData]);
  const heightVerified = useMemo(() => userData ? isHeightVerified(userData.height) : false, [userData]);

  const hasValues = useMemo(() =>
    !!(userData?.religiousViews || userData?.lifestyle || userData?.relationshipGoal),
  [userData?.religiousViews, userData?.lifestyle, userData?.relationshipGoal]);

  const hasTrust = useMemo(() =>
    !!(userData?.selfieVerified || (userData?.ratings?.totalRatings ?? 0) > 0),
  [userData?.selfieVerified, userData?.ratings?.totalRatings]);

  // ── Loading state ─────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={styles.loadingText}>Loading your profile...</Text>
      </View>
    );
  }

  if (!userData) {
    return <View style={styles.container}><Text style={styles.errorText}>Profile not found</Text></View>;
  }

  // ── Header component (rendered by FlatList) ───────────

  const ListHeader = (
    <>
      {/* Photos */}
      {photoCount > 0 ? (
        <View style={styles.photoCarouselContainer}>
          <FlatList
            data={userData.photos!}
            renderItem={renderPhoto}
            keyExtractor={photoKeyExtractor}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={handlePhotoScroll}
            scrollEventThrottle={16}
            style={styles.photoScroll}
            accessibilityLabel={`Your photos, ${photoCount} total`}
            getItemLayout={(_, index) => ({ length: PHOTO_WIDTH, offset: PHOTO_WIDTH * index, index })}
          />
          {photoCount > 1 && (
            <>
              <View style={styles.photoCountBadge}>
                <Text style={styles.photoCountText}>{currentPhotoIndex + 1} / {photoCount}</Text>
              </View>
              <View style={styles.photoIndicator}>
                {userData.photos!.map((_, index) => (
                  <View key={index} style={[styles.dot, currentPhotoIndex === index && styles.dotActive]} />
                ))}
              </View>
            </>
          )}
          {userData.selfieVerified && (
            <View style={styles.photoVerifiedBadge}>
              <VerificationBadge selfieVerified={userData.selfieVerified} ratings={userData.ratings} size="small" />
            </View>
          )}
        </View>
      ) : (
        <View style={styles.noPhotoPlaceholder} accessibilityLabel="No photos added yet">
          <Text style={styles.noPhotoText}>No Photo</Text>
        </View>
      )}

      {/* Name & Age */}
      <View style={styles.nameSection}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{userData.name}, {userData.age}</Text>
          {userData.selfieVerified && <Text style={styles.verifiedCheckmark} accessibilityLabel="Verified">✓</Text>}
        </View>
        {ageBadge && ageBadge.level !== 'unverified' && (
          <View style={[styles.ageBadge, { backgroundColor: ageBadge.color }]} accessibilityLabel={`Age verification: ${ageBadge.label}`}>
            <Text style={styles.ageBadgeIcon}>{ageBadge.icon}</Text>
            <Text style={styles.ageBadgeText}>{ageBadge.label}</Text>
          </View>
        )}
      </View>

      <Text style={styles.lastSeenText}>Online status hidden in preview</Text>

      {/* Icebreaker */}
      {userData.icebreaker && (
        <View style={styles.icebreakerSection}>
          <Text style={styles.icebreakerLabel}>💬 {userData.icebreakerPrompt || 'Icebreaker'}</Text>
          <Text style={styles.icebreakerText}>{userData.icebreaker}</Text>
        </View>
      )}

      {/* Bio */}
      {userData.bio && (
        <Section title="About Me">
          <Text style={styles.bioText}>"{userData.bio}"</Text>
        </Section>
      )}

      {/* Basic Info */}
      <View style={styles.infoSection}>
        <InfoRow label="Height"><HeightBadge height={userData.height} /></InfoRow>
        <InfoRow label="Body Type"><Text style={styles.value}>{userData.bodyType}</Text></InfoRow>
        <InfoRow label="Looking For"><Text style={styles.value}>{userData.lookingFor}</Text></InfoRow>
        {userData.location?.city && (
          <InfoRow label="Location"><Text style={styles.value}>{userData.location.city}</Text></InfoRow>
        )}
      </View>

      {/* Trust */}
      {hasTrust && (
        <Section title="Trust & Verification" bordered>
          <TrustScoreDisplay
            ratings={userData.ratings}
            selfieVerified={userData.selfieVerified}
            ageVerified={userData.ageVerification?.verified}
            heightVerified={heightVerified}
            size="small"
          />
        </Section>
      )}

      {/* Values */}
      {hasValues && (
        <Section title="Beliefs & Values" bordered>
          {userData.religiousViews   && <InfoRow label="Views"><ValueTag value={userData.religiousViews} /></InfoRow>}
          {userData.lifestyle        && <InfoRow label="Lifestyle"><ValueTag value={userData.lifestyle} /></InfoRow>}
          {userData.relationshipGoal && <InfoRow label="Goal"><ValueTag value={userData.relationshipGoal} /></InfoRow>}
        </Section>
      )}

      {/* Personality */}
      {userData.personalityType && (
        <Section title="Personality" bordered>
          <View style={styles.personalityBadge}>
            <Text style={styles.personalityText}>{userData.personalityType}</Text>
          </View>
        </Section>
      )}
    </>
  );

  // ── Footer component ──────────────────────────────────

  const ListFooter = (
    <>
      <View style={styles.tipBox}>
        <Text style={styles.tipTitle}>💡 Tips to improve your profile:</Text>
        {TIPS.map(tip => <TipItem key={tip} text={tip} />)}
      </View>

      <TouchableOpacity style={styles.editButton} onPress={handleBack}
        accessibilityLabel="Edit your profile" accessibilityRole="button">
        <Text style={styles.editButtonText}>✏️ Edit Profile</Text>
      </TouchableOpacity>
    </>
  );

  // ── Render via FlatList for virtualization ─────────────

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}
          accessibilityLabel="Go back" accessibilityRole="button">
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile Preview</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.notice}>
        <Text style={styles.noticeIcon}>👁️</Text>
        <Text style={styles.noticeText}>This is how others see your profile</Text>
      </View>

      <FlatList
        data={[]}
        renderItem={null}
        ListHeaderComponent={
          <View style={styles.scrollContent}>
            <View style={styles.card}>{ListHeader}</View>
            {ListFooter}
          </View>
        }
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.flatListContent}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────

const styles = StyleSheet.create({
  container:{flex:1,backgroundColor:'#1a1a2e'},
  header:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingHorizontal:20,paddingTop:60,paddingBottom:15,backgroundColor:'#16213e',borderBottomWidth:1,borderBottomColor:'#0f3460'},
  backButton:{padding:5},
  backButtonText:{color:'#53a8b6',fontSize:16,fontWeight:'600'},
  headerTitle:{color:'#eee',fontSize:20,fontWeight:'bold'},
  headerSpacer:{width:60},
  notice:{backgroundColor:'#9b59b6',flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10,paddingVertical:12},
  noticeIcon:{fontSize:20},
  noticeText:{color:'#fff',fontSize:14,fontWeight:'600'},
  loadingText:{color:'#aaa',fontSize:16,marginTop:20,textAlign:'center'},
  errorText:{color:'#d9534f',fontSize:16},
  flatListContent:{paddingBottom:20},
  scrollContent:{padding:20,alignItems:'center'},
  card:{backgroundColor:'#16213e',borderRadius:20,padding:20,marginBottom:15,borderWidth:2,borderColor:'#0f3460',width:'100%'},
  photoCarouselContainer:{position:'relative',marginBottom:15,borderRadius:15,overflow:'hidden'},
  photoScroll:{borderRadius:15},
  matchPhoto:{height:400,borderRadius:15,resizeMode:'cover'},
  photoCountBadge:{position:'absolute',top:10,right:10,backgroundColor:'rgba(0,0,0,0.6)',paddingVertical:4,paddingHorizontal:10,borderRadius:12},
  photoCountText:{color:'#fff',fontSize:12,fontWeight:'600'},
  photoIndicator:{position:'absolute',bottom:15,left:0,right:0,flexDirection:'row',justifyContent:'center',gap:6},
  dot:{width:8,height:8,borderRadius:4,backgroundColor:'rgba(255,255,255,0.4)'},
  dotActive:{backgroundColor:'#fff',width:10,height:10,borderRadius:5},
  photoVerifiedBadge:{position:'absolute',top:10,left:10},
  noPhotoPlaceholder:{width:'100%',height:400,borderRadius:15,backgroundColor:'#0f3460',justifyContent:'center',alignItems:'center',marginBottom:15},
  noPhotoText:{color:'#666',fontSize:18},
  nameSection:{alignItems:'center',marginBottom:10},
  nameRow:{flexDirection:'row',alignItems:'center',gap:8,marginBottom:8},
  name:{fontSize:30,fontWeight:'bold',color:'#eee',textAlign:'center'},
  verifiedCheckmark:{fontSize:24,color:'#3498db'},
  ageBadge:{flexDirection:'row',alignItems:'center',paddingVertical:4,paddingHorizontal:12,borderRadius:12},
  ageBadgeIcon:{fontSize:14,marginRight:4,color:'#fff'},
  ageBadgeText:{color:'#fff',fontSize:12,fontWeight:'600'},
  lastSeenText:{color:'#888',fontSize:12,textAlign:'center',marginBottom:5,fontStyle:'italic'},
  icebreakerSection:{backgroundColor:'#0f3460',borderRadius:15,padding:15,marginBottom:15},
  icebreakerLabel:{color:'#e67e22',fontSize:12,fontWeight:'600',marginBottom:6},
  icebreakerText:{color:'#eee',fontSize:15,fontStyle:'italic',lineHeight:22},
  borderedSection:{borderTopWidth:1,borderTopColor:'#0f3460',paddingTop:15,marginTop:10,marginBottom:5},
  bioText:{color:'#ddd',fontSize:15,lineHeight:22,fontStyle:'italic'},
  infoSection:{marginBottom:5},
  sectionTitle:{color:'#53a8b6',fontSize:16,fontWeight:'600',marginBottom:12},
  infoRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:12},
  label:{color:'#aaa',fontSize:15},
  value:{color:'#eee',fontSize:15,fontWeight:'600'},
  tag:{backgroundColor:'#0f3460',color:'#aaa',paddingVertical:5,paddingHorizontal:14,borderRadius:12,fontSize:14},
  personalityBadge:{backgroundColor:'#e67e22',paddingVertical:8,paddingHorizontal:24,borderRadius:20,marginBottom:8,alignSelf:'center'},
  personalityText:{color:'#fff',fontSize:16,fontWeight:'bold'},
  tipBox:{backgroundColor:'#16213e',borderRadius:15,padding:16,marginTop:20,marginBottom:15,borderWidth:1,borderColor:'#53a8b6',width:'100%'},
  tipTitle:{color:'#53a8b6',fontSize:16,fontWeight:'bold',marginBottom:10},
  tipText:{color:'#aaa',fontSize:14,lineHeight:22},
  editButton:{backgroundColor:'#3498db',paddingVertical:15,paddingHorizontal:40,borderRadius:25,marginBottom:20},
  editButtonText:{color:'#fff',fontSize:16,fontWeight:'bold'},
});
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Dimensions, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import HeightBadge from '../components/HeightBadge';
import TrustScoreDisplay from '../components/TrustScoreDisplay';
import VerificationBadge from '../components/VerificationBadge';
import { db } from '../firebaseConfig';
import { getAgeVerificationLevel } from '../utils/ageVerification';

const SCREEN_WIDTH = Dimensions.get('window').width;
const PHOTO_WIDTH = SCREEN_WIDTH - 80;

export default function ProfilePreviewScreen() {
  const router = useRouter();
  const { userId } = useLocalSearchParams();
  const [userData, setUserData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    if (!userId || typeof userId !== 'string') {
      alert('Invalid user ID');
      router.back();
      return;
    }

    try {
      const userDoc = await getDoc(doc(db, 'users', userId));
      if (userDoc.exists()) {
        const data = userDoc.data();
        setUserData({
          ...data,
          userId: userDoc.id,
          distance: 0, // Preview mode - no distance calculation
        });
      } else {
        alert('Profile not found');
        router.back();
      }
    } catch (error) {
      console.error('Error loading profile:', error);
      alert('Error loading profile');
      router.back();
    } finally {
      setLoading(false);
    }
  };

  const handlePhotoScroll = (event: any) => {
    const contentOffset = event.nativeEvent.contentOffset.x;
    const index = Math.round(contentOffset / PHOTO_WIDTH);
    setCurrentPhotoIndex(index);
  };

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

  const photoCount = userData.photos?.length || 0;
  const ageBadge = getAgeVerificationLevel(userData.ageVerification);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile Preview</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Notice Banner */}
      <View style={styles.notice}>
        <Text style={styles.noticeIcon}>👁️</Text>
        <Text style={styles.noticeText}>
          This is how others see your profile
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Profile Card - Same as matches.tsx */}
        <View style={styles.card}>
          {/* PHOTO CAROUSEL */}
          {userData.photos && userData.photos.length > 0 ? (
            <View style={styles.photoCarouselContainer}>
              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onScroll={handlePhotoScroll}
                scrollEventThrottle={16}
                style={styles.photoScroll}
              >
                {userData.photos.map((photoUrl: string, index: number) => (
                  <Image
                    key={index}
                    source={{ uri: photoUrl }}
                    style={[styles.matchPhoto, { width: PHOTO_WIDTH }]}
                  />
                ))}
              </ScrollView>

              {photoCount > 1 && (
                <View style={styles.photoCountBadge}>
                  <Text style={styles.photoCountText}>
                    {currentPhotoIndex + 1} / {photoCount}
                  </Text>
                </View>
              )}

              {photoCount > 1 && (
                <View style={styles.photoIndicator}>
                  {userData.photos.map((_: any, index: number) => (
                    <View
                      key={index}
                      style={[styles.dot, currentPhotoIndex === index && styles.dotActive]}
                    />
                  ))}
                </View>
              )}

              {userData.selfieVerified && (
                <View style={styles.photoVerifiedBadge}>
                  <VerificationBadge
                    selfieVerified={userData.selfieVerified}
                    ratings={userData.ratings}
                    size="small"
                  />
                </View>
              )}
            </View>
          ) : (
            <View style={styles.noPhotoPlaceholder}>
              <Text style={styles.noPhotoText}>No Photo</Text>
            </View>
          )}

          {/* NAME & AGE */}
          <View style={styles.nameSection}>
            <View style={styles.nameRow}>
              <Text style={styles.name}>{userData.name}, {userData.age}</Text>
              {userData.selfieVerified && (
                <Text style={styles.verifiedCheckmark}>✓</Text>
              )}
            </View>

            {ageBadge.level !== 'unverified' && (
              <View style={[styles.ageBadge, { backgroundColor: ageBadge.color }]}>
                <Text style={styles.ageBadgeIcon}>{ageBadge.icon}</Text>
                <Text style={styles.ageBadgeText}>{ageBadge.label}</Text>
              </View>
            )}
          </View>

          {/* ONLINE STATUS (always show as offline in preview) */}
          <Text style={styles.lastSeenText}>Online status hidden in preview</Text>

          {/* ICEBREAKER PROMPT */}
          {userData.icebreaker && (
            <View style={styles.icebreakerSection}>
              <Text style={styles.icebreakerLabel}>
                💬 {userData.icebreakerPrompt || 'Icebreaker'}
              </Text>
              <Text style={styles.icebreakerText}>{userData.icebreaker}</Text>
            </View>
          )}

          {/* BIO */}
          {userData.bio && (
            <View style={styles.bioSection}>
              <Text style={styles.sectionTitle}>About Me</Text>
              <Text style={styles.bioText}>"{userData.bio}"</Text>
            </View>
          )}

          {/* INFO SECTION */}
          <View style={styles.infoSection}>
            <View style={styles.infoRow}>
              <Text style={styles.label}>Height</Text>
              <HeightBadge height={userData.height} />
            </View>

            <View style={styles.infoRow}>
              <Text style={styles.label}>Body Type</Text>
              <Text style={styles.value}>{userData.bodyType}</Text>
            </View>

            <View style={styles.infoRow}>
              <Text style={styles.label}>Looking For</Text>
              <Text style={styles.value}>{userData.lookingFor}</Text>
            </View>

            {userData.location?.city && (
              <View style={styles.infoRow}>
                <Text style={styles.label}>Location</Text>
                <Text style={styles.value}>{userData.location.city}</Text>
              </View>
            )}
          </View>

          {/* TRUST & VERIFICATION */}
          {(userData.selfieVerified || (userData.ratings && userData.ratings.totalRatings > 0)) && (
            <View style={styles.verificationSection}>
              <Text style={styles.sectionTitle}>Trust & Verification</Text>
              <TrustScoreDisplay
                ratings={userData.ratings}
                selfieVerified={userData.selfieVerified}
                ageVerified={userData.ageVerification?.verified}
                heightVerified={
                  typeof userData.height === 'object' &&
                  userData.height.verificationMethod === 'manual-measured'
                }
                size="small"
              />
            </View>
          )}

          {/* BELIEFS & VALUES */}
          {(userData.religiousViews || userData.lifestyle || userData.relationshipGoal) && (
            <View style={styles.valuesSection}>
              <Text style={styles.sectionTitle}>Beliefs & Values</Text>

              {userData.religiousViews && (
                <View style={styles.infoRow}>
                  <Text style={styles.label}>Views</Text>
                  <Text style={styles.tag}>{userData.religiousViews}</Text>
                </View>
              )}

              {userData.lifestyle && (
                <View style={styles.infoRow}>
                  <Text style={styles.label}>Lifestyle</Text>
                  <Text style={styles.tag}>{userData.lifestyle}</Text>
                </View>
              )}

              {userData.relationshipGoal && (
                <View style={styles.infoRow}>
                  <Text style={styles.label}>Goal</Text>
                  <Text style={styles.tag}>{userData.relationshipGoal}</Text>
                </View>
              )}
            </View>
          )}

          {/* PERSONALITY */}
          {userData.personalityType && (
            <View style={styles.personalitySection}>
              <Text style={styles.sectionTitle}>Personality</Text>
              <View style={styles.personalityBadge}>
                <Text style={styles.personalityText}>{userData.personalityType}</Text>
              </View>
            </View>
          )}
        </View>

        {/* Tips Box */}
        <View style={styles.tipBox}>
          <Text style={styles.tipTitle}>💡 Tips to improve your profile:</Text>
          <Text style={styles.tipText}>
            • Check your photos - are they clear and recent?{'\n'}
            • Read your bio - does it represent you well?{'\n'}
            • Review your prompts - are they engaging?{'\n'}
            • Make sure all info is up to date{'\n'}
            • Add a video profile for better matches
          </Text>
        </View>

        {/* Edit Button */}
        <TouchableOpacity 
          style={styles.editButton}
          onPress={() => router.back()}
        >
          <Text style={styles.editButtonText}>✏️ Edit Profile</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 15, backgroundColor: '#16213e', borderBottomWidth: 1, borderBottomColor: '#0f3460' },
  backButton: { padding: 5 },
  backButtonText: { color: '#53a8b6', fontSize: 16, fontWeight: '600' },
  headerTitle: { color: '#eee', fontSize: 20, fontWeight: 'bold' },
  notice: { backgroundColor: '#9b59b6', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 12 },
  noticeIcon: { fontSize: 20 },
  noticeText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  loadingText: { color: '#aaa', fontSize: 16, marginTop: 20, textAlign: 'center' },
  errorText: { color: '#d9534f', fontSize: 16 },
  scrollContent: { padding: 20, alignItems: 'center' },
  
  // Profile Card (same as matches.tsx)
  card: { backgroundColor: '#16213e', borderRadius: 20, padding: 20, marginBottom: 15, borderWidth: 2, borderColor: '#0f3460', width: '100%' },
  photoCarouselContainer: { position: 'relative', marginBottom: 15, borderRadius: 15, overflow: 'hidden' },
  photoScroll: { borderRadius: 15 },
  matchPhoto: { height: 400, borderRadius: 15, resizeMode: 'cover' },
  photoCountBadge: { position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0, 0, 0, 0.6)', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12 },
  photoCountText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  photoIndicator: { position: 'absolute', bottom: 15, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255, 255, 255, 0.4)' },
  dotActive: { backgroundColor: '#fff', width: 10, height: 10, borderRadius: 5 },
  photoVerifiedBadge: { position: 'absolute', top: 10, left: 10 },
  noPhotoPlaceholder: { width: '100%', height: 400, borderRadius: 15, backgroundColor: '#0f3460', justifyContent: 'center', alignItems: 'center', marginBottom: 15 },
  noPhotoText: { color: '#666', fontSize: 18 },
  nameSection: { alignItems: 'center', marginBottom: 10 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  name: { fontSize: 30, fontWeight: 'bold', color: '#eee', textAlign: 'center' },
  verifiedCheckmark: { fontSize: 24, color: '#3498db' },
  ageBadge: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 12, borderRadius: 12 },
  ageBadgeIcon: { fontSize: 14, marginRight: 4, color: '#fff' },
  ageBadgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  lastSeenText: { color: '#888', fontSize: 12, textAlign: 'center', marginBottom: 5, fontStyle: 'italic' },
  
  // Icebreaker
  icebreakerSection: { backgroundColor: '#0f3460', borderRadius: 15, padding: 15, marginBottom: 15 },
  icebreakerLabel: { color: '#e67e22', fontSize: 12, fontWeight: '600', marginBottom: 6 },
  icebreakerText: { color: '#eee', fontSize: 15, fontStyle: 'italic', lineHeight: 22 },

  bioSection: { borderTopWidth: 1, borderTopColor: '#0f3460', paddingTop: 15, marginTop: 5, marginBottom: 10 },
  bioText: { color: '#ddd', fontSize: 15, lineHeight: 22, fontStyle: 'italic' },
  infoSection: { marginBottom: 5 },
  verificationSection: { borderTopWidth: 1, borderTopColor: '#0f3460', paddingTop: 15, marginTop: 10, marginBottom: 10 },
  valuesSection: { borderTopWidth: 1, borderTopColor: '#0f3460', paddingTop: 15, marginTop: 10, marginBottom: 5 },
  personalitySection: { borderTopWidth: 1, borderTopColor: '#0f3460', paddingTop: 15, marginTop: 10, alignItems: 'center', marginBottom: 5 },
  sectionTitle: { color: '#53a8b6', fontSize: 16, fontWeight: '600', marginBottom: 12 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  label: { color: '#aaa', fontSize: 15 },
  value: { color: '#eee', fontSize: 15, fontWeight: '600' },
  tag: { backgroundColor: '#0f3460', color: '#aaa', paddingVertical: 5, paddingHorizontal: 14, borderRadius: 12, fontSize: 14 },
  personalityBadge: { backgroundColor: '#e67e22', paddingVertical: 8, paddingHorizontal: 24, borderRadius: 20, marginBottom: 8 },
  personalityText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },

  // Tips Box
  tipBox: { backgroundColor: '#16213e', borderRadius: 15, padding: 16, marginTop: 20, marginBottom: 15, borderWidth: 1, borderColor: '#53a8b6', width: '100%' },
  tipTitle: { color: '#53a8b6', fontSize: 16, fontWeight: 'bold', marginBottom: 10 },
  tipText: { color: '#aaa', fontSize: 14, lineHeight: 22 },

  // Edit Button
  editButton: { backgroundColor: '#3498db', paddingVertical: 15, paddingHorizontal: 40, borderRadius: 25, marginBottom: 20 },
  editButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});
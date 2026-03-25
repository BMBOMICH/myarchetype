import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { auth, db } from '../firebaseConfig';

export default function PostDateRatingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { matchId, matchName } = params;
  const user = auth.currentUser;

  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'ask' | 'rate' | 'done'>('ask');

  const [photosMatch, setPhotosMatch] = useState<number | null>(null);
  const [heightAccurate, setHeightAccurate] = useState('');
  const [bodyTypeAccurate, setBodyTypeAccurate] = useState('');
  const [ageAccurate, setAgeAccurate] = useState('');
  const [personalityMatch, setPersonalityMatch] = useState<number | null>(null);
  const [overallExperience, setOverallExperience] = useState<number | null>(null);
  const [comments, setComments] = useState('');

  const isPhotoStarActive = (star: number): boolean => {
    return photosMatch !== null && photosMatch >= star;
  };

  const isPersonalityStarActive = (star: number): boolean => {
    return personalityMatch !== null && personalityMatch >= star;
  };

  const isOverallStarActive = (star: number): boolean => {
    return overallExperience !== null && overallExperience >= star;
  };

  const getStarLabel = (value: number | null): string => {
    if (value === null) return ' ';
    if (value === 1) return 'Very poor';
    if (value === 2) return 'Poor';
    if (value === 3) return 'Average';
    if (value === 4) return 'Good';
    if (value === 5) return 'Excellent';
    return ' ';
  };

  const handleDidNotMeet = async () => {
    if (!user || !matchId) return;

    try {
      await setDoc(doc(db, 'ratingStatus', user.uid + '_' + matchId), {
        raterId: user.uid,
        ratedUserId: matchId,
        rated: false,
        didNotMeet: true,
        ratedAt: new Date().toISOString(),
      });

      window.alert('Got it! We\'ll ask again later if you meet.');
      router.back();
    } catch (e) {
      console.error('Error:', e);
      router.back();
    }
  };

  const handleSubmit = async () => {
    if (!user || !matchId) return;

    if (photosMatch === null || !heightAccurate || !bodyTypeAccurate || 
        !ageAccurate || personalityMatch === null || overallExperience === null) {
      window.alert('Please answer all questions');
      return;
    }

    setLoading(true);

    try {
      const ratingId = user.uid + '_rates_' + matchId;

      // Save the individual rating
      await setDoc(doc(db, 'ratings', ratingId), {
        raterId: user.uid,
        ratedUserId: matchId,
        ratedUserName: matchName,
        didMeet: true,
        photosMatchReality: photosMatch,
        heightAccurate: heightAccurate,
        bodyTypeAccurate: bodyTypeAccurate,
        ageAccurate: ageAccurate,
        personalityMatch: personalityMatch,
        overallExperience: overallExperience,
        comments: comments.trim(),
        createdAt: new Date().toISOString(),
      });

      // Update the rated user's aggregate ratings
      const userDoc = await getDoc(doc(db, 'users', matchId as string));
      
      if (userDoc.exists()) {
        const userData = userDoc.data();
        const currentRatings = userData.ratings || {
          totalRatings: 0,
          averagePhotosMatch: 0,
          heightAccuracyRate: 0,
          bodyTypeAccuracyRate: 0,
          ageAccuracyRate: 0,
          averagePersonalityMatch: 0,
          averageOverall: 0,
        };

        const total = currentRatings.totalRatings + 1;

        // Calculate new averages
        const newAvgPhotos = ((currentRatings.averagePhotosMatch * currentRatings.totalRatings) + photosMatch) / total;
        const newAvgPersonality = ((currentRatings.averagePersonalityMatch * currentRatings.totalRatings) + personalityMatch) / total;
        const newAvgOverall = (((currentRatings.averageOverall || 0) * currentRatings.totalRatings) + overallExperience) / total;

        // Height accuracy rate (percentage of "accurate" ratings)
        const heightAccurateCount = heightAccurate === 'accurate' ? 1 : 0;
        const newHeightRate = ((currentRatings.heightAccuracyRate * currentRatings.totalRatings) + (heightAccurateCount * 100)) / total;

        // Body type accuracy rate
        const bodyAccurateCount = bodyTypeAccurate === 'accurate' ? 1 : 0;
        const newBodyRate = ((currentRatings.bodyTypeAccuracyRate * currentRatings.totalRatings) + (bodyAccurateCount * 100)) / total;

        // Age accuracy rate
        const ageAccurateCount = ageAccurate === 'accurate' ? 1 : 0;
        const newAgeRate = (((currentRatings.ageAccuracyRate || 0) * currentRatings.totalRatings) + (ageAccurateCount * 100)) / total;

        await setDoc(doc(db, 'users', matchId as string), {
          ratings: {
            totalRatings: total,
            averagePhotosMatch: Math.round(newAvgPhotos * 10) / 10,
            heightAccuracyRate: Math.round(newHeightRate),
            bodyTypeAccuracyRate: Math.round(newBodyRate),
            ageAccuracyRate: Math.round(newAgeRate),
            averagePersonalityMatch: Math.round(newAvgPersonality * 10) / 10,
            averageOverall: Math.round(newAvgOverall * 10) / 10,
          },
        }, { merge: true });

        console.log('Ratings updated for ' + matchName);
      }

      // Mark rating status
      await setDoc(doc(db, 'ratingStatus', user.uid + '_' + matchId), {
        raterId: user.uid,
        ratedUserId: matchId,
        rated: true,
        ratedAt: new Date().toISOString(),
      });

      setStep('done');

    } catch (error: any) {
      console.error('Error submitting rating:', error);
      window.alert('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // STEP 1: Ask if they met
  if (step === 'ask') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Rate Your Experience</Text>
        <Text style={styles.subtitle}>{'Did you meet ' + matchName + ' in person?'}</Text>

        <View style={styles.askBox}>
          <Text style={styles.askText}>
            Your honest rating helps build trust in the community and catches fake profiles.
          </Text>
          <Text style={styles.askNote}>
            Ratings are anonymous - they will only see aggregated scores.
          </Text>
        </View>

        <TouchableOpacity style={styles.yesBtn} onPress={() => setStep('rate')}>
          <Text style={styles.yesBtnText}>Yes, we met!</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.noBtn} onPress={handleDidNotMeet}>
          <Text style={styles.noBtnText}>Not yet</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // STEP 2: Rating form
  if (step === 'rate') {
    return (
      <ScrollView style={styles.scrollContainer} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Rate {matchName}</Text>
        <Text style={styles.subtitle}>Be honest - this helps everyone</Text>

        <View style={styles.privacyNote}>
          <Text style={styles.privacyNoteText}>
            Your rating is anonymous. {matchName} will only see aggregated scores.
          </Text>
        </View>

        {/* Photos Match */}
        <View style={styles.questionCard}>
          <Text style={styles.question}>Did their photos match reality?</Text>
          <View style={styles.starRow}>
            {[1, 2, 3, 4, 5].map((star) => (
              <TouchableOpacity
                key={star}
                style={styles.starButton}
                onPress={() => setPhotosMatch(star)}
              >
                <Text style={isPhotoStarActive(star) ? styles.starActive : styles.star}>
                  *
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.starLabel}>{getStarLabel(photosMatch)}</Text>
        </View>

        {/* Height Accuracy */}
        <View style={styles.questionCard}>
          <Text style={styles.question}>Was their height accurate?</Text>
          <Text style={styles.questionHint}>Compared to what they stated on their profile</Text>
          <View style={styles.accuracyRow}>
            <TouchableOpacity
              style={[styles.accuracyBtn, heightAccurate === 'much-less' && styles.accuracyBtnRed]}
              onPress={() => setHeightAccurate('much-less')}
            >
              <Text style={[styles.accuracyText, heightAccurate === 'much-less' && styles.accuracyTextActive]}>
                Much shorter
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.accuracyBtn, heightAccurate === 'slightly-less' && styles.accuracyBtnOrange]}
              onPress={() => setHeightAccurate('slightly-less')}
            >
              <Text style={[styles.accuracyText, heightAccurate === 'slightly-less' && styles.accuracyTextActive]}>
                Bit shorter
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.accuracyBtn, heightAccurate === 'accurate' && styles.accuracyBtnGreen]}
              onPress={() => setHeightAccurate('accurate')}
            >
              <Text style={[styles.accuracyText, heightAccurate === 'accurate' && styles.accuracyTextActive]}>
                Accurate
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.accuracyBtn, heightAccurate === 'slightly-more' && styles.accuracyBtnOrange]}
              onPress={() => setHeightAccurate('slightly-more')}
            >
              <Text style={[styles.accuracyText, heightAccurate === 'slightly-more' && styles.accuracyTextActive]}>
                Bit taller
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.accuracyBtn, heightAccurate === 'much-more' && styles.accuracyBtnRed]}
              onPress={() => setHeightAccurate('much-more')}
            >
              <Text style={[styles.accuracyText, heightAccurate === 'much-more' && styles.accuracyTextActive]}>
                Much taller
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Body Type Accuracy */}
        <View style={styles.questionCard}>
          <Text style={styles.question}>Was their body type accurate?</Text>
          <Text style={styles.questionHint}>Did it match what they selected on their profile?</Text>
          <View style={styles.accuracyRow}>
            <TouchableOpacity
              style={[styles.accuracyBtn, bodyTypeAccurate === 'very-different' && styles.accuracyBtnRed]}
              onPress={() => setBodyTypeAccurate('very-different')}
            >
              <Text style={[styles.accuracyText, bodyTypeAccurate === 'very-different' && styles.accuracyTextActive]}>
                Very different
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.accuracyBtn, bodyTypeAccurate === 'slightly-different' && styles.accuracyBtnOrange]}
              onPress={() => setBodyTypeAccurate('slightly-different')}
            >
              <Text style={[styles.accuracyText, bodyTypeAccurate === 'slightly-different' && styles.accuracyTextActive]}>
                A bit off
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.accuracyBtn, bodyTypeAccurate === 'accurate' && styles.accuracyBtnGreen]}
              onPress={() => setBodyTypeAccurate('accurate')}
            >
              <Text style={[styles.accuracyText, bodyTypeAccurate === 'accurate' && styles.accuracyTextActive]}>
                Accurate
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Age Accuracy */}
        <View style={styles.questionCard}>
          <Text style={styles.question}>Did they look the age they stated?</Text>
          <View style={styles.accuracyRow}>
            <TouchableOpacity
              style={[styles.accuracyBtn, ageAccurate === 'much-older' && styles.accuracyBtnRed]}
              onPress={() => setAgeAccurate('much-older')}
            >
              <Text style={[styles.accuracyText, ageAccurate === 'much-older' && styles.accuracyTextActive]}>
                Much older
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.accuracyBtn, ageAccurate === 'bit-older' && styles.accuracyBtnOrange]}
              onPress={() => setAgeAccurate('bit-older')}
            >
              <Text style={[styles.accuracyText, ageAccurate === 'bit-older' && styles.accuracyTextActive]}>
                Bit older
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.accuracyBtn, ageAccurate === 'accurate' && styles.accuracyBtnGreen]}
              onPress={() => setAgeAccurate('accurate')}
            >
              <Text style={[styles.accuracyText, ageAccurate === 'accurate' && styles.accuracyTextActive]}>
                Accurate
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.accuracyBtn, ageAccurate === 'bit-younger' && styles.accuracyBtnOrange]}
              onPress={() => setAgeAccurate('bit-younger')}
            >
              <Text style={[styles.accuracyText, ageAccurate === 'bit-younger' && styles.accuracyTextActive]}>
                Bit younger
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.accuracyBtn, ageAccurate === 'much-younger' && styles.accuracyBtnRed]}
              onPress={() => setAgeAccurate('much-younger')}
            >
              <Text style={[styles.accuracyText, ageAccurate === 'much-younger' && styles.accuracyTextActive]}>
                Much younger
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Personality Match */}
        <View style={styles.questionCard}>
          <Text style={styles.question}>Did their personality match expectations?</Text>
          <View style={styles.starRow}>
            {[1, 2, 3, 4, 5].map((star) => (
              <TouchableOpacity
                key={star}
                style={styles.starButton}
                onPress={() => setPersonalityMatch(star)}
              >
                <Text style={isPersonalityStarActive(star) ? styles.starActive : styles.star}>
                  *
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.starLabel}>{getStarLabel(personalityMatch)}</Text>
        </View>

        {/* Overall Experience */}
        <View style={styles.questionCard}>
          <Text style={styles.question}>Overall experience</Text>
          <View style={styles.starRow}>
            {[1, 2, 3, 4, 5].map((star) => (
              <TouchableOpacity
                key={star}
                style={styles.starButton}
                onPress={() => setOverallExperience(star)}
              >
                <Text style={isOverallStarActive(star) ? styles.starActive : styles.star}>
                  *
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.starLabel}>{getStarLabel(overallExperience)}</Text>
        </View>

        {/* Comments */}
        <View style={styles.questionCard}>
          <Text style={styles.question}>Additional comments (optional)</Text>
          <TextInput
            style={styles.commentInput}
            placeholder="Anything else you want to share..."
            placeholderTextColor="#666"
            value={comments}
            onChangeText={(text) => setComments(text.slice(0, 300))}
            multiline
            numberOfLines={4}
            maxLength={300}
          />
          <Text style={styles.commentCount}>{comments.length}/300</Text>
        </View>

        <TouchableOpacity
          style={loading ? styles.submitButtonDisabled : styles.submitButton}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.submitButtonText}>Submit Rating</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.backBtn} onPress={() => setStep('ask')}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // STEP 3: Done
  if (step === 'done') {
    return (
      <View style={styles.container}>
        <View style={styles.doneIcon}>
          <Text style={styles.doneIconText}>OK</Text>
        </View>
        <Text style={styles.doneTitle}>Thank You!</Text>
        <Text style={styles.doneText}>
          Your rating helps build trust in the MyArchetype community.
        </Text>
        <TouchableOpacity style={styles.doneBtn} onPress={() => router.back()}>
          <Text style={styles.doneBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center', padding: 20 },
  scrollContainer: { flex: 1, backgroundColor: '#1a1a2e' },
  content: { padding: 20, paddingBottom: 50 },
  title: { fontSize: 26, fontWeight: 'bold', color: '#eee', marginTop: 20, marginBottom: 10, textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 25 },

  // Ask screen
  askBox: { backgroundColor: '#16213e', borderRadius: 12, padding: 15, marginBottom: 25, width: '100%' },
  askText: { color: '#aaa', fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 10 },
  askNote: { color: '#53a8b6', fontSize: 12, textAlign: 'center', fontStyle: 'italic' },
  yesBtn: { backgroundColor: '#5cb85c', paddingVertical: 16, borderRadius: 25, marginBottom: 15, width: '100%', alignItems: 'center' },
  yesBtnText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  noBtn: { backgroundColor: '#16213e', paddingVertical: 14, borderRadius: 25, marginBottom: 15, width: '100%', alignItems: 'center', borderWidth: 1, borderColor: '#0f3460' },
  noBtnText: { color: '#aaa', fontSize: 16 },
  backBtn: { padding: 12, marginTop: 10 },
  backBtnText: { color: '#d9534f', fontSize: 15 },

  // Privacy note
  privacyNote: { backgroundColor: '#0f3460', borderRadius: 10, padding: 12, marginBottom: 20 },
  privacyNoteText: { color: '#53a8b6', fontSize: 12, textAlign: 'center' },

  // Question cards
  questionCard: { backgroundColor: '#16213e', borderRadius: 12, padding: 15, marginBottom: 15 },
  question: { fontSize: 16, fontWeight: '600', color: '#eee', marginBottom: 5 },
  questionHint: { fontSize: 12, color: '#888', marginBottom: 12 },

  // Stars
  starRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 10 },
  starButton: { padding: 5 },
  star: { fontSize: 36, color: '#444' },
  starActive: { fontSize: 36, color: '#f39c12' },
  starLabel: { fontSize: 12, color: '#888', textAlign: 'center', marginTop: 8, height: 16 },

  // Accuracy buttons
  accuracyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 10 },
  accuracyBtn: { backgroundColor: '#0f3460', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 15, borderWidth: 1, borderColor: '#0f3460' },
  accuracyBtnGreen: { backgroundColor: '#1a5c3a', borderColor: '#5cb85c' },
  accuracyBtnOrange: { backgroundColor: '#5c3a1a', borderColor: '#e67e22' },
  accuracyBtnRed: { backgroundColor: '#5c1a1a', borderColor: '#d9534f' },
  accuracyText: { color: '#888', fontSize: 13 },
  accuracyTextActive: { color: '#fff', fontWeight: '600' },

  // Comments
  commentInput: { backgroundColor: '#0f3460', color: '#fff', padding: 12, borderRadius: 10, fontSize: 14, height: 80, textAlignVertical: 'top', marginTop: 10 },
  commentCount: { color: '#666', fontSize: 11, textAlign: 'right', marginTop: 5 },

  // Submit
  submitButton: { backgroundColor: '#5cb85c', paddingVertical: 16, borderRadius: 25, marginTop: 20, alignItems: 'center' },
  submitButtonDisabled: { backgroundColor: '#555', paddingVertical: 16, borderRadius: 25, marginTop: 20, alignItems: 'center' },
  submitButtonText: { color: '#fff', fontSize: 18, fontWeight: '600' },

  // Done screen
  doneIcon: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#5cb85c', justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  doneIconText: { fontSize: 40, color: '#fff', fontWeight: 'bold' },
  doneTitle: { fontSize: 28, fontWeight: 'bold', color: '#eee', marginBottom: 10 },
  doneText: { fontSize: 16, color: '#aaa', textAlign: 'center', marginBottom: 30 },
  doneBtn: { backgroundColor: '#53a8b6', paddingVertical: 14, paddingHorizontal: 40, borderRadius: 25 },
  doneBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
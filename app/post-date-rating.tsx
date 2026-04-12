import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { auth, db } from '../firebaseConfig';
import { logger } from '../utils/logger';

export default function PostDateRatingScreen() {
  const router = useRouter();
  const { matchId, matchName } = useLocalSearchParams();
  const user = auth.currentUser;

  const [loading, setLoading]                     = useState(false);
  const [step, setStep]                           = useState<'ask' | 'rate' | 'done'>('ask');
  const [photosMatch, setPhotosMatch]             = useState<number | null>(null);
  const [heightAccurate, setHeightAccurate]       = useState('');
  const [bodyTypeAccurate, setBodyTypeAccurate]   = useState('');
  const [ageAccurate, setAgeAccurate]             = useState('');
  const [personalityMatch, setPersonalityMatch]   = useState<number | null>(null);
  const [overallExperience, setOverallExperience] = useState<number | null>(null);
  const [comments, setComments]                   = useState('');

  const isStarActive = useCallback((val: number | null, star: number) => val !== null && val >= star, []);

  const getStarLabel = (value: number | null): string => {
    if (value === null) return ' ';
    return ['', 'Very poor', 'Poor', 'Average', 'Good', 'Excellent'][value] ?? ' ';
  };

  const handleDidNotMeet = useCallback(async () => {
    if (!user || !matchId) return;
    try {
      await setDoc(doc(db, 'ratingStatus', `${user.uid}_${matchId}`), {
        raterId: user.uid, ratedUserId: matchId,
        rated: false, didNotMeet: true, ratedAt: new Date().toISOString(),
      });
      Alert.alert("Got it!", "We'll ask again later if you meet.");
      router.back();
    } catch (e) {
      logger.error('[PostDateRating] didNotMeet error:', e);
      router.back();
    }
  }, [user, matchId, router]);

  const handleSubmit = useCallback(async () => {
    if (!user || !matchId) return;
    if (photosMatch === null || !heightAccurate || !bodyTypeAccurate ||
        !ageAccurate || personalityMatch === null || overallExperience === null) {
      Alert.alert('Incomplete', 'Please answer all questions');
      return;
    }
    setLoading(true);
    try {
      const ratingId = `${user.uid}_rates_${matchId}`;
      await setDoc(doc(db, 'ratings', ratingId), {
        raterId: user.uid, ratedUserId: matchId, ratedUserName: matchName,
        didMeet: true, photosMatchReality: photosMatch,
        heightAccurate, bodyTypeAccurate, ageAccurate,
        personalityMatch, overallExperience,
        comments: comments.trim(), createdAt: new Date().toISOString(),
      });

      const userDoc = await getDoc(doc(db, 'users', matchId as string));
      if (userDoc.exists()) {
        const cur = userDoc.data().ratings || {
          totalRatings: 0, averagePhotosMatch: 0, heightAccuracyRate: 0,
          bodyTypeAccuracyRate: 0, ageAccuracyRate: 0,
          averagePersonalityMatch: 0, averageOverall: 0,
        };
        const total = cur.totalRatings + 1;
        const avg = (prev: number, next: number) => ((prev * cur.totalRatings) + next) / total;
        const rate = (val: string, key: string) => ((cur[key] * cur.totalRatings) + (val === 'accurate' ? 100 : 0)) / total;

        await setDoc(doc(db, 'users', matchId as string), {
          ratings: {
            totalRatings: total,
            averagePhotosMatch:      Math.round(avg(cur.averagePhotosMatch, photosMatch) * 10) / 10,
            averagePersonalityMatch: Math.round(avg(cur.averagePersonalityMatch, personalityMatch) * 10) / 10,
            averageOverall:          Math.round(avg(cur.averageOverall ?? 0, overallExperience) * 10) / 10,
            heightAccuracyRate:      Math.round(rate(heightAccurate, 'heightAccuracyRate')),
            bodyTypeAccuracyRate:    Math.round(rate(bodyTypeAccurate, 'bodyTypeAccuracyRate')),
            ageAccuracyRate:         Math.round(rate(ageAccurate, 'ageAccuracyRate')),
          },
        }, { merge: true });
        logger.log('[PostDateRating] ratings updated for', matchName);
      }

      await setDoc(doc(db, 'ratingStatus', `${user.uid}_${matchId}`), {
        raterId: user.uid, ratedUserId: matchId,
        rated: true, ratedAt: new Date().toISOString(),
      });
      setStep('done');
    } catch (error: unknown) {
      logger.error('[PostDateRating] submit error:', error);
      Alert.alert('Error', error instanceof Error ? error.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [user, matchId, matchName, photosMatch, heightAccurate, bodyTypeAccurate, ageAccurate, personalityMatch, overallExperience, comments]);

  const StarRow = useCallback(({ value, onPress }: { value: number | null; onPress: (s: number) => void }) => (
    <View style={s.starRow}>
      {[1, 2, 3, 4, 5].map((star) => (
        <TouchableOpacity
          key={star} style={s.starButton} onPress={() => onPress(star)}
          accessibilityLabel={`Rate ${star} star${star !== 1 ? 's' : ''}`}
          accessibilityRole="button"
          accessibilityState={{ selected: isStarActive(value, star) }}
        >
          <Text style={isStarActive(value, star) ? s.starActive : s.star}>★</Text>
        </TouchableOpacity>
      ))}
    </View>
  ), [isStarActive]);

  const AccuracyBtn = useCallback(({ label, val, current, activeStyle, onPress }: {
    label: string; val: string; current: string;
    activeStyle: object; onPress: (v: string) => void;
  }) => (
    <TouchableOpacity
      style={[s.accuracyBtn, current === val && activeStyle]}
      onPress={() => onPress(val)}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: current === val }}
    >
      <Text style={[s.accuracyText, current === val && s.accuracyTextActive]}>{label}</Text>
    </TouchableOpacity>
  ), []);

  if (step === 'ask') {
    return (
      <View style={s.container}>
        <Text style={s.title} accessibilityRole="header">Rate Your Experience</Text>
        <Text style={s.subtitle}>Did you meet {matchName} in person?</Text>
        <View style={s.askBox}>
          <Text style={s.askText}>Your honest rating helps build trust and catches fake profiles.</Text>
          <Text style={s.askNote}>Ratings are anonymous — they only see aggregated scores.</Text>
        </View>
        <TouchableOpacity style={s.yesBtn} onPress={() => setStep('rate')} accessibilityLabel="Yes, we met" accessibilityRole="button">
          <Text style={s.yesBtnText}>Yes, we met!</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.noBtn} onPress={handleDidNotMeet} accessibilityLabel="We have not met yet" accessibilityRole="button">
          <Text style={s.noBtnText}>Not yet</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} accessibilityLabel="Go back" accessibilityRole="button">
          <Text style={s.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (step === 'rate') {
    return (
      <ScrollView style={s.scrollContainer} contentContainerStyle={s.content}>
        <Text style={s.title} accessibilityRole="header">Rate {matchName}</Text>
        <Text style={s.subtitle}>Be honest - this helps everyone</Text>
        <View style={s.privacyNote}>
          <Text style={s.privacyNoteText}>{matchName} will only see aggregated scores.</Text>
        </View>

        <View style={s.questionCard}>
          <Text style={s.question}>Did their photos match reality?</Text>
          <StarRow value={photosMatch} onPress={setPhotosMatch} />
          <Text style={s.starLabel}>{getStarLabel(photosMatch)}</Text>
        </View>

        <View style={s.questionCard}>
          <Text style={s.question}>Was their height accurate?</Text>
          <Text style={s.questionHint}>Compared to what they stated on their profile</Text>
          <View style={s.accuracyRow}>
            {[
              { label: 'Much shorter', val: 'much-less',     style: s.accuracyBtnRed    },
              { label: 'Bit shorter',  val: 'slightly-less', style: s.accuracyBtnOrange },
              { label: 'Accurate',     val: 'accurate',      style: s.accuracyBtnGreen  },
              { label: 'Bit taller',   val: 'slightly-more', style: s.accuracyBtnOrange },
              { label: 'Much taller',  val: 'much-more',     style: s.accuracyBtnRed    },
            ].map(({ label, val, style }) => (
              <AccuracyBtn key={val} label={label} val={val} current={heightAccurate} activeStyle={style} onPress={setHeightAccurate} />
            ))}
          </View>
        </View>

        <View style={s.questionCard}>
          <Text style={s.question}>Was their body type accurate?</Text>
          <Text style={s.questionHint}>Did it match what they selected on their profile?</Text>
          <View style={s.accuracyRow}>
            {[
              { label: 'Very different', val: 'very-different',     style: s.accuracyBtnRed    },
              { label: 'A bit off',      val: 'slightly-different', style: s.accuracyBtnOrange },
              { label: 'Accurate',       val: 'accurate',           style: s.accuracyBtnGreen  },
            ].map(({ label, val, style }) => (
              <AccuracyBtn key={val} label={label} val={val} current={bodyTypeAccurate} activeStyle={style} onPress={setBodyTypeAccurate} />
            ))}
          </View>
        </View>

        <View style={s.questionCard}>
          <Text style={s.question}>Did they look the age they stated?</Text>
          <View style={s.accuracyRow}>
            {[
              { label: 'Much older',   val: 'much-older',   style: s.accuracyBtnRed    },
              { label: 'Bit older',    val: 'bit-older',    style: s.accuracyBtnOrange },
              { label: 'Accurate',     val: 'accurate',     style: s.accuracyBtnGreen  },
              { label: 'Bit younger',  val: 'bit-younger',  style: s.accuracyBtnOrange },
              { label: 'Much younger', val: 'much-younger', style: s.accuracyBtnRed    },
            ].map(({ label, val, style }) => (
              <AccuracyBtn key={val} label={label} val={val} current={ageAccurate} activeStyle={style} onPress={setAgeAccurate} />
            ))}
          </View>
        </View>

        <View style={s.questionCard}>
          <Text style={s.question}>Did their personality match expectations?</Text>
          <StarRow value={personalityMatch} onPress={setPersonalityMatch} />
          <Text style={s.starLabel}>{getStarLabel(personalityMatch)}</Text>
        </View>

        <View style={s.questionCard}>
          <Text style={s.question}>Overall experience</Text>
          <StarRow value={overallExperience} onPress={setOverallExperience} />
          <Text style={s.starLabel}>{getStarLabel(overallExperience)}</Text>
        </View>

        <View style={s.questionCard}>
          <Text style={s.question}>Additional comments (optional)</Text>
          <TextInput
            style={s.commentInput}
            placeholder="Anything else you want to share..."
            placeholderTextColor="#666"
            value={comments}
            onChangeText={(text) => setComments(text.slice(0, 300))}
            multiline numberOfLines={4} maxLength={300}
            accessibilityLabel="Additional comments"
          />
          <Text style={s.commentCount}>{comments.length}/300</Text>
        </View>

        <TouchableOpacity
          style={loading ? s.submitButtonDisabled : s.submitButton}
          onPress={handleSubmit} disabled={loading}
          accessibilityLabel="Submit rating" accessibilityRole="button"
          accessibilityState={{ disabled: loading }}
        >
          {loading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.submitButtonText}>Submit Rating</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={s.backBtn} onPress={() => setStep('ask')} accessibilityLabel="Go back" accessibilityRole="button">
          <Text style={s.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  if (step === 'done') {
    return (
      <View style={s.container}>
        <View style={s.doneIcon}><Text style={s.doneIconText}>✓</Text></View>
        <Text style={s.doneTitle}>Thank You!</Text>
        <Text style={s.doneText}>Your rating helps build trust in the MyArchetype community.</Text>
        <TouchableOpacity style={s.doneBtn} onPress={() => router.back()} accessibilityLabel="Go back" accessibilityRole="button">
          <Text style={s.doneBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return null;
}

const s = StyleSheet.create({
  container:            { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center', padding: 20 },
  scrollContainer:      { flex: 1, backgroundColor: '#1a1a2e' },
  content:              { padding: 20, paddingBottom: 50 },
  title:                { fontSize: 26, fontWeight: 'bold', color: '#eee', marginTop: 20, marginBottom: 10, textAlign: 'center' },
  subtitle:             { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 25 },
  askBox:               { backgroundColor: '#16213e', borderRadius: 12, padding: 15, marginBottom: 25, width: '100%' },
  askText:              { color: '#aaa', fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 10 },
  askNote:              { color: '#53a8b6', fontSize: 12, textAlign: 'center', fontStyle: 'italic' },
  yesBtn:               { backgroundColor: '#5cb85c', paddingVertical: 16, borderRadius: 25, marginBottom: 15, width: '100%', alignItems: 'center' },
  yesBtnText:           { color: '#fff', fontSize: 18, fontWeight: '600' },
  noBtn:                { backgroundColor: '#16213e', paddingVertical: 14, borderRadius: 25, marginBottom: 15, width: '100%', alignItems: 'center', borderWidth: 1, borderColor: '#0f3460' },
  noBtnText:            { color: '#aaa', fontSize: 16 },
  backBtn:              { padding: 12, marginTop: 10 },
  backBtnText:          { color: '#d9534f', fontSize: 15 },
  privacyNote:          { backgroundColor: '#0f3460', borderRadius: 10, padding: 12, marginBottom: 20 },
  privacyNoteText:      { color: '#53a8b6', fontSize: 12, textAlign: 'center' },
  questionCard:         { backgroundColor: '#16213e', borderRadius: 12, padding: 15, marginBottom: 15 },
  question:             { fontSize: 16, fontWeight: '600', color: '#eee', marginBottom: 5 },
  questionHint:         { fontSize: 12, color: '#888', marginBottom: 12 },
  starRow:              { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 10 },
  starButton:           { padding: 5 },
  star:                 { fontSize: 36, color: '#444' },
  starActive:           { fontSize: 36, color: '#f39c12' },
  starLabel:            { fontSize: 12, color: '#888', textAlign: 'center', marginTop: 8, height: 16 },
  accuracyRow:          { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 10 },
  accuracyBtn:          { backgroundColor: '#0f3460', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 15, borderWidth: 1, borderColor: '#0f3460' },
  accuracyBtnGreen:     { backgroundColor: '#1a5c3a', borderColor: '#5cb85c' },
  accuracyBtnOrange:    { backgroundColor: '#5c3a1a', borderColor: '#e67e22' },
  accuracyBtnRed:       { backgroundColor: '#5c1a1a', borderColor: '#d9534f' },
  accuracyText:         { color: '#888', fontSize: 13 },
  accuracyTextActive:   { color: '#fff', fontWeight: '600' },
  commentInput:         { backgroundColor: '#0f3460', color: '#fff', padding: 12, borderRadius: 10, fontSize: 14, height: 80, textAlignVertical: 'top', marginTop: 10 },
  commentCount:         { color: '#666', fontSize: 11, textAlign: 'right', marginTop: 5 },
  submitButton:         { backgroundColor: '#5cb85c', paddingVertical: 16, borderRadius: 25, marginTop: 20, alignItems: 'center' },
  submitButtonDisabled: { backgroundColor: '#555', paddingVertical: 16, borderRadius: 25, marginTop: 20, alignItems: 'center' },
  submitButtonText:     { color: '#fff', fontSize: 18, fontWeight: '600' },
  doneIcon:             { width: 100, height: 100, borderRadius: 50, backgroundColor: '#5cb85c', justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  doneIconText:         { fontSize: 40, color: '#fff', fontWeight: 'bold' },
  doneTitle:            { fontSize: 28, fontWeight: 'bold', color: '#eee', marginBottom: 10 },
  doneText:             { fontSize: 16, color: '#aaa', textAlign: 'center', marginBottom: 30 },
  doneBtn:              { backgroundColor: '#53a8b6', paddingVertical: 14, paddingHorizontal: 40, borderRadius: 25 },
  doneBtnText:          { color: '#fff', fontSize: 16, fontWeight: '600' },
});
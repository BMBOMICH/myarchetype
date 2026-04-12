import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { logger } from '../utils/logger';
import { DateSpotReview, getDateSpotReviews, likeReview, submitDateSpotReview } from '../utils/dateSpotReviews';

const PLACE_TYPES  = ['restaurant', 'cafe', 'bar', 'park', 'museum', 'cinema', 'other'] as const;
const PRICE_RANGES = ['€', '€€', '€€€', '€€€€'] as const;
const GOOD_FOR     = ['first_date', 'casual', 'romantic', 'group', 'coffee_chat'] as const;

type PlaceType  = typeof PLACE_TYPES[number];
type PriceRange = typeof PRICE_RANGES[number];

interface FormState {
  placeName: string; placeAddress: string; placeType: PlaceType;
  rating: number; atmosphere: number; priceRange: PriceRange;
  reviewText: string; selectedGoodFor: string[];
}

const DEFAULT_FORM: FormState = {
  placeName: '', placeAddress: '', placeType: 'restaurant',
  rating: 5, atmosphere: 5, priceRange: '€€', reviewText: '', selectedGoodFor: [],
};

export default function DateSpotReviewsScreen() {
  const router = useRouter();
  const [loading, setLoading]     = useState(true);
  const [reviews, setReviews]     = useState<DateSpotReview[]>([]);
  const [showCreate, setCreate]   = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [filterType, setFilterType]   = useState<string | null>(null);
  const [form, setForm]           = useState<FormState>(DEFAULT_FORM);

  const setField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  }, []);

  const loadReviews = useCallback(async () => {
    try {
      setLoading(true);
      const filters: Record<string, string> = {};
      if (filterType) filters['placeType'] = filterType;
      setReviews(await getDateSpotReviews(filters));
    } catch (error) {
      logger.error('[Reviews] Load error:', error);
      Alert.alert('Error', 'Could not load reviews.');
    } finally {
      setLoading(false);
    }
  }, [filterType]);

  useEffect(() => { loadReviews(); }, [loadReviews]);

  const handleSubmit = useCallback(async () => {
    if (!form.placeName || !form.placeAddress || !form.reviewText) {
      Alert.alert('Wait', 'Please fill in all required fields'); return;
    }
    setSubmitting(true);
    try {
      const result = await submitDateSpotReview({
        placeName: form.placeName, placeAddress: form.placeAddress,
        placeType: form.placeType, rating: form.rating, atmosphere: form.atmosphere,
        priceRange: form.priceRange, review: form.reviewText, goodFor: form.selectedGoodFor,
      });
      if (result.success) {
        Alert.alert('Success', 'Review posted! 🎉');
        setCreate(false);
        setForm(DEFAULT_FORM);
        loadReviews();
      } else {
        Alert.alert('Error', 'Failed to post review.');
      }
    } catch (error) {
      logger.error('[Reviews] Submit error:', error);
      Alert.alert('Error', 'An unexpected error occurred.');
    } finally {
      setSubmitting(false);
    }
  }, [form, loadReviews]);

  const handleLike = useCallback(async (reviewId: string) => {
    try {
      await likeReview(reviewId);
      loadReviews();
    } catch (error) {
      logger.error('[Reviews] Like error:', error);
    }
  }, [loadReviews]);

  const renderStars = useCallback((count: number, onPress?: (n: number) => void) => (
    <View style={styles.stars}>
      {[1, 2, 3, 4, 5].map((n) => (
        <TouchableOpacity
          key={n}
          onPress={() => onPress?.(n)}
          disabled={!onPress}
          accessibilityLabel={`${n} star${n > 1 ? 's' : ''}${onPress ? '' : `, rated ${count}`}`}
          accessibilityRole={onPress ? 'button' : 'text'}
        >
          <Text style={styles.star}>{n <= count ? '⭐' : '☆'}</Text>
        </TouchableOpacity>
      ))}
    </View>
  ), []);

  if (loading && reviews.length === 0) {
    return <View style={styles.container}><ActivityIndicator size="large" color="#53a8b6" /></View>;
  }

  // ── Create form ───────────────────────────────────────
  if (showCreate) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setCreate(false)} accessibilityLabel="Go back" accessibilityRole="button">
            <Text style={styles.backButton}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Review a Spot</Text>
          <View style={{ width: 50 }} />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Place Name *</Text>
          <TextInput style={styles.input} placeholder="Restaurant/cafe name" placeholderTextColor="#666" value={form.placeName} onChangeText={(v) => setField('placeName', v)} accessibilityLabel="Place name" />
        </View>
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Address *</Text>
          <TextInput style={styles.input} placeholder="Street address or area" placeholderTextColor="#666" value={form.placeAddress} onChangeText={(v) => setField('placeAddress', v)} accessibilityLabel="Place address" />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Type</Text>
          <View style={styles.chipsContainer}>
            {PLACE_TYPES.map((type) => (
              <TouchableOpacity
                key={type} style={[styles.chip, form.placeType === type && styles.chipSelected]}
                onPress={() => setField('placeType', type)}
                accessibilityLabel={`Place type: ${type}${form.placeType === type ? ', selected' : ''}`}
                accessibilityRole="button" accessibilityState={{ selected: form.placeType === type }}
              >
                <Text style={[styles.chipText, form.placeType === type && styles.chipTextSelected]}>{type}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Overall Rating *</Text>
          {renderStars(form.rating, (n) => setField('rating', n))}
        </View>
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Atmosphere</Text>
          {renderStars(form.atmosphere, (n) => setField('atmosphere', n))}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Price Range</Text>
          <View style={styles.chipsContainer}>
            {PRICE_RANGES.map((price) => (
              <TouchableOpacity
                key={price} style={[styles.chip, form.priceRange === price && styles.chipSelected]}
                onPress={() => setField('priceRange', price)}
                accessibilityLabel={`Price range: ${price}${form.priceRange === price ? ', selected' : ''}`}
                accessibilityRole="button" accessibilityState={{ selected: form.priceRange === price }}
              >
                <Text style={[styles.chipText, form.priceRange === price && styles.chipTextSelected]}>{price}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Good For</Text>
          <View style={styles.chipsContainer}>
            {GOOD_FOR.map((tag) => {
              const selected = form.selectedGoodFor.includes(tag);
              return (
                <TouchableOpacity
                  key={tag} style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => setField('selectedGoodFor', selected ? form.selectedGoodFor.filter(t => t !== tag) : [...form.selectedGoodFor, tag])}
                  accessibilityLabel={`${tag.replace('_', ' ')}${selected ? ', selected' : ''}`}
                  accessibilityRole="button" accessibilityState={{ selected }}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{tag.replace('_', ' ')}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Your Review *</Text>
          <TextInput
            style={[styles.input, styles.textArea]} placeholder="Share your experience..."
            placeholderTextColor="#666" value={form.reviewText}
            onChangeText={(v) => setField('reviewText', v)}
            multiline numberOfLines={6} accessibilityLabel="Review text"
          />
        </View>

        <TouchableOpacity
          style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
          onPress={handleSubmit} disabled={submitting}
          accessibilityLabel="Post review" accessibilityRole="button"
        >
          <Text style={styles.submitButtonText}>{submitting ? 'Posting...' : '✓ Post Review'}</Text>
        </TouchableOpacity>
        <View style={{ height: 40 }} />
      </ScrollView>
    );
  }

  // ── List view ─────────────────────────────────────────
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Go back" accessibilityRole="button">
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>📍 Date Spots</Text>
        <TouchableOpacity onPress={() => setCreate(true)} accessibilityLabel="Add a review" accessibilityRole="button">
          <Text style={styles.addButton}>+ Add</Text>
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersScroll}>
        <TouchableOpacity
          style={[styles.filterChip, !filterType && styles.filterChipActive]}
          onPress={() => setFilterType(null)}
          accessibilityLabel="Show all types" accessibilityRole="button"
          accessibilityState={{ selected: !filterType }}
        >
          <Text style={[styles.filterChipText, !filterType && styles.filterChipTextActive]}>All</Text>
        </TouchableOpacity>
        {PLACE_TYPES.map((type) => (
          <TouchableOpacity
            key={type} style={[styles.filterChip, filterType === type && styles.filterChipActive]}
            onPress={() => setFilterType(type)}
            accessibilityLabel={`Filter by ${type}`} accessibilityRole="button"
            accessibilityState={{ selected: filterType === type }}
          >
            <Text style={[styles.filterChipText, filterType === type && styles.filterChipTextActive]}>{type}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FlatList
        data={reviews}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={() => (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No reviews yet. Be the first!</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <View style={styles.reviewCard}>
            <View style={styles.reviewHeader}>
              <View style={styles.reviewHeaderLeft}>
                {item.userPhoto && (
                  <Image
                    source={{ uri: item.userPhoto }}
                    style={styles.reviewUserPhoto}
                    accessibilityLabel={`Photo of ${item.userName}`}
                  />
                )}
                <View>
                  <Text style={styles.reviewUserName}>{item.userName}</Text>
                  <Text style={styles.reviewDate}>{new Date(item.createdAt).toLocaleDateString()}</Text>
                </View>
              </View>
              <Text style={styles.reviewPrice}>{item.priceRange}</Text>
            </View>

            <Text style={styles.reviewPlaceName}>{item.placeName}</Text>
            <Text style={styles.reviewPlaceAddress}>{item.placeAddress}</Text>

            <View style={styles.reviewRatings}>
              {renderStars(item.rating)}
              <Text style={styles.reviewAtmosphere}>Atmosphere: {item.atmosphere}/5</Text>
            </View>

            <Text style={styles.reviewText}>{item.review}</Text>

            {item.goodFor.length > 0 && (
              <View style={styles.reviewTags}>
                {item.goodFor.map((tag, i) => (
                  <View key={i} style={styles.reviewTag}>
                    <Text style={styles.reviewTagText}>{tag.replace('_', ' ')}</Text>
                  </View>
                ))}
              </View>
            )}

            <TouchableOpacity
              style={styles.likeButton}
              onPress={() => handleLike(item.id)}
              accessibilityLabel={`Like this review, ${item.likes} likes`}
              accessibilityRole="button"
            >
              <Text style={styles.likeButtonText}>
                {item.likedBy?.includes('current_user_id') ? '❤️' : '🤍'} {item.likes}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  content: { padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 60, backgroundColor: '#16213e' },
  backButton: { color: '#53a8b6', fontSize: 16 },
  title: { fontSize: 20, fontWeight: 'bold', color: '#eee' },
  addButton: { color: '#5cb85c', fontSize: 16, fontWeight: 'bold' },
  filtersScroll: { paddingHorizontal: 15, paddingVertical: 10, maxHeight: 60 },
  filterChip: { backgroundColor: '#16213e', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, marginRight: 8, borderWidth: 1, borderColor: '#0f3460' },
  filterChipActive: { backgroundColor: '#53a8b6', borderColor: '#53a8b6' },
  filterChipText: { color: '#888', fontSize: 14 },
  filterChipTextActive: { color: '#fff' },
  list: { padding: 15, paddingBottom: 40 },
  reviewCard: { backgroundColor: '#16213e', borderRadius: 15, padding: 15, marginBottom: 15 },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  reviewHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reviewUserPhoto: { width: 40, height: 40, borderRadius: 20 },
  reviewUserName: { color: '#eee', fontSize: 14, fontWeight: '600' },
  reviewDate: { color: '#666', fontSize: 12 },
  reviewPrice: { color: '#e67e22', fontSize: 16, fontWeight: 'bold' },
  reviewPlaceName: { fontSize: 18, fontWeight: 'bold', color: '#eee', marginBottom: 4 },
  reviewPlaceAddress: { fontSize: 14, color: '#888', marginBottom: 10 },
  reviewRatings: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  reviewAtmosphere: { color: '#888', fontSize: 12 },
  reviewText: { color: '#aaa', fontSize: 14, lineHeight: 20, marginBottom: 10 },
  reviewTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  reviewTag: { backgroundColor: '#53a8b6', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12 },
  reviewTagText: { color: '#fff', fontSize: 11 },
  likeButton: { alignSelf: 'flex-start' },
  likeButtonText: { color: '#e74c3c', fontSize: 14 },
  inputGroup: { marginBottom: 20 },
  inputLabel: { color: '#888', fontSize: 14, marginBottom: 8 },
  input: { backgroundColor: '#16213e', borderRadius: 12, padding: 14, color: '#eee', fontSize: 16, borderWidth: 1, borderColor: '#0f3460' },
  textArea: { height: 120, textAlignVertical: 'top' },
  chipsContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: '#0f3460', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20 },
  chipSelected: { backgroundColor: '#53a8b6' },
  chipText: { color: '#888', fontSize: 14 },
  chipTextSelected: { color: '#fff' },
  stars: { flexDirection: 'row', gap: 5 },
  star: { fontSize: 24 },
  submitButton: { backgroundColor: '#5cb85c', paddingVertical: 16, borderRadius: 25, alignItems: 'center' },
  submitButtonDisabled: { backgroundColor: '#555' },
  submitButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  emptyContainer: { padding: 40, alignItems: 'center' },
  emptyText: { color: '#888', fontSize: 14 },
});
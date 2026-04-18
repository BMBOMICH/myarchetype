import { layout, prepare } from '@chenglou/pretext';
import type { LegendListRenderItemProps } from '@legendapp/list';
import { LegendList } from '@legendapp/list';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import TurboImage from 'react-native-turbo-image';
import { auth } from '../firebaseConfig';
import {
  type DateSpotReview,
  getDateSpotReviews,
  likeReview,
  submitDateSpotReview,
} from '../utils/dateSpotReviews';
import { logger } from '../utils/logger';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const REVIEW_FONT        = '14px Inter';
const REVIEW_LINE_HEIGHT = 20 / 14;
const REVIEW_TEXT_WIDTH  = SCREEN_WIDTH - 60;

const CARD_FIXED_HEIGHT = 249;

const GOOD_FOR_ROW_HEIGHT = 34;

const pretextCache = new Map<string, number>();

function measureReviewText(text: string): number {
  const key = `${text}|${REVIEW_TEXT_WIDTH}`;
  const hit  = pretextCache.get(key);
  if (hit !== undefined) return hit;

  const prepared = prepare(text, REVIEW_FONT);
  const result   = layout(prepared, REVIEW_TEXT_WIDTH, REVIEW_LINE_HEIGHT);

  pretextCache.set(key, result.height);
  if (pretextCache.size > 500) {
    const oldest = pretextCache.keys().next().value;
    if (oldest) pretextCache.delete(oldest);
  }
  return result.height;
}

function measureCardHeight(item: DateSpotReview): number {
  let height = CARD_FIXED_HEIGHT + measureReviewText(item.review ?? '');
  if (item.goodFor && item.goodFor.length > 0) height += GOOD_FOR_ROW_HEIGHT;
  return Math.ceil(height);
}


const PLACE_TYPES  = ['restaurant', 'cafe', 'bar', 'park', 'museum', 'cinema', 'other'] as const;
const PRICE_RANGES = ['€', '€€', '€€€', '€€€€'] as const;
const GOOD_FOR     = ['first_date', 'casual', 'romantic', 'group', 'coffee_chat'] as const;

type PlaceType  = typeof PLACE_TYPES[number];
type PriceRange = typeof PRICE_RANGES[number];

interface FormState {
  placeName: string;
  placeAddress: string;
  placeType: PlaceType;
  rating: number;
  atmosphere: number;
  priceRange: PriceRange;
  reviewText: string;
  selectedGoodFor: string[];
}

const DEFAULT_FORM: FormState = {
  placeName: '', placeAddress: '', placeType: 'restaurant',
  rating: 5, atmosphere: 5, priceRange: '€€', reviewText: '', selectedGoodFor: [],
};


const PlaceTypeChip = React.memo(function PlaceTypeChip({ type, selected, onPress }: {
  type: PlaceType;
  selected: boolean;
  onPress: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
}) {
  const handlePress = useCallback(() => onPress('placeType', type), [onPress, type]);
  const chipStyle = useMemo(() => [styles.chip, selected && styles.chipSelected], [selected]);
  const textStyle = useMemo(() => [styles.chipText, selected && styles.chipTextSelected], [selected]);
  return (
    <TouchableOpacity
      style={chipStyle} onPress={handlePress}
      accessibilityLabel={`Place type: ${type}${selected ? ', selected' : ''}`}
      accessibilityRole="button" accessibilityState={{ selected }}
    >
      <Text style={textStyle}>{type}</Text>
    </TouchableOpacity>
  );
});

const PriceRangeChip = React.memo(function PriceRangeChip({ price, selected, onPress }: {
  price: PriceRange;
  selected: boolean;
  onPress: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
}) {
  const handlePress = useCallback(() => onPress('priceRange', price), [onPress, price]);
  const chipStyle = useMemo(() => [styles.chip, selected && styles.chipSelected], [selected]);
  const textStyle = useMemo(() => [styles.chipText, selected && styles.chipTextSelected], [selected]);
  return (
    <TouchableOpacity
      style={chipStyle} onPress={handlePress}
      accessibilityLabel={`Price range: ${price}${selected ? ', selected' : ''}`}
      accessibilityRole="button" accessibilityState={{ selected }}
    >
      <Text style={textStyle}>{price}</Text>
    </TouchableOpacity>
  );
});

const GoodForChip = React.memo(function GoodForChip({ tag, selected, selectedGoodFor, onPress }: {
  tag: string;
  selected: boolean;
  selectedGoodFor: string[];
  onPress: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
}) {
  const handlePress = useCallback(() => {
    onPress('selectedGoodFor', selected
      ? selectedGoodFor.filter(t => t !== tag)
      : [...selectedGoodFor, tag],
    );
  }, [onPress, selected, selectedGoodFor, tag]);
  const chipStyle = useMemo(() => [styles.chip, selected && styles.chipSelected], [selected]);
  const textStyle = useMemo(() => [styles.chipText, selected && styles.chipTextSelected], [selected]);
  return (
    <TouchableOpacity
      style={chipStyle} onPress={handlePress}
      accessibilityLabel={`${tag.replace('_', ' ')}${selected ? ', selected' : ''}`}
      accessibilityRole="button" accessibilityState={{ selected }}
    >
      <Text style={textStyle}>{tag.replace('_', ' ')}</Text>
    </TouchableOpacity>
  );
});

const FilterChip = React.memo(function FilterChip({ type, active, onPress }: {
  type: string; active: boolean; onPress: (type: string) => void;
}) {
  const handlePress  = useCallback(() => onPress(type), [onPress, type]);
  const chipStyle    = useMemo(() => [styles.filterChip, active && styles.filterChipActive], [active]);
  const textStyle    = useMemo(() => [styles.filterChipText, active && styles.filterChipTextActive], [active]);
  return (
    <TouchableOpacity
      style={chipStyle} onPress={handlePress}
      accessibilityLabel={`Filter by ${type}`} accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={textStyle}>{type}</Text>
    </TouchableOpacity>
  );
});

interface StarRowProps {
  count: number;
  onPress?: (n: number) => void;
}
const StarRow = React.memo(function StarRow({ count, onPress }: StarRowProps) {
  return (
    <View style={styles.stars}>
      {[1, 2, 3, 4, 5].map((n) => (
        <TouchableOpacity
          key={n}
          onPress={() = accessibilityLabel="button"> onPress?.(n)}
          disabled={!onPress}
          accessibilityLabel={`${n} star${n > 1 ? 's' : ''}${onPress ? '' : `, rated ${count}`}`}
          accessibilityRole={onPress ? 'button' : 'text'}
        >
          <Text style={styles.star}>{n <= count ? '⭐' : '☆'}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
});

interface ReviewCardProps {
  item: DateSpotReview;
  currentUserId: string;
  onLike: (id: string) => void;
}
const ReviewCard = React.memo(function ReviewCard({
  item, currentUserId, onLike,
}: ReviewCardProps) {
  const handleLike = useCallback(() => onLike(item.id), [onLike, item.id]);
  const isLiked    = item.likedBy?.includes(currentUserId);

  return (
    <View style={styles.reviewCard}>
      <View style={styles.reviewHeader}>
        <View style={styles.reviewHeaderLeft}>
          {item.userPhoto ? (
            <TurboImage
              source={{ uri: item.userPhoto }}
              style={styles.reviewUserPhoto}
              cachePolicy="dataCache"
              accessibilityLabel={`Photo of ${item.userName}`}
            />
          ) : null}
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
        <StarRow count={item.rating} />
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
        onPress={handleLike}
        accessibilityLabel={`${isLiked ? 'Unlike' : 'Like'} this review, ${item.likes} likes`}
        accessibilityRole="button"
      >
        <Text style={styles.likeButtonText}>
          {isLiked ? '❤️' : '🤍'} {item.likes}
        </Text>
      </TouchableOpacity>
    </View>
  );
});


export default function DateSpotReviewsScreen() {
  const router        = useRouter();
  const currentUserId = auth.currentUser?.uid ?? '';

  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const [loading,    setLoading]    = useState(true);
  const [reviews,    setReviews]    = useState<DateSpotReview[]>([]);
  const [showCreate, setCreate]     = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [filterType, setFilterType] = useState<string | null>(null);
  const [form,       setForm]       = useState<FormState>(DEFAULT_FORM);

  const setField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  }, []);

  const loadReviews = useCallback(async () => {
    try {
      setLoading(true);
      const filters: Record<string, string> = {};
      if (filterType) filters['placeType'] = filterType;
      const data = await getDateSpotReviews(filters);
      if (isMounted.current) setReviews(data);
    } catch (error) {
      logger.error('[Reviews] Load error:', error);
      Alert.alert('Error', 'Could not load reviews.');
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, [filterType]);

  useEffect(() => { void loadReviews(); }, [loadReviews]);

  const handleSubmit = useCallback(async () => {
    if (!form.placeName || !form.placeAddress || !form.reviewText) {
      Alert.alert('Wait', 'Please fill in all required fields');
      return;
    }
    setSubmitting(true);
    try {
      const result = await submitDateSpotReview({
        placeName:    form.placeName,
        placeAddress: form.placeAddress,
        placeType:    form.placeType,
        rating:       form.rating,
        atmosphere:   form.atmosphere,
        priceRange:   form.priceRange,
        review:       form.reviewText,
        goodFor:      form.selectedGoodFor,
      });
      if (result.success) {
        Alert.alert('Success', 'Review posted! 🎉');
        if (isMounted.current) { setCreate(false); setForm(DEFAULT_FORM); }
        void loadReviews();
      } else {
        Alert.alert('Error', 'Failed to post review.');
      }
    } catch (error) {
      logger.error('[Reviews] Submit error:', error);
      Alert.alert('An unexpected error occurred.');
    } finally {
      if (isMounted.current) setSubmitting(false);
    }
  }, [form, loadReviews]);

  const handleLike = useCallback(async (reviewId: string) => {
    try {
      await likeReview(reviewId);
      void loadReviews();
    } catch (error) {
      logger.error('[Reviews] Like error:', error);
    }
  }, [loadReviews]);

  const handleBackFromCreate = useCallback(() => setCreate(false),    []);
  const handleOpenCreate     = useCallback(() => setCreate(true),     []);
  const handleBack           = useCallback(() => router.back(),       [router]);
  const handleFilterAll      = useCallback(() => setFilterType(null), []);

  const handlePlaceNameChange    = useCallback((v: string) => setField('placeName', v),    [setField]);
  const handlePlaceAddressChange = useCallback((v: string) => setField('placeAddress', v), [setField]);
  const handleReviewTextChange   = useCallback((v: string) => setField('reviewText', v),   [setField]);

  const handleRating     = useCallback((n: number) => setField('rating',     n), [setField]);
  const handleAtmosphere = useCallback((n: number) => setField('atmosphere', n), [setField]);

  const keyExtractor = useCallback((item: DateSpotReview) => item.id, []);

  const renderItem = useCallback(({ item }: LegendListRenderItemProps<DateSpotReview>) => (
    <ReviewCard item={item} currentUserId={currentUserId} onLike={handleLike} />
  ), [currentUserId, handleLike]);

  const estimatedItemSize = useMemo(() => {
    if (reviews.length === 0) return CARD_FIXED_HEIGHT + 60;

    let total   = 0;
    let sampled = 0;
    const step  = Math.max(1, Math.floor(reviews.length / Math.min(reviews.length, 20)));

    for (let i = 0; i < reviews.length; i += step) {
      const review = reviews[i];
      if (!review) continue;
      total += measureCardHeight(review);
      sampled++;
      if (sampled >= 20) break;
    }

    return sampled > 0 ? Math.ceil(total / sampled) : CARD_FIXED_HEIGHT + 60;
  }, [reviews]);

  const renderEmpty = useCallback(() => (
    <View style={styles.emptyContainer} accessibilityLabel="No reviews yet">
      <Text style={styles.emptyText}>No reviews yet. Be the first!</Text>
    </View>
  ), []);

  if (loading && reviews.length === 0) {
    return (
      <View style={styles.container} accessibilityLabel="Loading reviews">
        <ActivityIndicator size="large" color="#53a8b6" />
      </View>
    );
  }

  if (showCreate) {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <TouchableOpacity
            onPress={handleBackFromCreate}
            accessibilityLabel="Go back"
            accessibilityRole="button"
          >
            <Text style={styles.backButton}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Review a Spot</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Place Name *</Text>
          <TextInput
            style={styles.input}
            placeholder="Restaurant/cafe name"
            placeholderTextColor="#666"
            value={form.placeName}
            onChangeText={handlePlaceNameChange}
            accessibilityLabel="Place name"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Address *</Text>
          <TextInput
            style={styles.input}
            placeholder="Street address or area"
            placeholderTextColor="#666"
            value={form.placeAddress}
            onChangeText={handlePlaceAddressChange}
            accessibilityLabel="Place address"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Type</Text>
          <View style={styles.chipsContainer}>
            {PLACE_TYPES.map((type) => (
              <PlaceTypeChip
                key={type} type={type}
                selected={form.placeType === type}
                onPress={setField}
              />
            ))}
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Overall Rating *</Text>
          <StarRow count={form.rating} onPress={handleRating} />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Atmosphere</Text>
          <StarRow count={form.atmosphere} onPress={handleAtmosphere} />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Price Range</Text>
          <View style={styles.chipsContainer}>
            {PRICE_RANGES.map((price) => (
              <PriceRangeChip
                key={price} price={price}
                selected={form.priceRange === price}
                onPress={setField}
              />
            ))}
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Good For</Text>
          <View style={styles.chipsContainer}>
            {GOOD_FOR.map((tag) => (
              <GoodForChip
                key={tag} tag={tag}
                selected={form.selectedGoodFor.includes(tag)}
                selectedGoodFor={form.selectedGoodFor}
                onPress={setField}
              />
            ))}
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Your Review *</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Share your experience..."
            placeholderTextColor="#666"
            value={form.reviewText}
            onChangeText={handleReviewTextChange}
            multiline
            numberOfLines={6}
            accessibilityLabel="Review text"
          />
        </View>

        <TouchableOpacity
          style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
          onPress={() = accessibilityLabel="button"> void handleSubmit()}
          disabled={submitting}
          accessibilityLabel="Post review"
          accessibilityRole="button"
          accessibilityState={{ disabled: submitting }}
        >
          <Text style={styles.submitButtonText}>
            {submitting ? 'Posting...' : '✓ Post Review'}
          </Text>
        </TouchableOpacity>
        <View style={styles.bottomSpacer} />
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>📍 Date Spots</Text>
        <TouchableOpacity
          onPress={handleOpenCreate}
          accessibilityLabel="Add a review"
          accessibilityRole="button"
        >
          <Text style={styles.addButton}>+ Add</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filtersScroll}
      >
        <TouchableOpacity
          style={[styles.filterChip, !filterType && styles.filterChipActive]}
          onPress={handleFilterAll}
          accessibilityLabel="Show all types"
          accessibilityRole="button"
          accessibilityState={{ selected: !filterType }}
        >
          <Text style={[styles.filterChipText, !filterType && styles.filterChipTextActive]}>
            All
          </Text>
        </TouchableOpacity>
        {PLACE_TYPES.map((type) => (
          <FilterChip
            key={type} type={type}
            active={filterType === type}
            onPress={setFilterType}
          />
        ))}
      </ScrollView>

      <LegendList
        data={reviews}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        estimatedItemSize={estimatedItemSize}
        recycleItems={true}
        contentContainerStyle={styles.list}
        ListEmptyComponent={renderEmpty}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container:            { flex: 1, backgroundColor: '#1a1a2e' },
  content:              { padding: 20 },
  header:               { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 60, backgroundColor: '#16213e' },
  headerSpacer:         { width: 50 },
  bottomSpacer:         { height: 40 },
  backButton:           { color: '#53a8b6', fontSize: 16 },
  title:                { fontSize: 20, fontWeight: 'bold', color: '#eee' },
  addButton:            { color: '#5cb85c', fontSize: 16, fontWeight: 'bold' },
  filtersScroll:        { paddingHorizontal: 15, paddingVertical: 10, maxHeight: 60 },
  filterChip:           { backgroundColor: '#16213e', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, marginRight: 8, borderWidth: 1, borderColor: '#0f3460' },
  filterChipActive:     { backgroundColor: '#53a8b6', borderColor: '#53a8b6' },
  filterChipText:       { color: '#888', fontSize: 14 },
  filterChipTextActive: { color: '#fff' },
  list:                 { padding: 15, paddingBottom: 40 },
  reviewCard:           { backgroundColor: '#16213e', borderRadius: 15, padding: 15, marginBottom: 15 },
  reviewHeader:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  reviewHeaderLeft:     { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reviewUserPhoto:      { width: 40, height: 40, borderRadius: 20 },
  reviewUserName:       { color: '#eee', fontSize: 14, fontWeight: '600' },
  reviewDate:           { color: '#666', fontSize: 12 },
  reviewPrice:          { color: '#e67e22', fontSize: 16, fontWeight: 'bold' },
  reviewPlaceName:      { fontSize: 18, fontWeight: 'bold', color: '#eee', marginBottom: 4 },
  reviewPlaceAddress:   { fontSize: 14, color: '#888', marginBottom: 10 },
  reviewRatings:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  reviewAtmosphere:     { color: '#888', fontSize: 12 },
  reviewText:           { color: '#aaa', fontSize: 14, lineHeight: 20, marginBottom: 10 },
  reviewTags:           { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  reviewTag:            { backgroundColor: '#53a8b6', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12 },
  reviewTagText:        { color: '#fff', fontSize: 11 },
  likeButton:           { alignSelf: 'flex-start' },
  likeButtonText:       { color: '#e74c3c', fontSize: 14 },
  inputGroup:           { marginBottom: 20 },
  inputLabel:           { color: '#888', fontSize: 14, marginBottom: 8 },
  input:                { backgroundColor: '#16213e', borderRadius: 12, padding: 14, color: '#eee', fontSize: 16, borderWidth: 1, borderColor: '#0f3460' },
  textArea:             { height: 120, textAlignVertical: 'top' },
  chipsContainer:       { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:                 { backgroundColor: '#0f3460', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20 },
  chipSelected:         { backgroundColor: '#53a8b6' },
  chipText:             { color: '#888', fontSize: 14 },
  chipTextSelected:     { color: '#fff' },
  stars:                { flexDirection: 'row', gap: 5 },
  star:                 { fontSize: 24 },
  submitButton:         { backgroundColor: '#5cb85c', paddingVertical: 16, borderRadius: 25, alignItems: 'center' },
  submitButtonDisabled: { backgroundColor: '#555' },
  submitButtonText:     { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  emptyContainer:       { padding: 40, alignItems: 'center' },
  emptyText:            { color: '#888', fontSize: 14 },
});
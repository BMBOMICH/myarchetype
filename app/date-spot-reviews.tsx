import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import {
    DateSpotReview,
    getDateSpotReviews,
    likeReview,
    submitDateSpotReview,
} from '../utils/dateSpotReviews';

const PLACE_TYPES = ['restaurant', 'cafe', 'bar', 'park', 'museum', 'cinema', 'other'];
const PRICE_RANGES = ['€', '€€', '€€€', '€€€€'];
const GOOD_FOR = ['first_date', 'casual', 'romantic', 'group', 'coffee_chat'];

export default function DateSpotReviewsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState<DateSpotReview[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Filters
  const [filterType, setFilterType] = useState<string | null>(null);
  const [filterPrice, setFilterPrice] = useState<string | null>(null);

  // Create form
  const [placeName, setPlaceName] = useState('');
  const [placeAddress, setPlaceAddress] = useState('');
  const [placeType, setPlaceType] = useState<any>('restaurant');
  const [rating, setRating] = useState(5);
  const [atmosphere, setAtmosphere] = useState(5);
  const [priceRange, setPriceRange] = useState<any>('€€');
  const [reviewText, setReviewText] = useState('');
  const [selectedGoodFor, setSelectedGoodFor] = useState<string[]>([]);

  useEffect(() => {
    loadReviews();
  }, [filterType, filterPrice]);

  const loadReviews = async () => {
    const filters: any = {};
    if (filterType) filters.placeType = filterType;
    if (filterPrice) filters.priceRange = filterPrice;

    const data = await getDateSpotReviews(filters);
    setReviews(data);
    setLoading(false);
  };

  const handleSubmit = async () => {
    if (!placeName || !placeAddress || !reviewText) {
      alert('Please fill in all required fields');
      return;
    }

    setSubmitting(true);
    const result = await submitDateSpotReview({
      placeName,
      placeAddress,
      placeType,
      rating,
      atmosphere,
      priceRange,
      review: reviewText,
      goodFor: selectedGoodFor,
    });
    setSubmitting(false);

    if (result.success) {
      alert('Review posted! 🎉');
      setShowCreate(false);
      resetForm();
      loadReviews();
    } else {
      alert('Error posting review');
    }
  };

  const resetForm = () => {
    setPlaceName('');
    setPlaceAddress('');
    setPlaceType('restaurant');
    setRating(5);
    setAtmosphere(5);
    setPriceRange('€€');
    setReviewText('');
    setSelectedGoodFor([]);
  };

  const handleLike = async (reviewId: string) => {
    await likeReview(reviewId);
    loadReviews();
  };

  const renderStars = (count: number, onPress?: (n: number) => void) => {
    return (
      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((n) => (
          <TouchableOpacity
            key={n}
            onPress={() => onPress?.(n)}
            disabled={!onPress}
          >
            <Text style={styles.star}>
              {n <= count ? '⭐' : '☆'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#53a8b6" />
      </View>
    );
  }

  if (showCreate) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setShowCreate(false)}>
            <Text style={styles.backButton}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Review a Spot</Text>
          <View style={{ width: 50 }} />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Place Name *</Text>
          <TextInput
            style={styles.input}
            placeholder="Restaurant/cafe name"
            placeholderTextColor="#666"
            value={placeName}
            onChangeText={setPlaceName}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Address *</Text>
          <TextInput
            style={styles.input}
            placeholder="Street address or area"
            placeholderTextColor="#666"
            value={placeAddress}
            onChangeText={setPlaceAddress}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Type</Text>
          <View style={styles.chipsContainer}>
            {PLACE_TYPES.map((type) => (
              <TouchableOpacity
                key={type}
                style={[styles.chip, placeType === type && styles.chipSelected]}
                onPress={() => setPlaceType(type)}
              >
                <Text style={[styles.chipText, placeType === type && styles.chipTextSelected]}>
                  {type}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Overall Rating *</Text>
          {renderStars(rating, setRating)}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Atmosphere</Text>
          {renderStars(atmosphere, setAtmosphere)}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Price Range</Text>
          <View style={styles.chipsContainer}>
            {PRICE_RANGES.map((price) => (
              <TouchableOpacity
                key={price}
                style={[styles.chip, priceRange === price && styles.chipSelected]}
                onPress={() => setPriceRange(price)}
              >
                <Text style={[styles.chipText, priceRange === price && styles.chipTextSelected]}>
                  {price}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Good For</Text>
          <View style={styles.chipsContainer}>
            {GOOD_FOR.map((tag) => {
              const selected = selectedGoodFor.includes(tag);
              return (
                <TouchableOpacity
                  key={tag}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => {
                    if (selected) {
                      setSelectedGoodFor(selectedGoodFor.filter((t) => t !== tag));
                    } else {
                      setSelectedGoodFor([...selectedGoodFor, tag]);
                    }
                  }}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {tag.replace('_', ' ')}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Your Review *</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Share your experience..."
            placeholderTextColor="#666"
            value={reviewText}
            onChangeText={setReviewText}
            multiline
            numberOfLines={6}
          />
        </View>

        <TouchableOpacity
          style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          <Text style={styles.submitButtonText}>
            {submitting ? 'Posting...' : '✓ Post Review'}
          </Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>📍 Date Spots</Text>
        <TouchableOpacity onPress={() => setShowCreate(true)}>
          <Text style={styles.addButton}>+ Add</Text>
        </TouchableOpacity>
      </View>

      {/* Filters */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersScroll}>
        <TouchableOpacity
          style={[styles.filterChip, !filterType && styles.filterChipActive]}
          onPress={() => setFilterType(null)}
        >
          <Text style={[styles.filterChipText, !filterType && styles.filterChipTextActive]}>All</Text>
        </TouchableOpacity>
        {PLACE_TYPES.map((type) => (
          <TouchableOpacity
            key={type}
            style={[styles.filterChip, filterType === type && styles.filterChipActive]}
            onPress={() => setFilterType(type)}
          >
            <Text style={[styles.filterChipText, filterType === type && styles.filterChipTextActive]}>
              {type}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Reviews List */}
      <FlatList
        data={reviews}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.reviewCard}>
            <View style={styles.reviewHeader}>
              <View style={styles.reviewHeaderLeft}>
                {item.userPhoto && (
                  <Image source={{ uri: item.userPhoto }} style={styles.reviewUserPhoto} />
                )}
                <View>
                  <Text style={styles.reviewUserName}>{item.userName}</Text>
                  <Text style={styles.reviewDate}>
                    {new Date(item.createdAt).toLocaleDateString()}
                  </Text>
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
                {item.goodFor.map((tag, index) => (
                  <View key={index} style={styles.reviewTag}>
                    <Text style={styles.reviewTagText}>{tag.replace('_', ' ')}</Text>
                  </View>
                ))}
              </View>
            )}

            <TouchableOpacity
              style={styles.likeButton}
              onPress={() => handleLike(item.id)}
            >
              <Text style={styles.likeButtonText}>
                {item.likedBy?.includes('current_user_id') ? '❤️' : '🤍'} {item.likes}
              </Text>
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={() => (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No reviews yet. Be the first!</Text>
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

  filtersScroll: { paddingHorizontal: 15, paddingVertical: 10 },
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
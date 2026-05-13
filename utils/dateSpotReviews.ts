// utils/dateSpotReviews.ts
import { logger } from './logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DateSpotReview {
  id:          string;
  userId:      string;
  userName:    string;
  userPhoto?:  string;
  placeName:   string;
  placeAddress: string;
  placeType:   string;
  rating:      number;
  atmosphere:  number;
  priceRange:  string;
  review:      string;
  goodFor:     string[];
  likes:       number;
  likedBy?:    string[];
  createdAt:   string;
  updatedAt?:  string;
}

export interface SubmitReviewPayload {
  placeName:    string;
  placeAddress: string;
  placeType:    string;
  rating:       number;
  atmosphere:   number;
  priceRange:   string;
  review:       string;
  goodFor:      string[];
}

export interface SubmitReviewResult {
  success:    boolean;
  reviewId?:  string;
  error?:     string;
}

export interface LikeReviewResult {
  success: boolean;
  likes:   number;
  error?:  string;
}

// ─── API base URL ─────────────────────────────────────────────────────────────

const API_BASE = process.env['EXPO_PUBLIC_API_URL'] ?? '';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch date-spot reviews, optionally filtered by placeType or other fields.
 */
export async function getDateSpotReviews(
  filters: Record<string, string> = {},
): Promise<DateSpotReview[]> {
  try {
    const params = new URLSearchParams(filters);
    const query  = params.toString() ? `?${params.toString()}` : '';
    return await apiFetch<DateSpotReview[]>(`/api/date-spot-reviews${query}`);
  } catch (error) {
    logger.error('[dateSpotReviews] getDateSpotReviews error:', error);
    throw error;
  }
}

/**
 * Submit a new date-spot review.
 */
export async function submitDateSpotReview(
  payload: SubmitReviewPayload,
): Promise<SubmitReviewResult> {
  try {
    return await apiFetch<SubmitReviewResult>('/api/date-spot-reviews', {
      method: 'POST',
      body:   JSON.stringify(payload),
    });
  } catch (error) {
    logger.error('[dateSpotReviews] submitDateSpotReview error:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Like a date-spot review by its ID.
 */
export async function likeReview(reviewId: string): Promise<LikeReviewResult> {
  try {
    return await apiFetch<LikeReviewResult>(
      `/api/date-spot-reviews/${reviewId}/like`,
      { method: 'POST' },
    );
  } catch (error) {
    logger.error('[dateSpotReviews] likeReview error:', error);
    return { success: false, likes: 0, error: String(error) };
  }
}

// utils/dateSpotReviews.ts
import { addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, updateDoc, where } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { detectRatingManipulation, wilsonScoreLowerBound } from './datingStats';
import { writeAuditLog } from './logger';
import { checkDateReview } from './moderation';

export interface DateSpotReview {
  id: string; userId: string; userName: string; userPhoto: string;
  placeName: string; placeAddress: string;
  placeType: 'restaurant' | 'cafe' | 'bar' | 'park' | 'museum' | 'cinema' | 'other';
  rating: number; review: string; atmosphere: number;
  priceRange: '€' | '€€' | '€€€' | '€€€€'; goodFor: string[];
  photos?: string[]; latitude?: number; longitude?: number;
  createdAt: string; likes: number; likedBy: string[];
  wilsonScore?: number; flagged?: boolean;
}

export async function submitDateSpotReview(review: Omit<DateSpotReview, 'id' | 'userId' | 'userName' | 'userPhoto' | 'createdAt' | 'likes' | 'likedBy'>): Promise<{ success: boolean; reviewId?: string; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not authenticated' };
  if (review.review.trim().length > 0) { const m = checkDateReview(review.review); if (!m.safe) return { success: false, error: m.reason }; }
  if (review.review.length > 1000) return { success: false, error: 'Review must be under 1000 characters.' };
  if (review.rating < 1 || review.rating > 5) return { success: false, error: 'Rating must be between 1 and 5.' };
  const existing = await getDocs(query(collection(db, 'dateSpotReviews'), where('userId', '==', user.uid), where('placeName', '==', review.placeName)));
  if (!existing.empty) return { success: false, error: 'You have already reviewed this place.' };
  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) return { success: false, error: 'User not found' };
    const ud = userDoc.data();
    const ws = Math.round(wilsonScoreLowerBound(review.rating >= 3 ? 1 : 0, 1) * 100);
    const ref = await addDoc(collection(db, 'dateSpotReviews'), { ...review, userId: user.uid, userName: ud.name ?? 'Anonymous', userPhoto: ud.photos?.[0] ?? '', createdAt: new Date().toISOString(), likes: 0, likedBy: [], wilsonScore: ws, flagged: false });
    return { success: true, reviewId: ref.id };
  } catch (e) { console.error('[dateSpotReviews] submitReview error:', e); return { success: false, error: 'Failed to submit review' }; }
}

export async function getDateSpotReviews(filters?: { placeType?: string; priceRange?: string; goodFor?: string; minRating?: number }): Promise<DateSpotReview[]> {
  try {
    const snap = await getDocs(query(collection(db, 'dateSpotReviews'), where('flagged', '==', false), orderBy('createdAt', 'desc'), limit(50)));
    let reviews: DateSpotReview[] = snap.docs.map(d => ({ id: d.id, ...d.data() } as DateSpotReview));
    if (filters) {
      if (filters.placeType) reviews = reviews.filter(r => r.placeType === filters.placeType);
      if (filters.priceRange) reviews = reviews.filter(r => r.priceRange === filters.priceRange);
      if (filters.goodFor) reviews = reviews.filter(r => r.goodFor.includes(filters.goodFor!));
      if (filters.minRating) reviews = reviews.filter(r => r.rating >= filters.minRating!);
    }
    return reviews.sort((a, b) => (b.wilsonScore ?? 0) - (a.wilsonScore ?? 0));
  } catch (e) { console.error('[dateSpotReviews] getReviews error:', e); return []; }
}

export async function likeReview(reviewId: string): Promise<{ success: boolean; liked: boolean }> {
  const user = auth.currentUser;
  if (!user) return { success: false, liked: false };
  try {
    const ref = doc(db, 'dateSpotReviews', reviewId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { success: false, liked: false };
    const r = snap.data() as DateSpotReview;
    const already = r.likedBy.includes(user.uid);
    const newLikes = already ? Math.max(0, r.likes - 1) : r.likes + 1;
    const newLikedBy = already ? r.likedBy.filter(id => id !== user.uid) : [...r.likedBy, user.uid];
    const ws = Math.round(wilsonScoreLowerBound(Math.round((r.rating / 5) * newLikes), Math.max(newLikes, 1)) * 100);
    await updateDoc(ref, { likes: newLikes, likedBy: newLikedBy, wilsonScore: ws });
    return { success: true, liked: !already };
  } catch (e) { console.error('[dateSpotReviews] likeReview error:', e); return { success: false, liked: false }; }
}

// ── #172: Fake review network detection ──────────────────
export async function detectFakeReviewNetwork(placeName: string): Promise<{ suspicious: boolean; reason?: string; reviewsToFlag: string[] }> {
  try {
    const snap = await getDocs(query(collection(db, 'dateSpotReviews'), where('placeName', '==', placeName), orderBy('createdAt', 'desc'), limit(20)));
    const reviews: DateSpotReview[] = snap.docs.map(d => ({ id: d.id, ...d.data() } as DateSpotReview));
    if (reviews.length < 3) return { suspicious: false, reviewsToFlag: [] };
    const toFlag: string[] = [], reasons: string[] = [];
    const sorted = [...reviews].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    for (let i = 2; i < sorted.length; i++) {
      const w = sorted.slice(i - 2, i + 1);
      if ((new Date(w[w.length - 1]!.createdAt).getTime() - new Date(w[0]!.createdAt).getTime()) / 60_000 < 60) {
        reasons.push('3+ reviews in 1 hour');
        w.forEach(r => { if (!toFlag.includes(r.id)) toFlag.push(r.id); });
      }
    }
    if (reviews.length >= 5 && (reviews.every(r => r.rating === 5) || reviews.every(r => r.rating === 1))) reasons.push('Suspiciously uniform ratings');
    const manip = detectRatingManipulation(reviews.map(r => ({ score: r.rating, timestamp: new Date(r.createdAt).getTime(), raterUserId: r.userId })));
    if (manip.manipulated) { reasons.push(manip.reason ?? 'Rating manipulation detected'); reviews.forEach(r => { if (!toFlag.includes(r.id)) toFlag.push(r.id); }); }
    if (toFlag.length > 0) await writeAuditLog('safety.content_flagged', { type: 'fake_review_network', placeName, reviewCount: toFlag.length, reasons });
    return { suspicious: reasons.length > 0, reason: reasons.join('; '), reviewsToFlag: toFlag };
  } catch (e) { console.error('[dateSpotReviews] detectFakeReviews error:', e); return { suspicious: false, reviewsToFlag: [] }; }
}

export function getAverageRatingForPlace(reviews: DateSpotReview[], placeName: string): number {
  const pr = reviews.filter(r => r.placeName.toLowerCase() === placeName.toLowerCase());
  if (!pr.length) return 0;
  return Math.round((pr.reduce((s, r) => s + r.rating, 0) / pr.length) * 10) / 10;
}
import { addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';

export interface DateSpotReview {
  id: string;
  userId: string;
  userName: string;
  userPhoto: string;
  placeName: string;
  placeAddress: string;
  placeType: 'restaurant' | 'cafe' | 'bar' | 'park' | 'museum' | 'cinema' | 'other';
  rating: number; // 1-5
  review: string;
  atmosphere: number; // 1-5
  priceRange: '€' | '€€' | '€€€' | '€€€€';
  goodFor: string[]; // ['first_date', 'casual', 'romantic', 'group', 'coffee_chat']
  photos?: string[];
  latitude?: number;
  longitude?: number;
  createdAt: string;
  likes: number;
  likedBy: string[];
}

export async function submitDateSpotReview(
  review: Omit<DateSpotReview, 'id' | 'userId' | 'userName' | 'userPhoto' | 'createdAt' | 'likes' | 'likedBy'>
): Promise<{ success: boolean; reviewId?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false };

  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) return { success: false };

    const userData = userDoc.data();

    const fullReview: Omit<DateSpotReview, 'id'> = {
      ...review,
      userId: user.uid,
      userName: userData.name || 'Anonymous',
      userPhoto: userData.photos?.[0] || '',
      createdAt: new Date().toISOString(),
      likes: 0,
      likedBy: [],
    };

    const reviewRef = await addDoc(collection(db, 'dateSpotReviews'), fullReview);

    return { success: true, reviewId: reviewRef.id };
  } catch (error) {
    console.error('Error submitting review:', error);
    return { success: false };
  }
}

export async function getDateSpotReviews(
  filters?: {
    placeType?: string;
    priceRange?: string;
    goodFor?: string;
    minRating?: number;
  }
): Promise<DateSpotReview[]> {
  try {
    let q = query(collection(db, 'dateSpotReviews'), orderBy('createdAt', 'desc'), limit(50));

    const snapshot = await getDocs(q);

    let reviews: DateSpotReview[] = [];
    snapshot.forEach(doc => {
      reviews.push({ id: doc.id, ...doc.data() } as DateSpotReview);
    });

    // Client-side filtering
    if (filters) {
      if (filters.placeType) {
        reviews = reviews.filter(r => r.placeType === filters.placeType);
      }
      if (filters.priceRange) {
        reviews = reviews.filter(r => r.priceRange === filters.priceRange);
      }
      if (filters.goodFor) {
        reviews = reviews.filter(r => r.goodFor.includes(filters.goodFor!));
      }
      if (filters.minRating) {
        reviews = reviews.filter(r => r.rating >= filters.minRating!);
      }
    }

    return reviews;
  } catch (error) {
    console.error('Error getting reviews:', error);
    return [];
  }
}

export async function likeReview(reviewId: string): Promise<{ success: boolean; liked: boolean }> {
  const user = auth.currentUser;
  if (!user) return { success: false, liked: false };

  try {
    const reviewRef = doc(db, 'dateSpotReviews', reviewId);
    const reviewDoc = await getDoc(reviewRef);
    
    if (!reviewDoc.exists()) return { success: false, liked: false };

    const review = reviewDoc.data() as DateSpotReview;
    const alreadyLiked = review.likedBy.includes(user.uid);

    if (alreadyLiked) {
      // Unlike
      await updateDoc(reviewRef, {
        likes: Math.max(0, review.likes - 1),
        likedBy: review.likedBy.filter(id => id !== user.uid),
      });
      return { success: true, liked: false };
    } else {
      // Like
      await updateDoc(reviewRef, {
        likes: review.likes + 1,
        likedBy: [...review.likedBy, user.uid],
      });
      return { success: true, liked: true };
    }
  } catch (error) {
    console.error('Error liking review:', error);
    return { success: false, liked: false };
  }
}

export function getAverageRatingForPlace(reviews: DateSpotReview[], placeName: string): number {
  const placeReviews = reviews.filter(r => r.placeName.toLowerCase() === placeName.toLowerCase());
  if (placeReviews.length === 0) return 0;

  const sum = placeReviews.reduce((acc, r) => acc + r.rating, 0);
  return Math.round((sum / placeReviews.length) * 10) / 10;
}
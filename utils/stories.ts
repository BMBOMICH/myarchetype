import {
    addDoc,
    arrayUnion,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    increment,
    onSnapshot,
    query,
    updateDoc,
    where,
    writeBatch,
} from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { uploadToCloudinary } from './cloudinaryUpload';

// ─── Constants ────────────────────────────────────────────

export const STORY_DURATION_HOURS = 24;

const COL_STORIES = 'stories' as const;
const COL_LIKES = 'likes' as const;
const COL_USERS = 'users' as const;

/** Firestore writeBatch hard limit */
const BATCH_LIMIT = 500;

// ─── Types ────────────────────────────────────────────────

export interface Story {
  id: string;
  userId: string;
  userName: string;
  userPhoto: string;
  mediaUrl: string;
  mediaType: 'photo' | 'video';
  createdAt: string;
  expiresAt: string;
  views: string[];
  viewCount: number;
}

/** One circle in the Stories row — one per user. */
export interface StoryGroup {
  userId: string;
  userName: string;
  userPhoto: string;
  stories: Story[];
  hasUnviewed: boolean;
  latestAt: string;
}

// ─── Internal helpers ─────────────────────────────────────

function requireAuth() {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  return user;
}

function storyRef(id: string) {
  return doc(db, COL_STORIES, id);
}

function storiesCol() {
  return collection(db, COL_STORIES);
}

function computeExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + STORY_DURATION_HOURS * 3_600_000);
}

/** Returns the set of user IDs the given user is matched with. */
async function getMatchedUserIds(userId: string): Promise<Set<string>> {
  const likesCol = collection(db, COL_LIKES);

  const [fromSnap, toSnap] = await Promise.all([
    getDocs(
      query(
        likesCol,
        where('fromUserId', '==', userId),
        where('status', '==', 'matched')
      )
    ),
    getDocs(
      query(
        likesCol,
        where('toUserId', '==', userId),
        where('status', '==', 'matched')
      )
    ),
  ]);

  const ids = new Set<string>();
  fromSnap.forEach((d) => ids.add(d.data().toUserId));
  toSnap.forEach((d) => ids.add(d.data().fromUserId));
  return ids;
}

/** Standard sort: own stories first, then newest-first. */
function sortStories(stories: Story[], currentUserId: string): void {
  stories.sort((a, b) => {
    if (a.userId === currentUserId && b.userId !== currentUserId) return -1;
    if (a.userId !== currentUserId && b.userId === currentUserId) return 1;
    return (
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  });
}

// ─── Create ───────────────────────────────────────────────

export async function createStory(
  mediaUri: string,
  mediaType: 'photo' | 'video'
): Promise<{ success: boolean; storyId?: string; error?: string }> {
  try {
    const user = requireAuth();

    // 1 - User profile
    const userSnap = await getDoc(doc(db, COL_USERS, user.uid));
    if (!userSnap.exists()) {
      return { success: false, error: 'User profile not found' };
    }
    const userData = userSnap.data();

    // 2 - Upload to Cloudinary
    const tag = mediaType === 'video' ? 'story_video' : 'story_photo';
    const upload = await uploadToCloudinary(mediaUri, tag);

    if (!upload.success || !upload.url) {
      return { success: false, error: upload.error ?? 'Media upload failed' };
    }

    // 3 - Write Firestore document
    const now = new Date();

    const story: Omit<Story, 'id'> = {
      userId: user.uid,
      userName: userData.name || 'User',
      userPhoto: userData.photos?.[0] ?? '',
      mediaUrl: upload.url,
      mediaType,
      createdAt: now.toISOString(),
      expiresAt: computeExpiry(now).toISOString(),
      views: [],
      viewCount: 0,
    };

    const ref = await addDoc(storiesCol(), story);
    return { success: true, storyId: ref.id };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Unknown error';
    console.error('[Stories] create error:', message);
    return { success: false, error: message };
  }
}

// ─── Read ─────────────────────────────────────────────────

/**
 * Fetch active (non-expired) stories visible to the current user.
 * Includes own stories + stories from matched users.
 */
export async function getActiveStories(userId: string): Promise<Story[]> {
  try {
    const now = new Date().toISOString();
    const matchIds = await getMatchedUserIds(userId);

    const q = query(storiesCol(), where('expiresAt', '>', now));
    const snap = await getDocs(q);

    const stories: Story[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data() as Omit<Story, 'id'>;
      if (data.userId === userId || matchIds.has(data.userId)) {
        stories.push({ id: docSnap.id, ...data });
      }
    });

    sortStories(stories, userId);
    return stories;
  } catch (error: unknown) {
    console.error('[Stories] getActive error:', error);
    return [];
  }
}

/**
 * Real-time listener for active stories.
 * Returns an unsubscribe function.
 */
export function subscribeToActiveStories(
  userId: string,
  onUpdate: (stories: Story[]) => void
): () => void {
  const now = new Date().toISOString();
  const q = query(storiesCol(), where('expiresAt', '>', now));

  let matchIds = new Set<string>();
  getMatchedUserIds(userId)
    .then((ids) => {
      matchIds = ids;
    })
    .catch(() => {});

  return onSnapshot(
    q,
    (snap) => {
      const stories: Story[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data() as Omit<Story, 'id'>;
        if (data.userId === userId || matchIds.has(data.userId)) {
          stories.push({ id: docSnap.id, ...data });
        }
      });
      sortStories(stories, userId);
      onUpdate(stories);
    },
    (error) => {
      console.error('[Stories] subscription error:', error);
      onUpdate([]);
    }
  );
}

// ─── Grouping (for the circle UI) ─────────────────────────

/** Collapses a flat story list into one group per user. */
export function groupStoriesByUser(
  stories: Story[],
  currentUserId: string
): StoryGroup[] {
  const map = new Map<string, StoryGroup>();

  for (const story of stories) {
    let group = map.get(story.userId);

    if (!group) {
      group = {
        userId: story.userId,
        userName:
          story.userId === currentUserId ? 'Your Story' : story.userName,
        userPhoto: story.userPhoto,
        stories: [],
        hasUnviewed: false,
        latestAt: story.createdAt,
      };
      map.set(story.userId, group);
    }

    group.stories.push(story);

    if (
      !story.views.includes(currentUserId) &&
      story.userId !== currentUserId
    ) {
      group.hasUnviewed = true;
    }

    if (story.createdAt > group.latestAt) {
      group.latestAt = story.createdAt;
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.userId === currentUserId) return -1;
    if (b.userId === currentUserId) return 1;
    return (
      new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime()
    );
  });
}

// ─── Update ───────────────────────────────────────────────

/**
 * Atomically marks a story as viewed.
 * Uses arrayUnion + increment to avoid race conditions.
 */
export async function markStoryViewed(storyId: string): Promise<void> {
  try {
    const user = requireAuth();
    const ref = storyRef(storyId);
    const snap = await getDoc(ref);

    if (!snap.exists()) return;

    const data = snap.data() as Story;

    // Skip own stories and already-viewed
    if (data.userId === user.uid) return;
    if (data.views.includes(user.uid)) return;

    await updateDoc(ref, {
      views: arrayUnion(user.uid),
      viewCount: increment(1),
    });
  } catch (error: unknown) {
    console.error('[Stories] markViewed error:', error);
  }
}

// ─── Delete ───────────────────────────────────────────────

export async function deleteStory(
  storyId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = requireAuth();
    const ref = storyRef(storyId);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      return { success: false, error: 'Story not found' };
    }

    const data = snap.data() as Story;
    if (data.userId !== user.uid) {
      return { success: false, error: "Cannot delete another user\u2019s story" };
    }

    await deleteDoc(ref);
    return { success: true };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Stories] delete error:', msg);
    return { success: false, error: msg };
  }
}

/**
 * Batch-deletes all expired stories.
 * Intended to run periodically or via a Cloud Function.
 */
export async function cleanupExpiredStories(): Promise<number> {
  try {
    const now = new Date().toISOString();
    const q = query(storiesCol(), where('expiresAt', '<', now));
    const snap = await getDocs(q);

    if (snap.empty) return 0;

    const docs = snap.docs;
    let deleted = 0;

    for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
      const batch = writeBatch(db);
      const chunk = docs.slice(i, i + BATCH_LIMIT);

      for (const docSnap of chunk) {
        batch.delete(doc(db, COL_STORIES, docSnap.id));
      }

      await batch.commit();
      deleted += chunk.length;
    }

    if (deleted > 0) {
      console.log(`[Stories] cleaned up ${deleted} expired stories`);
    }
    return deleted;
  } catch (error: unknown) {
    console.error('[Stories] cleanup error:', error);
    return 0;
  }
}

// ─── Utility ──────────────────────────────────────────────

/** Human-readable remaining time, e.g. "23h 14m", "5m", "<1m". */
export function getStoryTimeRemaining(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();

  if (diff <= 0) return 'Expired';

  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) return `${minutes}m`;
  return '<1m';
}
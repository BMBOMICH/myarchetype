import { addDoc, arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, increment, onSnapshot, query, updateDoc, where, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { uploadToCloudinary } from './cloudinaryUpload';
import { logger } from './logger';
import { checkImageSafety, checkTextSafety, checkVideoFramesSafety, detectEmojiCodedLanguage, detectEmojiSpam, ocrThenModerate } from './moderation';
import { analyzeMessageTiming } from './rateLimiter';

export const STORY_DURATION_HOURS = 24;

export interface Story {
  id: string; userId: string; userName: string; userPhoto: string;
  mediaUrl: string; mediaType: 'photo' | 'video'; caption?: string;
  createdAt: string; expiresAt: string; views: string[];
  viewCount: number; viewTimestamps?: number[]; flagged?: boolean;
}

export interface StoryGroup {
  userId: string; userName: string; userPhoto: string;
  stories: Story[]; hasUnviewed: boolean; latestAt: string;
}

function requireAuth() { const u = auth.currentUser; if (!u) throw new Error('Not authenticated'); return u; }
function storyRef(id: string) { return doc(db, 'stories', id); }
function storiesCol() { return collection(db, 'stories'); }
function computeExpiry(from = new Date()) { return new Date(from.getTime() + STORY_DURATION_HOURS * 3_600_000); }

async function getMatchedUserIds(userId: string): Promise<Set<string>> {
  const col = collection(db, 'likes');
  const [fromSnap, toSnap] = await Promise.all([
    getDocs(query(col, where('fromUserId', '==', userId), where('status', '==', 'matched'))),
    getDocs(query(col, where('toUserId', '==', userId), where('status', '==', 'matched'))),
  ]);
  const ids = new Set<string>();
  fromSnap.forEach(d => ids.add(d.data()['toUserId'] as string));
  toSnap.forEach(d => ids.add(d.data()['fromUserId'] as string));
  return ids;
}

function sortStories(stories: Story[], uid: string) {
  stories.sort((a, b) => {
    if (a.userId === uid && b.userId !== uid) return -1;
    if (a.userId !== uid && b.userId === uid) return 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function checkCaption(caption: string): { safe: boolean; reason?: string } {
  if (!caption?.trim()) return { safe: true };
  const emojiCheck = detectEmojiSpam(caption, 0.6);
  if (emojiCheck.isSpam) return { safe: false, reason: 'Caption contains too many emojis.' };
  const emojiCoded = detectEmojiCodedLanguage(caption);
  if (emojiCoded.detected) return { safe: false, reason: 'Story caption contains coded language.' };
  const textCheck = checkTextSafety(caption, 'general');
  if (!textCheck.safe) return { safe: false, reason: textCheck.reason };
  if (/(\+?\d[\d\s\-().]{7,}\d)/.test(caption) || /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/.test(caption))
    return { safe: false, reason: 'Contact information is not allowed in story captions.' };
  return { safe: true };
}

export async function createStory(
  mediaUri: string,
  mediaType: 'photo' | 'video',
  caption?: string,
): Promise<{ success: boolean; storyId?: string; error?: string }> {
  try {
    const user = requireAuth();
    if (mediaType === 'photo') {
      const safety = await checkImageSafety(mediaUri, 'story');
      if (!safety.safe) return { success: false, error: safety.reason ?? 'Content rejected.' };
      const ocrCheck = await ocrThenModerate(mediaUri);
      if (!ocrCheck.safe) return { success: false, error: ocrCheck.reason ?? 'Image contains prohibited text.' };
    }
    if (mediaType === 'video') {
      const videoSafety = await checkVideoFramesSafety(mediaUri, 6);
      if (!videoSafety.safe) return { success: false, error: videoSafety.reason ?? 'Video contains inappropriate content.' };
    }
    if (caption) {
      const cc = checkCaption(caption);
      if (!cc.safe) return { success: false, ...(cc.reason !== undefined ? { error: cc.reason } : {}) };
    }
    const userSnap = await getDoc(doc(db, 'users', user.uid));
    if (!userSnap.exists()) return { success: false, error: 'User profile not found' };
    const userData = userSnap.data();
    const upload = await uploadToCloudinary(mediaUri, mediaType === 'video' ? 'story_video' : 'story_photo');
    if (!upload.success || !upload.url) return { success: false, error: upload.error ?? 'Media upload failed' };
    const now = new Date();
    const storyData: Omit<Story, 'id'> & { caption?: string } = {
      userId: user.uid,
      userName: (userData['name'] as string | undefined) ?? 'User',
      userPhoto: (userData['photos'] as string[] | undefined)?.[0] ?? '',
      mediaUrl: upload.url,
      mediaType,
      createdAt: now.toISOString(),
      expiresAt: computeExpiry(now).toISOString(),
      views: [],
      viewCount: 0,
      viewTimestamps: [],
      flagged: false,
    };
    if (caption?.trim()) storyData.caption = caption.trim();
    const ref = await addDoc(storiesCol(), storyData);
    return { success: true, storyId: ref.id };
  } catch (e: unknown) {
    logger.error('[Stories] create error:', e);
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

export async function getActiveStories(userId: string): Promise<Story[]> {
  try {
    const now = new Date().toISOString();
    const matchIds = await getMatchedUserIds(userId);
    const snap = await getDocs(query(storiesCol(), where('expiresAt', '>', now)));
    const stories: Story[] = [];
    snap.forEach(d => {
      const data = d.data() as Omit<Story, 'id'>;
      if (data.userId === userId || matchIds.has(data.userId)) stories.push({ id: d.id, ...data });
    });
    sortStories(stories, userId);
    return stories;
  } catch (e: unknown) { logger.error('[Stories] getActive error:', e); return []; }
}

export function subscribeToActiveStories(userId: string, onUpdate: (s: Story[]) => void): () => void {
  const q = query(storiesCol(), where('expiresAt', '>', new Date().toISOString()));
  let matchIds = new Set<string>();
  getMatchedUserIds(userId).then(ids => { matchIds = ids; }).catch(() => {});
  return onSnapshot(q, snap => {
    const stories: Story[] = [];
    snap.forEach(d => {
      const data = d.data() as Omit<Story, 'id'>;
      if (data.userId === userId || matchIds.has(data.userId)) stories.push({ id: d.id, ...data });
    });
    sortStories(stories, userId);
    onUpdate(stories);
  }, () => onUpdate([]));
}

export function groupStoriesByUser(stories: Story[], currentUserId: string): StoryGroup[] {
  const map = new Map<string, StoryGroup>();
  for (const story of stories) {
    let group = map.get(story.userId);
    if (!group) {
      group = { userId: story.userId, userName: story.userId === currentUserId ? 'Your Story' : story.userName, userPhoto: story.userPhoto, stories: [], hasUnviewed: false, latestAt: story.createdAt };
      map.set(story.userId, group);
    }
    group.stories.push(story);
    if (!story.views.includes(currentUserId) && story.userId !== currentUserId) group.hasUnviewed = true;
    if (story.createdAt > group.latestAt) group.latestAt = story.createdAt;
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.userId === currentUserId) return -1;
    if (b.userId === currentUserId) return 1;
    return new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime();
  });
}

export async function markStoryViewed(storyId: string): Promise<void> {
  try {
    const user = requireAuth();
    const ref = storyRef(storyId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const data = snap.data() as Story;
    if (data.userId === user.uid || data.views.includes(user.uid)) return;
    const now = Date.now();
    await updateDoc(ref, { views: arrayUnion(user.uid), viewCount: increment(1), viewTimestamps: arrayUnion(now) });
    const timestamps = [...(data.viewTimestamps ?? []), now];
    if (timestamps.length >= 5) {
      const botCheck = analyzeMessageTiming(timestamps);
      if (botCheck.isBot) {
        logger.warn(`[Stories] Bot-like views on ${storyId}: ${botCheck.reason}`);
        await updateDoc(ref, { flagged: true }).catch(() => {});
      }
    }
  } catch (e: unknown) { logger.error('[Stories] markViewed error:', e); }
}

export async function deleteStory(storyId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const user = requireAuth();
    const ref = storyRef(storyId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { success: false, error: 'Story not found' };
    if ((snap.data() as Story).userId !== user.uid) return { success: false, error: "Cannot delete another user's story" };
    await deleteDoc(ref);
    return { success: true };
  } catch (e: unknown) {
    logger.error('[Stories] delete error:', e);
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

export async function cleanupExpiredStories(): Promise<number> {
  try {
    const snap = await getDocs(query(storiesCol(), where('expiresAt', '<', new Date().toISOString())));
    if (snap.empty) return 0;
    let deleted = 0;
    for (let i = 0; i < snap.docs.length; i += 500) {
      const batch = writeBatch(db);
      snap.docs.slice(i, i + 500).forEach(d => batch.delete(doc(db, 'stories', d.id)));
      await batch.commit();
      deleted += Math.min(500, snap.docs.length - i);
    }
    if (deleted > 0) logger.warn(`[Stories] cleaned up ${deleted} expired stories`);
    return deleted;
  } catch (e: unknown) { logger.error('[Stories] cleanup error:', e); return 0; }
}

export function detectGhostStories(stories: Story[]): Story[] {
  const now = Date.now();
  return stories.filter(s => now - new Date(s.createdAt).getTime() > 3 * 3_600_000 && s.viewCount === 0);
}

export function getStoryTimeRemaining(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const h = Math.floor(diff / 3_600_000), m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return m > 0 ? `${m}m` : '<1m';
}
// src/hooks/useData.ts
import { useQuery } from '@tanstack/react-query';
import { collection, doc, getDoc, getDocs, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../firebaseConfig';

// ── Query Keys ────────────────────────────────────────────────────────────────
export const queryKeys = {
  user:        (id: string)     => ['user',    id]      as const,
  matches:     (id: string)     => ['matches', id]      as const,
  match:       (id: string)     => ['match',   id]      as const,
  profiles:                        ['profiles']          as const,
  dateSpots:                       ['dateSpots']         as const,
  stories:                         ['stories']           as const,
  dailyQuestion:(date: string)  => ['dailyQuestion', date] as const,
};

// ── User ──────────────────────────────────────────────────────────────────────
export function useUserData(userId: string | null) {
  return useQuery({
    queryKey:  queryKeys.user(userId ?? ''),
    queryFn:   async () => {
      if (!userId) throw new Error('No user ID');
      const snap = await getDoc(doc(db, 'users', userId));
      if (!snap.exists()) throw new Error('User not found');
      return { id: snap.id, ...snap.data() };
    },
    enabled:   !!userId,
    staleTime: 1000 * 60 * 5,
    gcTime:    1000 * 60 * 30,
    retry:     2,
  });
}

// ── Matches ───────────────────────────────────────────────────────────────────
export function useMatches(userId: string | null) {
  return useQuery({
    queryKey:  queryKeys.matches(userId ?? ''),
    queryFn:   async () => {
      if (!userId) throw new Error('No user ID');
      const q    = query(collection(db, 'matches'), where('users', 'array-contains', userId));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    enabled:   !!userId,
    staleTime: 1000 * 60 * 2,
    gcTime:    1000 * 60 * 15,
    retry:     2,
  });
}

// ── Date Spots ────────────────────────────────────────────────────────────────
export function useDateSpots() {
  return useQuery({
    queryKey:  queryKeys.dateSpots,
    queryFn:   async () => {
      const snap = await getDocs(collection(db, 'dateSpots'));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    staleTime: 1000 * 60 * 10,
    gcTime:    1000 * 60 * 60,
    retry:     2,
  });
}

// ── Stories ───────────────────────────────────────────────────────────────────
export function useStories() {
  return useQuery({
    queryKey:  queryKeys.stories,
    queryFn:   async () => {
      const q    = query(collection(db, 'stories'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    staleTime: 1000 * 60 * 1,
    gcTime:    1000 * 60 * 10,
    retry:     2,
  });
}
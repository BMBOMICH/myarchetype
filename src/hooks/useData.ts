// src/hooks/useData.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../../firebaseConfig';

// ── Query Keys ────────────────────────────────────────────────────────────────
export const queryKeys = {
  user:         (id: string) => ['user',    id]      as const,
  matches:      (id: string) => ['matches', id]      as const,
  match:        (id: string) => ['match',   id]      as const,
  profiles:                        ['profiles']          as const,
  dateSpots:                       ['dateSpots']         as const,
  stories:                         ['stories']           as const,
  dailyQuestion: (date: string) => ['dailyQuestion', date] as const,
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

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      userId,
      data,
    }: {
      userId: string;
      data: Record<string, unknown>;
    }) => {
      await updateDoc(doc(db, 'users', userId), data);
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.user(vars.userId) });
    },
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

export function useUpdateMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      matchId,
      data,
    }: {
      matchId: string;
      data: Record<string, unknown>;
    }) => {
      await updateDoc(doc(db, 'matches', matchId), data);
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.match(vars.matchId) });
    },
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

export function useCreateDateSpotReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const ref = await addDoc(collection(db, 'dateSpots'), {
        ...payload,
        createdAt: serverTimestamp(),
      });
      return ref.id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.dateSpots });
    },
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

export function useCreateStory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const ref = await addDoc(collection(db, 'stories'), {
        ...payload,
        createdAt: serverTimestamp(),
      });
      return ref.id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.stories });
    },
  });
}

// ── Generic helpers ───────────────────────────────────────────────────────────
export function useDeleteDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (path: string) => {
      await deleteDoc(doc(db, path));
    },
    onSuccess: () => {
      // Caller should invalidate specific keys; this is a fallback
      qc.invalidateQueries();
    },
  });
}

export function useSetDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      path,
      data,
      merge = true,
    }: {
      path:  string;
      data:  Record<string, unknown>;
      merge?: boolean;
    }) => {
      await setDoc(doc(db, path), data, { merge });
    },
    onSuccess: () => {
      qc.invalidateQueries();
    },
  });
}
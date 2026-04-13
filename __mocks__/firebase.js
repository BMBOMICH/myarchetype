// __mocks__/firebase.js
'use strict';

// Firestore mock
const mockDoc = {
  exists: jest.fn(() => true),
  data: jest.fn(() => ({})),
  id: 'mock-doc-id',
};

const mockSnapshot = {
  docs: [],
  empty: true,
  size: 0,
  forEach: jest.fn(),
};

module.exports = {
  // Auth
  getAuth: jest.fn(() => ({
    currentUser: { uid: 'test-uid', email: 'test@test.com' },
    onAuthStateChanged: jest.fn(),
  })),
  signInWithEmailAndPassword: jest.fn().mockResolvedValue({ user: { uid: 'test-uid' } }),
  createUserWithEmailAndPassword: jest.fn().mockResolvedValue({ user: { uid: 'test-uid' } }),
  signOut: jest.fn().mockResolvedValue(undefined),
  onAuthStateChanged: jest.fn(),
  GoogleAuthProvider: jest.fn(),
  signInWithCredential: jest.fn().mockResolvedValue({ user: { uid: 'test-uid' } }),

  // Firestore
  getFirestore: jest.fn(() => ({})),
  collection: jest.fn(() => ({})),
  doc: jest.fn(() => ({})),
  getDoc: jest.fn().mockResolvedValue(mockDoc),
  getDocs: jest.fn().mockResolvedValue(mockSnapshot),
  setDoc: jest.fn().mockResolvedValue(undefined),
  addDoc: jest.fn().mockResolvedValue({ id: 'mock-id' }),
  updateDoc: jest.fn().mockResolvedValue(undefined),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(() => ({})),
  where: jest.fn(() => ({})),
  orderBy: jest.fn(() => ({})),
  limit: jest.fn(() => ({})),
  onSnapshot: jest.fn(() => jest.fn()),
  serverTimestamp: jest.fn(() => new Date()),
  arrayUnion: jest.fn((...args) => args),
  arrayRemove: jest.fn((...args) => args),
  increment: jest.fn((n) => n),
  Timestamp: {
    now: jest.fn(() => ({ toDate: () => new Date() })),
    fromDate: jest.fn((d) => ({ toDate: () => d })),
  },

  // Storage
  getStorage: jest.fn(() => ({})),
  ref: jest.fn(() => ({})),
  uploadBytes: jest.fn().mockResolvedValue({}),
  getDownloadURL: jest.fn().mockResolvedValue('https://mock-url.com/image.jpg'),
  deleteObject: jest.fn().mockResolvedValue(undefined),

  // App
  initializeApp: jest.fn(() => ({})),
  getApp: jest.fn(() => ({})),
  getApps: jest.fn(() => []),
};
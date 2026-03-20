import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyAZPv64XqCW5x6OEzSfEQZCSUfjD8m46h0",
  authDomain: "myarchetype-b2ba0.firebaseapp.com",
  projectId: "myarchetype-b2ba0",
  storageBucket: "myarchetype-b2ba0.firebasestorage.app",
  messagingSenderId: "460955155446",
  appId: "1:460955155446:web:0809c96ab99cd5b9c0e5d7"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
export const auth = getAuth(app);
export const db = getFirestore(app);

console.log('🔥 Firebase initialized successfully');
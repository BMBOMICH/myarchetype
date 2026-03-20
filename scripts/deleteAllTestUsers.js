const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, deleteDoc, doc } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: "AIzaSyAZPv64XqCW5x6OEzSfEQZCSUfjD8m46h0",
  authDomain: "myarchetype-b2ba0.firebaseapp.com",
  projectId: "myarchetype-b2ba0",
  storageBucket: "myarchetype-b2ba0.firebasestorage.app",
  messagingSenderId: "460955155446",
  appId: "1:460955155446:web:0809c96ab99cd5b9c0e5d7"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function deleteAllTestUsers() {
  console.log('🗑️  Deleting all test users...\n');

  const testUserIds = [
    'test-user-001', 'test-user-002', 'test-user-003', 'test-user-004', 'test-user-005',
    'test-user-006', 'test-user-007', 'test-user-008', 'test-user-009', 'test-user-010'
  ];

  for (const uid of testUserIds) {
    try {
      await deleteDoc(doc(db, 'users', uid));
      console.log(`✅ Deleted: ${uid}`);
    } catch (error) {
      console.log(`⏭️  Skipped: ${uid} (doesn't exist)`);
    }
  }

  console.log('\n🎉 All test users deleted!\n');
  process.exit(0);
}

deleteAllTestUsers();
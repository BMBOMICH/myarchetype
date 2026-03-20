const { initializeApp } = require('firebase/app');
const { getFirestore, doc, setDoc } = require('firebase/firestore');

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

const testUsers = [
  { uid: 'test-user-001', email: 'sarah@test.com', name: 'Sarah', age: 23, gender: 'Female', height: 165, bodyType: 'Slim', lookingFor: 'Athletic' },
  { uid: 'test-user-002', email: 'emma@test.com', name: 'Emma', age: 25, gender: 'Female', height: 170, bodyType: 'Athletic', lookingFor: 'Any' },
  { uid: 'test-user-003', email: 'olivia@test.com', name: 'Olivia', age: 24, gender: 'Female', height: 162, bodyType: 'Curvy', lookingFor: 'Athletic' },
  { uid: 'test-user-004', email: 'sophia@test.com', name: 'Sophia', age: 26, gender: 'Female', height: 168, bodyType: 'Average', lookingFor: 'Any' },
  { uid: 'test-user-005', email: 'mia@test.com', name: 'Mia', age: 22, gender: 'Female', height: 172, bodyType: 'Slim', lookingFor: 'Athletic' },
  { uid: 'test-user-006', email: 'ava@test.com', name: 'Ava', age: 27, gender: 'Female', height: 160, bodyType: 'Athletic', lookingFor: 'Any' },
  { uid: 'test-user-007', email: 'isabella@test.com', name: 'Isabella', age: 23, gender: 'Female', height: 167, bodyType: 'Curvy', lookingFor: 'Any' },
  { uid: 'test-user-008', email: 'charlotte@test.com', name: 'Charlotte', age: 25, gender: 'Female', height: 169, bodyType: 'Average', lookingFor: 'Athletic' },
  { uid: 'test-user-009', email: 'amelia@test.com', name: 'Amelia', age: 24, gender: 'Female', height: 163, bodyType: 'Slim', lookingFor: 'Any' },
  { uid: 'test-user-010', email: 'harper@test.com', name: 'Harper', age: 26, gender: 'Female', height: 171, bodyType: 'Athletic', lookingFor: 'Athletic' },
];

async function addTestUsers() {
  console.log('🔄 Adding 10 test users to Firestore...\n');

  for (const user of testUsers) {
    try {
      await setDoc(doc(db, 'users', user.uid), {
        ...user,
        photos: [],  // Empty photos array for test users
        profileComplete: true,
        createdAt: new Date().toISOString(),
      });
      console.log(`✅ Added: ${user.name} (${user.age}, ${user.bodyType}, ${user.height}cm)`);
    } catch (error) {
      console.error(`❌ Error adding ${user.name}:`, error.message);
    }
  }

  console.log('\n🎉 All test users added successfully!');
  process.exit(0);
}

addTestUsers();
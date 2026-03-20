const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, deleteDoc } = require('firebase/firestore');

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

async function deleteAllLikes() {
  console.log('🗑️  Deleting all likes...\n');

  const likesRef = collection(db, 'likes');
  const snapshot = await getDocs(likesRef);

  if (snapshot.empty) {
    console.log('✅ No likes to delete!');
    process.exit(0);
  }

  console.log(`Found ${snapshot.size} likes. Deleting...\n`);

  for (const docSnapshot of snapshot.docs) {
    await deleteDoc(docSnapshot.ref);
    console.log(`✅ Deleted like: ${docSnapshot.id}`);
  }

  console.log('\n🎉 All likes deleted!\n');
  process.exit(0);
}

deleteAllLikes();
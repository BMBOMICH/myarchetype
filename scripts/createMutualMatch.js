const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, where, doc, setDoc, updateDoc } = require('firebase/firestore');

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

async function createMutualMatch() {
  console.log('🔍 Looking for your pending likes...\n');

  const likesRef = collection(db, 'likes');
  const q = query(likesRef, where('status', '==', 'pending'));
  const snapshot = await getDocs(q);

  if (snapshot.empty) {
    console.log('❌ No pending likes found. Go like someone in the app first!');
    process.exit(0);
  }

  console.log(`Found ${snapshot.size} pending like(s):\n`);

  const likes = [];
  let index = 0;
  snapshot.forEach((docSnapshot) => {
    const data = docSnapshot.data();
    likes.push({ id: docSnapshot.id, docRef: docSnapshot.ref, ...data });
    console.log(`${index + 1}. You liked user: ${data.toUserId}`);
    index++;
  });

  const yourLike = likes[0];
  
  console.log(`\n✅ Creating mutual match with user: ${yourLike.toUserId}\n`);

  const theirLikeId = `${yourLike.toUserId}_${yourLike.fromUserId}`;
  
  // Create their like as "matched"
  await setDoc(doc(db, 'likes', theirLikeId), {
    fromUserId: yourLike.toUserId,
    toUserId: yourLike.fromUserId,
    status: 'matched',
    createdAt: new Date().toISOString(),
    matchedAt: new Date().toISOString(),
  });

  console.log('💚 Created their like (status: matched)');

  // Update YOUR like to "matched" too
  await updateDoc(yourLike.docRef, {
    status: 'matched',
    matchedAt: new Date().toISOString(),
  });

  console.log('💚 Updated your like (status: matched)');
  console.log('\n🎉 MUTUAL MATCH CREATED! Go to "My Matches" to see them!\n');
  
  process.exit(0);
}

createMutualMatch();
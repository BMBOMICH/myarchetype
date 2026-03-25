import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';

export interface DatingStats {
  // Likes
  likesSent: number;
  likesReceived: number;
  matchRate: number; // % of likes that became matches
  
  // Matches
  totalMatches: number;
  activeMatches: number; // matches with messages
  expiredMatches: number;
  
  // Profile
  profileViews: number;
  profileViewRate: number; // views per day
  bestPhoto: number | null; // index of best performing photo
  
  // Engagement
  averageResponseTime: number; // minutes
  messagesSent: number;
  messagesReceived: number;
  conversationRate: number; // % of matches that led to conversation
  
  // Ratings
  averageRating: number;
  totalRatings: number;
  trustScore: number;
  
  // Time analysis
  peakActivityHour: number; // 0-23
  averageSwipesPerDay: number;
  
  // Success metrics
  meetupRate: number; // % of matches that led to meetup
  secondDateRate: number; // % that led to 2nd date
}

export async function calculateDatingStats(): Promise<DatingStats> {
  const user = auth.currentUser;
  
  if (!user) {
    return getEmptyStats();
  }

  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    const userData = userDoc.exists() ? userDoc.data() : {};

    // Get likes sent
    const likesSentQuery = query(
      collection(db, 'likes'),
      where('fromUserId', '==', user.uid)
    );
    const likesSentSnapshot = await getDocs(likesSentQuery);
    const likesSent = likesSentSnapshot.size;

    // Get likes received
    const likesReceivedQuery = query(
      collection(db, 'likes'),
      where('toUserId', '==', user.uid)
    );
    const likesReceivedSnapshot = await getDocs(likesReceivedQuery);
    const likesReceived = likesReceivedSnapshot.size;

    // Get matches
    const matchesQuery = query(
      collection(db, 'likes'),
      where('fromUserId', '==', user.uid),
      where('status', '==', 'matched')
    );
    const matchesSnapshot = await getDocs(matchesQuery);
    const totalMatches = matchesSnapshot.size;

    // Calculate match rate
    const matchRate = likesSent > 0 ? (totalMatches / likesSent) * 100 : 0;

    // Get active matches (with messages)
    let activeMatches = 0;
    for (const matchDoc of matchesSnapshot.docs) {
      const matchData = matchDoc.data();
      const matchId = matchData.toUserId;
      const chatId = [user.uid, matchId].sort().join('_');
      
      const messagesSnapshot = await getDocs(collection(db, 'chats', chatId, 'messages'));
      if (!messagesSnapshot.empty) {
        activeMatches++;
      }
    }

    // Get total messages sent
    let messagesSent = 0;
    let messagesReceived = 0;
    const chatsSnapshot = await getDocs(collection(db, 'chats'));
    
    for (const chatDoc of chatsSnapshot.docs) {
      if (chatDoc.id.includes(user.uid)) {
        const messagesSnapshot = await getDocs(collection(db, 'chats', chatDoc.id, 'messages'));
        messagesSnapshot.forEach((msgDoc) => {
          const msgData = msgDoc.data();
          if (msgData.senderId === user.uid) {
            messagesSent++;
          } else {
            messagesReceived++;
          }
        });
      }
    }

    // Conversation rate
    const conversationRate = totalMatches > 0 ? (activeMatches / totalMatches) * 100 : 0;

    // Profile views
    const profileViews = userData.profileViews || 0;
    
    // Calculate profile view rate (views per day)
    const accountCreatedAt = userData.createdAt ? new Date(userData.createdAt) : new Date();
    const daysSinceCreation = Math.max(1, Math.floor((Date.now() - accountCreatedAt.getTime()) / (1000 * 60 * 60 * 24)));
    const profileViewRate = profileViews / daysSinceCreation;

    // Ratings
    const ratings = userData.ratings || {};
    const averageRating = ratings.averageOverall || 0;
    const totalRatings = ratings.totalRatings || 0;
    const trustScore = ratings.trustScore || 0;

    // Calculate swipes per day
    const averageSwipesPerDay = likesSent / daysSinceCreation;

    // Get ratings for meetup/second date rates
    const ratingsQuery = query(
      collection(db, 'ratings'),
      where('ratedUserId', '==', user.uid)
    );
    const ratingsSnapshot = await getDocs(ratingsQuery);
    
    let meetups = 0;
    let secondDates = 0;
    ratingsSnapshot.forEach((ratingDoc) => {
      const ratingData = ratingDoc.data();
      if (ratingData.didYouMeet) meetups++;
      if (ratingData.wouldMeetAgain) secondDates++;
    });

    const meetupRate = totalMatches > 0 ? (meetups / totalMatches) * 100 : 0;
    const secondDateRate = meetups > 0 ? (secondDates / meetups) * 100 : 0;

    return {
      likesSent,
      likesReceived,
      matchRate: Math.round(matchRate),
      totalMatches,
      activeMatches,
      expiredMatches: totalMatches - activeMatches,
      profileViews,
      profileViewRate: Math.round(profileViewRate * 10) / 10,
      bestPhoto: null, // TODO: analyze which photo gets most likes
      averageResponseTime: 0, // TODO: calculate from message timestamps
      messagesSent,
      messagesReceived,
      conversationRate: Math.round(conversationRate),
      averageRating: Math.round(averageRating * 10) / 10,
      totalRatings,
      trustScore,
      peakActivityHour: 0, // TODO: analyze message timestamps
      averageSwipesPerDay: Math.round(averageSwipesPerDay * 10) / 10,
      meetupRate: Math.round(meetupRate),
      secondDateRate: Math.round(secondDateRate),
    };

  } catch (error) {
    console.error('Error calculating dating stats:', error);
    return getEmptyStats();
  }
}

function getEmptyStats(): DatingStats {
  return {
    likesSent: 0,
    likesReceived: 0,
    matchRate: 0,
    totalMatches: 0,
    activeMatches: 0,
    expiredMatches: 0,
    profileViews: 0,
    profileViewRate: 0,
    bestPhoto: null,
    averageResponseTime: 0,
    messagesSent: 0,
    messagesReceived: 0,
    conversationRate: 0,
    averageRating: 0,
    totalRatings: 0,
    trustScore: 0,
    peakActivityHour: 0,
    averageSwipesPerDay: 0,
    meetupRate: 0,
    secondDateRate: 0,
  };
}

export function getMatchRateLevel(rate: number): { level: string; color: string; message: string } {
  if (rate >= 50) {
    return {
      level: 'Excellent',
      color: '#27ae60',
      message: '🔥 You\'re crushing it! Your profile is highly attractive.',
    };
  } else if (rate >= 30) {
    return {
      level: 'Great',
      color: '#5cb85c',
      message: '👍 Doing well! Above average match rate.',
    };
  } else if (rate >= 15) {
    return {
      level: 'Good',
      color: '#f1c40f',
      message: '✓ Solid match rate. Keep improving your profile!',
    };
  } else if (rate >= 5) {
    return {
      level: 'Average',
      color: '#e67e22',
      message: '📈 Room for improvement. Try better photos or bio.',
    };
  } else {
    return {
      level: 'Low',
      color: '#d9534f',
      message: '⚠️ Your profile needs work. Update photos and bio!',
    };
  }
}

export function getConversationRateLevel(rate: number): { level: string; color: string; message: string } {
  if (rate >= 80) {
    return {
      level: 'Excellent',
      color: '#27ae60',
      message: '💬 Great conversationalist! People love talking to you.',
    };
  } else if (rate >= 60) {
    return {
      level: 'Good',
      color: '#5cb85c',
      message: '👍 Most of your matches lead to conversations.',
    };
  } else if (rate >= 40) {
    return {
      level: 'Average',
      color: '#f1c40f',
      message: '📝 Try using opening lines or icebreakers more!',
    };
  } else {
    return {
      level: 'Low',
      color: '#d9534f',
      message: '⚠️ Send the first message! Don\'t wait for them.',
    };
  }
}
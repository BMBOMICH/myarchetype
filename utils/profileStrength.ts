import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';

export interface ProfileStrengthCriteria {
  completed: boolean;
  label: string;
  points: number;
  icon: string;
  tip?: string;
}

export interface ProfileStrengthResult {
  score: number;
  maxScore: number;
  percentage: number;
  level: 'Weak' | 'Basic' | 'Good' | 'Strong' | 'Excellent';
  color: string;
  criteria: ProfileStrengthCriteria[];
  recommendations: string[];
}

export async function calculateProfileStrength(): Promise<ProfileStrengthResult> {
  const user = auth.currentUser;
  
  if (!user) {
    return {
      score: 0,
      maxScore: 100,
      percentage: 0,
      level: 'Weak',
      color: '#d9534f',
      criteria: [],
      recommendations: ['Please log in'],
    };
  }

  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    
    if (!userDoc.exists()) {
      return {
        score: 0,
        maxScore: 100,
        percentage: 0,
        level: 'Weak',
        color: '#d9534f',
        criteria: [],
        recommendations: ['Profile not found'],
      };
    }

    const data = userDoc.data();
    const criteria: ProfileStrengthCriteria[] = [];
    let score = 0;
    const maxScore = 100;

    const hasMainPhoto = data.photos && data.photos.length >= 1;
    criteria.push({
      completed: hasMainPhoto,
      label: 'Main profile photo',
      points: 10,
      icon: '📷',
      tip: 'Add a clear photo of yourself',
    });
    if (hasMainPhoto) score += 10;

    const hasMultiplePhotos = data.photos && data.photos.length >= 3;
    criteria.push({
      completed: hasMultiplePhotos,
      label: '3+ photos',
      points: 10,
      icon: '🖼️',
      tip: 'Add more photos to show different sides of you',
    });
    if (hasMultiplePhotos) score += 10;

    const hasVideo = !!data.videoProfile;
    criteria.push({
      completed: hasVideo,
      label: 'Video profile',
      points: 10,
      icon: '🎥',
      tip: 'Record a 15-second video introduction',
    });
    if (hasVideo) score += 10;

    const hasBio = data.bio && data.bio.length >= 50;
    criteria.push({
      completed: hasBio,
      label: 'Bio (50+ characters)',
      points: 8,
      icon: '✍️',
      tip: 'Write a meaningful bio about yourself',
    });
    if (hasBio) score += 8;

    const hasIcebreaker = !!data.icebreaker;
    criteria.push({
      completed: hasIcebreaker,
      label: 'Icebreaker prompt',
      points: 7,
      icon: '💬',
      tip: 'Answer an icebreaker question',
    });
    if (hasIcebreaker) score += 7;

    const hasAnsweredToday = data.dailyQuestion && 
      data.dailyQuestion.date === new Date().toISOString().split('T')[0];
    criteria.push({
      completed: hasAnsweredToday,
      label: "Today's question answered",
      points: 5,
      icon: '💭',
      tip: 'Answer the daily question to boost visibility',
    });
    if (hasAnsweredToday) score += 5;

    const hasPersonality = !!data.personalityType;
    criteria.push({
      completed: hasPersonality,
      label: 'Personality quiz completed',
      points: 10,
      icon: '🧠',
      tip: 'Take the personality quiz for better matches',
    });
    if (hasPersonality) score += 10;

    const selfieVerified = !!data.selfieVerified;
    criteria.push({
      completed: selfieVerified,
      label: 'Selfie verified',
      points: 10,
      icon: '✓',
      tip: 'Verify your identity with a selfie',
    });
    if (selfieVerified) score += 10;

    const heightVerified = typeof data.height === 'object' && 
      data.height.verificationMethod === 'manual-measured';
    criteria.push({
      completed: heightVerified,
      label: 'Height verified',
      points: 8,
      icon: '📏',
      tip: 'Verify your height with a photo',
    });
    if (heightVerified) score += 8;

    const ageVerified = data.ageVerification?.verified;
    criteria.push({
      completed: ageVerified,
      label: 'Age verified',
      points: 7,
      icon: '🎂',
      tip: 'AI age verification adds trust',
    });
    if (ageVerified) score += 7;

    const lastSeen = data.lastSeen?.toMillis?.() || 0;
    const now = Date.now();
    const activeRecently = now - lastSeen < 7 * 24 * 60 * 60 * 1000;
    criteria.push({
      completed: activeRecently,
      label: 'Active in last 7 days',
      points: 5,
      icon: '🟢',
      tip: 'Stay active to appear in more searches',
    });
    if (activeRecently) score += 5;

    const photoAge = data.lastPhotoUpdate 
      ? (Date.now() - new Date(data.lastPhotoUpdate).getTime()) / (1000 * 60 * 60 * 24)
      : 999;
    const photosRecent = photoAge < 180;
    criteria.push({
      completed: photosRecent,
      label: 'Photos updated recently',
      points: 5,
      icon: '🔄',
      tip: 'Update your photos every 6 months',
    });
    if (photosRecent) score += 5;

    const percentage = Math.round((score / maxScore) * 100);
    
    let level: 'Weak' | 'Basic' | 'Good' | 'Strong' | 'Excellent';
    let color: string;
    
    if (percentage < 30) {
      level = 'Weak';
      color = '#d9534f';
    } else if (percentage < 50) {
      level = 'Basic';
      color = '#e67e22';
    } else if (percentage < 70) {
      level = 'Good';
      color = '#f1c40f';
    } else if (percentage < 85) {
      level = 'Strong';
      color = '#5cb85c';
    } else {
      level = 'Excellent';
      color = '#27ae60';
    }

    const recommendations: string[] = [];
    const incomplete = criteria.filter(c => !c.completed).sort((a, b) => b.points - a.points);
    
    incomplete.slice(0, 3).forEach(c => {
      if (c.tip) recommendations.push(c.tip);
    });

    if (recommendations.length === 0) {
      recommendations.push('Your profile is excellent! Keep staying active.');
    }

    return {
      score,
      maxScore,
      percentage,
      level,
      color,
      criteria,
      recommendations,
    };

  } catch (error) {
    console.error('Error calculating profile strength:', error);
    return {
      score: 0,
      maxScore: 100,
      percentage: 0,
      level: 'Weak',
      color: '#d9534f',
      criteria: [],
      recommendations: ['Error loading profile'],
    };
  }
}

export function getStrengthMessage(level: string): string {
  switch (level) {
    case 'Excellent':
      return '🌟 Outstanding! You\'re getting maximum visibility!';
    case 'Strong':
      return '💪 Great profile! Just a few tweaks to perfection.';
    case 'Good':
      return '👍 Solid profile! Add more to stand out.';
    case 'Basic':
      return '📝 Getting there! Complete more sections.';
    case 'Weak':
      return '⚠️ Needs work! Fill out your profile to get matches.';
    default:
      return '';
  }
}
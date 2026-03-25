export interface ProfileCompletionResult {
  percentage: number;
  completed: string[];
  missing: string[];
  tips: string[];
}

export function calculateProfileCompletion(userData: any): ProfileCompletionResult {
  const completed: string[] = [];
  const missing: string[] = [];
  const tips: string[] = [];

  // Required fields (50% total)
  const requiredFields = [
    { key: 'name', label: 'Name', points: 5 },
    { key: 'age', label: 'Age', points: 5 },
    { key: 'gender', label: 'Gender', points: 5 },
    { key: 'bodyType', label: 'Body Type', points: 5 },
    { key: 'lookingFor', label: 'Body Type Preference', points: 5 },
  ];

  // Photo check (25% total)
  const photoPoints = {
    1: 10,
    2: 20,
    3: 25,
  };

  // Optional fields (25% total)
  const optionalFields = [
    { key: 'bio', label: 'Bio', points: 5, tip: 'Add a bio to show your personality!' },
    { key: 'religiousViews', label: 'Religious Views', points: 3 },
    { key: 'lifestyle', label: 'Lifestyle', points: 3 },
    { key: 'relationshipGoal', label: 'Relationship Goal', points: 4, tip: 'Let others know what you\'re looking for' },
    { key: 'personalityType', label: 'Personality Quiz', points: 5, tip: 'Take the personality quiz for better matches!' },
    { key: 'location', label: 'Location', points: 5, tip: 'Add your location to find nearby matches' },
  ];

  // Verification bonuses (extra 15%)
  const verificationFields = [
    { key: 'selfieVerified', label: 'Identity Verified', points: 5, tip: 'Verify your identity to build trust!' },
    { key: 'ageVerification.verified', label: 'Age Verified', points: 5 },
    { key: 'height.verificationMethod', value: 'manual-measured', label: 'Height Verified', points: 5 },
  ];

  let totalPoints = 0;
  let earnedPoints = 0;

  // Check required fields
  for (const field of requiredFields) {
    totalPoints += field.points;
    if (userData[field.key]) {
      earnedPoints += field.points;
      completed.push(field.label);
    } else {
      missing.push(field.label);
    }
  }

  // Check photos
  totalPoints += 25;
  const photoCount = userData.photos?.length || 0;
  if (photoCount >= 3) {
    earnedPoints += 25;
    completed.push('3 Photos');
  } else if (photoCount === 2) {
    earnedPoints += 20;
    completed.push('2 Photos');
    tips.push('Add one more photo for better matches!');
  } else if (photoCount === 1) {
    earnedPoints += 10;
    completed.push('1 Photo');
    tips.push('Add more photos - profiles with 3 photos get 3x more likes!');
  } else {
    missing.push('Photos');
    tips.push('Add photos to get matches!');
  }

  // Check optional fields
  for (const field of optionalFields) {
    totalPoints += field.points;
    
    let hasValue = false;
    if (field.key === 'location') {
      hasValue = userData.location?.city || userData.location?.latitude;
    } else {
      hasValue = !!userData[field.key];
    }

    if (hasValue) {
      earnedPoints += field.points;
      completed.push(field.label);
    } else {
      missing.push(field.label);
      if (field.tip) {
        tips.push(field.tip);
      }
    }
  }

  // Check verifications
  for (const field of verificationFields) {
    totalPoints += field.points;
    
    let isVerified = false;
    if (field.key.includes('.')) {
      const [parent, child] = field.key.split('.');
      if (field.value) {
        isVerified = userData[parent]?.[child] === field.value;
      } else {
        isVerified = !!userData[parent]?.[child];
      }
    } else {
      isVerified = !!userData[field.key];
    }

    if (isVerified) {
      earnedPoints += field.points;
      completed.push(field.label);
    } else {
      missing.push(field.label);
      if (field.tip) {
        tips.push(field.tip);
      }
    }
  }

  const percentage = Math.round((earnedPoints / totalPoints) * 100);

  return {
    percentage,
    completed,
    missing,
    tips: tips.slice(0, 3), // Show max 3 tips
  };
}

export function getCompletionColor(percentage: number): string {
  if (percentage >= 90) return '#5cb85c'; // Green
  if (percentage >= 70) return '#53a8b6'; // Blue
  if (percentage >= 50) return '#e67e22'; // Orange
  return '#d9534f'; // Red
}

export function getCompletionMessage(percentage: number): string {
  if (percentage >= 100) return 'Perfect! Your profile is complete!';
  if (percentage >= 90) return 'Almost there! Just a few more touches.';
  if (percentage >= 70) return 'Good progress! Keep going.';
  if (percentage >= 50) return 'Halfway there! Add more details.';
  return 'Just getting started! Complete your profile for more matches.';
}
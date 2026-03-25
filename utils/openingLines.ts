import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebaseConfig';

export interface OpeningLine {
  text: string;
  category: string;
}

export async function generateOpeningLines(matchUserId: string): Promise<OpeningLine[]> {
  try {
    const userDoc = await getDoc(doc(db, 'users', matchUserId));
    
    if (!userDoc.exists()) {
      return getDefaultOpeningLines();
    }

    const userData = userDoc.data();
    const lines: OpeningLine[] = [];

    // Based on icebreaker answer
    if (userData.icebreaker && userData.icebreakerPrompt) {
      lines.push({
        text: `I saw your answer to "${userData.icebreakerPrompt}" - ${generateIcebreakerResponse(userData.icebreaker)}`,
        category: 'icebreaker',
      });
    }

    // Based on daily question
    if (userData.dailyQuestion && userData.dailyQuestion.answer) {
      lines.push({
        text: `Love your answer to today's question! ${generateDailyQuestionResponse(userData.dailyQuestion.answer)}`,
        category: 'daily',
      });
    }

    // Based on personality
    if (userData.personalityType) {
      lines.push({
        text: getPersonalityOpener(userData.personalityType),
        category: 'personality',
      });
    }

    // Based on interests (if we have groups in future)
    if (userData.bio) {
      const bioWords = userData.bio.toLowerCase();
      
      if (bioWords.includes('anime')) {
        lines.push({
          text: "I saw you're into anime! What are you watching right now?",
          category: 'interest',
        });
      }
      
      if (bioWords.includes('game') || bioWords.includes('gaming')) {
        lines.push({
          text: "Fellow gamer! What's your go-to game lately?",
          category: 'interest',
        });
      }
      
      if (bioWords.includes('music')) {
        lines.push({
          text: "I see you love music! What's on your playlist right now?",
          category: 'interest',
        });
      }

      if (bioWords.includes('coffee')) {
        lines.push({
          text: "Coffee lover! ☕ What's your favorite spot?",
          category: 'interest',
        });
      }
    }

    // Based on location
    if (userData.location?.city) {
      lines.push({
        text: `Hey! I'm also in ${userData.location.city}. Have you been to [popular local spot]?`,
        category: 'location',
      });
    }

    // Generic but personalized
    lines.push({
      text: `Hi ${userData.name}! Your profile caught my eye. How's your day going?`,
      category: 'generic',
    });

    // If we have enough lines, return random 3
    if (lines.length >= 3) {
      return shuffleArray(lines).slice(0, 3);
    }

    // Otherwise, fill with defaults
    while (lines.length < 3) {
      const defaults = getDefaultOpeningLines();
      const unused = defaults.filter(d => !lines.some(l => l.text === d.text));
      if (unused.length > 0) {
        lines.push(unused[0]);
      } else {
        break;
      }
    }

    return lines.slice(0, 3);

  } catch (error) {
    console.error('Error generating opening lines:', error);
    return getDefaultOpeningLines().slice(0, 3);
  }
}

function generateIcebreakerResponse(answer: string): string {
  const responses = [
    "that's really interesting!",
    "I can totally relate to that!",
    "that's so cool!",
    "love that answer!",
    "same here actually!",
  ];
  
  return responses[Math.floor(Math.random() * responses.length)];
}

function generateDailyQuestionResponse(answer: string): string {
  const responses = [
    "What made you think of that?",
    "That's such a cool perspective!",
    "I'd love to hear more about that!",
    "Great answer!",
  ];
  
  return responses[Math.floor(Math.random() * responses.length)];
}

function getPersonalityOpener(personalityType: string): string {
  const openers: Record<string, string> = {
    'Social Butterfly': "Fellow Social Butterfly! What's your favorite way to meet new people?",
    'Balanced Explorer': "I saw you're a Balanced Explorer - that's exactly my type! What's something adventurous you've done lately?",
    'Thoughtful Soul': "Thoughtful Soul here too! What's something you've been thinking about lately?",
    'Mixed': "I see we both got Mixed personality - guess we're both full of surprises! 😄",
  };
  
  return openers[personalityType] || "I see we have similar personalities! That's awesome.";
}

function getDefaultOpeningLines(): OpeningLine[] {
  return [
    { text: "Hey! Your profile seems really interesting. What's your favorite thing to do on weekends?", category: 'generic' },
    { text: "Hi! I'd love to get to know you better. What's something that always makes you smile?", category: 'generic' },
    { text: "Hey there! What's the best thing that happened to you this week?", category: 'generic' },
    { text: "Hi! If you could do anything right now, what would it be?", category: 'generic' },
    { text: "Hey! What's something you're really passionate about?", category: 'generic' },
  ];
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
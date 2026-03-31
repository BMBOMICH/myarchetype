import * as Crypto from 'expo-crypto';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebaseConfig';

export interface OpeningLine { text: string; category: string; }

function secureRandInt(max: number): number {
  const bytes = Crypto.getRandomBytes(4);
  const val = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return val % max;
}

function secureShuffle<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = secureRandInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export async function generateOpeningLines(matchUserId: string): Promise<OpeningLine[]> {
  try {
    const userDoc = await getDoc(doc(db, 'users', matchUserId));
    if (!userDoc.exists()) return getDefaultOpeningLines();

    const userData = userDoc.data();
    const lines: OpeningLine[] = [];

    if (userData.icebreaker && userData.icebreakerPrompt) {
      lines.push({ text: `I saw your answer to "${userData.icebreakerPrompt}" - ${generateIcebreakerResponse()}`, category: 'icebreaker' });
    }
    if (userData.dailyQuestion?.answer) {
      lines.push({ text: `Love your answer to today's question! ${generateDailyQuestionResponse()}`, category: 'daily' });
    }
    if (userData.personalityType) {
      lines.push({ text: getPersonalityOpener(userData.personalityType), category: 'personality' });
    }
    if (userData.bio) {
      const bio = userData.bio.toLowerCase();
      if (bio.includes('anime')) lines.push({ text: "I saw you're into anime! What are you watching right now?", category: 'interest' });
      if (bio.includes('game') || bio.includes('gaming')) lines.push({ text: "Fellow gamer! What's your go-to game lately?", category: 'interest' });
      if (bio.includes('music')) lines.push({ text: "I see you love music! What's on your playlist right now?", category: 'interest' });
      if (bio.includes('coffee')) lines.push({ text: "Coffee lover! ☕ What's your favorite spot?", category: 'interest' });
    }
    if (userData.location?.city) {
      lines.push({ text: `Hey! I'm also in ${userData.location.city}. Have you been to [popular local spot]?`, category: 'location' });
    }
    lines.push({ text: `Hi ${userData.name}! Your profile caught my eye. How's your day going?`, category: 'generic' });

    if (lines.length >= 3) return secureShuffle(lines).slice(0, 3);

    const defaults = getDefaultOpeningLines();
    const unused = defaults.filter(d => !lines.some(l => l.text === d.text));
    for (const u of unused) {
      if (lines.length >= 3) break;
      lines.push(u);
    }
    return lines.slice(0, 3);
  } catch (error) {
    console.error('Error generating opening lines:', error);
    return getDefaultOpeningLines().slice(0, 3);
  }
}

function generateIcebreakerResponse(): string {
  const responses = ["that's really interesting!", "I can totally relate to that!", "that's so cool!", "love that answer!", "same here actually!"];
  return responses[secureRandInt(responses.length)] ?? responses[0]!;
}

function generateDailyQuestionResponse(): string {
  const responses = ["What made you think of that?", "That's such a cool perspective!", "I'd love to hear more about that!", "Great answer!"];
  return responses[secureRandInt(responses.length)] ?? responses[0]!;
}

function getPersonalityOpener(personalityType: string): string {
  const openers: Record<string, string> = {
    'Social Butterfly': "Fellow Social Butterfly! What's your favorite way to meet new people?",
    'Balanced Explorer': "I saw you're a Balanced Explorer - that's exactly my type! What's something adventurous you've done lately?",
    'Thoughtful Soul': "Thoughtful Soul here too! What's something you've been thinking about lately?",
    'Mixed': "I see we both got Mixed personality - guess we're both full of surprises! 😄",
  };
  return openers[personalityType] ?? "I see we have similar personalities! That's awesome.";
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
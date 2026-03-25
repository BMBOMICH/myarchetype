// Note: These use free APIs or local logic
// For production, consider OpenAI API for better results

// ========== AI BIO WRITER ==========

const BIO_TEMPLATES = [
  "I'm a {adjective} person who loves {hobby}. When I'm not {activity}, you'll find me {alternative}. Looking for someone who {quality}.",
  "{emoji} {adjective} soul with a passion for {hobby}. My ideal weekend involves {activity} and {alternative}. Let's {quality} together!",
  "Part-time {hobby} enthusiast, full-time {adjective} human. I believe in {quality} and never say no to {activity}.",
  "If you're looking for someone who's {adjective}, loves {hobby}, and can {activity} - swipe right! Bonus points if you {quality}.",
];

const ADJECTIVES = ['adventurous', 'curious', 'creative', 'ambitious', 'laid-back', 'spontaneous', 'thoughtful', 'genuine', 'witty', 'passionate'];
const HOBBIES = ['cooking', 'traveling', 'hiking', 'reading', 'music', 'photography', 'fitness', 'art', 'gaming', 'movies'];
const ACTIVITIES = ['exploring new places', 'trying new restaurants', 'binge-watching shows', 'working out', 'learning new skills'];
const QUALITIES = ['appreciates good conversations', 'loves to laugh', 'is up for adventures', 'values authenticity', 'enjoys the little things'];
const EMOJIS = ['✨', '🌟', '🎯', '💫', '🌈', '☀️', '🎭', '🎨'];

export interface BioInput {
  personality: string;
  interests: string[];
  lookingFor: string;
}

export function generateBio(input?: BioInput): string {
  const template = BIO_TEMPLATES[Math.floor(Math.random() * BIO_TEMPLATES.length)];
  
  const bio = template
    .replace('{adjective}', ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)])
    .replace('{hobby}', input?.interests?.[0] || HOBBIES[Math.floor(Math.random() * HOBBIES.length)])
    .replace('{activity}', ACTIVITIES[Math.floor(Math.random() * ACTIVITIES.length)])
    .replace('{alternative}', ACTIVITIES[Math.floor(Math.random() * ACTIVITIES.length)])
    .replace('{quality}', QUALITIES[Math.floor(Math.random() * QUALITIES.length)])
    .replace('{emoji}', EMOJIS[Math.floor(Math.random() * EMOJIS.length)]);

  return bio;
}

export function generateMultipleBios(count: number = 3): string[] {
  const bios: string[] = [];
  for (let i = 0; i < count; i++) {
    bios.push(generateBio());
  }
  return bios;
}

// ========== CONVERSATION STARTERS ==========

const CONVERSATION_STARTERS = {
  general: [
    "What's the most spontaneous thing you've ever done? 🎲",
    "If you could have dinner with anyone, dead or alive, who would it be? 🍽️",
    "What's your go-to comfort food after a long day? 🍕",
    "Beach vacation or mountain adventure? 🏖️⛰️",
    "What's the last thing that made you laugh out loud? 😂",
    "If you won the lottery tomorrow, what's the first thing you'd do? 💰",
  ],
  personality: {
    'Social Butterfly': [
      "You seem like someone who knows all the best spots in town! Where should we go? 🌃",
      "What's the most memorable party you've ever been to? 🎉",
    ],
    'Thoughtful Soul': [
      "I love deep conversations. What's something you've been thinking about lately? 💭",
      "Do you have a favorite book that changed your perspective? 📚",
    ],
    'Balanced Explorer': [
      "You seem like you have the perfect balance! How do you unwind after an adventure? 🧘",
      "What's on your bucket list that you're most excited about? ✨",
    ],
  },
  interests: {
    cooking: ["What's your signature dish? I'm always looking for new recipes! 👨‍🍳"],
    traveling: ["What's your favorite place you've visited? Where's next on your list? ✈️"],
    fitness: ["What's your workout routine like? I'm always looking for motivation! 💪"],
    music: ["What's your current favorite song on repeat? 🎵"],
    reading: ["Read any good books lately? I need recommendations! 📖"],
  },
};

export function getConversationStarters(
  theirPersonality?: string,
  theirInterests?: string[]
): string[] {
  const starters: string[] = [...CONVERSATION_STARTERS.general];

  // Add personality-specific starters
  if (theirPersonality && CONVERSATION_STARTERS.personality[theirPersonality as keyof typeof CONVERSATION_STARTERS.personality]) {
    starters.push(...CONVERSATION_STARTERS.personality[theirPersonality as keyof typeof CONVERSATION_STARTERS.personality]);
  }

  // Add interest-specific starters
  if (theirInterests) {
    theirInterests.forEach(interest => {
      const key = interest.toLowerCase();
      if (CONVERSATION_STARTERS.interests[key as keyof typeof CONVERSATION_STARTERS.interests]) {
        starters.push(...CONVERSATION_STARTERS.interests[key as keyof typeof CONVERSATION_STARTERS.interests]);
      }
    });
  }

  // Shuffle and return top 5
  return starters.sort(() => Math.random() - 0.5).slice(0, 5);
}

// ========== DATE IDEAS GENERATOR ==========

const DATE_IDEAS = {
  casual: [
    { idea: "Coffee and a walk in the park ☕🌳", vibe: "relaxed" },
    { idea: "Visit a local farmers market 🥬", vibe: "casual" },
    { idea: "Try a new ice cream shop 🍦", vibe: "sweet" },
    { idea: "Explore a bookstore together 📚", vibe: "intellectual" },
    { idea: "Grab street food and people-watch 🌮", vibe: "adventurous" },
  ],
  active: [
    { idea: "Go hiking at a scenic trail 🥾", vibe: "adventurous" },
    { idea: "Take a bike ride around the city 🚴", vibe: "active" },
    { idea: "Try rock climbing together 🧗", vibe: "challenging" },
    { idea: "Play mini golf or bowling 🎳", vibe: "playful" },
    { idea: "Kayaking or paddleboarding 🛶", vibe: "adventurous" },
  ],
  creative: [
    { idea: "Paint and sip night 🎨🍷", vibe: "creative" },
    { idea: "Take a cooking class together 👨‍🍳", vibe: "interactive" },
    { idea: "Visit an art gallery or museum 🖼️", vibe: "cultural" },
    { idea: "Pottery or craft workshop 🏺", vibe: "hands-on" },
    { idea: "Attend a live music show 🎵", vibe: "energetic" },
  ],
  romantic: [
    { idea: "Sunset picnic at a scenic spot 🌅", vibe: "romantic" },
    { idea: "Stargazing night 🌟", vibe: "intimate" },
    { idea: "Fancy dinner at a rooftop restaurant 🍽️", vibe: "elegant" },
    { idea: "Wine tasting experience 🍷", vibe: "sophisticated" },
    { idea: "Beach day with a bonfire 🔥", vibe: "cozy" },
  ],
};

export interface DateIdea {
  idea: string;
  vibe: string;
  category: string;
}

export function getDateIdeas(
  myLifestyle?: string,
  theirLifestyle?: string,
  count: number = 5
): DateIdea[] {
  const allIdeas: DateIdea[] = [];

  // Add ideas from each category
  Object.entries(DATE_IDEAS).forEach(([category, ideas]) => {
    ideas.forEach(idea => {
      allIdeas.push({ ...idea, category });
    });
  });

  // Prioritize based on lifestyles
  let sortedIdeas = [...allIdeas];
  
  if (myLifestyle === 'Fitness' || theirLifestyle === 'Fitness') {
    sortedIdeas = sortedIdeas.sort((a, b) => {
      if (a.category === 'active') return -1;
      if (b.category === 'active') return 1;
      return 0;
    });
  } else if (myLifestyle === 'Homebody' || theirLifestyle === 'Homebody') {
    sortedIdeas = sortedIdeas.sort((a, b) => {
      if (a.category === 'casual' || a.category === 'creative') return -1;
      if (b.category === 'casual' || b.category === 'creative') return 1;
      return 0;
    });
  }

  // Shuffle a bit and return top results
  return sortedIdeas.sort(() => Math.random() - 0.3).slice(0, count);
}

// ========== PHOTO RANKING SUGGESTIONS ==========

export interface PhotoSuggestion {
  index: number;
  suggestion: string;
  priority: 'high' | 'medium' | 'low';
}

export function getPhotoSuggestions(photoCount: number): PhotoSuggestion[] {
  const suggestions: PhotoSuggestion[] = [];

  if (photoCount === 0) {
    suggestions.push({
      index: 0,
      suggestion: "Add at least one clear face photo as your main picture",
      priority: 'high',
    });
  }

  if (photoCount === 1) {
    suggestions.push({
      index: 1,
      suggestion: "Add a full-body photo to show your style",
      priority: 'high',
    });
    suggestions.push({
      index: 2,
      suggestion: "Add a photo doing something you love",
      priority: 'medium',
    });
  }

  if (photoCount === 2) {
    suggestions.push({
      index: 2,
      suggestion: "Add a photo showing your personality or hobbies",
      priority: 'medium',
    });
  }

  if (photoCount >= 1) {
    suggestions.push({
      index: 0,
      suggestion: "Your first photo should be a clear, smiling face shot",
      priority: 'high',
    });
  }

  return suggestions;
}

export const PHOTO_TIPS = [
  "🎯 First photo: Clear face shot with a genuine smile",
  "👔 Second photo: Full body shot showing your style",
  "🎨 Third photo: Doing an activity or hobby you love",
  "❌ Avoid: Group photos, sunglasses, filters, old photos",
  "✅ Use: Natural lighting, recent photos, variety of settings",
];
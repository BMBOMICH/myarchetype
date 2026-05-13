export interface StickerPack {
  id: string;
  name: string;
  icon: string;
  stickers: string[];
}

export const STICKER_PACKS: StickerPack[] = [
  {
    id: 'love',
    name: 'Love',
    icon: '❤️',
    stickers: ['❤️', '💕', '💖', '💗', '💓', '💞', '💘', '💝', '😍', '🥰', '😘', '💋', '🌹', '💐', '🦋', '✨'],
  },
  {
    id: 'reactions',
    name: 'Reactions',
    icon: '😊',
    stickers: ['😊', '😂', '🤣', '😅', '😆', '😁', '😄', '🙂', '🤗', '🥳', '🎉', '👏', '🙌', '👍', '👎', '🤷'],
  },
  {
    id: 'flirty',
    name: 'Flirty',
    icon: '😏',
    stickers: ['😏', '😉', '😜', '🤭', '😇', '👀', '🔥', '💯', '🤩', '😋', '😎', '🥵', '💪', '🦊', '🐱', '🌶️'],
  },
  {
    id: 'food',
    name: 'Food & Drinks',
    icon: '🍕',
    stickers: ['🍕', '🍔', '🍟', '🌮', '🍣', '🍜', '🍝', '🍰', '🍦', '🧁', '☕', '🍷', '🍺', '🥂', '🍸', '🧋'],
  },
  {
    id: 'activities',
    name: 'Activities',
    icon: '🎬',
    stickers: ['🎬', '🎮', '🎵', '🎤', '📚', '✈️', '🏖️', '🏔️', '🚗', '🎯', '🎳', '🧘', '💃', '🕺', '🏃', '🚴'],
  },
  {
    id: 'animals',
    name: 'Animals',
    icon: '🐕',
    stickers: ['🐕', '🐱', '🐰', '🦊', '🐻', '🐼', '🦁', '🐯', '🦋', '🐝', '🐢', '🐬', '🦄', '🐉', '🦚', '🦜'],
  },
  {
    id: 'weather',
    name: 'Nature',
    icon: '🌈',
    stickers: ['🌈', '☀️', '🌙', '⭐', '🌟', '✨', '💫', '🌸', '🌺', '🌻', '🌴', '🍀', '🌊', '🔥', '❄️', '🌪️'],
  },
  {
    id: 'misc',
    name: 'Misc',
    icon: '🎁',
    stickers: ['🎁', '🎈', '🎊', '🏆', '🥇', '💎', '👑', '🔮', '🎭', '🎨', '📸', '💌', '📍', '⏰', '💤', '💭'],
  },
];

export const ALL_STICKERS = STICKER_PACKS.flatMap(pack => pack.stickers);

export const POPULAR_STICKERS = ['❤️', '😍', '😂', '🔥', '👍', '💕', '😘', '🥰', '🎉', '💯', '😊', '🤗'];

export function getStickerPack(packId: string): StickerPack | undefined {
  return STICKER_PACKS.find(pack => pack.id === packId);
}

export function searchStickers(query: string): string[] {
  const searchMap: { [key: string]: string[] } = {
    'love': ['❤️', '💕', '💖', '💗', '😍', '🥰', '😘', '💋'],
    'heart': ['❤️', '💕', '💖', '💗', '💓', '💞', '💘', '💝'],
    'laugh': ['😂', '🤣', '😅', '😆'],
    'happy': ['😊', '😄', '😁', '🥳', '🎉'],
    'sad': ['😢', '😭', '😿', '💔'],
    'angry': ['😠', '😡', '🤬'],
    'fire': ['🔥', '🌶️', '💯'],
    'food': ['🍕', '🍔', '🍟', '🌮', '🍣'],
    'drink': ['☕', '🍷', '🍺', '🥂', '🧋'],
    'animal': ['🐕', '🐱', '🐰', '🦊', '🐻'],
    'dog': ['🐕', '🐶', '🦮'],
    'cat': ['🐱', '😺', '🐈'],
    'music': ['🎵', '🎶', '🎤', '🎸'],
    'party': ['🎉', '🎊', '🥳', '🎈'],
    'travel': ['✈️', '🏖️', '🏔️', '🚗'],
    'sun': ['☀️', '🌞', '🌅'],
    'moon': ['🌙', '🌛', '🌜'],
    'star': ['⭐', '🌟', '✨', '💫'],
  };

  const lowerQuery = query.toLowerCase();

  for (const [key, emojis] of Object.entries(searchMap)) {
    if (key.includes(lowerQuery) || lowerQuery.includes(key)) {
      return emojis;
    }
  }

  return POPULAR_STICKERS;
}

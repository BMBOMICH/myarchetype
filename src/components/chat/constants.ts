import { Dimensions, Platform } from 'react-native';
import { prepare, layout } from '@chenglou/pretext';

export const IS_IOS = Platform.OS === 'ios';
export const PAGE_SIZE = 30;
export const MAX_MSG_LEN = 2000;
export const MAX_NOTE_LEN = 500;
export const SCREEN_W = Dimensions.get('window').width;

export const FONT_BUBBLE = '15px Inter';
export const LINE_H_BUBBLE = 20;
export const BUBBLE_MAX_W = SCREEN_W * 0.75;
export const BUBBLE_H_PADDING = 20;
export const BUBBLE_FOOTER_H = 24;
export const BUBBLE_REACTIONS_H = 28;
export const BUBBLE_PINNED_H = 16;
export const MSG_ROW_MARGIN = 2;
export const DATE_SEP_H = 36;
export const IMAGE_BUBBLE_H = 180 + BUBBLE_H_PADDING + BUBBLE_FOOTER_H;
export const VOICE_BUBBLE_H = 48 + BUBBLE_H_PADDING + BUBBLE_FOOTER_H;
export const SYSTEM_MSG_H = 36;
export const AVATAR_W = 30;

export const EMOJI_REACTIONS = ['❤️', '😂', '😮', '😢', '😡', '👍'] as const;

export const DATE_IDEAS_PRESETS = [
  { text: 'Grab coffee at a cozy café and talk about your favorite books', vibe: '☕ Casual' },
  { text: 'Visit a local art gallery or museum exhibition', vibe: '🎨 Cultural' },
  { text: 'Take a sunset walk along the waterfront', vibe: '🌅 Romantic' },
  { text: 'Try a new restaurant neither of us has been to', vibe: '🍽️ Foodie' },
  { text: 'Go for a hike on a nearby trail', vibe: '🥾 Adventure' },
  { text: 'Attend a live music event or open mic night', vibe: '🎵 Music' },
  { text: 'Play board games at a local café', vibe: '🎲 Fun' },
  { text: 'Take a cooking class together', vibe: '👨‍🍳 Creative' },
] as const;

export const pretextCache = new Map<string, ReturnType<typeof prepare>>();

export function getPrepared(text: string): ReturnType<typeof prepare> {
  const cached = pretextCache.get(text);
  if (cached) return cached;
  const result = prepare(text, FONT_BUBBLE);
  pretextCache.set(text, result);
  return result;
}

export function getLayout(
  text: string,
  maxWidth = BUBBLE_MAX_W,
  lineHeight = LINE_H_BUBBLE
) {
  const prepared = getPrepared(text);
  return layout(prepared, maxWidth, lineHeight);
}
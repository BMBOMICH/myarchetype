import type { PoseInstruction } from './types';

export const IS_WEB          = require('react-native').Platform.OS === 'web';
export const MAX_ATTEMPTS    = 3;
export const COOLDOWN_MS     = 30 * 60 * 1000;
export const NUM_POSES       = 3;
export const SERVER_URL      = process.env['EXPO_PUBLIC_FUNCTIONS_URL'] ?? process.env['EXPO_PUBLIC_SERVER_URL'] ?? '';
export const VIRTUAL_CAM_KW  = ['obs','virtual','manycam','snap camera','epoccam','xsplit','mmhmm','camo','iriun','droidcam','streamlabs','fakecam','splitcam','chromacam','ndiptz','loopback'] as const;

export const ALL_POSES: PoseInstruction[] = [
  { id: 'center',     instruction: 'Look directly at the camera', icon: '○' },
  { id: 'look_left',  instruction: 'Turn your head LEFT',         icon: '←' },
  { id: 'look_right', instruction: 'Turn your head RIGHT',        icon: '→' },
  { id: 'look_up',    instruction: 'Tilt your head UP slightly',  icon: '↑' },
  { id: 'smile',      instruction: 'Smile at the camera',         icon: '😊' },
  { id: 'blink',      instruction: 'Blink slowly',                icon: '👁️' },
];

export const SHIELD_ITEMS = [
  'NSFW scan (client + server)', 'AI-generated detection', 'Face detection + matching',
  'Age estimation (18+)', 'Random pose order', 'Timing analysis', 'Consistency check',
  'Virtual camera detection', 'In-app camera only', 'Banned user check', 'Celebrity impersonation',
] as const;

export const WEB_VIDEO_STYLE = {
  width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)',
} as const;
import type { LivenessChallenge } from '../../utils/faceVerification';

export type Step = 'intro' | 'camera' | 'verifying' | 'success' | 'failed';

export interface PoseInstruction {
  id:          LivenessChallenge | 'center';
  instruction: string;
  icon:        string;
}

export interface UploadResult {
  url:       string;
  faceCount: number;
  width:     number;
  height:    number;
  metadata?: Record<string, unknown>;
}

export interface CloudinaryResponse {
  secure_url?:     string;
  faces?:          unknown;
  width?:          unknown;
  height?:         unknown;
  image_metadata?: unknown;
  error?:          { message?: string };
}

export interface NSFWResult {
  safe:        boolean;
  reason?:     string;
  shouldBlur?: boolean;
}

export type State = {
  step:          Step;
  poses:         PoseInstruction[];
  poseIndex:     number;
  photos:        string[];
  timestamps:    number[];
  countdown:     number | null;
  error:         string;
  attempts:      number;
  webReady:      boolean;
  camError:      string | null;
  statusText:    string;
  cooldownEnd:   number | null;
  nsfwReady:     boolean;
  faceReady:     boolean;
  loadingModels: boolean;
};

export type Action =
  | { type: 'SET_STEP';           payload: Step }
  | { type: 'SET_POSES';          payload: PoseInstruction[] }
  | { type: 'SET_POSE_INDEX';     payload: number }
  | { type: 'ADD_PHOTO';          payload: { uri: string; timestamp: number } }
  | { type: 'SET_COUNTDOWN';      payload: number | null }
  | { type: 'SET_ERROR';          payload: string }
  | { type: 'SET_ATTEMPTS';       payload: number }
  | { type: 'SET_WEB_READY';      payload: boolean }
  | { type: 'SET_CAM_ERROR';      payload: string | null }
  | { type: 'SET_STATUS';         payload: string }
  | { type: 'SET_COOLDOWN_END';   payload: number | null }
  | { type: 'SET_NSFW_READY';     payload: boolean }
  | { type: 'SET_FACE_READY';     payload: boolean }
  | { type: 'SET_LOADING_MODELS'; payload: boolean }
  | { type: 'RESET_FOR_RETRY';    payload: PoseInstruction[] };
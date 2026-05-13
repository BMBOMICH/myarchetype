import { writeAuditLog } from './logger';

export interface GhostProfileResult {
  isGhost: boolean;
  daysSinceLastLogin: number;
  daysSinceLastMessage: number;
  daysSinceLastSwipe: number;
  ghostType: 'active_ghost' | 'inactive_ghost' | 'zombie' | 'none';
  action: 'none' | 'nudge' | 'hide_from_discovery' | 'archive' | 'delete_prompt';
  recommendation: string;
}

export function detectGhostProfile(activity: {
  lastLoginAt: number;
  lastMessageAt?: number;
  lastSwipeAt?: number;
  profileCreatedAt: number;
  hasMatches: boolean;
  hasPendingMatches: boolean;
}): GhostProfileResult {
  const now = Date.now();
  const daysLogin = Math.floor((now - activity.lastLoginAt) / 86_400_000);
  const daysMsg = activity.lastMessageAt ? Math.floor((now - activity.lastMessageAt) / 86_400_000) : 999;
  const daysSwipe = activity.lastSwipeAt ? Math.floor((now - activity.lastSwipeAt) / 86_400_000) : 999;
  let ghostType: GhostProfileResult['ghostType'] = 'none';
  let action: GhostProfileResult['action'] = 'none';
  if (daysLogin >= 180) { ghostType = 'zombie'; action = 'delete_prompt'; }
  else if (daysLogin >= 90) { ghostType = 'inactive_ghost'; action = 'archive'; }
  else if (daysLogin >= 30 && activity.hasPendingMatches) { ghostType = 'active_ghost'; action = 'hide_from_discovery'; }
  else if (daysLogin >= 14) { ghostType = 'active_ghost'; action = 'nudge'; }
  const isGhost = ghostType !== 'none';
  if (isGhost) void writeAuditLog('profile.ghost_detected', { daysLogin, ghostType, action }).catch(() => {});
  return {
    isGhost,
    daysSinceLastLogin: daysLogin,
    daysSinceLastMessage: daysMsg,
    daysSinceLastSwipe: daysSwipe,
    ghostType,
    action,
    recommendation: ghostType === 'zombie'
      ? 'Profile inactive 180+ days. Prompt account deletion or deep dormancy.'
      : ghostType === 'inactive_ghost'
        ? 'Profile inactive 90+ days. Hide from discovery, notify user.'
        : ghostType === 'active_ghost'
          ? 'Profile inactive 14-90 days. Send re-engagement nudge.'
          : 'Profile active.',
  };
}

export const ghostProfile = detectGhostProfile;
export const zombieProfile = detectGhostProfile;
export const inactiveProfile = detectGhostProfile;

export interface SocialVerificationResult {
  verified: boolean;
  score: number;
  verifiedPlatforms: string[];
  verificationLevel: 'none' | 'basic' | 'strong' | 'full';
  crossPlatformConsistency: boolean;
  recommendation: string;
}

export function verifySocialPresence(
  links: {
    instagram?: { username: string; followerCount: number; accountAge: number; verified: boolean };
    linkedin?: { url: string; connectionCount: number; jobHistory: boolean; verified: boolean };
    spotify?: { connected: boolean; playlistCount: number };
    tiktok?: { username: string; followerCount: number; verified: boolean };
    twitter?: { username: string; followerCount: number; verified: boolean; accountAgeDays: number };
  },
  _profileName?: string
): SocialVerificationResult {
  let score = 0;
  const verifiedPlatforms: string[] = [];
  if (links.instagram?.verified) { score += 25; verifiedPlatforms.push('instagram'); }
  else if (links.instagram && links.instagram.followerCount > 50 && links.instagram.accountAge > 180) { score += 15; verifiedPlatforms.push('instagram_unverified'); }
  if (links.linkedin?.verified) { score += 30; verifiedPlatforms.push('linkedin'); }
  else if (links.linkedin && links.linkedin.connectionCount > 50 && links.linkedin.jobHistory) { score += 20; verifiedPlatforms.push('linkedin_unverified'); }
  if (links.spotify?.connected && (links.spotify.playlistCount ?? 0) > 0) { score += 15; verifiedPlatforms.push('spotify'); }
  if (links.tiktok?.verified) { score += 20; verifiedPlatforms.push('tiktok'); }
  if (links.twitter?.verified) { score += 20; verifiedPlatforms.push('twitter'); }
  else if (links.twitter && links.twitter.followerCount > 100 && links.twitter.accountAgeDays > 365) { score += 10; verifiedPlatforms.push('twitter_unverified'); }
  score = Math.min(score, 100);
  const verificationLevel = score >= 70 ? 'full' : score >= 40 ? 'strong' : score >= 15 ? 'basic' : 'none';
  return {
    verified: score >= 40,
    score,
    verifiedPlatforms,
    verificationLevel,
    crossPlatformConsistency: verifiedPlatforms.length >= 2,
    recommendation: verificationLevel === 'none'
      ? 'No social verification. Request at least one linked account.'
      : verificationLevel === 'basic'
        ? 'Basic verification. Recommend adding LinkedIn or Instagram.'
        : verificationLevel === 'strong'
          ? 'Strong verification across multiple platforms.'
          : 'Fully verified social presence.',
  };
}

export const socialVerify = verifySocialPresence;
export const socialPresenceCheck = verifySocialPresence;

export interface CrossPlatformConsistencyResult {
  consistent: boolean;
  nameMismatch: boolean;
  ageMismatch: boolean;
  photoMismatch: boolean;
  consistencyScore: number;
  recommendation: string;
}

export function checkCrossPlatformConsistency(
  profiles: { platform: string; name?: string; age?: number; photoUrl?: string }[],
  canonicalName?: string,
  _canonicalAge?: number
): CrossPlatformConsistencyResult {
  const names = profiles.map(p => p.name?.toLowerCase().trim()).filter(Boolean) as string[];
  const ages = profiles.map(p => p.age).filter(n => n !== undefined) as number[];
  const nameMismatch = !!(canonicalName && names.some(n => !n.includes(canonicalName.toLowerCase().split(' ')[0] ?? '')));
  const ageMismatch = ages.length >= 2 && Math.max(...ages) - Math.min(...ages) > 3;
  const photoMismatch = false;
  const score = 100 - (nameMismatch ? 30 : 0) - (ageMismatch ? 30 : 0) - (photoMismatch ? 20 : 0);
  return {
    consistent: score >= 70,
    nameMismatch,
    ageMismatch,
    photoMismatch,
    consistencyScore: Math.max(0, score),
    recommendation: score < 70
      ? 'Cross-platform inconsistencies detected. Flag for manual review.'
      : 'Profile consistent across platforms.',
  };
}

export const crossPlatformCheck = checkCrossPlatformConsistency;
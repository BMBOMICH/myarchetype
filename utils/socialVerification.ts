import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { Linking } from 'react-native';
import { auth, db } from '../firebaseConfig';
import { logger } from './logger';

const SERVER_URL = process.env.EXPO_PUBLIC_FUNCTIONS_URL ?? process.env.EXPO_PUBLIC_SERVER_URL ?? '';

export interface SocialLinks { instagram?: { username: string; verified: boolean; linkedAt: string }; linkedin?: { profileUrl: string; verified: boolean; linkedAt: string }; spotify?: { connected: boolean; profileUrl?: string; topArtists?: string[]; topTracks?: string[]; linkedAt: string }; tiktok?: { username: string; verified: boolean; linkedAt: string }; }
export interface SocialValidationResult { valid: boolean; normalized?: string; reason?: string; detector?: string; }
export interface SafeBrowsingResult { safe: boolean; threats: string[]; reason?: string; }
export interface RedirectCheckResult { safe: boolean; redirectCount: number; finalUrl: string; suspicious: boolean; reason?: string; }

interface SafeBrowsingMatch { threatType: string; }
interface SafeBrowsingApiResponse { matches?: SafeBrowsingMatch[]; }
interface RedirectApiResponse { redirectCount?: number; finalUrl?: string; finalUrlSuspicious?: boolean; isMalicious?: boolean; }

export function validateInstagramUsername(input: string): SocialValidationResult {
  const cleaned = input.replace('@','').trim().toLowerCase();
  if (!cleaned) return { valid: false, reason: 'Please enter a username.', detector: '#156' };
  if (!/^[a-z0-9._]{1,30}$/.test(cleaned)) return { valid: false, reason: 'Invalid Instagram username. Use only letters, numbers, periods, and underscores.', detector: '#156' };
  if (cleaned.startsWith('.') || cleaned.endsWith('.')) return { valid: false, reason: 'Instagram username cannot start or end with a period.', detector: '#156' };
  if (cleaned.includes('..')) return { valid: false, reason: 'Instagram username cannot have consecutive periods.', detector: '#156' };
  return { valid: true, normalized: cleaned };
}

export function validateInstagramUrl(url: string): SocialValidationResult {
  const trimmed = url.trim();
  if (!trimmed.startsWith('http') && !trimmed.startsWith('@')) return validateInstagramUsername(trimmed);
  const match = trimmed.match(/^https?:\/\/(www\.)?instagram\.com\/([\w.]+)\/?(\?.*)?$/i);
  if (!match) return { valid: false, reason: 'Invalid Instagram URL. Use format: instagram.com/username', detector: '#156' };
  return validateInstagramUsername(match[2] ?? '');
}

export async function checkInstagramProfileExists(username: string): Promise<{ exists: boolean; checked: boolean }> {
  try {
    const response = await fetch(`https://www.instagram.com/${username}/`, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
    if (response.status === 200) return { exists: true, checked: true };
    if (response.status === 404) return { exists: false, checked: true };
    return { exists: true, checked: false };
  } catch { return { exists: true, checked: false }; }
}

export function validateSpotifyUrl(url: string): SocialValidationResult {
  const trimmed = url.trim();
  if (!/^https?:\/\/open\.spotify\.com\/(user|artist|playlist|album|track)\/[\w]+(\?.*)?$/i.test(trimmed)) return { valid: false, reason: 'Invalid Spotify URL. Use a link from open.spotify.com', detector: '#158' };
  return { valid: true, normalized: trimmed };
}

export function validateTikTokUsername(input: string): SocialValidationResult {
  const cleaned = input.replace('@','').trim().toLowerCase();
  if (!cleaned) return { valid: false, reason: 'Please enter a TikTok username.', detector: '#159' };
  if (!/^[\w.]{1,24}$/.test(cleaned)) return { valid: false, reason: 'Invalid TikTok username.', detector: '#159' };
  return { valid: true, normalized: cleaned };
}

export function validateTikTokUrl(url: string): SocialValidationResult {
  const trimmed = url.trim();
  const match = trimmed.match(/^https?:\/\/(www\.)?tiktok\.com\/@([\w.]+)\/?(\?.*)?$/i);
  if (!match) return { valid: false, reason: 'Invalid TikTok URL. Use format: tiktok.com/@username', detector: '#159' };
  return { valid: true, normalized: match[2] };
}

export function validateLinkedInUrl(url: string): SocialValidationResult {
  const trimmed = url.trim();
  if (!/^https?:\/\/(www\.)?linkedin\.com\/in\/([\w\-]{3,100})\/?(\?.*)?$/i.test(trimmed)) return { valid: false, reason: 'Invalid LinkedIn URL. Use format: linkedin.com/in/your-name', detector: '#160' };
  return { valid: true, normalized: trimmed };
}

export async function checkSafeBrowsing(url: string): Promise<SafeBrowsingResult> {
  const API_KEY = process.env.EXPO_PUBLIC_SAFE_BROWSING_API_KEY;
  if (!API_KEY) return { safe: true, threats: [] };
  try {
    const response = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client: { clientId: 'myarchetype-app', clientVersion: '1.0.0' }, threatInfo: { threatTypes: ['MALWARE','SOCIAL_ENGINEERING','UNWANTED_SOFTWARE','POTENTIALLY_HARMFUL_APPLICATION'], platformTypes: ['ANY_PLATFORM'], threatEntryTypes: ['URL'], threatEntries: [{ url }] } }),
    });
    if (!response.ok) return { safe: true, threats: [] };
    const data = await response.json() as SafeBrowsingApiResponse;
    if (data.matches && data.matches.length > 0) {
      const threats = data.matches.map(m => m.threatType);
      return { safe: false, threats, reason: `This URL has been flagged as unsafe: ${threats.join(', ')}` };
    }
    return { safe: true, threats: [] };
  } catch { return { safe: true, threats: [] }; }
}

export async function checkRedirectChain(url: string): Promise<RedirectCheckResult> {
  try {
    const response = await fetch(`${SERVER_URL}/check-url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
    if (!response.ok) return { safe: true, redirectCount: 0, finalUrl: url, suspicious: false };
    const data = await response.json() as RedirectApiResponse;
    const suspicious = (data.redirectCount ?? 0) > 3 || data.finalUrl !== url || data.finalUrlSuspicious === true;
    return { safe: !data.isMalicious, redirectCount: data.redirectCount ?? 0, finalUrl: data.finalUrl ?? url, suspicious, reason: suspicious ? `URL redirects ${data.redirectCount} times — possibly deceptive.` : undefined };
  } catch { return { safe: true, redirectCount: 0, finalUrl: url, suspicious: false }; }
}

export function checkUsernameConsistency(displayName: string, socialUsername: string): { consistent: boolean; similarity: number } {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g,'');
  const name = norm(displayName), username = norm(socialUsername);
  if (!name || !username) return { consistent: true, similarity: 100 };
  if (username.includes(name) || name.includes(username)) return { consistent: true, similarity: 100 };
  const maxLen = Math.max(name.length, username.length);
  if (maxLen === 0) return { consistent: true, similarity: 100 };
  const m = name.length, n = username.length;
  const dp: number[][] = Array.from({ length: m+1 }, (_,i) => Array.from({ length: n+1 }, (_,j) => i===0 ? j : j===0 ? i : 0));
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) dp[i]![j] = name[i-1]===username[j-1] ? dp[i-1]![j-1]! : 1+Math.min(dp[i-1]![j]!, dp[i]![j-1]!, dp[i-1]![j-1]!);
  const similarity = Math.round(((maxLen - dp[m]![n]!) / maxLen) * 100);
  return { consistent: similarity >= 40, similarity };
}

export interface CompleteSocialValidation { valid: boolean; normalized?: string; formatValid: boolean; profileExists?: boolean; safeBrowsing?: SafeBrowsingResult; redirectCheck?: RedirectCheckResult; reasons: string[]; }

export async function validateSocialLink(platform: 'instagram'|'linkedin'|'spotify'|'tiktok', input: string, displayName?: string): Promise<CompleteSocialValidation> {
  const reasons: string[] = [];
  let formatResult: SocialValidationResult;
  switch (platform) {
    case 'instagram': formatResult = validateInstagramUrl(input); break;
    case 'linkedin': formatResult = validateLinkedInUrl(input); break;
    case 'spotify': formatResult = validateSpotifyUrl(input); break;
    case 'tiktok': formatResult = validateTikTokUrl(input); break;
  }
  if (!formatResult.valid) return { valid: false, formatValid: false, reasons: [formatResult.reason ?? 'Invalid link format.'] };
  const urlToCheck = platform==='instagram' ? `https://instagram.com/${formatResult.normalized}` : platform==='tiktok' ? `https://tiktok.com/@${formatResult.normalized}` : input;
  const safeBrowsing = await checkSafeBrowsing(urlToCheck);
  if (!safeBrowsing.safe) { reasons.push(safeBrowsing.reason ?? 'This link has been flagged as unsafe.'); return { valid: false, formatValid: true, safeBrowsing, reasons }; }
  let redirectCheck: RedirectCheckResult | undefined;
  if (input.startsWith('http')) { redirectCheck = await checkRedirectChain(input); if (redirectCheck.suspicious) reasons.push(redirectCheck.reason ?? 'Suspicious redirect detected.'); }
  let profileExists: boolean | undefined;
  if (platform==='instagram' && formatResult.normalized) { const existsResult = await checkInstagramProfileExists(formatResult.normalized); profileExists = existsResult.exists; if (existsResult.checked && !existsResult.exists) reasons.push('Instagram profile not found.'); }
  if (displayName && formatResult.normalized) { const c = checkUsernameConsistency(displayName, formatResult.normalized); if (!c.consistent) logger.warn(`[socialVerification] Username inconsistent (${c.similarity}% similar)`); }
  return { valid: reasons.length===0, normalized: formatResult.normalized, formatValid: true, profileExists, safeBrowsing, redirectCheck, reasons };
}

export async function getSocialLinks(): Promise<SocialLinks> {
  const user = auth.currentUser;
  if (!user) return {};
  try { const userDoc = await getDoc(doc(db,'users',user.uid)); return userDoc.exists() ? userDoc.data().socialLinks as SocialLinks ?? {} : {}; }
  catch { return {}; }
}

export async function linkInstagram(username: string): Promise<{ success: boolean; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not authenticated' };
  const validation = validateInstagramUsername(username);
  if (!validation.valid) return { success: false, error: validation.reason };
  const safe = await checkSafeBrowsing(`https://instagram.com/${validation.normalized}`);
  if (!safe.safe) return { success: false, error: safe.reason };
  try {
    const userDoc = await getDoc(doc(db,'users',user.uid));
    const currentLinks = userDoc.exists() ? userDoc.data().socialLinks as SocialLinks ?? {} : {};
    await updateDoc(doc(db,'users',user.uid), { socialLinks: { ...currentLinks, instagram: { username: validation.normalized, verified: false, linkedAt: new Date().toISOString() } } });
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to link Instagram';
    return { success: false, error: msg };
  }
}

export async function linkLinkedIn(profileUrl: string): Promise<{ success: boolean; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not authenticated' };
  const validation = validateLinkedInUrl(profileUrl);
  if (!validation.valid) return { success: false, error: validation.reason };
  const safe = await checkSafeBrowsing(profileUrl);
  if (!safe.safe) return { success: false, error: safe.reason };
  try {
    const userDoc = await getDoc(doc(db,'users',user.uid));
    const currentLinks = userDoc.exists() ? userDoc.data().socialLinks as SocialLinks ?? {} : {};
    await updateDoc(doc(db,'users',user.uid), { socialLinks: { ...currentLinks, linkedin: { profileUrl, verified: false, linkedAt: new Date().toISOString() } } });
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to link LinkedIn';
    return { success: false, error: msg };
  }
}

export async function linkTikTok(usernameOrUrl: string): Promise<{ success: boolean; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not authenticated' };
  const validation = usernameOrUrl.startsWith('http') ? validateTikTokUrl(usernameOrUrl) : validateTikTokUsername(usernameOrUrl);
  if (!validation.valid) return { success: false, error: validation.reason };
  try {
    const userDoc = await getDoc(doc(db,'users',user.uid));
    const currentLinks = userDoc.exists() ? userDoc.data().socialLinks as SocialLinks ?? {} : {};
    await updateDoc(doc(db,'users',user.uid), { socialLinks: { ...currentLinks, tiktok: { username: validation.normalized, verified: false, linkedAt: new Date().toISOString() } } });
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to link TikTok';
    return { success: false, error: msg };
  }
}

export async function unlinkSocial(platform: 'instagram'|'linkedin'|'spotify'|'tiktok'): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;
  try {
    const userDoc = await getDoc(doc(db,'users',user.uid));
    const currentLinks = userDoc.exists() ? userDoc.data().socialLinks as SocialLinks ?? {} : {};
    delete currentLinks[platform];
    await updateDoc(doc(db,'users',user.uid), { socialLinks: currentLinks });
    return true;
  } catch { return false; }
}

export function openInstagramProfile(username: string): void { Linking.openURL(`https://instagram.com/${username}`); }
export function openLinkedInProfile(profileUrl: string): void { Linking.openURL(profileUrl); }
export function openTikTokProfile(username: string): void { Linking.openURL(`https://tiktok.com/@${username}`); }

export function getSocialTrustBonus(socialLinks: SocialLinks): number {
  let bonus = 0;
  if (socialLinks.instagram?.username) { bonus += 5; if (socialLinks.instagram.verified) bonus += 5; }
  if (socialLinks.linkedin?.profileUrl) { bonus += 5; if (socialLinks.linkedin.verified) bonus += 5; }
  if (socialLinks.spotify?.connected) bonus += 3;
  if (socialLinks.tiktok?.username) { bonus += 3; if (socialLinks.tiktok.verified) bonus += 4; }
  return Math.min(bonus, 30);
}

export function formatSocialLinkDate(dateString: string): string {
  const date = new Date(dateString), now = new Date();
  const daysSince = Math.floor((now.getTime()-date.getTime())/(1000*60*60*24));
  if (daysSince === 0) return 'Today';
  if (daysSince === 1) return 'Yesterday';
  if (daysSince < 7) return `${daysSince} days ago`;
  if (daysSince < 30) return `${Math.floor(daysSince/7)} weeks ago`;
  return date.toLocaleDateString();
}
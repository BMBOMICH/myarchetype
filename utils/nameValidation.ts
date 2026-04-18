import { checkTextSafety } from './moderation';

export interface NameValidationResult { valid: boolean; reason?: string; detector?: string; }

const STAFF_KW = ['admin','administrator','moderator','mod','support','official','staff','team','helpdesk','archetype','myarchetype','cs_team','customerservice','verified_user','security','safety','trust','trust_team','policy','bot','system','automod'];

const CELEBS = new Set([
  'tom hanks','brad pitt','angelina jolie','jennifer aniston','leonardo dicaprio','meryl streep',
  'denzel washington','scarlett johansson','ryan reynolds','dwayne johnson','will smith',
  'chris evans','robert downey','chris hemsworth','margot robbie','zendaya','timothee chalamet',
  'florence pugh','taylor swift','beyonce','drake','eminem','rihanna','ariana grande',
  'billie eilish','the weeknd','kanye west','ed sheeran','adele','lady gaga','post malone',
  'travis scott','dua lipa','harry styles','olivia rodrigo','bad bunny','shakira',
  'justin bieber','selena gomez','cristiano ronaldo','lionel messi','lebron james',
  'michael jordan','serena williams','tiger woods','stephen curry','neymar','elon musk',
  'jeff bezos','mark zuckerberg','bill gates','tim cook','sundar pichai','joe biden',
  'donald trump','barack obama','hillary clinton','kamala harris','vladimir putin',
  'kim kardashian','kylie jenner','kendall jenner','khloe kardashian','kourtney kardashian',
  'paris hilton','mr beast','pewdiepie','charli damelio','addison rae',
]);

const VERIFY_RE = /[✓✔✅☑⭕★☆👑🌟🔵🏅🎖️\u2713\u2714\u2705\u2611\u2612\u2606\u2605]/;

export function isAllCaps(name: string): boolean {
  const letters = name.replace(/[^a-zA-Z]/g,'');
  return letters.length > 3 && letters === letters.toUpperCase();
}

const SPAM_RE = [/qwerty/i,/asdfgh/i,/zxcvbn/i,/qwert/i,/asdfg/i,/zxcvb/i,/qazwsx/i,/(.)\1{3,}/,/^[0-9]+$/,/^(.)\1+$/];

function charDiversity(name: string): number {
  const l = name.toLowerCase().replace(/\s/g,'');
  if (!l.length) return 1;
  return new Set(l.split('')).size / l.length;
}

export function isKeyboardSpam(name: string): boolean {
  for (const p of SPAM_RE) if (p.test(name)) return true;
  if (charDiversity(name) < 0.3 && name.replace(/\s/g,'').length > 4) return true;
  return false;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m+1 }, (_,i) => Array.from({ length: n+1 }, (_,j) => i===0?j:j===0?i:0));
  for (let i=1;i<=m;i++) for (let j=1;j<=n;j++) dp[i]![j] = a[i-1]===b[j-1] ? dp[i-1]![j-1]! : 1+Math.min(dp[i-1]![j]!,dp[i]![j-1]!,dp[i-1]![j-1]!);
  return dp[m]![n]!;
}

export function isCelebName(name: string): boolean {
  const n = name.toLowerCase().trim();
  if (CELEBS.has(n)) return true;
  for (const c of CELEBS) if (levenshtein(n,c) <= 1 && c.length > 8) return true;
  return false;
}

function isEmojiOnly(name: string): boolean {
  return name.replace(/(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\p{Emoji_Modifier_Base})/gu,'').trim().length === 0 && name.trim().length > 0;
}

export function validateDisplayName(name: string): NameValidationResult {
  if (!name?.trim()) return { valid: false, reason: 'Name cannot be empty.', detector: '#73' };
  const t = name.trim();
  if (t.length < 2) return { valid: false, reason: 'Name must be at least 2 characters.', detector: '#73' };
  if (t.length > 50) return { valid: false, reason: 'Name must be under 50 characters.', detector: '#73' };
  if (!/\p{L}/u.test(t)) return { valid: false, reason: 'Name must contain at least one letter.', detector: '#73' };
  if (!/^[\p{L}\p{M}'\-\s.]+$/u.test(t)) return { valid: false, reason: 'Name can only contain letters, spaces, hyphens, and apostrophes.', detector: '#73' };
  if (VERIFY_RE.test(t)) return { valid: false, reason: 'Verification symbols are not allowed in names.', detector: '#79' };
  if (/^[\d\s\-+().]+$/.test(t)) return { valid: false, reason: 'Name cannot be numbers only.', detector: '#80' };
  if (isEmojiOnly(t)) return { valid: false, reason: 'Name cannot be emojis only.', detector: '#80' };
  if (isAllCaps(t)) return { valid: false, reason: "Please don't use ALL CAPS.", detector: '#75' };
  if (isKeyboardSpam(t)) return { valid: false, reason: 'Please enter a real name.', detector: '#76' };
  const lower = t.toLowerCase().replace(/[\s_\-]/g,'');
  for (const kw of STAFF_KW) if (lower.includes(kw.replace(/[\s_\-]/g,''))) return { valid: false, reason: 'This name is not allowed.', detector: '#77' };
  if (isCelebName(t)) return { valid: false, reason: 'This name is not allowed. Please use your real name.', detector: '#78' };
  const tc = checkTextSafety(t, 'name');
  if (!tc.safe) return { valid: false, reason: 'This name contains inappropriate content.', detector: '#74' };
  return { valid: true };
}

export function validateFirstName(name: string): NameValidationResult {
  if (!name?.trim()) return { valid: false, reason: 'First name is required.', detector: '#73' };
  const t = name.trim();
  if (t.length < 2) return { valid: false, reason: 'First name must be at least 2 characters.', detector: '#73' };
  if (t.length > 30) return { valid: false, reason: 'First name must be under 30 characters.', detector: '#73' };
  if (!/^\p{L}/u.test(t)) return { valid: false, reason: 'Name must start with a letter.', detector: '#73' };
  return validateDisplayName(name);
}

export function sanitizeName(name: string): string {
  return name.trim().replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\s+/g,' ').slice(0,50);
}
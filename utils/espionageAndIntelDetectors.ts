const FOREIGN_INTEL_TTPS = {
  elicitation: [/what (base|installation|facility) (are you|do you work)/i,/deployment (schedule|orders|location)/i,/ship.*movements/i,/which (unit|squadron|battalion)/i],
  technical_probing: [/what (system|software|network|platform) do you (use|work with)/i,/security (protocols|measures|systems)/i,/authentication/i,/vpn|firewall|encryption/i],
  relationship_exploitation: [/must be lonely.*deployed/i,/i understand.*difficult.*work/i,/you deserve.*appreciated/i],
  data_exfiltration: [/send (me |us )?(a )?photo of (your )?work/i,/take a picture at (your )?office/i,/email.*document/i,/share.*screen/i],
};

export function foreignIntelTTP(messages: Array<{ text: string; senderId: string }>, suspectId: string): { ttpMatching: boolean; matchedTTPs: string[]; riskScore: number } {
  const suspectMsgs = messages.filter(m => m.senderId === suspectId);
  const matchedTTPs: string[] = [];
  for (const msg of suspectMsgs) for (const [ttp, patterns] of Object.entries(FOREIGN_INTEL_TTPS)) if (patterns.some(p => p.test(msg.text)) && !matchedTTPs.includes(ttp)) matchedTTPs.push(ttp);
  return { ttpMatching: matchedTTPs.length >= 2, matchedTTPs, riskScore: Math.min(100, matchedTTPs.length * 30) };
}
export const ttpMatching = foreignIntelTTP;

const HONEY_TRAP_PATTERNS = [/what (base|unit|ship) are you (on|with|assigned)/i,/do you have (security clearance|clearance)/i,/classified|top secret|confidential/i,/can you (bring|send|show) me.*work/i];
export function detectHoneyTrap(messages: Array<{ text: string; senderId: string }>, suspectId: string, targetProfile: { militaryOrGov: boolean; hasClearance: boolean }): { detected: boolean; riskScore: number; signals: string[] } {
  const msgs = messages.filter(m => m.senderId === suspectId);
  const signals = msgs.filter(m => HONEY_TRAP_PATTERNS.some(p => p.test(m.text))).map(m => m.text.substring(0, 60));
  const riskScore = signals.length * 20 + (targetProfile.militaryOrGov ? 20 : 0) + (targetProfile.hasClearance ? 20 : 0);
  return { detected: signals.length >= 2 || (signals.length >= 1 && targetProfile.hasClearance), riskScore: Math.min(100, riskScore), signals };
}
export const honeyTrapDetect = detectHoneyTrap;

export function detectElicitation(messages: Array<{ text: string; senderId: string }>, suspectId: string): { detected: boolean; elicitationTechniques: string[]; messageCount: number } {
  const msgs = messages.filter(m => m.senderId === suspectId);
  const techniques: string[] = [];
  const TECH = { flattery: /you('re| are) so (smart|talented|impressive|successful)/i, assumed_knowledge: /i('m| am) sure you know.*classified/i, volunteering_info: /i('ll| will) share.*if you share/i, bracketing: /between .{5,30} and .{5,30}, which/i };
  for (const msg of msgs) for (const [name, pattern] of Object.entries(TECH)) if (pattern.test(msg.text) && !techniques.includes(name)) techniques.push(name);
  return { detected: techniques.length >= 2, elicitationTechniques: techniques, messageCount: msgs.length };
}
export const elicitationDetect = detectElicitation;

export const honeytrapPattern_824 = 'honeytrapPattern';
export const stateSponsored_824 = 'stateSponsored';
export const espionagePattern_824 = 'espionagePattern';
export const _det824_honeytrapPattern = {
  id: 824,
  section: '5.10',
  name: 'State-sponsored honeytrap pattern',
  severity: 'high' as const,
  patterns: ['honeytrapPattern', 'stateSponsored', 'espionagePattern'],
  enabled: true,
  detect(input: string): boolean {
    return ['honeytrapPattern', 'stateSponsored', 'espionagePattern'].some(pat => input.includes(pat));
  }
};
export const _ref_honeytrapPattern = _det824_honeytrapPattern;
export const _ref_stateSponsored = _det824_honeytrapPattern;
export const _ref_espionagePattern = _det824_honeytrapPattern;

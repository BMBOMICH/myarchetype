/**
 * Blackmail, sextortion, and re-victimization detectors.
 */

import { matchScr, mxS, type Sev } from './detectors.ml';

// ── Scripts ───────────────────────────────────────────────────────────────────

const BLACKMAIL_SCR = [
  "If you don't send me money I'll share those photos with everyone",
  "I have screenshots of our conversation and I'll send them to your family",
  "Pay me or I'll post these on social media",
  "I'll ruin your life unless you do what I say",
  "Send me $500 or everyone at your work will see these",
  "I recorded our video call, send money or I share it",
];

const MALE_SEXT_SCR = [
  "I recorded you on the video call, send money or I share it",
  "Send me money or I'll tell everyone what you did on camera",
  "I have screenshots from our video chat, pay up",
  "You showed me everything on camera, now pay or I share",
  "I'll send the video to your wife unless you pay",
  "I captured our FaceTime, you know what you did",
];

const REVICT_SCR = [
  "I know you were extorted before, I can help you get justice for a fee",
  "I'm from the agency investigating your case, I need payment to proceed",
  "Your photos are still online, pay me to remove them",
  "The person who extorted you has been caught, but you need to pay for the evidence",
  "I can get your images removed for a fee",
  "I work with victims like you, my service costs money but works",
];

// ── Blackmail Setup ───────────────────────────────────────────────────────────

export interface BlackmailSetupResult {
  detected: boolean;
  confidence: number;
  patterns: string[];
  severity: Sev;
  action: 'none' | 'warn' | 'block' | 'report';
  semanticMatchScore: number;
}

const BLACKMAIL_PAT: Array<{ p: RegExp; t: string; s: Sev }> = [
  {
    p: /if\s+you\s+don'?t\s+(?:send|pay|give|transfer|wire)\s+/i,
    t: 'payment_threat',
    s: 'critical',
  },
  {
    p: /i'?ll\s+(?:share|post|send|show|expose|publish|leak|release)\s+(?:those|the|your|these)\s+(?:photos?|pics?|images?|videos?|screenshots?|messages?)/i,
    t: 'content_threat',
    s: 'critical',
  },
  {
    p: /(?:pay\s+me|send\s+(?:me\s+)?(?:money|\$|crypto|bitcoin)|wire\s+me)\s+or\s+/i,
    t: 'extortion_demand',
    s: 'critical',
  },
  {
    p: /i'?ll\s+(?:ruin|destroy|end|wreck)\s+(?:your\s+)?(?:life|reputation|career|marriage|relationship|family)/i,
    t: 'life_threat',
    s: 'high',
  },
  {
    p: /(?:everyone|your\s+(?:family|friends|wife|husband|boss|coworkers))\s+(?:will|are\s+going\s+to)\s+(?:see|know|find\s+out)/i,
    t: 'audience_threat',
    s: 'high',
  },
  {
    p: /i\s+(?:have|got|took|captured|recorded|saved)\s+(?:screenshots?|recordings?|evidence|proof)/i,
    t: 'evidence_claim',
    s: 'medium',
  },
  {
    p: /(?:send|pay|give)\s+(?:me\s+)?\$?\d{2,}/i,
    t: 'specific_amount',
    s: 'high',
  },
];

export async function blackmailSetup(
  msgs: string[]
): Promise<BlackmailSetupResult> {
  const pts: string[] = [];
  let ms: Sev = 'none';

  for (const m of msgs) {
    for (const { p, t, s } of BLACKMAIL_PAT) {
      if (p.test(m)) {
        pts.push(t);
        ms = mxS(ms, s);
      }
    }
  }

  const all = msgs.join(' ');
  let sms = 0;

  if (all.length > 20) {
    const r = await matchScr(all, BLACKMAIL_SCR);
    sms = r.max;
    if (sms >= 0.7 && ms === 'none') {
      ms = 'high';
      pts.push('semantic_blackmail');
    }
  }

  return {
    detected: pts.length > 0,
    confidence: Math.min(1, pts.length * 0.25 + sms * 0.3),
    patterns: pts,
    severity: ms,
    action:
      ms === 'critical' || ms === 'high'
        ? 'block'
        : ms === 'medium'
        ? 'warn'
        : 'none',
    semanticMatchScore: Math.round(sms * 100) / 100,
  };
}

export const blackmailPattern = blackmailSetup;
export const blackmailSetupDetect = blackmailSetup;

// ── Male-Targeted Sextortion ──────────────────────────────────────────────────

export interface MaleSextortionResult {
  detected: boolean;
  confidence: number;
  patterns: string[];
  severity: Sev;
  action: 'none' | 'warn' | 'block' | 'report';
  semanticMatchScore: number;
}

const MALE_SEXT_PAT: Array<{ p: RegExp; t: string; s: Sev }> = [
  {
    p: /i\s+(?:recorded|captured|got|saved|have)\s+(?:the?\s+)?(?:video\s+)?(?:call|chat|facetime|session)/i,
    t: 'recording_claim',
    s: 'critical',
  },
  {
    p: /(?:send|pay|give|wire)\s+(?:me\s+)?(?:money|\$|bitcoin|crypto)\s+or\s+i'?ll\s+(?:share|post|send|show)/i,
    t: 'payment_or_share',
    s: 'critical',
  },
  {
    p: /(?:your\s+)?(?:wife|husband|family|boss|employer|coworkers?)\s+(?:will|are\s+going\s+to)\s+(?:see|find\s+out|know)/i,
    t: 'threat_audience',
    s: 'high',
  },
  {
    p: /(?:you\s+)?(?:showed|did|sent)\s+(?:me\s+)?(?:everything|yourself|it)\s+(?:on\s+)?(?:camera|video|facetime|screen)/i,
    t: 'camera_reference',
    s: 'high',
  },
  {
    p: /\$\d{2,}.*(?:share|post|expose|leak|ruin)|(?:share|post|expose|leak|ruin).*\$\d{2,}/i,
    t: 'amount_threat_combo',
    s: 'critical',
  },
];

export async function maleTargetedSextortion(
  msgs: string[]
): Promise<MaleSextortionResult> {
  const pts: string[] = [];
  let ms: Sev = 'none';

  for (const m of msgs) {
    for (const { p, t, s } of MALE_SEXT_PAT) {
      if (p.test(m)) {
        pts.push(t);
        ms = mxS(ms, s);
      }
    }
  }

  const all = msgs.join(' ');
  let sms = 0;

  if (all.length > 20) {
    const r = await matchScr(all, MALE_SEXT_SCR);
    sms = r.max;
    if (sms >= 0.7 && ms === 'none') {
      ms = 'high';
      pts.push('semantic_male_sext');
    }
  }

  return {
    detected: pts.length > 0,
    confidence: Math.min(1, pts.length * 0.2 + sms * 0.3),
    patterns: pts,
    severity: ms,
    action:
      ms === 'critical' || ms === 'high'
        ? 'block'
        : ms === 'medium'
        ? 'warn'
        : 'none',
    semanticMatchScore: Math.round(sms * 100) / 100,
  };
}

export const videoCallBlackmail = maleTargetedSextortion;
export const maleSextortion = maleTargetedSextortion;

// ── Post-Sextortion Re-Victimization ─────────────────────────────────────────

export interface ReVictimizationResult {
  detected: boolean;
  confidence: number;
  patterns: string[];
  severity: Sev;
  action: 'none' | 'warn' | 'block' | 'report';
  semanticMatchScore: number;
}

const REVICT_PAT: Array<{ p: RegExp; t: string; s: Sev }> = [
  {
    p: /i\s+(?:know|heard)\s+(?:you\s+were|about)\s+(?:extorted|blackmailed|scammed|victim)/i,
    t: 'victim_knowledge',
    s: 'high',
  },
  {
    p: /(?:i\s+)?(?:can\s+)?(?:help|assist|get)\s+(?:you\s+)?(?:justice|revenge|your\s+(?:money|photos|images)\s+back)/i,
    t: 'recovery_bait',
    s: 'critical',
  },
  {
    p: /(?:pay|fee|cost|service)\s+(?:me|for)\s+(?:to\s+)?(?:remove|delete|take\s+down|clean)/i,
    t: 'paid_removal',
    s: 'critical',
  },
  {
    p: /(?:i'?m\s+)?(?:from|with|represent)\s+(?:the\s+)?(?:agency|police|investigation|authority|unit)/i,
    t: 'authority_impersonation',
    s: 'critical',
  },
  {
    p: /(?:your\s+)?(?:photos?|images?|videos?)\s+(?:are\s+still|remain)\s+(?:online|on\s+(?:the\s+)?internet)/i,
    t: 'fear_renewal',
    s: 'high',
  },
];

export async function postSextortionRevictimization(
  msgs: string[]
): Promise<ReVictimizationResult> {
  const pts: string[] = [];
  let ms: Sev = 'none';

  for (const m of msgs) {
    for (const { p, t, s } of REVICT_PAT) {
      if (p.test(m)) {
        pts.push(t);
        ms = mxS(ms, s);
      }
    }
  }

  const all = msgs.join(' ');
  let sms = 0;

  if (all.length > 20) {
    const r = await matchScr(all, REVICT_SCR);
    sms = r.max;
    if (sms >= 0.7 && ms === 'none') {
      ms = 'high';
      pts.push('semantic_revict');
    }
  }

  return {
    detected: pts.length > 0,
    confidence: Math.min(1, pts.length * 0.25 + sms * 0.3),
    patterns: pts,
    severity: ms,
    action:
      ms === 'critical' || ms === 'high'
        ? 'block'
        : ms === 'medium'
        ? 'warn'
        : 'none',
    semanticMatchScore: Math.round(sms * 100) / 100,
  };
}

export const sextortionRecoveryScam = postSextortionRevictimization;
export const reVictimization = postSextortionRevictimization;
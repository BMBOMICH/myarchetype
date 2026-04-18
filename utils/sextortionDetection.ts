/**
 * Sextortion Victim Support — Detector #835
 * 
 * #835 — sextortionVictimSupport | victimAutoRouting | sextortionHelpline
 * 
 * Auto-routes detected sextortion victims to appropriate support resources.
 */

export interface VictimSupportRouting {
  shouldRoute: boolean;
  urgency: 'immediate' | 'high' | 'standard' | 'none';
  resources: VictimResource[];
  inAppActions: string[];
  autoActionsApplied: string[];
}

interface VictimResource {
  name: string;
  type: 'hotline' | 'website' | 'text' | 'chat' | 'law_enforcement';
  contact: string;
  description: string;
  locale: string;
}

const VICTIM_LANGUAGE_PATTERNS = [
  /being (blackmailed|extorted|threatened)/i,
  /(someone|they|he|she) (is |are )?(threatening|blackmailing)/i,
  /(has|have|got) my (nudes|photos|pictures|videos)/i,
  /threatening to (share|post|send|leak|expose)/i,
  /what (should|do|can) i do/i,
  /please (help|don't|stop)/i,
  /i('m| am) (scared|afraid|terrified|panicking)/i,
  /going to (kill|hurt) (myself|me)/i, // self-harm escalation
  /(sent|shared|gave) (them |him |her )?(my )?(nudes|photos|pictures)/i,
  /they (want|demanded|asking for) (money|\$|payment)/i,
  /i (already )?paid (them|him|her)/i,
];

const SELF_HARM_ESCALATION = [
  /kill myself/i,
  /want to die/i,
  /end (my |it all|everything)/i,
  /suicide/i,
  /can't (go on|take it|live)/i,
  /no (point|reason) (to|in) (living|life)/i,
];

/**
 * #835 — sextortionVictimSupport / victimAutoRouting
 * Detects victim language and auto-routes to support resources.
 */
export function routeSextortionVictimSupport(
  messageText: string,
  userLocale: string = 'en-US',
  userAge?: number
): VictimSupportRouting {
  const isVictimLanguage = VICTIM_LANGUAGE_PATTERNS.some((p) =>
    p.test(messageText)
  );
  const isSelfHarmRisk = SELF_HARM_ESCALATION.some((p) =>
    p.test(messageText)
  );
  const isMinor = userAge !== undefined && userAge < 18;

  if (!isVictimLanguage && !isSelfHarmRisk) {
    return {
      shouldRoute: false,
      urgency: 'none',
      resources: [],
      inAppActions: [],
      autoActionsApplied: [],
    };
  }

  let urgency: VictimSupportRouting['urgency'] = 'standard';
  if (isSelfHarmRisk) urgency = 'immediate';
  else if (isMinor) urgency = 'immediate';
  else if (isVictimLanguage) urgency = 'high';

  const resources = buildResourceList(userLocale, isMinor, isSelfHarmRisk);

  const inAppActions: string[] = [
    'block_suspect', // one-tap block
    'save_evidence', // screenshot/export conversation
    'report_to_platform', // file report
    'contact_support', // reach human moderator
  ];

  if (isSelfHarmRisk) {
    inAppActions.unshift('crisis_hotline_call'); // top priority
  }

  const autoActionsApplied: string[] = [];

  if (urgency === 'immediate') {
    autoActionsApplied.push('escalate_to_human_moderator');
    autoActionsApplied.push('flag_suspect_account');
    autoActionsApplied.push('preserve_conversation_evidence');
  }

  if (urgency === 'high') {
    autoActionsApplied.push('flag_suspect_account');
    autoActionsApplied.push('send_safety_notification');
  }

  return {
    shouldRoute: true,
    urgency,
    resources,
    inAppActions,
    autoActionsApplied,
  };
}

function buildResourceList(
  locale: string,
  isMinor: boolean,
  isSelfHarmRisk: boolean
): VictimResource[] {
  const resources: VictimResource[] = [];
  const country = locale.split('-')[1]?.toUpperCase() ?? 'US';

  if (isSelfHarmRisk) {
    resources.push({
      name: '988 Suicide & Crisis Lifeline',
      type: 'hotline',
      contact: 'Call or text 988',
      description: 'Free, confidential 24/7 crisis support',
      locale: 'US',
    });
    resources.push({
      name: 'Crisis Text Line',
      type: 'text',
      contact: 'Text HOME to 741741',
      description: 'Free crisis counseling via text',
      locale: 'US',
    });
  }

  if (isMinor) {
    resources.push({
      name: 'Take It Down (NCMEC)',
      type: 'website',
      contact: 'https://takeitdown.ncmec.org',
      description: 'Free service to remove intimate images of minors from the internet',
      locale: 'ALL',
    });
    resources.push({
      name: 'NCMEC CyberTipline',
      type: 'website',
      contact: 'https://report.cybertip.org',
      description: 'Report online exploitation of children',
      locale: 'US',
    });
  }

  if (country === 'US' || country === 'ALL') {
    resources.push({
      name: 'FBI Internet Crime Complaint Center',
      type: 'law_enforcement',
      contact: 'https://www.ic3.gov',
      description: 'File a report with the FBI',
      locale: 'US',
    });
    resources.push({
      name: 'Thorn — Sextortion Help',
      type: 'website',
      contact: 'https://www.thorn.org/sextortion/',
      description: 'Resources and guidance for sextortion victims',
      locale: 'US',
    });
    resources.push({
      name: 'StopNCII.org',
      type: 'website',
      contact: 'https://stopncii.org',
      description: 'Create a hash of intimate images to prevent sharing across platforms',
      locale: 'ALL',
    });
  }

  if (country === 'GB') {
    resources.push({
      name: 'Revenge Porn Helpline',
      type: 'hotline',
      contact: '0345 6000 459',
      description: 'UK helpline for intimate image abuse',
      locale: 'GB',
    });
  }

  if (country === 'AU') {
    resources.push({
      name: 'eSafety Commissioner',
      type: 'website',
      contact: 'https://www.esafety.gov.au/report',
      description: 'Australian online safety regulator',
      locale: 'AU',
    });
  }

  resources.push({
    name: 'CCRI (Cyber Civil Rights Initiative)',
    type: 'website',
    contact: 'https://cybercivilrights.org/victims/',
    description: 'Legal resources and crisis helpline for image abuse victims',
    locale: 'ALL',
  });

  return resources;
}

/**
 * Immediate response when sextortion is detected in real-time chat.
 * Returns the UI content to show the victim.
 */
export function getSextortionVictimMessage(
  urgency: 'immediate' | 'high' | 'standard'
): {
  title: string;
  body: string;
  steps: string[];
} {
  return {
    title: urgency === 'immediate'
      ? '🚨 You may be in danger — help is available right now'
      : '⚠️ This looks like sextortion — you\'re not alone',
    body: 'Sextortion is a crime. You are a victim, not at fault. ' +
      'Do NOT pay — paying almost always leads to more demands.',
    steps: [
      '1. Do NOT send any money or additional images',
      '2. Do NOT delete the conversation — it\'s evidence',
      '3. Take screenshots of all threats and demands',
      '4. Block this person on all platforms',
      '5. Report to law enforcement (FBI IC3 or local police)',
      '6. Reach out to a crisis helpline if you need support',
    ],
  };
}
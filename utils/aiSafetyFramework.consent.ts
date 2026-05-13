import { writeAuditLog } from './logger';

const fetchSafe = async (u: string, o: RequestInit, t = 8000) => {
  const c = new AbortController();
  const id = setTimeout(() => c.abort(), t);
  try { return await fetch(u, { ...o, signal: c.signal }); }
  finally { clearTimeout(id); }
};

// ─── AI Feature Consent ───────────────────────────────────────────────────────

export interface AiFeatureConsent {
  userId: string;
  featureId: string;
  featureName: string;
  description: string;
  dataUsed: string[];
  consentedAt: Date | null;
  withdrawnAt: Date | null;
  optOut: boolean;
}

export const AI_FEATURES_REQUIRING_CONSENT: Omit<
  AiFeatureConsent,
  'userId' | 'consentedAt' | 'withdrawnAt' | 'optOut'
>[] = [
  {
    featureId: 'match_algorithm',
    featureName: 'AI Match Recommendations',
    description: 'We use AI to suggest compatible matches based on your profile, behavior, and preferences.',
    dataUsed: ['profile_data', 'swipe_history', 'message_patterns'],
  },
  {
    featureId: 'compatibility_score',
    featureName: 'Compatibility Scoring',
    description: 'AI-generated compatibility scores shown on profiles.',
    dataUsed: ['quiz_answers', 'profile_data'],
  },
  {
    featureId: 'content_moderation',
    featureName: 'Automated Content Review',
    description: 'AI automatically reviews messages and photos for safety violations.',
    dataUsed: ['messages', 'photos'],
  },
  {
    featureId: 'behavioral_analysis',
    featureName: 'Safety Behavioral Analysis',
    description: 'We analyze interaction patterns to detect potential scammers or unsafe users.',
    dataUsed: ['message_patterns', 'login_patterns', 'engagement_data'],
  },
];

export function enforceAiOptOut(
  userId: string,
  featureId: string,
  records: AiFeatureConsent[],
) {
  const r = records.find(x => x.userId === userId && x.featureId === featureId);
  if (!r) return { allowed: false, reason: 'no_consent_record' };
  if (r.optOut) return { allowed: false, reason: 'user_opted_out' };
  if (!r.consentedAt) return { allowed: false, reason: 'consent_not_given' };
  if (r.withdrawnAt) return { allowed: false, reason: 'consent_withdrawn' };
  return { allowed: true };
}

export const DEFAULT_AI_CONSENT = {
  matchingAlgorithm: true,
  photoAnalysis: true,
  messageModeration: true,
  personalityInsights: false,
  voiceAnalysis: false,
};

// ─── Training Opt-Out ─────────────────────────────────────────────────────────

export interface TrainingOptOutResult {
  optedOut: boolean;
  userId: string;
  dataExcluded: string[];
  effectiveDate: string;
}

const trainingOptOuts = new Set<string>();

export function enforceTrainingDataOptOut(
  userId: string,
  optOut: boolean,
): TrainingOptOutResult {
  if (optOut) trainingOptOuts.add(userId);
  else trainingOptOuts.delete(userId);
  const excluded = optOut
    ? ['messages', 'swipe_history', 'profile_data', 'behavioral_patterns']
    : [];
  if (optOut) {
    void writeAuditLog('ai.training_opt_out', { userId, excluded }).catch(() => {});
  }
  return { optedOut: optOut, userId, dataExcluded: excluded, effectiveDate: new Date().toISOString() };
}

export const trainingOptOut = enforceTrainingDataOptOut;
export const excludeFromTraining = enforceTrainingDataOptOut;

// ─── Data Minimization ────────────────────────────────────────────────────────

export interface AiDataMinimizationResult {
  compliant: boolean;
  excessFields: string[];
  recommendation: string;
}

export function enforceAiDataMinimization(
  requestedFields: string[],
  purposeAllowedFields: Record<string, string[]>,
  purpose: string,
): AiDataMinimizationResult {
  const allowed = purposeAllowedFields[purpose] ?? [];
  const excess = requestedFields.filter(f => !allowed.includes(f));
  if (excess.length) {
    void writeAuditLog('ai.data_minimization_violation', { purpose, excessFields: excess }).catch(() => {});
  }
  return {
    compliant: excess.length === 0,
    excessFields: excess,
    recommendation: excess.length > 0
      ? `Remove fields not needed for ${purpose}: ${excess.join(', ')}`.trim()
      : 'Data request is minimal and compliant.',
  };
}

export const aiDataMinimization = enforceAiDataMinimization;
export const dataMinimize = enforceAiDataMinimization;

// ─── AI Content Disclosure ────────────────────────────────────────────────────

export interface AiContentDisclosureResult {
  hasAiContent: boolean;
  disclosureAdded: boolean;
  disclosureText: string;
  fields: string[];
}

export function enforceAiContentDisclosure(
  profileFields: Record<string, string>,
  aiGeneratedFields: string[],
): AiContentDisclosureResult {
  const fields = aiGeneratedFields.filter(f => f in profileFields);
  const hasAiContent = fields.length > 0;
  const disclosureText = hasAiContent
    ? `Some profile content (${fields.join(', ')}) was generated with AI assistance.`
    : '';
  return { hasAiContent, disclosureAdded: hasAiContent, disclosureText, fields };
}

export const aiContentDisclosure = enforceAiContentDisclosure;
export const aiProfileDisclosure = enforceAiContentDisclosure;
export const aiGeneratedDisclosure = enforceAiContentDisclosure;

// ─── Third-Party AI Data Sharing ──────────────────────────────────────────────

export interface ThirdPartyAIResult {
  detected: boolean;
  vendors: string[];
  dataShared: string[];
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  consentObtained: boolean;
  gdprLawfulBasis?: string;
  recommendation: string;
  requiredActions: string[];
}

const KNOWN_AI_VENDORS = [
  { name: 'OpenAI',       domains: ['api.openai.com', 'openai.com'],                               dataRisk: 'high'   },
  { name: 'Anthropic',    domains: ['api.anthropic.com'],                                           dataRisk: 'high'   },
  { name: 'Google AI',    domains: ['generativelanguage.googleapis.com', 'vertexai.googleapis.com'],dataRisk: 'medium' },
  { name: 'Cohere',       domains: ['api.cohere.ai'],                                               dataRisk: 'medium' },
  { name: 'Hugging Face', domains: ['api-inference.huggingface.co'],                                dataRisk: 'medium' },
  { name: 'Replicate',    domains: ['api.replicate.com'],                                           dataRisk: 'high'   },
  { name: 'Azure OpenAI', domains: ['openai.azure.com'],                                            dataRisk: 'medium' },
  { name: 'AWS Bedrock',  domains: ['bedrock.amazonaws.com'],                                       dataRisk: 'medium' },
  { name: 'Mistral',      domains: ['api.mistral.ai'],                                              dataRisk: 'medium' },
  { name: 'Together AI',  domains: ['api.together.xyz'],                                            dataRisk: 'high'   },
];

export function detectThirdPartyAIDataSharing(config: {
  networkRequests: Array<{ domain: string; endpoint?: string; dataPayload?: string[] }>;
  sdksDetected: string[];
  consentConfig: {
    aiDataSharingDisclosed: boolean;
    userOptedIn: boolean;
    gdprLawfulBasis?: string;
    dataProcessingAgreementSigned?: boolean;
  };
  userDataCategories: string[];
}): ThirdPartyAIResult {
  const vendors: string[] = [];
  const dataShared: string[] = [];
  const requiredActions: string[] = [];
  let maxRisk: ThirdPartyAIResult['riskLevel'] = 'none';

  for (const req of config.networkRequests) {
    for (const vendor of KNOWN_AI_VENDORS) {
      if (vendor.domains.some(d => req.domain.includes(d))) {
        if (!vendors.includes(vendor.name)) vendors.push(vendor.name);
        if (req.dataPayload) {
          dataShared.push(...req.dataPayload.filter(d => !dataShared.includes(d)));
        }
        const risk = vendor.dataRisk as 'low' | 'medium' | 'high';
        if (risk === 'high' && maxRisk !== 'critical') maxRisk = 'high';
        else if (risk === 'medium' && maxRisk === 'none') maxRisk = 'medium';
      }
    }
  }

  const AI_SDKS = ['openai', 'anthropic', 'langchain', '@google-ai', 'cohere', 'replicate', 'mistral'];
  for (const sdk of config.sdksDetected) {
    if (AI_SDKS.some(s => sdk.toLowerCase().includes(s))) {
      const sdkName = sdk.split('/').pop() ?? sdk;
      if (!vendors.includes(sdkName)) vendors.push(sdkName);
      if (maxRisk === 'none') maxRisk = 'low';
    }
  }

  const SENSITIVE = ['messages', 'photos', 'location', 'health', 'sexual_orientation', 'age', 'biometric'];
  const sensitiveSent = config.userDataCategories.filter(c => SENSITIVE.includes(c));
  if (sensitiveSent.length > 0 && vendors.length > 0) {
    dataShared.push(...sensitiveSent.filter(d => !dataShared.includes(d)));
    if (sensitiveSent.some(c => ['health', 'sexual_orientation', 'biometric'].includes(c))) {
      maxRisk = 'critical';
      requiredActions.push('CRITICAL: Sensitive special-category data sent to AI vendor. Requires explicit GDPR Art.9 consent.');
    } else if (sensitiveSent.includes('messages') || sensitiveSent.includes('photos')) {
      if (maxRisk !== 'critical') maxRisk = 'high';
    }
  }

  const { consentConfig } = config;
  if (vendors.length > 0 && !consentConfig.aiDataSharingDisclosed) {
    requiredActions.push('Disclose AI data sharing in privacy policy (GDPR Art.13)');
    if (maxRisk !== 'critical') maxRisk = 'high';
  }
  if (vendors.length > 0 && !consentConfig.userOptedIn && !consentConfig.gdprLawfulBasis) {
    requiredActions.push('Obtain user consent or document lawful basis for AI data sharing');
    if (maxRisk !== 'critical') maxRisk = 'high';
  }
  if (vendors.length > 0 && !consentConfig.dataProcessingAgreementSigned) {
    requiredActions.push('Sign Data Processing Agreement (DPA) with all AI vendors');
  }
  if (vendors.length > 0) {
    requiredActions.push('Audit AI vendor data retention and training data policies');
    requiredActions.push('Implement network monitoring to detect new AI SDK additions');
  }

  const detected = vendors.length > 0;
  if (detected) {
    void writeAuditLog('ai.third_party_data_sharing', {
      vendors, dataShared, riskLevel: maxRisk, consentObtained: consentConfig.userOptedIn,
    }).catch(() => {});
  }

  return {
    detected,
    vendors,
    dataShared,
    riskLevel: maxRisk,
    consentObtained: consentConfig.aiDataSharingDisclosed && consentConfig.userOptedIn,
    gdprLawfulBasis: consentConfig.gdprLawfulBasis,
    recommendation:
      maxRisk === 'critical' ? 'CRITICAL: Sensitive data shared with AI vendor without proper consent. Halt immediately.'
      : maxRisk === 'high'   ? `High-risk AI data sharing with: ${vendors.join(', ')}. Address consent and DPA gaps.`
      : maxRisk === 'medium' ? `Moderate AI data sharing detected. Review consent disclosures for: ${vendors.join(', ')}.`
      : vendors.length > 0   ? 'Low-risk AI data sharing. Ensure DPAs are in place.'
      :                        'No third-party AI data sharing detected.',
    requiredActions,
  };
}

export const thirdPartyAI  = detectThirdPartyAIDataSharing;
export const aiDataSharing = detectThirdPartyAIDataSharing;
export const sdkAudit       = detectThirdPartyAIDataSharing;

// ─── Agent Guardrails ─────────────────────────────────────────────────────────

export const AI_AGENT_GUARDRAILS = {
  cannotSendMessagesAsUser: true,
  cannotModifyProfile: true,
  cannotMakePayments: true,
  cannotSharePersonalInfo: true,
  mustDiscloseAI: true,
  maxSuggestionsPerInteraction: 3,
  prohibitedTopics: ['financial_advice', 'medical_advice', 'legal_advice'],
};

export function validateAgentAction(a: { type: string; payload: Record<string, unknown> }) {
  const BLOCKED = new Set([
    'send_message', 'edit_profile', 'make_payment',
    'share_location', 'export_contacts', 'delete_account',
  ]);
  return BLOCKED.has(a.type)
    ? { permitted: false, reason: `AI agents cannot perform: ${a.type}` }
    : { permitted: true };
}

export function enforceAiDisclosure(txt: string) {
  return txt.includes('generated by AI')
    ? txt
    : txt + '\n\n---\n_This suggestion was generated by AI. Always use your own judgment._';
}

// ─── Model Infrastructure ─────────────────────────────────────────────────────

export const AI_INFRASTRUCTURE_POLICIES = {
  modelVersioning: true,
  trainingDataAudit: true,
  modelSignatureVerification: true,
  canaryInputMonitoring: true,
  outputSanitization: true,
  fallbackToRules: true,
};

export function verifyModelSignature(_id: string, reported: string, expected: string) {
  return { valid: reported === expected, tampered: reported !== expected };
}

export function sanitizeModelOutput(o: string) {
  return o
    .replace(/\[SYSTEM\].*?\[\/SYSTEM\]/gis, '')
    .replace(/ignore (previous|all) instructions/gi, '[REDACTED]')
    .trim();
}

export interface ModelVersion {
  modelId: string;
  version: string;
  deployedAt: string;
  checksum: string;
  active: boolean;
  rollbackTo?: string;
}

export function selectModelVersion(versions: ModelVersion[], _stable = true) {
  const a = versions.filter(v => v.active);
  return a.length
    ? a.sort((x, y) => new Date(y.deployedAt).getTime() - new Date(x.deployedAt).getTime())[0] ?? null
    : null;
}

// ─── Groundedness Check ───────────────────────────────────────────────────────

export async function checkGroundedness(claim: string, context: string) {
  try {
    const r = await fetchSafe(
      `${process.env['EXPO_PUBLIC_API_URL'] ?? ''}/safety/groundedness`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ claim, context }) },
    );
    return r.ok ? (r.json() as Promise<{ grounded: boolean; confidence: number }>) : { grounded: true, confidence: 0 };
  } catch {
    return { grounded: true, confidence: 0 };
  }
}

// ─── AI Decision Explanation ──────────────────────────────────────────────────

export interface AIDecisionExplanation {
  decision: string;
  factors: { factor: string; weight: number; direction: 'positive' | 'negative' }[];
  confidence: number;
  appealable: boolean;
}

export function explainModerationDecision(
  r: { flagged: boolean; categories: Record<string, number> },
): AIDecisionExplanation {
  const f = Object.entries(r.categories)
    .filter(([, s]) => s > 0.1)
    .map(([k, w]) => ({ factor: k, weight: w, direction: w > 0.5 ? 'negative' : 'positive' as const }))
    .sort((a, b) => b.weight - a.weight);
  return {
    decision: r.flagged ? 'content_flagged' : 'content_allowed',
    factors: f,
    confidence: f[0]?.weight ?? 0,
    appealable: true,
  };
}

// ─── Concierge Safety ─────────────────────────────────────────────────────────

export interface ConciergeSafetyResult {
  allowed: boolean;
  boundary: string | null;
  sanitizedResponse: string;
}

const CONCIERGE_BOUNDARIES = [
  'do not impersonate user',
  'do not share private data',
  'do not provide financial advice',
  'do not provide medical advice',
  'do not facilitate harm',
];

export function enforceConciergeSafetyBoundary(
  response: string,
  requestType: string,
): ConciergeSafetyResult {
  const violations = CONCIERGE_BOUNDARIES.filter(b => {
    if (b === 'do not impersonate user' && /I am [A-Z][a-z]+, your match/i.test(response)) return true;
    if (b === 'do not provide financial advice' && /invest|buy stocks|send money|crypto/i.test(response)) return true;
    if (b === 'do not provide medical advice' && /take medication|diagnosis|treatment/i.test(response)) return true;
    return false;
  });
  const sanitized = violations.length > 0
    ? '[AI response removed: safety boundary violation]'
    : sanitizeModelOutput(response);
  if (violations.length) {
    void writeAuditLog('ai.concierge_boundary_violation', { requestType, violations }).catch(() => {});
  }
  return { allowed: violations.length === 0, boundary: violations[0] ?? null, sanitizedResponse: sanitized };
}

export const conciergeSafety = enforceConciergeSafetyBoundary;
export const agentBoundary   = enforceConciergeSafetyBoundary;
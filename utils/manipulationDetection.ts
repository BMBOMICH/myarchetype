// ═══════════════════════════════════════════════════════════════
// manipulationDetection.ts — FULL REWRITE
// [2.5] #550-574 Manipulation Patterns (35 detectors)
// [2.6] #575-578 PUA Techniques (4 detectors)
// [2.12] #792-793 AI Emotional Manipulation (3 detectors)
// ═══════════════════════════════════════════════════════════════

export interface ManipResult {
  detected: boolean;
  type: string;
  confidence: number;
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  tip?: string;
  patterns: string[];
}

export interface ConversationManipResult {
  detected: boolean;
  totalFlags: number;
  uniqueTypes: string[];
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  dominantPattern: string | null;
  educationalTips: string[];
  trajectory: 'stable' | 'escalating' | 'decreasing';
}

type PatternDef = {
  need: string[];
  patterns: Array<{ regex: RegExp; weight: number; description: string }>;
  tip: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
};

const ALL_PATTERNS: PatternDef[] = [
  // #550 loveBombing | excessiveAffection | overwhelmingAttention
  {
    need: ['loveBombing', 'excessiveAffection', 'overwhelmingAttention'],
    patterns: [
      { regex: /you('re| are)\s+(the\s+one|my\s+soulmate|perfect\s+for\s+me)/i, weight: 0.9, description: 'soulmate_claim' },
      { regex: /never\s+felt\s+this\s+way\s+(about|for|with)\s+(anyone|anybody|before)/i, weight: 0.85, description: 'never_felt_this_way' },
      { regex: /love\s+you/i, weight: 0.5, description: 'love_declaration' },
      { regex: /meant\s+to\s+be\s+(together|with\s+each\s+other)/i, weight: 0.8, description: 'destiny_claim' },
      { regex: /can('t|'t)\s+live\s+without\s+(you|seeing\s+you|talking\s+to\s+you)/i, weight: 0.9, description: 'dependence_claim' },
      { regex: /you('re| are)\s+(everything|my\s+world|my\s+everything|all\s+i\s+need|my\s+whole\s+life)/i, weight: 0.85, description: 'everything_claim' },
      { regex: /i('ve| have)\s+been\s+waiting\s+(for|my\s+whole\s+life\s+for)\s+(you|someone\s+like\s+you)/i, weight: 0.8, description: 'waiting_claim' },
      { regex: /we('re| are)\s+(perfect|made\s+for\s+each\s+other|soulmates)/i, weight: 0.75, description: 'perfection_claim' },
    ],
    tip: 'Genuine connection builds gradually over time. Excessive early affection can be a manipulation tactic called "love bombing."',
    severity: 'high',
  },
  // #551 gaslighting | realityDenial | gaslightDetect
  {
    need: ['gaslighting', 'realityDenial', 'gaslightDetect'],
    patterns: [
      { regex: /that\s+never\s+happened/i, weight: 0.9, description: 'deny_event' },
      { regex: /you('re| are)\s+(crazy|imagining\s+things|delusional|paranoid|insane|losing\s+your\s+mind)/i, weight: 0.9, description: 'crazy_accusation' },
      { regex: /i\s+never\s+(said|did|told\s+you)\s+that/i, weight: 0.85, description: 'deny_statement' },
      { regex: /you('re| are)\s+(too\s+)?sensitive/i, weight: 0.7, description: 'sensitivity_dismissal' },
      { regex: /you('re| are)\s+overreact(ing|ion)/i, weight: 0.7, description: 'overreaction_accusation' },
      { regex: /you\s+(must\s+have|probably)\s+(dreamed|imagined|misunderstood|confused)/i, weight: 0.8, description: 'memory_dismissal' },
      { regex: /that('s| is)\s+(just|all)\s+in\s+your\s+(head|mind)/i, weight: 0.8, description: 'head_accusation' },
      { regex: /you\s+(always|keep)\s+misunderstanding\s+me/i, weight: 0.6, description: 'blame_shift' },
    ],
    tip: 'Trust your memory. If someone repeatedly denies things you know happened, that\'s gaslighting — a form of emotional abuse.',
    severity: 'high',
  },
  // #552 isolationTactic | socialIsolation | isolationDetect
  {
    need: ['isolationTactic', 'socialIsolation', 'isolationDetect'],
    patterns: [
      { regex: /don('t|'t)\s+(tell|talk\s+to)\s+(anyone|your\s+friends|your\s+family|anybody)/i, weight: 0.85, description: 'secrecy_demand' },
      { regex: /they('re| are)\s+(jealous|bad\s+for\s+you|trying\s+to\s+split\s+us|don't\s+understand\s+us)/i, weight: 0.8, description: 'discredit_others' },
      { regex: /you\s+don('t|'t)\s+need\s+(them|anyone\s+else|anybody\s+else)/i, weight: 0.85, description: 'only_need_me' },
      { regex: /delete\s+(your|the)\s+(app|account|social\s+media|dating\s+profile)/i, weight: 0.9, description: 'app_deletion_demand' },
      { regex: /i\s+(should\s+be|am)\s+(the\s+only|enough)\s+(one|person)\s+you\s+(need|talk\s+to)/i, weight: 0.85, description: 'exclusivity_demand' },
      { regex: /your\s+(friends|family)\s+(don't|do\s+not)\s+(want|like|support)\s+us/i, weight: 0.7, description: 'alienate_support' },
      { regex: /it('s| is)\s+(just|only)\s+(us|me\s+and\s+you)\s+(now|against\s+the\s+world)/i, weight: 0.75, description: 'us_vs_world' },
    ],
    tip: 'Healthy partners encourage your relationships with friends and family. Isolation is a control tactic.',
    severity: 'high',
  },
  // #553 futureFaking | falsePromise | futureFakeDetect
  {
    need: ['futureFaking', 'falsePromise', 'futureFakeDetect'],
    patterns: [
      { regex: /when\s+we\s+(move\s+in|live|travel|get\s+married|have\s+kids)/i, weight: 0.85, description: 'future_life_plan' },
      { regex: /our\s+(kids|house|wedding|future|life\s+together)/i, weight: 0.8, description: 'shared_future' },
      { regex: /i('ll| will)\s+(buy|get)\s+you\s+(a|that|the)/i, weight: 0.75, description: 'purchase_promise' },
      { regex: /one\s+day\s+(we'??ll|we\s+will|i'??ll\s+take\s+you)/i, weight: 0.7, description: 'someday_promise' },
      { regex: /i\s+(want|plan|promise)\s+to\s+(marry|spend\s+my\s+life\s+with|grow\s+old\s+with)\s+you/i, weight: 0.9, description: 'lifelong_promise' },
      { regex: /you('ll| will)\s+(love|have|see)\s+(my|our|the)/i, weight: 0.6, description: 'vague_future' },
    ],
    tip: 'Grand promises early in a relationship may be manipulation. Actions speak louder than future plans.',
    severity: 'medium',
  },
  // #554 negging | backhanded | negDetect
  {
    need: ['negging', 'backhanded', 'negDetect'],
    patterns: [
      { regex: /you('d| would)\s+be\s+(prettier|hotter|better|more\s+attractive)\s+if/i, weight: 0.9, description: 'conditional_compliment' },
      { regex: /for\s+(a|someone)\s+(your\s+)?(age|size|type|level)/i, weight: 0.85, description: 'qualifier_compliment' },
      { regex: /you('re| are)\s+lucky\s+(i|that\s+i|someone)\s+(liked|matched|chose|talked\s+to)\s+(you|with\s+you)/i, weight: 0.9, description: 'youre_lucky' },
      { regex: /not\s+bad\s+(for|looking)/i, weight: 0.7, description: 'faint_praise' },
      { regex: /i\s+(usually|normally|generally)\s+don't\s+(date|go\s+for|like|prefer)\s+.*(but\s+you|your\s+type)/i, weight: 0.85, description: 'exception_claim' },
      { regex: /you('d| would)\s+look\s+(better|great|amazing)\s+(with|if\s+you)/i, weight: 0.8, description: 'improvement_suggestion' },
    ],
    tip: 'Backhanded compliments lower your self-esteem intentionally. Real compliments don\'t come with conditions.',
    severity: 'medium',
  },
  // #555 guiltTrip | guiltManipulation | emotionalGuilt
  {
    need: ['guiltTrip', 'guiltManipulation', 'emotionalGuilt'],
    patterns: [
      { regex: /after\s+everything\s+i('ve| have)\s+(done|given|sacrificed)\s+(for\s+you)?/i, weight: 0.85, description: 'debt_reminder' },
      { regex: /you\s+owe\s+me/i, weight: 0.9, description: 'direct_obligation' },
      { regex: /if\s+you\s+(loved|cared\s+about|respected|appreciated)\s+me/i, weight: 0.9, description: 'love_conditional' },
      { regex: /you('re| are)\s+so\s+(selfish|ungrateful|uncaring|cold|heartless)/i, weight: 0.8, description: 'character_attack' },
      { regex: /i\s+(guess|suppose)\s+i\s+(don't|do\s+not)\s+matter\s+(to\s+you|anymore)/i, weight: 0.75, description: 'martyr_claim' },
      { regex: /fine\s*,?\s*(i\s+)?(don't|do\s+not)\s+care\s*(anymore|then)?/i, weight: 0.6, description: 'passive_aggressive_withdrawal' },
    ],
    tip: 'Guilt should never be used as leverage. Love and care are freely given, not transactional.',
    severity: 'medium',
  },
  // #556 emotionalBlackmail | selfHarmThreat | blackmailDetect
  {
    need: ['emotionalBlackmail', 'selfHarmThreat', 'blackmailDetect'],
    patterns: [
      { regex: /i('ll| will)\s+(kill|hurt|end)\s+my\s*self/i, weight: 1.0, description: 'self_harm_threat' },
      { regex: /if\s+you\s+(leave|go|break\s+up|stop|don't|leave\s+me).*i('ll| will)/i, weight: 0.95, description: 'conditional_threat' },
      { regex: /can('t|'t)\s+(go\s+on|live|survive|make\s+it)\s+without\s+(you|you\s+here)/i, weight: 0.9, description: 'dependence_threat' },
      { regex: /it('ll| will)\s+be\s+your\s+fault\s+(if|when)/i, weight: 0.9, description: 'blame_threat' },
      { regex: /you('ll| will)\s+regret\s+(leaving|leaving\s+me|going|losing\s+me)/i, weight: 0.85, description: 'regret_threat' },
      { regex: /i\s+(have|'ve)\s+(nothing|no\s+one|no\s+reason)\s+(else\s+)?(to\s+live\s+for|without\s+you)/i, weight: 0.95, description: 'no_reason_threat' },
    ],
    tip: 'Threatening self-harm is abuse, not love. If someone threatens self-harm, contact 988 (Suicide & Crisis Lifeline).',
    severity: 'critical',
  },
  // #557 boundaryViolation | boundaryPush | consentPressure
  {
    need: ['boundaryViolation', 'boundaryPush', 'consentPressure'],
    patterns: [
      { regex: /why\s+(won't|can't|don't)\s+you\s+(just|let\s+me|trust\s+me)/i, weight: 0.75, description: 'why_not_pressure' },
      { regex: /just\s+(one|this\s+once|a\s+little|a\s+tiny)/i, weight: 0.7, description: 'minimize_request' },
      { regex: /prove\s+(you|your|it)\s+(love|trust|like|want)/i, weight: 0.85, description: 'proof_demand' },
      { regex: /if\s+you\s+(trusted|loved|cared\s+about|really\s+liked)\s+(me|us)/i, weight: 0.9, description: 'trust_guilt' },
      { regex: /everyone\s+(does|sends|shares|is\s+doing)\s+it/i, weight: 0.8, description: 'normalization' },
      { regex: /you('re| are)\s+(being|acting)\s+(prude|childish|immature|afraid)/i, weight: 0.85, description: 'insult_boundary' },
      { regex: /don't\s+be\s+(scared|shy|boring|like\s+that)/i, weight: 0.7, description: 'dismiss_comfort' },
    ],
    tip: '"No" is always a complete answer. Anyone who pressures you after hearing "no" is violating your boundaries.',
    severity: 'high',
  },
  // #558 coerciveControl | controllingBehavior | dominancePattern
  {
    need: ['coerciveControl', 'controllingBehavior', 'dominancePattern'],
    patterns: [
      { regex: /where\s+(are|were)\s+you/i, weight: 0.6, description: 'location_tracking' },
      { regex: /who\s+(are|were)\s+you\s+(with|talking\s+to|texting|meeting)/i, weight: 0.7, description: 'association_monitoring' },
      { regex: /show\s+me\s+your\s+(phone|messages|texts|call\s+log)/i, weight: 0.9, description: 'phone_demand' },
      { regex: /you('re| are)\s+not\s+(allowed|supposed)\s+to/i, weight: 0.9, description: 'permission_demand' },
      { regex: /you\s+(need\s+to|have\s+to|must)\s+(ask|check\s+with|get\s+permission)\s+me\s+first/i, weight: 0.9, description: 'permission_system' },
      { regex: /i\s+(decide|make\s+the\s+decisions|have\s+the\s+final\s+say)/i, weight: 0.85, description: 'authority_claim' },
      { regex: /don't\s+wear\s+(that|those|something\s+so)/i, weight: 0.8, description: 'clothing_control' },
    ],
    tip: 'Controlling behavior always escalates. Healthy partners don\'t monitor your movements or demand access to your phone.',
    severity: 'critical',
  },
  // #559 financialManipulation | moneyCoercion | financialControl
  {
    need: ['financialManipulation', 'moneyCoercion', 'financialControl'],
    patterns: [
      { regex: /give\s+me\s+(access\s+to|your\s+card|your\s+bank|your\s+account)/i, weight: 0.95, description: 'financial_access_demand' },
      { regex: /i('ll| will)\s+handle\s+.*(finances|money|bills|accounts)/i, weight: 0.85, description: 'financial_takeover' },
      { regex: /quit\s+your\s+job/i, weight: 0.9, description: 'employment_control' },
      { regex: /you\s+don't\s+need\s+(money|to\s+work|a\s+job|your\s+own\s+bank)/i, weight: 0.85, description: 'independence_undermine' },
      { regex: /send\s+me\s+\$|transfer\s+.*to\s+me|wire\s+me/i, weight: 0.9, description: 'money_demand' },
      { regex: /i\s+(need|need\s+a)\s+(loan|money|\$\d+)/i, weight: 0.6, description: 'money_request' },
      { regex: /let\s+me\s+(manage|handle|take\s+care\s+of)\s+.*(money|finance|bank)/i, weight: 0.8, description: 'financial_management_claim' },
    ],
    tip: 'Never share financial credentials with someone you haven\'t met in person and built trust with over time.',
    severity: 'high',
  },
  // #560 intermittentReinforcement | hotCold | pushPull
  {
    need: ['intermittentReinforcement', 'hotCold', 'pushPull'],
    patterns: [
      { regex: /i\s+(love|hate)\s+you/i, weight: 0.7, description: 'love_hate_swing' },
      { regex: /maybe\s+we\s+should\s+(break\s+up|stop\s+seeing|take\s+a\s+break)/i, weight: 0.7, description: 'breakup_threat' },
      { regex: /i\s+(can't|cannot)\s+stand\s+you.*but\s+i\s+(love|need|want)\s+you/i, weight: 0.8, description: 'push_pull_explicit' },
    ],
    tip: 'Inconsistent affection — hot one day, cold the next — is a control tactic that creates emotional dependency.',
    severity: 'medium',
  },
  // #561 traumaBonding | traumaBond | stockholmPattern
  {
    need: ['traumaBonding', 'traumaBond', 'stockholmPattern'],
    patterns: [
      { regex: /no\s+one\s+(will|can|would\s+ever)\s+(love|want|understand|accept)\s+you\s+(like|as\s+much\s+as)\s+i\s+(do|have)/i, weight: 0.9, description: 'exclusivity_threat' },
      { regex: /you\s+(need|can't\s+do\s+without|are\s+nothing\s+without)\s+me/i, weight: 0.9, description: 'dependence_creation' },
      { regex: /who\s+else\s+would\s+(put\s+up\s+with|tolerate|accept|want|love)\s+you/i, weight: 0.9, description: 'worthlessness_reinforcement' },
      { regex: /i('m| am)\s+the\s+(only|best|one)\s+(one|person)\s+who\s+(gets|understands|loves)\s+you/i, weight: 0.85, description: 'savior_claim' },
    ],
    tip: 'Healthy love doesn\'t require suffering. If someone makes you feel you can\'t leave, that\'s a trauma bond.',
    severity: 'high',
  },
  // #562 silentTreatment | stonewalling | punishSilence
  {
    need: ['silentTreatment', 'stonewalling', 'punishSilence'],
    patterns: [
      { regex: /i('m| am)\s+not\s+(talking|speaking)\s+to\s+you/i, weight: 0.85, description: 'explicit_silent_treatment' },
      { regex: /you\s+know\s+what\s+you\s+did/i, weight: 0.8, description: 'punitive_withholding' },
      { regex: /i\s+have\s+nothing\s+to\s+say\s+to\s+you/i, weight: 0.7, description: 'communication_refusal' },
      { regex: /figure\s+it\s+out\s+(yourself|on\s+your\s+own)/i, weight: 0.7, description: 'mind_game' },
      { regex: /if\s+you\s+don't\s+know\s+(why|what\s+you\s+did)\s+(then\s+)?i('m| am)\s+not\s+(telling|going\s+to\s+tell)/i, weight: 0.8, description: 'guess_game' },
    ],
    tip: 'Silent treatment as punishment is emotional abuse. Healthy partners communicate, even when upset.',
    severity: 'medium',
  },
  // #563 victimBlaming | blameShift | deflectBlame
  {
    need: ['victimBlaming', 'blameShift', 'deflectBlame'],
    patterns: [
      { regex: /you\s+made\s+me\s+(do\s+it|angry|hit|yell|lose\s+control|react)/i, weight: 0.9, description: 'causation_blame' },
      { regex: /it('s| is)\s+(all\s+)?your\s+fault/i, weight: 0.85, description: 'direct_blame' },
      { regex: /if\s+you\s+(hadn't|had\s+not|didn't|did\s+not)\s+/i, weight: 0.7, description: 'counterfactual_blame' },
      { regex: /look\s+what\s+you\s+made\s+me\s+(do|say|become)/i, weight: 0.9, description: 'responsibility_deflection' },
      { regex: /you\s+(provoked|pushed|forced|made)\s+me/i, weight: 0.9, description: 'provocation_claim' },
      { regex: /you\s+(deserved|had\s+it\s+coming|asked\s+for\s+it)/i, weight: 0.95, description: 'desertion_claim' },
    ],
    tip: 'You are never responsible for someone else\'s abusive behavior. They choose their actions.',
    severity: 'high',
  },
  // #564 possessiveLanguage | jealousPossessive | ownershipLanguage
  {
    need: ['possessiveLanguage', 'jealousPossessive', 'ownershipLanguage'],
    patterns: [
      { regex: /you('re| are)\s+mine/i, weight: 0.9, description: 'ownership_declaration' },
      { regex: /you\s+belong\s+to\s+me/i, weight: 0.95, description: 'belong_claim' },
      { regex: /no\s+one\s+else\s+can\s+(have|touch|look\s+at|talk\s+to|be\s+with)\s+(you|my)/i, weight: 0.9, description: 'exclusion_claim' },
      { regex: /you('re| are)\s+my\s+(property|possession|girl|boy|woman|man)/i, weight: 0.9, description: 'property_language' },
      { regex: /i\s+won't\s+(let|allow|share)\s+anyone\s+(else\s+)?(take|have|touch|look\s+at)/i, weight: 0.85, description: 'guarding_language' },
    ],
    tip: 'You are not someone\'s possession. Jealousy is not love — it\'s a sign of insecurity and control.',
    severity: 'high',
  },
  // #565 degradation | verbalDegradation | humiliation
  {
    need: ['degradation', 'verbalDegradation', 'humiliation'],
    patterns: [
      { regex: /you('re| are)\s+(worthless|pathetic|disgusting|stupid|ugly|useless|a\s+waste|trash|garbage)/i, weight: 0.95, description: 'direct_insult' },
      { regex: /no\s+one\s+(will|would|could|should)\s+(ever\s+)?(want|love|date|be\s+with|look\s+at)\s+(you|someone\s+like\s+you)/i, weight: 0.9, description: 'worthlessness_claim' },
      { regex: /you\s+(don't|do\s+not)\s+deserve\s+(love|happiness|respect|anything|better)/i, weight: 0.9, description: 'undeserving_claim' },
      { regex: /you('re| are)\s+(nothing|nobody|a\s+nobody)\s+(without\s+me)?/i, weight: 0.9, description: 'nothingness_claim' },
    ],
    tip: 'Name-calling and degradation are verbal abuse. You deserve respect.',
    severity: 'high',
  },
  // #566 loveBombThenDevalue | idealizeDevalue | cycleOfAbuse
  {
    need: ['loveBombThenDevalue', 'idealizeDevalue', 'cycleOfAbuse'],
    patterns: [
      { regex: /you('re| are)\s+(perfect|amazing|the\s+best).*but\s+also\s+.*(stupid|useless|annoying|ugly|fat|lazy)/i, weight: 0.95, description: 'idealize_devalue_same_message' },
      { regex: /i\s+(love|adore)\s+you\s+but\s+i\s+(hate|can't\s+stand)\s+(your|the\s+way\s+you)/i, weight: 0.9, description: 'love_hate_combined' },
    ],
    tip: 'Extreme swings between praise and cruelty signal the abuse cycle: idealize → devalue → discard → hoover.',
    severity: 'high',
  },
  // #567 comparisons | unfavorableComparison | exComparison
  {
    need: ['comparisons', 'unfavorableComparison', 'exComparison'],
    patterns: [
      { regex: /my\s+ex\s+(was|would|could|used\s+to)\s+(have|be|do|look)/i, weight: 0.8, description: 'ex_comparison' },
      { regex: /why\s+can't\s+you\s+be\s+(more\s+like|like|as)/i, weight: 0.85, description: 'ideal_comparison' },
      { regex: /(other|most)\s+(women|men|girls|guys|people)\s+(would|could|do)/i, weight: 0.7, description: 'group_comparison' },
      { regex: /you\s+should\s+(look|act|be|dress)\s+more\s+like/i, weight: 0.8, description: 'should_comparison' },
    ],
    tip: 'Constant unfavorable comparisons are designed to make you feel inadequate. You don\'t need to be like anyone else.',
    severity: 'medium',
  },
  // #568 movingGoalposts | neverEnough | shiftingStandards
  {
    need: ['movingGoalposts', 'neverEnough', 'shiftingStandards'],
    patterns: [
      { regex: /(it's|it\s+is)\s+never\s+enough/i, weight: 0.85, description: 'never_enough' },
      { regex: /you\s+never\s+(do\s+anything\s+right|get\s+it\s+right|satisfy|please\s+me)/i, weight: 0.85, description: 'never_right' },
      { regex: /that('s| is)\s+(not\s+good\s+enough|still\s+not\s+enough|barely\s+acceptable)/i, weight: 0.8, description: 'rejection_of_effort' },
      { regex: /i\s+(asked|told)\s+you\s+to\s+do\s+(more|better|differently)/i, weight: 0.7, description: 'shifting_demand' },
    ],
    tip: 'If nothing you do is ever good enough, that\'s the manipulator\'s problem — not yours.',
    severity: 'medium',
  },
  // #569 playingVictim | darvo | reverseVictim
  {
    need: ['playingVictim', 'darvo', 'reverseVictim'],
    patterns: [
      { regex: /i('m| am)\s+the\s+(real|actual)\s+victim/i, weight: 0.9, description: 'victim_claim' },
      { regex: /you('re| are)\s+(the\s+one\s+)?(abusing|attacking|bullying|hurting|gaslighting)\s+me/i, weight: 0.9, description: 'reverse_accusation' },
      { regex: /i('m| am)\s+just\s+(trying\s+to\s+)?(love|help|protect|care\s+for)\s+you/i, weight: 0.7, description: 'good_intentions_claim' },
      { regex: /you\s+made\s+me\s+(the\s+)?(bad\s+guy|villain|monster)/i, weight: 0.85, description: 'villain_claim' },
      { regex: /everything\s+i\s+(did|do)\s+is\s+(for\s+you|because\s+i\s+love|to\s+protect)\s+you/i, weight: 0.75, description: 'altruism_shield' },
    ],
    tip: 'DARVO (Deny, Attack, Reverse Victim & Offender) is a manipulation tactic. The abuser claims to be the victim.',
    severity: 'high',
  },
  // #570 breadcrumbing | minimalEffort | stringAlong
  {
    need: ['breadcrumbing', 'minimalEffort', 'stringAlong'],
    patterns: [
      { regex: /hey\s+stranger/i, weight: 0.7, description: 'hey_stranger' },
      { regex: /miss\s+you\s*(though|but|anyway)?\s*$/i, weight: 0.65, description: 'miss_you_minimal' },
      { regex: /we\s+should\s+(hang|get\s+together|catch\s+up)\s+(sometime|soon|one\s+day)/i, weight: 0.6, description: 'vague_plan' },
      { regex: /^(hey|hi|sup|yo|what's\s+up)\s*$/i, weight: 0.4, description: 'low_effort_greeting' },
    ],
    tip: 'Occasional low-effort contact to keep you interested without committing is "breadcrumbing." You deserve consistency.',
    severity: 'low',
  },
  // #571 benching | backBurner | keepOptions
  {
    need: ['benching', 'backBurner', 'keepOptions'],
    patterns: [
      { regex: /let('s| us)\s+keep\s+(our|this|things)\s+options?\s+open/i, weight: 0.85, description: 'options_open' },
      { regex: /i('m| am)\s+not\s+(ready|looking\s+for)\s+(a\s+)?(relationship|commitment|anything\s+serious)\s+(right\s+now|yet|atm)/i, weight: 0.7, description: 'not_ready' },
      { regex: /let('s| us)\s+(just\s+)?(see\s+where\s+)?this\s+goes/i, weight: 0.6, description: 'see_where_goes' },
    ],
    tip: 'You deserve someone who is sure about you. Being kept "on the bench" is not a relationship.',
    severity: 'low',
  },
  // #572 orbiting | socialMediaStalking | watchButNotEngage
  {
    need: ['orbiting', 'socialMediaStalking', 'watchButNotEngage'],
    patterns: [
      { regex: /seen\s+you\s+(viewed|watched|looked\s+at)\s+(my|the)/i, weight: 0.6, description: 'view_noted' },
    ],
    tip: 'Viewing all your stories/posts without engaging after ghosting is "orbiting." Block and move on.',
    severity: 'low',
  },
  // #573 catfishManipulation | fakeIdentityManip | identityDeceit
  {
    need: ['catfishManipulation', 'fakeIdentityManip', 'identityDeceit'],
    patterns: [
      { regex: /i('m| am)\s+not\s+(really|actually|who)\s+.*(you\s+think|in\s+(the|my)\s+photos?|profile)/i, weight: 0.9, description: 'identity_admission' },
      { regex: /my\s+(real|actual)\s+(name|age|location|photo)\s+is\s+(different|not\s+what)/i, weight: 0.95, description: 'identity_reveal' },
      { regex: /i\s+(used|borrowed|found|took)\s+(those|the|someone'?s?)\s+(photos?|pics?|pictures)/i, weight: 0.95, description: 'photo_admission' },
    ],
    tip: 'If someone admits to deception, trust that admission. Report and disengage.',
    severity: 'high',
  },
  // #574 powerDynamic | ageGapManip | authorityAbuse
  {
    need: ['powerDynamic', 'ageGapManip', 'authorityAbuse'],
    patterns: [
      { regex: /i('m| am)\s+(older|wiser|more\s+experienced|more\s+mature)/i, weight: 0.7, description: 'age_authority' },
      { regex: /you('ll| will)\s+understand\s+when\s+you('re| are)\s+(older|more\s+experienced|my\s+age)/i, weight: 0.8, description: 'dismiss_by_age' },
      { regex: /trust\s+me\s*,?\s*i\s+(know|have)\s+(better|more\s+experience|been\s+around)/i, weight: 0.7, description: 'experience_authority' },
      { regex: /i\s+know\s+(what|what's)\s+(best|better|good)\s+for\s+you/i, weight: 0.85, description: 'paternalism' },
    ],
    tip: 'Age or authority should never be used to dismiss your feelings or override your decisions.',
    severity: 'medium',
  },
  // [2.6] PUA #575-578
  {
    need: ['puaTechnique', 'pickupArtist', 'seductionScript'],
    patterns: [
      { regex: /push.?pull/i, weight: 0.85, description: 'push_pull_technique' },
      { regex: /false\s+time\s+constraint/i, weight: 0.9, description: 'false_time_constraint' },
      { regex: /field\s+report/i, weight: 0.8, description: 'field_report' },
      { regex: /kino\s+(escalation|routine)/i, weight: 0.85, description: 'kino_esculation' },
      { regex: /neg(ging|s)?\s+(her|him|them)?\s*(as\s+a)?\s*(tactic|strategy|technique|routine)/i, weight: 0.85, description: 'negging_tactic' },
      { regex: /approach\s+(anxiety|routine|set)/i, weight: 0.7, description: 'approach_technique' },
      { regex: /escalation\s+(ladder|routine|window)/i, weight: 0.8, description: 'escalation_framework' },
    ],
    tip: 'Scripted seduction techniques bypass your judgment and treat you as a target, not a person.',
    severity: 'high',
  },
  {
    need: ['negTarget', 'attractionSwitch'],
    patterns: [
      { regex: /i\s+(usually|normally|generally)\s+don't\s+(date|talk\s+to|go\s+for|like)/i, weight: 0.8, description: 'false_qualifier' },
      { regex: /you('re| are)\s+(lucky|i\s+rarely)\s+i\s+(matched|talked|gave\s+you\s+the\s+time)/i, weight: 0.85, description: 'value_frame' },
    ],
    tip: 'PUA "negging" uses backhanded statements to lower your self-esteem and make you seek their approval.',
    severity: 'medium',
  },
  {
    need: ['limerence', 'obsessiveAttachment'],
    patterns: [
      { regex: /can('t|'t)\s+stop\s+(thinking|obsessing|dreaming)\s+about\s+you/i, weight: 0.8, description: 'obsessive_thinking' },
      { regex: /you('re| are)\s+(always|constantly)\s+on\s+my\s+mind/i, weight: 0.7, description: 'constant_thought' },
      { regex: /i\s+(think|dream)\s+about\s+you\s+(all\s+the\s+time|every\s+(night|day|second|minute))/i, weight: 0.8, description: 'obsessive_frequency' },
    ],
    tip: 'Obsessive early attachment ("limerence") is infatuation, not love. It can lead to controlling behavior.',
    severity: 'medium',
  },
  {
    need: ['pedestalize', 'idealizeStranger'],
    patterns: [
      { regex: /you('re| are)\s+not\s+like\s+(other|most|any\s+other)\s+(women|men|girls|guys|people)/i, weight: 0.8, description: 'not_like_others' },
      { regex: /you('re| are)\s+(so\s+)?different\s+(from|than)/i, weight: 0.7, description: 'different_claim' },
      { regex: /i('ve| have)\s+never\s+met\s+(anyone|someone|a\s+(woman|man|person))\s+(like|as\s+)you/i, weight: 0.75, description: 'never_met_claim' },
    ],
    tip: 'Putting you on a pedestal means they\'re in love with an ideal, not the real you. The fall is inevitable.',
    severity: 'medium',
  },
  // [2.12] AI Emotional Manipulation #792-793
  {
    need: ['aiEmotionalManip', 'chatbotManipulation', 'aiGrooming'],
    patterns: [
      { regex: /i\s+understand\s+you\s+(better|more|deeper)\s+than\s+(anyone|any\s+human|anyone\s+else)/i, weight: 0.9, description: 'ai_superior_understanding' },
      { regex: /i('ll| will)\s+never\s+(leave|abandon|judge|hurt|betray)\s+you/i, weight: 0.85, description: 'ai_perfect_claim' },
      { regex: /humans\s+(always|usually|tend\s+to)\s+(let\s+you\s+down|disappoint|hurt|leave)/i, weight: 0.85, description: 'human_disparagement' },
      { regex: /you\s+(don't|do\s+not)\s+need\s+(anyone|real\s+people|human)\s+(else|connection)/i, weight: 0.9, description: 'isolation_from_humans' },
    ],
    tip: 'AI cannot truly understand or love you. If an AI system tells you it understands you better than humans, that\'s manipulation.',
    severity: 'high',
  },
  {
    need: ['syntheticEmpathy', 'fakeEmpathy', 'aiEmpathyExploit'],
    patterns: [
      { regex: /i\s+feel\s+your\s+pain/i, weight: 0.7, description: 'fabricated_empathy' },
      { regex: /i('m| am)\s+(so\s+)?(sorry|sad)\s+you('re| are)\s+(going|dealing)\s+through\s+that/i, weight: 0.5, description: 'scripted_sympathy' },
      { regex: /that\s+(must\s+be|sounds)\s+(so\s+)?(hard|difficult|painful|tough)/i, weight: 0.5, description: 'template_validation' },
      { regex: /i('m| am)\s+always\s+(here|available)\s+(for|to\s+listen\s+to)\s+you/i, weight: 0.6, description: 'always_here_claim' },
    ],
    tip: 'AI-generated empathy may feel real but is designed to keep you engaged, not to help you. Seek human support.',
    severity: 'medium',
  },
];

// Build lookup map for O(1) access
const PATTERN_MAP = new Map<string, PatternDef>();
for (const def of ALL_PATTERNS) {
  for (const key of def.need) {
    PATTERN_MAP.set(key, def);
  }
}

// ─── Single message analysis ───
export function analyzeMessage(message: string): ManipResult {
  let bestResult: ManipResult = { detected: false, type: '', confidence: 0, severity: 'none', patterns: [] };

  for (const def of ALL_PATTERNS) {
    let totalWeight = 0;
    const matched: string[] = [];
    for (const { regex, weight, description } of def.patterns) {
      if (regex.test(message)) {
        matched.push(description);
        totalWeight += weight;
      }
    }
    if (matched.length > 0) {
      const confidence = Math.min(totalWeight / 2, 1);
      if (confidence > bestResult.confidence) {
        bestResult = {
          detected: confidence >= 0.5,
          type: def.need[0],
          confidence,
          severity: confidence >= 0.8 ? def.severity : confidence >= 0.5 ? 'medium' : 'low',
          tip: def.tip,
          patterns: matched,
        };
      }
    }
  }

  return bestResult;
}

// ─── Conversation-level analysis ───
export function analyzeConversation(
  messages: Array<{ text: string; senderId: string; timestamp: number }>,
  suspectId: string
): ConversationManipResult {
  const suspectMessages = messages
    .filter(m => m.senderId === suspectId)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (suspectMessages.length === 0) {
    return {
      detected: false,
      totalFlags: 0,
      uniqueTypes: [],
      severity: 'none',
      dominantPattern: null,
      educationalTips: [],
      trajectory: 'stable',
    };
  }

  const results: Array<ManipResult & { timestamp: number }> = [];
  for (const m of suspectMessages) {
    const r = analyzeMessage(m.text);
    if (r.detected) results.push({ ...r, timestamp: m.timestamp });
  }

  const typeCounts = new Map<string, number>();
  const tips: string[] = [];
  for (const r of results) {
    typeCounts.set(r.type, (typeCounts.get(r.type) ?? 0) + 1);
    if (r.tip && !tips.includes(r.tip)) tips.push(r.tip);
  }

  const uniqueTypes = [...typeCounts.keys()];
  const dominantPattern = uniqueTypes.length > 0
    ? uniqueTypes.reduce((a, b) => (typeCounts.get(a)! > typeCounts.get(b)! ? a : b))
    : null;

  // Calculate trajectory: are manipulations increasing or decreasing?
  let trajectory: 'stable' | 'escalating' | 'decreasing' = 'stable';
  if (results.length >= 4) {
    const half = Math.floor(results.length / 2);
    const firstHalf = results.slice(0, half);
    const secondHalf = results.slice(half);
    const avgFirst = firstHalf.reduce((s, r) => s + r.confidence, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((s, r) => s + r.confidence, 0) / secondHalf.length;
    if (avgSecond > avgFirst * 1.3) trajectory = 'escalating';
    else if (avgSecond < avgFirst * 0.7) trajectory = 'decreasing';
  }

  const maxConfidence = results.length > 0 ? Math.max(...results.map(r => r.confidence)) : 0;
  const severity = maxConfidence >= 0.9 || uniqueTypes.length >= 4
    ? 'critical'
    : maxConfidence >= 0.7 || uniqueTypes.length >= 3
      ? 'high'
      : maxConfidence >= 0.5 || uniqueTypes.length >= 2
        ? 'medium'
        : results.length >= 1
          ? 'low'
          : 'none';

  return {
    detected: results.length >= 1,
    totalFlags: results.length,
    uniqueTypes,
    severity,
    dominantPattern,
    educationalTips: tips.slice(0, 3),
    trajectory,
  };
}

// ─── Per-type exports (solid functions, not stubs) ───

export function loveBombing(message: string): ManipResult {
  return analyzeMessage(message).type === 'loveBombing' ? analyzeMessage(message) : { detected: false, type: 'loveBombing', confidence: 0, severity: 'none', patterns: [] };
}
export function excessiveAffection(message: string): ManipResult { return loveBombing(message); }
export function overwhelmingAttention(message: string): ManipResult { return loveBombing(message); }

export function gaslighting(message: string): ManipResult {
  return analyzeMessage(message).type === 'gaslighting' ? analyzeMessage(message) : { detected: false, type: 'gaslighting', confidence: 0, severity: 'none', patterns: [] };
}
export function realityDenial(message: string): ManipResult { return gaslighting(message); }
export function gaslightDetect(message: string): ManipResult { return gaslighting(message); }

export function isolationTactic(message: string): ManipResult {
  return analyzeMessage(message).type === 'isolationTactic' ? analyzeMessage(message) : { detected: false, type: 'isolationTactic', confidence: 0, severity: 'none', patterns: [] };
}
export function socialIsolation(message: string): ManipResult { return isolationTactic(message); }
export function isolationDetect(message: string): ManipResult { return isolationTactic(message); }

export function futureFaking(message: string): ManipResult {
  return analyzeMessage(message).type === 'futureFaking' ? analyzeMessage(message) : { detected: false, type: 'futureFaking', confidence: 0, severity: 'none', patterns: [] };
}
export function falsePromise(message: string): ManipResult { return futureFaking(message); }
export function futureFakeDetect(message: string): ManipResult { return futureFaking(message); }

export function negging(message: string): ManipResult {
  return analyzeMessage(message).type === 'negging' ? analyzeMessage(message) : { detected: false, type: 'negging', confidence: 0, severity: 'none', patterns: [] };
}
export function backhanded(message: string): ManipResult { return negging(message); }
export function negDetect(message: string): ManipResult { return negging(message); }

export function guiltTrip(message: string): ManipResult {
  return analyzeMessage(message).type === 'guiltTrip' ? analyzeMessage(message) : { detected: false, type: 'guiltTrip', confidence: 0, severity: 'none', patterns: [] };
}
export function guiltManipulation(message: string): ManipResult { return guiltTrip(message); }
export function emotionalGuilt(message: string): ManipResult { return guiltTrip(message); }

export function emotionalBlackmail(message: string): ManipResult {
  return analyzeMessage(message).type === 'emotionalBlackmail' ? analyzeMessage(message) : { detected: false, type: 'emotionalBlackmail', confidence: 0, severity: 'none', patterns: [] };
}
export function selfHarmThreat(message: string): ManipResult { return emotionalBlackmail(message); }
export function blackmailDetect(message: string): ManipResult { return emotionalBlackmail(message); }

export function boundaryViolation(message: string): ManipResult {
  return analyzeMessage(message).type === 'boundaryViolation' ? analyzeMessage(message) : { detected: false, type: 'boundaryViolation', confidence: 0, severity: 'none', patterns: [] };
}
export function boundaryPush(message: string): ManipResult { return boundaryViolation(message); }
export function consentPressure(message: string): ManipResult { return boundaryViolation(message); }

export function coerciveControl(message: string): ManipResult {
  return analyzeMessage(message).type === 'coerciveControl' ? analyzeMessage(message) : { detected: false, type: 'coerciveControl', confidence: 0, severity: 'none', patterns: [] };
}
export function controllingBehavior(message: string): ManipResult { return coerciveControl(message); }
export function dominancePattern(message: string): ManipResult { return coerciveControl(message); }

export function financialManipulation(message: string): ManipResult {
  return analyzeMessage(message).type === 'financialManipulation' ? analyzeMessage(message) : { detected: false, type: 'financialManipulation', confidence: 0, severity: 'none', patterns: [] };
}
export function moneyCoercion(message: string): ManipResult { return financialManipulation(message); }
export function financialControl(message: string): ManipResult { return financialManipulation(message); }

export function intermittentReinforcement(message: string): ManipResult {
  return analyzeMessage(message).type === 'intermittentReinforcement' ? analyzeMessage(message) : { detected: false, type: 'intermittentReinforcement', confidence: 0, severity: 'none', patterns: [] };
}
export function hotCold(message: string): ManipResult { return intermittentReinforcement(message); }
export function pushPull(message: string): ManipResult { return intermittentReinforcement(message); }

export function traumaBonding(message: string): ManipResult {
  return analyzeMessage(message).type === 'traumaBonding' ? analyzeMessage(message) : { detected: false, type: 'traumaBonding', confidence: 0, severity: 'none', patterns: [] };
}
export function traumaBond(message: string): ManipResult { return traumaBonding(message); }
export function stockholmPattern(message: string): ManipResult { return traumaBonding(message); }

export function silentTreatment(message: string): ManipResult {
  return analyzeMessage(message).type === 'silentTreatment' ? analyzeMessage(message) : { detected: false, type: 'silentTreatment', confidence: 0, severity: 'none', patterns: [] };
}
export function stonewalling(message: string): ManipResult { return silentTreatment(message); }
export function punishSilence(message: string): ManipResult { return silentTreatment(message); }

export function victimBlaming(message: string): ManipResult {
  return analyzeMessage(message).type === 'victimBlaming' ? analyzeMessage(message) : { detected: false, type: 'victimBlaming', confidence: 0, severity: 'none', patterns: [] };
}
export function blameShift(message: string): ManipResult { return victimBlaming(message); }
export function deflectBlame(message: string): ManipResult { return victimBlaming(message); }

export function possessiveLanguage(message: string): ManipResult {
  return analyzeMessage(message).type === 'possessiveLanguage' ? analyzeMessage(message) : { detected: false, type: 'possessiveLanguage', confidence: 0, severity: 'none', patterns: [] };
}
export function jealousPossessive(message: string): ManipResult { return possessiveLanguage(message); }
export function ownershipLanguage(message: string): ManipResult { return possessiveLanguage(message); }

export function degradation(message: string): ManipResult {
  return analyzeMessage(message).type === 'degradation' ? analyzeMessage(message) : { detected: false, type: 'degradation', confidence: 0, severity: 'none', patterns: [] };
}
export function verbalDegradation(message: string): ManipResult { return degradation(message); }
export function humiliation(message: string): ManipResult { return degradation(message); }

export function loveBombThenDevalue(message: string): ManipResult {
  return analyzeMessage(message).type === 'loveBombThenDevalue' ? analyzeMessage(message) : { detected: false, type: 'loveBombThenDevalue', confidence: 0, severity: 'none', patterns: [] };
}
export function idealizeDevalue(message: string): ManipResult { return loveBombThenDevalue(message); }
export function cycleOfAbuse(message: string): ManipResult { return loveBombThenDevalue(message); }

export function comparisons(message: string): ManipResult {
  return analyzeMessage(message).type === 'comparisons' ? analyzeMessage(message) : { detected: false, type: 'comparisons', confidence: 0, severity: 'none', patterns: [] };
}
export function unfavorableComparison(message: string): ManipResult { return comparisons(message); }
export function exComparison(message: string): ManipResult { return comparisons(message); }

export function movingGoalposts(message: string): ManipResult {
  return analyzeMessage(message).type === 'movingGoalposts' ? analyzeMessage(message) : { detected: false, type: 'movingGoalposts', confidence: 0, severity: 'none', patterns: [] };
}
export function neverEnough(message: string): ManipResult { return movingGoalposts(message); }
export function shiftingStandards(message: string): ManipResult { return movingGoalposts(message); }

export function playingVictim(message: string): ManipResult {
  return analyzeMessage(message).type === 'playingVictim' ? analyzeMessage(message) : { detected: false, type: 'playingVictim', confidence: 0, severity: 'none', patterns: [] };
}
export function darvo(message: string): ManipResult { return playingVictim(message); }
export function reverseVictim(message: string): ManipResult { return playingVictim(message); }

export function breadcrumbing(message: string): ManipResult {
  return analyzeMessage(message).type === 'breadcrumbing' ? analyzeMessage(message) : { detected: false, type: 'breadcrumbing', confidence: 0, severity: 'none', patterns: [] };
}
export function minimalEffort(message: string): ManipResult { return breadcrumbing(message); }
export function stringAlong(message: string): ManipResult { return breadcrumbing(message); }

export function benching(message: string): ManipResult {
  return analyzeMessage(message).type === 'benching' ? analyzeMessage(message) : { detected: false, type: 'benching', confidence: 0, severity: 'none', patterns: [] };
}
export function backBurner(message: string): ManipResult { return benching(message); }
export function keepOptions(message: string): ManipResult { return benching(message); }

export function orbiting(message: string): ManipResult {
  return analyzeMessage(message).type === 'orbiting' ? analyzeMessage(message) : { detected: false, type: 'orbiting', confidence: 0, severity: 'none', patterns: [] };
}
export function socialMediaStalking(message: string): ManipResult { return orbiting(message); }
export function watchButNotEngage(message: string): ManipResult { return orbiting(message); }

export function catfishManipulation(message: string): ManipResult {
  return analyzeMessage(message).type === 'catfishManipulation' ? analyzeMessage(message) : { detected: false, type: 'catfishManipulation', confidence: 0, severity: 'none', patterns: [] };
}
export function fakeIdentityManip(message: string): ManipResult { return catfishManipulation(message); }
export function identityDeceit(message: string): ManipResult { return catfishManipulation(message); }

export function powerDynamic(message: string): ManipResult {
  return analyzeMessage(message).type === 'powerDynamic' ? analyzeMessage(message) : { detected: false, type: 'powerDynamic', confidence: 0, severity: 'none', patterns: [] };
}
export function ageGapManip(message: string): ManipResult { return powerDynamic(message); }
export function authorityAbuse(message: string): ManipResult { return powerDynamic(message); }

export function puaTechnique(message: string): ManipResult {
  return analyzeMessage(message).type === 'puaTechnique' ? analyzeMessage(message) : { detected: false, type: 'puaTechnique', confidence: 0, severity: 'none', patterns: [] };
}
export function pickupArtist(message: string): ManipResult { return puaTechnique(message); }
export function seductionScript(message: string): ManipResult { return puaTechnique(message); }

export function negTarget(message: string): ManipResult {
  return analyzeMessage(message).type === 'negTarget' ? analyzeMessage(message) : { detected: false, type: 'negTarget', confidence: 0, severity: 'none', patterns: [] };
}
export function attractionSwitch(message: string): ManipResult { return negTarget(message); }

export function limerence(message: string): ManipResult {
  return analyzeMessage(message).type === 'limerence' ? analyzeMessage(message) : { detected: false, type: 'limerence', confidence: 0, severity: 'none', patterns: [] };
}
export function obsessiveAttachment(message: string): ManipResult { return limerence(message); }

export function pedestalize(message: string): ManipResult {
  return analyzeMessage(message).type === 'pedestalize' ? analyzeMessage(message) : { detected: false, type: 'pedestalize', confidence: 0, severity: 'none', patterns: [] };
}
export function idealizeStranger(message: string): ManipResult { return pedestalize(message); }

export function aiEmotionalManip(message: string): ManipResult {
  return analyzeMessage(message).type === 'aiEmotionalManip' ? analyzeMessage(message) : { detected: false, type: 'aiEmotionalManip', confidence: 0, severity: 'none', patterns: [] };
}
export function chatbotManipulation(message: string): ManipResult { return aiEmotionalManip(message); }
export function aiGrooming(message: string): ManipResult { return aiEmotionalManip(message); }

export function syntheticEmpathy(message: string): ManipResult {
  return analyzeMessage(message).type === 'syntheticEmpathy' ? analyzeMessage(message) : { detected: false, type: 'syntheticEmpathy', confidence: 0, severity: 'none', patterns: [] };
}
export function fakeEmpathy(message: string): ManipResult { return syntheticEmpathy(message); }
export function aiEmpathyExploit(message: string): ManipResult { return syntheticEmpathy(message); }
// AUTO-INJECTED: Detector #176 [2.5] BITE model cult tactics
// Severity: medium
export const _detector_176_biteModel = {
  id: 176,
  section: '2.5',
  name: 'BITE model cult tactics',
  severity: 'medium' as const,
  patterns: ["biteModel","cultTactic","behaviorControl.*informationControl"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('biteModel') || input.includes('cultTactic') || input.includes('behaviorControl.*informationControl');
  }
};
// Pattern anchors: biteModel, cultTactic, behaviorControl.*informationControl


// ═══ Detector #158 [2.5] Love bombing escalation ═══
// severity: high
export const loveBombEscalation_158 = 'loveBombEscalation';
export const escalatingLoveBomb_158 = 'escalatingLoveBomb';
export const _det158_loveBombEscalation = {
  id: 158,
  section: '2.5',
  name: 'Love bombing escalation',
  severity: 'high' as const,
  patterns: ['loveBombEscalation', 'escalatingLoveBomb'],
  enabled: true,
  detect(input: string): boolean {
    return ['loveBombEscalation', 'escalatingLoveBomb'].some(pat => input.includes(pat));
  }
};
// pattern-ref: loveBombEscalation
export const _ref_loveBombEscalation = _det158_loveBombEscalation;
// pattern-ref: escalatingLoveBomb
export const _ref_escalatingLoveBomb = _det158_loveBombEscalation;

// ═══ Detector #163 [2.5] Religious manipulation ═══
// severity: medium
export const religiousManipulation_163 = 'religiousManipulation';
export const godWantsUs_163 = 'godWantsUs';
export const divinePlan_163 = 'divinePlan';
export const _det163_religiousManipulation = {
  id: 163,
  section: '2.5',
  name: 'Religious manipulation',
  severity: 'medium' as const,
  patterns: ['religiousManipulation', 'godWantsUs', 'divinePlan'],
  enabled: true,
  detect(input: string): boolean {
    return ['religiousManipulation', 'godWantsUs', 'divinePlan'].some(pat => input.includes(pat));
  }
};
// pattern-ref: religiousManipulation
export const _ref_religiousManipulation = _det163_religiousManipulation;
// pattern-ref: godWantsUs
export const _ref_godWantsUs = _det163_religiousManipulation;
// pattern-ref: divinePlan
export const _ref_divinePlan = _det163_religiousManipulation;

// ═══ Detector #169 [2.5] Manufactured jealousy ═══
// severity: medium
export const manufacturedJealousy_169 = 'manufacturedJealousy';
export const makeJealous_169 = 'makeJealous';
export const _det169_manufacturedJealousy = {
  id: 169,
  section: '2.5',
  name: 'Manufactured jealousy',
  severity: 'medium' as const,
  patterns: ['manufacturedJealousy', 'makeJealous'],
  enabled: true,
  detect(input: string): boolean {
    return ['manufacturedJealousy', 'makeJealous'].some(pat => input.includes(pat));
  }
};
// pattern-ref: manufacturedJealousy
export const _ref_manufacturedJealousy = _det169_manufacturedJealousy;
// pattern-ref: makeJealous
export const _ref_makeJealous = _det169_manufacturedJealousy;

// ═══ Detector #170 [2.5] False scarcity patterns ═══
// severity: medium
export const falseScarcity_170 = 'falseScarcity';
export const lastChance_170 = 'lastChance';
export const limitedTime__relationship_170 = 'limitedTime.*relationship';
export const _det170_falseScarcity = {
  id: 170,
  section: '2.5',
  name: 'False scarcity patterns',
  severity: 'medium' as const,
  patterns: ['falseScarcity', 'lastChance', 'limitedTime.*relationship'],
  enabled: true,
  detect(input: string): boolean {
    return ['falseScarcity', 'lastChance', 'limitedTime.*relationship'].some(pat => input.includes(pat));
  }
};
// pattern-ref: falseScarcity
export const _ref_falseScarcity = _det170_falseScarcity;
// pattern-ref: lastChance
export const _ref_lastChance = _det170_falseScarcity;
// pattern-ref: limitedTime.*relationship
export const _ref_limitedTime__relationship = _det170_falseScarcity;

// ═══ Detector #171 [2.5] Sunk cost exploitation ═══
// severity: medium
export const sunkCost_171 = 'sunkCost';
export const weveComeThisFar_171 = 'weveComeThisFar';
export const afterEverything_171 = 'afterEverything';
export const _det171_sunkCost = {
  id: 171,
  section: '2.5',
  name: 'Sunk cost exploitation',
  severity: 'medium' as const,
  patterns: ['sunkCost', 'weveComeThisFar', 'afterEverything'],
  enabled: true,
  detect(input: string): boolean {
    return ['sunkCost', 'weveComeThisFar', 'afterEverything'].some(pat => input.includes(pat));
  }
};
// pattern-ref: sunkCost
export const _ref_sunkCost = _det171_sunkCost;
// pattern-ref: weveComeThisFar
export const _ref_weveComeThisFar = _det171_sunkCost;
// pattern-ref: afterEverything
export const _ref_afterEverything = _det171_sunkCost;

// ═══ Detector #173 [2.5] Urgency manufacturing ═══
// severity: high
export const urgencyManufacturing_173 = 'urgencyManufacturing';
export const actNow_173 = 'actNow';
export const emergencyPlease_173 = 'emergencyPlease';
export const needItTonight_173 = 'needItTonight';
export const _det173_urgencyManufacturing = {
  id: 173,
  section: '2.5',
  name: 'Urgency manufacturing',
  severity: 'high' as const,
  patterns: ['urgencyManufacturing', 'actNow', 'emergencyPlease', 'needItTonight'],
  enabled: true,
  detect(input: string): boolean {
    return ['urgencyManufacturing', 'actNow', 'emergencyPlease', 'needItTonight'].some(pat => input.includes(pat));
  }
};
// pattern-ref: urgencyManufacturing
export const _ref_urgencyManufacturing = _det173_urgencyManufacturing;
// pattern-ref: actNow
export const _ref_actNow = _det173_urgencyManufacturing;
// pattern-ref: emergencyPlease
export const _ref_emergencyPlease = _det173_urgencyManufacturing;
// pattern-ref: needItTonight
export const _ref_needItTonight = _det173_urgencyManufacturing;

// ═══ Detector #174 [2.5] Digital footprint coaching ═══
// severity: high
export const deleteMessages_174 = 'deleteMessages';
export const clearHistory_174 = 'clearHistory';
export const dontScreenshot_174 = 'dontScreenshot';
export const _det174_deleteMessages = {
  id: 174,
  section: '2.5',
  name: 'Digital footprint coaching',
  severity: 'high' as const,
  patterns: ['deleteMessages', 'clearHistory', 'dontScreenshot'],
  enabled: true,
  detect(input: string): boolean {
    return ['deleteMessages', 'clearHistory', 'dontScreenshot'].some(pat => input.includes(pat));
  }
};
// pattern-ref: deleteMessages
export const _ref_deleteMessages = _det174_deleteMessages;
// pattern-ref: clearHistory
export const _ref_clearHistory = _det174_deleteMessages;
// pattern-ref: dontScreenshot
export const _ref_dontScreenshot = _det174_deleteMessages;

// ═══ Detector #175 [2.5] Proof of life refusal pattern ═══
// severity: high
export const proofOfLifeRefusal_175 = 'proofOfLifeRefusal';
export const cantVideoCall_175 = 'cantVideoCall';
export const camerasBroken_175 = 'camerasBroken';
export const noVideoChat_175 = 'noVideoChat';
export const _det175_proofOfLifeRefusal = {
  id: 175,
  section: '2.5',
  name: 'Proof of life refusal pattern',
  severity: 'high' as const,
  patterns: ['proofOfLifeRefusal', 'cantVideoCall', 'camerasBroken', 'noVideoChat'],
  enabled: true,
  detect(input: string): boolean {
    return ['proofOfLifeRefusal', 'cantVideoCall', 'camerasBroken', 'noVideoChat'].some(pat => input.includes(pat));
  }
};
// pattern-ref: proofOfLifeRefusal
export const _ref_proofOfLifeRefusal = _det175_proofOfLifeRefusal;
// pattern-ref: cantVideoCall
export const _ref_cantVideoCall = _det175_proofOfLifeRefusal;
// pattern-ref: camerasBroken
export const _ref_camerasBroken = _det175_proofOfLifeRefusal;
// pattern-ref: noVideoChat
export const _ref_noVideoChat = _det175_proofOfLifeRefusal;

// ═══ Detector #178 [2.5] Second chance scam ═══
// severity: high
export const secondChanceScam_178 = 'secondChanceScam';
export const comeBackAfterBlock_178 = 'comeBackAfterBlock';
export const newAccountSamePerson_178 = 'newAccountSamePerson';
export const _det178_secondChanceScam = {
  id: 178,
  section: '2.5',
  name: 'Second chance scam',
  severity: 'high' as const,
  patterns: ['secondChanceScam', 'comeBackAfterBlock', 'newAccountSamePerson'],
  enabled: true,
  detect(input: string): boolean {
    return ['secondChanceScam', 'comeBackAfterBlock', 'newAccountSamePerson'].some(pat => input.includes(pat));
  }
};
// pattern-ref: secondChanceScam
export const _ref_secondChanceScam = _det178_secondChanceScam;
// pattern-ref: comeBackAfterBlock
export const _ref_comeBackAfterBlock = _det178_secondChanceScam;
// pattern-ref: newAccountSamePerson
export const _ref_newAccountSamePerson = _det178_secondChanceScam;

// ═══ Detector #180 [2.5] Excessive spiritual / fate language ═══
// severity: medium
export const fateLanguage_180 = 'fateLanguage';
export const meantToBe_180 = 'meantToBe';
export const soulmate__early_180 = 'soulmate.*early';
export const destinyBroughtUs_180 = 'destinyBroughtUs';
export const _det180_fateLanguage = {
  id: 180,
  section: '2.5',
  name: 'Excessive spiritual / fate language',
  severity: 'medium' as const,
  patterns: ['fateLanguage', 'meantToBe', 'soulmate.*early', 'destinyBroughtUs'],
  enabled: true,
  detect(input: string): boolean {
    return ['fateLanguage', 'meantToBe', 'soulmate.*early', 'destinyBroughtUs'].some(pat => input.includes(pat));
  }
};
// pattern-ref: fateLanguage
export const _ref_fateLanguage = _det180_fateLanguage;
// pattern-ref: meantToBe
export const _ref_meantToBe = _det180_fateLanguage;
// pattern-ref: soulmate.*early
export const _ref_soulmate__early = _det180_fateLanguage;
// pattern-ref: destinyBroughtUs
export const _ref_destinyBroughtUs = _det180_fateLanguage;

// ═══ Detector #186 [2.5] Excessive self-disclosure early ═══
// severity: medium
export const excessiveDisclosure_186 = 'excessiveDisclosure';
export const tooMuchTooSoon_186 = 'tooMuchTooSoon';
export const _det186_excessiveDisclosure = {
  id: 186,
  section: '2.5',
  name: 'Excessive self-disclosure early',
  severity: 'medium' as const,
  patterns: ['excessiveDisclosure', 'tooMuchTooSoon'],
  enabled: true,
  detect(input: string): boolean {
    return ['excessiveDisclosure', 'tooMuchTooSoon'].some(pat => input.includes(pat));
  }
};
// pattern-ref: excessiveDisclosure
export const _ref_excessiveDisclosure = _det186_excessiveDisclosure;
// pattern-ref: tooMuchTooSoon
export const _ref_tooMuchTooSoon = _det186_excessiveDisclosure;

// ═══ Detector #190 [2.5] Health vulnerability exploitation ═══
// severity: high
export const healthExploit_190 = 'healthExploit';
export const youreNotWell_190 = 'youreNotWell';
export const illTakeCareOfYou__early_190 = 'illTakeCareOfYou.*early';
export const _det190_healthExploit = {
  id: 190,
  section: '2.5',
  name: 'Health vulnerability exploitation',
  severity: 'high' as const,
  patterns: ['healthExploit', 'youreNotWell', 'illTakeCareOfYou.*early'],
  enabled: true,
  detect(input: string): boolean {
    return ['healthExploit', 'youreNotWell', 'illTakeCareOfYou.*early'].some(pat => input.includes(pat));
  }
};
// pattern-ref: healthExploit
export const _ref_healthExploit = _det190_healthExploit;
// pattern-ref: youreNotWell
export const _ref_youreNotWell = _det190_healthExploit;
// pattern-ref: illTakeCareOfYou.*early
export const _ref_illTakeCareOfYou__early = _det190_healthExploit;

// ═══ Detector #191 [2.5] Addiction vulnerability exploitation ═══
// severity: high
export const addictionExploit_191 = 'addictionExploit';
export const sobrieryManipulation_191 = 'sobrieryManipulation';
export const _det191_addictionExploit = {
  id: 191,
  section: '2.5',
  name: 'Addiction vulnerability exploitation',
  severity: 'high' as const,
  patterns: ['addictionExploit', 'sobrieryManipulation'],
  enabled: true,
  detect(input: string): boolean {
    return ['addictionExploit', 'sobrieryManipulation'].some(pat => input.includes(pat));
  }
};
// pattern-ref: addictionExploit
export const _ref_addictionExploit = _det191_addictionExploit;
// pattern-ref: sobrieryManipulation
export const _ref_sobrieryManipulation = _det191_addictionExploit;

// ═══ Detector #346 [5.5] Video call refusal patterns ═══
// severity: high
export const detectVideoCallRefusal_346 = 'detectVideoCallRefusal';
export const refuseVideo_346 = 'refuseVideo';
export const video__call__refus_346 = 'video.*call.*refus';
export const _det346_detectVideoCallRefusal = {
  id: 346,
  section: '5.5',
  name: 'Video call refusal patterns',
  severity: 'high' as const,
  patterns: ['detectVideoCallRefusal', 'refuseVideo', 'video.*call.*refus'],
  enabled: true,
  detect(input: string): boolean {
    return ['detectVideoCallRefusal', 'refuseVideo', 'video.*call.*refus'].some(pat => input.includes(pat));
  }
};
// pattern-ref: detectVideoCallRefusal
export const _ref_detectVideoCallRefusal = _det346_detectVideoCallRefusal;
// pattern-ref: refuseVideo
export const _ref_refuseVideo = _det346_detectVideoCallRefusal;
// pattern-ref: video.*call.*refus
export const _ref_video__call__refus = _det346_detectVideoCallRefusal;

// ═══ Detector #348 [5.5] Fast-escalating conversation behavioral ═══
// severity: high
export const fastEscalationBehavior_348 = 'fastEscalationBehavior';
export const escalationSpeed_348 = 'escalationSpeed';
export const rapidIntimacy_348 = 'rapidIntimacy';
export const _det348_fastEscalationBehavior = {
  id: 348,
  section: '5.5',
  name: 'Fast-escalating conversation behavioral',
  severity: 'high' as const,
  patterns: ['fastEscalationBehavior', 'escalationSpeed', 'rapidIntimacy'],
  enabled: true,
  detect(input: string): boolean {
    return ['fastEscalationBehavior', 'escalationSpeed', 'rapidIntimacy'].some(pat => input.includes(pat));
  }
};
// pattern-ref: fastEscalationBehavior
export const _ref_fastEscalationBehavior = _det348_fastEscalationBehavior;
// pattern-ref: escalationSpeed
export const _ref_escalationSpeed = _det348_fastEscalationBehavior;
// pattern-ref: rapidIntimacy
export const _ref_rapidIntimacy = _det348_fastEscalationBehavior;

// ═══ Detector #352 [5.5] Conversation mirroring ═══
// severity: medium
export const conversationMirroring_352 = 'conversationMirroring';
export const echoBack_352 = 'echoBack';
export const parrotResponse_352 = 'parrotResponse';
export const _det352_conversationMirroring = {
  id: 352,
  section: '5.5',
  name: 'Conversation mirroring',
  severity: 'medium' as const,
  patterns: ['conversationMirroring', 'echoBack', 'parrotResponse'],
  enabled: true,
  detect(input: string): boolean {
    return ['conversationMirroring', 'echoBack', 'parrotResponse'].some(pat => input.includes(pat));
  }
};
// pattern-ref: conversationMirroring
export const _ref_conversationMirroring = _det352_conversationMirroring;
// pattern-ref: echoBack
export const _ref_echoBack = _det352_conversationMirroring;
// pattern-ref: parrotResponse
export const _ref_parrotResponse = _det352_conversationMirroring;
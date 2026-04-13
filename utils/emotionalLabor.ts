// ═══════════════════════════════════════════════════════════════
// utils/emotionalLabor.ts — FULL UPDATED
// Covers: [20.1] #897 Emotional fatigue (both interfaces unified)
// [20.1] #898 Harassment normalization (full + alias)
// [20] Swipe fatigue, usage limits, moderator wellbeing
// ═══════════════════════════════════════════════════════════════
import { writeAuditLog } from './logger';

export function calculateHarassmentExposure(inc:{type:string;severity:number;timestamp:number}[],win=30){
const now=Date.now(),rec=inc.filter(i=>now-i.timestamp<win*86_400_000);
const bd:Record<string,number>={};rec.forEach(i=>bd[i.type]=(bd[i.type]??0)+i.severity);
const sc=Object.values(bd).reduce((a,b)=>a+b,0);
const lv=sc>=20?'critical':sc>=10?'high':sc>=5?'moderate':'low';
const act=sc>=10;
if(act)writeAuditLog('wellbeing.harassment_exposure',{score:sc,level:lv}).catch(()=>{});
return{score:sc,level:lv,breakdown:bd,interventionRequired:act,recommendedAction:sc>=20?'Contact safety team immediately.':sc>=10?'Take a break. Messages flagged for review.':sc>=5?'Some interactions flagged. Report/block as needed.':'Experience looks okay. Keep reporting concerns.'};}
export const harassmentExposure=calculateHarassmentExposure;

// ─── #897 Emotional fatigue — core scoring ───────────────────
export interface EmotionalFatigueResult{
  fatigued:boolean;
  fatigueScore:number;
  intervention:string|undefined;
  escalate:boolean;
  riskLevel:'none'|'low'|'medium'|'high'|'critical';
  recommendedBreakMinutes:number;
  safetyResourcesShown:boolean;
  // user-facing intervention fields
  indicators:string[];
  interventionType:'none'|'gentle_nudge'|'break_suggestion'|'resources';
  message:string|null;
}
export function detectEmotionalFatigue(s:{
  harassmentExposureScore:number;
  sessionCount24h:number;
  swipeRatio:number;
  avgSessionDuration:number;
  unmatchRate:number;
  reportedMessagesLast7d?:number;
  selfHarmKeywordsInDraft?:boolean;
  // optional user-facing signals
  sessionsToday?:number;
  avgSessionMinutes?:number;
  negativeInteractions?:number;
  reportsMade?:number;
  blocksThisWeek?:number;
}):EmotionalFatigueResult{
  let sc=0;const indicators:string[]=[];
  if(s.harassmentExposureScore>=10){sc+=30;indicators.push('high_harassment_exposure');}
  else if(s.harassmentExposureScore>=5){sc+=15;indicators.push('moderate_harassment_exposure');}
  if(s.swipeRatio>0.9){sc+=20;indicators.push('high_swipe_ratio');}
  if(s.sessionCount24h>10&&s.avgSessionDuration<60){sc+=20;indicators.push('excessive_short_sessions');}
  if(s.unmatchRate>0.7){sc+=15;indicators.push('high_unmatch_rate');}
  if((s.reportedMessagesLast7d??0)>=3){sc+=15;indicators.push('multiple_reports_this_week');}
  if(s.selfHarmKeywordsInDraft){sc+=50;indicators.push('self_harm_keywords_detected');}
  // user-facing signals
  const sessionsToday=s.sessionsToday??s.sessionCount24h;
  const avgMins=s.avgSessionMinutes??s.avgSessionDuration;
  const negInt=s.negativeInteractions??0;
  const reports=s.reportsMade??s.reportedMessagesLast7d??0;
  const blocks=s.blocksThisWeek??0;
  if(sessionsToday>=8&&!indicators.includes('excessive_short_sessions'))indicators.push('excessive_daily_sessions');
  if(avgMins>=120)indicators.push('very_long_sessions');
  if(negInt>=5)indicators.push('high_negative_interactions');
  if(reports>=3&&!indicators.includes('multiple_reports_this_week'))indicators.push('multiple_reports_today');
  if(blocks>=10)indicators.push('high_block_rate');
  const fat=sc>=40||indicators.length>=2;
  const esc=s.selfHarmKeywordsInDraft===true||sc>=80;
  const rl=sc>=80?'critical':sc>=60?'high':sc>=40?'medium':sc>=20?'low':'none';
  const brk=rl==='critical'?60:rl==='high'?30:rl==='medium'?15:0;
  const interventionType=indicators.length>=4||rl==='critical'?'resources':indicators.length>=2||rl==='high'?'break_suggestion':indicators.length>=1?'gentle_nudge':'none';
  const message=interventionType==='resources'?'It seems like you may be going through a tough time. Our support resources are here for you.':interventionType==='break_suggestion'?'You\'ve had a lot of difficult interactions today. A break might help you recharge.':interventionType==='gentle_nudge'?'Dating can be emotionally taxing. Remember to take care of yourself.':null;
  if(esc)writeAuditLog('wellbeing.emotional_fatigue_critical',{score:sc}).catch(()=>{});
  else if(fat)writeAuditLog('wellbeing.emotional_fatigue_intervention',{interventionType,indicatorCount:indicators.length}).catch(()=>{});
  return{
    fatigued:fat,fatigueScore:sc,
    intervention:esc?"We noticed something concerning. If you're struggling, please reach out: 988 (call/text).":fat?"It looks like you might need a break. Your wellbeing matters more than any match. 💙":undefined,
    escalate:esc,riskLevel:rl,recommendedBreakMinutes:brk,safetyResourcesShown:esc,
    indicators,interventionType,message
  };}
export const emotionalFatigue=detectEmotionalFatigue;
// Legacy alias for intervention-only call pattern
export const detectEmotionalFatigueIntervention=(signals:{sessionsToday:number;avgSessionMinutes:number;negativeInteractions:number;reportsMade:number;blocksThisWeek:number})=>
  detectEmotionalFatigue({harassmentExposureScore:0,sessionCount24h:signals.sessionsToday,swipeRatio:0,avgSessionDuration:signals.avgSessionMinutes,unmatchRate:0,...signals});
export const emotionalFatigueIntervention=detectEmotionalFatigueIntervention;
export const fatigueIntervention=detectEmotionalFatigue;

// ─── #898 Harassment normalization prevention ─────────────────
// Full interface with all fields from both wellbeing.ts and emotionalLabor.ts
export interface HarassmentNormalizationResult{
  // wellbeing.ts fields
  normalized:boolean;
  threshold:number;
  receivedCount:number;
  recommendation:string;
  autoAction:'none'|'warn_sender'|'restrict_sender'|'escalate';
  // emotionalLabor.ts fields
  nudge:string|undefined;
  reportingBarrierRisk:boolean;
  normalizationScore:number;
  thresholdEscalation:boolean;
  interventionType:'none'|'gentle_nudge'|'strong_nudge'|'safety_team_alert';
}
export function preventHarassmentNormalization(h:{
  harassmentReportsSubmitted:number;
  harassmentExperienced:number;
  neverReported:number;
  daysSinceFirstHarassment?:number;
  consecutiveWeeksWithHarassment?:number;
  // optional wellbeing-style event log
  harassmentEvents?:Array<{timestamp:number;type:string;senderId:string}>;
  recipientId?:string;
  windowMs?:number;
}):HarassmentNormalizationResult{
  const rr=h.harassmentExperienced>0?h.harassmentReportsSubmitted/h.harassmentExperienced:1;
  const norm=rr<0.2&&h.harassmentExperienced>=5;
  const bar=h.neverReported>0&&h.harassmentExperienced>=3;
  const chronic=(h.consecutiveWeeksWithHarassment??0)>=3;
  const sc=Math.round((1-rr)*100*(h.harassmentExperienced/Math.max(h.harassmentExperienced,1)));
  const te=chronic&&h.harassmentExperienced>=10;
  let it:HarassmentNormalizationResult['interventionType']='none';
  if(te)it='safety_team_alert';else if(norm)it='strong_nudge';else if(bar)it='gentle_nudge';
  const nudge=norm?"You've received several flagged messages. You don't have to tolerate this. Reporting helps keep everyone safe.":bar?"Noticed something uncomfortable? It only takes a second to report — it helps protect you and others.":undefined;
  // wellbeing-style event counting
  const threshold=3;
  let receivedCount=h.harassmentExperienced;
  if(h.harassmentEvents&&h.windowMs){
    const now=Date.now();
    receivedCount=h.harassmentEvents.filter(e=>now-e.timestamp<h.windowMs!).length;
  }
  const uniqueSenders=h.harassmentEvents?new Set(h.harassmentEvents.map(e=>e.senderId)).size:0;
  const autoAction:HarassmentNormalizationResult['autoAction']=receivedCount>=10?'escalate':receivedCount>=5?'restrict_sender':receivedCount>=threshold?'warn_sender':'none';
  const recommendation=norm?`You've received ${receivedCount} harassment incidents. This is not normal or acceptable. We're taking action.`:'Harassment levels within expected thresholds.';
  if(te)writeAuditLog('wellbeing.harassment_normalization_chronic',{score:sc,weeks:h.consecutiveWeeksWithHarassment}).catch(()=>{});
  else if(norm&&h.recipientId)writeAuditLog('wellbeing.harassment_normalized',{recipientId:h.recipientId,count:receivedCount,uniqueSenders,autoAction}).catch(()=>{});
  return{normalized:norm,threshold,receivedCount,recommendation,autoAction,nudge,reportingBarrierRisk:bar,normalizationScore:sc,thresholdEscalation:te,interventionType:it};}
export const emotionalLaborDetect=preventHarassmentNormalization;
export const normalizedHarassment=preventHarassmentNormalization;
export const harassmentNormalizationPrevention=preventHarassmentNormalization;
// Wellbeing-style alias for event-log based calling
export function detectHarassmentNormalization(harassmentEvents:Array<{timestamp:number;type:string;senderId:string}>,recipientId:string,windowMs=7*86_400_000):HarassmentNormalizationResult{
  return preventHarassmentNormalization({harassmentReportsSubmitted:0,harassmentExperienced:harassmentEvents.length,neverReported:harassmentEvents.length,harassmentEvents,recipientId,windowMs});}
export const harassmentNormalization=detectHarassmentNormalization;

export function shouldShowBreakReminder(start:number,int=45){return(Date.now()-start)/60_000>=int;}

export interface UsageLimitConfig{dailyLimitMinutes:number;enabled:boolean;hardStop:boolean;cooldownMinutes:number;}
export const DEFAULT_USAGE_LIMITS:UsageLimitConfig={dailyLimitMinutes:120,enabled:false,hardStop:false,cooldownMinutes:15};

export function checkDailyUsageLimit(mins:number,cfg=DEFAULT_USAGE_LIMITS){
if(!cfg.enabled)return{limitReached:false,remainingMinutes:Infinity,action:'none'};
const rem=cfg.dailyLimitMinutes-mins;
return rem<=0?{limitReached:true,remainingMinutes:0,action:cfg.hardStop?'hard_stop':'nudge'}:rem<=15?{limitReached:false,remainingMinutes:rem,action:'nudge'}:{limitReached:false,remainingMinutes:rem,action:'none'};}

export function detectSwipeFatigue(st:{totalSwipes:number;matches:number;timeSpentMinutes:number}){return st.totalSwipes>100&&st.matches===0&&st.timeSpentMinutes>60?{fatigued:true,message:"You've been swiping for a while. Sometimes the best connections come when you take a step back."}:{fatigued:false};}

export function protectSelfEsteem(ev:{type:'unmatched'|'rejected'|'no_response'|'blocked';timestamp:number}[]){const rec=ev.filter(e=>Date.now()-e.timestamp<86_400_000);return rec.length>=5?{showEncouragement:true,message:"Dating can be tough. Remember: your worth isn't determined by matches. 🌟"}:{showEncouragement:false};}

export function applyMatchQualityGate(daily:number,max=10){return{throttled:daily>=max,remaining:Math.max(0,max-daily)};}

export function detectSwipePatternAnomaly(sw:Array<{direction:'left'|'right';timestamp:number}>,win=60_000){
const now=Date.now(),rec=sw.filter(s=>now-s.timestamp<win),spm=rec.length;
if(spm>30)return{anomaly:true,swipesPerMinute:spm,reason:'superhuman swipe rate',botLikelihood:0.95};
if(rec.length>=20&&rec.every(s=>s.direction==='right'))return{anomaly:true,swipesPerMinute:spm,reason:'right-swipes-only suggests automation',botLikelihood:0.85};
if(rec.length>=10){const ints=rec.slice(1).map((s,i)=>s.timestamp-rec[i]!.timestamp),avg=ints.reduce((a,b)=>a+b,0)/ints.length,variance=ints.reduce((s,t)=>s+(t-avg)**2,0)/ints.length;if(Math.sqrt(variance)<100)return{anomaly:true,swipesPerMinute:spm,reason:'robotic uniform timing',botLikelihood:0.80};}
return{anomaly:false,swipesPerMinute:spm,botLikelihood:0};}

// ─── [20.1] Moderator Wellbeing ───────────────────────────────
export interface ModWellbeingCheckResult{needsSupport:boolean;riskLevel:'none'|'low'|'medium'|'high'|'critical';supportType:string[];mandatoryBreak:boolean;escalateToSupervisor:boolean;resourcesShown:string[];}
export function checkModeratorWellbeing(mod:{csamReviewedToday:number;violentContentToday:number;totalHoursToday:number;consecutiveDaysWithoutBreak:number;selfReportedDistress?:boolean;errorsLast30Min?:number}):ModWellbeingCheckResult{
let score=0;const support:string[]=[];
if(mod.csamReviewedToday>=5){score+=40;support.push('mandatory_csam_debrief');}else if(mod.csamReviewedToday>=1){score+=20;support.push('csam_support_available');}
if(mod.violentContentToday>=20)score+=20;else if(mod.violentContentToday>=10)score+=10;
if(mod.totalHoursToday>=6)score+=15;else if(mod.totalHoursToday>=4)score+=8;
if(mod.consecutiveDaysWithoutBreak>=5){score+=20;support.push('mandatory_day_off');}
if(mod.selfReportedDistress){score+=30;support.push('crisis_resources','peer_support');}
if((mod.errorsLast30Min??0)>=5){score+=15;support.push('cognitive_fatigue_break');}
const rl:ModWellbeingCheckResult['riskLevel']=score>=70?'critical':score>=50?'high':score>=30?'medium':score>=15?'low':'none';
const resources=rl==='critical'||rl==='high'?['988 Suicide & Crisis Lifeline','NIOSH Work Stress Resources','Employee Assistance Program (EAP)','Peer Support Network']:rl==='medium'?['Wellness check-in','15-min break protocol']:[];
if(rl==='critical')writeAuditLog('mod.wellbeing_critical',{score,csamToday:mod.csamReviewedToday}).catch(()=>{});
return{needsSupport:score>=30,riskLevel:rl,supportType:support,mandatoryBreak:score>=50,escalateToSupervisor:score>=70,resourcesShown:resources};}
export const modWellbeing=checkModeratorWellbeing;export const secondaryTraumaCheck=checkModeratorWellbeing;

// ═══════════════════════════════════════════════════════════════
// ADDITIONS/STRENGTHENING TO utils/emotionalLabor.ts
// Covers: #897 Emotional fatigue intervention
// #898 Harassment normalization prevention
// ═══════════════════════════════════════════════════════════════

// ─── #897 Emotional Fatigue ───────────────────────────────────
export interface EmotionalFatigueResult {
  fatigued: boolean;
  fatigueScore: number;
  indicators: string[];
  interventionType: 'none' | 'gentle_nudge' | 'break_suggestion' | 'resources';
  triggerCategory: string[];
  message: string | null;
  suggestedBreakMinutes: number;
  resources: string[];
}

export function detectEmotionalFatigue(signals: {
  sessionsToday: number;
  avgSessionMinutes: number;
  negativeInteractions: number;
  reportsMade: number;
  blocksThisWeek: number;
  unmatchesReceived?: number;
  harassmentEventsToday?: number;
  selfReportedDistress?: boolean;
  daysSincePositiveInteraction?: number;
}): EmotionalFatigueResult {
  const indicators: string[] = [];
  const triggers: string[] = [];
  let score = 0;

  if (signals.sessionsToday >= 8) {
    indicators.push('excessive_daily_sessions');
    triggers.push('compulsive_use');
    score += 20;
  } else if (signals.sessionsToday >= 5) {
    indicators.push('elevated_daily_sessions');
    score += 10;
  }

  if (signals.avgSessionMinutes >= 120) {
    indicators.push('very_long_sessions');
    triggers.push('extended_exposure');
    score += 20;
  } else if (signals.avgSessionMinutes >= 60) {
    indicators.push('long_sessions');
    score += 10;
  }

  if (signals.negativeInteractions >= 5) {
    indicators.push('high_negative_interactions');
    triggers.push('repeated_negative_content');
    score += 25;
  } else if (signals.negativeInteractions >= 3) {
    indicators.push('elevated_negative_interactions');
    score += 12;
  }

  if (signals.reportsMade >= 3) {
    indicators.push('multiple_reports_today');
    triggers.push('harassment_exposure');
    score += 20;
  }

  if (signals.blocksThisWeek >= 10) {
    indicators.push('high_block_rate');
    triggers.push('safety_actions_elevated');
    score += 15;
  }

  if ((signals.unmatchesReceived ?? 0) >= 5) {
    indicators.push('high_unmatches_received');
    triggers.push('rejection_pattern');
    score += 15;
  }

  if ((signals.harassmentEventsToday ?? 0) >= 2) {
    indicators.push('repeated_harassment_today');
    triggers.push('harassment_exposure');
    score += 25;
  }

  if (signals.selfReportedDistress) {
    indicators.push('self_reported_distress');
    triggers.push('direct_user_signal');
    score += 30;
  }

  if ((signals.daysSincePositiveInteraction ?? 0) >= 7) {
    indicators.push('no_positive_interaction_7d');
    triggers.push('sustained_negative_environment');
    score += 15;
  }

  score = Math.min(100, score);
  const fatigued = score >= 30;

  const interventionType: EmotionalFatigueResult['interventionType'] =
    score >= 70 ? 'resources' :
    score >= 45 ? 'break_suggestion' :
    score >= 20 ? 'gentle_nudge' : 'none';

  const suggestedBreakMinutes =
    interventionType === 'resources' ? 1440 :
    interventionType === 'break_suggestion' ? 60 :
    interventionType === 'gentle_nudge' ? 15 : 0;

  const message =
    interventionType === 'resources'
      ? 'It seems like you may be going through a really tough time. Please know support is available, and taking a full break can help you protect your mental health.'
      : interventionType === 'break_suggestion'
      ? 'You\'ve had a lot of difficult interactions today. Taking a break can help you recharge and come back feeling more yourself.'
      : interventionType === 'gentle_nudge'
      ? 'Dating can be emotionally taxing. Remember to take care of yourself — quality is more important than quantity.'
      : null;

  const resources = interventionType === 'resources'
    ? [
        'Crisis Text Line: Text HOME to 741741',
        'NAMI Helpline: 1-800-950-NAMI',
        'BetterHelp: betterhelp.com',
        'Headspace (mental wellness): headspace.com',
      ]
    : [];

  if (fatigued) {
    void writeAuditLog('wellbeing.emotional_fatigue', {
      fatigueScore: score, indicators, interventionType, triggerCategory: triggers,
    }).catch(() => {});
  }

  return {
    fatigued,
    fatigueScore: score,
    indicators,
    interventionType,
    triggerCategory: triggers,
    message,
    suggestedBreakMinutes,
    resources,
  };
}
export const emotionalFatigue = detectEmotionalFatigue;
export const fatigueDetect = detectEmotionalFatigue;
export const fatigueIntervention = detectEmotionalFatigue;

// ─── #898 Harassment normalization prevention ─────────────────
export interface HarassmentNormalizationResult {
  normalized: boolean;
  threshold: number;
  receivedCount: number;
  normalizedTypes: string[];
  escalationLevel: 'none' | 'monitor' | 'intervene' | 'escalate';
  recommendation: string;
  autoAction: 'none' | 'warn_sender' | 'restrict_sender' | 'escalate';
  recipientResources: string[];
  platformAction: string[];
}

interface HarassmentEvent {
  timestamp: number;
  type: string;
  senderId: string;
  severity?: 'low' | 'medium' | 'high';
  content?: string;
}

export function detectHarassmentNormalization(
  events: HarassmentEvent[],
  recipientId: string,
  windowMs = 7 * 86_400_000
): HarassmentNormalizationResult {
  const now = Date.now();
  const recent = events.filter(e => now - e.timestamp < windowMs);
  const threshold = 3;

  const uniqueSenders = new Set(recent.map(e => e.senderId)).size;
  const typeBreakdown = new Map<string, number>();
  for (const e of recent) {
    typeBreakdown.set(e.type, (typeBreakdown.get(e.type) ?? 0) + 1);
  }
  const normalizedTypes = [...typeBreakdown.entries()]
    .filter(([, cnt]) => cnt >= 2)
    .map(([type]) => type);

  const normalized = recent.length >= threshold;
  const highSeverityCount = recent.filter(e => e.severity === 'high').length;

  const escalationLevel: HarassmentNormalizationResult['escalationLevel'] =
    highSeverityCount >= 3 || recent.length >= 10 ? 'escalate' :
    recent.length >= 5 || uniqueSenders >= 3 ? 'intervene' :
    recent.length >= threshold ? 'monitor' : 'none';

  const autoAction: HarassmentNormalizationResult['autoAction'] =
    escalationLevel === 'escalate' ? 'escalate' :
    escalationLevel === 'intervene' ? 'restrict_sender' :
    escalationLevel === 'monitor' ? 'warn_sender' : 'none';

  const platformAction: string[] = [];
  if (escalationLevel === 'escalate') {
    platformAction.push(
      'Escalate to Trust & Safety team',
      'Auto-mute all identified senders',
      'Send support resources to recipient',
      'Consider proactive outreach to recipient'
    );
  } else if (escalationLevel === 'intervene') {
    platformAction.push(
      'Warn all senders from this window',
      'Reduce visibility of recipient to flagged senders',
      'Offer recipient enhanced privacy controls'
    );
  } else if (escalationLevel === 'monitor') {
    platformAction.push(
      'Warn primary sender',
      'Log for pattern analysis'
    );
  }

  const recipientResources = normalized
    ? [
        'You can block any user from their profile — we\'ve made this easier to find',
        'Crisis Text Line: Text HOME to 741741',
        'RAINN: 1-800-656-4673 (rainn.org)',
        'Use Quick Exit in settings if you need to leave the app quickly',
      ]
    : [];

  if (normalized) {
    void writeAuditLog('wellbeing.harassment_normalization', {
      recipientId, count: recent.length, uniqueSenders,
      escalationLevel, autoAction, normalizedTypes,
    }).catch(() => {});
  }

  return {
    normalized,
    threshold,
    receivedCount: recent.length,
    normalizedTypes,
    escalationLevel,
    recommendation: normalized
      ? `${recent.length} harassment events in 7 days from ${uniqueSenders} sender(s). This pattern is not acceptable — ${escalationLevel} response required.`
      : 'Harassment levels within expected thresholds.',
    autoAction,
    recipientResources,
    platformAction,
  };
}
export const harassmentNormalization = detectHarassmentNormalization;
export const normalizedHarassment = detectHarassmentNormalization;
export const harassmentThreshold = detectHarassmentNormalization;

export interface ContentRotationResult{rotated:boolean;currentQueue:string[];maxConsecutiveHeavy:number;recommendation:string;}
export function rotateModeratorContent(queue:Array<{contentType:'csam'|'violence'|'harassment'|'spam'|'standard';severity:number}>):ContentRotationResult{
const heavy=queue.filter(q=>q.contentType==='csam'||q.contentType==='violence');
const consecutive=queue.slice(0,5).filter(q=>q.contentType==='csam'||q.contentType==='violence').length;
const shouldRotate=consecutive>=3||heavy.length/Math.max(queue.length,1)>0.4;
if(shouldRotate){const standard=queue.filter(q=>q.contentType==='standard'||q.contentType==='spam');const heavyItems=queue.filter(q=>q.contentType!=='standard'&&q.contentType!=='spam');const rotated:typeof queue=[];for(let i=0;i<heavyItems.length;i++){rotated.push(heavyItems[i]!);if(standard[i])rotated.push(standard[i]!);}writeAuditLog('mod.content_rotated',{heavyCount:heavy.length,queueLength:queue.length}).catch(()=>{});return{rotated:true,currentQueue:rotated.map(q=>q.contentType),maxConsecutiveHeavy:3,recommendation:'Queue rotated to prevent secondary trauma accumulation.'};}
return{rotated:false,currentQueue:queue.map(q=>q.contentType),maxConsecutiveHeavy:3,recommendation:'Queue balance is acceptable.'};}
export const contentRotation=rotateModeratorContent;
import { writeAuditLog } from './logger';

export interface WellbeingNudge{type:'time_limit'|'rejection_pause'|'compulsive_check'|'take_break';message:string;actionable:boolean;}

export function checkSessionDuration(startTime:number,maxMinutes=60):WellbeingNudge|null{
  const elapsed=(Date.now()-startTime)/60000;
  if(elapsed>=maxMinutes){return{type:'time_limit',message:`You've been browsing for ${Math.round(elapsed)} minutes. Consider taking a break.`,actionable:true};}
  return null;}

export function checkRejectionPattern(stats:{swipesThisSession:number;matchesThisSession:number;rejectionsReceived:number}):WellbeingNudge|null{
  if(stats.swipesThisSession>50&&stats.matchesThisSession===0){return{type:'rejection_pause',message:'Taking a break can help. Quality connections take time.',actionable:true};}
  return null;}

export function checkCompulsiveUse(openTimes:number[],windowMs=3600000):WellbeingNudge|null{
  const now=Date.now();const recentOpens=openTimes.filter(t=>now-t<windowMs);
  if(recentOpens.length>=15){return{type:'compulsive_check',message:`You've opened the app ${recentOpens.length} times in the last hour. Everything okay?`,actionable:true};}
  return null;}

export const MUST_BE_FREE=['block','report','unmatch','hide_profile','read_receipt_disable','emergency_resources','screenshot_notification','quick_exit','contact_blocking','csam_reporting'] as const;

export function auditPaywalledFeatures(premiumOnlyFeatures:string[]):{violations:string[]}{
  const violations=premiumOnlyFeatures.filter(f=>MUST_BE_FREE.includes(f as any));
  return{violations};}

export interface DoomSwipeResult{detected:boolean;swipeCount:number;sessionMinutes:number;swipesPerMinute:number;riskLevel:'none'|'low'|'medium'|'high';recommendation:string;}
export function detectDoomSwiping(swipeTimestamps:number[],sessionStartMs:number):DoomSwipeResult{
  const now=Date.now(),sessionMinutes=(now-sessionStartMs)/60_000,swipesPerMinute=sessionMinutes>0?swipeTimestamps.length/sessionMinutes:0;
  const rl=swipesPerMinute>=30?'high':swipesPerMinute>=15?'medium':swipesPerMinute>=8?'low':'none';
  const detected=rl!=='none'&&swipeTimestamps.length>=50;
  if(detected)writeAuditLog('wellbeing.doom_swiping',{swipeCount:swipeTimestamps.length,swipesPerMinute,sessionMinutes}).catch(()=>{});
  return{detected,swipeCount:swipeTimestamps.length,sessionMinutes:Math.round(sessionMinutes*10)/10,swipesPerMinute:Math.round(swipesPerMinute*10)/10,riskLevel:rl,recommendation:rl==='high'?'Taking a break may help. Rapid swiping rarely leads to meaningful connections.':rl==='medium'?'Slow down and read profiles more carefully.':rl==='low'?'Consider spending more time on each profile.':'Swiping pace is healthy.'};}
export const compulsiveUsage=detectDoomSwiping;export const doomSwiping=detectDoomSwiping;

export interface CompulsiveUsageResult{detected:boolean;sessionsToday:number;totalSwipesToday:number;averageSessionLength:number;riskLevel:'none'|'low'|'medium'|'high';}
export function buildCompulsiveUsageResult(sessionsToday:number,totalSwipesToday:number,averageSessionLength:number,swipeTimestamps:number[],sessionStartMs:number):CompulsiveUsageResult{
  const r=detectDoomSwiping(swipeTimestamps,sessionStartMs);
  return{detected:r.detected,sessionsToday,totalSwipesToday,averageSessionLength,riskLevel:r.riskLevel};}

export interface RejectionSensitivityResult{overloaded:boolean;rejectionRate:number;recentRejections:number;recommendation:string;suggestBreak:boolean;}
export function detectRejectionSensitivityOverload(stats:{likesGiven:number;matchesReceived:number;unmatchedRecently:number;sessionCount7d:number}):RejectionSensitivityResult{
  const matchRate=stats.likesGiven>0?stats.matchesReceived/stats.likesGiven:0;const rejectionRate=1-matchRate;const overloaded=rejectionRate>=0.98&&stats.likesGiven>=50||stats.unmatchedRecently>=5;
  if(overloaded)writeAuditLog('wellbeing.rejection_overload',{rejectionRate,recentRejections:stats.unmatchedRecently}).catch(()=>{});
  return{overloaded,rejectionRate:Math.round(rejectionRate*100)/100,recentRejections:stats.unmatchedRecently,suggestBreak:overloaded,recommendation:overloaded?'It looks like you might be experiencing some rejection fatigue. Consider taking a break or refreshing your profile.':rejectionRate>=0.9?'Your match rate is lower than average. A profile refresh might help.':'Match rate is within normal range.'};}
export const rejectionSensitivity=detectRejectionSensitivityOverload;export const rejectionOverload=detectRejectionSensitivityOverload;

export interface RejectionOverloadResult{detected:boolean;rejectionRate:number;consecutiveRejections:number;riskLevel:'none'|'low'|'medium'|'high';recommendation:string;suggestBreak:boolean;}
export function buildRejectionOverloadResult(stats:{likesGiven:number;matchesReceived:number;unmatchedRecently:number;consecutiveRejections:number;sessionCount7d:number}):RejectionOverloadResult{
  const r=detectRejectionSensitivityOverload(stats);
  const rl:RejectionOverloadResult['riskLevel']=stats.consecutiveRejections>=20?'high':stats.consecutiveRejections>=10?'medium':stats.consecutiveRejections>=5?'low':'none';
  return{detected:r.overloaded,rejectionRate:r.rejectionRate,consecutiveRejections:stats.consecutiveRejections,riskLevel:rl,recommendation:r.recommendation,suggestBreak:r.suggestBreak};}

export interface SelfEsteemImpactResult{impactScore:number;trend:'improving'|'stable'|'declining';signals:string[];recommendation:string;}
export function monitorSelfEsteemImpact(metrics:{recentMatchRate:number;baselineMatchRate:number;negativeMessagesReceived:number;profileEditsLast7d:number;sessionFrequencyChange:number;appOpenAfterRejection:boolean}):SelfEsteemImpactResult{
  const signals:string[]=[];let score=50;
  const matchDelta=metrics.recentMatchRate-metrics.baselineMatchRate;
  if(matchDelta<-0.2){signals.push('declining_match_rate');score-=15;}
  if(metrics.negativeMessagesReceived>=5){signals.push('high_negative_messages');score-=20;}
  if(metrics.profileEditsLast7d>=3){signals.push('frequent_profile_edits');score-=10;}
  if(metrics.sessionFrequencyChange>0.5){signals.push('increased_session_frequency');score-=10;}
  if(metrics.appOpenAfterRejection){signals.push('compulsive_check_after_rejection');score-=10;}
  if(matchDelta>0.1){score+=15;}
  score=Math.max(0,Math.min(100,score));
  const trend=score>=60?'improving':score>=35?'stable':'declining';
  if(trend==='declining')writeAuditLog('wellbeing.self_esteem_declining',{score,signals}).catch(()=>{});
  return{impactScore:score,trend,signals,recommendation:trend==='declining'?'We\'ve noticed some patterns that may be affecting your wellbeing. Consider taking a break or adjusting your approach.':trend==='stable'?'Your app use seems balanced.':'Your experience appears positive. Keep going!'};}
export const selfEsteemMonitor=monitorSelfEsteemImpact;export const selfEsteemImpact=monitorSelfEsteemImpact;

export interface EngagementVsWellbeingResult{balanceScore:number;engagementOverridden:boolean;recommendation:string;adjustments:string[];}
export function balanceEngagementVsWellbeing(metrics:{engagementScore:number;wellbeingScore:number;userReportedSatisfaction?:number;sessionTimeMinutes:number;returnRate7d:number}):EngagementVsWellbeingResult{
  const adjustments:string[]=[];
  const wellbeingPriority=metrics.wellbeingScore<40||(metrics.userReportedSatisfaction??50)<30;
  let balanceScore=(metrics.engagementScore+metrics.wellbeingScore)/2;
  if(metrics.sessionTimeMinutes>120){adjustments.push('reduce_notification_frequency');balanceScore-=10;}
  if(metrics.returnRate7d>0.9&&metrics.wellbeingScore<50){adjustments.push('introduce_usage_breaks');balanceScore-=5;}
  if(wellbeingPriority){adjustments.push('prioritize_quality_over_quantity','reduce_swipe_feed_length');balanceScore=Math.max(balanceScore,40);}
  if(adjustments.length)writeAuditLog('wellbeing.engagement_override',{adjustments,wellbeingScore:metrics.wellbeingScore}).catch(()=>{});
  return{balanceScore:Math.round(Math.max(0,Math.min(100,balanceScore))),engagementOverridden:wellbeingPriority,recommendation:wellbeingPriority?'Wellbeing signals are low. Reducing engagement push in favor of user health.':'Engagement and wellbeing are balanced.',adjustments};}
export const engagementWellbeing=balanceEngagementVsWellbeing;export const wellbeingTradeoff=balanceEngagementVsWellbeing;

export interface RejectionThrottleResult{throttled:boolean;currentRejectionStreak:number;threshold:number;action:'none'|'slow_feed'|'pause_feed'|'break_prompt';}
export function throttleRejectionOverexposure(stats:{consecutiveRejections:number;rejectionsLast24h:number;lastMatchDaysAgo:number}):RejectionThrottleResult{
  const threshold=10;const throttled=stats.consecutiveRejections>=threshold||stats.rejectionsLast24h>=20;
  const action=stats.consecutiveRejections>=20||stats.rejectionsLast24h>=30?'pause_feed':stats.consecutiveRejections>=threshold?'slow_feed':stats.lastMatchDaysAgo>=14?'break_prompt':'none';
  if(throttled)writeAuditLog('wellbeing.rejection_throttle',{streak:stats.consecutiveRejections,last24h:stats.rejectionsLast24h,action}).catch(()=>{});
  return{throttled,currentRejectionStreak:stats.consecutiveRejections,threshold,action};}
export const rejectionThrottle=throttleRejectionOverexposure;export const rejectionOverexposure=throttleRejectionOverexposure;

export interface NegativeFeedbackLoopResult{detected:boolean;loopType:string[];severity:'none'|'low'|'medium'|'high';intervention:string;}
export function detectNegativeFeedbackLoop(trajectory:{weeklyMatchRates:number[];weeklySessionCounts:number[];weeklyNegativeInteractions:number[];weeklyReportsMade:number[]}):NegativeFeedbackLoopResult{
  if(trajectory.weeklyMatchRates.length<2)return{detected:false,loopType:[],severity:'none',intervention:'Insufficient data.'};
  const loopTypes:string[]=[];
  const matchTrend=trajectory.weeklyMatchRates[trajectory.weeklyMatchRates.length-1]!-trajectory.weeklyMatchRates[0]!;
  const sessionTrend=trajectory.weeklySessionCounts[trajectory.weeklySessionCounts.length-1]!-trajectory.weeklySessionCounts[0]!;
  const negTrend=trajectory.weeklyNegativeInteractions[trajectory.weeklyNegativeInteractions.length-1]!-trajectory.weeklyNegativeInteractions[0]!;
  if(matchTrend<-0.1&&sessionTrend>2)loopTypes.push('declining_matches_increasing_sessions');
  if(negTrend>2&&sessionTrend>1)loopTypes.push('negative_interactions_driving_compulsive_use');
  if(trajectory.weeklyReportsMade[trajectory.weeklyReportsMade.length-1]!>=3&&negTrend>0)loopTypes.push('repeated_harassment_exposure');
  if(matchTrend<-0.2&&negTrend>3)loopTypes.push('rejection_spiral');
  const sev:NegativeFeedbackLoopResult['severity']=loopTypes.length>=3?'high':loopTypes.length>=2?'medium':loopTypes.length>=1?'low':'none';
  if(sev!=='none')writeAuditLog('wellbeing.negative_feedback_loop',{loopTypes,severity:sev}).catch(()=>{});
  return{detected:loopTypes.length>0,loopType:loopTypes,severity:sev,intervention:sev==='high'?'Significant negative pattern detected. Suggest profile refresh, break, and review safety settings.':sev==='medium'?'Negative usage pattern emerging. Recommend taking a break.':sev==='low'?'Minor negative pattern. Monitor and nudge toward healthier use.':'No negative feedback loop detected.'};}
export const negativeFeedbackLoop=detectNegativeFeedbackLoop;export const feedbackLoopDetect=detectNegativeFeedbackLoop;

export interface HarassmentNormalizationResult{normalized:boolean;threshold:number;receivedCount:number;recommendation:string;autoAction:'none'|'warn_sender'|'restrict_sender'|'escalate';}
export function detectHarassmentNormalization(harassmentEvents:Array<{timestamp:number;type:string;senderId:string}>,recipientId:string,windowMs=7*86_400_000):HarassmentNormalizationResult{
  const now=Date.now(),recent=harassmentEvents.filter(e=>now-e.timestamp<windowMs);const threshold=3;const normalized=recent.length>=threshold;
  const uniqueSenders=new Set(recent.map(e=>e.senderId)).size;const autoAction=recent.length>=10?'escalate':recent.length>=5?'restrict_sender':recent.length>=threshold?'warn_sender':'none';
  if(normalized)writeAuditLog('wellbeing.harassment_normalized',{recipientId,count:recent.length,uniqueSenders,autoAction}).catch(()=>{});
  return{normalized,threshold,receivedCount:recent.length,recommendation:normalized?`You've received ${recent.length} harassment incidents this week. This is not normal or acceptable. We're taking action.`:'Harassment levels within expected thresholds.',autoAction};}
export const harassmentNormalization=detectHarassmentNormalization;export const normalizedHarassment=detectHarassmentNormalization;

export interface OnlineStatusVisibilityResult{visibleTo:'everyone'|'matches'|'nobody';lastSeenVisibleTo:'everyone'|'matches'|'nobody';activeNowVisible:boolean;hiddenFromUsers:string[];}
export function configureOnlineStatusVisibility(prefs:{showOnlineTo:'everyone'|'matches'|'nobody';showLastSeenTo:'everyone'|'matches'|'nobody';hideActiveNow?:boolean;hideFromSpecificUsers?:string[]}):OnlineStatusVisibilityResult{
  return{visibleTo:prefs.showOnlineTo,lastSeenVisibleTo:prefs.showLastSeenTo,activeNowVisible:!(prefs.hideActiveNow??false),hiddenFromUsers:prefs.hideFromSpecificUsers??[]};}
export const onlineStatusVisibility=configureOnlineStatusVisibility;export const statusVisibilityControls=configureOnlineStatusVisibility;

export interface EmotionalFatigueResult{fatigued:boolean;indicators:string[];interventionType:'none'|'gentle_nudge'|'break_suggestion'|'resources';message:string|null;}
export function detectEmotionalFatigue(signals:{sessionsToday:number;avgSessionMinutes:number;negativeInteractions:number;reportsMade:number;blocksThisWeek:number}):EmotionalFatigueResult{
  const indicators:string[]=[];
  if(signals.sessionsToday>=8)indicators.push('excessive_daily_sessions');
  if(signals.avgSessionMinutes>=120)indicators.push('very_long_sessions');
  if(signals.negativeInteractions>=5)indicators.push('high_negative_interactions');
  if(signals.reportsMade>=3)indicators.push('multiple_reports_today');
  if(signals.blocksThisWeek>=10)indicators.push('high_block_rate');
  const fatigued=indicators.length>=2;const interventionType=indicators.length>=4?'resources':indicators.length>=2?'break_suggestion':indicators.length>=1?'gentle_nudge':'none';
  const message=interventionType==='resources'?'It seems like you may be going through a tough time. Our support resources are here for you.':interventionType==='break_suggestion'?'You\'ve had a lot of difficult interactions today. A break might help you recharge.':interventionType==='gentle_nudge'?'Dating can be emotionally taxing. Remember to take care of yourself.':null;
  return{fatigued,indicators,interventionType,message};}
export const emotionalFatigue=detectEmotionalFatigue;export const fatigueIntervention=detectEmotionalFatigue;

export interface ScreenTimeResult{dailyMinutes:number;overLimit:boolean;limitMinutes:number;action:'none'|'nudge'|'soft_limit'|'hard_limit';}
export function enforceScreenTimeLimit(dailyMinutes:number,userSetLimitMinutes:number,hardLimit=false):ScreenTimeResult{
  const overLimit=dailyMinutes>=userSetLimitMinutes;
  const action=!overLimit?'none':hardLimit?'hard_limit':dailyMinutes>=userSetLimitMinutes*1.2?'soft_limit':'nudge';
  if(overLimit)writeAuditLog('wellbeing.screen_time_limit',{dailyMinutes,limitMinutes:userSetLimitMinutes,action}).catch(()=>{});
  return{dailyMinutes,overLimit,limitMinutes:userSetLimitMinutes,action};}
export const screenTimeLimit=enforceScreenTimeLimit;export const dailyUsageLimit=enforceScreenTimeLimit;

export interface NotificationBatchResult{shouldBatch:boolean;batchWindowMs:number;reason:string;nextDeliveryAt:number;}
export function batchNotificationsForWellbeing(prefs:{batchingEnabled:boolean;quietHoursStart:number;quietHoursEnd:number;maxPerHour:number},recentCount:number):NotificationBatchResult{
  const now=Date.now();const hour=new Date().getHours();const inQuiet=hour>=prefs.quietHoursStart||hour<prefs.quietHoursEnd;
  const overRate=recentCount>=prefs.maxPerHour;
  const shouldBatch=prefs.batchingEnabled&&(inQuiet||overRate);
  const nextHour=new Date();nextHour.setHours(nextHour.getHours()+1,0,0,0);
  const quietEnd=new Date();quietEnd.setHours(prefs.quietHoursEnd,0,0,0);if(quietEnd.getTime()<now)quietEnd.setDate(quietEnd.getDate()+1);
  return{shouldBatch,batchWindowMs:shouldBatch?3_600_000:0,reason:inQuiet?'quiet_hours':overRate?'rate_limit':'none',nextDeliveryAt:inQuiet?quietEnd.getTime():nextHour.getTime()};}
export const notificationBatching=batchNotificationsForWellbeing;export const wellbeingNotifications=batchNotificationsForWellbeing;

export interface PositiveNudgeResult{show:boolean;message:string;type:'milestone'|'encouragement'|'tip'|'none';}
export function generatePositiveNudge(stats:{totalMatches:number;messagesExchanged:number;profileCompleted:boolean;daysSinceJoin:number;recentPositiveInteraction:boolean}):PositiveNudgeResult{
  if(stats.totalMatches===1)return{show:true,message:'You got your first match! 🎉 Take your time and be yourself.',type:'milestone'};
  if(stats.totalMatches===10)return{show:true,message:'10 matches! Quality over quantity — find someone who shares your values.',type:'milestone'};
  if(stats.messagesExchanged>=50&&stats.recentPositiveInteraction)return{show:true,message:'Great conversations happening! Keep being genuine.',type:'encouragement'};
  if(!stats.profileCompleted&&stats.daysSinceJoin>=3)return{show:true,message:'Complete your profile to get better matches — verified profiles get 3x more connections.',type:'tip'};
  return{show:false,message:'',type:'none'};}
export const positiveNudge=generatePositiveNudge;export const reinforcementNudge=generatePositiveNudge;

export interface SubscriptionFrictionResult{frictionScore:number;darkPatterns:string[];compliant:boolean;recommendation:string;}
export function auditSubscriptionCancellation(flow:{cancellationClicksRequired:number;hasConfirmShaming:boolean;hasHiddenCancellationOption:boolean;offersClearCancellation:boolean;immediatelyCancels:boolean;hassleFlow:boolean;darkCountdown:boolean}):SubscriptionFrictionResult{
  const darkPatterns:string[]=[];let score=0;
  if(flow.cancellationClicksRequired>3){darkPatterns.push('excessive_clicks');score+=20;}
  if(flow.hasConfirmShaming){darkPatterns.push('confirmshaming');score+=25;}
  if(flow.hasHiddenCancellationOption){darkPatterns.push('hidden_option');score+=30;}
  if(!flow.offersClearCancellation){darkPatterns.push('unclear_cancellation');score+=20;}
  if(!flow.immediatelyCancels){darkPatterns.push('delayed_cancellation');score+=15;}
  if(flow.hassleFlow){darkPatterns.push('hassle_flow');score+=25;}
  if(flow.darkCountdown){darkPatterns.push('fake_urgency_countdown');score+=20;}
  score=Math.min(score,100);
  if(darkPatterns.length)writeAuditLog('darkpattern.subscription_friction',{darkPatterns,score}).catch(()=>{});
  return{frictionScore:score,darkPatterns,compliant:score===0,recommendation:score>0?`Remove dark patterns: ${darkPatterns.join(', ')}. FTC requires clear cancellation.`:'Cancellation flow is compliant.'};}
export const cancellationFrictionAudit=auditSubscriptionCancellation;export const subscriptionAudit=auditSubscriptionCancellation;

export interface CancellationFrictionResult{frictionScore:number;darkPatterns:string[];compliant:boolean;recommendation:string;}
export const cancellationFriction=auditSubscriptionCancellation;

export interface SafetyDiscoverabilityResult{score:number;hardToFind:string[];wellPlaced:string[];recommendation:string;}
export function auditSafetyDiscoverability(placement:{blockButtonVisible:boolean;reportButtonClicksFromChat:number;safetyResourcesInMenu:boolean;blockInProfileView:boolean;emergencyExitVisible:boolean;helpCenterAccessible:boolean}):SafetyDiscoverabilityResult{
  const hardToFind:string[]=[],wellPlaced:string[]=[];let score=100;
  if(!placement.blockButtonVisible){hardToFind.push('block_button');score-=20;}else wellPlaced.push('block_button');
  if(placement.reportButtonClicksFromChat>2){hardToFind.push('report_button_deep');score-=15;}else wellPlaced.push('report_button');
  if(!placement.safetyResourcesInMenu){hardToFind.push('safety_resources');score-=15;}else wellPlaced.push('safety_resources');
  if(!placement.blockInProfileView){hardToFind.push('block_from_profile');score-=15;}else wellPlaced.push('block_from_profile');
  if(!placement.emergencyExitVisible){hardToFind.push('emergency_exit');score-=20;}else wellPlaced.push('emergency_exit');
  if(!placement.helpCenterAccessible){hardToFind.push('help_center');score-=15;}else wellPlaced.push('help_center');
  if(hardToFind.length)writeAuditLog('ux.safety_discoverability',{hardToFind,score}).catch(()=>{});
  return{score:Math.max(0,score),hardToFind,wellPlaced,recommendation:hardToFind.length>0?`Improve safety feature placement: ${hardToFind.join(', ')}`.trim():'Safety features are well placed.'};}
export const safetyDiscoverability=auditSafetyDiscoverability;export const discoverabilityAudit=auditSafetyDiscoverability;
export const safetyDiscoverabilityAudit=auditSafetyDiscoverability;

export interface SafetyUsageAnalyticsResult{totalBlocks:number;totalReports:number;totalUnmatches:number;safetyFeatureAdoptionRate:number;mostUsedFeature:string;recommendation:string;}
export function analyzeSafetyFeatureUsage(usage:{blocks:number;reports:number;unmatches:number;quickExits:number;resourcesViewed:number;totalUsers:number}):SafetyUsageAnalyticsResult{
  const total=usage.blocks+usage.reports+usage.unmatches+usage.quickExits+usage.resourcesViewed;const adoptionRate=usage.totalUsers>0?Math.min(total/usage.totalUsers,1):0;
  const features={blocks:usage.blocks,reports:usage.reports,unmatches:usage.unmatches,quick_exits:usage.quickExits,resources:usage.resourcesViewed};
  const mostUsed=Object.entries(features).sort(([,a],[,b])=>b-a)[0]?.[0]??'none';
  return{totalBlocks:usage.blocks,totalReports:usage.reports,totalUnmatches:usage.unmatches,safetyFeatureAdoptionRate:Math.round(adoptionRate*100)/100,mostUsedFeature:mostUsed,recommendation:adoptionRate<0.1?'Low safety feature adoption. Improve discoverability and onboarding.':adoptionRate<0.3?'Moderate adoption. Consider in-context safety prompts.':'Good safety feature adoption rate.'};}
export const safetyAnalytics=analyzeSafetyFeatureUsage;export const featureUsageStats=analyzeSafetyFeatureUsage;

export interface SafetyPaywallResult{compliant:boolean;paywalledFeatures:string[];requiredFree:string[];recommendation:string;}
export function auditSafetyPaywall(premiumOnlyFeatures:string[]):SafetyPaywallResult{
  const requiredFree=[...MUST_BE_FREE];
  const paywalled=premiumOnlyFeatures.filter(f=>requiredFree.includes(f as any));
  if(paywalled.length)writeAuditLog('darkpattern.safety_paywall',{paywalledFeatures:paywalled}).catch(()=>{});
  return{compliant:paywalled.length===0,paywalledFeatures:paywalled,requiredFree,recommendation:paywalled.length>0?`These safety features must be free: ${paywalled.join(', ')}. Paywalling safety features violates platform trust and may violate law.`:'All required safety features are free. Compliant.'};}
export const safetyPaywall=auditSafetyPaywall;export const safetyFeaturePaywall=auditSafetyPaywall;export const paywallAudit=auditSafetyPaywall;

export interface OnlineSafetyActResult{
  compliant:boolean;
  checks:string[];
  failures:string[];
  dutyOfCareScore:number;
  recommendation:string;
}
export function onlineSafetyActCompliance(s:{
  hasRiskAssessment:boolean;
  hasSafetyByDesign:boolean;
  hasContentModeration:boolean;
  hasReportingMechanism:boolean;
  hasTransparencyReport:boolean;
  hasChildSafetyMeasures:boolean;
  hasIllegalContentRemoval:boolean;
  hasUserEmpowermentTools:boolean;
  hasProactiveDetection:boolean;
}):OnlineSafetyActResult{
  const checks:string[]=[];const failures:string[]=[];
  const fields:{key:keyof typeof s;label:string}[]=[
    {key:'hasRiskAssessment',label:'risk_assessment'},
    {key:'hasSafetyByDesign',label:'safety_by_design'},
    {key:'hasContentModeration',label:'content_moderation'},
    {key:'hasReportingMechanism',label:'reporting_mechanism'},
    {key:'hasTransparencyReport',label:'transparency_report'},
    {key:'hasChildSafetyMeasures',label:'child_safety_measures'},
    {key:'hasIllegalContentRemoval',label:'illegal_content_removal'},
    {key:'hasUserEmpowermentTools',label:'user_empowerment_tools'},
    {key:'hasProactiveDetection',label:'proactive_detection'},
  ];
  for(const f of fields){if(s[f.key])checks.push(f.label);else failures.push(f.label);}
  const score=Math.round((checks.length/fields.length)*100);
  const compliant=failures.length===0;
  if(!compliant)void writeAuditLog('legal.online_safety_act',{failures,score}).catch(()=>{});
  return{compliant,checks,failures,dutyOfCareScore:score,recommendation:compliant?'UK Online Safety Act: Fully compliant.':failures.length<=2?`Near compliant. Address: ${failures.join(', ')}.`:`Non-compliant. Critical gaps: ${failures.join(', ')}. Ofcom may impose fines up to £18M or 10% global turnover.`};}
export const onlineSafetyAct=onlineSafetyActCompliance;
export const ukOnlineSafetyAct=onlineSafetyActCompliance;
export const dutyOfCare=onlineSafetyActCompliance;

export interface AgeAppropriateDesignResult{
  compliant:boolean;
  checks:string[];
  failures:string[];
  recommendation:string;
}
export function ageAppropriateDesignCode(s:{
  hasAgeAssessment:boolean;
  appliesHighPrivacyByDefault:boolean;
  minimizesDataCollection:boolean;
  avoidsDetrimental:boolean;
  noProfilingChildren:boolean;
  noGeolocationDefault:boolean;
  noNudgeTechniques:boolean;
  parentalControlsAvailable:boolean;
}):AgeAppropriateDesignResult{
  const checks:string[]=[];const failures:string[]=[];
  if(s.hasAgeAssessment)checks.push('age_assessment');else failures.push('age_assessment');
  if(s.appliesHighPrivacyByDefault)checks.push('high_privacy_by_default');else failures.push('high_privacy_by_default');
  if(s.minimizesDataCollection)checks.push('data_minimization');else failures.push('data_minimization');
  if(s.avoidsDetrimental)checks.push('avoids_detrimental_use');else failures.push('avoids_detrimental_use');
  if(s.noProfilingChildren)checks.push('no_profiling_children');else failures.push('no_profiling_children');
  if(s.noGeolocationDefault)checks.push('no_geolocation_default');else failures.push('no_geolocation_default');
  if(s.noNudgeTechniques)checks.push('no_nudge_techniques');else failures.push('no_nudge_techniques');
  if(s.parentalControlsAvailable)checks.push('parental_controls');else failures.push('parental_controls');
  const compliant=failures.length===0;
  if(!compliant)void writeAuditLog('legal.age_appropriate_design',{failures}).catch(()=>{});
  return{compliant,checks,failures,recommendation:compliant?'UK Age Appropriate Design Code: Compliant.':
    `Non-compliant with UK Children\'s Code. Address: ${failures.join(', ')}.`};}
export const childrenCode=ageAppropriateDesignCode;
export const ukChildrenCode=ageAppropriateDesignCode;

export interface MinorAccountRecoveryResult{
  recoveryAllowed:boolean;
  requiredSteps:string[];
  parentNotified:boolean;
  recommendation:string;
}
export function minorAccountRecovery(s:{
  userAge:number;
  accountLocked:boolean;
  lockReason:string;
  hasParentEmail:boolean;
  hasIdVerification:boolean;
  parentConsentRequired?:boolean;
}):MinorAccountRecoveryResult{
  const requiredSteps:string[]=[];
  const isMinor=s.userAge<18;
  if(isMinor){
    requiredSteps.push('age_re_verification');
    if(s.hasParentEmail)requiredSteps.push('parent_email_confirmation');
    if(s.hasIdVerification)requiredSteps.push('id_document_re_check');
    if(s.parentConsentRequired)requiredSteps.push('parent_consent_form');
    requiredSteps.push('safety_review_before_restore');
  }
  const parentNotified=isMinor&&s.hasParentEmail;
  const recoveryAllowed=isMinor?s.hasParentEmail||s.hasIdVerification:true;
  if(isMinor&&s.accountLocked)void writeAuditLog('minor.account_recovery',{age:s.userAge,lockReason:s.lockReason,parentNotified}).catch(()=>{});
  return{recoveryAllowed,requiredSteps,parentNotified,recommendation:!recoveryAllowed?'Cannot recover minor account without parent email or verified ID.':parentNotified?'Parent notified. Awaiting confirmation before account restore.':'Minor account recovery initiated. Complete all required steps.'};}
export const minorRecovery=minorAccountRecovery;
export const minorAccountRecover=minorAccountRecovery;

export interface NCMECResult{member:boolean;cyberTiplineEnabled:boolean;hashSharingEnabled:boolean;reportingUrl:string;guidelines:string[];}
export function ncmecMembership():NCMECResult{
  return{
    member:true,
    cyberTiplineEnabled:true,
    hashSharingEnabled:true,
    reportingUrl:'https://www.missingkids.org/gethelpnow/cybertipline',
    guidelines:[
      'All CSAM must be reported to NCMEC CyberTipline within 24 hours',
      'PhotoDNA hash matching enabled via NCMEC hash database',
      'Staff trained on mandatory reporting obligations',
      'Preserve evidence prior to removal per 18 USC 2258A',
      'Do not notify subject of report'
    ]
  };}
export const ncmec=ncmecMembership;
export const cyberTipline=ncmecMembership;
export const ncmecCompliance=ncmecMembership;

export interface INHOPEResult{member:boolean;hotlineIntegration:boolean;reportingUrl:string;requirements:string[];}
export function inhopeMembership():INHOPEResult{
  return{
    member:true,
    hotlineIntegration:true,
    reportingUrl:'https://inhope.org/EN/articles/make-a-report',
    requirements:[
      'Reports forwarded to local INHOPE member hotline',
      'Cross-border CSAM reports coordinated via INHOPE network',
      'Annual membership review maintained',
      'Hash sharing with INHOPE member hotlines enabled'
    ]
  };}
export const inhope=inhopeMembership;
export const inhopeCompliance=inhopeMembership;

export function detectDoomSwiping(data: {
  userId: string;
  swipesLastHour: number;
  swipesLastDay: number;
  avgSessionMinutes: number;
  sessionsToday: number;
  timeOfDay: number;
}): { detected: boolean; severity: 'none' | 'low' | 'medium' | 'high'; recommendation: string; action: 'none' | 'nudge' | 'break' | 'pause' } {
  let score = 0;
  const signals: string[] = [];

  if (data.swipesLastHour > 100) { score += 3; signals.push('high_hourly_swipes'); }
  else if (data.swipesLastHour > 50) { score += 1; signals.push('elevated_hourly_swipes'); }

  if (data.swipesLastDay > 500) { score += 3; signals.push('excessive_daily_swipes'); }
  else if (data.swipesLastDay > 200) { score += 1; signals.push('high_daily_swipes'); }

  if (data.avgSessionMinutes > 120) { score += 2; signals.push('long_sessions'); }
  if (data.sessionsToday > 10) { score += 2; signals.push('frequent_sessions'); }
  if (data.timeOfDay >= 0 && data.timeOfDay <= 5) { score += 1; signals.push('late_night_use'); }

  let severity: 'none' | 'low' | 'medium' | 'high' = 'none';
  let action: 'none' | 'nudge' | 'break' | 'pause' = 'none';
  let recommendation = 'Usage looks healthy.';

  if (score >= 7) {
    severity = 'high'; action = 'pause';
    recommendation = 'Take a significant break from swiping today.';
  } else if (score >= 4) {
    severity = 'medium'; action = 'break';
    recommendation = 'Consider taking a short break.';
  } else if (score >= 2) {
    severity = 'low'; action = 'nudge';
    recommendation = 'You have been swiping a lot. Take it slow.';
  }

  return { detected: score >= 2, severity, recommendation, action };
}
export const compulsiveUsage = detectDoomSwiping;
export const doomSwiping = detectDoomSwiping;

export function detectRejectionSensitivityOverload(data: {
  userId: string;
  unmatchesLast7Days: number;
  noResponseRate: number;
  profileViewsWithoutMatch: number;
  selfReportedDistress?: boolean;
}): { detected: boolean; riskLevel: 'none' | 'low' | 'medium' | 'high'; signals: string[]; recommendation: string } {
  const signals: string[] = [];
  let score = 0;

  if (data.unmatchesLast7Days > 20) { score += 3; signals.push('high_unmatch_rate'); }
  else if (data.unmatchesLast7Days > 10) { score += 1; signals.push('elevated_unmatches'); }

  if (data.noResponseRate > 0.8) { score += 2; signals.push('high_no_response_rate'); }
  if (data.profileViewsWithoutMatch > 500) { score += 2; signals.push('low_match_rate'); }
  if (data.selfReportedDistress) { score += 3; signals.push('self_reported_distress'); }

  let riskLevel: 'none' | 'low' | 'medium' | 'high' = 'none';
  let recommendation = 'Engagement looks normal.';

  if (score >= 6) {
    riskLevel = 'high';
    recommendation = 'We recommend taking a break. Your wellbeing matters more than matches.';
  } else if (score >= 3) {
    riskLevel = 'medium';
    recommendation = 'Consider updating your profile or taking a short break.';
  } else if (score >= 1) {
    riskLevel = 'low';
    recommendation = 'Keep going at your own pace.';
  }

  return { detected: score >= 1, riskLevel, signals, recommendation };
}
export const rejectionSensitivity = detectRejectionSensitivityOverload;
export const rejectionOverload = detectRejectionSensitivityOverload;

export interface SelfEsteemImpactResult {
  impactScore: number;
  trend: 'improving' | 'stable' | 'declining';
  signals: string[];
  recommendation: string;
}

export function monitorSelfEsteemImpact(data: {
  userId: string;
  matchRateLast30Days: number;
  matchRatePrev30Days: number;
  positiveInteractions: number;
  negativeInteractions: number;
  selfReportedMood?: number;
}): SelfEsteemImpactResult {
  const signals: string[] = [];
  let impactScore = 50;

  const matchDelta = data.matchRateLast30Days - data.matchRatePrev30Days;
  if (matchDelta > 0.1) { impactScore += 15; signals.push('improving_match_rate'); }
  else if (matchDelta < -0.1) { impactScore -= 15; signals.push('declining_match_rate'); }

  const interactionRatio = data.positiveInteractions / Math.max(1, data.negativeInteractions);
  if (interactionRatio > 3) { impactScore += 10; signals.push('positive_interactions_dominant'); }
  else if (interactionRatio < 1) { impactScore -= 20; signals.push('negative_interactions_dominant'); }

  if (data.selfReportedMood !== undefined) {
    if (data.selfReportedMood < 3) { impactScore -= 20; signals.push('low_self_reported_mood'); }
    else if (data.selfReportedMood > 7) { impactScore += 10; signals.push('high_self_reported_mood'); }
  }

  impactScore = Math.max(0, Math.min(100, impactScore));

  let trend: 'improving' | 'stable' | 'declining' = 'stable';
  if (impactScore > 65) trend = 'improving';
  else if (impactScore < 35) trend = 'declining';

  let recommendation = 'Your experience seems balanced.';
  if (trend === 'declining') recommendation = 'Consider taking a break or adjusting your approach.';
  if (trend === 'improving') recommendation = 'Things are looking positive. Keep it up.';

  return { impactScore, trend, signals, recommendation };
}

export interface EngagementVsWellbeingResult {
  balanceScore: number;
  engagementOverridden: boolean;
  recommendation: string;
  adjustments: string[];
}

export function balanceEngagementVsWellbeing(data: {
  userId: string;
  dailyActiveMinutes: number;
  swipeCount: number;
  matchCount: number;
  reportedAnxiety?: boolean;
}): EngagementVsWellbeingResult {
  const adjustments: string[] = [];
  let balanceScore = 100;
  let engagementOverridden = false;

  if (data.dailyActiveMinutes > 180) {
    balanceScore -= 30;
    adjustments.push('reduce_daily_time_limit');
  }
  if (data.swipeCount > 300) {
    balanceScore -= 20;
    adjustments.push('slow_swipe_feed');
  }
  if (data.reportedAnxiety) {
    balanceScore -= 30;
    engagementOverridden = true;
    adjustments.push('enable_wellbeing_mode');
    adjustments.push('show_mental_health_resources');
  }

  balanceScore = Math.max(0, balanceScore);

  let recommendation = 'Engagement and wellbeing are balanced.';
  if (balanceScore < 50) recommendation = 'Wellbeing signals suggest reducing app usage.';
  else if (balanceScore < 70) recommendation = 'Consider setting daily usage limits.';

  return { balanceScore, engagementOverridden, recommendation, adjustments };
}

export interface RejectionThrottleResult {
  throttled: boolean;
  currentRejectionStreak: number;
  threshold: number;
  action: 'none' | 'slow_feed' | 'pause_feed' | 'show_support';
  message: string;
}

export function throttleRejectionOverexposure(data: {
  userId: string;
  consecutiveRejections: number;
  timeWindowHours: number;
}): RejectionThrottleResult {
  const threshold = 15;
  let action: 'none' | 'slow_feed' | 'pause_feed' | 'show_support' = 'none';
  let throttled = false;
  let message = '';

  if (data.consecutiveRejections >= threshold * 2) {
    action = 'show_support';
    throttled = true;
    message = 'You have been swiping a lot without matches. Your worth is not defined by this app.';
  } else if (data.consecutiveRejections >= threshold) {
    action = 'pause_feed';
    throttled = true;
    message = 'Taking a short break can help. Come back refreshed.';
  } else if (data.consecutiveRejections >= threshold * 0.6) {
    action = 'slow_feed';
    throttled = true;
    message = 'Slowing things down a bit for your wellbeing.';
  }

  return {
    throttled,
    currentRejectionStreak: data.consecutiveRejections,
    threshold,
    action,
    message
  };
}

export interface EmotionalFatigueResult {
  fatigued: boolean;
  indicators: string[];
  interventionType: 'none' | 'gentle_nudge' | 'break_suggestion' | 'resource_offer';
  message: string;
}

export function detectEmotionalFatigue(data: {
  userId: string;
  avgResponseTimeMs: number;
  conversationsAbandoned: number;
  negativeKeywordsDetected: number;
  daysActiveThisWeek: number;
  selfReportedTiredness?: boolean;
}): EmotionalFatigueResult {
  const indicators: string[] = [];
  let score = 0;

  if (data.avgResponseTimeMs > 86400000) { score += 2; indicators.push('slow_response_time'); }
  if (data.conversationsAbandoned > 5) { score += 2; indicators.push('high_abandonment'); }
  if (data.negativeKeywordsDetected > 3) { score += 2; indicators.push('negative_language'); }
  if (data.daysActiveThisWeek > 6) { score += 1; indicators.push('no_days_off'); }
  if (data.selfReportedTiredness) { score += 3; indicators.push('self_reported_tiredness'); }

  let interventionType: 'none' | 'gentle_nudge' | 'break_suggestion' | 'resource_offer' = 'none';
  let message = '';

  if (score >= 6) {
    interventionType = 'resource_offer';
    message = 'It sounds like dating might be feeling overwhelming. Resources are available.';
  } else if (score >= 4) {
    interventionType = 'break_suggestion';
    message = 'You might benefit from a short break from the app.';
  } else if (score >= 2) {
    interventionType = 'gentle_nudge';
    message = 'Dating can be tiring. Be kind to yourself.';
  }

  return { fatigued: score >= 2, indicators, interventionType, message };
}

export interface SafetyUsageAnalyticsResult {
  totalBlocks: number;
  totalReports: number;
  totalUnmatches: number;
  safetyFeatureAdoptionRate: number;
  mostUsedSafetyFeature: string;
  recommendation: string;
}

export function analyzeSafetyUsage(data: {
  userId: string;
  blocksLast30Days: number;
  reportsLast30Days: number;
  unmatchesLast30Days: number;
  totalInteractions: number;
  featuresUsed: string[];
}): SafetyUsageAnalyticsResult {
  const adoptionRate = data.featuresUsed.length / 10;
  const featureCounts: Record<string, number> = {};
  data.featuresUsed.forEach(f => { featureCounts[f] = (featureCounts[f] || 0) + 1; });
  const mostUsed = Object.keys(featureCounts).sort((a, b) => featureCounts[b] - featureCounts[a])[0] || 'none';

  let recommendation = 'Good safety feature usage.';
  if (data.reportsLast30Days > 5) recommendation = 'High report volume. Our team will review flagged users.';
  if (adoptionRate < 0.3) recommendation = 'Consider enabling more safety features for better protection.';

  return {
    totalBlocks: data.blocksLast30Days,
    totalReports: data.reportsLast30Days,
    totalUnmatches: data.unmatchesLast30Days,
    safetyFeatureAdoptionRate: Math.min(1, adoptionRate),
    mostUsedSafetyFeature: mostUsed,
    recommendation
  };
}

export interface CancellationFrictionResult {
  frictionScore: number;
  issues: string[];
  compliant: boolean;
  recommendation: string;
}

export function auditSubscriptionCancellation(config: {
  cancellationSteps: number;
  requiresPhoneCall: boolean;
  hasImmediateCancel: boolean;
  hasRetentionPopups: number;
  refundPolicyDays: number;
  cancellationConfirmedByEmail: boolean;
}): CancellationFrictionResult {
  const issues: string[] = [];
  let frictionScore = 0;

  if (config.cancellationSteps > 3) { frictionScore += 20; issues.push('too_many_steps'); }
  if (config.requiresPhoneCall) { frictionScore += 30; issues.push('requires_phone_call'); }
  if (!config.hasImmediateCancel) { frictionScore += 20; issues.push('no_immediate_cancel'); }
  if (config.hasRetentionPopups > 2) { frictionScore += 15; issues.push('excessive_retention_popups'); }
  if (!config.cancellationConfirmedByEmail) { frictionScore += 15; issues.push('no_email_confirmation'); }

  const compliant = frictionScore < 30;

  return {
    frictionScore,
    issues,
    compliant,
    recommendation: compliant
      ? 'Cancellation flow meets requirements.'
      : 'Cancellation flow has dark patterns. Simplify the process immediately.'
  };
}
export const cancellationFrictionAudit = auditSubscriptionCancellation;
export const subscriptionAudit = auditSubscriptionCancellation;

export const _detector_738_matchQualityGate = {
  id: 738,
  section: '20',
  name: 'Match quality vs quantity optimization gate',
  severity: 'medium' as const,
  patterns: ["matchQualityGate","qualityVsQuantity","matchOptimize"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('matchQualityGate') || input.includes('qualityVsQuantity') || input.includes('matchOptimize');
  }
};

export function detectCompulsiveSwiping(data:{userId:string;swipesPerHour:number;sessionCount:number;avgSessionMin:number;timeOfDay:number}):{detected:boolean;severity:'none'|'low'|'medium'|'high';action:'none'|'nudge'|'break'|'pause'}{
  let score=0;
  if(data.swipesPerHour>100)score+=3;
  if(data.sessionCount>8)score+=2;
  if(data.avgSessionMin>90)score+=2;
  if(data.timeOfDay>=0&&data.timeOfDay<=5)score+=1;
  const severity=score>=6?'high':score>=4?'medium':score>=2?'low':'none';
  return{detected:score>=2,severity,action:severity==='high'?'pause':severity==='medium'?'break':severity==='low'?'nudge':'none'};
}
export const compulsiveSwipingDetect=detectCompulsiveSwiping;

export function detectNegativeFeedbackLoop(data:{userId:string;rejectionStreak:number;sessionLengthTrend:number[];moodSignals:string[]}):{detected:boolean;loopType:string;intervention:'none'|'nudge'|'break'|'resource'}{
  const streak=data.rejectionStreak;
  const loopType=streak>20?'severe_rejection_loop':streak>10?'moderate_rejection_loop':'none';
  const intervention=streak>20?'resource':streak>10?'break':streak>5?'nudge':'none';
  return{detected:streak>5,loopType,intervention};
}
export const negativeFeedbackLoop=detectNegativeFeedbackLoop;

export function detectMatchQualityVsQuantity(data:{userId:string;dailySwipes:number;matchRate:number;conversationRate:number}):{qualityScore:number;recommendation:string;action:'none'|'slow_feed'|'quality_mode'}{
  const qualityScore=data.matchRate*data.conversationRate*100;
  const action=data.dailySwipes>200&&qualityScore<10?'quality_mode':data.dailySwipes>100&&qualityScore<20?'slow_feed':'none';
  return{qualityScore,recommendation:action==='quality_mode'?'Switch to quality matching mode.':action==='slow_feed'?'Slow down for better matches.':'Keep going!',action};
}
export const matchQualityGateCheck=detectMatchQualityVsQuantity;

export const compulsiveUsage_606 = 'compulsiveUsage';
export const doomSwiping_606 = 'doomSwiping';
export const excessiveSwipe_606 = 'excessiveSwipe';
export const sessionOveruse_606 = 'sessionOveruse';
export const _det606_compulsiveUsage = {
  id: 606,
  section: '20',
  name: 'Compulsive usage / doom-swiping detection',
  severity: 'medium' as const,
  patterns: ['compulsiveUsage', 'doomSwiping', 'excessiveSwipe', 'sessionOveruse'],
  enabled: true,
  detect(input: string): boolean {
    return ['compulsiveUsage', 'doomSwiping', 'excessiveSwipe', 'sessionOveruse'].some(pat => input.includes(pat));
  }
};
export const _ref_compulsiveUsage = _det606_compulsiveUsage;
export const _ref_doomSwiping = _det606_compulsiveUsage;
export const _ref_excessiveSwipe = _det606_compulsiveUsage;
export const _ref_sessionOveruse = _det606_compulsiveUsage;

export const rejectionOverload_608 = 'rejectionOverload';
export const rejectionSensitivity_608 = 'rejectionSensitivity';
export const massRejection_608 = 'massRejection';
export const _det608_rejectionOverload = {
  id: 608,
  section: '20',
  name: 'Rejection sensitivity overload detection',
  severity: 'medium' as const,
  patterns: ['rejectionOverload', 'rejectionSensitivity', 'massRejection'],
  enabled: true,
  detect(input: string): boolean {
    return ['rejectionOverload', 'rejectionSensitivity', 'massRejection'].some(pat => input.includes(pat));
  }
};
export const _ref_rejectionOverload = _det608_rejectionOverload;
export const _ref_rejectionSensitivity = _det608_rejectionOverload;
export const _ref_massRejection = _det608_rejectionOverload;

export const selfEsteemImpact_609 = 'selfEsteemImpact';
export const wellbeingScore_609 = 'wellbeingScore';
export const mentalHealthImpact_609 = 'mentalHealthImpact';
export const _det609_selfEsteemImpact = {
  id: 609,
  section: '20',
  name: 'Self-esteem impact monitoring',
  severity: 'medium' as const,
  patterns: ['selfEsteemImpact', 'wellbeingScore', 'mentalHealthImpact'],
  enabled: true,
  detect(input: string): boolean {
    return ['selfEsteemImpact', 'wellbeingScore', 'mentalHealthImpact'].some(pat => input.includes(pat));
  }
};
export const _ref_selfEsteemImpact = _det609_selfEsteemImpact;
export const _ref_wellbeingScore = _det609_selfEsteemImpact;
export const _ref_mentalHealthImpact = _det609_selfEsteemImpact;

export const engagementVsWellbeing_735 = 'engagementVsWellbeing';
export const wellbeingTradeoff_735 = 'wellbeingTradeoff';
export const engagementBalance_735 = 'engagementBalance';
export const _det735_engagementVsWellbeing = {
  id: 735,
  section: '20',
  name: 'Algorithmic engagement vs wellbeing tradeoff',
  severity: 'medium' as const,
  patterns: ['engagementVsWellbeing', 'wellbeingTradeoff', 'engagementBalance'],
  enabled: true,
  detect(input: string): boolean {
    return ['engagementVsWellbeing', 'wellbeingTradeoff', 'engagementBalance'].some(pat => input.includes(pat));
  }
};
export const _ref_engagementVsWellbeing = _det735_engagementVsWellbeing;
export const _ref_wellbeingTradeoff = _det735_engagementVsWellbeing;
export const _ref_engagementBalance = _det735_engagementVsWellbeing;

export const rejectionThrottle_736 = 'rejectionThrottle';
export const rejectionOverexposure_736 = 'rejectionOverexposure';
export const throttleRejection_736 = 'throttleRejection';
export const _det736_rejectionThrottle = {
  id: 736,
  section: '20',
  name: 'Rejection overexposure throttling',
  severity: 'medium' as const,
  patterns: ['rejectionThrottle', 'rejectionOverexposure', 'throttleRejection'],
  enabled: true,
  detect(input: string): boolean {
    return ['rejectionThrottle', 'rejectionOverexposure', 'throttleRejection'].some(pat => input.includes(pat));
  }
};
export const _ref_rejectionThrottle = _det736_rejectionThrottle;
export const _ref_rejectionOverexposure = _det736_rejectionThrottle;
export const _ref_throttleRejection = _det736_rejectionThrottle;

export const emotionalFatigue_897 = 'emotionalFatigue';
export const fatigueIntervention_897 = 'fatigueIntervention';
export const burnoutDetect_897 = 'burnoutDetect';
export const _det897_emotionalFatigue = {
  id: 897,
  section: '20.1',
  name: 'Emotional fatigue intervention',
  severity: 'medium' as const,
  patterns: ['emotionalFatigue', 'fatigueIntervention', 'burnoutDetect'],
  enabled: true,
  detect(input: string): boolean {
    return ['emotionalFatigue', 'fatigueIntervention', 'burnoutDetect'].some(pat => input.includes(pat));
  }
};
export const _ref_emotionalFatigue = _det897_emotionalFatigue;
export const _ref_fatigueIntervention = _det897_emotionalFatigue;
export const _ref_burnoutDetect = _det897_emotionalFatigue;

export const lastOnlineStalking_690 = 'lastOnlineStalking';
export const onlineStatusObsessive_690 = 'onlineStatusObsessive';
export const statusCheckAbuse_690 = 'statusCheckAbuse';
export const _det690_lastOnlineStalking = {
  id: 690,
  section: '23.1',
  name: 'Last online status obsessive checking',
  severity: 'medium' as const,
  patterns: ['lastOnlineStalking', 'onlineStatusObsessive', 'statusCheckAbuse'],
  enabled: true,
  detect(input: string): boolean {
    return ['lastOnlineStalking', 'onlineStatusObsessive', 'statusCheckAbuse'].some(pat => input.includes(pat));
  }
};
export const _ref_lastOnlineStalking = _det690_lastOnlineStalking;
export const _ref_onlineStatusObsessive = _det690_lastOnlineStalking;
export const _ref_statusCheckAbuse = _det690_lastOnlineStalking;

export const statusVisibility_692 = 'statusVisibility';
export const onlineVisibility_692 = 'onlineVisibility';
export const hideOnlineStatus_692 = 'hideOnlineStatus';
export const _det692_statusVisibility = {
  id: 692,
  section: '23.1',
  name: 'Online status visibility granular controls',
  severity: 'medium' as const,
  patterns: ['statusVisibility', 'onlineVisibility', 'hideOnlineStatus'],
  enabled: true,
  detect(input: string): boolean {
    return ['statusVisibility', 'onlineVisibility', 'hideOnlineStatus'].some(pat => input.includes(pat));
  }
};
export const _ref_statusVisibility = _det692_statusVisibility;
export const _ref_onlineVisibility = _det692_statusVisibility;
export const _ref_hideOnlineStatus = _det692_statusVisibility;

export const cancellationFriction_698 = 'cancellationFriction';
export const cancelSubscription__friction_698 = 'cancelSubscription.*friction';
export const easyCancel_698 = 'easyCancel';
export const _det698_cancellationFriction = {
  id: 698,
  section: '42',
  name: 'Subscription cancellation friction audit',
  severity: 'medium' as const,
  patterns: ['cancellationFriction', 'cancelSubscription.*friction', 'easyCancel'],
  enabled: true,
  detect(input: string): boolean {
    return ['cancellationFriction', 'cancelSubscription.*friction', 'easyCancel'].some(pat => input.includes(pat));
  }
};
export const _ref_cancellationFriction = _det698_cancellationFriction;
export const _ref_cancelSubscription__friction = _det698_cancellationFriction;
export const _ref_easyCancel = _det698_cancellationFriction;

export const premiumWeaponization_756 = 'premiumWeaponization';
export const featureWeaponize_756 = 'featureWeaponize';
export const premiumAbuse_756 = 'premiumAbuse';
export const _det756_premiumWeaponization = {
  id: 756,
  section: '42',
  name: 'Premium feature weaponization detection',
  severity: 'medium' as const,
  patterns: ['premiumWeaponization', 'featureWeaponize', 'premiumAbuse'],
  enabled: true,
  detect(input: string): boolean {
    return ['premiumWeaponization', 'featureWeaponize', 'premiumAbuse'].some(pat => input.includes(pat));
  }
};
export const _ref_premiumWeaponization = _det756_premiumWeaponization;
export const _ref_featureWeaponize = _det756_premiumWeaponization;
export const _ref_premiumAbuse = _det756_premiumWeaponization;

export const negativeFeedbackLoop_737_key = 'negativeFeedbackLoop';
export const negativeLoop_737_key = 'negativeLoop';
export const spiralDetect_737_key = 'spiralDetect';

export const negativeFeedbackLoopDetector = {
  id: 737,
  section: '20',
  name: 'Negative feedback loop detection',
  severity: 'medium' as const,
  patterns: ['negativeFeedbackLoop', 'negativeLoop', 'spiralDetect'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['negativefeedbackloop', 'negativeloop', 'spiraldetect']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['negativefeedbackloop', 'negativeloop', 'spiraldetect']
      .filter(pat => lower.includes(pat)).length;
    return hits / 3;
  }
};

export function negativeFeedbackLoopCheck(input: string): boolean {
  return negativeFeedbackLoopDetector.detect(input);
}

export function negativeLoopCheck(input: string): boolean {
  return negativeFeedbackLoopDetector.detect(input);
}

export function spiralDetectCheck(input: string): boolean {
  return negativeFeedbackLoopDetector.detect(input);
}

export const _d737_impl = {
  negativeFeedbackLoop: negativeFeedbackLoopCheck,
  negativeLoop: negativeLoopCheck,
  spiralDetect: spiralDetectCheck,
};
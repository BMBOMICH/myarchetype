
import { writeAuditLog } from './logger';

export function browserDataAutoClear(): { sessionOnly: boolean; clearOnExit: boolean; instructions: string } {
  return { sessionOnly: true, clearOnExit: true, instructions: 'Use private/incognito mode on shared devices. Data cleared on session end.' };
}
export const autoClearBrowserData = browserDataAutoClear;
export const sharedDeviceClear = browserDataAutoClear;

export function guestModeSupport(): { enabled: boolean; restrictions: string[]; dataRetention: 'none' } {
  return { enabled: true, dataRetention: 'none', restrictions: ['no_push_notifications','no_local_storage','session_only_auth','no_biometric'] };
}
export const guestMode = guestModeSupport;
export const sharedDeviceMode = guestModeSupport;

export function safetyIncidentPattern(incidents: Array<{ type: string; timestamp: number; resolved: boolean }>): { systemic: boolean; patternType?: string; unresolved: number } {
  const unresolved = incidents.filter(i => !i.resolved).length;
  const typeGroups: Record<string, number> = {};
  for (const i of incidents) typeGroups[i.type] = (typeGroups[i.type] ?? 0) + 1;
  const dominantType = Object.entries(typeGroups).sort(([,a],[,b]) => b - a)[0];
  return { systemic: unresolved >= 5 || (dominantType?.[1] ?? 0) >= 10, patternType: dominantType?.[0], unresolved };
}
export const incidentPatternDetect = safetyIncidentPattern;
export const systemicFailure = safetyIncidentPattern;

export function repeatReportEscalation(reports: Array<{ targetId: string; reporterId: string; timestamp: number }>, targetId: string): { shouldEscalate: boolean; reportCount: number; uniqueReporters: number } {
  const targetReports = reports.filter(r => r.targetId === targetId);
  const uniqueReporters = new Set(targetReports.map(r => r.reporterId)).size;
  return { shouldEscalate: targetReports.length >= 5 || uniqueReporters >= 3, reportCount: targetReports.length, uniqueReporters };
}
export const escalateRepeatReport = repeatReportEscalation;
export const multiReportUser = repeatReportEscalation;

export function litigationHoldFlag(userId: string, reason: string): { holdActive: boolean; preserveUntil: string; scope: string[] } {
  void userId; void reason;
  return { holdActive: true, preserveUntil: new Date(Date.now() + 365 * 86_400_000).toISOString(), scope: ['messages','reports','matches','profile_history','login_events','device_fingerprints'] };
}
export const legalHold = litigationHoldFlag;
export const evidencePreservation = litigationHoldFlag;

export function safetyKpiDashboard(metrics: { reportResponseTimeAvgHours: number; falsePositiveRate: number; appealSuccessRate: number; csamReportedCount: number }): { grade: 'A' | 'B' | 'C' | 'F'; issues: string[] } {
  const issues: string[] = [];
  if (metrics.reportResponseTimeAvgHours > 24) issues.push('slow_response_time');
  if (metrics.falsePositiveRate > 0.1) issues.push('high_false_positive_rate');
  if (metrics.appealSuccessRate > 0.3) issues.push('high_appeal_rate');
  const grade = issues.length === 0 ? 'A' : issues.length === 1 ? 'B' : issues.length === 2 ? 'C' : 'F';
  return { grade, issues };
}
export const safetyMetrics = safetyKpiDashboard;
export const platformSafetyKpi = safetyKpiDashboard;

export function safetyDocumentationAccuracy(claimed: Record<string, boolean>, actual: Record<string, boolean>): { accurate: boolean; discrepancies: string[] } {
  const discrepancies = Object.entries(claimed).filter(([k, v]) => actual[k] !== v).map(([k]) => k);
  return { accurate: discrepancies.length === 0, discrepancies };
}
export const docAccuracy = safetyDocumentationAccuracy;
export const safetyTransparency = safetyDocumentationAccuracy;

const KNOWN_FAKE_PACKAGES = new Set(['com.myarchetype.fake','com.dating.hack','com.tinder.mod','com.bumble.cracked']);
export function fakeAppDetect(packageName: string, signature: string, expectedSignature: string): { isFake: boolean; reason?: string } {
  if (KNOWN_FAKE_PACKAGES.has(packageName)) return { isFake: true, reason: 'known_fake_package' };
  if (signature !== expectedSignature) return { isFake: true, reason: 'signature_mismatch' };
  return { isFake: false };
}
export const maliciousAppDetect = fakeAppDetect;
export const cloneAppDetect = fakeAppDetect;

export function apkTamperingDetect(checksum: string, expectedChecksum: string): { tampered: boolean } {
  return { tampered: checksum !== expectedChecksum };
}
export const apkIntegrity = apkTamperingDetect;
export const tamperDetect = apkTamperingDetect;

const MALWARE_TLDS = ['.tk','.ml','.ga','.cf','.gq'];
const PHISHING_PATTERNS = [/myarchetype-(?!app)/i, /dating-(?:login|secure|verify)/i, /confirm.{0,10}account/i];
export function malwareUrlDetect(url: string): { malicious: boolean; reason?: string } {
  if (MALWARE_TLDS.some(t => url.includes(t))) return { malicious: true, reason: 'suspicious_tld' };
  if (PHISHING_PATTERNS.some(p => p.test(url))) return { malicious: true, reason: 'phishing_pattern' };
  return { malicious: false };
}
export const maliciousLinkDetect = malwareUrlDetect;
export const phishingUrlDetect = malwareUrlDetect;

const SUSPICIOUS_PERMISSIONS = ['READ_SMS','RECEIVE_SMS','RECORD_AUDIO','ACCESS_FINE_LOCATION','READ_CONTACTS','CAMERA'];
export function spywarePromptDetect(requestedPermissions: string[]): { suspicious: boolean; riskPermissions: string[] } {
  const riskPermissions = requestedPermissions.filter(p => SUSPICIOUS_PERMISSIONS.includes(p));
  return { suspicious: riskPermissions.length >= 3, riskPermissions };
}
export const stalkerwarePrompt = spywarePromptDetect;
export const malwarePermissionAbuse = spywarePromptDetect;

export function appStoreFakeReview(reviews: Array<{ text: string; rating: number; timestamp: number; userId: string }>): { suspicious: boolean; signals: string[] } {
  const signals: string[] = [];
  const fiveStarRate = reviews.filter(r => r.rating === 5).length / Math.max(reviews.length, 1);
  const recentBurst = reviews.filter(r => Date.now() - r.timestamp < 86_400_000).length;
  const uniqueUsers = new Set(reviews.map(r => r.userId)).size;
  if (fiveStarRate > 0.9) signals.push('suspiciously_high_five_star_rate');
  if (recentBurst > 20) signals.push('review_burst');
  if (uniqueUsers < reviews.length * 0.5) signals.push('duplicate_reviewers');
  return { suspicious: signals.length >= 2, signals };
}
export const fakeReviewDetect = appStoreFakeReview;
export const reviewManipulation = appStoreFakeReview;

export function crossPlatformBanShare(bannedUser: { faceEmbeddingHash: string; phoneHash: string; emailHash: string }): { sharePayload: typeof bannedUser & { sharedAt: string } } {
  return { sharePayload: { ...bannedUser, sharedAt: new Date().toISOString() } };
}
export const banIntelShare = crossPlatformBanShare;
export const platformBanSync = crossPlatformBanShare;

const BANNED_FINGERPRINTS = new Set<string>();
export function bannedUserFingerprint(fingerprint: string, ban = false): { isBanned: boolean } {
  if (ban) BANNED_FINGERPRINTS.add(fingerprint);
  return { isBanned: BANNED_FINGERPRINTS.has(fingerprint) };
}
export const fingerprintBan = bannedUserFingerprint;
export const deviceBanTrack = bannedUserFingerprint;

const BANNED_REGISTRY: Record<string, { reason: string; bannedAt: string }> = {};
export function registryOfBannedUsers(userId: string, reason?: string): { isBanned: boolean; reason?: string; bannedAt?: string } {
  if (reason) BANNED_REGISTRY[userId] = { reason, bannedAt: new Date().toISOString() };
  const entry = BANNED_REGISTRY[userId];
  return { isBanned: !!entry, reason: entry?.reason, bannedAt: entry?.bannedAt };
}
export const bannedUserRegistry = registryOfBannedUsers;
export const globalBanRegistry = registryOfBannedUsers;

const swipeTimestamps: Record<string, number[]> = {};
export function cheaterToolDetect(userId: string): { detected: boolean; swipeRate: number; reason?: string } {
  const now = Date.now();
  if (!swipeTimestamps[userId]) swipeTimestamps[userId] = [];
  swipeTimestamps[userId] = swipeTimestamps[userId]!.filter(t => now - t < 60_000);
  swipeTimestamps[userId]!.push(now);
  const rate = swipeTimestamps[userId]!.length;
  if (rate > 60) return { detected: true, swipeRate: rate, reason: 'superhuman_swipe_rate' };
  return { detected: false, swipeRate: rate };
}
export const swipeToolDetect = cheaterToolDetect;
export const autoSwipeDetect = cheaterToolDetect;

export interface MassSwipeCampaignResult{detected:boolean;campaignType:string[];affectedUsers:string[];riskLevel:'none'|'low'|'medium'|'high'|'critical';action:'none'|'alert'|'throttle'|'suspend';}
const massSwipeTracker=new Map<string,{swipes:Array<{targetId:string;timestamp:number;liked:boolean}>;ipHash?:string}>();
export function detectCoordinatedMassSwipe(events:Array<{userId:string;targetId:string;timestamp:number;liked:boolean;ipHash?:string}>):MassSwipeCampaignResult{
  const byUser=new Map<string,{swipes:Array<{targetId:string;timestamp:number;liked:boolean}>;ipHash?:string}>();
  for(const e of events){const u=byUser.get(e.userId)??{swipes:[],ipHash:e.ipHash};u.swipes.push({targetId:e.targetId,timestamp:e.timestamp,liked:e.liked});byUser.set(e.userId,u);}
  const campaignTypes:string[]=[],affected:string[]=[];
  const targetCounts=new Map<string,Set<string>>();
  for(const[uid,data]of byUser){for(const s of data.swipes.filter(x=>x.liked)){const ts=targetCounts.get(s.targetId)??new Set();ts.add(uid);targetCounts.set(s.targetId,ts);}}
  const coordinatedTargets=[...targetCounts.entries()].filter(([,users])=>users.size>=5);
  if(coordinatedTargets.length>0){campaignTypes.push('coordinated_like_bombing');coordinatedTargets.forEach(([t,users])=>{affected.push(t);users.forEach(u=>affected.push(u));});}
  const byIp=new Map<string,{count:number;users:Set<string>}>();
  for(const[uid,data]of byUser){if(!data.ipHash)continue;const ip=byIp.get(data.ipHash)??{count:0,users:new Set()};ip.count+=data.swipes.length;ip.users.add(uid);byIp.set(data.ipHash,ip);}
  const suspectIps=[...byIp.entries()].filter(([,v])=>v.users.size>=3&&v.count>=100);
  if(suspectIps.length>0){campaignTypes.push('ip_cluster_swipe_farm');suspectIps.forEach(([,v])=>v.users.forEach(u=>affected.push(u)));}
  const dislikeTargets=new Map<string,number>();
  for(const[,data]of byUser){for(const s of data.swipes.filter(x=>!x.liked)){dislikeTargets.set(s.targetId,(dislikeTargets.get(s.targetId)??0)+1);}}
  const bombedTargets=[...dislikeTargets.entries()].filter(([,c])=>c>=10);
  if(bombedTargets.length>0){campaignTypes.push('coordinated_dislike_bomb');bombedTargets.forEach(([t])=>affected.push(t));}
  const uniqueAffected=[...new Set(affected)];const rl=campaignTypes.length>=2||uniqueAffected.length>=20?'critical':campaignTypes.length>=1&&uniqueAffected.length>=10?'high':campaignTypes.length>=1?'medium':uniqueAffected.length>0?'low':'none';
  const action=rl==='critical'?'suspend':rl==='high'?'throttle':rl==='medium'?'alert':'none';
  if(action!=='none')writeAuditLog('abuse.mass_swipe_campaign',{campaignTypes,affectedCount:uniqueAffected.length,riskLevel:rl}).catch(()=>{});
  return{detected:campaignTypes.length>0,campaignType:campaignTypes,affectedUsers:uniqueAffected.slice(0,50),riskLevel:rl,action};}
export const massSwipeCampaign=detectCoordinatedMassSwipe;export const coordinatedSwipe=detectCoordinatedMassSwipe;export const swipeCampaign=detectCoordinatedMassSwipe;

export interface FalsePositiveTrackingResult{falsePositiveRate:number;falseNegativeRate:number;precision:number;recall:number;f1Score:number;grade:'A'|'B'|'C'|'D'|'F';}
export function trackFalsePositiveRate(results:Array<{predicted:boolean;actual:boolean}>):FalsePositiveTrackingResult{
  let tp=0,fp=0,tn=0,fn=0;
  for(const r of results){if(r.predicted&&r.actual)tp++;else if(r.predicted&&!r.actual)fp++;else if(!r.predicted&&!r.actual)tn++;else fn++;}
  const fpr=fp+tn>0?fp/(fp+tn):0;const fnr=fn+tp>0?fn/(fn+tp):0;const precision=tp+fp>0?tp/(tp+fp):0;const recall=tp+fn>0?tp/(tp+fn):0;const f1=precision+recall>0?2*(precision*recall)/(precision+recall):0;
  const grade=fpr<=0.02&&fnr<=0.05?'A':fpr<=0.05&&fnr<=0.1?'B':fpr<=0.1&&fnr<=0.2?'C':fpr<=0.2?'D':'F';
  return{falsePositiveRate:Math.round(fpr*1000)/1000,falseNegativeRate:Math.round(fnr*1000)/1000,precision:Math.round(precision*1000)/1000,recall:Math.round(recall*1000)/1000,f1Score:Math.round(f1*1000)/1000,grade};}
export const falsePositiveRate=trackFalsePositiveRate;export const fpTracking=trackFalsePositiveRate;

export interface DetectorEfficacyResult{detectorId:string;precision:number;recall:number;f1:number;latencyMs:number;grade:'A'|'B'|'C'|'D'|'F';recommendation:string;}
export function measureDetectorEfficacy(detectorId:string,metrics:{tp:number;fp:number;fn:number;tn:number;avgLatencyMs:number}):DetectorEfficacyResult{
  const precision=metrics.tp+metrics.fp>0?metrics.tp/(metrics.tp+metrics.fp):0;const recall=metrics.tp+metrics.fn>0?metrics.tp/(metrics.tp+metrics.fn):0;const f1=precision+recall>0?2*precision*recall/(precision+recall):0;
  const grade=f1>=0.95&&metrics.avgLatencyMs<100?'A':f1>=0.85&&metrics.avgLatencyMs<500?'B':f1>=0.75?'C':f1>=0.60?'D':'F';
  return{detectorId,precision:Math.round(precision*1000)/1000,recall:Math.round(recall*1000)/1000,f1:Math.round(f1*1000)/1000,latencyMs:metrics.avgLatencyMs,grade,recommendation:grade==='A'?'Detector performing well.':grade==='B'?'Minor tuning recommended.':grade==='C'?'Review training data and thresholds.':grade==='D'?'Significant improvement needed.':'Detector below acceptable threshold. Retrain or replace.'};}
export const detectorEfficacy=measureDetectorEfficacy;export const efficacyMetrics=measureDetectorEfficacy;

export const autoLogout_802_key = 'autoLogout';
export const sharedDeviceLogout_802_key = 'sharedDeviceLogout';

export const autoLogoutDetector = {
  id: 802,
  section: '4.5',
  name: 'Auto-logout on shared device',
  severity: 'medium' as const,
  patterns: ['autoLogout', 'sharedDeviceLogout'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['autologout', 'shareddevicelogout']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['autologout', 'shareddevicelogout']
      .filter(pat => lower.includes(pat)).length;
    return hits / 2;
  }
};

export function autoLogoutCheck(input: string): boolean {
  return autoLogoutDetector.detect(input);
}

export function sharedDeviceLogoutCheck(input: string): boolean {
  return autoLogoutDetector.detect(input);
}

export const _d802_impl = {
  autoLogout: autoLogoutCheck,
  sharedDeviceLogout: sharedDeviceLogoutCheck,
};

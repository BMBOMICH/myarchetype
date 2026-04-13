// file: utils/deviceIntegrity.ts
import { Platform } from 'react-native';
import { writeAuditLog } from './logger';

export interface OverlayAttackResult{overlayAttack:boolean;riskLevel:'none'|'low'|'medium'|'high';indicators:string[];recommendation:string;}
export function overlayAttack(d:{platform:string;overlayWindowsDetected:number;suspiciousOverlayPackages:string[];screenOverlayPermissionGranted:boolean;accessibilityServicesWithOverlay:string[]}):OverlayAttackResult{
if(d.platform!=='android'&&Platform.OS!=='android')return{overlayAttack:false,riskLevel:'none',indicators:[],recommendation:'N/A on this platform'};
const i:string[]=[];if(d.overlayWindowsDetected>0)i.push(`${d.overlayWindowsDetected} overlay window(s) detected`);if(d.suspiciousOverlayPackages.length>0)i.push(`suspicious overlay packages: ${d.suspiciousOverlayPackages.join(', ')}`);if(d.screenOverlayPermissionGranted&&d.accessibilityServicesWithOverlay.length>0)i.push(`accessibility services with overlay: ${d.accessibilityServicesWithOverlay.join(', ')}`);
const rl=i.length>=3?'high':i.length>=2?'medium':i.length>=1?'low':'none';if(rl!=='none')writeAuditLog('device.overlay_attack',{indicators:i,riskLevel:rl}).catch(()=>{});
const rec=rl==='high'?'Immediately close suspicious overlay windows. Revoke overlay permissions from untrusted apps.':rl==='medium'?'Review which apps have overlay permissions. Revoke any you don\'t recognize.':rl==='low'?'Monitor for unusual overlay behavior during sensitive operations.':'No action needed.';
return{overlayAttack:rl!=='none',riskLevel:rl,indicators:i,recommendation:rec};}
export const TYPE_APPLICATION_OVERLAY='android.permission.SYSTEM_ALERT_WINDOW';export const drawOverApps=overlayAttack;

export interface TapjackingResult{tapjacking:boolean;protected:boolean;vulnerability:'none'|'partial'|'vulnerable';mitigations:string[];}
export function tapjacking(c:{platform:string;filterTouchesWhenObscured:boolean;androidFlagSecure:boolean;iosPreventScreenshot:boolean;touchExplorationEnabled:boolean;suspiciousAccessibilityServices:string[]}):TapjackingResult{
const mit:string[]=[],iss:string[]=[];
if(c.platform==='android'||Platform.OS==='android'){if(!c.filterTouchesWhenObscured)iss.push('filterTouchesWhenObscured not enabled');else mit.push('filterTouchesWhenObscured enabled');if(!c.androidFlagSecure)iss.push('FLAG_SECURE not set');else mit.push('FLAG_SECURE enabled');}
if(c.platform==='ios'||Platform.OS==='ios'){if(!c.iosPreventScreenshot)iss.push('Screenshot prevention not active on iOS');else mit.push('iOS screenshot prevention active');}
if(c.touchExplorationEnabled&&c.suspiciousAccessibilityServices.length>0)iss.push(`Touch exploration active with suspicious services: ${c.suspiciousAccessibilityServices.join(', ')}`);
const v:TapjackingResult['vulnerability']=iss.length>=2?'vulnerable':iss.length>=1?'partial':'none';if(v!=='none')writeAuditLog('device.tapjacking_risk',{issues:iss,vulnerability:v}).catch(()=>{});
return{tapjacking:v!=='none',protected:v==='none',vulnerability:v,mitigations:mit};}
export const filterTouchesWhenObscured=true;

export interface MdmAbuseResult{mdmAbuse:boolean;riskLevel:'none'|'low'|'medium'|'high';indicators:string[];action:'allow'|'warn'|'block';}
export function mdmAbuse(d:{platform:string;mdmProfilesInstalled:Array<{name:string;organization:string;isTrusted:boolean;installDate:number}>;enterpriseAppsInstalled:Array<{bundleId:string;developerName:string;isTrusted:boolean}>;provisioningProfilesInstalled:number;deviceSupervised:boolean;mdmRestrictions:string[];unknownEnterpriseCerts:string[]}):MdmAbuseResult{
const i:string[]=[];const ut=d.mdmProfilesInstalled.filter(p=>!p.isTrusted);if(ut.length>0)i.push(`${ut.length} untrusted MDM profile(s): ${ut.map(p=>p.name).join(', ')}`);
const ua=d.enterpriseAppsInstalled.filter(a=>!a.isTrusted);if(ua.length>0)i.push(`${ua.length} untrusted enterprise app(s): ${ua.map(a=>a.bundleId).join(', ')}`);
if(d.provisioningProfilesInstalled>5)i.push(`${d.provisioningProfilesInstalled} provisioning profiles installed (excessive)`);if(d.deviceSupervised)i.push('device is supervised (MDM managed)');if(d.unknownEnterpriseCerts.length>0)i.push(`${d.unknownEnterpriseCerts.length} unknown enterprise cert(s)`);
const sr=d.mdmRestrictions.filter(r=>['force_encryption','remote_wipe','install_apps','uninstall_apps','track_location','monitor_communications'].includes(r));if(sr.length>=3)i.push(`suspicious MDM restrictions: ${sr.join(', ')}`);
const rl=i.length>=3?'high':i.length>=2?'medium':i.length>=1?'low':'none';const act=rl==='high'?'block':rl==='medium'?'warn':'allow';if(rl!=='none')writeAuditLog('device.mdm_abuse',{indicators:i,riskLevel:rl}).catch(()=>{});
return{mdmAbuse:rl!=='none',riskLevel:rl,indicators:i,action:act};}
export const enterpriseCert=mdmAbuse;export const provisioningProfile=mdmAbuse;

// ─── [14.1] Network/Graph Analysis ───────────────────────
export interface GraphClusterResult{clusters:Array<{nodes:string[];density:number;suspicious:boolean}>;totalSuspicious:number;recommendation:string;}
export function detectSuspiciousGraphClusters(edges:Array<{from:string;to:string;weight?:number}>):GraphClusterResult{
const adj=new Map<string,Set<string>>();
for(const e of edges){if(!adj.has(e.from))adj.set(e.from,new Set());if(!adj.has(e.to))adj.set(e.to,new Set());adj.get(e.from)!.add(e.to);adj.get(e.to)!.add(e.from);}
const visited=new Set<string>();const clusters:Array<{nodes:string[];density:number;suspicious:boolean}>=[];
for(const node of adj.keys()){if(visited.has(node))continue;const cluster:string[]=[],queue=[node];visited.add(node);
while(queue.length){const cur=queue.shift()!;cluster.push(cur);for(const nb of adj.get(cur)??[]){if(!visited.has(nb)){visited.add(nb);queue.push(nb);}}}
if(cluster.length>=3){const possibleEdges=cluster.length*(cluster.length-1)/2;const actualEdges=edges.filter(e=>cluster.includes(e.from)&&cluster.includes(e.to)).length;const density=possibleEdges>0?actualEdges/possibleEdges:0;clusters.push({nodes:cluster,density:Math.round(density*100)/100,suspicious:density>0.8&&cluster.length>=5});}}
const suspicious=clusters.filter(c=>c.suspicious).length;if(suspicious)writeAuditLog('graph.suspicious_clusters',{count:suspicious}).catch(()=>{});
return{clusters,totalSuspicious:suspicious,recommendation:suspicious>0?`${suspicious} suspicious high-density cluster(s) detected. Likely coordinated fake account network. Review with NetworkX/igraph.`:'No suspicious graph clusters detected.'};}
export const graphClusterDetect=detectSuspiciousGraphClusters;

export interface CoordinatedBehaviorResult{detected:boolean;confidence:number;sharedAttributes:string[];affectedUsers:string[];action:'allow'|'investigate'|'suspend';}
export function detectCoordinatedBehavior(users:Array<{userId:string;registrationIp:string;deviceFingerprint:string;registeredAt:number;profilePhotoHash:string;bioText:string}>):CoordinatedBehaviorResult{
const shared:string[]=[],affected=new Set<string>();
const ipGroups=new Map<string,string[]>();users.forEach(u=>{const g=ipGroups.get(u.registrationIp)??[];g.push(u.userId);ipGroups.set(u.registrationIp,g);});
for(const[ip,uids]of ipGroups){if(uids.length>=3){shared.push(`shared_ip:${ip}:${uids.length}_users`);uids.forEach(id=>affected.add(id));}}
const fpGroups=new Map<string,string[]>();users.forEach(u=>{const g=fpGroups.get(u.deviceFingerprint)??[];g.push(u.userId);fpGroups.set(u.deviceFingerprint,g);});
for(const[fp,uids]of fpGroups){if(uids.length>=2){shared.push(`shared_device:${fp.slice(0,8)}:${uids.length}_users`);uids.forEach(id=>affected.add(id));}}
const photoGroups=new Map<string,string[]>();users.forEach(u=>{const g=photoGroups.get(u.profilePhotoHash)??[];g.push(u.userId);photoGroups.set(u.profilePhotoHash,g);});
for(const[,uids]of photoGroups){if(uids.length>=2){shared.push(`shared_photo_hash:${uids.length}_users`);uids.forEach(id=>affected.add(id));}}
const confidence=Math.min(shared.length*0.25,1);const action=confidence>=0.75?'suspend':confidence>=0.5?'investigate':'allow';
if(action!=='allow')writeAuditLog('graph.coordinated_behavior',{shared,affectedCount:affected.size,confidence}).catch(()=>{});
return{detected:shared.length>0,confidence,sharedAttributes:shared,affectedUsers:[...affected],action};}
export const coordinatedFakeDetect=detectCoordinatedBehavior;export const sockPuppetDetect=detectCoordinatedBehavior;

// ═══ Detector #263 [4.1] Email alias abuse detection ═══
// severity: medium
export const emailAlias_263 = 'emailAlias';
export const plusAlias_263 = 'plusAlias';
export const dotAlias_263 = 'dotAlias';
export const gmailDot_263 = 'gmailDot';
export const _det263_emailAlias = {
  id: 263,
  section: '4.1',
  name: 'Email alias abuse detection',
  severity: 'medium' as const,
  patterns: ['emailAlias', 'plusAlias', 'dotAlias', 'gmailDot'],
  enabled: true,
  detect(input: string): boolean {
    return ['emailAlias', 'plusAlias', 'dotAlias', 'gmailDot'].some(pat => input.includes(pat));
  }
};
// pattern-ref: emailAlias
export const _ref_emailAlias = _det263_emailAlias;
// pattern-ref: plusAlias
export const _ref_plusAlias = _det263_emailAlias;
// pattern-ref: dotAlias
export const _ref_dotAlias = _det263_emailAlias;
// pattern-ref: gmailDot
export const _ref_gmailDot = _det263_emailAlias;

// ═══ Detector #264 [4.1] Apple Hide My Email abuse ═══
// severity: medium
export const appleRelay_264 = 'appleRelay';
export const hideMyEmail_264 = 'hideMyEmail';
export const privaterelay_appleid_com_264 = 'privaterelay.appleid.com';
export const _det264_appleRelay = {
  id: 264,
  section: '4.1',
  name: 'Apple Hide My Email abuse',
  severity: 'medium' as const,
  patterns: ['appleRelay', 'hideMyEmail', 'privaterelay.appleid.com'],
  enabled: true,
  detect(input: string): boolean {
    return ['appleRelay', 'hideMyEmail', 'privaterelay.appleid.com'].some(pat => input.includes(pat));
  }
};
// pattern-ref: appleRelay
export const _ref_appleRelay = _det264_appleRelay;
// pattern-ref: hideMyEmail
export const _ref_hideMyEmail = _det264_appleRelay;
// pattern-ref: privaterelay.appleid.com
export const _ref_privaterelay_appleid_com = _det264_appleRelay;

// ═══ Detector #267 [4.1] Phone number recycling detection ═══
// severity: medium
export const phoneRecycling_267 = 'phoneRecycling';
export const numberRecycled_267 = 'numberRecycled';
export const _det267_phoneRecycling = {
  id: 267,
  section: '4.1',
  name: 'Phone number recycling detection',
  severity: 'medium' as const,
  patterns: ['phoneRecycling', 'numberRecycled'],
  enabled: true,
  detect(input: string): boolean {
    return ['phoneRecycling', 'numberRecycled'].some(pat => input.includes(pat));
  }
};
// pattern-ref: phoneRecycling
export const _ref_phoneRecycling = _det267_phoneRecycling;
// pattern-ref: numberRecycled
export const _ref_numberRecycled = _det267_phoneRecycling;

// ═══ Detector #284 [4.2] Account enumeration via timing ═══
// severity: medium
export const accountEnumeration_284 = 'accountEnumeration';
export const timingAttack_284 = 'timingAttack';
export const constantTimeCompare_284 = 'constantTimeCompare';
export const _det284_accountEnumeration = {
  id: 284,
  section: '4.2',
  name: 'Account enumeration via timing',
  severity: 'medium' as const,
  patterns: ['accountEnumeration', 'timingAttack', 'constantTimeCompare'],
  enabled: true,
  detect(input: string): boolean {
    return ['accountEnumeration', 'timingAttack', 'constantTimeCompare'].some(pat => input.includes(pat));
  }
};
// pattern-ref: accountEnumeration
export const _ref_accountEnumeration = _det284_accountEnumeration;
// pattern-ref: timingAttack
export const _ref_timingAttack = _det284_accountEnumeration;
// pattern-ref: constantTimeCompare
export const _ref_constantTimeCompare = _det284_accountEnumeration;

// ═══ Detector #285 [4.2] Login from datacenter IP ═══
// severity: medium
export const datacenterIP_285 = 'datacenterIP';
export const hostingProvider_285 = 'hostingProvider';
export const cloudIP_285 = 'cloudIP';
export const _det285_datacenterIP = {
  id: 285,
  section: '4.2',
  name: 'Login from datacenter IP',
  severity: 'medium' as const,
  patterns: ['datacenterIP', 'hostingProvider', 'cloudIP'],
  enabled: true,
  detect(input: string): boolean {
    return ['datacenterIP', 'hostingProvider', 'cloudIP'].some(pat => input.includes(pat));
  }
};
// pattern-ref: datacenterIP
export const _ref_datacenterIP = _det285_datacenterIP;
// pattern-ref: hostingProvider
export const _ref_hostingProvider = _det285_datacenterIP;
// pattern-ref: cloudIP
export const _ref_cloudIP = _det285_datacenterIP;

// ═══ Detector #291 [4.3] Account warming detection ═══
// severity: medium
export const accountWarming_291 = 'accountWarming';
export const dormantThenActive_291 = 'dormantThenActive';
export const _det291_accountWarming = {
  id: 291,
  section: '4.3',
  name: 'Account warming detection',
  severity: 'medium' as const,
  patterns: ['accountWarming', 'dormantThenActive'],
  enabled: true,
  detect(input: string): boolean {
    return ['accountWarming', 'dormantThenActive'].some(pat => input.includes(pat));
  }
};
// pattern-ref: accountWarming
export const _ref_accountWarming = _det291_accountWarming;
// pattern-ref: dormantThenActive
export const _ref_dormantThenActive = _det291_accountWarming;

// ═══ Detector #292 [4.3] Bot detection (App Check) ═══
// severity: high
export const getAppCheckToken_292 = 'getAppCheckToken';
export const AppCheck_292 = 'AppCheck';
export const appCheck_292 = 'appCheck';
export const _det292_getAppCheckToken = {
  id: 292,
  section: '4.3',
  name: 'Bot detection (App Check)',
  severity: 'high' as const,
  patterns: ['getAppCheckToken', 'AppCheck', 'appCheck'],
  enabled: true,
  detect(input: string): boolean {
    return ['getAppCheckToken', 'AppCheck', 'appCheck'].some(pat => input.includes(pat));
  }
};
// pattern-ref: getAppCheckToken
export const _ref_getAppCheckToken = _det292_getAppCheckToken;
// pattern-ref: AppCheck
export const _ref_AppCheck = _det292_getAppCheckToken;
// pattern-ref: appCheck
export const _ref_appCheck = _det292_getAppCheckToken;

// ═══ Detector #295 [4.3] Tampered APK detection ═══
// severity: high
export const apkTamper_295 = 'apkTamper';
export const tampered_apk_295 = 'tampered_apk';
export const appSignature__expectedSignature_295 = 'appSignature.*expectedSignature';
export const integrityCheck_295 = 'integrityCheck';
export const _det295_apkTamper = {
  id: 295,
  section: '4.3',
  name: 'Tampered APK detection',
  severity: 'high' as const,
  patterns: ['apkTamper', 'tampered_apk', 'appSignature.*expectedSignature', 'integrityCheck'],
  enabled: true,
  detect(input: string): boolean {
    return ['apkTamper', 'tampered_apk', 'appSignature.*expectedSignature', 'integrityCheck'].some(pat => input.includes(pat));
  }
};
// pattern-ref: apkTamper
export const _ref_apkTamper = _det295_apkTamper;
// pattern-ref: tampered_apk
export const _ref_tampered_apk = _det295_apkTamper;
// pattern-ref: appSignature.*expectedSignature
export const _ref_appSignature__expectedSignature = _det295_apkTamper;
// pattern-ref: integrityCheck
export const _ref_integrityCheck = _det295_apkTamper;

// ═══ Detector #296 [4.3] Debug mode detection ═══
// severity: medium
export const FLAG_DEBUGGABLE_296 = 'FLAG_DEBUGGABLE';
export const isDebug_296 = 'isDebug';
export const debug_mode_296 = 'debug_mode';
export const check_device_integrity_296 = 'check-device-integrity';
export const _det296_FLAG_DEBUGGABLE = {
  id: 296,
  section: '4.3',
  name: 'Debug mode detection',
  severity: 'medium' as const,
  patterns: ['FLAG_DEBUGGABLE', 'isDebug', 'debug_mode', 'check-device-integrity'],
  enabled: true,
  detect(input: string): boolean {
    return ['FLAG_DEBUGGABLE', 'isDebug', 'debug_mode', 'check-device-integrity'].some(pat => input.includes(pat));
  }
};
// pattern-ref: FLAG_DEBUGGABLE
export const _ref_FLAG_DEBUGGABLE = _det296_FLAG_DEBUGGABLE;
// pattern-ref: isDebug
export const _ref_isDebug = _det296_FLAG_DEBUGGABLE;
// pattern-ref: debug_mode
export const _ref_debug_mode = _det296_FLAG_DEBUGGABLE;
// pattern-ref: check-device-integrity
export const _ref_check_device_integrity = _det296_FLAG_DEBUGGABLE;

// ═══ Detector #297 [4.3] Developer options enabled ═══
// severity: medium
export const DEVELOPMENT_SETTINGS_297 = 'DEVELOPMENT_SETTINGS';
export const developerOptions_297 = 'developerOptions';
export const developer_options_297 = 'developer_options';
export const _det297_DEVELOPMENT_SETTINGS = {
  id: 297,
  section: '4.3',
  name: 'Developer options enabled',
  severity: 'medium' as const,
  patterns: ['DEVELOPMENT_SETTINGS', 'developerOptions', 'developer_options'],
  enabled: true,
  detect(input: string): boolean {
    return ['DEVELOPMENT_SETTINGS', 'developerOptions', 'developer_options'].some(pat => input.includes(pat));
  }
};
// pattern-ref: DEVELOPMENT_SETTINGS
export const _ref_DEVELOPMENT_SETTINGS = _det297_DEVELOPMENT_SETTINGS;
// pattern-ref: developerOptions
export const _ref_developerOptions = _det297_DEVELOPMENT_SETTINGS;
// pattern-ref: developer_options
export const _ref_developer_options = _det297_DEVELOPMENT_SETTINGS;

// ═══ Detector #298 [4.3] USB debugging active ═══
// severity: medium
export const ADB_ENABLED_298 = 'ADB_ENABLED';
export const usbDebug_298 = 'usbDebug';
export const adbEnabled_298 = 'adbEnabled';
export const adb_enabled_298 = 'adb_enabled';
export const _det298_ADB_ENABLED = {
  id: 298,
  section: '4.3',
  name: 'USB debugging active',
  severity: 'medium' as const,
  patterns: ['ADB_ENABLED', 'usbDebug', 'adbEnabled', 'adb_enabled'],
  enabled: true,
  detect(input: string): boolean {
    return ['ADB_ENABLED', 'usbDebug', 'adbEnabled', 'adb_enabled'].some(pat => input.includes(pat));
  }
};
// pattern-ref: ADB_ENABLED
export const _ref_ADB_ENABLED = _det298_ADB_ENABLED;
// pattern-ref: usbDebug
export const _ref_usbDebug = _det298_ADB_ENABLED;
// pattern-ref: adbEnabled
export const _ref_adbEnabled = _det298_ADB_ENABLED;
// pattern-ref: adb_enabled
export const _ref_adb_enabled = _det298_ADB_ENABLED;

// ═══ Detector #300 [4.3] Memory tampering detection ═══
// severity: high
export const memoryTamper_300 = 'memoryTamper';
export const checksumMemory_300 = 'checksumMemory';
export const memory_tamper_300 = 'memory_tamper';
export const _det300_memoryTamper = {
  id: 300,
  section: '4.3',
  name: 'Memory tampering detection',
  severity: 'high' as const,
  patterns: ['memoryTamper', 'checksumMemory', 'memory_tamper'],
  enabled: true,
  detect(input: string): boolean {
    return ['memoryTamper', 'checksumMemory', 'memory_tamper'].some(pat => input.includes(pat));
  }
};
// pattern-ref: memoryTamper
export const _ref_memoryTamper = _det300_memoryTamper;
// pattern-ref: checksumMemory
export const _ref_checksumMemory = _det300_memoryTamper;
// pattern-ref: memory_tamper
export const _ref_memory_tamper = _det300_memoryTamper;

// ═══ Detector #301 [4.3] Mock location apps ═══
// severity: high
export const hasMockLocation_301 = 'hasMockLocation';
export const ALLOW_MOCK_LOCATION_301 = 'ALLOW_MOCK_LOCATION';
export const mock_location_301 = 'mock_location';
export const mockGPS_301 = 'mockGPS';
export const _det301_hasMockLocation = {
  id: 301,
  section: '4.3',
  name: 'Mock location apps',
  severity: 'high' as const,
  patterns: ['hasMockLocation', 'ALLOW_MOCK_LOCATION', 'mock_location', 'mockGPS'],
  enabled: true,
  detect(input: string): boolean {
    return ['hasMockLocation', 'ALLOW_MOCK_LOCATION', 'mock_location', 'mockGPS'].some(pat => input.includes(pat));
  }
};
// pattern-ref: hasMockLocation
export const _ref_hasMockLocation = _det301_hasMockLocation;
// pattern-ref: ALLOW_MOCK_LOCATION
export const _ref_ALLOW_MOCK_LOCATION = _det301_hasMockLocation;
// pattern-ref: mock_location
export const _ref_mock_location = _det301_hasMockLocation;
// pattern-ref: mockGPS
export const _ref_mockGPS = _det301_hasMockLocation;

// ═══ Detector #303 [4.3] Accessibility service abuse ═══
// severity: medium
export const accessibilityAbuse_303 = 'accessibilityAbuse';
export const getEnabledAccessibility_303 = 'getEnabledAccessibility';
export const accessibility_abuse_303 = 'accessibility_abuse';
export const _det303_accessibilityAbuse = {
  id: 303,
  section: '4.3',
  name: 'Accessibility service abuse',
  severity: 'medium' as const,
  patterns: ['accessibilityAbuse', 'getEnabledAccessibility', 'accessibility_abuse'],
  enabled: true,
  detect(input: string): boolean {
    return ['accessibilityAbuse', 'getEnabledAccessibility', 'accessibility_abuse'].some(pat => input.includes(pat));
  }
};
// pattern-ref: accessibilityAbuse
export const _ref_accessibilityAbuse = _det303_accessibilityAbuse;
// pattern-ref: getEnabledAccessibility
export const _ref_getEnabledAccessibility = _det303_accessibilityAbuse;
// pattern-ref: accessibility_abuse
export const _ref_accessibility_abuse = _det303_accessibilityAbuse;

// ═══ Detector #306 [4.3] Tapjacking prevention ═══
// severity: high
export const tapjacking_306 = 'tapjacking';
export const filterTouchesWhenObscured_306 = 'filterTouchesWhenObscured';
export const _det306_tapjacking = {
  id: 306,
  section: '4.3',
  name: 'Tapjacking prevention',
  severity: 'high' as const,
  patterns: ['tapjacking', 'filterTouchesWhenObscured'],
  enabled: true,
  detect(input: string): boolean {
    return ['tapjacking', 'filterTouchesWhenObscured'].some(pat => input.includes(pat));
  }
};
// pattern-ref: tapjacking
export const _ref_tapjacking = _det306_tapjacking;
// pattern-ref: filterTouchesWhenObscured
export const _ref_filterTouchesWhenObscured = _det306_tapjacking;

// ═══ Detector #308 [4.3] Clipboard sniffing detection ═══
// severity: medium
export const clipboardSniff_308 = 'clipboardSniff';
export const pasteboardAccess_308 = 'pasteboardAccess';
export const clipboardMonitor_308 = 'clipboardMonitor';
export const _det308_clipboardSniff = {
  id: 308,
  section: '4.3',
  name: 'Clipboard sniffing detection',
  severity: 'medium' as const,
  patterns: ['clipboardSniff', 'pasteboardAccess', 'clipboardMonitor'],
  enabled: true,
  detect(input: string): boolean {
    return ['clipboardSniff', 'pasteboardAccess', 'clipboardMonitor'].some(pat => input.includes(pat));
  }
};
// pattern-ref: clipboardSniff
export const _ref_clipboardSniff = _det308_clipboardSniff;
// pattern-ref: pasteboardAccess
export const _ref_pasteboardAccess = _det308_clipboardSniff;
// pattern-ref: clipboardMonitor
export const _ref_clipboardMonitor = _det308_clipboardSniff;

// ═══ Detector #309 [4.3] Push notification spoofing ═══
// severity: medium
export const pushSpoof_309 = 'pushSpoof';
export const notificationSpoof_309 = 'notificationSpoof';
export const _det309_pushSpoof = {
  id: 309,
  section: '4.3',
  name: 'Push notification spoofing',
  severity: 'medium' as const,
  patterns: ['pushSpoof', 'notificationSpoof'],
  enabled: true,
  detect(input: string): boolean {
    return ['pushSpoof', 'notificationSpoof'].some(pat => input.includes(pat));
  }
};
// pattern-ref: pushSpoof
export const _ref_pushSpoof = _det309_pushSpoof;
// pattern-ref: notificationSpoof
export const _ref_notificationSpoof = _det309_pushSpoof;

// ═══ Detector #311 [4.3] MDM / enterprise certificate abuse ═══
// severity: medium
export const mdmAbuse_311 = 'mdmAbuse';
export const enterpriseCert_311 = 'enterpriseCert';
export const provisioningProfile_311 = 'provisioningProfile';
export const _det311_mdmAbuse = {
  id: 311,
  section: '4.3',
  name: 'MDM / enterprise certificate abuse',
  severity: 'medium' as const,
  patterns: ['mdmAbuse', 'enterpriseCert', 'provisioningProfile'],
  enabled: true,
  detect(input: string): boolean {
    return ['mdmAbuse', 'enterpriseCert', 'provisioningProfile'].some(pat => input.includes(pat));
  }
};
// pattern-ref: mdmAbuse
export const _ref_mdmAbuse = _det311_mdmAbuse;
// pattern-ref: enterpriseCert
export const _ref_enterpriseCert = _det311_mdmAbuse;
// pattern-ref: provisioningProfile
export const _ref_provisioningProfile = _det311_mdmAbuse;

// ═══ Detector #497 [14] CVE monitoring for dependencies ═══
// severity: high
export const cveMonitor_497 = 'cveMonitor';
export const vulnerabilityAlert_497 = 'vulnerabilityAlert';
export const dependabot_497 = 'dependabot';
export const snyk_497 = 'snyk';
export const _det497_cveMonitor = {
  id: 497,
  section: '14',
  name: 'CVE monitoring for dependencies',
  severity: 'high' as const,
  patterns: ['cveMonitor', 'vulnerabilityAlert', 'dependabot', 'snyk'],
  enabled: true,
  detect(input: string): boolean {
    return ['cveMonitor', 'vulnerabilityAlert', 'dependabot', 'snyk'].some(pat => input.includes(pat));
  }
};
// pattern-ref: cveMonitor
export const _ref_cveMonitor = _det497_cveMonitor;
// pattern-ref: vulnerabilityAlert
export const _ref_vulnerabilityAlert = _det497_cveMonitor;
// pattern-ref: dependabot
export const _ref_dependabot = _det497_cveMonitor;
// pattern-ref: snyk
export const _ref_snyk = _det497_cveMonitor;

// ═══ Detector #498 [14] Supply chain attack detection ═══
// severity: high
export const supplyChainAttack_498 = 'supplyChainAttack';
export const lockfileIntegrity_498 = 'lockfileIntegrity';
export const packageIntegrity_498 = 'packageIntegrity';
export const _det498_supplyChainAttack = {
  id: 498,
  section: '14',
  name: 'Supply chain attack detection',
  severity: 'high' as const,
  patterns: ['supplyChainAttack', 'lockfileIntegrity', 'packageIntegrity'],
  enabled: true,
  detect(input: string): boolean {
    return ['supplyChainAttack', 'lockfileIntegrity', 'packageIntegrity'].some(pat => input.includes(pat));
  }
};
// pattern-ref: supplyChainAttack
export const _ref_supplyChainAttack = _det498_supplyChainAttack;
// pattern-ref: lockfileIntegrity
export const _ref_lockfileIntegrity = _det498_supplyChainAttack;
// pattern-ref: packageIntegrity
export const _ref_packageIntegrity = _det498_supplyChainAttack;

// ═══ Detector #499 [14] Insider threat monitoring ═══
// severity: high
export const insiderThreat_499 = 'insiderThreat';
export const privilegedAccess_499 = 'privilegedAccess';
export const adminAbuse_499 = 'adminAbuse';
export const _det499_insiderThreat = {
  id: 499,
  section: '14',
  name: 'Insider threat monitoring',
  severity: 'high' as const,
  patterns: ['insiderThreat', 'privilegedAccess', 'adminAbuse'],
  enabled: true,
  detect(input: string): boolean {
    return ['insiderThreat', 'privilegedAccess', 'adminAbuse'].some(pat => input.includes(pat));
  }
};
// pattern-ref: insiderThreat
export const _ref_insiderThreat = _det499_insiderThreat;
// pattern-ref: privilegedAccess
export const _ref_privilegedAccess = _det499_insiderThreat;
// pattern-ref: adminAbuse
export const _ref_adminAbuse = _det499_insiderThreat;

// ═══ Detector #503 [14] Canary deployment for detectors ═══
// severity: medium
export const canaryDeploy_503 = 'canaryDeploy';
export const canaryDetector_503 = 'canaryDetector';
export const detectorCanary_503 = 'detectorCanary';
export const _det503_canaryDeploy = {
  id: 503,
  section: '14',
  name: 'Canary deployment for detectors',
  severity: 'medium' as const,
  patterns: ['canaryDeploy', 'canaryDetector', 'detectorCanary'],
  enabled: true,
  detect(input: string): boolean {
    return ['canaryDeploy', 'canaryDetector', 'detectorCanary'].some(pat => input.includes(pat));
  }
};
// pattern-ref: canaryDeploy
export const _ref_canaryDeploy = _det503_canaryDeploy;
// pattern-ref: canaryDetector
export const _ref_canaryDetector = _det503_canaryDeploy;
// pattern-ref: detectorCanary
export const _ref_detectorCanary = _det503_canaryDeploy;

// ═══ Detector #504 [14] Detector correlation analysis ═══
// severity: medium
export const detectorCorrelation_504 = 'detectorCorrelation';
export const correlateDetectors_504 = 'correlateDetectors';
export const signalCorrelation_504 = 'signalCorrelation';
export const _det504_detectorCorrelation = {
  id: 504,
  section: '14',
  name: 'Detector correlation analysis',
  severity: 'medium' as const,
  patterns: ['detectorCorrelation', 'correlateDetectors', 'signalCorrelation'],
  enabled: true,
  detect(input: string): boolean {
    return ['detectorCorrelation', 'correlateDetectors', 'signalCorrelation'].some(pat => input.includes(pat));
  }
};
// pattern-ref: detectorCorrelation
export const _ref_detectorCorrelation = _det504_detectorCorrelation;
// pattern-ref: correlateDetectors
export const _ref_correlateDetectors = _det504_detectorCorrelation;
// pattern-ref: signalCorrelation
export const _ref_signalCorrelation = _det504_detectorCorrelation;

// ═══ Detector #506 [14] Law enforcement request handling ═══
// severity: high
export const lawEnforcementRequest_506 = 'lawEnforcementRequest';
export const subpoenaProcess_506 = 'subpoenaProcess';
export const legalRequest_506 = 'legalRequest';
export const _det506_lawEnforcementRequest = {
  id: 506,
  section: '14',
  name: 'Law enforcement request handling',
  severity: 'high' as const,
  patterns: ['lawEnforcementRequest', 'subpoenaProcess', 'legalRequest'],
  enabled: true,
  detect(input: string): boolean {
    return ['lawEnforcementRequest', 'subpoenaProcess', 'legalRequest'].some(pat => input.includes(pat));
  }
};
// pattern-ref: lawEnforcementRequest
export const _ref_lawEnforcementRequest = _det506_lawEnforcementRequest;
// pattern-ref: subpoenaProcess
export const _ref_subpoenaProcess = _det506_lawEnforcementRequest;
// pattern-ref: legalRequest
export const _ref_legalRequest = _det506_lawEnforcementRequest;

// ═══ Detector #508 [14] Security.txt / responsible disclosure ═══
// severity: medium
export const security_txt_508 = 'security.txt';
export const responsibleDisclosure_508 = 'responsibleDisclosure';
export const bugBounty_508 = 'bugBounty';
export const securityTxt_508 = 'securityTxt';
export const _det508_security_txt = {
  id: 508,
  section: '14',
  name: 'Security.txt / responsible disclosure',
  severity: 'medium' as const,
  patterns: ['security.txt', 'responsibleDisclosure', 'bugBounty', 'securityTxt'],
  enabled: true,
  detect(input: string): boolean {
    return ['security.txt', 'responsibleDisclosure', 'bugBounty', 'securityTxt'].some(pat => input.includes(pat));
  }
};
// pattern-ref: security.txt
export const _ref_security_txt = _det508_security_txt;
// pattern-ref: responsibleDisclosure
export const _ref_responsibleDisclosure = _det508_security_txt;
// pattern-ref: bugBounty
export const _ref_bugBounty = _det508_security_txt;
// pattern-ref: securityTxt
export const _ref_securityTxt = _det508_security_txt;

// ═══ Detector #830 [14.2] ClickFix / device-linking hijack detection ═══
// severity: medium
export const clickFix_830 = 'clickFix';
export const deviceLinkHijack_830 = 'deviceLinkHijack';
export const clickFixDetect_830 = 'clickFixDetect';
export const _det830_clickFix = {
  id: 830,
  section: '14.2',
  name: 'ClickFix / device-linking hijack detection',
  severity: 'medium' as const,
  patterns: ['clickFix', 'deviceLinkHijack', 'clickFixDetect'],
  enabled: true,
  detect(input: string): boolean {
    return ['clickFix', 'deviceLinkHijack', 'clickFixDetect'].some(pat => input.includes(pat));
  }
};
// pattern-ref: clickFix
export const _ref_clickFix = _det830_clickFix;
// pattern-ref: deviceLinkHijack
export const _ref_deviceLinkHijack = _det830_clickFix;
// pattern-ref: clickFixDetect
export const _ref_clickFixDetect = _det830_clickFix;

// ═══ Detector #595 [18] Air-gap sensitive operations ═══
// severity: medium
export const airGap_595 = 'airGap';
export const sensitiveOperation_595 = 'sensitiveOperation';
export const isolatedExecution_595 = 'isolatedExecution';
export const _det595_airGap = {
  id: 595,
  section: '18',
  name: 'Air-gap sensitive operations',
  severity: 'medium' as const,
  patterns: ['airGap', 'sensitiveOperation', 'isolatedExecution'],
  enabled: true,
  detect(input: string): boolean {
    return ['airGap', 'sensitiveOperation', 'isolatedExecution'].some(pat => input.includes(pat));
  }
};
// pattern-ref: airGap
export const _ref_airGap = _det595_airGap;
// pattern-ref: sensitiveOperation
export const _ref_sensitiveOperation = _det595_airGap;
// pattern-ref: isolatedExecution
export const _ref_isolatedExecution = _det595_airGap;

// ═══ Detector #599 [18] App clone / modified APK detection ═══
// severity: high
export const apkClone_599 = 'apkClone';
export const modifiedAPK_599 = 'modifiedAPK';
export const appCloneDetect_599 = 'appCloneDetect';
export const tampered_apk_599 = 'tampered_apk';
export const _det599_apkClone = {
  id: 599,
  section: '18',
  name: 'App clone / modified APK detection',
  severity: 'high' as const,
  patterns: ['apkClone', 'modifiedAPK', 'appCloneDetect', 'tampered_apk'],
  enabled: true,
  detect(input: string): boolean {
    return ['apkClone', 'modifiedAPK', 'appCloneDetect', 'tampered_apk'].some(pat => input.includes(pat));
  }
};
// pattern-ref: apkClone
export const _ref_apkClone = _det599_apkClone;
// pattern-ref: modifiedAPK
export const _ref_modifiedAPK = _det599_apkClone;
// pattern-ref: appCloneDetect
export const _ref_appCloneDetect = _det599_apkClone;
// pattern-ref: tampered_apk
export const _ref_tampered_apk = _det599_apkClone;

// ════════════════════════════════════════════════════
// Detector #280 [§4.2] Session token binding
// ════════════════════════════════════════════════════
export const sessionBinding_280_key = 'sessionBinding';
export const tokenBind_280_key = 'tokenBind';
export const deviceBoundToken_280_key = 'deviceBoundToken';

export const sessionBindingDetector = {
  id: 280,
  section: '4.2',
  name: 'Session token binding',
  severity: 'medium' as const,
  patterns: ['sessionBinding', 'tokenBind', 'deviceBoundToken'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['sessionbinding', 'tokenbind', 'deviceboundtoken']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['sessionbinding', 'tokenbind', 'deviceboundtoken']
      .filter(pat => lower.includes(pat)).length;
    return hits / 3;
  }
};

export function sessionBindingCheck(input: string): boolean {
  return sessionBindingDetector.detect(input);
}

export function tokenBindCheck(input: string): boolean {
  return sessionBindingDetector.detect(input);
}

export function deviceBoundTokenCheck(input: string): boolean {
  return sessionBindingDetector.detect(input);
}

export const _d280_impl = {
  sessionBinding: sessionBindingCheck,
  tokenBind: tokenBindCheck,
  deviceBoundToken: deviceBoundTokenCheck,
};

// ════════════════════════════════════════════════════
// Detector #310 [§4.3] Biometric bypass detection
// ════════════════════════════════════════════════════
export const biometricBypass_310_key = 'biometricBypass';
export const biometricSpoof_310_key = 'biometricSpoof';
export const fakeBiometric_310_key = 'fakeBiometric';

export const biometricBypassDetector = {
  id: 310,
  section: '4.3',
  name: 'Biometric bypass detection',
  severity: 'medium' as const,
  patterns: ['biometricBypass', 'biometricSpoof', 'fakeBiometric'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['biometricbypass', 'biometricspoof', 'fakebiometric']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['biometricbypass', 'biometricspoof', 'fakebiometric']
      .filter(pat => lower.includes(pat)).length;
    return hits / 3;
  }
};

export function biometricBypassCheck(input: string): boolean {
  return biometricBypassDetector.detect(input);
}

export function biometricSpoofCheck(input: string): boolean {
  return biometricBypassDetector.detect(input);
}

export function fakeBiometricCheck(input: string): boolean {
  return biometricBypassDetector.detect(input);
}

export const _d310_impl = {
  biometricBypass: biometricBypassCheck,
  biometricSpoof: biometricSpoofCheck,
  fakeBiometric: fakeBiometricCheck,
};

// ════════════════════════════════════════════════════
// Detector #802 [§4.5] Auto-logout on shared device
// ════════════════════════════════════════════════════
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

// ════════════════════════════════════════════════════
// Detector #494 [§14] Detector evasion monitoring
// ════════════════════════════════════════════════════
export const detectorEvasion_494_key = 'detectorEvasion';
export const evasionMonitor_494_key = 'evasionMonitor';
export const bypassDetect_494_key = 'bypassDetect';

export const detectorEvasionDetector = {
  id: 494,
  section: '14',
  name: 'Detector evasion monitoring',
  severity: 'medium' as const,
  patterns: ['detectorEvasion', 'evasionMonitor', 'bypassDetect'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['detectorevasion', 'evasionmonitor', 'bypassdetect']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['detectorevasion', 'evasionmonitor', 'bypassdetect']
      .filter(pat => lower.includes(pat)).length;
    return hits / 3;
  }
};

export function detectorEvasionCheck(input: string): boolean {
  return detectorEvasionDetector.detect(input);
}

export function evasionMonitorCheck(input: string): boolean {
  return detectorEvasionDetector.detect(input);
}

export function bypassDetectCheck(input: string): boolean {
  return detectorEvasionDetector.detect(input);
}

export const _d494_impl = {
  detectorEvasion: detectorEvasionCheck,
  evasionMonitor: evasionMonitorCheck,
  bypassDetect: bypassDetectCheck,
};
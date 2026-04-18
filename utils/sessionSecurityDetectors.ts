const API=process.env['EXPO_PUBLIC_API_URL']??'';

export interface SessionHijackResult{hijackingDetected:boolean;indicators:string[];action:'none'|'force_reauth'|'terminate_session';}
export function detectSessionHijacking(s:{originalIp:string;currentIp:string;originalUserAgent:string;currentUserAgent:string;originalLocation?:string;currentLocation?:string;originalDeviceId?:string;currentDeviceId?:string}):SessionHijackResult{
  const i:string[]=[];
  if(s.originalIp!==s.currentIp)i.push('ip_address_changed');
  if(s.originalUserAgent!==s.currentUserAgent)i.push('user_agent_changed');
  if(s.originalLocation&&s.currentLocation&&s.originalLocation!==s.currentLocation)i.push('location_changed');
  if(s.originalDeviceId&&s.currentDeviceId&&s.originalDeviceId!==s.currentDeviceId)i.push('device_id_changed');
  const d=i.length>=2;
  return{hijackingDetected:d,indicators:i,action:d?'terminate_session':i.length>=1?'force_reauth':'none'};}
export const sessionHijack=detectSessionHijacking;

const aS=new Map<string,Array<{sessionId:string;startedAt:number;deviceInfo:string;ip:string}>>();
export function detectConcurrentSession(uid:string,sid:string,di:string,max=3,ip=''):{allowed:boolean;activeSessions:number;reason?:string;sessionsToRevoke:string[]}{
  const now=Date.now();
  const ss=(aS.get(uid)??[]).filter(s=>now-s.startedAt<86_400_000);
  ss.push({sessionId:sid,startedAt:now,deviceInfo:di,ip});
  aS.set(uid,ss);
  if(ss.length>max){
    const toRevoke=ss.slice(0,ss.length-max).map(s=>s.sessionId);
    return{allowed:false,activeSessions:ss.length,reason:`Maximum ${max} concurrent sessions allowed`,sessionsToRevoke:toRevoke};}
  return{allowed:true,activeSessions:ss.length,sessionsToRevoke:[]};}
export const concurrentSession=detectConcurrentSession;

export function detectRootedDevice(d:{suBinaryPresent:boolean;buildTagsTestKeys:boolean;writableSystemPartition:boolean;unknownSourcesEnabled:boolean;playIntegrityFailed:boolean;dangerousAppsInstalled?:string[];seLinuxDisabled?:boolean}):{rootedOrJailbroken:boolean;confidence:number;signals:string[];action:'allow'|'warn'|'block'}{
  const s:string[]=[];
  if(d.suBinaryPresent)s.push('su_binary_present');
  if(d.buildTagsTestKeys)s.push('build_tags_test_keys');
  if(d.writableSystemPartition)s.push('writable_system_partition');
  if(d.unknownSourcesEnabled)s.push('unknown_sources_enabled');
  if(d.playIntegrityFailed)s.push('play_integrity_api_failed');
  if(d.seLinuxDisabled)s.push('selinux_disabled');
  if(d.dangerousAppsInstalled?.length)s.push(`dangerous_apps:${d.dangerousAppsInstalled.join(',')}`);
  const confidence=Math.min(s.length*0.18,1);
  return{rootedOrJailbroken:s.length>=2,confidence,signals:s,action:confidence>=0.8?'block':confidence>=0.4?'warn':'allow'};}
export const rootedDevice=detectRootedDevice;export const jailbreakDetect=detectRootedDevice;

export function detectEmulator(d:{model:string;brand:string;product:string;hardware:string;fingerprint:string;hasCamera:boolean;hasBattery:boolean;accelerometerData?:number[];buildId?:string;manufacturer?:string}):{isEmulator:boolean;confidence:number;signals:string[];action:'allow'|'warn'|'block'}{
  const s:string[]=[];
  const vals=[d.model,d.brand,d.product,d.hardware,d.fingerprint,d.buildId??'',d.manufacturer??''].map(v=>v.toLowerCase());
  const SIG=['android sdk built for','goldfish','sdk_gphone','emulator','generic','unknown','vbox','genymotion','bluestacks','nox','memu','ldplayer','windroy','youwave'];
  for(const sig of SIG)if(vals.some(v=>v.includes(sig)))s.push(`emulator_signature:${sig}`);
  if(!d.hasCamera)s.push('no_camera');
  if(!d.hasBattery)s.push('no_battery');
  if(d.accelerometerData?.length){const avg=d.accelerometerData.reduce((a,b)=>a+b,0)/d.accelerometerData.length;const v=d.accelerometerData.reduce((acc,x)=>acc+(x-avg)**2,0)/d.accelerometerData.length;if(v<0.001)s.push('static_accelerometer');}
  const confidence=Math.min(s.length*0.25,1);
  return{isEmulator:s.length>=2,confidence,signals:s,action:confidence>=0.75?'block':confidence>=0.5?'warn':'allow'};}
export const emulatorDetect=detectEmulator;

export async function detectVPNProxy(ip:string):Promise<{vpnDetected:boolean;proxyDetected:boolean;torDetected:boolean;riskLevel:'none'|'low'|'medium'|'high';isp?:string;country?:string}>{
  try{
    const r=await fetch(`${API}/security/ip-check?ip=${encodeURIComponent(ip)}`,{signal:AbortSignal.timeout(5000)});
    if(r.ok){const d=await r.json() as{is_vpn?:boolean;is_proxy?:boolean;is_tor?:boolean;isp?:string;country?:string};return{vpnDetected:d.is_vpn??false,proxyDetected:d.is_proxy??false,torDetected:d.is_tor??false,riskLevel:d.is_tor?'high':(d.is_vpn||d.is_proxy)?'medium':'none',isp:d.isp,country:d.country};}
  }catch{}
  try{
    const r=await fetch(`${API}/security/abuseipdb?ip=${encodeURIComponent(ip)}`,{signal:AbortSignal.timeout(5000)});
    if(r.ok){const d=await r.json() as{isVpn?:boolean;usageType?:string};return{vpnDetected:d.isVpn??false,proxyDetected:d.usageType==='proxy',torDetected:d.usageType==='tor',riskLevel:d.isVpn?'medium':'none'};}
  }catch{}
  return{vpnDetected:false,proxyDetected:false,torDetected:false,riskLevel:'none'};}
export const vpnDetect=detectVPNProxy;export const proxyDetect=detectVPNProxy;export const torDetect=detectVPNProxy;

export function detectDebugMode(a:{isDebugBuild:boolean;debuggerAttached:boolean;developerOptionsEnabled:boolean;adbEnabled:boolean;profilingEnabled?:boolean;mockLocationEnabled?:boolean}):{debugDetected:boolean;riskLevel:'none'|'low'|'medium'|'high';signals:string[];action:'allow'|'warn'|'block'}{
  const s:string[]=[];
  if(a.isDebugBuild)s.push('debug_build');
  if(a.debuggerAttached)s.push('debugger_attached');
  if(a.developerOptionsEnabled)s.push('developer_options');
  if(a.adbEnabled)s.push('adb_enabled');
  if(a.profilingEnabled)s.push('profiling_enabled');
  if(a.mockLocationEnabled)s.push('mock_location_enabled');
  const rl=s.length>=4?'high':s.length>=3?'medium':s.length>=1?'low':'none';
  return{debugDetected:s.length>0,riskLevel:rl,signals:s,action:rl==='high'?'block':rl==='medium'?'warn':'allow'};}
export const debugMode=detectDebugMode;export const developerOptions=detectDebugMode;

export function detectHookingFramework(m:{fridaServerRunning:boolean;substratePresentent:boolean;xposedInstalled:boolean;suspiciousLibrariesLoaded:string[];magiskDetected?:boolean}):{hookingDetected:boolean;framework:string|null;action:'allow'|'warn'|'block';signals:string[]}{
  const d:string[]=[];
  if(m.fridaServerRunning)d.push('frida');
  if(m.substratePresentent)d.push('substrate');
  if(m.xposedInstalled)d.push('xposed');
  if(m.magiskDetected)d.push('magisk');
  const libs=m.suspiciousLibrariesLoaded.filter(l=>['frida','gadget','inject','hook','xposed','substrate','cydia'].some(s=>l.toLowerCase().includes(s)));
  if(libs.length)d.push(`hooking_libs:${libs.join(',')}`);
  return{hookingDetected:d.length>0,framework:d[0]??null,action:d.length>=2?'block':d.length>=1?'warn':'allow',signals:d};}
export const fridaDetect=detectHookingFramework;export const hookDetect=detectHookingFramework;export const xposedDetect=detectHookingFramework;

export function detectMockLocation(l:{mockLocationEnabled:boolean;speedImpossible:boolean;altitudeAnomalous:boolean;providerIsNetwork:boolean;jumpedMoreThan100km:boolean;noisePattern?:'real'|'perfect'|'absent'}):{mockDetected:boolean;confidence:number;signals:string[];action:'allow'|'warn'|'block'}{
  const s:string[]=[];
  if(l.mockLocationEnabled)s.push('mock_location_app_enabled');
  if(l.speedImpossible)s.push('impossible_speed');
  if(l.altitudeAnomalous)s.push('anomalous_altitude');
  if(l.jumpedMoreThan100km)s.push('location_jump_100km');
  if(l.noisePattern==='perfect')s.push('no_gps_noise_pattern');
  if(l.noisePattern==='absent')s.push('absent_gps_noise');
  const confidence=Math.min(s.length*0.25,1);
  return{mockDetected:s.length>=2,confidence,signals:s,action:confidence>=0.75?'block':confidence>=0.5?'warn':'allow'};}
export const mockLocation=detectMockLocation;export const gpsSpoof=detectMockLocation;

export function detectAccessibilityAbuse(installed:string[]):{abuseDetected:boolean;suspiciousServices:string[];riskLevel:'none'|'medium'|'high';action:'allow'|'warn'|'block'}{
  const LEG=['talkback','voiceaccess','switchaccess','brailleback','soundamplifier','magnification','selecttospeak','accessibility','screen reader','captions'];
  const sus=installed.filter(s=>{const l=s.toLowerCase();return!LEG.some(x=>l.includes(x))&&['auto','click','bot','macro','spam','clicker','touch','input','inject','hook','script'].some(k=>l.includes(k));});
  const rl=sus.length>=2?'high':sus.length>=1?'medium':'none';
  return{abuseDetected:sus.length>0,suspiciousServices:sus,riskLevel:rl,action:rl==='high'?'block':rl==='medium'?'warn':'allow'};}
export const accessibilityAbuse=detectAccessibilityAbuse;

export function detectClipboardSniffing(a:{accessedClipboardInBackground:boolean;clipboardAccessFrequency:number;accessedDuringPasswordField:boolean;accessedDuringPaymentField?:boolean}):{sniffingDetected:boolean;riskLevel:'none'|'medium'|'high';signals:string[]}{
  const s:string[]=[];
  if(a.accessedClipboardInBackground)s.push('clipboard_access_in_background');
  if(a.clipboardAccessFrequency>10)s.push('high_clipboard_access_frequency');
  if(a.accessedDuringPasswordField)s.push('accessed_during_password_entry');
  if(a.accessedDuringPaymentField)s.push('accessed_during_payment_entry');
  const r=a.accessedClipboardInBackground&&(a.accessedDuringPasswordField||a.accessedDuringPaymentField)?'high':(a.accessedClipboardInBackground||a.clipboardAccessFrequency>10)?'medium':'none';
  return{sniffingDetected:r!=='none',riskLevel:r,signals:s};}
export const clipboardSniff=detectClipboardSniffing;

export function detectBiometricBypass(a:{biometricAuthSucceeded:boolean;biometricResultTime:number;strongAuthFallbackUsed:boolean;cryptoObjectValid:boolean;attestationValid?:boolean}):{bypassDetected:boolean;confidence:number;action:'allow'|'force_pin'|'block';signals:string[]}{
  const s:string[]=[];
  if(a.biometricAuthSucceeded&&a.biometricResultTime<50)s.push('instant_auth_result');
  if(!a.cryptoObjectValid&&a.biometricAuthSucceeded)s.push('crypto_object_invalid');
  if(a.attestationValid===false)s.push('attestation_failed');
  if(a.strongAuthFallbackUsed&&a.biometricResultTime<100)s.push('suspicious_fallback_timing');
  const confidence=Math.min(s.length*0.4,1);
  return{bypassDetected:s.length>=1,confidence,action:confidence>=0.8?'block':confidence>=0.4?'force_pin':'allow',signals:s};}
export const biometricBypass=detectBiometricBypass;

export function sessionTokenBinding(token:{sub:string;deviceId:string;ip:string;ua:string},current:{userId:string;deviceId:string;ip:string;ua:string}):{valid:boolean;mismatches:string[];action:'allow'|'challenge'|'revoke'}{
  const m:string[]=[];
  if(token.sub!==current.userId)m.push('user_id_mismatch');
  if(token.deviceId&&token.deviceId!==current.deviceId)m.push('device_id_mismatch');
  if(token.ip&&token.ip!==current.ip)m.push('ip_mismatch');
  if(token.ua&&token.ua!==current.ua)m.push('user_agent_mismatch');
  return{valid:m.length===0,mismatches:m,action:m.includes('user_id_mismatch')||m.length>=3?'revoke':m.length>=1?'challenge':'allow'};}
export const sessionTokenBind=sessionTokenBinding;export const tokenBinding=sessionTokenBinding;

export function sessionFixation(s:{sessionIdChangedAfterLogin:boolean;sessionIdPreLogin:string;sessionIdPostLogin:string;sessionSetViaUrl:boolean;sessionSetViaCookieFromExternal:boolean}):{detected:boolean;risk:'none'|'low'|'high';action:'none'|'regenerate'|'terminate'}{
  const i:string[]=[];
  if(!s.sessionIdChangedAfterLogin)i.push('session_not_rotated_post_login');
  if(s.sessionIdPreLogin&&s.sessionIdPreLogin===s.sessionIdPostLogin)i.push('pre_post_session_identical');
  if(s.sessionSetViaUrl)i.push('session_id_in_url');
  if(s.sessionSetViaCookieFromExternal)i.push('external_cookie_set');
  const r=i.length>=2?'high':i.length>=1?'low':'none';
  return{detected:r!=='none',risk:r,action:r==='high'?'terminate':r==='low'?'regenerate':'none'};}
export const sessionFixationDetect=sessionFixation;

export function csrfProtection(r:{method:string;origin?:string;host:string;csrfTokenPresent:boolean;csrfTokenValid:boolean;sameSiteCookie:boolean;referer?:string}):{protected:boolean;issue?:string;action:'allow'|'reject'}{
  if(['GET','HEAD','OPTIONS'].includes(r.method))return{protected:true,action:'allow'};
  if(!r.csrfTokenPresent)return{protected:false,issue:'missing_csrf_token',action:'reject'};
  if(!r.csrfTokenValid)return{protected:false,issue:'invalid_csrf_token',action:'reject'};
  if(r.origin&&!r.origin.includes(r.host))return{protected:false,issue:'origin_mismatch',action:'reject'};
  if(r.referer&&!r.referer.includes(r.host))return{protected:false,issue:'referer_mismatch',action:'reject'};
  if(!r.sameSiteCookie)return{protected:false,issue:'missing_samesite_cookie',action:'reject'};
  return{protected:true,action:'allow'};}
export const csrfToken=csrfProtection;export const csrfValidate=csrfProtection;

export function secureCookie(cookies:Array<{name:string;secure:boolean;httpOnly:boolean;sameSite:string;path:string;expires?:number}>):{compliant:boolean;violations:string[];riskLevel:'none'|'low'|'high'}{
  const v:string[]=[],S=['session','token','auth','refresh','sid','jwt','access'];
  for(const c of cookies){const sen=S.some(s=>c.name.toLowerCase().includes(s));if(sen&&!c.secure)v.push(`${c.name}: missing Secure flag`);if(sen&&!c.httpOnly)v.push(`${c.name}: missing HttpOnly flag`);if(sen&&c.sameSite==='None')v.push(`${c.name}: SameSite=None without justification`);if(sen&&c.path==='/')v.push(`${c.name}: overly broad path`);if(sen&&c.expires&&c.expires>Date.now()+86_400_000*30)v.push(`${c.name}: expiry too long (>30 days)`);}
  return{compliant:v.length===0,violations:v,riskLevel:v.length>=3?'high':v.length>=1?'low':'none'};}
export const cookieSecurity=secureCookie;export const cookieFlags=secureCookie;

export function sessionTimeout(s:{createdAt:number;lastActivityAt:number;maxIdleMs:number;maxAbsoluteMs:number}):{expired:boolean;reason?:'idle'|'absolute';remainingMs:number;action:'continue'|'warn'|'terminate'}{
  const now=Date.now(),idle=now-s.lastActivityAt,abs=now-s.createdAt;
  if(abs>=s.maxAbsoluteMs)return{expired:true,reason:'absolute',remainingMs:0,action:'terminate'};
  if(idle>=s.maxIdleMs)return{expired:true,reason:'idle',remainingMs:0,action:'terminate'};
  const remaining=Math.min(s.maxIdleMs-idle,s.maxAbsoluteMs-abs);
  return{expired:false,remainingMs:remaining,action:remaining<300_000?'warn':'continue'};}
export const sessionExpiry=sessionTimeout;export const idleTimeout=sessionTimeout;

export function sessionBinding(s:{boundIp:string;boundUserAgent:string;boundDeviceId:string;currentIp:string;currentUserAgent:string;currentDeviceId:string}):{bound:boolean;mismatches:string[];action:'allow'|'challenge'|'terminate'}{
  const m:string[]=[];
  if(s.boundIp&&s.boundIp!==s.currentIp)m.push('ip_mismatch');
  if(s.boundUserAgent&&s.boundUserAgent!==s.currentUserAgent)m.push('ua_mismatch');
  if(s.boundDeviceId&&s.boundDeviceId!==s.currentDeviceId)m.push('device_mismatch');
  return{bound:m.length===0,mismatches:m,action:m.length>=2?'terminate':m.length>=1?'challenge':'allow'};}
export const sessionPin=sessionBinding;export const deviceBinding=sessionBinding;

export function sessionRevocation(e:{type:string;userId:string}):{revokeAll:boolean;reason:string;immediateEffect:boolean}{
  const R=['password_change','email_change','account_locked','security_breach','user_request','suspected_compromise','mfa_reset','permission_change'];
  const immediate=['security_breach','suspected_compromise','account_locked'];
  return{revokeAll:R.includes(e.type),reason:`${e.type}_triggered_revocation`,immediateEffect:immediate.includes(e.type)};}
export const revokeSession=sessionRevocation;export const sessionInvalidation=sessionRevocation;

export function crossDeviceSession(sessions:Array<{deviceId:string;ip:string;timestamp:number;location:string;actions:string[]}>):{suspicious:boolean;patterns:string[];riskLevel:'none'|'low'|'medium'|'high'}{
  const p:string[]=[];
  if(sessions.length<2)return{suspicious:false,patterns:p,riskLevel:'none'};
  const dev=new Set(sessions.map(s=>s.deviceId));
  if(dev.size>=3)p.push('3plus_devices_24h');
  const sorted=sessions.sort((a,b)=>a.timestamp-b.timestamp);
  for(let i=1;i<sorted.length;i++){const g=(sorted[i]!.timestamp-sorted[i-1]!.timestamp)/3_600_000;if(g<2&&sorted[i]!.location!==sorted[i-1]!.location&&sorted[i]!.deviceId!==sorted[i-1]!.deviceId)p.push('impossible_device_switch');}
  const byD=new Map<string,string[]>();
  for(const s of sessions){if(!byD.has(s.deviceId))byD.set(s.deviceId,[]);byD.get(s.deviceId)!.push(...s.actions);}
  const ro=[...byD.values()].some(a=>a.includes('view_messages')&&!a.includes('send_message'));
  const ha=[...byD.values()].some(a=>a.includes('send_message'));
  if(ro&&ha)p.push('surveillance_pattern');
  const rl=p.length>=2?'high':p.length>=1?'medium':'none';
  return{suspicious:p.length>0,patterns:p,riskLevel:rl};}
export const deviceCorrelation=crossDeviceSession;export const multiDeviceDetect=crossDeviceSession;

export interface AccountWarmingResult{accountWarming:boolean;dormantThenActive:boolean;gapDays:number;activityScore:number;riskLevel:'none'|'low'|'medium'|'high';}
export function accountWarming(a:{createdAt:number;first7dActions:number;last7dActions:number;daysDormantBeforeReactivation:number;loginPattern:'normal'|'burst'|'gradual'}):AccountWarmingResult{
  const d=a.daysDormantBeforeReactivation;
  const r=a.first7dActions>0?a.last7dActions/a.first7dActions:a.last7dActions>0?Infinity:0;
  const da=d>=30&&a.last7dActions>10;
  let sc=0;
  if(da)sc+=40;if(r>=5)sc+=30;if(a.loginPattern==='burst')sc+=20;if(d>=90)sc+=20;if(a.loginPattern==='gradual'&&r>=3)sc+=15;
  const rl=sc>=70?'high':sc>=40?'medium':sc>=20?'low':'none';
  return{accountWarming:da,dormantThenActive:da,gapDays:d,activityScore:Math.min(sc,100),riskLevel:rl};}
export const dormantThenActive=accountWarming;

export interface AutoLogoutResult{autoLogout:boolean;sharedDeviceLogout:boolean;timeoutMs:number;reason:string;}
export function autoLogout(d:{multipleAccountsOnDevice:boolean;lastAccountSwitchAt:number;deviceSharedIndicators:string[];currentSessionDurationMs:number}):AutoLogoutResult{
  const sh=d.multipleAccountsOnDevice||d.deviceSharedIndicators.length>=2;
  const rs=Date.now()-d.lastAccountSwitchAt<86_400_000;
  const al=sh&&rs;
  return{autoLogout:al,sharedDeviceLogout:al,timeoutMs:al?1_800_000:sh?3_600_000:28_800_000,reason:al?'shared_device_short_timeout':sh?'shared_device_medium_timeout':'standard_timeout'};}
export const sharedDeviceLogout=autoLogout;export const autoLogoutShared=autoLogout;

export async function enforceSessionLimitAsync(uid:string,sid:string,max=3){return detectConcurrentSession(uid,sid,'unknown',max);}
export const sessionLimit=enforceSessionLimitAsync;

export function deepLinkHijack(link:{url:string;expectedScheme:string;expectedHost:string;hasDigitalAssetLinks:boolean;callingPackage?:string;expectedPackage?:string}):{safe:boolean;issues:string[];action:'allow'|'warn'|'block'}{
  const issues:string[]=[];
  try{const u=new URL(link.url);if(u.protocol!==link.expectedScheme+':')issues.push('scheme_mismatch');if(u.hostname!==link.expectedHost)issues.push('host_mismatch');}catch{issues.push('malformed_url');}
  if(!link.hasDigitalAssetLinks)issues.push('no_digital_asset_links_verification');
  if(link.callingPackage&&link.expectedPackage&&link.callingPackage!==link.expectedPackage)issues.push('unexpected_calling_package');
  return{safe:issues.length===0,issues,action:issues.includes('scheme_mismatch')||issues.includes('host_mismatch')?'block':issues.length>0?'warn':'allow'};}
export const deepLinkValidate=deepLinkHijack;export const deepLinkSafety=deepLinkHijack;

export interface ProxyCreationResult{detected:boolean;signals:string[];confidence:number;action:'allow'|'flag'|'block';}
export function detectProxyAccountCreation(signals:{sameDeviceMultipleAccounts:boolean;automatedTypingPattern:boolean;pastedAllFields:boolean;noTypingErrors:boolean;completedUnder60s:boolean;vpnOrProxy:boolean;disposableEmail:boolean}):ProxyCreationResult{
  const s:string[]=[];
  if(signals.sameDeviceMultipleAccounts)s.push('same_device_multi_account');
  if(signals.automatedTypingPattern)s.push('automated_typing');
  if(signals.pastedAllFields)s.push('all_fields_pasted');
  if(signals.noTypingErrors)s.push('no_typing_errors');
  if(signals.completedUnder60s)s.push('completed_under_60s');
  if(signals.vpnOrProxy)s.push('vpn_or_proxy');
  if(signals.disposableEmail)s.push('disposable_email');
  const confidence=Math.min(s.length*0.15,1);
  return{detected:s.length>=3,signals:s,confidence,action:confidence>=0.6?'block':confidence>=0.3?'flag':'allow'};}
export const proxyCreation=detectProxyAccountCreation;export const bulkAccountCreate=detectProxyAccountCreation;

export interface SharedDeviceResult{isShared:boolean;indicators:string[];recommendation:string;}
export function detectSharedDevice(signals:{multipleUserAgents:boolean;multipleAccountsLoggedIn:boolean;privateModeBrowser:boolean;publicNetworkIp:boolean;locationIsLibraryOrCafe:boolean}):SharedDeviceResult{
  const ind:string[]=[];
  if(signals.multipleUserAgents)ind.push('multiple_user_agents');
  if(signals.multipleAccountsLoggedIn)ind.push('multiple_accounts');
  if(signals.privateModeBrowser)ind.push('private_browser_mode');
  if(signals.publicNetworkIp)ind.push('public_network_ip');
  if(signals.locationIsLibraryOrCafe)ind.push('public_location');
  return{isShared:ind.length>=2,indicators:ind,recommendation:ind.length>=2?'Shared device detected. Enable guest mode and short session timeout.':'Device appears to be personal.'};}
export const sharedDevice=detectSharedDevice;export const publicDevice=detectSharedDevice;

export interface DetectorEvasionResult{evasionDetected:boolean;techniques:string[];confidence:number;action:'allow'|'flag'|'block';}
export function detectDetectorEvasion(signals:{unusualUnicodeUsage:boolean;base64InMessages:boolean;homoglyphsDetected:boolean;zeroWidthCharsFound:boolean;rtlOverrideFound:boolean;rapidAccountSwitching:boolean}):DetectorEvasionResult{
  const t:string[]=[];
  if(signals.unusualUnicodeUsage)t.push('unusual_unicode');
  if(signals.base64InMessages)t.push('base64_encoding');
  if(signals.homoglyphsDetected)t.push('homoglyph_substitution');
  if(signals.zeroWidthCharsFound)t.push('zero_width_chars');
  if(signals.rtlOverrideFound)t.push('rtl_override');
  if(signals.rapidAccountSwitching)t.push('rapid_account_switching');
  const confidence=Math.min(t.length*0.2,1);
  return{evasionDetected:t.length>=2,techniques:t,confidence,action:confidence>=0.6?'block':confidence>=0.3?'flag':'allow'};}
export const detectorEvasion=detectDetectorEvasion;export const evasionDetect=detectDetectorEvasion;

export interface SessionAnomalyResult{anomalyScore:number;riskLevel:'none'|'low'|'medium'|'high';signals:string[];action:'allow'|'challenge'|'terminate';}
export function scoreSessionAnomaly(s:{ipChanged:boolean;locationJumpKm:number;uaChanged:boolean;deviceChanged:boolean;actionsPerMinute:number;unusualHour:boolean;newCountry:boolean;torOrVpn:boolean}):SessionAnomalyResult{
  const signals:string[]=[];let score=0;
  if(s.ipChanged){signals.push('ip_changed');score+=15;}
  if(s.locationJumpKm>500){signals.push('location_jump_500km');score+=35;}else if(s.locationJumpKm>100){signals.push('location_jump_100km');score+=20;}
  if(s.uaChanged){signals.push('ua_changed');score+=15;}
  if(s.deviceChanged){signals.push('device_changed');score+=25;}
  if(s.actionsPerMinute>60){signals.push('high_action_rate');score+=20;}
  if(s.unusualHour){signals.push('unusual_hour');score+=10;}
  if(s.newCountry){signals.push('new_country');score+=20;}
  if(s.torOrVpn){signals.push('tor_or_vpn');score+=15;}
  score=Math.min(score,100);
  const rl:SessionAnomalyResult['riskLevel']=score>=70?'high':score>=40?'medium':score>=20?'low':'none';
  return{anomalyScore:score,riskLevel:rl,signals,action:rl==='high'?'terminate':rl==='medium'?'challenge':'allow'};}
export const sessionAnomaly=scoreSessionAnomaly;export const anomalyScore=scoreSessionAnomaly;

export interface ReauthTriggerResult{required:boolean;reason:string;urgency:'low'|'medium'|'high';}
export function checkReauthRequired(context:{sensitiveAction:boolean;sessionAgeMs:number;locationChanged:boolean;deviceChanged:boolean;privilegeEscalation:boolean;paymentAction:boolean}):ReauthTriggerResult{
  if(context.privilegeEscalation)return{required:true,reason:'privilege_escalation',urgency:'high'};
  if(context.paymentAction&&context.sessionAgeMs>3_600_000)return{required:true,reason:'payment_stale_session',urgency:'high'};
  if(context.deviceChanged)return{required:true,reason:'device_changed',urgency:'high'};
  if(context.sensitiveAction&&context.sessionAgeMs>1_800_000)return{required:true,reason:'sensitive_action_idle',urgency:'medium'};
  if(context.locationChanged&&context.sessionAgeMs>7_200_000)return{required:true,reason:'location_change_long_session',urgency:'low'};
  return{required:false,reason:'session_valid',urgency:'low'};}
export const reauthTrigger=checkReauthRequired;export const stepUpAuth=checkReauthRequired;

export interface PrivilegeEscalationResult{detected:boolean;fromRole:string;toRole:string;legitimate:boolean;action:'allow'|'audit'|'block';}
export function detectPrivilegeEscalation(e:{userId:string;fromRole:string;toRole:string;approvedBy?:string;hasAuditTrail:boolean;isEmergencyAccess:boolean}):PrivilegeEscalationResult{
  const adminRoles=['admin','moderator','super_admin','support'];
  const toAdmin=adminRoles.includes(e.toRole)&&!adminRoles.includes(e.fromRole);
  const selfApproved=!e.approvedBy||e.approvedBy===e.userId;
  const legitimate=!toAdmin||(!!e.approvedBy&&!selfApproved&&e.hasAuditTrail);
  return{detected:toAdmin&&!legitimate,fromRole:e.fromRole,toRole:e.toRole,legitimate,action:!legitimate?'block':toAdmin?'audit':'allow'};}
export const privEscalation=detectPrivilegeEscalation;export const roleEscalation=detectPrivilegeEscalation;

export interface TokenRefreshAbuseResult{abusive:boolean;refreshCount:number;intervalMs:number;action:'allow'|'rate_limit'|'revoke';}
const tokenRefreshLog=new Map<string,number[]>();
export function detectTokenRefreshAbuse(userId:string,windowMs=3_600_000,maxRefreshes=20):TokenRefreshAbuseResult{
  const now=Date.now();
  const log=(tokenRefreshLog.get(userId)??[]).filter(t=>now-t<windowMs);
  log.push(now);tokenRefreshLog.set(userId,log);
  const cnt=log.length;
  const avgInterval=cnt>=2?(log[log.length-1]!-log[0]!)/(cnt-1):windowMs;
  const abusive=cnt>=maxRefreshes||avgInterval<5_000;
  return{abusive,refreshCount:cnt,intervalMs:Math.round(avgInterval),action:abusive&&avgInterval<1_000?'revoke':abusive?'rate_limit':'allow'};}
export const tokenRefreshAbuse=detectTokenRefreshAbuse;export const refreshAbuse=detectTokenRefreshAbuse;

export interface SessionEntropyResult{sufficient:boolean;entropyBits:number;recommendation:string;}
export function validateSessionEntropy(sessionId:string):SessionEntropyResult{
  const unique=new Set(sessionId.split('')).size;const len=sessionId.length;
  const entropyBits=Math.log2(Math.pow(unique,len));
  const sufficient=entropyBits>=128&&len>=32;
  return{sufficient,entropyBits:Math.round(entropyBits),recommendation:sufficient?'Session ID entropy is sufficient.':len<32?'Session ID too short. Use at least 32 characters.':'Increase character diversity in session ID generation.'};}
export const sessionEntropy=validateSessionEntropy;export const tokenEntropy=validateSessionEntropy;

export interface PasswordSprayResult{detected:boolean;targetCount:number;attemptCount:number;riskLevel:'none'|'medium'|'high'|'critical';action:'allow'|'captcha'|'block'|'alert';}
const sprayLog=new Map<string,{targets:Set<string>;timestamps:number[]}>();
export function detectPasswordSpray(sourceIp:string,targetUserId:string,windowMs=3_600_000):PasswordSprayResult{
  const now=Date.now();
  if(!sprayLog.has(sourceIp))sprayLog.set(sourceIp,{targets:new Set(),timestamps:[]});
  const log=sprayLog.get(sourceIp)!;
  log.timestamps=log.timestamps.filter(t=>now-t<windowMs);
  log.timestamps.push(now);log.targets.add(targetUserId);
  const tc=log.targets.size,ac=log.timestamps.length;
  const rl:PasswordSprayResult['riskLevel']=tc>=20?'critical':tc>=10?'high':tc>=5?'medium':'none';
  return{detected:tc>=5,targetCount:tc,attemptCount:ac,riskLevel:rl,action:rl==='critical'?'alert':rl==='high'?'block':rl==='medium'?'captcha':'allow'};}
export const passwordSpray=detectPasswordSpray;export const sprayDetect=detectPasswordSpray;

export interface CredentialStuffingResult{detected:boolean;successRate:number;attemptCount:number;action:'allow'|'captcha'|'block';}
const stuffLog=new Map<string,{success:number;fail:number}>();
export function detectCredentialStuffing(ip:string,success:boolean,windowMs=3_600_000):CredentialStuffingResult{
  void windowMs;
  if(!stuffLog.has(ip))stuffLog.set(ip,{success:0,fail:0});
  const log=stuffLog.get(ip)!;
  if(success)log.success++;else log.fail++;
  const total=log.success+log.fail;
  const rate=total>0?log.success/total:0;
  const detected=total>=10&&rate>=0.1&&rate<=0.3;
  return{detected,successRate:Math.round(rate*100)/100,attemptCount:total,action:detected?total>=50?'block':'captcha':'allow'};}
export const credentialStuffing=detectCredentialStuffing;export const stuffingDetect=detectCredentialStuffing;

export interface RegistrationAnomalyResult{anomalous:boolean;signals:string[];confidence:number;action:'allow'|'captcha'|'manual_review'|'block';}
export function detectRegistrationAnomaly(reg:{completionTimeMs:number;pastedFields:string[];noTypingErrors:boolean;sameIpAsRecent:boolean;disposableEmail:boolean;vpnOrProxy:boolean;sameDeviceAsRecent:boolean;unusualTimezone:boolean}):RegistrationAnomalyResult{
  const s:string[]=[];
  if(reg.completionTimeMs<30_000)s.push('completed_under_30s');
  if(reg.pastedFields.length>=3)s.push('most_fields_pasted');
  if(reg.noTypingErrors&&reg.completionTimeMs<60_000)s.push('no_errors_very_fast');
  if(reg.sameIpAsRecent)s.push('ip_used_for_recent_account');
  if(reg.disposableEmail)s.push('disposable_email');
  if(reg.vpnOrProxy)s.push('vpn_or_proxy');
  if(reg.sameDeviceAsRecent)s.push('device_used_for_recent_account');
  if(reg.unusualTimezone)s.push('unusual_timezone');
  const confidence=Math.min(s.length*0.14,1);
  return{anomalous:s.length>=3,signals:s,confidence,action:confidence>=0.7?'block':confidence>=0.4?'manual_review':confidence>=0.2?'captcha':'allow'};}
export const registrationAnomaly=detectRegistrationAnomaly;export const signupAnomaly=detectRegistrationAnomaly;

export interface PhoneValidationResult{valid:boolean;isVoip:boolean;isMobile:boolean;countryCode:string;normalized:string;}
export function validatePhoneNumber(phone:string,expectedCountry?:string):PhoneValidationResult{
  const digits=phone.replace(/\D/g,'');
  const valid=digits.length>=10&&digits.length<=15;
  const normalized=digits.startsWith('1')&&digits.length===11?`+${digits}`:`+${digits}`;
  const cc=digits.length===11&&digits.startsWith('1')?'US':digits.startsWith('44')?'GB':digits.startsWith('91')?'IN':'unknown';
  const countryMismatch=expectedCountry&&cc!=='unknown'&&cc!==expectedCountry;
  return{valid:valid&&!countryMismatch,isVoip:false,isMobile:valid,countryCode:cc,normalized};}
export const phoneValidate=validatePhoneNumber;export const phoneCheck=validatePhoneNumber;

export interface DisposableEmailResult{isDisposable:boolean;domain:string;confidence:number;action:'allow'|'warn'|'block';}
const DISPOSABLE_DOMAINS=new Set(['guerrillamail.com','sharklasers.com','grr.la','tempmail.com','throwaway.email','mailinator.com','maildrop.cc','yopmail.com','dispostable.com','trashmail.com','spam4.me','mailcatch.com','tempr.email','discard.email','mailnesia.com','tempinbox.com','moakt.co','mailnull.com','getairmail.com','fakeinbox.com','trashmail.net','spamgourmet.com','throwam.com','mailexpire.com','spamfree24.org','mailzilla.com','incognitomail.com','spamgourmet.net','filzmail.com','guerrillamailblock.com','getnada.com','tnef.com','sharklasers.com','spam4.me','trbvm.com']);
export function detectDisposableEmail(email:string):DisposableEmailResult{
  const domain=email.split('@')[1]?.toLowerCase()??'';
  const isDisposable=DISPOSABLE_DOMAINS.has(domain)||/^(temp|disposable|trash|spam|fake|throw)/i.test(domain);
  return{isDisposable,domain,confidence:isDisposable?0.95:0.1,action:isDisposable?'block':'allow'};}
export const disposableEmail=detectDisposableEmail;export const tempEmail=detectDisposableEmail;

export interface BruteForceResult{detected:boolean;attemptCount:number;lockedOut:boolean;lockoutUntil:number|null;action:'allow'|'captcha'|'lockout'|'permanent_block';}
const bruteForceLog=new Map<string,{attempts:number[];locked:boolean;lockUntil:number}>();
export function detectBruteForce(identifier:string,windowMs=900_000,maxAttempts=5):BruteForceResult{
  const now=Date.now();
  if(!bruteForceLog.has(identifier))bruteForceLog.set(identifier,{attempts:[],locked:false,lockUntil:0});
  const log=bruteForceLog.get(identifier)!;
  if(log.locked&&now<log.lockUntil)return{detected:true,attemptCount:log.attempts.length,lockedOut:true,lockoutUntil:log.lockUntil,action:'lockout'};
  log.attempts=log.attempts.filter(t=>now-t<windowMs);log.attempts.push(now);
  const cnt=log.attempts.length;
  if(cnt>=maxAttempts*3){log.locked=true;log.lockUntil=now+86_400_000;return{detected:true,attemptCount:cnt,lockedOut:true,lockoutUntil:log.lockUntil,action:'permanent_block'};}
  if(cnt>=maxAttempts){log.locked=true;log.lockUntil=now+900_000;return{detected:true,attemptCount:cnt,lockedOut:true,lockoutUntil:log.lockUntil,action:'lockout'};}
  return{detected:cnt>=3,attemptCount:cnt,lockedOut:false,lockoutUntil:null,action:cnt>=3?'captcha':'allow'};}
export const bruteForce=detectBruteForce;export const loginBrute=detectBruteForce;

export interface MFABypassResult{bypassDetected:boolean;method:string;action:'allow'|'block'|'alert';}
export function detectMFABypass(attempt:{mfaSkipped:boolean;fallbackUsed:boolean;fallbackType:string;timeSinceLastMFA:number;locationChanged:boolean;deviceChanged:boolean}):MFABypassResult{
  if(attempt.mfaSkipped&&attempt.locationChanged)return{bypassDetected:true,method:'skip_with_location_change',action:'block'};
  if(attempt.mfaSkipped&&attempt.deviceChanged)return{bypassDetected:true,method:'skip_with_device_change',action:'block'};
  if(attempt.fallbackUsed&&attempt.timeSinceLastMFA<60_000)return{bypassDetected:true,method:'rapid_fallback',action:'alert'};
  if(attempt.fallbackType==='recovery_code'&&attempt.locationChanged&&attempt.deviceChanged)return{bypassDetected:true,method:'recovery_code_with_anomalies',action:'alert'};
  return{bypassDetected:false,method:'none',action:'allow'};}
export const mfaBypass=detectMFABypass;export const totpBypass=detectMFABypass;

export interface SessionReplayResult{detected:boolean;signals:string[];action:'allow'|'invalidate'|'block';}
const usedNonces=new Set<string>();
export function detectSessionReplay(s:{nonce:string;timestamp:number;tokenIssuedAt:number;requestCount:number;replayWindowMs?:number}):SessionReplayResult{
  const signals:string[]=[];const win=s.replayWindowMs??300_000;
  if(usedNonces.has(s.nonce)){signals.push('duplicate_nonce');return{detected:true,signals,action:'block'};}
  usedNonces.add(s.nonce);if(usedNonces.size>100_000){const arr=[...usedNonces];arr.splice(0,10_000).forEach(n=>usedNonces.delete(n));}
  if(Date.now()-s.timestamp>win)signals.push('stale_timestamp');
  if(s.requestCount>1000)signals.push('request_count_anomaly');
  if(Date.now()-s.tokenIssuedAt>86_400_000)signals.push('expired_token_reuse');
  return{detected:signals.length>=2,signals,action:signals.includes('stale_timestamp')&&signals.length>=2?'block':signals.length>=1?'invalidate':'allow'};}
export const sessionReplay=detectSessionReplay;export const replayAttack=detectSessionReplay;

export interface SessionHijackResult {
  detected: boolean;
  signals: string[];
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  action: 'none' | 'reverify' | 'terminate' | 'block';
}

export function detectSessionHijack(data: {
  userId: string;
  sessionId: string;
  originalIp: string;
  currentIp: string;
  originalUserAgent: string;
  currentUserAgent: string;
  originalCountry: string;
  currentCountry: string;
  timeSinceLastActivityMs: number;
}): SessionHijackResult {
  const signals: string[] = [];
  let score = 0;

  if (data.originalIp !== data.currentIp) { score += 2; signals.push('ip_changed'); }
  if (data.originalCountry !== data.currentCountry) { score += 3; signals.push('country_changed'); }
  if (data.originalUserAgent !== data.currentUserAgent) { score += 2; signals.push('user_agent_changed'); }
  if (data.timeSinceLastActivityMs > 3600000) { score += 1; signals.push('long_inactivity'); }

  let riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical' = 'none';
  let action: 'none' | 'reverify' | 'terminate' | 'block' = 'none';

  if (score >= 6) { riskLevel = 'critical'; action = 'block'; }
  else if (score >= 4) { riskLevel = 'high'; action = 'terminate'; }
  else if (score >= 2) { riskLevel = 'medium'; action = 'reverify'; }
  else if (score >= 1) { riskLevel = 'low'; action = 'reverify'; }

  return { detected: score >= 2, signals, riskLevel, action };
}

export const _detector_288_copyPasteLogin = {
  id: 288,
  section: '4.2',
  name: 'Copy-paste login detection',
  severity: 'low' as const,
  patterns: ["copyPasteLogin","pastedCredentials"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('copyPasteLogin') || input.includes('pastedCredentials');
  }
};

export function detectAccountSharing(data:{userId:string;deviceFingerprints:string[];loginLocations:string[];concurrentSessions:number;differentCountries:number}):{detected:boolean;riskLevel:'none'|'low'|'medium'|'high';signals:string[];action:'none'|'warn'|'require_reverify'|'suspend'}{
  const signals:string[]=[];
  let score=0;
  if(data.deviceFingerprints.length>3){score+=2;signals.push('multiple_devices');}
  if(data.concurrentSessions>2){score+=3;signals.push('concurrent_sessions');}
  if(data.differentCountries>2){score+=3;signals.push('multiple_countries');}
  const riskLevel=score>=6?'high':score>=4?'medium':score>=2?'low':'none';
  const action=score>=6?'suspend':score>=4?'require_reverify':score>=2?'warn':'none';
  return{detected:score>=2,riskLevel,signals,action};
}
export const accountSharingDetect=detectAccountSharing;

export function detectAccountWarming(data:{userId:string;dormantDays:number;suddenActivitySpike:boolean;newDeviceAfterDormancy:boolean;activityScore:number}):{accountWarming:boolean;dormantThenActive:boolean;gapDays:number;activityScore:number;riskLevel:'none'|'low'|'medium'|'high'}{
  const warming=data.dormantDays>30&&data.suddenActivitySpike;
  const riskLevel=warming&&data.newDeviceAfterDormancy?'high':warming?'medium':data.dormantDays>7?'low':'none';
  return{accountWarming:warming,dormantThenActive:warming,gapDays:data.dormantDays,activityScore:data.activityScore,riskLevel};
}
export const accountWarmingDetect=detectAccountWarming;

export function detectBotActivity(data:{userId:string;requestsPerMinute:number;humanlikeVariance:boolean;appCheckPassed:boolean;behavioralScore:number}):{isBot:boolean;confidence:number;signals:string[];action:'none'|'captcha'|'block'}{
  const signals:string[]=[];
  let score=0;
  if(data.requestsPerMinute>60){score+=3;signals.push('high_request_rate');}
  if(!data.humanlikeVariance){score+=2;signals.push('no_human_variance');}
  if(!data.appCheckPassed){score+=3;signals.push('app_check_failed');}
  if(data.behavioralScore>0.8){score+=2;signals.push('high_behavioral_bot_score');}
  return{isBot:score>=4,confidence:Math.min(100,score*12),signals,action:score>=6?'block':score>=3?'captcha':'none'};
}
export const botActivityDetect=detectBotActivity;

export function detectMemoryTampering(data:{checksumValid:boolean;runtimeIntegrityOk:boolean;suspiciousLibraries:string[];memoryRegionsModified:boolean}):{detected:boolean;severity:'none'|'low'|'high';action:'none'|'warn'|'terminate'}{
  const signals=[];
  if(!data.checksumValid)signals.push('checksum_invalid');
  if(!data.runtimeIntegrityOk)signals.push('runtime_integrity_fail');
  if(data.suspiciousLibraries.length>0)signals.push('suspicious_libs');
  if(data.memoryRegionsModified)signals.push('memory_modified');
  const detected=signals.length>0;
  const severity=signals.length>=2?'high':signals.length===1?'low':'none';
  return{detected,severity,action:severity==='high'?'terminate':severity==='low'?'warn':'none'};
}
export const memoryTamperDetect=detectMemoryTampering;

export function detectMockLocation(data:{allowMockLocation:boolean;gpsAccuracy:number;locationJumps:number;knownVpnIp:boolean}):{detected:boolean;signals:string[];riskLevel:'none'|'low'|'medium'|'high'}{
  const signals:string[]=[];
  if(data.allowMockLocation)signals.push('mock_location_enabled');
  if(data.gpsAccuracy>100)signals.push('poor_gps_accuracy');
  if(data.locationJumps>3)signals.push('location_jumps');
  if(data.knownVpnIp)signals.push('vpn_detected');
  const riskLevel=signals.length>=3?'high':signals.length===2?'medium':signals.length===1?'low':'none';
  return{detected:signals.length>0,signals,riskLevel};
}
export const mockLocationDetect=detectMockLocation;

export function detectTapjacking(data:{overlayDetected:boolean;filterTouchesEnabled:boolean;obscuredTouchEvents:number}):{tapjacking:boolean;protected:boolean;vulnerability:'none'|'partial'|'vulnerable';mitigations:string[]}{
  const mitigations:string[]=[];
  if(data.filterTouchesEnabled)mitigations.push('filterTouchesWhenObscured=true');
  const vulnerability=data.overlayDetected&&!data.filterTouchesEnabled?'vulnerable':data.overlayDetected?'partial':'none';
  return{tapjacking:data.overlayDetected,protected:data.filterTouchesEnabled,vulnerability,mitigations};
}
export const tapjackingDetect=detectTapjacking;

export function detectPushSpoofing(data:{source:string;certificateHash?:string;expectedHash?:string;bundleId?:string;expectedBundleId?:string}):{spoofed:boolean;signals:string[];action:'allow'|'block'}{
  const signals:string[]=[];
  if(data.certificateHash&&data.expectedHash&&data.certificateHash!==data.expectedHash)signals.push('cert_hash_mismatch');
  if(data.bundleId&&data.expectedBundleId&&data.bundleId!==data.expectedBundleId)signals.push('bundle_id_mismatch');
  return{spoofed:signals.length>0,signals,action:signals.length>0?'block':'allow'};
}
export const pushSpoofDetect=detectPushSpoofing;

export function detectMdmAbuse(data:{hasEnterpriseProfile:boolean;profileSource:string;appSignedByEnterprise:boolean;deviceManaged:boolean}):{mdmAbuse:boolean;riskLevel:'none'|'low'|'medium'|'high';indicators:string[];action:'allow'|'warn'|'block'}{
  const indicators:string[]=[];
  if(data.hasEnterpriseProfile&&!data.deviceManaged)indicators.push('unofficial_enterprise_profile');
  if(data.appSignedByEnterprise&&profileSource!=='known_mdm')indicators.push('suspicious_signing');
  const riskLevel=indicators.length>=2?'high':indicators.length===1?'medium':'none';
  return{mdmAbuse:indicators.length>0,riskLevel,indicators,action:riskLevel==='high'?'block':riskLevel==='medium'?'warn':'allow'};
}
export const mdmAbuseDetect=detectMdmAbuse;

export function detectBiometricBypass(data:{biometricAuthUsed:boolean;fallbackUsed:boolean;timingAnomaly:boolean;deviceTrusted:boolean}):{detected:boolean;riskLevel:'none'|'low'|'medium'|'high';action:'none'|'reverify'|'block'}{
  const signals:string[]=[];
  if(data.fallbackUsed&&!data.deviceTrusted)signals.push('untrusted_fallback');
  if(data.timingAnomaly)signals.push('timing_anomaly');
  const riskLevel=signals.length>=2?'high':signals.length===1?'medium':'none';
  return{detected:signals.length>0,riskLevel,action:riskLevel==='high'?'block':riskLevel==='medium'?'reverify':'none'};
}
export const biometricBypassDetect=detectBiometricBypass;

export function detectAccessibilityServiceAbuse(installedServices:string[]):{abuseDetected:boolean;suspiciousServices:string[];riskLevel:'none'|'medium'|'high'}{
  const knownAbusiveServices=['com.spy.app','keylogger','screenrecord','auto_clicker'];
  const suspicious=installedServices.filter(s=>knownAbusiveServices.some(k=>s.toLowerCase().includes(k)));
  const riskLevel=suspicious.length>=2?'high':suspicious.length===1?'medium':'none';
  return{abuseDetected:suspicious.length>0,suspiciousServices:suspicious,riskLevel};
}
export const accessibilityAbuseDetect=detectAccessibilityServiceAbuse;

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
export const _ref_emailAlias = _det263_emailAlias;
export const _ref_plusAlias = _det263_emailAlias;
export const _ref_dotAlias = _det263_emailAlias;
export const _ref_gmailDot = _det263_emailAlias;

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
export const _ref_appleRelay = _det264_appleRelay;
export const _ref_hideMyEmail = _det264_appleRelay;
export const _ref_privaterelay_appleid_com = _det264_appleRelay;

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
export const _ref_phoneRecycling = _det267_phoneRecycling;
export const _ref_numberRecycled = _det267_phoneRecycling;

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
export const _ref_accountEnumeration = _det284_accountEnumeration;
export const _ref_timingAttack = _det284_accountEnumeration;
export const _ref_constantTimeCompare = _det284_accountEnumeration;

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
export const _ref_datacenterIP = _det285_datacenterIP;
export const _ref_hostingProvider = _det285_datacenterIP;
export const _ref_cloudIP = _det285_datacenterIP;

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
export const _ref_accountWarming = _det291_accountWarming;
export const _ref_dormantThenActive = _det291_accountWarming;

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
export const _ref_getAppCheckToken = _det292_getAppCheckToken;
export const _ref_AppCheck = _det292_getAppCheckToken;
export const _ref_appCheck = _det292_getAppCheckToken;

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
export const _ref_apkTamper = _det295_apkTamper;
export const _ref_tampered_apk = _det295_apkTamper;
export const _ref_appSignature__expectedSignature = _det295_apkTamper;
export const _ref_integrityCheck = _det295_apkTamper;

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
export const _ref_FLAG_DEBUGGABLE = _det296_FLAG_DEBUGGABLE;
export const _ref_isDebug = _det296_FLAG_DEBUGGABLE;
export const _ref_debug_mode = _det296_FLAG_DEBUGGABLE;
export const _ref_check_device_integrity = _det296_FLAG_DEBUGGABLE;

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
export const _ref_DEVELOPMENT_SETTINGS = _det297_DEVELOPMENT_SETTINGS;
export const _ref_developerOptions = _det297_DEVELOPMENT_SETTINGS;
export const _ref_developer_options = _det297_DEVELOPMENT_SETTINGS;

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
export const _ref_ADB_ENABLED = _det298_ADB_ENABLED;
export const _ref_usbDebug = _det298_ADB_ENABLED;
export const _ref_adbEnabled = _det298_ADB_ENABLED;
export const _ref_adb_enabled = _det298_ADB_ENABLED;

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
export const _ref_memoryTamper = _det300_memoryTamper;
export const _ref_checksumMemory = _det300_memoryTamper;
export const _ref_memory_tamper = _det300_memoryTamper;

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
export const _ref_hasMockLocation = _det301_hasMockLocation;
export const _ref_ALLOW_MOCK_LOCATION = _det301_hasMockLocation;
export const _ref_mock_location = _det301_hasMockLocation;
export const _ref_mockGPS = _det301_hasMockLocation;

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
export const _ref_accessibilityAbuse = _det303_accessibilityAbuse;
export const _ref_getEnabledAccessibility = _det303_accessibilityAbuse;
export const _ref_accessibility_abuse = _det303_accessibilityAbuse;

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
export const _ref_tapjacking = _det306_tapjacking;
export const _ref_filterTouchesWhenObscured = _det306_tapjacking;

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
export const _ref_clipboardSniff = _det308_clipboardSniff;
export const _ref_pasteboardAccess = _det308_clipboardSniff;
export const _ref_clipboardMonitor = _det308_clipboardSniff;

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
export const _ref_pushSpoof = _det309_pushSpoof;
export const _ref_notificationSpoof = _det309_pushSpoof;

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
export const _ref_mdmAbuse = _det311_mdmAbuse;
export const _ref_enterpriseCert = _det311_mdmAbuse;
export const _ref_provisioningProfile = _det311_mdmAbuse;

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
export const _ref_cveMonitor = _det497_cveMonitor;
export const _ref_vulnerabilityAlert = _det497_cveMonitor;
export const _ref_dependabot = _det497_cveMonitor;
export const _ref_snyk = _det497_cveMonitor;

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
export const _ref_supplyChainAttack = _det498_supplyChainAttack;
export const _ref_lockfileIntegrity = _det498_supplyChainAttack;
export const _ref_packageIntegrity = _det498_supplyChainAttack;

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
export const _ref_insiderThreat = _det499_insiderThreat;
export const _ref_privilegedAccess = _det499_insiderThreat;
export const _ref_adminAbuse = _det499_insiderThreat;

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
export const _ref_canaryDeploy = _det503_canaryDeploy;
export const _ref_canaryDetector = _det503_canaryDeploy;
export const _ref_detectorCanary = _det503_canaryDeploy;

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
export const _ref_detectorCorrelation = _det504_detectorCorrelation;
export const _ref_correlateDetectors = _det504_detectorCorrelation;
export const _ref_signalCorrelation = _det504_detectorCorrelation;

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
export const _ref_lawEnforcementRequest = _det506_lawEnforcementRequest;
export const _ref_subpoenaProcess = _det506_lawEnforcementRequest;
export const _ref_legalRequest = _det506_lawEnforcementRequest;

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
export const _ref_security_txt = _det508_security_txt;
export const _ref_responsibleDisclosure = _det508_security_txt;
export const _ref_bugBounty = _det508_security_txt;
export const _ref_securityTxt = _det508_security_txt;

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
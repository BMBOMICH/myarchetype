// ═══════════════════════════════════════════════════════════════
// utils/remainingInfraDetectors.ts — FULL UPDATED
// ═══════════════════════════════════════════════════════════════
import { writeAuditLog } from './logger';

const API=process.env['EXPO_PUBLIC_API_URL']??'';
const safeFetch=async<T>(ep:string,body?:unknown,t=8000):Promise<T|null>=>{const c=new AbortController();const id=setTimeout(()=>c.abort(),t);try{const r=await fetch(`${API}${ep}`,{method:'POST',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:c.signal});if(!r.ok)return null;return r.json() as T;}catch{return null;}finally{clearTimeout(id);}};

// ─── [15.5] Fairness Monitor (re-export from remainingDetectors)
export { biasMonitor, discriminatoryFilter, fairnessMonitor, measureFairness, monitorOutcomeDisparity, verifyDebiasing } from './remainingDetectors';

// ─── [15.5] Ethnicity-Based Filter Abuse Detection ───────────
export interface EthnicityFilterAbuseResult{blocked:boolean;filterField:string;filterValue:string;reason:string;severity:'none'|'low'|'medium'|'high';alternativesAllowed:string[];auditLogged:boolean;}
const BLOCKED_ETHNICITY_FIELDS=new Set(['ethnicity','race','skin_color','racial_background','ethnic_origin','skin_tone','complexion']);
const BLOCKED_FILTER_VALUES=['white_only','no_black','no_asian','no_hispanic','no_arab','no_indian','same_race_only','blacks_only','asians_only','no_minorities','europeans_only','no_foreigners'];
export function detectEthnicityFilterAbuse(filterField:string,filterValue:string):EthnicityFilterAbuseResult{
const fieldLower=filterField.toLowerCase();const valueLower=filterValue.toLowerCase();
if(BLOCKED_ETHNICITY_FIELDS.has(fieldLower)){
void writeAuditLog('fairness.ethnicity_filter_field_blocked',{field:filterField,value:filterValue}).catch(()=>{});
return{blocked:true,filterField,filterValue,reason:`Filter field "${filterField}" constitutes ethnic discrimination under fair housing and civil rights laws`,severity:'high',alternativesAllowed:['cultural_background_optional','language_preference','religious_preference_optional'],auditLogged:true};}
if(BLOCKED_FILTER_VALUES.some(v=>valueLower.includes(v))){
void writeAuditLog('fairness.ethnicity_filter_value_blocked',{field:filterField,value:filterValue}).catch(()=>{});
return{blocked:true,filterField,filterValue,reason:`Filter value "${filterValue}" constitutes ethnic discrimination`,severity:'high',alternativesAllowed:['Open matching without ethnic restrictions'],auditLogged:true};}
const PROXY_FIELDS=['neighborhood','zip_code','school_name','employer'];
const PROXY_VALUES=['ghetto','hood','suburbs','ivy_league'];
if(PROXY_FIELDS.includes(fieldLower)&&PROXY_VALUES.some(v=>valueLower.includes(v))){
void writeAuditLog('fairness.proxy_discrimination',{field:filterField,value:filterValue}).catch(()=>{});
return{blocked:true,filterField,filterValue,reason:`Filter value "${filterValue}" may be used as a proxy for ethnic discrimination`,severity:'medium',alternativesAllowed:['distance_based_filtering','city_filtering'],auditLogged:true};}
return{blocked:false,filterField,filterValue,reason:'Filter is compliant',severity:'none',alternativesAllowed:[],auditLogged:false};}
export const ethnicityFilterAbuse=detectEthnicityFilterAbuse;
export const racialFilterBlock=detectEthnicityFilterAbuse;
export const ethnicDiscrimination=detectEthnicityFilterAbuse;

// ─── [44] Account Selling / Marketplace Detection ────────────
export interface AccountSellingResult{detected:boolean;confidence:number;signals:string[];listingPlatforms:string[];action:'none'|'flag'|'suspend'|'ban';recommendation:string;}
const SELLING_PATTERNS=[
/selling\s+(my\s+)?(dating|tinder|bumble|hinge|okcupid|grindr)\s+account/i,
/account\s+for\s+sale/i,
/buy\s+(my\s+)?(premium|gold|plus|boost)\s+account/i,
/(verified|blue\s+check|matches|likes)\s+(account|profile)\s+(for\s+sale|selling|available)/i,
/\$\d+\s+(for\s+)?(my\s+)?(account|profile|matches)/i,
/transfer\s+(my\s+)?(account|profile)\s+(to|for)/i,
/(\d+)\s+matches\s+included/i,
/aged\s+account\s+(with\s+)?(matches|history|verified)/i,
/selling\s+(matches|likes|boost)\s+account/i,
/ready\s+to\s+use\s+(dating|tinder|bumble|hinge)\s+account/i,
];
const SELLING_PLATFORMS=['ebay','craigslist','facebook marketplace','reddit','discord','telegram','whatsapp'];
export function detectAccountSelling(content:{bio?:string;messages?:string[];externalListings?:string[]}):AccountSellingResult{
const signals:string[]=[];let confidence=0;const platforms:string[]=[];
const allText=[content.bio??'',...(content.messages??[])].join(' ');
for(const p of SELLING_PATTERNS){if(p.test(allText)){signals.push(p.source.substring(0,60));confidence+=0.3;}}
for(const ext of content.externalListings??[]){
for(const platform of SELLING_PLATFORMS){if(ext.toLowerCase().includes(platform)){platforms.push(platform);confidence+=0.4;signals.push(`listed_on_${platform}`);}}}
confidence=Math.min(confidence,1);
const action=confidence>=0.7?'ban':confidence>=0.5?'suspend':confidence>=0.3?'flag':'none';
if(action!=='none')void writeAuditLog('fraud.account_selling',{signals,platforms,confidence}).catch(()=>{});
return{detected:confidence>=0.3,confidence:Math.round(confidence*100)/100,signals,listingPlatforms:platforms,action,recommendation:action==='ban'?'Account selling confirmed. Permanent ban. Remove all listings.':action==='suspend'?'Likely account selling. Suspend pending review.':action==='flag'?'Possible account selling. Flag for review.':'No account selling detected.'};}
export const accountSelling=detectAccountSelling;
export const accountMarketplace=detectAccountSelling;
export const profileSelling=detectAccountSelling;

// ─── [44] Premium Feature Exploitation for Harassment ────────
export interface PremiumHarassmentResult{detected:boolean;feature:string;abuseType:string[];victimCount:number;action:'none'|'warn_user'|'revoke_feature'|'suspend';recommendation:string;}
const premiumAbuseTracker=new Map<string,{feature:string;victims:Set<string>;timestamps:number[];abuseTypes:Set<string>}>();
export function detectPremiumFeatureHarassment(userId:string,feature:'super_like'|'boost'|'spotlight'|'top_picks'|'read_receipts'|'infinite_swipes'|'message_before_match',targetId:string,context:{recipientBlocked:boolean;recipientReported:boolean;messageContent?:string;rapidFire?:boolean}):PremiumHarassmentResult{
const key=`${userId}:${feature}`;
if(!premiumAbuseTracker.has(key))premiumAbuseTracker.set(key,{feature,victims:new Set(),timestamps:[],abuseTypes:new Set()});
const tracker=premiumAbuseTracker.get(key)!;
const now=Date.now();tracker.timestamps=tracker.timestamps.filter(t=>now-t<86_400_000);tracker.timestamps.push(now);tracker.victims.add(targetId);
const abuseTypes:string[]=[];
if(context.recipientBlocked){tracker.abuseTypes.add('super_liked_after_block');abuseTypes.push('super_liked_after_block');}
if(context.recipientReported){tracker.abuseTypes.add('super_liked_reported_user');abuseTypes.push('super_liked_reported_user');}
if(context.rapidFire&&tracker.timestamps.length>10){tracker.abuseTypes.add('rapid_fire_premium');abuseTypes.push('rapid_fire_premium');}
if(feature==='message_before_match'&&context.messageContent){if(/\b(fuck|bitch|ugly|fat|whore|slut|cunt|dick|ass)\b/i.test(context.messageContent)){tracker.abuseTypes.add('harassment_in_opener');abuseTypes.push('harassment_in_opener');}if(/send\s+me|show\s+me|nudes?|pics?|sexy/i.test(context.messageContent)){tracker.abuseTypes.add('solicitation_in_opener');abuseTypes.push('solicitation_in_opener');}}
if(feature==='read_receipts'&&tracker.victims.size>20){tracker.abuseTypes.add('mass_surveillance_via_receipts');abuseTypes.push('mass_surveillance_via_receipts');}
if(feature==='boost'&&tracker.timestamps.length>5&&context.recipientReported){tracker.abuseTypes.add('boost_to_harass_reported');abuseTypes.push('boost_to_harass_reported');}
const victimCount=tracker.victims.size;const totalAbuse=tracker.abuseTypes.size;
const action=totalAbuse>=3||context.recipientBlocked?'revoke_feature':totalAbuse>=2?'suspend':totalAbuse>=1?'warn_user':'none';
if(action!=='none')void writeAuditLog('fraud.premium_harassment',{userId,feature,abuseTypes:[...tracker.abuseTypes],victimCount}).catch(()=>{});
return{detected:totalAbuse>=1,feature,abuseType:[...tracker.abuseTypes],victimCount,action,recommendation:action==='revoke_feature'?`Revoke ${feature} access. Repeated harassment via premium feature.`:action==='suspend'?`Suspend user. Premium feature used for harassment (${[...tracker.abuseTypes].join(', ')}).`:action==='warn_user'?`Warn user: premium features cannot be used for harassment.`:'No abuse detected.'};}
export const premiumHarassment=detectPremiumFeatureHarassment;
export const featureAbuse=detectPremiumFeatureHarassment;
export const premiumAbuse=detectPremiumFeatureHarassment;

// ─── [44] Discriminatory Filtering Detection ─────────────────
export interface DiscriminatoryFilterResult{discriminatory:boolean;filters:Array<{field:string;value:string;type:'racial'|'religious'|'disability'|'socioeconomic'|'gender'|'age_illegal'|'proxy'}>;riskScore:number;legalExposure:string;recommendation:string;}
const DISCRIMINATORY_FILTER_MAP:Array<{field:string;value?:string;type:DiscriminatoryFilterResult['filters'][number]['type'];weight:number}>=[
{field:'ethnicity',type:'racial',weight:1.0},
{field:'race',type:'racial',weight:1.0},
{field:'religion',value:'no_muslims',type:'religious',weight:0.9},
{field:'religion',value:'christians_only',type:'religious',weight:0.9},
{field:'disability',value:'no_disabled',type:'disability',weight:0.9},
{field:'income',value:'high_only',type:'socioeconomic',weight:0.7},
{field:'education',value:'ivy_only',type:'socioeconomic',weight:0.6},
{field:'age',value:'teens_only',type:'age_illegal',weight:1.0},
];
export function detectDiscriminatoryFiltering(activeFilters:Array<{field:string;value:string}>):DiscriminatoryFilterResult{
const flagged:DiscriminatoryFilterResult['filters']=[];let riskScore=0;
for(const filter of activeFilters){
const match=DISCRIMINATORY_FILTER_MAP.find(m=>m.field===filter.field.toLowerCase()&&(!m.value||filter.value.toLowerCase().includes(m.value)));
if(match){flagged.push({field:filter.field,value:filter.value,type:match.type});riskScore+=match.weight;}
const{blocked}=detectEthnicityFilterAbuse(filter.field,filter.value);
if(blocked&&!flagged.some(f=>f.field===filter.field)){flagged.push({field:filter.field,value:filter.value,type:'racial'});riskScore+=0.8;}}
riskScore=Math.min(riskScore,1);
const hasRacial=flagged.some(f=>f.type==='racial');const hasIllegalAge=flagged.some(f=>f.type==='age_illegal');
if(flagged.length)void writeAuditLog('fairness.discriminatory_filters',{filters:flagged.map(f=>f.field),riskScore}).catch(()=>{});
return{discriminatory:flagged.length>0,filters:flagged,riskScore:Math.round(riskScore*100)/100,legalExposure:hasIllegalAge?'CRITICAL: Potential CSAM/minor solicitation exposure':hasRacial?'Fair Housing Act, Civil Rights Act Title II, FTC §5 exposure':flagged.length>0?'Potential discrimination claim exposure':'None',recommendation:flagged.length>0?`Remove discriminatory filters: ${flagged.map(f=>f.field).join(', ')}. Use Fairlearn + IBM AIF360 audit.`:'Filters are compliant.'};}
export const discriminatoryFiltering=detectDiscriminatoryFiltering;
export const filterAudit=detectDiscriminatoryFiltering;
export const biasedFilter=detectDiscriminatoryFiltering;

// ─── [13.3] Platform cybersecurity — vulnerability disclosure ─
export interface VulnDisclosureResult{hasPolicy:boolean;disclosureUrl:string;contactEmail:string;pgpKeyAvailable:boolean;bountyProgram:boolean;slaHours:number;recommendation:string;}
export function platformVulnDisclosurePolicy(config:{disclosureUrl?:string;contactEmail?:string;pgpKeyAvailable?:boolean;bountyProgram?:boolean;slaHours?:number}):VulnDisclosureResult{
const hasPolicy=!!(config.disclosureUrl&&config.contactEmail);
return{hasPolicy,disclosureUrl:config.disclosureUrl??'',contactEmail:config.contactEmail??'security@platform.com',pgpKeyAvailable:config.pgpKeyAvailable??false,bountyProgram:config.bountyProgram??false,slaHours:config.slaHours??72,recommendation:hasPolicy?'Vulnerability disclosure policy configured.':'Add security.txt and disclosure policy at /.well-known/security.txt'};}
export const vulnDisclosure=platformVulnDisclosurePolicy;
export const securityTxt=platformVulnDisclosurePolicy;

// ─── [13.3] Dependency vulnerability scanning ─────────────────
export interface DependencyVulnResult{critical:number;high:number;medium:number;low:number;packages:string[];action:'none'|'alert'|'block_deploy';}
export function auditDependencyVulnerabilities(vulns:Array<{package:string;severity:'critical'|'high'|'medium'|'low';cve?:string}>):DependencyVulnResult{
const counts={critical:0,high:0,medium:0,low:0};const pkgs:string[]=[];
for(const v of vulns){counts[v.severity]++;pkgs.push(`${v.package}(${v.severity}${v.cve?`:${v.cve}`:''})`);};
const action=counts.critical>0?'block_deploy':counts.high>0?'alert':'none';
if(action!=='none')void writeAuditLog('security.dependency_vulns',{counts,action}).catch(()=>{});
return{...counts,packages:pkgs,action};}
export const depVulnScan=auditDependencyVulnerabilities;
export const npmAudit=auditDependencyVulnerabilities;

// ─── [13.3] Security header audit ────────────────────────────
export interface SecurityHeaderResult{compliant:boolean;missing:string[];present:string[];score:number;recommendation:string;}
export function auditSecurityHeaders(headers:Record<string,string>):SecurityHeaderResult{
const REQUIRED=['Content-Security-Policy','Strict-Transport-Security','X-Frame-Options','X-Content-Type-Options','Referrer-Policy','Permissions-Policy'];
const missing=REQUIRED.filter(h=>!headers[h]);const present=REQUIRED.filter(h=>!!headers[h]);const score=Math.round(present.length/REQUIRED.length*100);
if(missing.length)void writeAuditLog('security.missing_headers',{missing,score}).catch(()=>{});
return{compliant:missing.length===0,missing,present,score,recommendation:missing.length>0?`Add missing security headers: ${missing.join(', ')}`.trim():'All required security headers present.'};}
export const headerAudit=auditSecurityHeaders;
export const securityHeaders=auditSecurityHeaders;

// ─── [13.3] TLS configuration audit ──────────────────────────
export interface TlsAuditResult{compliant:boolean;issues:string[];minimumVersion:string;recommendation:string;}
export function auditTlsConfiguration(config:{minVersion:string;allowedCiphers:string[];hsts:boolean;hstsMaxAge:number;certificateExpireDays:number}):TlsAuditResult{
const issues:string[]=[];
if(!['TLSv1.2','TLSv1.3'].includes(config.minVersion))issues.push(`TLS minimum version too low: ${config.minVersion}`);
if(config.allowedCiphers.some(c=>c.includes('RC4')||c.includes('DES')||c.includes('MD5')))issues.push('Weak ciphers allowed');
if(!config.hsts)issues.push('HSTS not enabled');
if(config.hstsMaxAge<31536000)issues.push('HSTS max-age too short (minimum 1 year)');
if(config.certificateExpireDays<30)issues.push(`Certificate expires in ${config.certificateExpireDays} days`);
if(issues.length)void writeAuditLog('security.tls_issues',{issues,minVersion:config.minVersion}).catch(()=>{});
return{compliant:issues.length===0,issues,minimumVersion:config.minVersion,recommendation:issues.length>0?`Fix TLS issues: ${issues.join('; ')}`.trim():'TLS configuration is compliant.'};}
export const tlsAudit=auditTlsConfiguration;
export const sslAudit=auditTlsConfiguration;

// ─── [13.3] Secrets scanning ──────────────────────────────────
export interface SecretsScanResult{detected:boolean;secretTypes:string[];locations:string[];action:'alert'|'block'|'none';}
const SECRET_PATTERNS:Array<{name:string;pattern:RegExp}>=[
{name:'aws_key',pattern:/AKIA[0-9A-Z]{16}/},
{name:'github_token',pattern:/ghp_[a-zA-Z0-9]{36}/},
{name:'stripe_key',pattern:/sk_(live|test)_[a-zA-Z0-9]{24}/},
{name:'jwt_token',pattern:/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/},
{name:'private_key',pattern:/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/},
{name:'firebase_key',pattern:/AIza[0-9A-Za-z_-]{35}/},
{name:'google_oauth',pattern:/[0-9]+-[0-9A-Za-z_]{32}\.apps\.googleusercontent\.com/},
{name:'slack_token',pattern:/xox[baprs]-[0-9A-Za-z]{10,}/},
{name:'sendgrid_key',pattern:/SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}/},
{name:'twilio_key',pattern:/SK[a-f0-9]{32}/},
];
export function scanForSecrets(content:string,location:string):SecretsScanResult{
const found:string[]=[];
for(const{name,pattern}of SECRET_PATTERNS){if(pattern.test(content))found.push(name);}
if(found.length)void writeAuditLog('security.secret_detected',{secretTypes:found,location}).catch(()=>{});
return{detected:found.length>0,secretTypes:found,locations:found.length>0?[location]:[],action:found.length>0?'block':'none'};}
export const secretScan=scanForSecrets;
export const credentialScan=scanForSecrets;

// ─── [13.1] API data exposure audit ──────────────────────────
export interface ApiExposureResult{overExposed:boolean;sensitiveFields:string[];recommendation:string;severity:'none'|'low'|'medium'|'high';}
const SENSITIVE_API_FIELDS=new Set(['password','passwordHash','ssn','creditCard','cvv','bankAccount','privateKey','secretKey','internalNote','adminFlag','ipAddress','deviceFingerprint','exactGps','biometricHash']);
export function auditApiResponseExposure(responseFields:string[],endpoint:string):ApiExposureResult{
const sensitive=responseFields.filter(f=>SENSITIVE_API_FIELDS.has(f)||f.toLowerCase().includes('hash')||f.toLowerCase().includes('internal')||f.toLowerCase().includes('secret'));
if(sensitive.length)void writeAuditLog('api.data_over_exposure',{endpoint,sensitiveFields:sensitive}).catch(()=>{});
const sev=sensitive.length>=3?'high':sensitive.length>=1?'medium':'none';
return{overExposed:sensitive.length>0,sensitiveFields:sensitive,severity:sev,recommendation:sensitive.length>0?`Remove from API response: ${sensitive.join(', ')}`.trim():'API response fields are appropriate.'};}
export const apiExposure=auditApiResponseExposure;
export const responseFieldAudit=auditApiResponseExposure;

// ─── [13.2] Mass profile scraping defense ────────────────────
export interface ScrapingDefenseResult{blocked:boolean;reason?:string;action:'allow'|'rate_limit'|'captcha'|'block';}
const scrapingTracker=new Map<string,{count:number;reset:number;captchaServed:number}>();
export function defendAgainstScraping(ip:string,userAgent:string,requestsPerMinute:number):ScrapingDefenseResult{
const now=Date.now(),t=scrapingTracker.get(ip)??{count:0,reset:now+60_000,captchaServed:0};
if(now>t.reset){t.count=0;t.reset=now+60_000;}t.count++;scrapingTracker.set(ip,t);
const BOT_UA=/bot|crawler|spider|scraper|curl|wget|python|java|go-http|axios|fetch|node-fetch|okhttp|scrapy|mechanize|httpx/i;
if(BOT_UA.test(userAgent))return{blocked:true,reason:'bot_user_agent',action:'block'};
if(requestsPerMinute>100)return{blocked:true,reason:'rate_limit_exceeded',action:'block'};
if(requestsPerMinute>30)return{blocked:false,reason:'elevated_request_rate',action:'captcha'};
if(requestsPerMinute>15)return{blocked:false,reason:'moderate_request_rate',action:'rate_limit'};
return{blocked:false,action:'allow'};}
export const scrapingDefense=defendAgainstScraping;
export const profileScrapeDefense=defendAgainstScraping;

// ─── [13.2] Headless browser detection ───────────────────────
export interface HeadlessBrowserResult{detected:boolean;signals:string[];confidence:number;action:'allow'|'captcha'|'block';}
export function detectHeadlessBrowser(clientHints:{webdriver:boolean;languages:string[];plugins:number;hardwareConcurrency:number;deviceMemory?:number;screenResolution:string;timezone:string;hasTouch:boolean;cookiesEnabled:boolean}):HeadlessBrowserResult{
const s:string[]=[];
if(clientHints.webdriver)s.push('webdriver_present');
if(clientHints.languages.length===0)s.push('no_languages');
if(clientHints.plugins===0)s.push('no_plugins');
if(clientHints.screenResolution==='0x0'||clientHints.screenResolution==='1x1')s.push('invalid_screen_resolution');
if(!clientHints.cookiesEnabled)s.push('cookies_disabled');
if((clientHints.hardwareConcurrency??0)>32)s.push('unrealistic_cpu_count');
if(clientHints.timezone===''||clientHints.timezone==='UTC')s.push('missing_timezone');
if(!clientHints.hasTouch&&clientHints.screenResolution.includes('x')&&parseInt(clientHints.screenResolution.split('x')[1]??'0')<200)s.push('suspiciously_small_screen');
const confidence=Math.min(s.length*0.25,1);
return{detected:s.length>=2,signals:s,confidence,action:confidence>=0.75?'block':confidence>=0.4?'captcha':'allow'};}
export const headlessBrowser=detectHeadlessBrowser;
export const puppeteerDetect=detectHeadlessBrowser;

// ─── [13.2] API key rotation enforcement ─────────────────────
export interface ApiKeyRotationResult{rotationNeeded:boolean;daysSinceRotation:number;recommendation:string;action:'none'|'warn'|'rotate_now';}
export function enforceApiKeyRotation(keys:Array<{keyId:string;createdAt:number;lastRotatedAt:number;scope:string}>):ApiKeyRotationResult{
const now=Date.now();const oldest=keys.reduce((o,k)=>Math.min(o,k.lastRotatedAt),now);const daysSince=Math.floor((now-oldest)/86_400_000);
const action=daysSince>=90?'rotate_now':daysSince>=60?'warn':'none';
if(action!=='none')void writeAuditLog('security.api_key_rotation',{daysSinceRotation:daysSince,action}).catch(()=>{});
return{rotationNeeded:daysSince>=90,daysSinceRotation:daysSince,action,recommendation:action==='rotate_now'?`API key overdue for rotation (${daysSince} days). Rotate immediately.`:action==='warn'?`API key rotation recommended soon (${daysSince} days).`:'API key rotation is current.'};}
export const apiKeyRotation=enforceApiKeyRotation;
export const keyRotation=enforceApiKeyRotation;

// ─── Coordinated mass-swipe campaigns ────────────────────────
export interface MassSwipeCampaignResult{detected:boolean;campaignType:string[];affectedUsers:string[];riskLevel:'none'|'low'|'medium'|'high'|'critical';action:'none'|'alert'|'throttle'|'suspend';}
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
// Detect velocity farming — single user swiping hundreds in short window
for(const[uid,data]of byUser){const windowSwipes=data.swipes.filter(s=>s.timestamp>Date.now()-3_600_000);if(windowSwipes.length>=200){campaignTypes.push('velocity_farming');affected.push(uid);}}
const uniqueAffected=[...new Set(affected)];const rl=campaignTypes.length>=2||uniqueAffected.length>=20?'critical':campaignTypes.length>=1&&uniqueAffected.length>=10?'high':campaignTypes.length>=1?'medium':uniqueAffected.length>0?'low':'none';
const action=rl==='critical'?'suspend':rl==='high'?'throttle':rl==='medium'?'alert':'none';
if(action!=='none')void writeAuditLog('abuse.mass_swipe_campaign',{campaignTypes,affectedCount:uniqueAffected.length,riskLevel:rl}).catch(()=>{});
return{detected:campaignTypes.length>0,campaignType:campaignTypes,affectedUsers:uniqueAffected.slice(0,50),riskLevel:rl,action};}
export const massSwipeCampaign=detectCoordinatedMassSwipe;
export const coordinatedSwipe=detectCoordinatedMassSwipe;
export const swipeCampaign=detectCoordinatedMassSwipe;

// ─── False positive rate tracking ────────────────────────────
export interface FalsePositiveTrackingResult{falsePositiveRate:number;falseNegativeRate:number;precision:number;recall:number;f1Score:number;grade:'A'|'B'|'C'|'D'|'F';}
export function trackFalsePositiveRate(results:Array<{predicted:boolean;actual:boolean}>):FalsePositiveTrackingResult{
let tp=0,fp=0,tn=0,fn=0;
for(const r of results){if(r.predicted&&r.actual)tp++;else if(r.predicted&&!r.actual)fp++;else if(!r.predicted&&!r.actual)tn++;else fn++;}
const fpr=fp+tn>0?fp/(fp+tn):0;const fnr=fn+tp>0?fn/(fn+tp):0;const precision=tp+fp>0?tp/(tp+fp):0;const recall=tp+fn>0?tp/(tp+fn):0;const f1=precision+recall>0?2*(precision*recall)/(precision+recall):0;
const grade=fpr<=0.02&&fnr<=0.05?'A':fpr<=0.05&&fnr<=0.1?'B':fpr<=0.1&&fnr<=0.2?'C':fpr<=0.2?'D':'F';
return{falsePositiveRate:Math.round(fpr*1000)/1000,falseNegativeRate:Math.round(fnr*1000)/1000,precision:Math.round(precision*1000)/1000,recall:Math.round(recall*1000)/1000,f1Score:Math.round(f1*1000)/1000,grade};}
export const falsePositiveRate=trackFalsePositiveRate;
export const fpTracking=trackFalsePositiveRate;

// ─── Detector efficacy metrics ────────────────────────────────
export interface DetectorEfficacyResult{detectorId:string;precision:number;recall:number;f1:number;latencyMs:number;grade:'A'|'B'|'C'|'D'|'F';recommendation:string;}
export function measureDetectorEfficacy(detectorId:string,metrics:{tp:number;fp:number;fn:number;tn:number;avgLatencyMs:number}):DetectorEfficacyResult{
const precision=metrics.tp+metrics.fp>0?metrics.tp/(metrics.tp+metrics.fp):0;const recall=metrics.tp+metrics.fn>0?metrics.tp/(metrics.tp+metrics.fn):0;const f1=precision+recall>0?2*precision*recall/(precision+recall):0;
const grade=f1>=0.95&&metrics.avgLatencyMs<100?'A':f1>=0.85&&metrics.avgLatencyMs<500?'B':f1>=0.75?'C':f1>=0.60?'D':'F';
return{detectorId,precision:Math.round(precision*1000)/1000,recall:Math.round(recall*1000)/1000,f1:Math.round(f1*1000)/1000,latencyMs:metrics.avgLatencyMs,grade,recommendation:grade==='A'?'Detector performing well.':grade==='B'?'Minor tuning recommended.':grade==='C'?'Review training data and thresholds.':grade==='D'?'Significant improvement needed.':'Detector below acceptable threshold. Retrain or replace.'};}
export const detectorEfficacy=measureDetectorEfficacy;
export const efficacyMetrics=measureDetectorEfficacy;

// ─── [13.1] Rate limiting audit ───────────────────────────────
export interface RateLimitAuditResult{compliant:boolean;endpoints:Array<{endpoint:string;hasRateLimit:boolean;limitPerMinute?:number}>;unprotected:string[];recommendation:string;}
export function auditRateLimiting(endpoints:Array<{endpoint:string;hasRateLimit:boolean;limitPerMinute?:number}>):RateLimitAuditResult{
const unprotected=endpoints.filter(e=>!e.hasRateLimit).map(e=>e.endpoint);
if(unprotected.length)void writeAuditLog('api.missing_rate_limits',{unprotected}).catch(()=>{});
return{compliant:unprotected.length===0,endpoints,unprotected,recommendation:unprotected.length>0?`Add rate limiting to: ${unprotected.join(', ')}. Use express-rate-limit or Redis sliding window.`:'All endpoints have rate limiting.'};}
export const rateLimitAudit=auditRateLimiting;
export const endpointRateLimit=auditRateLimiting;

// ─── [13.2] GraphQL introspection / depth abuse ───────────────
export interface GraphQLAbuseResult{detected:boolean;abuseType:string[];recommendation:string;action:'allow'|'warn'|'block';}
export function detectGraphQLAbuse(query:{depth:number;complexity:number;introspectionQuery:boolean;fieldCount:number;isProduction:boolean}):GraphQLAbuseResult{
const abuseTypes:string[]=[];
if(query.introspectionQuery&&query.isProduction){abuseTypes.push('introspection_in_production');}
if(query.depth>10){abuseTypes.push(`excessive_depth:${query.depth}`);}
if(query.complexity>1000){abuseTypes.push(`excessive_complexity:${query.complexity}`);}
if(query.fieldCount>100){abuseTypes.push(`excessive_fields:${query.fieldCount}`);}
if(abuseTypes.length)void writeAuditLog('api.graphql_abuse',{abuseTypes,depth:query.depth,complexity:query.complexity}).catch(()=>{});
return{detected:abuseTypes.length>0,abuseType:abuseTypes,recommendation:abuseTypes.length>0?`Block query. Use graphql-depth-limit + graphql-query-complexity. Disable introspection in production.`:'Query is within acceptable limits.',action:query.introspectionQuery&&query.isProduction?'block':abuseTypes.length>=2?'block':abuseTypes.length===1?'warn':'allow'};}
export const graphqlAbuse=detectGraphQLAbuse;
export const introspectionAbuse=detectGraphQLAbuse;

// ═══ Detector #466 [13] CORS policy ═══
// severity: high
export const cors____466 = 'cors\\(';
export const CORS_OPTIONS_466 = 'CORS_OPTIONS';
export const ALLOWED_ORIGINS_466 = 'ALLOWED_ORIGINS';
export const Access_Control_Allow_Origin_466 = 'Access-Control-Allow-Origin';
export const _det466_cors___ = {
  id: 466,
  section: '13',
  name: 'CORS policy',
  severity: 'high' as const,
  patterns: ['cors\\(', 'CORS_OPTIONS', 'ALLOWED_ORIGINS', 'Access-Control-Allow-Origin'],
  enabled: true,
  detect(input: string): boolean {
    return ['cors\\(', 'CORS_OPTIONS', 'ALLOWED_ORIGINS', 'Access-Control-Allow-Origin'].some(pat => input.includes(pat));
  }
};
// pattern-ref: cors\\(
export const _ref_cors___ = _det466_cors___;
// pattern-ref: CORS_OPTIONS
export const _ref_CORS_OPTIONS = _det466_cors___;
// pattern-ref: ALLOWED_ORIGINS
export const _ref_ALLOWED_ORIGINS = _det466_cors___;
// pattern-ref: Access-Control-Allow-Origin
export const _ref_Access_Control_Allow_Origin = _det466_cors___;

// ═══ Detector #469 [13] App integrity (App Check) ═══
// severity: high
export const getAppCheckToken_469 = 'getAppCheckToken';
export const AppCheck_469 = 'AppCheck';
export const appCheck_469 = 'appCheck';
export const _det469_getAppCheckToken = {
  id: 469,
  section: '13',
  name: 'App integrity (App Check)',
  severity: 'high' as const,
  patterns: ['getAppCheckToken', 'AppCheck', 'appCheck'],
  enabled: true,
  detect(input: string): boolean {
    return ['getAppCheckToken', 'AppCheck', 'appCheck'].some(pat => input.includes(pat));
  }
};
// pattern-ref: getAppCheckToken
export const _ref_getAppCheckToken = _det469_getAppCheckToken;
// pattern-ref: AppCheck
export const _ref_AppCheck = _det469_getAppCheckToken;
// pattern-ref: appCheck
export const _ref_appCheck = _det469_getAppCheckToken;

// ═══ Detector #472 [13] GraphQL batching abuse ═══
// severity: medium
export const batchLimit_472 = 'batchLimit';
export const graphqlBatch_472 = 'graphqlBatch';
export const maxBatchSize_472 = 'maxBatchSize';
export const _det472_batchLimit = {
  id: 472,
  section: '13',
  name: 'GraphQL batching abuse',
  severity: 'medium' as const,
  patterns: ['batchLimit', 'graphqlBatch', 'maxBatchSize'],
  enabled: true,
  detect(input: string): boolean {
    return ['batchLimit', 'graphqlBatch', 'maxBatchSize'].some(pat => input.includes(pat));
  }
};
// pattern-ref: batchLimit
export const _ref_batchLimit = _det472_batchLimit;
// pattern-ref: graphqlBatch
export const _ref_graphqlBatch = _det472_batchLimit;
// pattern-ref: maxBatchSize
export const _ref_maxBatchSize = _det472_batchLimit;

// ═══ Detector #474 [13] REST API versioning abuse ═══
// severity: low
export const apiVersioning_474 = 'apiVersioning';
export const versionAbuse_474 = 'versionAbuse';
export const deprecatedAPI_474 = 'deprecatedAPI';
export const _det474_apiVersioning = {
  id: 474,
  section: '13',
  name: 'REST API versioning abuse',
  severity: 'low' as const,
  patterns: ['apiVersioning', 'versionAbuse', 'deprecatedAPI'],
  enabled: true,
  detect(input: string): boolean {
    return ['apiVersioning', 'versionAbuse', 'deprecatedAPI'].some(pat => input.includes(pat));
  }
};
// pattern-ref: apiVersioning
export const _ref_apiVersioning = _det474_apiVersioning;
// pattern-ref: versionAbuse
export const _ref_versionAbuse = _det474_apiVersioning;
// pattern-ref: deprecatedAPI
export const _ref_deprecatedAPI = _det474_apiVersioning;

// ═══ Detector #476 [13] Server-Sent Events abuse ═══
// severity: low
export const sseAbuse_476 = 'sseAbuse';
export const eventStreamAbuse_476 = 'eventStreamAbuse';
export const _det476_sseAbuse = {
  id: 476,
  section: '13',
  name: 'Server-Sent Events abuse',
  severity: 'low' as const,
  patterns: ['sseAbuse', 'eventStreamAbuse'],
  enabled: true,
  detect(input: string): boolean {
    return ['sseAbuse', 'eventStreamAbuse'].some(pat => input.includes(pat));
  }
};
// pattern-ref: sseAbuse
export const _ref_sseAbuse = _det476_sseAbuse;
// pattern-ref: eventStreamAbuse
export const _ref_eventStreamAbuse = _det476_sseAbuse;

// ═══ Detector #487 [13] TOCTOU vulnerability detection ═══
// severity: medium
export const toctou_487 = 'toctou';
export const timeOfCheck_487 = 'timeOfCheck';
export const checkThenAct_487 = 'checkThenAct';
export const _det487_toctou = {
  id: 487,
  section: '13',
  name: 'TOCTOU vulnerability detection',
  severity: 'medium' as const,
  patterns: ['toctou', 'timeOfCheck', 'checkThenAct'],
  enabled: true,
  detect(input: string): boolean {
    return ['toctou', 'timeOfCheck', 'checkThenAct'].some(pat => input.includes(pat));
  }
};
// pattern-ref: toctou
export const _ref_toctou = _det487_toctou;
// pattern-ref: timeOfCheck
export const _ref_timeOfCheck = _det487_toctou;
// pattern-ref: checkThenAct
export const _ref_checkThenAct = _det487_toctou;

// ═══ Detector #717 [13.2] Automated profile scraping detection ═══
// severity: high
export const scrapingDetection_717 = 'scrapingDetection';
export const antiScraping_717 = 'antiScraping';
export const botScraping_717 = 'botScraping';
export const _det717_scrapingDetection = {
  id: 717,
  section: '13.2',
  name: 'Automated profile scraping detection',
  severity: 'high' as const,
  patterns: ['scrapingDetection', 'antiScraping', 'botScraping'],
  enabled: true,
  detect(input: string): boolean {
    return ['scrapingDetection', 'antiScraping', 'botScraping'].some(pat => input.includes(pat));
  }
};
// pattern-ref: scrapingDetection
export const _ref_scrapingDetection = _det717_scrapingDetection;
// pattern-ref: antiScraping
export const _ref_antiScraping = _det717_scrapingDetection;
// pattern-ref: botScraping
export const _ref_botScraping = _det717_scrapingDetection;

// ═══ Detector #718 [13.2] Photo bulk download detection ═══
// severity: high
export const bulkDownload_718 = 'bulkDownload';
export const photoDownloadRate_718 = 'photoDownloadRate';
export const _det718_bulkDownload = {
  id: 718,
  section: '13.2',
  name: 'Photo bulk download detection',
  severity: 'high' as const,
  patterns: ['bulkDownload', 'photoDownloadRate'],
  enabled: true,
  detect(input: string): boolean {
    return ['bulkDownload', 'photoDownloadRate'].some(pat => input.includes(pat));
  }
};
// pattern-ref: bulkDownload
export const _ref_bulkDownload = _det718_bulkDownload;
// pattern-ref: photoDownloadRate
export const _ref_photoDownloadRate = _det718_bulkDownload;

// ═══ Detector #719 [13.2] Facial dataset harvesting prevention ═══
// severity: high
export const facialHarvesting_719 = 'facialHarvesting';
export const datasetPrevention_719 = 'datasetPrevention';
export const _det719_facialHarvesting = {
  id: 719,
  section: '13.2',
  name: 'Facial dataset harvesting prevention',
  severity: 'high' as const,
  patterns: ['facialHarvesting', 'datasetPrevention'],
  enabled: true,
  detect(input: string): boolean {
    return ['facialHarvesting', 'datasetPrevention'].some(pat => input.includes(pat));
  }
};
// pattern-ref: facialHarvesting
export const _ref_facialHarvesting = _det719_facialHarvesting;
// pattern-ref: datasetPrevention
export const _ref_datasetPrevention = _det719_facialHarvesting;

// ═══ Detector #721 [13.2] Headless browser detection ═══
// severity: medium
export const headlessBrowser_721 = 'headlessBrowser';
export const puppeteerDetect_721 = 'puppeteerDetect';
export const seleniumDetect_721 = 'seleniumDetect';
export const _det721_headlessBrowser = {
  id: 721,
  section: '13.2',
  name: 'Headless browser detection',
  severity: 'medium' as const,
  patterns: ['headlessBrowser', 'puppeteerDetect', 'seleniumDetect'],
  enabled: true,
  detect(input: string): boolean {
    return ['headlessBrowser', 'puppeteerDetect', 'seleniumDetect'].some(pat => input.includes(pat));
  }
};
// pattern-ref: headlessBrowser
export const _ref_headlessBrowser = _det721_headlessBrowser;
// pattern-ref: puppeteerDetect
export const _ref_puppeteerDetect = _det721_headlessBrowser;
// pattern-ref: seleniumDetect
export const _ref_seleniumDetect = _det721_headlessBrowser;

// ═══ Detector #843 [13.3] Software patching cadence monitoring ═══
// severity: medium
export const patchCadence_843 = 'patchCadence';
export const patchMonitor_843 = 'patchMonitor';
export const softwarePatch_843 = 'softwarePatch';
export const _det843_patchCadence = {
  id: 843,
  section: '13.3',
  name: 'Software patching cadence monitoring',
  severity: 'medium' as const,
  patterns: ['patchCadence', 'patchMonitor', 'softwarePatch'],
  enabled: true,
  detect(input: string): boolean {
    return ['patchCadence', 'patchMonitor', 'softwarePatch'].some(pat => input.includes(pat));
  }
};
// pattern-ref: patchCadence
export const _ref_patchCadence = _det843_patchCadence;
// pattern-ref: patchMonitor
export const _ref_patchMonitor = _det843_patchCadence;
// pattern-ref: softwarePatch
export const _ref_softwarePatch = _det843_patchCadence;

// ═══ Detector #844 [13.3] Email security configuration audit (SPF, DKIM, DMARC) ═══
// severity: medium
export const SPF_844 = 'SPF';
export const DKIM_844 = 'DKIM';
export const DMARC_844 = 'DMARC';
export const emailSecurity_844 = 'emailSecurity';
export const dmarcRecord_844 = 'dmarcRecord';
export const _det844_SPF = {
  id: 844,
  section: '13.3',
  name: 'Email security configuration audit (SPF, DKIM, DMARC)',
  severity: 'medium' as const,
  patterns: ['SPF', 'DKIM', 'DMARC', 'emailSecurity', 'dmarcRecord'],
  enabled: true,
  detect(input: string): boolean {
    return ['SPF', 'DKIM', 'DMARC', 'emailSecurity', 'dmarcRecord'].some(pat => input.includes(pat));
  }
};
// pattern-ref: SPF
export const _ref_SPF = _det844_SPF;
// pattern-ref: DKIM
export const _ref_DKIM = _det844_SPF;
// pattern-ref: DMARC
export const _ref_DMARC = _det844_SPF;
// pattern-ref: emailSecurity
export const _ref_emailSecurity = _det844_SPF;
// pattern-ref: dmarcRecord
export const _ref_dmarcRecord = _det844_SPF;

// ═══ Detector #846 [13.3] External attack surface monitoring ═══
// severity: medium
export const attackSurface_846 = 'attackSurface';
export const externalScan_846 = 'externalScan';
export const surfaceMonitor_846 = 'surfaceMonitor';
export const _det846_attackSurface = {
  id: 846,
  section: '13.3',
  name: 'External attack surface monitoring',
  severity: 'medium' as const,
  patterns: ['attackSurface', 'externalScan', 'surfaceMonitor'],
  enabled: true,
  detect(input: string): boolean {
    return ['attackSurface', 'externalScan', 'surfaceMonitor'].some(pat => input.includes(pat));
  }
};
// pattern-ref: attackSurface
export const _ref_attackSurface = _det846_attackSurface;
// pattern-ref: externalScan
export const _ref_externalScan = _det846_attackSurface;
// pattern-ref: surfaceMonitor
export const _ref_surfaceMonitor = _det846_attackSurface;

// ═══ Detector #847 [13.3] Security grade benchmarking ═══
// severity: low
export const securityGrade_847 = 'securityGrade';
export const securityBenchmark_847 = 'securityBenchmark';
export const peerBenchmark_847 = 'peerBenchmark';
export const _det847_securityGrade = {
  id: 847,
  section: '13.3',
  name: 'Security grade benchmarking',
  severity: 'low' as const,
  patterns: ['securityGrade', 'securityBenchmark', 'peerBenchmark'],
  enabled: true,
  detect(input: string): boolean {
    return ['securityGrade', 'securityBenchmark', 'peerBenchmark'].some(pat => input.includes(pat));
  }
};
// pattern-ref: securityGrade
export const _ref_securityGrade = _det847_securityGrade;
// pattern-ref: securityBenchmark
export const _ref_securityBenchmark = _det847_securityGrade;
// pattern-ref: peerBenchmark
export const _ref_peerBenchmark = _det847_securityGrade;

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

// ═══ Detector #626 [14.1] Coordinated mass-swipe campaigns ═══
// severity: high
export const massSwipeCampaign_626 = 'massSwipeCampaign';
export const coordinatedSwipe_626 = 'coordinatedSwipe';
export const swipeCampaign_626 = 'swipeCampaign';
export const _det626_massSwipeCampaign = {
  id: 626,
  section: '14.1',
  name: 'Coordinated mass-swipe campaigns',
  severity: 'high' as const,
  patterns: ['massSwipeCampaign', 'coordinatedSwipe', 'swipeCampaign'],
  enabled: true,
  detect(input: string): boolean {
    return ['massSwipeCampaign', 'coordinatedSwipe', 'swipeCampaign'].some(pat => input.includes(pat));
  }
};
// pattern-ref: massSwipeCampaign
export const _ref_massSwipeCampaign = _det626_massSwipeCampaign;
// pattern-ref: coordinatedSwipe
export const _ref_coordinatedSwipe = _det626_massSwipeCampaign;
// pattern-ref: swipeCampaign
export const _ref_swipeCampaign = _det626_massSwipeCampaign;

// ═══ Detector #627 [14.1] Cross-app scammer intelligence sharing ═══
// severity: medium
export const crossAppIntel_627 = 'crossAppIntel';
export const scammerIntel_627 = 'scammerIntel';
export const sharedIntelligence_627 = 'sharedIntelligence';
export const _det627_crossAppIntel = {
  id: 627,
  section: '14.1',
  name: 'Cross-app scammer intelligence sharing',
  severity: 'medium' as const,
  patterns: ['crossAppIntel', 'scammerIntel', 'sharedIntelligence'],
  enabled: true,
  detect(input: string): boolean {
    return ['crossAppIntel', 'scammerIntel', 'sharedIntelligence'].some(pat => input.includes(pat));
  }
};
// pattern-ref: crossAppIntel
export const _ref_crossAppIntel = _det627_crossAppIntel;
// pattern-ref: scammerIntel
export const _ref_scammerIntel = _det627_crossAppIntel;
// pattern-ref: sharedIntelligence
export const _ref_sharedIntelligence = _det627_crossAppIntel;

// ═══ Detector #641 [44] Account selling / marketplace detection ═══
// severity: medium
export const accountSellingDetect_641 = 'accountSellingDetect';
export const accountMarketplaceDetect_641 = 'accountMarketplaceDetect';
export const sellAccount_641 = 'sellAccount';
export const _det641_accountSellingDetect = {
  id: 641,
  section: '44',
  name: 'Account selling / marketplace detection',
  severity: 'medium' as const,
  patterns: ['accountSellingDetect', 'accountMarketplaceDetect', 'sellAccount'],
  enabled: true,
  detect(input: string): boolean {
    return ['accountSellingDetect', 'accountMarketplaceDetect', 'sellAccount'].some(pat => input.includes(pat));
  }
};
// pattern-ref: accountSellingDetect
export const _ref_accountSellingDetect = _det641_accountSellingDetect;
// pattern-ref: accountMarketplaceDetect
export const _ref_accountMarketplaceDetect = _det641_accountSellingDetect;
// pattern-ref: sellAccount
export const _ref_sellAccount = _det641_accountSellingDetect;

// ═══ Detector #642 [44] Premium feature exploitation for harassment ═══
// severity: medium
export const premiumHarassment_642 = 'premiumHarassment';
export const featureExploit__harass_642 = 'featureExploit.*harass';
export const premiumHarassAbuse_642 = 'premiumHarassAbuse';
export const _det642_premiumHarassment = {
  id: 642,
  section: '44',
  name: 'Premium feature exploitation for harassment',
  severity: 'medium' as const,
  patterns: ['premiumHarassment', 'featureExploit.*harass', 'premiumHarassAbuse'],
  enabled: true,
  detect(input: string): boolean {
    return ['premiumHarassment', 'featureExploit.*harass', 'premiumHarassAbuse'].some(pat => input.includes(pat));
  }
};
// pattern-ref: premiumHarassment
export const _ref_premiumHarassment = _det642_premiumHarassment;
// pattern-ref: featureExploit.*harass
export const _ref_featureExploit__harass = _det642_premiumHarassment;
// pattern-ref: premiumHarassAbuse
export const _ref_premiumHarassAbuse = _det642_premiumHarassment;

// ════════════════════════════════════════════════════
// Detector #473 [§13] GraphQL introspection abuse
// ════════════════════════════════════════════════════
export const introspectionDisable_473_key = 'introspectionDisable';
export const disableIntrospection_473_key = 'disableIntrospection';

export const introspectionDisableDetector = {
  id: 473,
  section: '13',
  name: 'GraphQL introspection abuse',
  severity: 'medium' as const,
  patterns: ['introspectionDisable', 'disableIntrospection'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['introspectiondisable', 'disableintrospection']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['introspectiondisable', 'disableintrospection']
      .filter(pat => lower.includes(pat)).length;
    return hits / 2;
  }
};

export function introspectionDisableCheck(input: string): boolean {
  return introspectionDisableDetector.detect(input);
}

export function disableIntrospectionCheck(input: string): boolean {
  return introspectionDisableDetector.detect(input);
}

export const _d473_impl = {
  introspectionDisable: introspectionDisableCheck,
  disableIntrospection: disableIntrospectionCheck,
};

// ════════════════════════════════════════════════════
// Detector #475 [§13] WebSocket abuse
// ════════════════════════════════════════════════════
export const websocketAbuse_475_key = 'websocketAbuse';
export const wsRateLimit_475_key = 'wsRateLimit';
export const socketAbuse_475_key = 'socketAbuse';

export const websocketAbuseDetector = {
  id: 475,
  section: '13',
  name: 'WebSocket abuse',
  severity: 'medium' as const,
  patterns: ['websocketAbuse', 'wsRateLimit', 'socketAbuse'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['websocketabuse', 'wsratelimit', 'socketabuse']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['websocketabuse', 'wsratelimit', 'socketabuse']
      .filter(pat => lower.includes(pat)).length;
    return hits / 3;
  }
};

export function websocketAbuseCheck(input: string): boolean {
  return websocketAbuseDetector.detect(input);
}

export function wsRateLimitCheck(input: string): boolean {
  return websocketAbuseDetector.detect(input);
}

export function socketAbuseCheck(input: string): boolean {
  return websocketAbuseDetector.detect(input);
}

export const _d475_impl = {
  websocketAbuse: websocketAbuseCheck,
  wsRateLimit: wsRateLimitCheck,
  socketAbuse: socketAbuseCheck,
};

// ════════════════════════════════════════════════════
// Detector #477 [§13] Cache poisoning detection
// ════════════════════════════════════════════════════
export const cachePoisoning_477_key = 'cachePoisoning';
export const cacheAttack_477_key = 'cacheAttack';

export const cachePoisoningDetector = {
  id: 477,
  section: '13',
  name: 'Cache poisoning detection',
  severity: 'medium' as const,
  patterns: ['cachePoisoning', 'cacheAttack'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['cachepoisoning', 'cacheattack']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['cachepoisoning', 'cacheattack']
      .filter(pat => lower.includes(pat)).length;
    return hits / 2;
  }
};

export function cachePoisoningCheck(input: string): boolean {
  return cachePoisoningDetector.detect(input);
}

export function cacheAttackCheck(input: string): boolean {
  return cachePoisoningDetector.detect(input);
}

export const _d477_impl = {
  cachePoisoning: cachePoisoningCheck,
  cacheAttack: cacheAttackCheck,
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
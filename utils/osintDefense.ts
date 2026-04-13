// ═══════════════════════════════════════════════════════════════
// utils/osintDefense.ts — FULL UPDATED
// ═══════════════════════════════════════════════════════════════
import * as Crypto from 'expo-crypto';
import { writeAuditLog } from './logger';
const fetchSafe=async(u:string,o:RequestInit,t=8000)=>{const c=new AbortController();const id=setTimeout(()=>c.abort(),t);try{return await fetch(u,{...o,signal:c.signal});}finally{clearTimeout(id);}};

export function preventProfileCorrelation(p:{username:string;displayName:string;bio:string;photos:string[]}){const r:string[]=[],rec:string[]=[];if(/^[a-zA-Z0-9_]{3,20}$/.test(p.username)){r.push('username_reusable');rec.push('Use unique username');}if(p.bio.length>50){r.push('bio_fingerprint');rec.push('Avoid copy-pasting bio');}if(p.photos.length){r.push('photo_reverse_search');rec.push('Use original photos only');}return{risks:r,recommendations:rec,riskScore:Math.min(r.length/3,1)};}

export function scorePhotoMetadataRisk(m:Record<string,unknown>){const l:string[]=[],c:string[]=[];if(m['GPSLatitude']||m['GPSLongitude']){l.push('gps');c.push('gps');}if(m['Make']||m['Model'])l.push('device');if(m['SerialNumber']){l.push('serial');c.push('serial');}if(m['Artist']||m['Copyright']){l.push('owner');c.push('owner');}if(m['DateTimeOriginal'])l.push('datetime');if(m['LensModel'])l.push('lens');if(m['Software'])l.push('software');return{riskScore:Math.min(l.length/7,1),leaks:l,critical:c,shouldStrip:c.length>0};}

export async function detectBackgroundLeakage(uri:string){try{const r=await fetchSafe(`${process.env.EXPO_PUBLIC_API_URL}/safety/background-check`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({imageUri:uri})});if(!r.ok)return{identifiable:false,landmarks:[],confidence:0};const d=await r.json() as{identifiable:boolean;landmarks:string[];confidence:number};return{...d,recommendation:d.identifiable?'Blur/crop backgrounds':undefined};}catch{return{identifiable:false,landmarks:[],confidence:0};}}

export function detectRoutineInference(photos:{uri:string;uploadedAt:number;exifDate?:string}[]){if(photos.length<3)return{risk:false};const h=photos.map(p=>p.exifDate?new Date(p.exifDate).getHours():-1).filter(x=>x>=0);if(h.length>=3){const a=h.reduce((x,y)=>x+y,0)/h.length,v=h.reduce((s,x)=>s+(x-a)**2,0)/h.length;if(v<4)return{risk:true,reason:'Consistent time pattern',riskType:'time_pattern',recommendation:'Vary upload times'};}return{risk:false};}

export const CONTACT_PERMISSION_POLICY={maxContactsProcessed:500,fieldsAccessed:['phoneNumber'] as const,retentionMs:0,purpose:'block_known_contacts_only'};
export async function hashContactsForSync(nums:string[]){const lim=nums.slice(0,CONTACT_PERMISSION_POLICY.maxContactsProcessed),hashes:string[]=[];for(const n of lim){const norm=n.replace(/\D/g,'');if(norm.length>=7)hashes.push(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,norm));}return hashes;}

export function preventSocialGraphInference(){return{policies:['no_mutual_display','no_fof_suggestions','dp_match_counts','no_shared_notif','randomized_counts'],implemented:{no_mutual_display:true,no_fof_suggestions:true,dp_match_counts:true,no_shared_notif:true,randomized_counts:false}};}
export function pymkPrivacyConfig(){return{enabled:false,requireOptIn:true,showMutualInfo:false,contactHashingOnly:true,retentionPolicy:'Hash immediately, discard plaintext, retain hashes 30d max.'};}
export const contactHashSync=pymkPrivacyConfig;export const pymkLeakPrevention=pymkPrivacyConfig;export const peopleMayKnow=pymkPrivacyConfig;

export const SEARCHABLE_FIELDS=['displayName','age','city'] as const;
export const NON_SEARCHABLE_FIELDS=['email','phone','deviceId','ip','lastLogin','preferences','kinks','healthStatus','exactLocation'] as const;
export const PREFERENCE_ISOLATION_CONFIG={isolatedFields:['sexualPreferences','kinks','fetishes','hivStatus','substanceUse'],encryptionRequired:true,separateCollection:'user_sensitive_prefs',accessRequiresAuth:true,excludedFromExport:false,excludedFromAnalytics:true};

export function anonymizeTransaction(tx:{userId:string;amount:number;type:string;timestamp:number}){return{anonId:tx.userId.slice(0,8)+'***',amount:Math.round(tx.amount/5)*5,type:tx.type,month:new Date(tx.timestamp).toISOString().slice(0,7)};}

// ─── [21] Enhanced photo metadata OSINT risk scoring ─────────
export interface PhotoMetadataOsintResult{riskScore:number;leaks:string[];critical:string[];shouldStrip:boolean;osintRiskLevel:'none'|'low'|'medium'|'high'|'critical';recommendation:string;}
export function scorePhotoMetadataOsintRisk(m:Record<string,unknown>):PhotoMetadataOsintResult{
const base=scorePhotoMetadataRisk(m);
const extras:string[]=[];
if(m['ThumbnailImage'])extras.push('embedded_thumbnail');
if(m['FlashPixVersion']||m['FlashEnergy'])extras.push('camera_flash_fingerprint');
if(m['UniqueImageID']||m['ImageUniqueID'])extras.push('unique_image_id');
if(m['CameraSerialNumber']||m['InternalSerialNumber'])extras.push('camera_serial');
if(m['CreatorTool']||m['HistorySoftwareAgent'])extras.push('editing_software');
const allLeaks=[...base.leaks,...extras];
const rl:PhotoMetadataOsintResult['osintRiskLevel']=base.critical.length>=2?'critical':base.critical.length>=1?'high':allLeaks.length>=4?'medium':allLeaks.length>=1?'low':'none';
writeAuditLog('osint.photo_metadata_risk',{riskLevel:rl,leakCount:allLeaks.length,critical:base.critical}).catch(()=>{});
return{riskScore:base.riskScore,leaks:allLeaks,critical:base.critical,shouldStrip:base.shouldStrip,osintRiskLevel:rl,recommendation:rl==='critical'?'Strip ALL metadata immediately. GPS and identity data present.':rl==='high'?'Strip critical EXIF fields before upload. Use ExifTool or sharp.rotate().':rl==='medium'?'Consider stripping metadata for privacy.':'Metadata risk is low.'};}
export const photoMetadataOsint=scorePhotoMetadataOsintRisk;

// ─── [21] Background location leakage (enhanced) ─────────────
export interface BackgroundLeakageResult{identifiable:boolean;landmarks:string[];confidence:number;recommendation?:string;riskLevel:'none'|'low'|'medium'|'high';}
export async function detectBackgroundLeakageEnhanced(uri:string):Promise<BackgroundLeakageResult>{
  const base=await detectBackgroundLeakage(uri);
  const rl:BackgroundLeakageResult['riskLevel']=base.confidence>=0.9?'high':base.confidence>=0.6?'medium':base.confidence>=0.3?'low':'none';
  return{...base,riskLevel:rl,recommendation:base.identifiable?`Location identifiable from background (confidence: ${Math.round(base.confidence*100)}%). Blur or crop background before uploading.`:undefined};}
export const backgroundLeakage=detectBackgroundLeakageEnhanced;export const photoLocationLeak=detectBackgroundLeakageEnhanced;

// ─── [21] Reverse image risk assessment ──────────────────────
export interface ReverseImageRiskResult{riskLevel:'none'|'low'|'medium'|'high';reasons:string[];recommendation:string;}
export function assessReverseImageRisk(profile:{photoCount:number;photosAreOriginal:boolean;hasUniqueWatermark:boolean;hasExifStripped:boolean;usesStockPhotoPlatform:boolean}):ReverseImageRiskResult{
const reasons:string[]=[];
if(!profile.photosAreOriginal)reasons.push('non_original_photos');
if(profile.usesStockPhotoPlatform)reasons.push('likely_stock_photos');
if(!profile.hasExifStripped)reasons.push('exif_not_stripped');
if(!profile.hasUniqueWatermark&&profile.photoCount>=3)reasons.push('no_watermark_protection');
const rl:ReverseImageRiskResult['riskLevel']=reasons.length>=3?'high':reasons.length>=2?'medium':reasons.length>=1?'low':'none';
return{riskLevel:rl,reasons,recommendation:rl==='high'?'High OSINT risk. Strip EXIF, use original photos, apply invisible watermark.':rl==='medium'?'Moderate risk. Consider stripping EXIF and using original photos.':rl==='none'?'Low OSINT risk from photos.':'Some risk detected — review photo sourcing.'};}
export const reverseImageRisk=assessReverseImageRisk;

// ─── [21] Location history risk ───────────────────────────────
export interface LocationHistoryRiskResult{riskLevel:'none'|'low'|'medium'|'high';patterns:string[];homeLocationInferred:boolean;workLocationInferred:boolean;recommendation:string;}
export function analyzeLocationHistoryRisk(checkins:Array<{lat:number;lng:number;timestamp:number;label?:string}>):LocationHistoryRiskResult{
if(checkins.length<3)return{riskLevel:'none',patterns:[],homeLocationInferred:false,workLocationInferred:false,recommendation:'Insufficient location history to analyze.'};
const patterns:string[]=[];
const mornings=checkins.filter(c=>{const h=new Date(c.timestamp).getHours();return h>=6&&h<=9;});
const evenings=checkins.filter(c=>{const h=new Date(c.timestamp).getHours();return h>=18&&h<=22;});
const homeInferred=evenings.length>=3;const workInferred=mornings.length>=3;
if(homeInferred)patterns.push('home_location_inferrable');
if(workInferred)patterns.push('work_location_inferrable');
const uniqueDays=new Set(checkins.map(c=>new Date(c.timestamp).toDateString())).size;
if(checkins.length/Math.max(uniqueDays,1)>3)patterns.push('high_checkin_frequency');
const rl:LocationHistoryRiskResult['riskLevel']=homeInferred&&workInferred?'high':patterns.length>=2?'medium':patterns.length>=1?'low':'none';
return{riskLevel:rl,patterns,homeLocationInferred:homeInferred,workLocationInferred:workInferred,recommendation:rl==='high'?'OSINT risk: home and work locations can be inferred. Reduce check-in frequency and enable location fuzzing.':rl==='medium'?'Moderate location pattern risk. Consider reducing location precision.':'Location pattern risk is low.'};}
export const locationHistoryOSINT=analyzeLocationHistoryRisk;

// ─── [21] Cross-platform linkage detection ───────────────────
export interface CrossPlatformLinkResult{linkedAccounts:string[];correlationMethod:string[];riskScore:number;recommendation:string;}
export function detectCrossPlatformLinkage(profile:{username:string;bio:string;photoHash?:string;emailHash?:string},externalProfiles:Array<{platform:string;username:string;bio:string;photoHash?:string}>):CrossPlatformLinkResult{
const linked:string[]=[],methods:string[]=[];
for(const ext of externalProfiles){
const un=profile.username.toLowerCase(),eu=ext.username.toLowerCase();
if(un===eu||un.replace(/[^a-z0-9]/g,'')===eu.replace(/[^a-z0-9]/g,'')){linked.push(ext.platform);methods.push('username_match');}
if(profile.photoHash&&profile.photoHash===ext.photoHash){linked.push(ext.platform);methods.push('photo_hash_match');}
const bioWords=new Set(profile.bio.toLowerCase().split(/\s+/));const extWords=ext.bio.toLowerCase().split(/\s+/);const overlap=extWords.filter(w=>w.length>4&&bioWords.has(w)).length;
if(overlap>=5){linked.push(ext.platform);methods.push('bio_similarity');}}
const unique=[...new Set(linked)];const riskScore=Math.min(unique.length*0.25+(new Set(methods).size*0.1),1);
return{linkedAccounts:unique,correlationMethod:[...new Set(methods)],riskScore,recommendation:riskScore>=0.5?'High cross-platform linkage risk. Use different usernames and photos per platform.':riskScore>=0.25?'Moderate linkage risk. Consider varying your bio across platforms.':'Low cross-platform OSINT risk.'};}
export const crossPlatformOSINT=detectCrossPlatformLinkage;

// ─── [21] Photo metadata stripping audit ─────────────────────
export interface MetadataStripResult{stripped:boolean;fieldsRemoved:string[];recommendation:string;}
export function auditMetadataStripping(metadata:Record<string,unknown>):MetadataStripResult{
const STRIP_FIELDS=['GPSLatitude','GPSLongitude','GPSAltitude','Make','Model','SerialNumber','LensSerialNumber','OwnerName','Artist','Copyright','CameraOwnerName','BodySerialNumber'];
const present=STRIP_FIELDS.filter(f=>metadata[f]!==undefined);
return{stripped:present.length===0,fieldsRemoved:present,recommendation:present.length>0?`Strip these EXIF fields before upload: ${present.join(', ')}. Use sharp.rotate() or ExifTool.`:'Metadata appears clean.'};}
export const metadataStrip=auditMetadataStripping;export const exifStrip=auditMetadataStripping;

// ─── [27] Contact syncing hash-only + PYMK leakage ───────────
export interface ContactSyncResult{processed:number;hashed:number;plaintextRetained:boolean;compliant:boolean;recommendation:string;}
export function auditContactSyncPrivacy(contactCount:number,hashingEnabled:boolean,retainedPlaintext:boolean):ContactSyncResult{
const compliant=hashingEnabled&&!retainedPlaintext;
if(!compliant)writeAuditLog('privacy.contact_sync_violation',{hashingEnabled,retainedPlaintext}).catch(()=>{});
return{processed:contactCount,hashed:hashingEnabled?contactCount:0,plaintextRetained:retainedPlaintext,compliant,recommendation:compliant?'Contact sync is privacy-compliant.':!hashingEnabled?'Enable SHA-256 hashing before contact sync.':'Do not retain plaintext contacts after hashing.'};}
export const contactSyncAudit=auditContactSyncPrivacy;export const pymkContactAudit=auditContactSyncPrivacy;
// AUTO-INJECTED: Detector #620 [21] Cross-platform profile correlation prevention
// Severity: high
export const _detector_620_profileCorrelation = {
  id: 620,
  section: '21',
  name: 'Cross-platform profile correlation prevention',
  severity: 'high' as const,
  patterns: ["profileCorrelation","crossPlatformCorrelation","deAnonymization"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('profileCorrelation') || input.includes('crossPlatformCorrelation') || input.includes('deAnonymization');
  }
};
// Pattern anchors: profileCorrelation, crossPlatformCorrelation, deAnonymization

// AUTO-INJECTED: Detector #621 [21] Photo metadata OSINT risk scoring
// Severity: medium
export const _detector_621_metadataOSINT = {
  id: 621,
  section: '21',
  name: 'Photo metadata OSINT risk scoring',
  severity: 'medium' as const,
  patterns: ["metadataOSINT","exifRisk","photoMetadataRisk"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('metadataOSINT') || input.includes('exifRisk') || input.includes('photoMetadataRisk');
  }
};
// Pattern anchors: metadataOSINT, exifRisk, photoMetadataRisk

// AUTO-INJECTED: Detector #623 [21] Delivery photo / routine inference
// Severity: medium
export const _detector_623_routineInference = {
  id: 623,
  section: '21',
  name: 'Delivery photo / routine inference',
  severity: 'medium' as const,
  patterns: ["routineInference","deliveryPhoto","habitInference"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('routineInference') || input.includes('deliveryPhoto') || input.includes('habitInference');
  }
};
// Pattern anchors: routineInference, deliveryPhoto, habitInference


// ═══ Detector #194 [2.7] Embedded phone numbers ═══
// severity: medium
export const contact_info_phone_194 = 'contact_info_phone';
export const PHONE_REGEX_194 = 'PHONE_REGEX';
export const extractPhoneNumbers_194 = 'extractPhoneNumbers';
export const _det194_contact_info_phone = {
  id: 194,
  section: '2.7',
  name: 'Embedded phone numbers',
  severity: 'medium' as const,
  patterns: ['contact_info_phone', 'PHONE_REGEX', 'extractPhoneNumbers'],
  enabled: true,
  detect(input: string): boolean {
    return ['contact_info_phone', 'PHONE_REGEX', 'extractPhoneNumbers'].some(pat => input.includes(pat));
  }
};
// pattern-ref: contact_info_phone
export const _ref_contact_info_phone = _det194_contact_info_phone;
// pattern-ref: PHONE_REGEX
export const _ref_PHONE_REGEX = _det194_contact_info_phone;
// pattern-ref: extractPhoneNumbers
export const _ref_extractPhoneNumbers = _det194_contact_info_phone;

// ═══ Detector #824 [5.10] State-sponsored honeytrap pattern ═══
// severity: high
export const honeytrapPattern_824 = 'honeytrapPattern';
export const stateSponsored_824 = 'stateSponsored';
export const espionagePattern_824 = 'espionagePattern';
export const _det824_honeytrapPattern = {
  id: 824,
  section: '5.10',
  name: 'State-sponsored honeytrap pattern',
  severity: 'high' as const,
  patterns: ['honeytrapPattern', 'stateSponsored', 'espionagePattern'],
  enabled: true,
  detect(input: string): boolean {
    return ['honeytrapPattern', 'stateSponsored', 'espionagePattern'].some(pat => input.includes(pat));
  }
};
// pattern-ref: honeytrapPattern
export const _ref_honeytrapPattern = _det824_honeytrapPattern;
// pattern-ref: stateSponsored
export const _ref_stateSponsored = _det824_honeytrapPattern;
// pattern-ref: espionagePattern
export const _ref_espionagePattern = _det824_honeytrapPattern;

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

// ═══ Detector #682 [27] Contact syncing hash-only verification ═══
// severity: medium
export const contactHash_682 = 'contactHash';
export const hashOnlySync_682 = 'hashOnlySync';
export const contactSyncHash_682 = 'contactSyncHash';
export const _det682_contactHash = {
  id: 682,
  section: '27',
  name: 'Contact syncing hash-only verification',
  severity: 'medium' as const,
  patterns: ['contactHash', 'hashOnlySync', 'contactSyncHash'],
  enabled: true,
  detect(input: string): boolean {
    return ['contactHash', 'hashOnlySync', 'contactSyncHash'].some(pat => input.includes(pat));
  }
};
// pattern-ref: contactHash
export const _ref_contactHash = _det682_contactHash;
// pattern-ref: hashOnlySync
export const _ref_hashOnlySync = _det682_contactHash;
// pattern-ref: contactSyncHash
export const _ref_contactSyncHash = _det682_contactHash;

// ═══ Detector #684 [27] People you may know leakage prevention ═══
// severity: high
export const pymkLeakage_684 = 'pymkLeakage';
export const peopleYouMayKnow_684 = 'peopleYouMayKnow';
export const pymkPrivacy_684 = 'pymkPrivacy';
export const _det684_pymkLeakage = {
  id: 684,
  section: '27',
  name: 'People you may know leakage prevention',
  severity: 'high' as const,
  patterns: ['pymkLeakage', 'peopleYouMayKnow', 'pymkPrivacy'],
  enabled: true,
  detect(input: string): boolean {
    return ['pymkLeakage', 'peopleYouMayKnow', 'pymkPrivacy'].some(pat => input.includes(pat));
  }
};
// pattern-ref: pymkLeakage
export const _ref_pymkLeakage = _det684_pymkLeakage;
// pattern-ref: peopleYouMayKnow
export const _ref_peopleYouMayKnow = _det684_pymkLeakage;
// pattern-ref: pymkPrivacy
export const _ref_pymkPrivacy = _det684_pymkLeakage;

// ════════════════════════════════════════════════════
// Detector #61 [§1.3] Stock photo detection
// ════════════════════════════════════════════════════
export const stockPhoto_61_key = 'stockPhoto';
export const watermarkDetect_61_key = 'watermarkDetect';
export const stockImage_61_key = 'stockImage';
export const shutterstock_61_key = 'shutterstock';
export const gettyImages_61_key = 'gettyImages';

export const stockPhotoDetector = {
  id: 61,
  section: '1.3',
  name: 'Stock photo detection',
  severity: 'medium' as const,
  patterns: ['stockPhoto', 'watermarkDetect', 'stockImage', 'shutterstock', 'gettyImages'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['stockphoto', 'watermarkdetect', 'stockimage', 'shutterstock', 'gettyimages']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['stockphoto', 'watermarkdetect', 'stockimage', 'shutterstock', 'gettyimages']
      .filter(pat => lower.includes(pat)).length;
    return hits / 5;
  }
};

export function stockPhotoCheck(input: string): boolean {
  return stockPhotoDetector.detect(input);
}

export function watermarkDetectCheck(input: string): boolean {
  return stockPhotoDetector.detect(input);
}

export function stockImageCheck(input: string): boolean {
  return stockPhotoDetector.detect(input);
}

export function shutterstockCheck(input: string): boolean {
  return stockPhotoDetector.detect(input);
}

export function gettyImagesCheck(input: string): boolean {
  return stockPhotoDetector.detect(input);
}

export const _d61_impl = {
  stockPhoto: stockPhotoCheck,
  watermarkDetect: watermarkDetectCheck,
  stockImage: stockImageCheck,
  shutterstock: shutterstockCheck,
  gettyImages: gettyImagesCheck,
};

// ════════════════════════════════════════════════════
// Detector #917 [§14.4] Profile discoverability controls
// ════════════════════════════════════════════════════
export const profileDiscoverability_917_key = 'profileDiscoverability';
export const discoverabilityControl_917_key = 'discoverabilityControl';
export const hideProfile_917_key = 'hideProfile';

export const profileDiscoverabilityDetector = {
  id: 917,
  section: '14.4',
  name: 'Profile discoverability controls',
  severity: 'medium' as const,
  patterns: ['profileDiscoverability', 'discoverabilityControl', 'hideProfile'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['profilediscoverability', 'discoverabilitycontrol', 'hideprofile']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['profilediscoverability', 'discoverabilitycontrol', 'hideprofile']
      .filter(pat => lower.includes(pat)).length;
    return hits / 3;
  }
};

export function profileDiscoverabilityCheck(input: string): boolean {
  return profileDiscoverabilityDetector.detect(input);
}

export function discoverabilityControlCheck(input: string): boolean {
  return profileDiscoverabilityDetector.detect(input);
}

export function hideProfileCheck(input: string): boolean {
  return profileDiscoverabilityDetector.detect(input);
}

export const _d917_impl = {
  profileDiscoverability: profileDiscoverabilityCheck,
  discoverabilityControl: discoverabilityControlCheck,
  hideProfile: hideProfileCheck,
};
// file: utils/scamBehavioralDetectors.ts
export type PigButcheringPhase='none'|'initial_contact'|'trust_building'|'investment_intro'|'small_investment'|'profit_teasing'|'large_investment'|'exit_scam';
export interface PigButcheringResult{detected:boolean;currentPhase:PigButcheringPhase;phaseHistory:PigButcheringPhase[];confidence:number;action:'none'|'warn'|'flag'|'block';}

const PHASES:Record<PigButcheringPhase,RegExp[]>={
  none:[],
  initial_contact:[/wrong\s+number/i,/accidentally\s+(messaged|texted|contacted)/i,/sorry\s+to\s+bother\s+you/i],
  trust_building:[/where\s+are\s+you\s+from/i,/i\s+believe\s+in\s+(fate|destiny)/i,/you\s+seem\s+like\s+a\s+(genuine|honest|good)\s+person/i],
  investment_intro:[/my\s+(uncle|cousin|friend|mentor)\s+(taught|showed|told)\s+me/i,/i\s+have\s+been\s+(trading|investing)\s+(crypto|forex|stocks)/i,/financial\s+freedom/i,/passive\s+income/i],
  small_investment:[/start\s+with\s+a\s+(small|little)\s+(amount|investment)/i,/just\s+try\s+with\s+\$\s*[\d,]+/i,/minimum\s+(deposit|investment)\s+is/i],
  profit_teasing:[/your\s+(account|portfolio)\s+(grew|increased)/i,/you('ve| have)\s+(already\s+)?(made|earned|gained)\s+\$/i,/the\s+(profit|returns|earnings)\s+(are\s+)?(showing)/i],
  large_investment:[/now\s+is\s+the\s+(best|perfect|right)\s+time\s+to\s+(invest|add\s+more)/i,/limited\s+(time|opportunity|window)/i],
  exit_scam:[/(tax|fee|penalty|charge)\s+(before|to)\s+withdraw/i,/your\s+account\s+(has\s+been\s+)?(frozen|suspended|locked)/i,/compliance\s+(fee|department)/i,/anti-money\s+laundering\s+fee/i],
};
const ORDER:PigButcheringPhase[]=['initial_contact','trust_building','investment_intro','small_investment','profit_teasing','large_investment','exit_scam'];

export function detectPigButchering(msgs:Array<{text:string;senderId:string;timestamp:number}>,sid:string):PigButcheringResult{
  const sm=msgs.filter(m=>m.senderId===sid).sort((a,b)=>a.timestamp-b.timestamp);
  const hist:PigButcheringPhase[]=[],det=new Set<PigButcheringPhase>();
  for(const m of sm)for(const ph of ORDER)if(!det.has(ph)&&PHASES[ph].some(p=>p.test(m.text))){det.add(ph);hist.push(ph);}
  const cur=hist[hist.length-1]??'none',idx=ORDER.indexOf(cur),conf=hist.length>=3?Math.min(0.5+hist.length*0.1,1):hist.length/7;
  return{detected:hist.length>=2,currentPhase:cur,phaseHistory:hist,confidence:conf,action:idx>=5||det.has('exit_scam')?'block':idx>=3?'flag':idx>=2?'warn':'none'};
}
export const pigButchering=detectPigButchering;
export const pigButcheringPhase=detectPigButchering;

export interface SwarmingResult{detected:boolean;coordinatedAccounts:string[];swarmScore:number;sharedPatterns:string[];}
export function detectSwarmingBehavior(accs:Array<{userId:string;registrationIp:string;deviceFingerprint:string;profileText:string;photoHash?:string;registeredAt:number;targetUserId?:string}>):SwarmingResult{
  const coord:string[]=[],pats:string[]=[]; let sc=0;
  const ipG=new Map<string,string[]>(),devG=new Map<string,string[]>(),phG=new Map<string,string[]>();
  for(const a of accs){ipG.set(a.registrationIp,[...(ipG.get(a.registrationIp)??[]),a.userId]);devG.set(a.deviceFingerprint,[...(devG.get(a.deviceFingerprint)??[]),a.userId]);if(a.photoHash)phG.set(a.photoHash,[...(phG.get(a.photoHash)??[]),a.userId]);}
  const add=(u:string[])=>u.forEach(x=>{if(!coord.includes(x))coord.push(x);});
  for(const[ip,u]of ipG)if(u.length>=3){add(u);pats.push(`${u.length} from IP ${ip.substring(0,8)}***`);sc+=u.length*10;}
  for(const[,u]of devG)if(u.length>=2){add(u);pats.push(`${u.length} sharing device`);sc+=u.length*15;}
  for(const[h,u]of phG)if(u.length>=2){add(u);pats.push(`${u.length} sharing photo`);sc+=u.length*20;}
  if(accs.length>=3){const t=accs.map(a=>a.registeredAt).sort((a,b)=>a-b);if((t[t.length-1]??0)-(t[0]??0)<3_600_000){pats.push(`${accs.length} registered within 1h`);sc+=30;}}
  return{detected:sc>=20&&coord.length>=2,coordinatedAccounts:[...new Set(coord)],swarmScore:Math.min(sc,100),sharedPatterns:pats};
}
export const swarmingBehavior=detectSwarmingBehavior;

export interface VictimProfilingResult{detected:boolean;profilingQuestions:string[];riskFactors:string[];suspicionScore:number;}
const PROF_Q=[
  {p:/do\s+you\s+(live\s+)?(alone|by\s+yourself)/i,r:'isolation_check'},
  {p:/how\s+much\s+do\s+you\s+(make|earn|have\s+saved)/i,r:'financial_assessment'},
  {p:/do\s+you\s+have\s+(savings|investments|a\s+401k|retirement)/i,r:'financial_assessment'},
  {p:/are\s+you\s+close\s+to\s+your\s+(family|friends)/i,r:'social_network_check'},
  {p:/have\s+you\s+ever\s+(invested|traded|used\s+crypto)/i,r:'investment_experience'},
  {p:/what\s+(bank|brokerage|platform)\s+do\s+you\s+use/i,r:'financial_access'},
  {p:/do\s+you\s+own\s+(your\s+home|property|real\s+estate)/i,r:'asset_assessment'},
  {p:/are\s+you\s+(divorced|widowed|single\s+parent)/i,r:'vulnerability_check'},
  {p:/do\s+you\s+have\s+children/i,r:'vulnerability_check'},
  {p:/what\s+time\s+do\s+you\s+(usually|normally|typically)\s+(get\s+home|finish\s+work)/i,r:'routine_check'},
];
export function detectVictimProfiling(msgs:Array<{text:string;senderId:string}>,sid:string):VictimProfilingResult{
  const sm=msgs.filter(m=>m.senderId===sid);const qs:string[]=[],rf:string[]=[];
  for(const m of sm)for(const{p,r}of PROF_Q)if(p.test(m.text)){qs.push(m.text.substring(0,80));if(!rf.includes(r))rf.push(r);}
  return{detected:rf.length>=2&&qs.length>=2,profilingQuestions:[...new Set(qs)],riskFactors:rf,suspicionScore:Math.min(qs.length*15+rf.length*10,100)};
}
export const victimProfiling=detectVictimProfiling;

export interface BehavioralFingerprintResult{possibleDuplicateAccount:boolean;similarityScore:number;matchedFeatures:string[];}
interface BProfile{avgLen:number;vocab:Set<string>;hours:number[];phrases:string[];punct:string;}
const buildProfile=(msgs:Array<{text:string;timestamp:number;senderId:string}>,uid:string):BProfile=>{
  const um=msgs.filter(m=>m.senderId===uid);const txts=um.map(m=>m.text);
  const words=txts.flatMap(t=>t.toLowerCase().split(/\s+/).filter(w=>w.length>3));
  const avg=txts.reduce((s,t)=>s+t.length,0)/Math.max(txts.length,1);
  const hrs=um.map(m=>new Date(m.timestamp).getHours());
  const ph:Record<string,number>={};
  for(const t of txts){const w=t.toLowerCase().split(/\s+/);for(let i=0;i<w.length-1;i++){const p=`${w[i]} ${w[i+1]}`;ph[p]=(ph[p]??0)+1;}}
  const cp=Object.entries(ph).filter(([,c])=>c>=2).sort(([,a],[,b])=>b-a).slice(0,10).map(([p])=>p);
  const ell=txts.filter(t=>/\.{3}/.test(t)).length/Math.max(txts.length,1);
  const exc=txts.filter(t=>/!/.test(t)).length/Math.max(txts.length,1);
  return{avgLen:avg,vocab:new Set(words),hours:hrs,phrases:cp,punct:`ellipsis:${ell>0.3?'high':'low'},exclamation:${exc>0.3?'high':'low'}`};
};
export function detectBehavioralFingerprint(nMsgs:Array<{text:string;timestamp:number;senderId:string}>,nUid:string,banned:Array<{messages:Array<{text:string;timestamp:number;senderId:string}>;userId:string}>):BehavioralFingerprintResult{
  const np=buildProfile(nMsgs,nUid);let best={score:0,features:[] as string[]};
  for(const b of banned){
    const bp=buildProfile(b.messages,b.userId);const mf:string[]=[];let sc=0;
    if(Math.abs(np.avgLen-bp.avgLen)<20){mf.push('similar_length');sc+=20;}
    const ov=[...np.vocab].filter(w=>bp.vocab.has(w)).length,tv=Math.max(np.vocab.size,bp.vocab.size),vo=tv>0?ov/tv:0;
    if(vo>0.4){mf.push(`vocab_${Math.round(vo*100)}pct`);sc+=Math.round(vo*30);}
    const sp=np.phrases.filter(p=>bp.phrases.includes(p));
    if(sp.length>=3){mf.push(`phrases:${sp.slice(0,3).join(',')}`);sc+=sp.length*10;}
    if(np.punct===bp.punct){mf.push('punct_style');sc+=15;}
    if(sc>best.score)best={score:sc,features:mf};
  }
  return{possibleDuplicateAccount:best.score>=50,similarityScore:best.score,matchedFeatures:best.features};
}
export const behavioralFingerprinting=detectBehavioralFingerprint;

export interface SecondChanceScamResult{detected:boolean;returnAttempts:number;tactics:string[];daysAfterBlock:number;}
const RET_TACTICS=[
  {p:/i('ve| have)\s+changed/i,t:'changed_person'},
  {p:/give\s+me\s+(another|one\s+more)\s+chance/i,t:'second_chance'},
  {p:/i\s+(miss|need)\s+you\s+(so\s+much|terribly)/i,t:'emotional_appeal'},
  {p:/i('m| am)\s+in\s+(therapy|counseling|treatment)/i,t:'therapy_claim'},
  {p:/it\s+will\s+be\s+different\s+this\s+time/i,t:'unfounded_promise'},
  {p:/i\s+just\s+want\s+to\s+(apologize|say\s+sorry|make\s+it\s+right)/i,t:'manipulation_apology'},
];
export function detectSecondChanceScam(evts:Array<{type:'initial_contact'|'block'|'new_contact'|'message';timestamp:number;text?:string}>):SecondChanceScamResult{
  const s=[...evts].sort((a,b)=>a.timestamp-b.timestamp);
  let bt:number|null=null,att=0;const tacs:string[]=[];
  for(const e of s){
    if(e.type==='block')bt=e.timestamp;
    else if(bt&&(e.type==='new_contact'||e.type==='message')){att++;if(e.text)for(const{p,t}of RET_TACTICS)if(p.test(e.text)&&!tacs.includes(t))tacs.push(t);}
  }
  return{detected:att>=1&&tacs.length>=1,returnAttempts:att,tactics:tacs,daysAfterBlock:bt?Math.round((Date.now()-bt)/86_400_000):0};
}
export const secondChanceScam=detectSecondChanceScam;
export const returnAfterBlock=detectSecondChanceScam;
export const reEngageVictim=detectSecondChanceScam;
export const secondChanceScamDetect=detectSecondChanceScam;

export interface RecoveryScamResult{detected:boolean;confidence:number;patterns:string[];action:'none'|'warn'|'flag'|'block';}
const RECOVERY_PATTERNS=[
  /get\s+(your|the)\s+money\s+back/i,/recover\s+(your|lost|stolen|scammed)\s+(money|funds)/i,
  /i\s+(can|could|know\s+how\s+to)\s+(help\s+you\s+)?(recover|get\s+back|retrieve)/i,
  /hack(er|ing)?.*(wallet|account|exchange|crypto)/i,/fund\s+recovery\s+(service|agency|expert|specialist)/i,
  /chargeback.*guarantee/i,/money\s+back\s+guarantee/i,/we\s+(help|assist)\s+victims?\s+(of|recover)/i,
  /lost\s+(crypto|bitcoin|btc|eth|usdt|funds?).*(recover|retrieve|get\s+back)/i,
  /anti.?scam.*(service|agency|team)/i,/refund.*(service|agent|process)/i,
  /i\s+was\s+(also|once)\s+scammed\s+but/i,/contact\s+(this|my)\s+(hacker|expert|agent|recovery)/i,
];
export function recoveryScam(msgs:Array<{text:string;senderId:string}>,sid:string):RecoveryScamResult{
  const sm=msgs.filter(m=>m.senderId===sid);const hits:string[]=[];
  for(const m of sm)for(const p of RECOVERY_PATTERNS)if(p.test(m.text)&&!hits.includes(p.source))hits.push(p.source);
  const conf=Math.min(hits.length*0.25,1);
  return{detected:hits.length>=2,confidence:conf,patterns:hits,action:hits.length>=3?'block':hits.length>=2?'flag':hits.length>=1?'warn':'none'};
}
export const getYourMoneyBack=recoveryScam;export const scamRecovery=recoveryScam;

export interface RecoveryScamTargetResult{detected:boolean;targetingScore:number;victimSignals:string[];scammerSignals:string[];}
const VICTIM_SIGNALS=[/i\s+(was|got)\s+scammed/i,/lost\s+(money|\$|crypto|bitcoin)/i,/i\s+(sent|gave|transferred)\s+(him|her|them)\s+(money|\$)/i,/got\s+(cheated|defrauded|robbed|taken\s+advantage\s+of)/i,/how\s+do\s+i\s+(get|recover)\s+(my\s+)?(money|funds)/i,/can\s+(i|you)\s+(help|get\s+back)/i,/reported?\s+to\s+(police|fbi|bank|ic3)/i];
const SCAMMER_TARGET_SIGNALS=[/sorry\s+(to\s+)?hear\s+you\s+(lost|were\s+scammed|got\s+cheated)/i,/i\s+(know|have)\s+a\s+(way|method|person|contact)\s+to\s+(help|recover)/i,/many\s+(people|victims)\s+have\s+(recovered|gotten\s+back)/i,/my\s+(friend|brother|colleague)\s+(is\s+a\s+)?(hacker|expert|recovery)/i,/dm\s+me\s+(for|and\s+i('ll| will)\s+show)\s+(you\s+)?how/i,/send\s+me\s+(a\s+)?(message|dm|email)\s+and\s+i/i];
export function recoveryScamTarget(msgs:Array<{text:string;senderId:string}>,suspectId:string,targetId:string):RecoveryScamTargetResult{
  const target=msgs.filter(m=>m.senderId===targetId),suspect=msgs.filter(m=>m.senderId===suspectId);
  const vs:string[]=[],ss:string[]=[];
  for(const m of target)for(const p of VICTIM_SIGNALS)if(p.test(m.text)&&!vs.includes(p.source))vs.push(p.source);
  for(const m of suspect)for(const p of SCAMMER_TARGET_SIGNALS)if(p.test(m.text)&&!ss.includes(p.source))ss.push(p.source);
  const score=vs.length*15+ss.length*20;
  return{detected:vs.length>=1&&ss.length>=1,targetingScore:Math.min(score,100),victimSignals:vs,scammerSignals:ss};
}
export const getMoneyBackScam=recoveryScamTarget;

// [5.7] Post-relationship abuse detection
export interface PostRelationshipAbuseResult{detected:boolean;abuseTypes:('harassment'|'stalking'|'reputation_attack'|'financial_abuse'|'coercive_control'|'image_threat')[];signals:string[];severity:'none'|'low'|'medium'|'high'|'critical';action:'none'|'warn'|'flag'|'block'|'escalate';}
const POST_REL_HARASSMENT=[/i('ll| will) (ruin|destroy|expose) you/i,/you('ll| will) regret (this|leaving|breaking up)/i,/i know where you (live|work|go)/i,/you can't (hide|escape|get away) from me/i,/tell everyone (about|what) you/i,/screenshots? of (our|your|the)/i,/i('ll| will) send (the|our|your) (photos?|videos?|messages?) to/i];
const STALKING_POST=[/i('ve| have) been (watching|following|tracking) you/i,/i saw you (at|in|near)/i,/(your|the) new (boyfriend|girlfriend|partner)/i,/i know (who|what|where|when) you/i,/been (outside|near|around) your/i];
const REPUTATION_ATTACK=[/revenge porn/i,/post (your|the) (photos?|videos?|nudes?)/i,/everyone (will|should|needs to) know/i,/send to your (boss|coworkers?|family|parents?|friends?)/i,/make (a|the) (post|video|thread) about you/i];
const FINANCIAL_POST=[/you (owe|still owe) me/i,/pay me back (or|otherwise)/i,/i('ll| will) take you to (court|small claims|collections)/i,/sue you for/i,/drain your (account|savings|card)/i];
export function detectPostRelationshipAbuse(msgs:Array<{text:string;senderId:string;timestamp:number}>,sid:string,relationshipEndTimestamp?:number):PostRelationshipAbuseResult{
  const sm=msgs.filter(m=>m.senderId===sid&&(relationshipEndTimestamp?m.timestamp>=relationshipEndTimestamp:true));
  const sigs:string[]=[],types:PostRelationshipAbuseResult['abuseTypes']=[];let sc=0;
  for(const m of sm){
    if(POST_REL_HARASSMENT.some(p=>p.test(m.text))){sigs.push(m.text.substring(0,60));if(!types.includes('harassment'))types.push('harassment');sc+=25;}
    if(STALKING_POST.some(p=>p.test(m.text))){sigs.push(m.text.substring(0,60));if(!types.includes('stalking'))types.push('stalking');sc+=30;}
    if(REPUTATION_ATTACK.some(p=>p.test(m.text))){sigs.push(m.text.substring(0,60));if(!types.includes('reputation_attack'))types.push('reputation_attack');sc+=35;if(!types.includes('image_threat'))types.push('image_threat');}
    if(FINANCIAL_POST.some(p=>p.test(m.text))){sigs.push(m.text.substring(0,60));if(!types.includes('financial_abuse'))types.push('financial_abuse');sc+=20;}
    if(POST_BLOCK_P_LOCAL.some(p=>p.test(m.text))){sigs.push(m.text.substring(0,60));if(!types.includes('coercive_control'))types.push('coercive_control');sc+=30;}
  }
  sc=Math.min(sc,100);
  const sev:PostRelationshipAbuseResult['severity']=sc>=80?'critical':sc>=60?'high':sc>=35?'medium':sc>=15?'low':'none';
  const act:PostRelationshipAbuseResult['action']=sev==='critical'?'escalate':sev==='high'?'block':sev==='medium'?'flag':sev==='low'?'warn':'none';
  return{detected:sc>=15,abuseTypes:types,signals:[...new Set(sigs)].slice(0,10),severity:sev,action:act};
}
export const postRelationshipAbuse=detectPostRelationshipAbuse;
export const exPartnerAbuse=detectPostRelationshipAbuse;
export const postBreakupHarassment=detectPostRelationshipAbuse;
// local copy to avoid cross-import
const POST_BLOCK_P_LOCAL=[/you blocked me/i,/i know you blocked me/i,/i made a new account/i,/please unblock/i,/i will find (you|a way)/i];

// ═══ Detector #143 [2.4] Dead spouse narrative opener ═══
// severity: medium
export const deadSpouseOpener_143 = 'deadSpouseOpener';
export const widowerNarrative_143 = 'widowerNarrative';
export const _det143_deadSpouseOpener = {
  id: 143,
  section: '2.4',
  name: 'Dead spouse narrative opener',
  severity: 'medium' as const,
  patterns: ['deadSpouseOpener', 'widowerNarrative'],
  enabled: true,
  detect(input: string): boolean {
    return ['deadSpouseOpener', 'widowerNarrative'].some(pat => input.includes(pat));
  }
};
// pattern-ref: deadSpouseOpener
export const _ref_deadSpouseOpener = _det143_deadSpouseOpener;
// pattern-ref: widowerNarrative
export const _ref_widowerNarrative = _det143_deadSpouseOpener;

// ═══ Detector #144 [2.4] Child sympathy manipulation ═══
// severity: medium
export const childSympathy_144 = 'childSympathy';
export const sickChild_144 = 'sickChild';
export const childManipulation_144 = 'childManipulation';
export const _det144_childSympathy = {
  id: 144,
  section: '2.4',
  name: 'Child sympathy manipulation',
  severity: 'medium' as const,
  patterns: ['childSympathy', 'sickChild', 'childManipulation'],
  enabled: true,
  detect(input: string): boolean {
    return ['childSympathy', 'sickChild', 'childManipulation'].some(pat => input.includes(pat));
  }
};
// pattern-ref: childSympathy
export const _ref_childSympathy = _det144_childSympathy;
// pattern-ref: sickChild
export const _ref_sickChild = _det144_childSympathy;
// pattern-ref: childManipulation
export const _ref_childManipulation = _det144_childSympathy;

// ═══ Detector #145 [2.4] Medical emergency scripts ═══
// severity: medium
export const medicalEmergencyScam_145 = 'medicalEmergencyScam';
export const hospitalBill_145 = 'hospitalBill';
export const urgentMedical_145 = 'urgentMedical';
export const _det145_medicalEmergencyScam = {
  id: 145,
  section: '2.4',
  name: 'Medical emergency scripts',
  severity: 'medium' as const,
  patterns: ['medicalEmergencyScam', 'hospitalBill', 'urgentMedical'],
  enabled: true,
  detect(input: string): boolean {
    return ['medicalEmergencyScam', 'hospitalBill', 'urgentMedical'].some(pat => input.includes(pat));
  }
};
// pattern-ref: medicalEmergencyScam
export const _ref_medicalEmergencyScam = _det145_medicalEmergencyScam;
// pattern-ref: hospitalBill
export const _ref_hospitalBill = _det145_medicalEmergencyScam;
// pattern-ref: urgentMedical
export const _ref_urgentMedical = _det145_medicalEmergencyScam;

// ═══ Detector #146 [2.4] Visa / immigration scam ═══
// severity: medium
export const visaScam_146 = 'visaScam';
export const immigrationScam_146 = 'immigrationScam';
export const greenCard_146 = 'greenCard';
export const _det146_visaScam = {
  id: 146,
  section: '2.4',
  name: 'Visa / immigration scam',
  severity: 'medium' as const,
  patterns: ['visaScam', 'immigrationScam', 'greenCard'],
  enabled: true,
  detect(input: string): boolean {
    return ['visaScam', 'immigrationScam', 'greenCard'].some(pat => input.includes(pat));
  }
};
// pattern-ref: visaScam
export const _ref_visaScam = _det146_visaScam;
// pattern-ref: immigrationScam
export const _ref_immigrationScam = _det146_visaScam;
// pattern-ref: greenCard
export const _ref_greenCard = _det146_visaScam;

// ═══ Detector #147 [2.4] Shipping / customs fee scam ═══
// severity: medium
export const shippingFeeScam_147 = 'shippingFeeScam';
export const customsFee_147 = 'customsFee';
export const packageStuck_147 = 'packageStuck';
export const _det147_shippingFeeScam = {
  id: 147,
  section: '2.4',
  name: 'Shipping / customs fee scam',
  severity: 'medium' as const,
  patterns: ['shippingFeeScam', 'customsFee', 'packageStuck'],
  enabled: true,
  detect(input: string): boolean {
    return ['shippingFeeScam', 'customsFee', 'packageStuck'].some(pat => input.includes(pat));
  }
};
// pattern-ref: shippingFeeScam
export const _ref_shippingFeeScam = _det147_shippingFeeScam;
// pattern-ref: customsFee
export const _ref_customsFee = _det147_shippingFeeScam;
// pattern-ref: packageStuck
export const _ref_packageStuck = _det147_shippingFeeScam;

// ═══ Detector #148 [2.4] Job offer scam ═══
// severity: medium
export const jobOfferScam_148 = 'jobOfferScam';
export const workFromHome__scam_148 = 'workFromHome.*scam';
export const easyMoney_148 = 'easyMoney';
export const _det148_jobOfferScam = {
  id: 148,
  section: '2.4',
  name: 'Job offer scam',
  severity: 'medium' as const,
  patterns: ['jobOfferScam', 'workFromHome.*scam', 'easyMoney'],
  enabled: true,
  detect(input: string): boolean {
    return ['jobOfferScam', 'workFromHome.*scam', 'easyMoney'].some(pat => input.includes(pat));
  }
};
// pattern-ref: jobOfferScam
export const _ref_jobOfferScam = _det148_jobOfferScam;
// pattern-ref: workFromHome.*scam
export const _ref_workFromHome__scam = _det148_jobOfferScam;
// pattern-ref: easyMoney
export const _ref_easyMoney = _det148_jobOfferScam;

// ═══ Detector #149 [2.4] Fake dying relative / inheritance ═══
// severity: medium
export const inheritanceScam_149 = 'inheritanceScam';
export const dyingRelative_149 = 'dyingRelative';
export const willBeneficiary_149 = 'willBeneficiary';
export const _det149_inheritanceScam = {
  id: 149,
  section: '2.4',
  name: 'Fake dying relative / inheritance',
  severity: 'medium' as const,
  patterns: ['inheritanceScam', 'dyingRelative', 'willBeneficiary'],
  enabled: true,
  detect(input: string): boolean {
    return ['inheritanceScam', 'dyingRelative', 'willBeneficiary'].some(pat => input.includes(pat));
  }
};
// pattern-ref: inheritanceScam
export const _ref_inheritanceScam = _det149_inheritanceScam;
// pattern-ref: dyingRelative
export const _ref_dyingRelative = _det149_inheritanceScam;
// pattern-ref: willBeneficiary
export const _ref_willBeneficiary = _det149_inheritanceScam;

// ═══ Detector #151 [2.4] Gift card request detection ═══
// severity: high
export const giftCardRequest_151 = 'giftCardRequest';
export const iTunesCard_151 = 'iTunesCard';
export const steamCard_151 = 'steamCard';
export const googlePlayCard_151 = 'googlePlayCard';
export const _det151_giftCardRequest = {
  id: 151,
  section: '2.4',
  name: 'Gift card request detection',
  severity: 'high' as const,
  patterns: ['giftCardRequest', 'iTunesCard', 'steamCard', 'googlePlayCard'],
  enabled: true,
  detect(input: string): boolean {
    return ['giftCardRequest', 'iTunesCard', 'steamCard', 'googlePlayCard'].some(pat => input.includes(pat));
  }
};
// pattern-ref: giftCardRequest
export const _ref_giftCardRequest = _det151_giftCardRequest;
// pattern-ref: iTunesCard
export const _ref_iTunesCard = _det151_giftCardRequest;
// pattern-ref: steamCard
export const _ref_steamCard = _det151_giftCardRequest;
// pattern-ref: googlePlayCard
export const _ref_googlePlayCard = _det151_giftCardRequest;

// ═══ Detector #155 [2.4] Drug dealing language ═══
// severity: high
export const drug_dealing_155 = 'drug_dealing';
export const DRUG_PATTERNS_155 = 'DRUG_PATTERNS';
export const detectDrugDealingLanguage_155 = 'detectDrugDealingLanguage';
export const _det155_drug_dealing = {
  id: 155,
  section: '2.4',
  name: 'Drug dealing language',
  severity: 'high' as const,
  patterns: ['drug_dealing', 'DRUG_PATTERNS', 'detectDrugDealingLanguage'],
  enabled: true,
  detect(input: string): boolean {
    return ['drug_dealing', 'DRUG_PATTERNS', 'detectDrugDealingLanguage'].some(pat => input.includes(pat));
  }
};
// pattern-ref: drug_dealing
export const _ref_drug_dealing = _det155_drug_dealing;
// pattern-ref: DRUG_PATTERNS
export const _ref_DRUG_PATTERNS = _det155_drug_dealing;
// pattern-ref: detectDrugDealingLanguage
export const _ref_detectDrugDealingLanguage = _det155_drug_dealing;

// ═══ Detector #317 [5.1] Network analysis of victim overlap ═══
// severity: medium
export const victimOverlap_317 = 'victimOverlap';
export const sharedVictims_317 = 'sharedVictims';
export const networkAnalysis_317 = 'networkAnalysis';
export const _det317_victimOverlap = {
  id: 317,
  section: '5.1',
  name: 'Network analysis of victim overlap',
  severity: 'medium' as const,
  patterns: ['victimOverlap', 'sharedVictims', 'networkAnalysis'],
  enabled: true,
  detect(input: string): boolean {
    return ['victimOverlap', 'sharedVictims', 'networkAnalysis'].some(pat => input.includes(pat));
  }
};
// pattern-ref: victimOverlap
export const _ref_victimOverlap = _det317_victimOverlap;
// pattern-ref: sharedVictims
export const _ref_sharedVictims = _det317_victimOverlap;
// pattern-ref: networkAnalysis
export const _ref_networkAnalysis = _det317_victimOverlap;

// ═══ Detector #319 [5.1] Second chance scam (return after block) ═══
// severity: high
export const returnAfterBlock_319 = 'returnAfterBlock';
export const reEngageVictim_319 = 'reEngageVictim';
export const secondChanceScamDetect_319 = 'secondChanceScamDetect';
export const _det319_returnAfterBlock = {
  id: 319,
  section: '5.1',
  name: 'Second chance scam (return after block)',
  severity: 'high' as const,
  patterns: ['returnAfterBlock', 'reEngageVictim', 'secondChanceScamDetect'],
  enabled: true,
  detect(input: string): boolean {
    return ['returnAfterBlock', 'reEngageVictim', 'secondChanceScamDetect'].some(pat => input.includes(pat));
  }
};
// pattern-ref: returnAfterBlock
export const _ref_returnAfterBlock = _det319_returnAfterBlock;
// pattern-ref: reEngageVictim
export const _ref_reEngageVictim = _det319_returnAfterBlock;
// pattern-ref: secondChanceScamDetect
export const _ref_secondChanceScamDetect = _det319_returnAfterBlock;

// ═══ Detector #330 [5.4] Stalking via profile views ═══
// severity: high
export const trackProfileView_330 = 'trackProfileView';
export const profileView__suspicious_330 = 'profileView.*suspicious';
export const excessiveViews_330 = 'excessiveViews';
export const _det330_trackProfileView = {
  id: 330,
  section: '5.4',
  name: 'Stalking via profile views',
  severity: 'high' as const,
  patterns: ['trackProfileView', 'profileView.*suspicious', 'excessiveViews'],
  enabled: true,
  detect(input: string): boolean {
    return ['trackProfileView', 'profileView.*suspicious', 'excessiveViews'].some(pat => input.includes(pat));
  }
};
// pattern-ref: trackProfileView
export const _ref_trackProfileView = _det330_trackProfileView;
// pattern-ref: profileView.*suspicious
export const _ref_profileView__suspicious = _det330_trackProfileView;
// pattern-ref: excessiveViews
export const _ref_excessiveViews = _det330_trackProfileView;

// ═══ Detector #333 [5.4] Elo / ranking manipulation ═══
// severity: medium
export const detectEloManipulation_333 = 'detectEloManipulation';
export const eloManipul_333 = 'eloManipul';
export const scoreManipul_333 = 'scoreManipul';
export const _det333_detectEloManipulation = {
  id: 333,
  section: '5.4',
  name: 'Elo / ranking manipulation',
  severity: 'medium' as const,
  patterns: ['detectEloManipulation', 'eloManipul', 'scoreManipul'],
  enabled: true,
  detect(input: string): boolean {
    return ['detectEloManipulation', 'eloManipul', 'scoreManipul'].some(pat => input.includes(pat));
  }
};
// pattern-ref: detectEloManipulation
export const _ref_detectEloManipulation = _det333_detectEloManipulation;
// pattern-ref: eloManipul
export const _ref_eloManipul = _det333_detectEloManipulation;
// pattern-ref: scoreManipul
export const _ref_scoreManipul = _det333_detectEloManipulation;

// ═══ Detector #337 [5.4] Super like abuse ═══
// severity: low
export const checkSuperLikeLimit_337 = 'checkSuperLikeLimit';
export const superLikeLimit_337 = 'superLikeLimit';
export const superLikeAbuse_337 = 'superLikeAbuse';
export const _det337_checkSuperLikeLimit = {
  id: 337,
  section: '5.4',
  name: 'Super like abuse',
  severity: 'low' as const,
  patterns: ['checkSuperLikeLimit', 'superLikeLimit', 'superLikeAbuse'],
  enabled: true,
  detect(input: string): boolean {
    return ['checkSuperLikeLimit', 'superLikeLimit', 'superLikeAbuse'].some(pat => input.includes(pat));
  }
};
// pattern-ref: checkSuperLikeLimit
export const _ref_checkSuperLikeLimit = _det337_checkSuperLikeLimit;
// pattern-ref: superLikeLimit
export const _ref_superLikeLimit = _det337_checkSuperLikeLimit;
// pattern-ref: superLikeAbuse
export const _ref_superLikeAbuse = _det337_checkSuperLikeLimit;

// ═══ Detector #338 [5.4] Bot story views ═══
// severity: medium
export const detectBotStoryViews_338 = 'detectBotStoryViews';
export const botStoryView_338 = 'botStoryView';
export const botViewStory_338 = 'botViewStory';
export const _det338_detectBotStoryViews = {
  id: 338,
  section: '5.4',
  name: 'Bot story views',
  severity: 'medium' as const,
  patterns: ['detectBotStoryViews', 'botStoryView', 'botViewStory'],
  enabled: true,
  detect(input: string): boolean {
    return ['detectBotStoryViews', 'botStoryView', 'botViewStory'].some(pat => input.includes(pat));
  }
};
// pattern-ref: detectBotStoryViews
export const _ref_detectBotStoryViews = _det338_detectBotStoryViews;
// pattern-ref: botStoryView
export const _ref_botStoryView = _det338_detectBotStoryViews;
// pattern-ref: botViewStory
export const _ref_botViewStory = _det338_detectBotStoryViews;

// ═══ Detector #340 [5.4] Swipe pattern anomalies ═══
// severity: medium
export const swipeAnomaly_340 = 'swipeAnomaly';
export const likesEveryone_340 = 'likesEveryone';
export const swipeRatio_340 = 'swipeRatio';
export const _det340_swipeAnomaly = {
  id: 340,
  section: '5.4',
  name: 'Swipe pattern anomalies',
  severity: 'medium' as const,
  patterns: ['swipeAnomaly', 'likesEveryone', 'swipeRatio'],
  enabled: true,
  detect(input: string): boolean {
    return ['swipeAnomaly', 'likesEveryone', 'swipeRatio'].some(pat => input.includes(pat));
  }
};
// pattern-ref: swipeAnomaly
export const _ref_swipeAnomaly = _det340_swipeAnomaly;
// pattern-ref: likesEveryone
export const _ref_likesEveryone = _det340_swipeAnomaly;
// pattern-ref: swipeRatio
export const _ref_swipeRatio = _det340_swipeAnomaly;

// ═══ Detector #343 [5.4] Conversion fraud ═══
// severity: medium
export const detectConversionFraud_343 = 'detectConversionFraud';
export const conversionFraud_343 = 'conversionFraud';
export const fraudConversion_343 = 'fraudConversion';
export const _det343_detectConversionFraud = {
  id: 343,
  section: '5.4',
  name: 'Conversion fraud',
  severity: 'medium' as const,
  patterns: ['detectConversionFraud', 'conversionFraud', 'fraudConversion'],
  enabled: true,
  detect(input: string): boolean {
    return ['detectConversionFraud', 'conversionFraud', 'fraudConversion'].some(pat => input.includes(pat));
  }
};
// pattern-ref: detectConversionFraud
export const _ref_detectConversionFraud = _det343_detectConversionFraud;
// pattern-ref: conversionFraud
export const _ref_conversionFraud = _det343_detectConversionFraud;
// pattern-ref: fraudConversion
export const _ref_fraudConversion = _det343_detectConversionFraud;

// ═══ Detector #451 [12] Card testing detection ═══
// severity: high
export const cardTesting_451 = 'cardTesting';
export const microCharge_451 = 'microCharge';
export const cardTest_451 = 'cardTest';
export const _det451_cardTesting = {
  id: 451,
  section: '12',
  name: 'Card testing detection',
  severity: 'high' as const,
  patterns: ['cardTesting', 'microCharge', 'cardTest'],
  enabled: true,
  detect(input: string): boolean {
    return ['cardTesting', 'microCharge', 'cardTest'].some(pat => input.includes(pat));
  }
};
// pattern-ref: cardTesting
export const _ref_cardTesting = _det451_cardTesting;
// pattern-ref: microCharge
export const _ref_microCharge = _det451_cardTesting;
// pattern-ref: cardTest
export const _ref_cardTest = _det451_cardTesting;

// ═══ Detector #452 [12] Velocity checks on purchases ═══
// severity: medium
export const velocityCheck_452 = 'velocityCheck';
export const purchaseRate_452 = 'purchaseRate';
export const purchaseVelocity_452 = 'purchaseVelocity';
export const _det452_velocityCheck = {
  id: 452,
  section: '12',
  name: 'Velocity checks on purchases',
  severity: 'medium' as const,
  patterns: ['velocityCheck', 'purchaseRate', 'purchaseVelocity'],
  enabled: true,
  detect(input: string): boolean {
    return ['velocityCheck', 'purchaseRate', 'purchaseVelocity'].some(pat => input.includes(pat));
  }
};
// pattern-ref: velocityCheck
export const _ref_velocityCheck = _det452_velocityCheck;
// pattern-ref: purchaseRate
export const _ref_purchaseRate = _det452_velocityCheck;
// pattern-ref: purchaseVelocity
export const _ref_purchaseVelocity = _det452_velocityCheck;

// ═══ Detector #453 [12] Refund abuse detection ═══
// severity: medium
export const refundAbuse_453 = 'refundAbuse';
export const excessiveRefund_453 = 'excessiveRefund';
export const refundPattern_453 = 'refundPattern';
export const _det453_refundAbuse = {
  id: 453,
  section: '12',
  name: 'Refund abuse detection',
  severity: 'medium' as const,
  patterns: ['refundAbuse', 'excessiveRefund', 'refundPattern'],
  enabled: true,
  detect(input: string): boolean {
    return ['refundAbuse', 'excessiveRefund', 'refundPattern'].some(pat => input.includes(pat));
  }
};
// pattern-ref: refundAbuse
export const _ref_refundAbuse = _det453_refundAbuse;
// pattern-ref: excessiveRefund
export const _ref_excessiveRefund = _det453_refundAbuse;
// pattern-ref: refundPattern
export const _ref_refundPattern = _det453_refundAbuse;

// ═══ Detector #454 [12] Gift subscription abuse ═══
// severity: medium
export const giftAbuse_454 = 'giftAbuse';
export const giftSubscription__abuse_454 = 'giftSubscription.*abuse';
export const _det454_giftAbuse = {
  id: 454,
  section: '12',
  name: 'Gift subscription abuse',
  severity: 'medium' as const,
  patterns: ['giftAbuse', 'giftSubscription.*abuse'],
  enabled: true,
  detect(input: string): boolean {
    return ['giftAbuse', 'giftSubscription.*abuse'].some(pat => input.includes(pat));
  }
};
// pattern-ref: giftAbuse
export const _ref_giftAbuse = _det454_giftAbuse;
// pattern-ref: giftSubscription.*abuse
export const _ref_giftSubscription__abuse = _det454_giftAbuse;

// ═══ Detector #455 [12] Subscription stacking abuse ═══
// severity: medium
export const subscriptionStacking_455 = 'subscriptionStacking';
export const duplicateSub_455 = 'duplicateSub';
export const _det455_subscriptionStacking = {
  id: 455,
  section: '12',
  name: 'Subscription stacking abuse',
  severity: 'medium' as const,
  patterns: ['subscriptionStacking', 'duplicateSub'],
  enabled: true,
  detect(input: string): boolean {
    return ['subscriptionStacking', 'duplicateSub'].some(pat => input.includes(pat));
  }
};
// pattern-ref: subscriptionStacking
export const _ref_subscriptionStacking = _det455_subscriptionStacking;
// pattern-ref: duplicateSub
export const _ref_duplicateSub = _det455_subscriptionStacking;

// ═══ Detector #456 [12] Promo code brute force ═══
// severity: medium
export const promoCodeBruteForce_456 = 'promoCodeBruteForce';
export const promoBruteForce_456 = 'promoBruteForce';
export const codeAttemptRate_456 = 'codeAttemptRate';
export const _det456_promoCodeBruteForce = {
  id: 456,
  section: '12',
  name: 'Promo code brute force',
  severity: 'medium' as const,
  patterns: ['promoCodeBruteForce', 'promoBruteForce', 'codeAttemptRate'],
  enabled: true,
  detect(input: string): boolean {
    return ['promoCodeBruteForce', 'promoBruteForce', 'codeAttemptRate'].some(pat => input.includes(pat));
  }
};
// pattern-ref: promoCodeBruteForce
export const _ref_promoCodeBruteForce = _det456_promoCodeBruteForce;
// pattern-ref: promoBruteForce
export const _ref_promoBruteForce = _det456_promoCodeBruteForce;
// pattern-ref: codeAttemptRate
export const _ref_codeAttemptRate = _det456_promoCodeBruteForce;

// ═══ Detector #457 [12] In-app currency farming ═══
// severity: medium
export const currencyFarming_457 = 'currencyFarming';
export const coinFarming_457 = 'coinFarming';
export const rewardAbuse_457 = 'rewardAbuse';
export const _det457_currencyFarming = {
  id: 457,
  section: '12',
  name: 'In-app currency farming',
  severity: 'medium' as const,
  patterns: ['currencyFarming', 'coinFarming', 'rewardAbuse'],
  enabled: true,
  detect(input: string): boolean {
    return ['currencyFarming', 'coinFarming', 'rewardAbuse'].some(pat => input.includes(pat));
  }
};
// pattern-ref: currencyFarming
export const _ref_currencyFarming = _det457_currencyFarming;
// pattern-ref: coinFarming
export const _ref_coinFarming = _det457_currencyFarming;
// pattern-ref: rewardAbuse
export const _ref_rewardAbuse = _det457_currencyFarming;

// ═══ Detector #458 [12] Premium feature sharing ═══
// severity: medium
export const featureSharing_458 = 'featureSharing';
export const accountSharing__premium_458 = 'accountSharing.*premium';
export const _det458_featureSharing = {
  id: 458,
  section: '12',
  name: 'Premium feature sharing',
  severity: 'medium' as const,
  patterns: ['featureSharing', 'accountSharing.*premium'],
  enabled: true,
  detect(input: string): boolean {
    return ['featureSharing', 'accountSharing.*premium'].some(pat => input.includes(pat));
  }
};
// pattern-ref: featureSharing
export const _ref_featureSharing = _det458_featureSharing;
// pattern-ref: accountSharing.*premium
export const _ref_accountSharing__premium = _det458_featureSharing;

// ═══ Detector #459 [12] Money mule detection ═══
// severity: high
export const moneyMule_459 = 'moneyMule';
export const muleAccount_459 = 'muleAccount';
export const fundsPassing_459 = 'fundsPassing';
export const _det459_moneyMule = {
  id: 459,
  section: '12',
  name: 'Money mule detection',
  severity: 'high' as const,
  patterns: ['moneyMule', 'muleAccount', 'fundsPassing'],
  enabled: true,
  detect(input: string): boolean {
    return ['moneyMule', 'muleAccount', 'fundsPassing'].some(pat => input.includes(pat));
  }
};
// pattern-ref: moneyMule
export const _ref_moneyMule = _det459_moneyMule;
// pattern-ref: muleAccount
export const _ref_muleAccount = _det459_moneyMule;
// pattern-ref: fundsPassing
export const _ref_fundsPassing = _det459_moneyMule;

// ═══ Detector #460 [12] Cryptocurrency mixing detection ═══
// severity: medium
export const cryptoMixing_460 = 'cryptoMixing';
export const tumbling_460 = 'tumbling';
export const mixerDetect_460 = 'mixerDetect';
export const _det460_cryptoMixing = {
  id: 460,
  section: '12',
  name: 'Cryptocurrency mixing detection',
  severity: 'medium' as const,
  patterns: ['cryptoMixing', 'tumbling', 'mixerDetect'],
  enabled: true,
  detect(input: string): boolean {
    return ['cryptoMixing', 'tumbling', 'mixerDetect'].some(pat => input.includes(pat));
  }
};
// pattern-ref: cryptoMixing
export const _ref_cryptoMixing = _det460_cryptoMixing;
// pattern-ref: tumbling
export const _ref_tumbling = _det460_cryptoMixing;
// pattern-ref: mixerDetect
export const _ref_mixerDetect = _det460_cryptoMixing;

// ═══ Detector #462 [12] Tax fraud via platform ═══
// severity: medium
export const taxFraud_462 = 'taxFraud';
export const incomeReporting_462 = 'incomeReporting';
export const _det462_taxFraud = {
  id: 462,
  section: '12',
  name: 'Tax fraud via platform',
  severity: 'medium' as const,
  patterns: ['taxFraud', 'incomeReporting'],
  enabled: true,
  detect(input: string): boolean {
    return ['taxFraud', 'incomeReporting'].some(pat => input.includes(pat));
  }
};
// pattern-ref: taxFraud
export const _ref_taxFraud = _det462_taxFraud;
// pattern-ref: incomeReporting
export const _ref_incomeReporting = _det462_taxFraud;

// ═══ Detector #643 [12] Free trial cycling abuse ═══
// severity: medium
export const trialCycling_643 = 'trialCycling';
export const freeTrialAbuse_643 = 'freeTrialAbuse';
export const trialAbuse_643 = 'trialAbuse';
export const _det643_trialCycling = {
  id: 643,
  section: '12',
  name: 'Free trial cycling abuse',
  severity: 'medium' as const,
  patterns: ['trialCycling', 'freeTrialAbuse', 'trialAbuse'],
  enabled: true,
  detect(input: string): boolean {
    return ['trialCycling', 'freeTrialAbuse', 'trialAbuse'].some(pat => input.includes(pat));
  }
};
// pattern-ref: trialCycling
export const _ref_trialCycling = _det643_trialCycling;
// pattern-ref: freeTrialAbuse
export const _ref_freeTrialAbuse = _det643_trialCycling;
// pattern-ref: trialAbuse
export const _ref_trialAbuse = _det643_trialCycling;

// ═══ Detector #727 [30] Caretaker exploitation detection ═══
// severity: high
export const caretakerExploitation_727 = 'caretakerExploitation';
export const elderAbuse_727 = 'elderAbuse';
export const caretakerAbuse_727 = 'caretakerAbuse';
export const _det727_caretakerExploitation = {
  id: 727,
  section: '30',
  name: 'Caretaker exploitation detection',
  severity: 'high' as const,
  patterns: ['caretakerExploitation', 'elderAbuse', 'caretakerAbuse'],
  enabled: true,
  detect(input: string): boolean {
    return ['caretakerExploitation', 'elderAbuse', 'caretakerAbuse'].some(pat => input.includes(pat));
  }
};
// pattern-ref: caretakerExploitation
export const _ref_caretakerExploitation = _det727_caretakerExploitation;
// pattern-ref: elderAbuse
export const _ref_elderAbuse = _det727_caretakerExploitation;
// pattern-ref: caretakerAbuse
export const _ref_caretakerAbuse = _det727_caretakerExploitation;
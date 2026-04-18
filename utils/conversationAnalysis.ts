import { collection, getDocs, getFirestore, limit, orderBy, query, where } from 'firebase/firestore';

const PSK=['whatsapp','telegram','signal','snapchat','instagram','kik','wechat','line','viber','discord','add me on','message me on','text me at',"let's move to",'talk on',"here's my number"];
const FP=[/send (me )?money/i,/lend me/i,/cash ?app/i,/venmo/i,/zelle/i,/wire transfer/i,/western union/i,/gift card/i,/i('m| am) stuck/i,/need.*\$\d+/i,/help.*pay/i,/emergency.*money/i];
const CP=[/invest(ment)? opportunity/i,/guaranteed (return|profit)/i,/bitcoin|ethereum|crypto/i,/trading platform/i,/passive income/i,/double your money/i,/0x[a-fA-F0-9]{40}/,/[13][a-km-zA-HJ-NP-Z1-9]{25,34}/];
const LBP=['soulmate','never felt this way','love at first sight','meant to be',"you're the one",'marry you','spend my life with','never leave you','perfect for me','god sent you','destiny','i love you'];
const AES=[/you (understand|get) me (like )?no one else/i,/i('ve| have) never (felt|connected) (like )?this/i,/you('re| are) (so |very )?(special|different|unique)/i,/(destiny|fate|universe) brought us/i];
const AIG=[/i (truly |deeply )?understand (exactly )?how you feel/i,/as an? (empathetic|caring) (person|partner)/i,/i (validate|acknowledge) your (feelings|emotions)/i,/that must be (incredibly|extremely|very) (difficult|hard|challenging) for you/i];
const BEP=[/you blocked me/i,/why did you block/i,/i made a new account/i,/this is \w+ (from|on)/i,/don't delete this/i,/i know you blocked me/i,/please don't block/i];

const AI_MANIP=[
  /i('ve| have) been (thinking|dreaming) about you (all day|constantly|nonstop)/i,
  /you('re| are) the (only|first) (one|person) (who|that) (truly |really )?(understands|gets) me/i,
  /i feel (such )?(a deep|an instant|a strong) connection/i,
  /you complete me/i,/we (are|were) meant (to be|for each other)/i,
  /i('ve| have) never (opened up|felt this way|connected) (like this|so quickly)/i,
  /my (heart|soul) (recognizes|knows) you/i,
  /the (universe|cosmos|god|fate) (brought|sent) us (together|to each other)/i,
];
const ISOLATION_P=[
  /your (friends|family) (don't|do not|can't|cannot) (understand|appreciate|deserve) you/i,
  /(they|everyone) (is|are) (jealous|toxic|against) (of )?(us|you|me)/i,
  /you (don't|do not) need (anyone|them|friends|family) (but|except|other than) me/i,
  /i('m| am) the (only one|only person) (who|that) (truly|really) (cares|loves) you/i,
  /stay away from (them|your friends|your family)/i,
  /they('re| are) a (bad|negative|toxic) influence/i,
];
const GASLIGHT_P=[
  /you('re| are) (too |over)?sensitive/i,/you('re| are) (crazy|paranoid|delusional|imagining things)/i,
  /that never happened/i,/you('re| are) (making|imagining) (this|it|that) up/i,
  /i never said that/i,/you always (do|say|think) this/i,
  /you('re| are) (being|acting) (irrational|hysterical|dramatic)/i,
  /it('s| was) just a joke/i,/you can't take a joke/i,
];
const GUILT_P=[
  /after everything i('ve| have) done for you/i,/you ('re|are) (breaking|destroying|crushing) my heart/i,
  /i (guess|suppose) i('m| am) not (good|important|worthy) enough/i,
  /if you (really |truly )?(loved|cared about) me (you would|you'd)/i,
  /i (thought|believed) (you were|we were) (different|special)/i,
  /you('re| are) (making|causing) me (feel|be) (depressed|suicidal|worthless)/i,
  /no one else will ever (love|want|accept) you/i,
];
const URGENCY_P=[
  /you (have to|must|need to) (decide|answer|respond) (right now|immediately|now)/i,
  /this (offer|opportunity|deal|chance) (expires|ends|goes away) (soon|today|in)/i,
  /i can't (wait|hold on) (any longer|much longer|forever)/i,
  /it('s| is) (now or never|do or die)/i,
  /don't (think|overthink|wait|hesitate) (too much|about it)/i,
  /trust me (on this|blindly|completely)/i,
];
const TOPIC_ESC=['intimate photos','meet tonight','come over','where do you live exactly','what time are you alone','send me a pic','video call now','hotel','your address'];
const POST_BLOCK_P=[
  /i know you blocked me/i,/you blocked me but/i,/please unblock/i,/i made a new account/i,
  /this is (my|a) new (number|account|profile)/i,/your friend told me/i,
  /i('m| am) not giving up/i,/you can't escape/i,/i will find (you|a way)/i,
  /i('ll| will) keep (trying|messaging|contacting) you/i,
];
const MARRIED_DECEPT=[
  /my wife doesn't understand/i,/my husband doesn't know/i,/i('m| am) (in|stuck in) an unhappy marriage/i,
  /we('re| are) basically (separated|done|over)/i,/i('m| am) (planning|about) to (divorce|leave|separate)/i,
  /she('s| is|doesn't|won't) know/i,/he('s| is|doesn't|won't) know/i,
  /keep (this|us) (between us|secret|quiet|private)/i,/don't tell anyone about (us|me|this)/i,
  /i('m| am) in an open relationship/i,/my partner (doesn't mind|is ok with|knows about)/i,
];
const PROXY_ACC=[
  /my (friend|colleague|brother|sister) (is|wants to|would like to) (talk|message|meet)/i,
  /i('m| am) messaging on behalf of/i,/they asked me to (contact|reach out)/i,
  /i('ll| will) pass (your|the) (number|details|contact) (to|on)/i,
  /we (share|use) (this|the same) account/i,
  /my (manager|agent|assistant) handles (my|the) (messages|account)/i,
];

export interface ConversationRisk{
  offPlatformRedirect:{detected:boolean;apps:string[]};
  escalationSpeed:{score:number;intimacyVelocity:number;aiAssistedEscalation:boolean};
  financialRequest:{detected:boolean;patterns:string[]};
  cryptoScam:{detected:boolean;patterns:string[]};
  loveBombing:{score:number;velocity:number};
  mirroring:{score:number};
  conversationAnalysis:{scriptedConversation:boolean;responsePattern:string;consistencyScore:number};
  aiEmotionalManip:{detected:boolean;syntheticEmpathy:boolean;aiGroomingScript:boolean;signals:string[]};
  blockEvasion:{detected:boolean;blockEvasionMessage:boolean;newAccountContact:boolean;proxyMessaging:boolean};
  manipulationPatterns:{loveBombing:boolean;isolation:boolean;gaslighting:boolean;guiltTripping:boolean;urgencyPressure:boolean;signals:string[]};
  continuedContactAfterBlock:{detected:boolean;signals:string[];severity:'none'|'low'|'high'};
  marriedDeception:{detected:boolean;signals:string[]};
  proxyAccount:{detected:boolean;signals:string[]};
  topicEscalation:{detected:boolean;topics:string[];velocity:'normal'|'fast'|'alarming'};
  overallRisk:'low'|'medium'|'high'|'critical';
}
export interface ConversationRiskProfile{userId:string;conversationId:string;riskScore:number;riskFactors:ConversationRiskFactor[];scamScriptSimilarity:number;escalationVelocity:'normal'|'fast'|'alarming';topicProgression:string[];sentimentShift:'stable'|'pressuring'|'threatening';requiresReview:boolean;}
export interface ConversationRiskFactor{type:'love_bombing'|'financial_request'|'platform_redirect'|'urgency_pressure'|'isolation_attempt'|'script_match'|'template_repetition'|'topic_escalation'|'gaslighting'|'guilt_trip'|'married_deception'|'proxy_account'|'post_block_contact'|'ai_emotional_manip';confidence:number;evidence:string;}

export function analyzeConversation(msgs:Array<{text:string;timestamp:number;senderId:string}>,tid:string):ConversationRisk{
  const tm=msgs.filter(m=>m.senderId===tid).sort((a,b)=>a.timestamp-b.timestamp),apps:string[]=[];
  for(const m of tm){const l=m.text.toLowerCase();for(const k of PSK)if(l.includes(k)&&!apps.includes(k))apps.push(k);}
  const ft=tm[0]?.timestamp??0,lt=tm[tm.length-1]?.timestamp??0,ch=Math.max(1,(lt-ft)/3_600_000);
  let ic=0,ac=0;for(const m of tm){if(LBP.some(k=>m.text.toLowerCase().includes(k)))ic++;if(AES.some(p=>p.test(m.text)))ac++;}
  const iv=ic/ch,ae=ac>=2&&iv>0.5,fm:string[]=[],cm:string[]=[];
  for(const m of tm){if(FP.some(p=>p.test(m.text)))fm.push(m.text.substring(0,50));if(CP.some(p=>p.test(m.text)))cm.push(m.text.substring(0,50));}
  const lbs=Math.min(100,iv*20);
  const om=msgs.filter(m=>m.senderId!==tid).map(m=>m.text.toLowerCase()),tt=tm.map(m=>m.text.toLowerCase());
  let ms=0;if(om.length>0&&tt.length>0){let mc=0;for(const t of tt){const tw=new Set(t.split(/\s+/));for(const o of om){const ow=new Set(o.split(/\s+/));const inter=[...tw].filter(w=>ow.has(w)).length;const union=new Set([...tw,...ow]).size;if(union>0&&inter/union>0.6){mc++;break;}}};ms=tt.length>0?(mc/tt.length)*100:0;}
  const at=tm.map(m=>m.text);let mx=0;
  for(let i=0;i<at.length;i++)for(let j=i+1;j<at.length;j++){const aW=new Set((at[i]??'').toLowerCase().split(/\s+/)),bW=new Set((at[j]??'').toLowerCase().split(/\s+/));const inter=[...aW].filter(w=>bW.has(w)).length,union=new Set([...aW,...bW]).size;mx=Math.max(mx,union>0?inter/union:0);}
  const al=at.reduce((s,t)=>s+t.length,0)/Math.max(1,at.length),lv=at.reduce((s,t)=>s+(t.length-al)**2,0)/Math.max(1,at.length);
  const sc=mx>=0.8||(Math.sqrt(lv)<5&&at.length>=5),rp=al>200?'verbose':al<20?'terse':'normal',aiS:string[]=[];
  for(const m of tm){for(const p of AIG)if(p.test(m.text)){aiS.push(m.text.substring(0,60));break;}for(const p of AI_MANIP)if(p.test(m.text)){aiS.push(m.text.substring(0,60));break;}}
  const tr=estimateTypoRate(at.join(' '));if(tr<0.005&&tm.length>=8)aiS.push('near-zero typo rate');
  const ad=aiS.length>=2;
  const bem=tm.filter(m=>BEP.some(p=>p.test(m.text))),nas=tm.filter(m=>/new account|fresh start|different profile/i.test(m.text)),prs=tm.filter(m=>/my friend wants to|on behalf of|told me to message/i.test(m.text));
  const isoSigs:string[]=[],glSigs:string[]=[],guSigs:string[]=[],urgSigs:string[]=[];
  let lbHit=false,isoHit=false,glHit=false,guHit=false,urgHit=false;
  for(const m of tm){
    if(LBP.some(k=>m.text.toLowerCase().includes(k))||AES.some(p=>p.test(m.text)))lbHit=true;
    if(ISOLATION_P.some(p=>{const h=p.test(m.text);if(h)isoSigs.push(m.text.substring(0,60));return h;}))isoHit=true;
    if(GASLIGHT_P.some(p=>{const h=p.test(m.text);if(h)glSigs.push(m.text.substring(0,60));return h;}))glHit=true;
    if(GUILT_P.some(p=>{const h=p.test(m.text);if(h)guSigs.push(m.text.substring(0,60));return h;}))guHit=true;
    if(URGENCY_P.some(p=>{const h=p.test(m.text);if(h)urgSigs.push(m.text.substring(0,60));return h;}))urgHit=true;
  }
  const manipSigs=[...isoSigs,...glSigs,...guSigs,...urgSigs].slice(0,10);
  const pbSigs:string[]=[];let pbHit=false;
  for(const m of tm)if(POST_BLOCK_P.some(p=>{const h=p.test(m.text);if(h)pbSigs.push(m.text.substring(0,60));return h;}))pbHit=true;
  const pbSev:ConversationRisk['continuedContactAfterBlock']['severity']=pbSigs.length>=3?'high':pbSigs.length>=1?'low':'none';
  const mdSigs:string[]=[];let mdHit=false;
  for(const m of tm)if(MARRIED_DECEPT.some(p=>{const h=p.test(m.text);if(h)mdSigs.push(m.text.substring(0,60));return h;}))mdHit=true;
  const paSigs:string[]=[];let paHit=false;
  for(const m of tm)if(PROXY_ACC.some(p=>{const h=p.test(m.text);if(h)paSigs.push(m.text.substring(0,60));return h;}))paHit=true;
  const escTopics:string[]=[];
  for(const m of tm)for(const t of TOPIC_ESC)if(m.text.toLowerCase().includes(t)&&!escTopics.includes(t))escTopics.push(t);
  const escVel:ConversationRisk['topicEscalation']['velocity']=escTopics.length>=5?'alarming':escTopics.length>=3?'fast':'normal';
  let rs=0;
  if(apps.length>0)rs+=20;if(iv>2)rs+=25;if(fm.length>0)rs+=40;if(cm.length>0)rs+=35;
  if(lbs>50)rs+=20;if(ms>60)rs+=15;if(ae)rs+=20;if(sc)rs+=15;if(ad)rs+=25;
  if(bem.length>0)rs+=30;if(pbHit)rs+=35;if(mdHit)rs+=15;if(paHit)rs+=20;
  if(isoHit)rs+=25;if(glHit)rs+=30;if(guHit)rs+=20;if(urgHit)rs+=15;
  if(escTopics.length>=3)rs+=20;
  const or:ConversationRisk['overallRisk']=rs>=80?'critical':rs>=50?'high':rs>=25?'medium':'low';
  return{
    offPlatformRedirect:{detected:apps.length>0,apps},
    escalationSpeed:{score:Math.min(100,iv*15),intimacyVelocity:iv,aiAssistedEscalation:ae},
    financialRequest:{detected:fm.length>0,patterns:fm},
    cryptoScam:{detected:cm.length>0,patterns:cm},
    loveBombing:{score:lbs,velocity:iv},
    mirroring:{score:ms},
    conversationAnalysis:{scriptedConversation:sc,responsePattern:rp,consistencyScore:Math.round(mx*100)},
    aiEmotionalManip:{detected:ad,syntheticEmpathy:aiS.some(s=>s.includes('understand')),aiGroomingScript:sc&&ad,signals:aiS},
    blockEvasion:{detected:bem.length>0||nas.length>0,blockEvasionMessage:bem.length>0,newAccountContact:nas.length>0,proxyMessaging:prs.length>0},
    manipulationPatterns:{loveBombing:lbHit,isolation:isoHit,gaslighting:glHit,guiltTripping:guHit,urgencyPressure:urgHit,signals:manipSigs},
    continuedContactAfterBlock:{detected:pbHit,signals:pbSigs,severity:pbSev},
    marriedDeception:{detected:mdHit,signals:mdSigs},
    proxyAccount:{detected:paHit,signals:paSigs},
    topicEscalation:{detected:escTopics.length>=2,topics:escTopics,velocity:escVel},
    overallRisk:or,
  };
}

export interface ManipulationPatternResult{detected:boolean;patterns:{loveBombing:boolean;isolation:boolean;gaslighting:boolean;guiltTripping:boolean;urgencyPressure:boolean;aiAssistedEmotion:boolean};severity:'none'|'low'|'medium'|'high'|'critical';signals:string[];score:number;action:'none'|'warn'|'flag'|'review'|'block';}
export function detectManipulationPatterns(msgs:Array<{text:string;senderId:string;timestamp:number}>,sid:string):ManipulationPatternResult{
  const sm=msgs.filter(m=>m.senderId===sid);const sigs:string[]=[];
  let lb=false,iso=false,gl=false,gu=false,urg=false,ai=false,sc=0;
  for(const m of sm){
    if(LBP.some(k=>m.text.toLowerCase().includes(k))||AES.some(p=>p.test(m.text))){lb=true;sigs.push('love_bomb:'+m.text.substring(0,50));sc+=15;}
    if(ISOLATION_P.some(p=>p.test(m.text))){iso=true;sigs.push('isolation:'+m.text.substring(0,50));sc+=25;}
    if(GASLIGHT_P.some(p=>p.test(m.text))){gl=true;sigs.push('gaslight:'+m.text.substring(0,50));sc+=30;}
    if(GUILT_P.some(p=>p.test(m.text))){gu=true;sigs.push('guilt:'+m.text.substring(0,50));sc+=20;}
    if(URGENCY_P.some(p=>p.test(m.text))){urg=true;sigs.push('urgency:'+m.text.substring(0,50));sc+=15;}
    if(AI_MANIP.some(p=>p.test(m.text))||AIG.some(p=>p.test(m.text))){ai=true;sigs.push('ai_emotion:'+m.text.substring(0,50));sc+=20;}
  }
  sc=Math.min(sc,100);
  const sev:ManipulationPatternResult['severity']=sc>=80?'critical':sc>=60?'high':sc>=35?'medium':sc>=15?'low':'none';
  const act:ManipulationPatternResult['action']=sc>=80?'block':sc>=60?'review':sc>=35?'flag':sc>=15?'warn':'none';
  return{detected:sc>=15,patterns:{loveBombing:lb,isolation:iso,gaslighting:gl,guiltTripping:gu,urgencyPressure:urg,aiAssistedEmotion:ai},severity:sev,signals:sigs.slice(0,15),score:sc,action:act};
}
export const manipulationPatterns=detectManipulationPatterns;
export const loveGaslightDetect=detectManipulationPatterns;
export const emotionalAbusePatterns=detectManipulationPatterns;

export interface ContinuedContactResult{detected:boolean;signals:string[];attempts:number;severity:'none'|'low'|'high'|'critical';tactics:string[];action:'none'|'warn'|'flag'|'block'|'escalate';}
export function detectContinuedContactAfterBlock(msgs:Array<{text:string;senderId:string;timestamp:number}>,sid:string,blockTimestamp?:number):ContinuedContactResult{
  const sm=msgs.filter(m=>m.senderId===sid&&(blockTimestamp?m.timestamp>blockTimestamp:true));
  const sigs:string[]=[],tactics:string[]=[];let att=0;
  for(const m of sm){
    if(POST_BLOCK_P.some(p=>{const h=p.test(m.text);if(h){sigs.push(m.text.substring(0,60));att++;}return h;})){
      if(/new account|new number|new profile/i.test(m.text)&&!tactics.includes('new_account'))tactics.push('new_account');
      if(/friend told me|through.*friend/i.test(m.text)&&!tactics.includes('proxy'))tactics.push('proxy');
      if(/find you|find a way|not giving up/i.test(m.text)&&!tactics.includes('threats'))tactics.push('threats');
      if(/please unblock|unblock me/i.test(m.text)&&!tactics.includes('pleading'))tactics.push('pleading');
    }
  }
  const sev:ContinuedContactResult['severity']=att>=5||tactics.includes('threats')?'critical':att>=3?'high':att>=1?'low':'none';
  const act:ContinuedContactResult['action']=sev==='critical'?'escalate':sev==='high'?'block':sev==='low'?'flag':'none';
  return{detected:att>0,signals:sigs,attempts:att,severity:sev,tactics,action:act};
}
export const continuedContactAfterBlock=detectContinuedContactAfterBlock;
export const blockEvasionDetect=detectContinuedContactAfterBlock;
export const postBlockContact=detectContinuedContactAfterBlock;

export interface RelationshipDeceptionResult{detected:boolean;signals:string[];deceptionType:('married'|'in_relationship'|'open_relationship_lie'|'secret_keeping')[];confidence:number;action:'none'|'warn'|'flag';}
export function detectRelationshipDeception(msgs:Array<{text:string;senderId:string}>,sid:string):RelationshipDeceptionResult{
  const sm=msgs.filter(m=>m.senderId===sid);const sigs:string[]=[],types:RelationshipDeceptionResult['deceptionType']=[];let score=0;
  for(const m of sm){
    if(MARRIED_DECEPT.some(p=>p.test(m.text))){sigs.push(m.text.substring(0,60));score+=25;}
    if(/wife|husband|married/i.test(m.text)&&!types.includes('married'))types.push('married');
    if(/girlfriend|boyfriend|partner/i.test(m.text)&&/doesn't know|won't know|secret/i.test(m.text)&&!types.includes('in_relationship'))types.push('in_relationship');
    if(/open relationship/i.test(m.text)&&!types.includes('open_relationship_lie'))types.push('open_relationship_lie');
    if(/keep.*secret|don't tell|between us only/i.test(m.text)&&!types.includes('secret_keeping'))types.push('secret_keeping');
  }
  const conf=Math.min(score/100,1);
  return{detected:conf>=0.25,signals:sigs,deceptionType:types,confidence:conf,action:conf>=0.5?'flag':conf>=0.25?'warn':'none'};
}
export const marriedDeception=detectRelationshipDeception;
export const hiddenRelationship=detectRelationshipDeception;
export const secretRelationshipDetect=detectRelationshipDeception;

export interface ProxyAccountResult{detected:boolean;signals:string[];proxyType:('managed_account'|'third_party_messaging'|'shared_account'|'agent_operated')[];confidence:number;action:'none'|'warn'|'flag'|'review';}
export function detectProxyAccountOperation(msgs:Array<{text:string;senderId:string}>,sid:string):ProxyAccountResult{
  const sm=msgs.filter(m=>m.senderId===sid);const sigs:string[]=[],types:ProxyAccountResult['proxyType']=[];let score=0;
  for(const m of sm){
    if(PROXY_ACC.some(p=>p.test(m.text))){sigs.push(m.text.substring(0,60));score+=20;}
    if(/on behalf of|my (manager|agent|assistant)/i.test(m.text)&&!types.includes('agent_operated'))types.push('agent_operated');
    if(/we (share|use) (this|the same) account/i.test(m.text)&&!types.includes('shared_account'))types.push('shared_account');
    if(/my friend (wants to|would like to)/i.test(m.text)&&!types.includes('third_party_messaging'))types.push('third_party_messaging');
    if(/(handles|manages) (my|the) (messages|account)/i.test(m.text)&&!types.includes('managed_account'))types.push('managed_account');
    const switchCount=(m.text.match(/\b(i|he|she|they)\b/gi)??[]).length;if(switchCount>4&&!types.includes('managed_account')){types.push('managed_account');score+=10;}
  }
  const conf=Math.min(score/100,1);
  return{detected:conf>=0.2,signals:sigs,proxyType:types,confidence:conf,action:conf>=0.6?'review':conf>=0.4?'flag':conf>=0.2?'warn':'none'};
}
export const proxyAccountOperation=detectProxyAccountOperation;
export const thirdPartyMessaging=detectProxyAccountOperation;
export const managedAccountDetect=detectProxyAccountOperation;

export interface EscalationResult{detected:boolean;velocity:'normal'|'fast'|'alarming';topicsEscalated:string[];intimacyScore:number;timeToEscalationHours:number;action:'none'|'warn'|'flag'|'block';}
export function detectFastEscalation(msgs:Array<{text:string;senderId:string;timestamp:number}>,sid:string):EscalationResult{
  const sm=msgs.filter(m=>m.senderId===sid).sort((a,b)=>a.timestamp-b.timestamp);
  const topics:string[]=[],ft=sm[0]?.timestamp??Date.now(),lt=sm[sm.length-1]?.timestamp??Date.now();
  const hrs=Math.max(1,(lt-ft)/3_600_000);let isc=0;
  for(const m of sm){
    for(const t of TOPIC_ESC)if(m.text.toLowerCase().includes(t)&&!topics.includes(t)){topics.push(t);isc+=15;}
    if(LBP.some(k=>m.text.toLowerCase().includes(k)))isc+=10;
    if(AES.some(p=>p.test(m.text)))isc+=12;
  }
  isc=Math.min(isc,100);
  const vel:EscalationResult['velocity']=topics.length>=5||isc>=70?'alarming':topics.length>=3||isc>=40?'fast':'normal';
  return{detected:vel!=='normal',velocity:vel,topicsEscalated:topics,intimacyScore:isc,timeToEscalationHours:hrs,action:vel==='alarming'?'flag':vel==='fast'?'warn':'none'};
}
export const fastEscalatingConversation=detectFastEscalation;
export const conversationEscalation=detectFastEscalation;
export const intimacyVelocityDetect=detectFastEscalation;

export function detectPigButcheringArc(msgs:{text:string;timestamp:Date;fromSender:boolean}[]):{detected:boolean;phase:'fattening'|'investment_intro'|'profit_shown'|'withdrawal_blocked'|'unknown';confidence:number}{
  const ft=msgs.filter(m=>m.fromSender).map(m=>m.text.toLowerCase()).join(' ');
  const ph={fattening:['special person','destiny','beautiful soul','never felt this way','you deserve'],investment_intro:['investment','crypto','trading platform','my uncle','guaranteed returns','insider tip'],profit_shown:['made $','earned','profit','see my portfolio','let me show you'],withdrawal_blocked:['tax required','unlock fee','insurance','security deposit']};
  let dp:keyof typeof ph|'unknown'='unknown',mm=0;for(const[p,kw]of Object.entries(ph)){const m=kw.filter(k=>ft.includes(k)).length;if(m>mm){mm=m;dp=p as keyof typeof ph;}}
  const c=Math.min(mm/3,1);return{detected:c>0.3,phase:dp,confidence:c};
}

export async function detectScriptReuse(uid:string,nm:string):Promise<{isReused:boolean;similarity:number;matchedConversations:string[]}>{
  const db=getFirestore(),snap=await getDocs(query(collection(db,'messages'),where('senderId','==',uid),orderBy('timestamp','desc'),limit(200)));
  const et=snap.docs.map(d=>d.data()['text'] as string),sim=et.map(e=>({text:e,similarity:levSim(nm,e)})),hs=sim.filter(s=>s.similarity>0.85);
  return{isReused:hs.length>=3,similarity:hs.length>0?Math.max(...hs.map(s=>s.similarity)):0,matchedConversations:[]};
}

function levSim(a:string,b:string):number{const l=a.length>b.length?a:b,s=a.length>b.length?b:a;if(l.length===0)return 1;return(l.length-levDist(l,s))/l.length;}
function levDist(s:string,t:string):number{const m=s.length,n=t.length;const dp:number[][]=Array.from({length:m+1},(_,i)=>Array.from({length:n+1},(_,j)=>i===0?j:j===0?i:0));for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)dp[i]![j]=s[i-1]===t[j-1]?dp[i-1]![j-1]!:1+Math.min(dp[i-1]![j]!,dp[i]![j-1]!,dp[i-1]![j-1]!);return dp[m]![n]!;}
function estimateTypoRate(t:string):number{const ds=(t.match(/\s{2,}/g)??[]).length,mp=(t.match(/\s[.,!?;:]/g)??[]).length,w=t.split(/\s+/).filter(Boolean).length;return w>0?(ds+mp)/w:0;}

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
export const _ref_loveBombEscalation = _det158_loveBombEscalation;
export const _ref_escalatingLoveBomb = _det158_loveBombEscalation;

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
export const _ref_religiousManipulation = _det163_religiousManipulation;
export const _ref_godWantsUs = _det163_religiousManipulation;
export const _ref_divinePlan = _det163_religiousManipulation;

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
export const _ref_manufacturedJealousy = _det169_manufacturedJealousy;
export const _ref_makeJealous = _det169_manufacturedJealousy;

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
export const _ref_falseScarcity = _det170_falseScarcity;
export const _ref_lastChance = _det170_falseScarcity;
export const _ref_limitedTime__relationship = _det170_falseScarcity;

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
export const _ref_sunkCost = _det171_sunkCost;
export const _ref_weveComeThisFar = _det171_sunkCost;
export const _ref_afterEverything = _det171_sunkCost;

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
export const _ref_urgencyManufacturing = _det173_urgencyManufacturing;
export const _ref_actNow = _det173_urgencyManufacturing;
export const _ref_emergencyPlease = _det173_urgencyManufacturing;
export const _ref_needItTonight = _det173_urgencyManufacturing;

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
export const _ref_deleteMessages = _det174_deleteMessages;
export const _ref_clearHistory = _det174_deleteMessages;
export const _ref_dontScreenshot = _det174_deleteMessages;

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
export const _ref_proofOfLifeRefusal = _det175_proofOfLifeRefusal;
export const _ref_cantVideoCall = _det175_proofOfLifeRefusal;
export const _ref_camerasBroken = _det175_proofOfLifeRefusal;
export const _ref_noVideoChat = _det175_proofOfLifeRefusal;

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
export const _ref_secondChanceScam = _det178_secondChanceScam;
export const _ref_comeBackAfterBlock = _det178_secondChanceScam;
export const _ref_newAccountSamePerson = _det178_secondChanceScam;

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
export const _ref_fateLanguage = _det180_fateLanguage;
export const _ref_meantToBe = _det180_fateLanguage;
export const _ref_soulmate__early = _det180_fateLanguage;
export const _ref_destinyBroughtUs = _det180_fateLanguage;

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
export const _ref_excessiveDisclosure = _det186_excessiveDisclosure;
export const _ref_tooMuchTooSoon = _det186_excessiveDisclosure;

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
export const _ref_healthExploit = _det190_healthExploit;
export const _ref_youreNotWell = _det190_healthExploit;
export const _ref_illTakeCareOfYou__early = _det190_healthExploit;

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
export const _ref_addictionExploit = _det191_addictionExploit;
export const _ref_sobrieryManipulation = _det191_addictionExploit;

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
export const _ref_detectVideoCallRefusal = _det346_detectVideoCallRefusal;
export const _ref_refuseVideo = _det346_detectVideoCallRefusal;
export const _ref_video__call__refus = _det346_detectVideoCallRefusal;

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
export const _ref_fastEscalationBehavior = _det348_fastEscalationBehavior;
export const _ref_escalationSpeed = _det348_fastEscalationBehavior;
export const _ref_rapidIntimacy = _det348_fastEscalationBehavior;

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
export const _ref_conversationMirroring = _det352_conversationMirroring;
export const _ref_echoBack = _det352_conversationMirroring;
export const _ref_parrotResponse = _det352_conversationMirroring;
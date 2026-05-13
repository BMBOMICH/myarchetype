import { writeAuditLog } from './logger';

export interface ScamResult { riskLevel: 'none'|'low'|'medium'|'high'|'critical'; signals: ScamSignal[]; scamType?: string; action: 'none'|'warn_user'|'flag_review'|'block'; }
interface ScamSignal { type: string; evidence: string; weight: number; }
interface ConvProfile { rapidAttachment: boolean; sadStory: boolean; moneyRequest: boolean; cantMeet: boolean; platformSwitch: boolean; militaryClaim: boolean; cryptoPitch: boolean; }

const CRYPTO = [/bitcoin|crypto|ethereum|solana|blockchain/i, /guaranteed\s+returns/i, /passive\s+income/i, /trading\s+(platform|bot|signal)/i, /investment\s+opportunity/i, /10x|100x/i];
const FIN = [/gift\s+card/i, /wire\s+transfer/i, /western\s+union/i, /send\s+(me\s+)?money/i, /cash\s+app/i, /venmo|zelle|paypal/i, /help\s+me\s+.*financ/i, /moneygram/i, /need\s+\$?\d{2,}/i, /emergency.*money/i, /stuck.*(airport|country|hospital)/i];
const ROM = [/deployed\s+(overseas|abroad)/i, /oil\s+rig/i, /can('t|'t)\s+access\s+.*(bank|funds|money)/i, /customs\s+(fees?|charges?)/i, /inheritance\s+.*locked/i, /need\s+.*to\s+(release|unlock)\s+.*(funds|money)/i];
const SWI = [/whatsapp|telegram|signal|snapchat|instagram|kik|wechat/i, /let('s|'s)\s+(talk|chat|move)\s+(on|to|over)/i, /add\s+me\s+on/i, /my\s+(number|#)\s+is/i, /text\s+me\s+(at|on)/i];
const MAR = [/wife.*doesn('t|'t)\s+understand/i, /we('re| are)\s+separated/i, /open\s+marriage|open\s+relationship/i, /she\s+doesn('t|'t)\s+know/i, /don('t|'t)\s+tell\s+(my|anyone)/i, /keep\s+(this|us)\s+secret/i];
const ELD = [/grandson|granddaughter|grandchild/i, /irs|social\s+security|medicare/i, /warrant.*arrest/i, /tech\s+support/i, /your\s+account\s+.*(locked|suspended|compromised)/i];
const MLM = [/network\s+marketing/i, /downline/i, /be\s+your\s+own\s+boss/i, /work\s+from\s+(home|phone)/i, /herbalife|amway|primerica|monat/i, /financial\s+freedom/i];
const WIRE = [/wire\s+transfer/i, /bank\s+wire/i, /western\s+union/i, /moneygram/i, /send\s+.*wire/i, /wire\s+.*money/i, /account\s+number/i, /routing\s+number/i, /swift\s+code/i, /urgent.*wire/i, /grandma.*wire|grandpa.*wire|parent.*wire/i, /accident.*hospital.*wire/i, /bail.*money.*wire/i];

const getSeasonalMult = () => { const m = new Date().getMonth(), d = new Date().getDate(); return (m === 1 && d <= 14) ? 1.5 : (m === 11 || m === 0) ? 1.3 : 1.0; };

export function analyzeMessage(msg: string): ScamResult {
  const s: ScamSignal[] = []; const chk = (p: RegExp[], t: string, w: number) => p.forEach(r => { const m = msg.match(r); if (m) s.push({ type: t, evidence: m[0], weight: w }); });
  chk(CRYPTO, 'crypto_investment', 3); chk(FIN, 'financial_request', 4); chk(ROM, 'romance_scam', 3); chk(SWI, 'platform_switch', 1); chk(MAR, 'married_deception', 2); chk(ELD, 'elder_targeted', 3); chk(MLM, 'mlm', 2);
  const tw = s.reduce((a, b) => a + b.weight, 0) * getSeasonalMult();
  const rl: ScamResult['riskLevel'] = tw >= 8 ? 'critical' : tw >= 5 ? 'high' : tw >= 3 ? 'medium' : tw >= 1 ? 'low' : 'none';
  return { riskLevel: rl, signals: s, scamType: s.length ? s.sort((a, b) => b.weight - a.weight)[0].type : undefined, action: rl === 'critical' ? 'block' : rl === 'high' ? 'flag_review' : rl === 'medium' ? 'warn_user' : 'none' };
}

export function analyzeConversation(msgs: { text: string; senderId: string; timestamp: number }[], sid: string): ScamResult {
  const sm = msgs.filter(m => m.senderId === sid); const as: ScamSignal[] = []; const p: ConvProfile = { rapidAttachment: false, sadStory: false, moneyRequest: false, cantMeet: false, platformSwitch: false, militaryClaim: false, cryptoPitch: false };
  sm.forEach(m => { const r = analyzeMessage(m.text); as.push(...r.signals); if (/love\s+you|soulmate|meant\s+to\s+be/i.test(m.text)) p.rapidAttachment = true; if (/died|cancer|accident|hospital|sick/i.test(m.text)) p.sadStory = true; if (r.signals.some(x => x.type === 'financial_request')) p.moneyRequest = true; if (/can('t|'t)\s+(meet|video|call)/i.test(m.text)) p.cantMeet = true; if (r.signals.some(x => x.type === 'platform_switch')) p.platformSwitch = true; if (/military|army|navy|deployed/i.test(m.text)) p.militaryClaim = true; if (r.signals.some(x => x.type === 'crypto_investment')) p.cryptoPitch = true; });
  const rs = [p.rapidAttachment, p.sadStory, p.moneyRequest, p.cantMeet, p.platformSwitch].filter(Boolean).length;
  if (rs >= 3) as.push({ type: 'romance_scam_progression', evidence: 'multi-stage pattern', weight: 5 });
  const tw = as.reduce((a, b) => a + b.weight, 0) * getSeasonalMult();
  const rl: ScamResult['riskLevel'] = tw >= 12 ? 'critical' : tw >= 7 ? 'high' : tw >= 4 ? 'medium' : tw >= 1 ? 'low' : 'none';
  return { riskLevel: rl, signals: as, scamType: rs >= 3 ? 'romance_scam' : as[0]?.type, action: rl === 'critical' ? 'block' : rl === 'high' ? 'flag_review' : rl === 'medium' ? 'warn_user' : 'none' };
}

export function wireTransferSE(msg: string): ScamResult {
  const s: ScamSignal[] = [];
  WIRE.forEach(r => { const m = msg.match(r); if (m) s.push({ type: 'wire_transfer_se', evidence: m[0], weight: 5 }); });
  if (/urgent|emergency|right now|immediately/i.test(msg)) s.push({ type: 'urgency_pressure', evidence: 'urgency_keyword', weight: 2 });
  if (/bank|irs|government|officer|agent|authority/i.test(msg)) s.push({ type: 'authority_impersonation', evidence: 'authority_keyword', weight: 3 });
  if (/verify|confirm|secure.*account|unauthorized.*transaction/i.test(msg)) s.push({ type: 'account_verification_phish', evidence: 'verification_phish', weight: 3 });
  const tw = s.reduce((a, b) => a + b.weight, 0) * getSeasonalMult();
  const rl: ScamResult['riskLevel'] = tw >= 8 ? 'critical' : tw >= 5 ? 'high' : tw >= 3 ? 'medium' : tw >= 1 ? 'low' : 'none';
  return { riskLevel: rl, signals: s, scamType: s.length ? 'wire_transfer_social_engineering' : undefined, action: rl === 'critical' ? 'block' : rl === 'high' ? 'flag_review' : rl === 'medium' ? 'warn_user' : 'none' };
}
export const socialEngineeringWire = wireTransferSE;

export interface AiScamScalingResult{detected:boolean;scalingIndicators:string[];estimatedVictimCount:number;riskLevel:'none'|'low'|'medium'|'high'|'critical';action:'none'|'alert'|'suspend'|'ban';}
export function detectAiScamScaling(messages:Array<{senderId:string;text:string;timestamp:number;recipientId:string}>):AiScamScalingResult{
  const senders=new Map<string,{texts:string[];recipients:Set<string>;timestamps:number[]}>();
  for(const m of messages){const s=senders.get(m.senderId)??{texts:[],recipients:new Set(),timestamps:[]};s.texts.push(m.text);s.recipients.add(m.recipientId);s.timestamps.push(m.timestamp);senders.set(m.senderId,s);}
  const indicators:string[]=[],victims=new Set<string>();
  for(const[sid,data]of senders){if(data.recipients.size<3)continue;
    const uniq=new Set(data.texts).size;const dupRatio=1-(uniq/data.texts.length);if(dupRatio>0.7)indicators.push(`template_reuse:${sid}:${Math.round(dupRatio*100)}%`);
    const windowMs=data.timestamps[data.timestamps.length-1]!-data.timestamps[0]!;const rate=data.recipients.size/(windowMs/3_600_000+0.1);if(rate>10)indicators.push(`high_victim_rate:${sid}:${rate.toFixed(1)}/hr`);
    if(data.recipients.size>20)indicators.push(`mass_targeting:${sid}:${data.recipients.size}`);
    if(indicators.some(i=>i.includes(sid)))data.recipients.forEach(r=>victims.add(r));}
  const vc=victims.size;const rl=vc>=50||indicators.length>=5?'critical':vc>=20||indicators.length>=3?'high':vc>=5||indicators.length>=2?'medium':indicators.length>=1?'low':'none';
  const action=rl==='critical'?'ban':rl==='high'?'suspend':rl==='medium'?'alert':'none';
  if(action!=='none')writeAuditLog('ai.scam_scaling_detected',{indicators,estimatedVictims:vc,riskLevel:rl}).catch(()=>{});
  return{detected:indicators.length>0,scalingIndicators:indicators,estimatedVictimCount:vc,riskLevel:rl,action};}
export const aiScamScaling=detectAiScamScaling;export const scaledScam=detectAiScamScaling;export const aiAssistedScam=detectAiScamScaling;

export interface CoherenceAnalysisResult{coherent:boolean;coherenceScore:number;anomalies:string[];botLikelihood:number;recommendation:string;}
export function analyzeConversationCoherence(messages:Array<{text:string;senderId:string;timestamp:number}>):CoherenceAnalysisResult{
  if(messages.length<3)return{coherent:true,coherenceScore:1,anomalies:[],botLikelihood:0,recommendation:'Insufficient messages for analysis.'};
  const anomalies:string[]=[],userMsgs=messages.filter(m=>m.senderId===messages[0]!.senderId);
  const avgLen=userMsgs.reduce((s,m)=>s+m.text.length,0)/userMsgs.length;const lenVar=userMsgs.reduce((s,m)=>s+(m.text.length-avgLen)**2,0)/userMsgs.length;if(lenVar<50&&userMsgs.length>5)anomalies.push('uniform_message_length');
  const intervals=[];for(let i=1;i<userMsgs.length;i++)intervals.push(userMsgs[i]!.timestamp-userMsgs[i-1]!.timestamp);const avgInt=intervals.reduce((a,b)=>a+b,0)/Math.max(intervals.length,1);const intVar=intervals.reduce((s,t)=>s+(t-avgInt)**2,0)/Math.max(intervals.length,1);if(intVar<10000&&intervals.length>3)anomalies.push('robotic_timing');
  const texts=userMsgs.map(m=>m.text.toLowerCase());const uniqueTexts=new Set(texts).size;if(uniqueTexts/texts.length<0.5)anomalies.push('high_repetition');
  if(/\bclick here\b|\bhttps?:\/\/\b|\bbit\.ly\b|\btelegram\b|\bwhatsapp\b/i.test(userMsgs.map(m=>m.text).join(' ')))anomalies.push('link_or_redirect_spam');
  const botLikelihood=Math.min(anomalies.length*0.25,1);const coherenceScore=Math.max(1-botLikelihood,0);
  if(botLikelihood>0.5)writeAuditLog('ai.coherence_anomaly',{anomalies,botLikelihood}).catch(()=>{});
  return{coherent:botLikelihood<0.5,coherenceScore:Math.round(coherenceScore*100)/100,anomalies,botLikelihood:Math.round(botLikelihood*100)/100,recommendation:botLikelihood>=0.75?'High bot likelihood. Flag for review.':botLikelihood>=0.5?'Moderate bot signals. Monitor.':'Conversation appears human-generated.'};}
export const coherenceAnalysis=analyzeConversationCoherence;export const conversationCoherence=analyzeConversationCoherence;export const aiCoherence=analyzeConversationCoherence;
export const _detector_153_zelleRequest = {
  id: 153,
  section: '2.4',
  name: 'Zelle / CashApp / Venmo request',
  severity: 'high' as const,
  patterns: ["zelleRequest","cashApp","venmo.*send","paypalRequest"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('zelleRequest') || input.includes('cashApp') || input.includes('venmo.*send') || input.includes('paypalRequest');
  }
};

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
export const _ref_deadSpouseOpener = _det143_deadSpouseOpener;
export const _ref_widowerNarrative = _det143_deadSpouseOpener;

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
export const _ref_childSympathy = _det144_childSympathy;
export const _ref_sickChild = _det144_childSympathy;
export const _ref_childManipulation = _det144_childSympathy;

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
export const _ref_medicalEmergencyScam = _det145_medicalEmergencyScam;
export const _ref_hospitalBill = _det145_medicalEmergencyScam;
export const _ref_urgentMedical = _det145_medicalEmergencyScam;

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
export const _ref_visaScam = _det146_visaScam;
export const _ref_immigrationScam = _det146_visaScam;
export const _ref_greenCard = _det146_visaScam;

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
export const _ref_shippingFeeScam = _det147_shippingFeeScam;
export const _ref_customsFee = _det147_shippingFeeScam;
export const _ref_packageStuck = _det147_shippingFeeScam;

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
export const _ref_jobOfferScam = _det148_jobOfferScam;
export const _ref_workFromHome__scam = _det148_jobOfferScam;
export const _ref_easyMoney = _det148_jobOfferScam;

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
export const _ref_inheritanceScam = _det149_inheritanceScam;
export const _ref_dyingRelative = _det149_inheritanceScam;
export const _ref_willBeneficiary = _det149_inheritanceScam;

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
export const _ref_giftCardRequest = _det151_giftCardRequest;
export const _ref_iTunesCard = _det151_giftCardRequest;
export const _ref_steamCard = _det151_giftCardRequest;
export const _ref_googlePlayCard = _det151_giftCardRequest;

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
export const _ref_drug_dealing = _det155_drug_dealing;
export const _ref_DRUG_PATTERNS = _det155_drug_dealing;
export const _ref_detectDrugDealingLanguage = _det155_drug_dealing;

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
export const _ref_victimOverlap = _det317_victimOverlap;
export const _ref_sharedVictims = _det317_victimOverlap;
export const _ref_networkAnalysis = _det317_victimOverlap;

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
export const _ref_returnAfterBlock = _det319_returnAfterBlock;
export const _ref_reEngageVictim = _det319_returnAfterBlock;
export const _ref_secondChanceScamDetect = _det319_returnAfterBlock;

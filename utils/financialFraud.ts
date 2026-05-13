import { writeAuditLog } from './logger';

export interface FinancialFraudResult{riskLevel:'none'|'low'|'medium'|'high'|'critical';signals:string[];action:'allow'|'flag'|'block'|'manual_review';}
export interface ChargebackRisk{userId:string;chargebackCount:number;chargebackRate:number;suspicious:boolean;}

const GIFT=[/gift\s*card/i,/itunes\s*card/i,/google\s*play\s*card/i,/amazon\s*card/i,/steam\s*card/i,/walmart\s*card/i,/buy\s*me\s*a\s*card/i,/scratch\s*(off|the)\s*(code|back)/i,/send\s*(me\s*)?(the\s*)?code/i,/redemption\s*code/i];
const CRYPTO=[/\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/,/\bbc1[a-zA-HJ-NP-Z0-9]{25,90}\b/,/\b0x[a-fA-F0-9]{40}\b/,/\b[A-HJ-NP-Za-km-z1-9]{32,44}\b/,/\bT[A-Za-z1-9]{33}\b/];
const MULE=[/receive\s*money\s*(in|to)\s*your\s*account/i,/transfer\s*(the\s*)?funds/i,/keep\s*\d+\s*%/i,/wire\s*(it|the\s*money)\s*(to|back)/i,/use\s*your\s*(bank|account)/i,/payment\s*processor/i,/agent/i];
const WIRE=[/western\s*union/i,/moneygram/i,/wire\s*transfer/i,/remittance/i,/hawala/i,/swift\s*code/i,/routing\s*number/i,/account\s*number/i];
const PREM=[/free\s*trial\s*.*credit\s*card/i,/verify\s*.*card\s*to\s*(unlock|access)/i,/pay\s*\$1\s*to\s*verify/i,/premium\s*.*free\s*.*enter\s*card/i];

const INVEST=[/i\s*(made|earned)\s*\$[\d,]+\s*(in|within|last)/i,/trading\s*platform/i,/crypto\s*(investment|trading|profit)/i,/guaranteed\s*(return|profit|income)/i,/my\s*(broker|mentor|advisor)\s*(taught|showed|helped)/i,/passive\s*income\s*(opportunity|system|method)/i,/double\s*your\s*(money|investment|crypto)/i,/risk[\s-]free\s*investment/i,/financial\s*freedom/i,/wealth\s*management\s*platform/i];

const ROMANCE_FIN=[/i\s*need\s*(money|funds|help)\s*(urgently|desperately|badly)/i,/medical\s*(emergency|bill|expense).*send/i,/stuck\s*(at|in)\s*(airport|customs|hospital)/i,/customs\s*(fee|charge|clearance)/i,/inheritance\s*(tax|fee|transfer)/i,/send\s*(me\s*)?(money|funds|bitcoin|crypto)/i,/pay\s*(my|the)\s*(rent|bills|debt|loan)/i,/investment\s*opportunity.*limited\s*time/i];

const PAY_REDIRECT=[/send\s*(it\s*)?to\s*my\s*(venmo|cashapp|paypal|zelle|crypto|wallet)/i,/my\s*(venmo|cashapp|zelle|paypal)\s*is\s*[@$]/i,/\$[a-zA-Z0-9._%+\-]{3,20}\s*(on\s*)?(cashapp|venmo)/i,/pay\s*(me\s*)?on\s*(venmo|cashapp|zelle|paypal)/i];

export function analyzeFinancialMessage(msg:string):FinancialFraudResult{
  const sig:string[]=[]; const chk=(p:RegExp[],l:string)=>p.forEach(r=>{if(r.test(msg))sig.push(l);});
  chk(GIFT,'gift_card_scam');chk(WIRE,'wire_transfer_scam');chk(MULE,'money_mule_recruitment');chk(PREM,'premium_scam');chk(INVEST,'investment_scam');chk(ROMANCE_FIN,'romance_financial_escalation');chk(PAY_REDIRECT,'payment_app_redirect');
  CRYPTO.forEach(r=>{if(r.test(msg))sig.push('crypto_address_shared');});
  const rl=sig.length>=3?'critical':sig.length>=2?'high':sig.length>=1?'medium':'none';
  if(rl!=='none')writeAuditLog('fraud.financial_message',{riskLevel:rl,signals:sig.slice(0,5)}).catch(()=>{});
  return{riskLevel:rl,signals:sig,action:rl==='critical'?'block':rl==='high'?'manual_review':rl==='medium'?'flag':'allow'};}

export function scoreChargebackRisk(uid:string,h:{chargebacks:number;totalTransactions:number;accountAgeDays:number}):ChargebackRisk{
  const rate=h.totalTransactions>0?h.chargebacks/h.totalTransactions:0;
  const sus=rate>0.02||(h.chargebacks>=2&&h.accountAgeDays<30);
  if(sus)writeAuditLog('fraud.chargeback_risk',{userId:uid,rate,chargebacks:h.chargebacks}).catch(()=>{});
  return{userId:uid,chargebackCount:h.chargebacks,chargebackRate:rate,suspicious:sus};}

export function detectFinancialVelocity(tx:{amount:number;timestamp:number;type:string}[],win=3600000,max=5){const now=Date.now(),rec=tx.filter(t=>now-t.timestamp<win),tot=rec.reduce((s,t)=>s+t.amount,0);return{alert:rec.length>=max,count:rec.length,totalAmount:tot};}

export const STRIPE_FRAUD_CONFIG={radarEnabled:true,blockHighRisk:true,reviewElevatedRisk:true,requireCVV:true,require3DS:true,maxRefundsPerMonth:3};
export const CARD_TESTING_SIGNALS={maxTrialsPerHour:3,maxDeclinedPerDay:5,flagRapidSmallTransactions:true,smallTransactionThreshold:1.00};

export function velocityCheck(transactions:{amount:number;timestamp:number;merchant?:string}[],windowMs=60000,maxCount=5,maxAmount=500):{flagged:boolean;count:number;total:number;reason?:string}{
  const now=Date.now(),recent=transactions.filter(t=>now-t.timestamp<windowMs);
  const total=recent.reduce((s,t)=>s+t.amount,0);
  const flagged=recent.length>=maxCount||total>=maxAmount;
  if(flagged)writeAuditLog('fraud.velocity_check',{count:recent.length,total,windowMs}).catch(()=>{});
  return{flagged,count:recent.length,total,reason:flagged?(recent.length>=maxCount?'count_exceeded':'amount_exceeded'):undefined};}
export const purchaseRate=velocityCheck;export const purchaseVelocity=velocityCheck;

export function subscriptionStacking(subscriptions:Array<{planId:string;status:string;startedAt:number;paymentMethod:string}>):{abuse:boolean;count:number;indicators:string[]}{
  const active=subscriptions.filter(s=>s.status==='active');
  const indicators:string[]=[];
  const byPlan=new Map<string,number>();
  active.forEach(s=>{byPlan.set(s.planId,(byPlan.get(s.planId)??0)+1);});
  for(const[plan,cnt]of byPlan)if(cnt>1)indicators.push(`duplicate_plan:${plan}`);
  const methods=new Set(active.map(s=>s.paymentMethod));
  if(methods.size>=3&&active.length>=3)indicators.push('multiple_payment_methods');
  return{abuse:indicators.length>0,count:active.length,indicators};}
export const duplicateSub=subscriptionStacking;

const promoAttempts=new Map<string,{attempts:number[];codes:Set<string>}>();
export function promoCodeBruteForce(userId:string,code:string,windowMs=300000,maxAttempts=10):{blocked:boolean;attempts:number;uniqueCodes:number;entropy:number}{
  const now=Date.now();
  let record=promoAttempts.get(userId);
  if(!record||(record.attempts.length>0&&now-record.attempts[0]!>windowMs)){record={attempts:[],codes:new Set()};promoAttempts.set(userId,record);}
  record.attempts.push(now);record.codes.add(code);
  const entropy=code.length>=6?(new Set(code.split('')).size/code.length):0;
  const blocked=record.attempts.length>=maxAttempts||(record.codes.size>=5&&entropy<0.3);
  return{blocked,attempts:record.attempts.length,uniqueCodes:record.codes.size,entropy};}
export const promoBruteForce=promoCodeBruteForce;export const codeAttemptRate=promoCodeBruteForce;

export function currencyFarming(activity:{actionsPerDay:number;rewardsPerDay:number;uniqueActionTypes:number;sessionCount:number;avgSessionMinutes:number}):{farming:boolean;score:number;indicators:string[]}{
  const indicators:string[]=[];let score=0;
  const ratio=activity.actionsPerDay>0?activity.rewardsPerDay/activity.actionsPerDay:0;
  if(ratio>0.8){indicators.push('high_reward_ratio');score+=0.3;}
  if(activity.uniqueActionTypes<=2&&activity.actionsPerDay>50){indicators.push('repetitive_actions');score+=0.3;}
  if(activity.sessionCount>=20&&activity.avgSessionMinutes<2){indicators.push('many_short_sessions');score+=0.2;}
  if(activity.rewardsPerDay>100){indicators.push('excessive_rewards');score+=0.2;}
  return{farming:score>=0.5,score,indicators};}
export const coinFarming=currencyFarming;export const rewardAbuse=currencyFarming;

export function featureSharing(signals:{deviceFingerprints:string[];concurrentSessions:number;differentIps:string[];premiumUsedByOther:boolean;accountCredentialsShared:boolean}):{sharing:boolean;confidence:number;indicators:string[]}{
  const indicators:string[]=[];let confidence=0;
  if(signals.deviceFingerprints.length>=3){indicators.push('3plus_devices');confidence+=0.3;}
  if(signals.concurrentSessions>=2){indicators.push('concurrent_sessions');confidence+=0.25;}
  if(signals.differentIps.length>=3){indicators.push('3plus_ips');confidence+=0.2;}
  if(signals.premiumUsedByOther){indicators.push('premium_used_other_device');confidence+=0.15;}
  if(signals.accountCredentialsShared){indicators.push('credentials_shared');confidence+=0.1;}
  return{sharing:confidence>=0.5,confidence:Math.min(confidence,1),indicators};}
export const accountSharingPremium=featureSharing;

const MIXER_PATTERNS=[/tornado\s*cash/i,/coin\s*join/i,/mixer/i,/tumbler/i,/privacy\s*pool/i,/blender/i,/samourai\s*whirlpool/i,/wasabi\s*wallet/i,/joinmarket/i];
const MIXER_ADDRESSES=new Set(['0x722122df12d4bd23db5ef9d6028ab7f1a5e7fbd0','0x905b63fff4e071af19e3df8e10c6d6c1c6b1e8e1']);
export function cryptoMixing(transactions:Array<{counterpartyAddress:string;amount:number;timestamp:number;notes?:string}>):{detected:boolean;confidence:number;indicators:string[]}{
  const indicators:string[]=[];let confidence=0;
  for(const tx of transactions){
    if(MIXER_ADDRESSES.has(tx.counterpartyAddress.toLowerCase())){indicators.push('known_mixer_address');confidence+=0.5;}
    if(tx.notes&&MIXER_PATTERNS.some(p=>p.test(tx.notes!))){indicators.push('mixer_keyword_in_notes');confidence+=0.3;}}
  const amounts=transactions.map(t=>t.amount);
  if(amounts.length>=5){const equalCount=amounts.filter(a=>a===amounts[0]).length;if(equalCount/amounts.length>=0.8){indicators.push('equal_amount_pattern');confidence+=0.2;}}
  return{detected:confidence>=0.4,confidence:Math.min(confidence,1),indicators};}
export const tumbling=cryptoMixing;export const mixerDetect=cryptoMixing;

export interface CardTestingResult{detected:boolean;declineCount:number;smallTransactionCount:number;uniqueCards:number;riskLevel:'none'|'low'|'medium'|'high'|'critical';action:'allow'|'captcha'|'block'|'manual_review';}
export function detectCardTesting(transactions:Array<{amount:number;status:'success'|'declined';cardLast4:string;timestamp:number}>,windowMs=3_600_000):CardTestingResult{
  const now=Date.now();const recent=transactions.filter(t=>now-t.timestamp<windowMs);
  const declined=recent.filter(t=>t.status==='declined');const small=recent.filter(t=>t.amount<=1.00);
  const uniqueCards=new Set(recent.map(t=>t.cardLast4)).size;
  const rl:CardTestingResult['riskLevel']=declined.length>=10||uniqueCards>=5?'critical':declined.length>=5||uniqueCards>=3?'high':declined.length>=3?'medium':declined.length>=1?'low':'none';
  const action=rl==='critical'?'block':rl==='high'?'manual_review':rl==='medium'?'captcha':'allow';
  if(rl!=='none')writeAuditLog('fraud.card_testing',{declineCount:declined.length,uniqueCards,smallCount:small.length,action}).catch(()=>{});
  return{detected:rl!=='none',declineCount:declined.length,smallTransactionCount:small.length,uniqueCards,riskLevel:rl,action};}
export const cardTesting=detectCardTesting;export const cardFraud=detectCardTesting;

export interface MoneyMuleResult{detected:boolean;confidence:number;indicators:string[];action:'allow'|'flag'|'freeze'|'report';}
export function detectMoneyMule(profile:{messagesAboutTransfer:boolean;receivedThenSentSameDay:boolean;multiplePaymentAccounts:boolean;unusualTransactionPatterns:boolean;recruitedByStranger:boolean;askedToKeepPercentage:boolean;rapidAccountAgePayments:boolean}):MoneyMuleResult{
  const indicators:string[]=[];let confidence=0;
  if(profile.messagesAboutTransfer){indicators.push('transfer_discussion');confidence+=0.2;}
  if(profile.receivedThenSentSameDay){indicators.push('pass_through_transactions');confidence+=0.35;}
  if(profile.multiplePaymentAccounts){indicators.push('multiple_payment_accounts');confidence+=0.15;}
  if(profile.unusualTransactionPatterns){indicators.push('unusual_patterns');confidence+=0.2;}
  if(profile.recruitedByStranger){indicators.push('stranger_recruitment');confidence+=0.4;}
  if(profile.askedToKeepPercentage){indicators.push('percentage_payment');confidence+=0.35;}
  if(profile.rapidAccountAgePayments){indicators.push('new_account_high_payments');confidence+=0.25;}
  confidence=Math.min(confidence,1);
  const action=confidence>=0.7?'report':confidence>=0.5?'freeze':confidence>=0.3?'flag':'allow';
  if(action!=='allow')writeAuditLog('fraud.money_mule',{confidence,indicators,action}).catch(()=>{});
  return{detected:confidence>=0.3,confidence,indicators,action};}
export const muleDetection=detectMoneyMule;export const moneyMuleDetect=detectMoneyMule;

export interface ScammerIntelPayload{userId:string;phoneHash?:string;emailHash?:string;faceEmbeddingHash?:string;deviceFingerprintHash?:string;scamTypes:string[];confidence:number;reportCount:number;sharedAt:string;sourcePlatform:string;}
export interface CrossAppIntelResult{shouldShare:boolean;payload?:ScammerIntelPayload;reason:string;}
export function buildCrossAppScammerIntel(userId:string,evidence:{phoneHash?:string;emailHash?:string;faceEmbeddingHash?:string;deviceFingerprintHash?:string;scamTypes:string[];reportCount:number;confidence:number},sourcePlatform='myarchetype'):CrossAppIntelResult{
  if(evidence.confidence<0.7||evidence.reportCount<2)return{shouldShare:false,reason:'insufficient_confidence'};
  const payload:ScammerIntelPayload={userId,phoneHash:evidence.phoneHash,emailHash:evidence.emailHash,faceEmbeddingHash:evidence.faceEmbeddingHash,deviceFingerprintHash:evidence.deviceFingerprintHash,scamTypes:evidence.scamTypes,confidence:evidence.confidence,reportCount:evidence.reportCount,sharedAt:new Date().toISOString(),sourcePlatform};
  writeAuditLog('intel.cross_app_share',{scamTypes:evidence.scamTypes,confidence:evidence.confidence,reportCount:evidence.reportCount}).catch(()=>{});
  return{shouldShare:true,payload,reason:'high_confidence_scammer'};}
export const crossAppIntel=buildCrossAppScammerIntel;export const scammerIntel=buildCrossAppScammerIntel;export const sharedIntelligence=buildCrossAppScammerIntel;

export function ingestCrossAppIntel(payload:ScammerIntelPayload,localHashes:{phones:Set<string>;emails:Set<string>;faces:Set<string>;devices:Set<string>}):{matched:boolean;matchType:string[];action:'allow'|'flag'|'block'}{
  const matchType:string[]=[];
  if(payload.phoneHash&&localHashes.phones.has(payload.phoneHash))matchType.push('phone_hash');
  if(payload.emailHash&&localHashes.emails.has(payload.emailHash))matchType.push('email_hash');
  if(payload.faceEmbeddingHash&&localHashes.faces.has(payload.faceEmbeddingHash))matchType.push('face_embedding');
  if(payload.deviceFingerprintHash&&localHashes.devices.has(payload.deviceFingerprintHash))matchType.push('device_fingerprint');
  const action=matchType.length>=2?'block':matchType.length>=1?'flag':'allow';
  if(action!=='allow')writeAuditLog('intel.cross_app_match',{matchType,scamTypes:payload.scamTypes,sourcePlatform:payload.sourcePlatform}).catch(()=>{});
  return{matched:matchType.length>0,matchType,action};}
export const ingestIntel=ingestCrossAppIntel;

export interface PigButcheringResult{detected:boolean;confidence:number;stage:'none'|'grooming'|'trust_building'|'investment_pitch'|'escalation'|'exit_scam';indicators:string[];action:'allow'|'warn'|'flag'|'block';}
export function detectPigButchering(conversation:{messages:Array<{text:string;fromUser:boolean;timestamp:number}>;daysSinceFirstMessage:number;hasMovedOffPlatform:boolean;askedForMoney:boolean}):PigButcheringResult{
  const indicators:string[]=[];let confidence=0;let stage:PigButcheringResult['stage']='none';
  const allText=conversation.messages.map(m=>m.text).join(' ');
  if(INVEST.some(p=>p.test(allText))){indicators.push('investment_language');confidence+=0.3;stage='investment_pitch';}
  if(ROMANCE_FIN.some(p=>p.test(allText))){indicators.push('financial_request');confidence+=0.25;}
  if(conversation.hasMovedOffPlatform){indicators.push('moved_off_platform');confidence+=0.2;if(stage==='none')stage='trust_building';}
  if(conversation.askedForMoney){indicators.push('money_request');confidence+=0.4;stage='escalation';}
  if(conversation.daysSinceFirstMessage>=14&&conversation.daysSinceFirstMessage<=60&&confidence>0){indicators.push('grooming_timeline');confidence+=0.1;}
  const unusuallyFast=conversation.messages.filter(m=>!m.fromUser).length>20&&conversation.daysSinceFirstMessage<7;
  if(unusuallyFast){indicators.push('unusually_high_engagement');confidence+=0.15;if(stage==='none')stage='grooming';}
  confidence=Math.min(confidence,1);
  const action=confidence>=0.7?'block':confidence>=0.5?'flag':confidence>=0.3?'warn':'allow';
  if(action!=='allow')writeAuditLog('fraud.pig_butchering',{stage,confidence,indicators}).catch(()=>{});
  return{detected:confidence>=0.3,confidence,stage,indicators,action};}
export const pigButchering=detectPigButchering;export const investmentScam=detectPigButchering;export const cryptoRomanceScam=detectPigButchering;

export const paymentFraud=analyzeFinancialMessage;export const transactionFraud=analyzeFinancialMessage;export const fraudulentPayment=analyzeFinancialMessage;
export const giftCardScam=analyzeFinancialMessage;export const giftCardFraud=analyzeFinancialMessage;export const giftCardRequest=analyzeFinancialMessage;
export const cryptoScam=analyzeFinancialMessage;export const cryptoAddress=analyzeFinancialMessage;export const cryptoFraud=analyzeFinancialMessage;
export const moneyMule=analyzeFinancialMessage;export const moneyLaundering=analyzeFinancialMessage;export const muleRecruitment=analyzeFinancialMessage;
export const subscriptionFraud=analyzeFinancialMessage;export const stolenCard=analyzeFinancialMessage;
export const chargebackAbuse=scoreChargebackRisk;export const friendlyFraud=scoreChargebackRisk;export const disputeAbuse=scoreChargebackRisk;
export const financialVelocity=detectFinancialVelocity;export const rapidTransactions=detectFinancialVelocity;export const transactionBurst=detectFinancialVelocity;
export const wireTransferScam=analyzeFinancialMessage;export const westernUnion=analyzeFinancialMessage;export const moneyGram=analyzeFinancialMessage;
export const premiumScam=analyzeFinancialMessage;export const fakeSubscription=analyzeFinancialMessage;export const subscriptionTrap=analyzeFinancialMessage;

export interface CryptoPaymentResult {
  flagged: boolean;
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  signals: string[];
  action: 'none' | 'warn' | 'block' | 'report';
  recommendation: string;
}

export function detectCryptoPaymentRequest(data: {
  messageText: string;
  userId: string;
  previousCryptoMentions: number;
  isMatched: boolean;
  daysSinceMatch?: number;
}): CryptoPaymentResult {
  const signals: string[] = [];
  let score = 0;

  const cryptoPatterns = [
    /bitcoin|btc|ethereum|eth|usdt|tether|crypto|wallet|coinbase|binance/i,
    /send.*(?:btc|eth|crypto|coin)/i,
    /(?:btc|eth|usdt).*address/i,
    /0x[a-fA-F0-9]{40}/,
    /[13][a-km-zA-HJ-NP-Z1-9]{25,34}/
  ];

  cryptoPatterns.forEach(pattern => {
    if (pattern.test(data.messageText)) { score += 2; signals.push('crypto_keyword_detected'); }
  });

  if (data.previousCryptoMentions > 2) { score += 2; signals.push('repeated_crypto_mentions'); }
  if (!data.isMatched) { score += 2; signals.push('unmatched_sender'); }
  if (data.daysSinceMatch && data.daysSinceMatch < 7) { score += 1; signals.push('new_match'); }

  let riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical' = 'none';
  let action: 'none' | 'warn' | 'block' | 'report' = 'none';

  if (score >= 6) { riskLevel = 'critical'; action = 'report'; }
  else if (score >= 4) { riskLevel = 'high'; action = 'block'; }
  else if (score >= 2) { riskLevel = 'medium'; action = 'warn'; }
  else if (score >= 1) { riskLevel = 'low'; action = 'warn'; }

  return {
    flagged: score >= 2,
    riskLevel,
    signals: [...new Set(signals)],
    action,
    recommendation: score >= 4
      ? 'This appears to be a crypto scam. Block and report this user.'
      : score >= 2
      ? 'Be cautious. Legitimate matches rarely ask for cryptocurrency.'
      : 'No significant risk detected.'
  };
}

export interface GiftCardScamResult {
  detected: boolean;
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  signals: string[];
  action: 'none' | 'warn' | 'block';
}

export function detectGiftCardScam(data: {
  messageText: string;
  userId: string;
  previousGiftCardMentions: number;
}): GiftCardScamResult {
  const signals: string[] = [];
  let score = 0;

  const giftCardPatterns = [
    /gifts*card/i,
    /itunes|googles*play|amazon|steam|apples*card/i,
    /send.*card|card.*code|redemptions*code/i,
    /emergency.*card|need.*card.*help/i
  ];

  giftCardPatterns.forEach(p => {
    if (p.test(data.messageText)) { score += 2; signals.push('gift_card_keyword'); }
  });

  if (data.previousGiftCardMentions > 1) { score += 2; signals.push('repeated_gift_card_mention'); }

  let riskLevel: 'none' | 'low' | 'medium' | 'high' = 'none';
  let action: 'none' | 'warn' | 'block' = 'none';

  if (score >= 4) { riskLevel = 'high'; action = 'block'; }
  else if (score >= 2) { riskLevel = 'medium'; action = 'warn'; }
  else if (score >= 1) { riskLevel = 'low'; action = 'warn'; }

  return { detected: score >= 2, riskLevel, signals: [...new Set(signals)], action };
}

export function detectCardTesting(data:{userId:string;declineCount:number;smallTransactionCount:number;uniqueCards:number;windowMs:number}):{detected:boolean;riskLevel:'none'|'low'|'medium'|'high';action:'none'|'flag'|'block'|'report'}{
  let score=0;
  if(data.declineCount>5)score+=3;
  if(data.smallTransactionCount>10)score+=2;
  if(data.uniqueCards>3)score+=2;
  const riskLevel=score>=6?'high':score>=4?'medium':score>=2?'low':'none';
  return{detected:score>=2,riskLevel,action:score>=6?'report':score>=4?'block':score>=2?'flag':'none'};
}
export const cardTestingDetect=detectCardTesting;

export function detectVelocityAbuse(data:{userId:string;transactionCount:number;totalAmount:number;windowMs:number;maxCount:number;maxAmount:number}):{flagged:boolean;reason:string;action:'none'|'throttle'|'block'}{
  if(data.transactionCount>data.maxCount)return{flagged:true,reason:'transaction_count_exceeded',action:'block'};
  if(data.totalAmount>data.maxAmount)return{flagged:true,reason:'amount_exceeded',action:'throttle'};
  return{flagged:false,reason:'ok',action:'none'};
}
export const velocityAbuse=detectVelocityAbuse;

export function detectRefundAbuse(data:{userId:string;refundCount:number;refundRate:number;totalPurchases:number}):{detected:boolean;riskLevel:'none'|'low'|'medium'|'high';action:'none'|'flag'|'restrict'}{
  const riskLevel=data.refundRate>0.5?'high':data.refundRate>0.3?'medium':data.refundRate>0.1?'low':'none';
  return{detected:riskLevel!=='none',riskLevel,action:riskLevel==='high'?'restrict':riskLevel!=='none'?'flag':'none'};
}
export const refundAbuseDetect=detectRefundAbuse;

export function detectGiftAbuse(data:{userId:string;giftsGiven:number;giftsReceived:number;uniqueRecipients:number;windowDays:number}):{detected:boolean;signals:string[];action:'none'|'flag'|'block'}{
  const signals:string[]=[];
  if(data.giftsGiven>20)signals.push('high_gift_volume');
  if(data.uniqueRecipients<2&&data.giftsGiven>5)signals.push('single_recipient_pattern');
  return{detected:signals.length>0,signals,action:signals.length>1?'block':signals.length>0?'flag':'none'};
}
export const giftAbuseDetect=detectGiftAbuse;

export function detectMoneyMule(data:{userId:string;incomingTransactions:number;outgoingTransactions:number;rapidTurnover:boolean;unusualAmounts:boolean;multipleAccounts:boolean}):{detected:boolean;confidence:number;indicators:string[];action:'allow'|'flag'|'freeze'|'report'}{
  const indicators:string[]=[];
  let score=0;
  if(data.rapidTurnover){score+=3;indicators.push('rapid_turnover');}
  if(data.unusualAmounts){score+=2;indicators.push('unusual_amounts');}
  if(data.multipleAccounts){score+=2;indicators.push('multiple_accounts');}
  if(data.incomingTransactions>20&&data.outgoingTransactions>20){score+=2;indicators.push('high_volume');}
  const action=score>=7?'report':score>=5?'freeze':score>=3?'flag':'allow';
  return{detected:score>=3,confidence:Math.min(100,score*12),indicators,action};
}
export const moneyMuleDetect=detectMoneyMule;

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
export const _ref_cardTesting = _det451_cardTesting;
export const _ref_microCharge = _det451_cardTesting;
export const _ref_cardTest = _det451_cardTesting;

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
export const _ref_velocityCheck = _det452_velocityCheck;
export const _ref_purchaseRate = _det452_velocityCheck;
export const _ref_purchaseVelocity = _det452_velocityCheck;

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
export const _ref_refundAbuse = _det453_refundAbuse;
export const _ref_excessiveRefund = _det453_refundAbuse;
export const _ref_refundPattern = _det453_refundAbuse;

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
export const _ref_giftAbuse = _det454_giftAbuse;
export const _ref_giftSubscription__abuse = _det454_giftAbuse;

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
export const _ref_subscriptionStacking = _det455_subscriptionStacking;
export const _ref_duplicateSub = _det455_subscriptionStacking;

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
export const _ref_promoCodeBruteForce = _det456_promoCodeBruteForce;
export const _ref_promoBruteForce = _det456_promoCodeBruteForce;
export const _ref_codeAttemptRate = _det456_promoCodeBruteForce;

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
export const _ref_currencyFarming = _det457_currencyFarming;
export const _ref_coinFarming = _det457_currencyFarming;
export const _ref_rewardAbuse = _det457_currencyFarming;

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
export const _ref_featureSharing = _det458_featureSharing;
export const _ref_accountSharing__premium = _det458_featureSharing;

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
export const _ref_moneyMule = _det459_moneyMule;
export const _ref_muleAccount = _det459_moneyMule;
export const _ref_fundsPassing = _det459_moneyMule;

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
export const _ref_cryptoMixing = _det460_cryptoMixing;
export const _ref_tumbling = _det460_cryptoMixing;
export const _ref_mixerDetect = _det460_cryptoMixing;

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
export const _ref_taxFraud = _det462_taxFraud;
export const _ref_incomeReporting = _det462_taxFraud;

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
export const _ref_trialCycling = _det643_trialCycling;
export const _ref_freeTrialAbuse = _det643_trialCycling;
export const _ref_trialAbuse = _det643_trialCycling;

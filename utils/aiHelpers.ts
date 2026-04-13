import * as Crypto from 'expo-crypto';
import type { CatfishInput, CatfishScore } from './faceComparison';
import { computeCatfishScore, computeEnrichedCatfishScore } from './faceComparison';
import { writeAuditLog } from './logger';
import { detectAIGeneratedText, detectFinancialRequest, detectOffPlatformRedirect, scoreMessageRisk } from './moderation';

function secureRandInt(max:number):number{if(max<=0)return 0;const b=Crypto.getRandomBytes(4);const v=((b[0]<<24)|(b[1]<<16)|(b[2]<<8)|b[3])>>>0;return v%max;}
function secureShuffle<T>(a:T[]):T[]{const s=[...a];for(let i=s.length-1;i>0;i--){const j=secureRandInt(i+1);[s[i],s[j]]=[s[j],s[i]];}return s;}

export interface RomanceScamScore { score:number; risk:'low'|'medium'|'high'|'critical'; signals:string[]; recommendation:string; }
export interface ConversationRiskAnalysis { overallRisk:'low'|'medium'|'high'|'critical'; riskScore:number; signals:string[]; financialRequestDetected:boolean; offPlatformRedirectDetected:boolean; loveBombingDetected:boolean; cryptoScamDetected:boolean; aiGeneratedMessages:number; catfishScore?:CatfishScore; }

const BIO_TEMPLATES=["I'm a {adjective} person who loves {hobby}. When I'm not {activity}, you'll find me {alternative}. Looking for someone who {quality}.","{emoji} {adjective} soul with a passion for {hobby}. My ideal weekend involves {activity} and {alternative}. Let's {quality} together!","Part-time {hobby} enthusiast, full-time {adjective} human. I believe in {quality} and never say no to {activity}.","If you're looking for someone who's {adjective}, loves {hobby}, and can {activity} - swipe right! Bonus points if you {quality}."];
const ADJ=['adventurous','curious','creative','ambitious','laid-back','spontaneous','thoughtful','genuine','witty','passionate'], HOB=['cooking','traveling','hiking','reading','music','photography','fitness','art','gaming','movies'], ACT=['exploring new places','trying new restaurants','binge-watching shows','working out','learning new skills'], QUAL=['appreciates good conversations','loves to laugh','is up for adventures','values authenticity','enjoys the little things'], EMO=['✨','🌟','🎯','💫','🌈','☀️','🎭','🎨'];

export interface BioInput { personality:string; interests:string[]; lookingFor:string; }
export function generateBio(input?:BioInput):string{const t=BIO_TEMPLATES[secureRandInt(BIO_TEMPLATES.length)]??BIO_TEMPLATES[0];return t.replace('{adjective}',ADJ[secureRandInt(ADJ.length)]??'genuine').replace('{hobby}',input?.interests?.[0]??HOB[secureRandInt(HOB.length)]??'traveling').replace('{activity}',ACT[secureRandInt(ACT.length)]??'exploring new places').replace('{alternative}',ACT[secureRandInt(ACT.length)]??'trying new restaurants').replace('{quality}',QUAL[secureRandInt(QUAL.length)]??'loves to laugh').replace('{emoji}',EMO[secureRandInt(EMO.length)]??'✨');}
export function generateMultipleBios(c=3):string[]{return Array.from({length:c},()=>generateBio());}

const CONV_STARTERS={general:["What's the most spontaneous thing you've ever done? 🎲","If you could have dinner with anyone, dead or alive, who would it be? 🍽️","What's your go-to comfort food after a long day? 🍕","Beach vacation or mountain adventure? 🏖️⛰️","What's the last thing that made you laugh out loud? 😂","If you won the lottery tomorrow, what's the first thing you'd do? 💰"],personality:{'Social Butterfly':["You seem like someone who knows all the best spots in town! Where should we go? 🌃","What's the most memorable party you've ever been to? 🎉"],'Thoughtful Soul':["I love deep conversations. What's something you've been thinking about lately? 💭","Do you have a favorite book that changed your perspective? 📚"],'Balanced Explorer':["You seem like you have the perfect balance! How do you unwind after an adventure? 🧘","What's on your bucket list that you're most excited about? ✨"]},interests:{cooking:["What's your signature dish? I'm always looking for new recipes! 👨‍🍳"],traveling:["What's your favorite place you've visited? Where's next on your list? ✈️"],fitness:["What's your workout routine like? I'm always looking for motivation! 💪"],music:["What's your current favorite song on repeat? 🎵"],reading:["Read any good books lately? I need recommendations! 📖"]}};

export function getConversationStarters(p?:string,i?:string[]):string[]{const s=[...CONV_STARTERS.general];if(p&&CONV_STARTERS.personality[p as keyof typeof CONV_STARTERS.personality])s.push(...CONV_STARTERS.personality[p as keyof typeof CONV_STARTERS.personality]);if(i)i.forEach(x=>{const k=x.toLowerCase();if(CONV_STARTERS.interests[k as keyof typeof CONV_STARTERS.interests])s.push(...CONV_STARTERS.interests[k as keyof typeof CONV_STARTERS.interests]);});return secureShuffle(s).slice(0,5);}

const DATE_IDEAS={casual:[{idea:"Coffee and a walk in the park ☕🌳",vibe:"relaxed"},{idea:"Visit a local farmers market 🥬",vibe:"casual"},{idea:"Try a new ice cream shop 🍦",vibe:"sweet"},{idea:"Explore a bookstore together 📚",vibe:"intellectual"},{idea:"Grab street food and people-watch 🌮",vibe:"adventurous"}],active:[{idea:"Go hiking at a scenic trail 🥾",vibe:"adventurous"},{idea:"Take a bike ride around the city 🚴",vibe:"active"},{idea:"Try rock climbing together 🧗",vibe:"challenging"},{idea:"Play mini golf or bowling 🎳",vibe:"playful"},{idea:"Kayaking or paddleboarding 🛶",vibe:"adventurous"}],creative:[{idea:"Paint and sip night 🎨🍷",vibe:"creative"},{idea:"Take a cooking class together 👨‍🍳",vibe:"interactive"},{idea:"Visit an art gallery or museum 🖼️",vibe:"cultural"},{idea:"Pottery or craft workshop 🏺",vibe:"hands-on"},{idea:"Attend a live music show 🎵",vibe:"energetic"}],romantic:[{idea:"Sunset picnic at a scenic spot 🌅",vibe:"romantic"},{idea:"Stargazing night 🌟",vibe:"intimate"},{idea:"Fancy dinner at a rooftop restaurant 🍽️",vibe:"elegant"},{idea:"Wine tasting experience 🍷",vibe:"sophisticated"},{idea:"Beach day with a bonfire 🔥",vibe:"cozy"}]};
export interface DateIdea { idea:string; vibe:string; category:string; }
export function getDateIdeas(ml?:string,tl?:string,c=5):DateIdea[]{const all:DateIdea[]=[];Object.entries(DATE_IDEAS).forEach(([cat,ideas])=>ideas.forEach(i=>all.push({...i,category:cat})));let s=[...all];if(ml==='Fitness'||tl==='Fitness')s.sort((a,b)=>(a.category==='active'?-1:b.category==='active'?1:0));else if(ml==='Homebody'||tl==='Homebody')s.sort((a,b)=>(a.category==='casual'||a.category==='creative'?-1:b.category==='casual'||b.category==='creative'?1:0));return secureShuffle(s).slice(0,c);}

export interface PhotoSuggestion { index:number; suggestion:string; priority:'high'|'medium'|'low'; }
export function getPhotoSuggestions(pc:number):PhotoSuggestion[]{const s:PhotoSuggestion[]=[];if(pc===0)s.push({index:0,suggestion:'Add at least one clear face photo as your main picture',priority:'high'});if(pc===1)s.push({index:1,suggestion:'Add a full-body photo to show your style',priority:'high'},{index:2,suggestion:'Add a photo doing something you love',priority:'medium'});if(pc===2)s.push({index:2,suggestion:'Add a photo showing your personality or hobbies',priority:'medium'});if(pc>=1)s.push({index:0,suggestion:'Your first photo should be a clear, smiling face shot',priority:'high'});return s;}
export const PHOTO_TIPS=['🎯 First photo: Clear face shot with a genuine smile','👔 Second photo: Full body shot showing your style','🎨 Third photo: Doing an activity or hobby you love','❌ Avoid: Group photos, sunglasses, filters, old photos','✅ Use: Natural lighting, recent photos, variety of settings'];

export function scoreRomanceScamRisk(f:{messageHistory:Array<{text:string;timestamp:number;isFromUser:boolean}>;profileCompleteness:number;accountAgeDays:number;hasVerifiedSelfie:boolean;hasVerifiedSocial:boolean;askedForMoney:boolean;triedToMoveOffPlatform:boolean;videoCallRefused:boolean;loveBombedUser:boolean}):RomanceScamScore{
  let sc=0;const sig:string[]=[];
  if(f.askedForMoney){sc+=40;sig.push('Requested money or financial help');}
  if(f.triedToMoveOffPlatform){sc+=25;sig.push('Tried to move conversation off-platform');}
  if(f.loveBombedUser){sc+=15;sig.push('Love bombing behavior detected');}
  if(f.videoCallRefused){sc+=20;sig.push('Refused video call requests');}
  if(!f.hasVerifiedSelfie){sc+=10;sig.push('No selfie verification');}
  if(f.accountAgeDays<7){sc+=10;sig.push('Very new account');}
  if(f.profileCompleteness<40){sc+=5;sig.push('Profile is very incomplete');}
  for(const m of f.messageHistory.filter(x=>!x.isFromUser).map(x=>x.text)){const r=scoreMessageRisk(m);if(r.score>30){sc+=Math.round(r.score*0.3);for(const s of r.signals)if(!sig.includes(s))sig.push(s);}}
  sc=Math.min(100,sc);const risk=sc>=70?'critical':sc>=50?'high':sc>=25?'medium':'low';
  if(risk!=='low')writeAuditLog('ai.romance_scam_score',{score:sc,risk,userId:f.messageHistory[0]?.isFromUser?'unknown':'target'}).catch(()=>{});
  return{score:sc,risk,signals:sig,recommendation:risk==='critical'?'High scam risk. Block and report immediately.':risk==='high'?'Several scam signals detected. Be very cautious.':risk==='medium'?'Some suspicious patterns. Proceed carefully.':'Low risk. Stay safe and trust your instincts.'};
}

export { computeCatfishScore, computeEnrichedCatfishScore, detectAIGeneratedText, detectFinancialRequest, detectOffPlatformRedirect };
export type { CatfishInput, CatfishScore };
export function detectCryptoScam(t:string){return scoreMessageRisk(t).signals.some(s=>['investment_scam','crypto_address','scam','financial_solicitation'].includes(s));}

export function analyzeConversation(msgs:Array<{text:string;timestamp:number;senderId:string}>,tid:string,ci?:Partial<CatfishInput>):ConversationRiskAnalysis{
  const sig:string[]=[];let sc=0,fin=false,off=false,love=false,crypto=false,ai=0;
  for(const m of msgs.filter(x=>x.senderId===tid)){
    if(detectFinancialRequest(m.text)){fin=true;sc+=40;if(!sig.includes('Financial request detected'))sig.push('Financial request detected');}
    if(detectOffPlatformRedirect(m.text)){off=true;sc+=25;if(!sig.includes('Attempting to move off-platform'))sig.push('Attempting to move off-platform');}
    if(detectCryptoScam(m.text)){crypto=true;sc+=35;if(!sig.includes('Crypto/investment scam language'))sig.push('Crypto/investment scam language');}
    if(detectAIGeneratedText(m.text).likelyAI){ai++;if(ai===3&&!sig.includes('Multiple AI-generated messages')){sig.push('Multiple AI-generated messages detected');sc+=15;}}
    const r=scoreMessageRisk(m.text);if(r.signals.includes('love_bombing')){love=true;if(!sig.includes('Love bombing patterns')){sig.push('Love bombing patterns');sc+=15;}}
  }
  sc=Math.min(100,sc);
  let cs:CatfishScore|undefined;
  if(ci){cs=computeCatfishScore({faceMatchConfidence:ci.faceMatchConfidence??50,photoConsistencyConfidence:ci.photoConsistencyConfidence??50,...ci,askedForMoney:ci.askedForMoney??fin,triedToMoveOffPlatform:ci.triedToMoveOffPlatform??off,loveBombingDetected:ci.loveBombingDetected??love,messageRiskScores:msgs.filter(x=>x.senderId===tid).map(x=>scoreMessageRisk(x.text).score)});if(cs.score>50){sc=Math.min(100,sc+Math.round(cs.score*0.2));if(!sig.includes('High catfish likelihood'))sig.push(`High catfish likelihood (${cs.risk})`);}}
  const risk=sc>=70?'critical':sc>=50?'high':sc>=25?'medium':'low';
  return{overallRisk:risk,riskScore:sc,signals:sig,financialRequestDetected:fin,offPlatformRedirectDetected:off,loveBombingDetected:love,cryptoScamDetected:crypto,aiGeneratedMessages:ai,catfishScore:cs};
}
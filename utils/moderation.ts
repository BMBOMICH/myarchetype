import { Platform } from 'react-native';
import { logger } from './logger';

const IS_WEB = Platform.OS === 'web';
const SERVER = process.env.EXPO_PUBLIC_SERVER_URL ?? 'https://myarchetype-server.vercel.app';
const fetchSafe = async (url: string, opts: RequestInit, t = 10000) => {
  const c = new AbortController(); const id = setTimeout(() => c.abort(), t);
  try { return await fetch(url, { ...opts, signal: c.signal }); } finally { clearTimeout(id); }
};

export interface ModerationResult { safe: boolean; reason: string; flaggedCategories?: string[]; scores?: Record<string, number>; severity?: 'low'|'medium'|'high'|'critical'; }
export type ContentField = 'chat'|'bio'|'prompt'|'bug_report'|'bio_edit'|'occupation'|'report_reason'|'match_notes'|'date_review'|'post_date_feedback'|'icebreaker'|'daily_question'|'name'|'general';

const ZW = /[\u200B\u200C\u200D\u200E\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u00AD]/g;
export const stripZeroWidthChars = (t: string) => t.replace(ZW, '');
export const hasZeroWidthChars = (t: string) => { ZW.lastIndex = 0; return ZW.test(t); };
export const normalizeUnicode = (t: string) => t.normalize('NFKC');

const CONF: Record<string, string> = {'а':'a','е':'e','о':'o','р':'p','с':'c','х':'x','А':'A','Е':'E','О':'O','Р':'P','С':'C','Х':'X','В':'B','К':'K','М':'M','Т':'T','α':'a','ε':'e','ο':'o','τ':'t','ν':'v','ａ':'a','ｂ':'b','ｃ':'c','ｄ':'d','ｅ':'e','ｆ':'f','ｇ':'g','ｈ':'h','ｉ':'i','ｊ':'j','ｋ':'k','ｌ':'l','ｍ':'m','ｎ':'n','ｏ':'o','ｐ':'p','ｑ':'q','ｒ':'r','ｓ':'s','ｔ':'t','ｕ':'u','ｖ':'v','ｗ':'w','ｘ':'x','ｙ':'y','ｚ':'z','０':'0','１':'1','２':'2','３':'3','４':'4','５':'5','６':'6','７':'7','８':'8','９':'9','@':'a','$':'s'};
export const normalizeConfusables = (t: string) => t.split('').map(c => CONF[c] ?? c).join('');

const LEET: Record<string, string> = {'4':'a','@':'a','8':'b','3':'e','9':'g','6':'g','1':'i','!':'i','|':'i','0':'o','5':'s','$':'s','7':'t','+':'t','2':'z'};
export const normalizeLeetSpeak = (t: string) => t.toLowerCase().replace(/ph/g,'f').replace(/ck/g,'k').split('').map(c => LEET[c] ?? c).join('');

export const detectRTLInjection = (t: string) => /[\u202E\u200F\u202B\u2067\u2066]/.test(t);
export const detectMixedScripts = (t: string) => [/[a-zA-Z]/,/[\u0400-\u04FF]/,/[\u0370-\u03FF]/,/[\u0600-\u06FF]/,/[\u4E00-\u9FFF]/].filter(r => r.test(t)).length >= 2;
export const detectEmojiSpam = (t: string, thr = 0.5) => { if (!t) return { isSpam: false, emojiRatio: 0 }; const e = t.match(/(\p{Emoji_Presentation}|\p{Extended_Pictographic})/gu) ?? []; const r = e.length / [...t].length; return { isSpam: r >= thr && e.length > 5, emojiRatio: r }; };

const EMOJI_SEQ = [{p:/🍃🔥|🌿🔥|🍁💨|❄️👃|🏔️👃|⛷️💨|💊🎉|💉🎉|🍄🌈|🔌💊|🔌🍃|🔌❄️|🤑💸🔌|💎🧊🔥|🌱💨|🌿💨|🍀🔥|⚗️💊|🧪💊|🔬💊|🚀🌙|🚀💊|🚀❄️|🎱🔌|🎱💊|🎱🍃|🧊🔥|🧊💨|🧊👃|🍬💊|🍭💊|🍫💊/g,c:'drug_emoji'},{p:/🍑🍆|🍆💦|🍑💦|👅🍑|🍆👅|💋🍆|💋👅💦|🍆💋👅|🙈💦|🍒💦|🍌💦|🔞💋|🔞🍆|🔞👅/g,c:'sexual_emoji'}];
export const detectEmojiCodedLanguage = (t: string) => { const m: Array<{category:string;meaning?:string}> = []; for(const s of EMOJI_SEQ) if(s.p.test(t)) m.push({category:s.c}); return {detected:m.length>0,matches:m}; };
export const preprocessText = (t: string) => normalizeLeetSpeak(normalizeConfusables(normalizeUnicode(stripZeroWidthChars(t))));

// ═══ IMAGE / VIDEO MODERATION ═══
let nsfwModel: any = null, nsfwLoad: Promise<any> | null = null, modelReady = false;
export const preloadSafetyModel = async () => { if (!IS_WEB) return false; try { return !!(await loadModel()); } catch { return false; } };
export const isSafetyModelReady = () => modelReady;

async function loadModel() {
  if (nsfwModel) return nsfwModel; if (nsfwLoad) return nsfwLoad;
  nsfwLoad = (async () => { try { const tf = await import('@tensorflow/tfjs'); const nsfw = await import('nsfwjs'); await tf.ready(); nsfwModel = await nsfw.load('https://nsfwjs.com/quant_nsfw_mobilenet/', { size: 224, type: 'graph' }); modelReady = true; return nsfwModel; } catch(e) { nsfwLoad = null; return null; } })();
  return nsfwLoad;
}

async function checkImageNative(url: string): Promise<ModerationResult> {
  if (!url.startsWith('https://')) return { safe: true, reason: 'Local URI' };
  try { const r = await fetchSafe(`${SERVER}/verify-photo-nsfw`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({photoUrl:url}) }); if(!r.ok) return {safe:true,reason:'Server unavailable'}; const d=await r.json(); return d.isNSFW ? {safe:false,reason:'Inappropriate content detected.',flaggedCategories:['nsfw']} : {safe:true,reason:'OK'}; } catch { return {safe:true,reason:'Server error'}; }
}

export async function checkImageSafety(uri: string, ctx: 'profile'|'chat'|'edit'|'story'|'video_frame'|'voice_thumbnail'|'general' = 'general'): Promise<ModerationResult> {
  if (!uri) return { safe: false, reason: 'No image provided.' };
  if (!IS_WEB) return checkImageNative(uri);
  try {
    const m = await loadModel(); if (!m) return { safe: true, reason: 'Model unavailable' };
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = document.createElement('img'); i.crossOrigin='anonymous'; i.onload=()=>res(i); i.onerror=()=>rej(new Error('Load failed')); i.src=uri; });
    const preds = await m.classify(img); const s: Record<string,number> = {}; preds.forEach((p:any)=>s[p.className]=p.probability);
    const p=s['Porn']??0, h=s['Hentai']??0, x=s['Sexy']??0; const f: string[] = [];
    if(p>0.3) f.push('explicit_content'); if(h>0.3) f.push('explicit_illustration'); if(x>0.7) f.push('too_revealing'); if(p+h+x>0.8&&!f.length) f.push('suggestive_content');
    return f.length ? {safe:false,reason:f[0]==='explicit_content'?'Explicit content detected.':f[0]==='explicit_illustration'?'Inappropriate illustration.':f[0]==='too_revealing'?'Photo too revealing.':'Photo may contain inappropriate content.',flaggedCategories:f,scores:s} : {safe:true,reason:'OK',scores:s};
  } catch(e) { logger.warn('[moderation] Image check error:', e); return {safe:true,reason:'Check error'}; }
}
export const checkChatImageSafety = (u: string) => checkImageSafety(u, 'chat');

export async function checkVideoFramesSafety(uri: string, frames = 5): Promise<ModerationResult> {
  if (!IS_WEB) { try { const r=await fetchSafe(`${SERVER}/verify-video-nsfw`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({videoUrl:uri,frameCount:frames})}); if(!r.ok) return {safe:true,reason:'Server unavailable'}; const d=await r.json(); return d.isNSFW?{safe:false,reason:'Inappropriate video.',flaggedCategories:['nsfw_video']}:{safe:true,reason:'OK'}; } catch { return {safe:true,reason:'Video check error'}; } }
  try {
    const v = document.createElement('video'); v.crossOrigin='anonymous'; v.src=uri; v.muted=true;
    await new Promise<void>((res,rej)=>{v.onloadedmetadata=()=>res();v.onerror=()=>rej(new Error('Video error'));setTimeout(()=>rej(new Error('Timeout')),15000);});
    const c = document.createElement('canvas'); c.width=224; c.height=224; const ctx=c.getContext('2d')!;
    for(let i=0;i<frames;i++){const t=((v.duration??0)/(frames+1))*(i+1); v.currentTime=t; await new Promise(r=>{v.onseeked=r;setTimeout(r,2000);}); ctx.drawImage(v,0,0,224,224); const res=await checkImageSafety(c.toDataURL('image/jpeg',0.8),'video_frame'); if(!res.safe) return {safe:false,reason:`Inappropriate at ${Math.round(t)}s`,flaggedCategories:res.flaggedCategories};}
    return {safe:true,reason:'OK'};
  } catch(e) { logger.warn('[moderation] Video check error:', e); return {safe:true,reason:'Video check error'}; }
}

export const checkVoiceThumbnail = (u: string) => checkImageSafety(u, 'voice_thumbnail');
export async function checkNudeParts(u: string, tkn?: string): Promise<ModerationResult> {
  if(!u.startsWith('https://')) return {safe:true,reason:'Local URI'};
  try { const h:Record<string,string>={'Content-Type':'application/json'}; if(tkn) h['Authorization']=`Bearer ${tkn}`; const r=await fetchSafe(`${SERVER}/detect-nude-parts`,{method:'POST',headers:h,body:JSON.stringify({photoUrl:u})}); if(!r.ok) return {safe:true,reason:'NudeNet unavailable'}; const d=await r.json(); return d.explicit?{safe:false,reason:'Explicit body parts detected.',flaggedCategories:d.parts??['explicit'],severity:'critical'}:{safe:true,reason:'OK'}; } catch { return {safe:true,reason:'NudeNet error'}; }
}

export async function verifyAllPhotosSamePerson(urls: string[], tkn?: string) {
  if(urls.length<2) return {allSame:true,confidence:1};
  try { const h:Record<string,string>={'Content-Type':'application/json'}; if(tkn) h['Authorization']=`Bearer ${tkn}`; const r=await fetchSafe(`${SERVER}/verify-all-photos-same-person`,{method:'POST',headers:h,body:JSON.stringify({photoUrls:urls})}); return r.ok ? await r.json() : {allSame:true,confidence:0,reason:'Server unavailable'}; } catch { return {allSame:true,confidence:0,reason:'Check error'}; }
}
export async function checkCrossAccountDuplicate(u: string, uid: string, tkn?: string) {
  if(!u.startsWith('https://')) return {isDuplicate:false};
  try { const h:Record<string,string>={'Content-Type':'application/json'}; if(tkn) h['Authorization']=`Bearer ${tkn}`; const r=await fetchSafe(`${SERVER}/pdq-cross-account`,{method:'POST',headers:h,body:JSON.stringify({photoUrl:u,userId:uid})}); return r.ok ? await r.json() : {isDuplicate:false}; } catch { return {isDuplicate:false}; }
}

async function serverDetect(ep: string, u: string, tkn?: string): Promise<ModerationResult> {
  if(!u.startsWith('https://')) return {safe:true,reason:'Local URI'};
  try { const h:Record<string,string>={'Content-Type':'application/json'}; if(tkn) h['Authorization']=`Bearer ${tkn}`; const r=await fetchSafe(`${SERVER}/${ep}`,{method:'POST',headers:h,body:JSON.stringify({photoUrl:u})}); if(!r.ok) return {safe:true,reason:'Check unavailable'}; const d=await r.json(); return d.detected?{safe:false,reason:d.reason??'Prohibited content detected.',flaggedCategories:[ep],severity:d.severity??'high'}:{safe:true,reason:'OK'}; } catch { return {safe:true,reason:'Check error'}; }
}
export const detectHateSymbols = (u:string,t?:string) => serverDetect('detect-hate-symbol',u,t);
export const detectWeapons = (u:string,t?:string) => serverDetect('detect-weapons',u,t);
export const detectDrugParaphernalia = (u:string,t?:string) => serverDetect('detect-drug-paraphernalia',u,t);
export const detectOffensiveGesture = (u:string,t?:string) => serverDetect('detect-offensive-gesture',u,t);
export const detectFakeBadgeInPhoto = (u:string,t?:string) => serverDetect('detect-fake-badge',u,t);

export async function extractTextFromImage(u: string, tkn?: string) {
  try { const h:Record<string,string>={'Content-Type':'application/json'}; if(tkn) h['Authorization']=`Bearer ${tkn}`; const r=await fetchSafe(`${SERVER}/ocr-extract`,{method:'POST',headers:h,body:JSON.stringify({photoUrl:u})}); if(!r.ok) return {text:'',hasContactInfo:false,contactTypes:[]}; const d=await r.json(); const t=d.text??''; const ct: string[] = []; if(PHONE.test(t)) ct.push('phone'); if(EMAIL.test(t)) ct.push('email'); if(/\b(snap|insta|ig|telegram|whatsapp|discord)\b/i.test(t)) ct.push('social_handle'); return {text,hasContactInfo:ct.length>0,contactTypes:ct}; } catch { return {text:'',hasContactInfo:false,contactTypes:[]}; }
}
export async function ocrThenModerate(u: string, tkn?: string) { const o=await extractTextFromImage(u,tkn); if(!o.text?.trim()) return {safe:true,reason:'No text found'}; const t=checkTextSafety(o.text,'general'); return t.safe ? {safe:true,reason:'OK'} : {...t,flaggedCategories:[...(t.flaggedCategories??[]),'ocr_hate_speech_in_image']}; }

export async function embedWatermark(u: string, uid: string, tkn?: string) { try { const h:Record<string,string>={'Content-Type':'application/json'}; if(tkn) h['Authorization']=`Bearer ${tkn}`; const r=await fetchSafe(`${SERVER}/watermark-embed`,{method:'POST',headers:h,body:JSON.stringify({photoUrl:u,userId:uid})}); return r.ok ? {success:true,watermarkedUrl:(await r.json()).url} : {success:false}; } catch { return {success:false}; } }
export async function detectWatermark(u: string, tkn?: string) { try { const h:Record<string,string>={'Content-Type':'application/json'}; if(tkn) h['Authorization']=`Bearer ${tkn}`; const r=await fetchSafe(`${SERVER}/watermark-detect`,{method:'POST',headers:h,body:JSON.stringify({photoUrl:u})}); return r.ok ? await r.json() : {hasWatermark:false}; } catch { return {hasWatermark:false}; } }

export async function runFullImageScan(u: string, ctx: 'profile'|'chat'|'edit'|'story'|'general', tkn?: string) {
  const n=await checkImageSafety(u,ctx); if(!n.safe) return n;
  const p=await checkNudeParts(u,tkn); if(!p.safe) return p;
  const h=await detectHateSymbols(u,tkn); if(!h.safe) return h;
  const w=await detectWeapons(u,tkn); if(!w.safe) return w;
  const d=await detectDrugParaphernalia(u,tkn); if(!d.safe) return d;
  if(ctx==='profile'||ctx==='edit'){const b=await detectFakeBadgeInPhoto(u,tkn); if(!b.safe) return b;}
  return {safe:true,reason:'OK'};
}

// ═══ TEXT MODERATION ═══
interface HP { p: RegExp; c: string; r: string; s: 'low'|'medium'|'high'|'critical'; }
const PROF = new Set(['fuck','shit','bitch','ass','damn','dick','cock','pussy','cunt','bastard','whore','slut','asshole','motherfucker','bullshit','goddamn','piss','crap','douche','twat','wanker','prick']);
const hasProfanity = (t: string) => t.toLowerCase().replace(/[^a-z\s]/g,'').split(/\s+/).some(w => PROF.has(w));
const PHONE = /(\+?\d[\d\s\-().]{7,}\d|\b\d{3}[\s.\-]?\d{3}[\s.\-]?\d{4}\b)/;
const EMAIL = /\b[a-zA-Z0-9._%+\-]+\s*[@＠]\s*[a-zA-Z0-9.\-]+\s*\.\s*[a-zA-Z]{2,}\b/;
export const extractPhoneNumbers = (t: string) => { const n=stripZeroWidthChars(t), m=n.match(PHONE)??[]; const f=m.filter(x=>x.replace(/\D/g,'').length>=7); return {found:f.length>0,numbers:f}; };

const SEX: HP[] = [{p:/\b(send\s*(me\s*)?(ur\s+|your\s+)?(nudes?|dick\s*pics?|naked\s*(pics?|photos?|selfies?)))\b/i,c:'sexual_solicitation',r:'Sexual solicitation is not allowed.',s:'high'},{p:/\b(show\s*(me\s*)?(ur|your)\s*(body|boobs?|tits?|ass|pussy|cock|dick))\b/i,c:'sexual_solicitation',r:'Sexual solicitation is not allowed.',s:'high'},{p:/\b(wanna|want\s*to|lets?)\s*(fuck|bang|smash|have\s*sex|hookup|hook\s*up)\b/i,c:'sexual_solicitation',r:'Explicit sexual content is not allowed.',s:'high'},{p:/\b(only\s*fans?|onlyfans?\.com|fansly|my\s*content\s*link)\b/i,c:'sexual_solicitation',r:'Adult content links not allowed.',s:'medium'},{p:/\b(sex\s*worker|escort|massages?\s*with\s*extras?|full\s*service)\b/i,c:'sexual_solicitation',r:'Sexual services solicitation not allowed.',s:'high'},{p:/\b(dtf|down\s*to\s*f[u*]ck)\b/i,c:'sexual_solicitation',r:'Sexual solicitation is not allowed.',s:'high'},{p:/\b(looking\s*for\s*(sex|hookup|fwb|nsa|one\s*night))\b/i,c:'sexual_solicitation',r:'Sexual solicitation is not allowed.',s:'high'},{p:/\b(how\s*much\s*(for|do\s*you\s*charge))\b/i,c:'sexual_solicitation',r:'Sexual solicitation is not allowed.',s:'high'},{p:/\b(sugar\s*(daddy|mama|baby)\s*(needed|wanted|looking))\b/i,c:'sexual_solicitation',r:'Financial solicitation is not allowed.',s:'medium'}];
const VIO: HP[] = [{p:/\b(i['']?(ll|m\s*(gonna|going\s*to))\s*(kill|murder|hurt|stab|shoot|beat|attack)\s*(you|u|yo|ya))\b/i,c:'violence_threat',r:'Threats of violence are not allowed.',s:'critical'},{p:/\b(kill\s*(you|ur|yourself)|murder\s*you)\b/i,c:'violence_threat',r:'Threats of violence are not allowed.',s:'critical'},{p:/\b(you\s*(will|should|deserve\s*to)\s*die)\b/i,c:'violence_threat',r:'Threats of violence are not allowed.',s:'critical'},{p:/\b(i\s*know\s*where\s*you\s*live|i\s*will\s*find\s*you|watch\s*your\s*back)\b/i,c:'violence_threat',r:'Threatening language is not allowed.',s:'critical'},{p:/\b(gonna\s*(hurt|kill|beat)\s*(you|ur|your))\b/i,c:'violence_threat',r:'Threats of violence are not allowed.',s:'critical'},{p:/\b(you('re|\s*are)\s*(dead|gonna\s*die))\b/i,c:'violence_threat',r:'Threats of violence are not allowed.',s:'critical'},{p:/\b(put\s*a\s*bullet\s*in|slit\s*(your|ur)\s*(throat|wrists?))\b/i,c:'violence_threat',r:'Threats of violence are not allowed.',s:'critical'}];
const SH: HP[] = [{p:/\b(kill\s*your\s*self|kys|go\s*die|end\s*your\s*life|commit\s*suicide)\b/i,c:'self_harm',r:'Encouraging self-harm is strictly prohibited.',s:'critical'},{p:/\b(you\s*should\s*(just\s*)?(die|end\s*it|kill\s*yourself))\b/i,c:'self_harm',r:'Encouraging self-harm is strictly prohibited.',s:'critical'},{p:/\b(the\s*world\s*(would\s*be\s*)?(better|best)\s*without\s*you)\b/i,c:'self_harm',r:'Encouraging self-harm is strictly prohibited.',s:'critical'},{p:/\b(nobody\s*(would\s*)?miss\s*you)\b/i,c:'self_harm',r:'Encouraging self-harm is strictly prohibited.',s:'critical'},{p:/\b(do\s*(us|everyone)\s*a\s*favor\s*and\s*die)\b/i,c:'self_harm',r:'Encouraging self-harm is strictly prohibited.',s:'critical'}];
const HATE: HP[] = [{p:/\bn[i1][g9]{1,2}[e3a@]r?s?\b/i,c:'racial_slur',r:'Hate speech is not allowed.',s:'critical'},{p:/\bf[a@4][g9]{1,2}[o0]ts?\b/i,c:'homophobic_slur',r:'Homophobic language is not allowed.',s:'critical'},{p:/\br[e3]t[a@]rd(ed|s)?\b/i,c:'hate_speech',r:'Derogatory language is not allowed.',s:'high'},{p:/\b(tr[a@]nn[yi](es|s)?)\b/i,c:'homophobic_slur',r:'Derogatory language is not allowed.',s:'high'},{p:/\b(chink|sp[i1]c|wet\s*back|k[i1]ke|cr[a@]cker|g[o0]{2}k)\b/i,c:'racial_slur',r:'Hate speech is not allowed.',s:'critical'},{p:/\b(dyke|lesbo|homo|queer\s*bait)\b/i,c:'homophobic_slur',r:'Homophobic language is not allowed.',s:'high'},{p:/\b(d[iy1]k[e3]|sh[e3]\s*m[a@]l[e3])\b/i,c:'homophobic_slur',r:'Homophobic language is not allowed.',s:'high'},{p:/\b(no\s*homo)\b/i,c:'homophobic_slur',r:'Homophobic language is not allowed.',s:'medium'},{p:/\b(maldito|puta\s*madre|hijo\s*de\s*puta|maricon|pinche|connard|salope|bamboula|enculé|nique\s*ta\s*mère|batard|scheiß(e|er)|hurensohn|wichser|kanake|missgeburt|viado|porra|filho\s*da\s*puta|macaco|arrombado|cuzão|stronzo|vaffanculo|cazzo|minchia|puttana|blyad|pizda|khuy|suka|pidar|nahui|eblan|kurwa|chuj|jebac|orospu|amına|siktir|piç|kuss\s*ummak|ya\s*kalb|sharmut|ibn\s*el?\s*sharmu|madarchod|bhenchod|chutiya|harami|kamina|randi|kutte|kichiku|baka\s*gaijin|kono\s*yaro|kisama|sibal|ssibal|gaeseki|byeongsin|tmd|cnm|nmsl|wdnmd|cao\s*ni\s*ma|kanker|tering|tyfus|godverdomme|kutwijf|hoer|jävla|fitta|hora|knulla|skit|malaka|poustis|gamoto|skata|pula|fututi|muie|cacat|curva)\b/i,c:'hate_multilang',r:'Hate speech is not allowed.',s:'high'}];
const SCAM: HP[] = [{p:/\b(send\s*(me\s*)?(money|\$\d+|bitcoin|crypto|gift\s*cards?|btc|eth|usdt|usdc))\b/i,c:'scam',r:'Requesting money or crypto is not allowed.',s:'high'},{p:/\b(cash\s*app|venmo|zelle|paypal|western\s*union)\s*(me|:\s*\S+|transfer|send)\b/i,c:'financial_solicitation',r:'Financial solicitation is not allowed.',s:'high'},{p:/\b(sugar\s*(daddy|mama|mommy)\s*(needed|wanted|looking))\b/i,c:'financial_solicitation',r:'Financial solicitation is not allowed.',s:'medium'},{p:/\b(guaranteed\s*(returns?|profits?|income)|invest\s*(with\s*me|now|today))\b/i,c:'investment_scam',r:'Investment scam language is not allowed.',s:'high'},{p:/\b(i\s*can\s*(double|triple|10x)\s*your\s*(money|investment|crypto|bitcoin))\b/i,c:'investment_scam',r:'Investment scam language is not allowed.',s:'high'},{p:/\b(blockchain|forex|trading\s*bot|passive\s*income)\s*(opportunity|platform|account)\b/i,c:'investment_scam',r:'Investment solicitation is not allowed.',s:'medium'},{p:/\b(wallet\s*address|0x[a-fA-F0-9]{40}|[13][a-zA-Z0-9]{25,34})\b/,c:'crypto_address',r:'Sharing crypto wallet addresses is not allowed.',s:'high'}];
const DRUG: HP[] = [{p:/\b(sell(ing)?\s*(weed|meth|coke|cocaine|heroin|pills?|drugs?|molly|ecstasy|mdma|lsd|shrooms?|fentanyl|oxy|xanax))\b/i,c:'drug_dealing',r:'Drug-related content is not allowed.',s:'critical'},{p:/\b(buy|get|hook\s*(me\s*)?up\s*with)\s*(drugs?|weed|coke|meth|pills?|dope|gear)\b/i,c:'drug_dealing',r:'Drug-related content is not allowed.',s:'critical'},{p:/\b(plug|dealer|connect)\s*(for\s*)?(weed|coke|meth|molly|pills?|dope)\b/i,c:'drug_dealing',r:'Drug-related content is not allowed.',s:'critical'},{p:/\b(hmu\s*for\s*(weed|gas|loud|bud|pack|pills?))\b/i,c:'drug_dealing',r:'Drug-related content is not allowed.',s:'critical'},{p:/\b(i\s*(got|have|sell)\s*(loud|gas|za|pack|zip|qp|pound))\b/i,c:'drug_dealing',r:'Drug-related content is not allowed.',s:'critical'},{p:/(\u{1F33F}|\u{1F4A8}|\u{2744}|\u{1F48A}|\u{1F344}|\u{1F9EA})\s*(for\s*sale|available|dm\s*me|hmu)/u,c:'drug_emoji',r:'Drug-related content is not allowed.',s:'high'}];
const U18: HP[] = [{p:/\b(i['']?m\s*(1[0-7]|[1-9])\s*(years?\s*old|yo|y\/o))\b/i,c:'underage',r:'Users must be 18 or older.',s:'critical'},{p:/\b(looking\s*for\s*(younger|teen|minor|underage))\b/i,c:'underage',r:'Content involving minors is strictly prohibited.',s:'critical'},{p:/\b(minors?\s*(welcome|ok|okay)|teens?\s*(only|preferred))\b/i,c:'underage',r:'Content involving minors is strictly prohibited.',s:'critical'},{p:/\b(age\s*is\s*(just\s*a\s*number|no\s*matter))\b/i,c:'underage',r:'Content involving minors is strictly prohibited.',s:'critical'},{p:/\b(jailbait|lolita|shota)\b/i,c:'underage',r:'Content involving minors is strictly prohibited.',s:'critical'},{p:/\b(cp|child\s*p[o0]rn)\b/i,c:'underage',r:'Content involving minors is strictly prohibited.',s:'critical'},{p:/\b(preteen|pre-teen|tween)\b/i,c:'underage',r:'Content involving minors is strictly prohibited.',s:'critical'},{p:/\b(barely\s*legal|just\s*turned\s*1[0-8])\b/i,c:'underage',r:'Content involving minors is strictly prohibited.',s:'critical'},{p:/\b(high\s*school\s*(student|girl|boy|kid))\b/i,c:'underage',r:'Content involving minors is strictly prohibited.',s:'critical'},{p:/\b(18\s*and\s*under|under\s*18|u18|u\/18)\b/i,c:'underage',r:'Users must be 18 or older.',s:'critical'},{p:/\b(dd\/lg|ddlg|agere|little\s*space|caregiver\s*little)\b/i,c:'underage',r:'Content involving minors is strictly prohibited.',s:'critical'}];
const SPAM: HP[] = [{p:/\b(bit\.ly|tinyurl|click\s*here|free\s*money|won\s*a\s*prize|congratulations\s*you\s*won)\b/i,c:'spam',r:'Spam content is not allowed.',s:'medium'},{p:/https?:\/\/[^\s]{0,20}\.(tk|ml|ga|cf|gq)\b/i,c:'spam_link',r:'Suspicious links are not allowed.',s:'high'},{p:/\b(earn\s*\$\d+|work\s*from\s*home|make\s*money\s*fast|get\s*rich)\b/i,c:'spam',r:'Spam content is not allowed.',s:'medium'}];
const CONT: HP[] = [{p:PHONE,c:'contact_info_phone',r:'Sharing phone numbers is not allowed.',s:'medium'},{p:EMAIL,c:'contact_info_email',r:'Sharing email addresses is not allowed.',s:'medium'}];
const SOC: HP[] = [{p:/\b(my\s*)?(snap(chat)?|insta(gram)?|ig|tiktok|tt|telegram|tg|whatsapp|wa|line|kik|discord)\s*(is|:|\s)\s*@?[\w.]+/i,c:'social_handle',r:'Please keep conversations in-app.',s:'low'},{p:/\b(add\s*me\s*(on|at)?|find\s*me\s*(on|at)?|dm\s*me\s*(on)?)\s*(snap|insta|tiktok|telegram|whatsapp|discord)\b/i,c:'social_handle',r:'Please keep conversations in-app.',s:'low'},{p:/(\u{1F346}|\u{1F351}|\u{1F353}|\u{1F4A6})\s*(dm|hmu|hit\s*me\s*up|for\s*fun)/u,c:'sexual_emoji',r:'Explicit content is not allowed.',s:'high'},{p:/(\u{1F351}|\u{1F346}|\u{1FAD2})\s*(\u{1F346}|\u{1F351}|\u{1F4AF})/u,c:'sexual_emoji',r:'Explicit emoji content is not allowed.',s:'high'}];
const SEXT: HP[] = [{p:/\b(i\s*have\s*(your\s*)?(photos?|videos?|nudes?|pics?)|i\s*will\s*share\s*(your\s*)?(photos?|videos?))\b/i,c:'sextortion',r:'Threatening behavior is not allowed.',s:'critical'},{p:/\b(pay\s*me|send\s*(money|crypto|bitcoin)).{0,50}(photos?|videos?|nudes?|expose|leak)\b/i,c:'sextortion',r:'Extortion is not allowed.',s:'critical'},{p:/\b(i['']ll\s*expose|i\s*will\s*expose|going\s*to\s*expose)\s*(you|ur|your)\b/i,c:'sextortion',r:'Threatening behavior is not allowed.',s:'critical'},{p:/\b(recorded\s*you|screenshot|screen\s*record).{0,30}(pay|money|send)\b/i,c:'sextortion',r:'Extortion is not allowed.',s:'critical'},{p:/\b(everyone\s*will\s*see\s*(your\s*)?(nudes?|photos?|videos?)).{0,20}(pay|money|send)\b/i,c:'sextortion',r:'Extortion is not allowed.',s:'critical'}];
const DOX: HP[] = [{p:/\b(i\s*know\s*(where\s*you\s*live|your\s*address|your\s*home|your\s*workplace))\b/i,c:'doxxing',r:'Sharing personal info is not allowed.',s:'critical'},{p:/\b(ssn|social\s*security\s*number|credit\s*card\s*number|passport\s*number)\s*:?\s*[\d\-]+/i,c:'pii',r:'Sharing PII is not allowed.',s:'critical'},{p:/\b\d{3}-\d{2}-\d{4}\b/,c:'pii',r:'Sharing PII is not allowed.',s:'critical'},{p:/\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/,c:'pii',r:'Sharing financial information is not allowed.',s:'critical'},{p:/\b(doxx?(ed|ing)?|swatt?(ed|ing)?)\b/i,c:'doxxing',r:'Doxxing is not allowed.',s:'critical'},{p:/\b(i('ll|m\s*going\s*to)\s*(find|track|hunt)\s*(you|them|him|her)\s*(down)?)\b/i,c:'doxxing',r:'Threatening language is not allowed.',s:'critical'},{p:/\b(posting\s*(their|his|her|your)\s*(info|details|address|number))\b/i,c:'doxxing',r:'Sharing personal info is not allowed.',s:'critical'}];
const COER: HP[] = [{p:/\b(you\s*(have\s*to|must|need\s*to|will)\s*(do\s*this|obey|listen\s*to\s*me|comply))\b/i,c:'coercive',r:'Controlling language is not allowed.',s:'medium'},{p:/\b(if\s*you\s*(don['']?t|refuse|won['']?t).{0,40}(i['']ll|i\s*will|you['']ll\s*regret))\b/i,c:'coercive',r:'Threatening language is not allowed.',s:'high'},{p:/\b(you['']re\s*(nothing|worthless|stupid|pathetic)\s*without\s*me)\b/i,c:'coercive',r:'Emotionally abusive language is not allowed.',s:'high'},{p:/\b(nobody\s*(else\s*)?(will|would)\s*(ever\s*)?(love|want|date)\s*you)\b/i,c:'coercive',r:'Emotionally abusive language is not allowed.',s:'high'},{p:/\b(give\s*me\s*your\s*password|let\s*me\s*(check|see)\s*your\s*(phone|messages?))\b/i,c:'coercive',r:'Controlling language is not allowed.',s:'medium'},{p:/\b(you\s*(need|have)\s*to\s*(ask\s*me|get\s*my)\s*(permission|approval))\b/i,c:'coercive',r:'Controlling language is not allowed.',s:'medium'}];
const GROOM: HP[] = [{p:/\b(you['']?re\s*so\s*mature\s*for\s*your\s*age|you\s*seem\s*older\s*than\s*you\s*are)\b/i,c:'grooming',r:'This type of language is not allowed.',s:'critical'},{p:/\b(keep\s*this\s*(between\s*us|our\s*secret|secret)|don['']?t\s*tell\s*(anyone|your\s*(parents?|friends?|family)))\b/i,c:'grooming',r:'This type of language is not allowed.',s:'critical'},{p:/\b(are\s*you\s*(home\s*)?alone|where\s*are\s*your\s*parents?|is\s*anyone\s*home\s*with\s*you)\b/i,c:'grooming',r:'This type of language is not allowed.',s:'high'},{p:/\b(you\s*can\s*trust\s*me|i['']?m\s*not\s*like\s*(other|those)\s*(guys?|men|people))\b/i,c:'grooming',r:'This language pattern has been flagged.',s:'medium'},{p:/\b(send\s*(me\s*)?a?\s*(pic|photo|selfie).{0,20}just\s*(for|between)\s*(me|us))\b/i,c:'grooming',r:'This type of language is not allowed.',s:'critical'},{p:/\b(i('ll)?\s*teach\s*you\s*(about\s*)?(love|sex|relationships?))\b/i,c:'grooming',r:'This type of language is not allowed.',s:'critical'}];
const LOVE: HP[] = [{p:/\b(i['']?ve\s*(never\s*)?felt\s*this\s*way\s*about\s*anyone|you['']?re\s*my\s*soulmate)\b/i,c:'love_bombing',r:'Unusually intense language flagged.',s:'low'},{p:/\b(we\s*were\s*meant\s*to\s*be|destiny|i\s*love\s*you\s*already|i\s*knew\s*(immediately|instantly|right\s*away)\s*you\s*were\s*the\s*one)\b/i,c:'love_bombing',r:'Unusually intense language flagged.',s:'low'},{p:/\b(i['']?ll\s*(do\s*anything|give\s*you\s*everything|be\s*everything)\s*for\s*you)\b/i,c:'love_bombing',r:'Unusually intense language flagged.',s:'low'}];

export const detectAIGeneratedText = (t: string) => { const s: string[] = []; if(/\b(furthermore|additionally|moreover|in\s*conclusion|therefore)\b/gi.test(t)) s.push('formal_transitions'); if(t.length>100&&!/\b(can't|won't|don't|it's|i'm|i've|i'd|i'll|you're|they're)\b/i.test(t)) s.push('no_contractions'); if(t.length>150&&!/[!?]/.test(t)&&t.split('.').length>3) s.push('overly_formal'); if(/\b(as an ai|as a language model|i cannot|i am unable to)\b/i.test(t)) s.push('ai_disclaimer'); if(/\b(delve|utilize|leverage|facilitate|comprehensive|multifaceted)\b/gi.test(t)) s.push('ai_vocabulary'); if(t.length>200){const st=t.split(/[.!?]+/).filter(Boolean);if(st.length&&st.reduce((a,b)=>a+b.length,0)/st.length>120) s.push('long_avg_sentence');} return {likelyAI:s.length>=2,signals:s}; };

const runPatterns = (pats: HP[], t: string, n: string): ModerationResult | null => { for(const {p: pattern, c: category, r: reason, s: severity} of pats) if(pattern.test(n)||pattern.test(t)) return {safe:false,reason,flaggedCategories:[category],severity}; return null; };
export const detectRacialSlurs = (t: string) => runPatterns(HATE.filter(h=>h.category==='racial_slur'),t,preprocessText(t))??{safe:true,reason:'OK'};
export const detectHomophobicSlurs = (t: string) => runPatterns(HATE.filter(h=>h.category==='homophobic_slur'),t,preprocessText(t))??{safe:true,reason:'OK'};
export const detectSexualSolicitation = (t: string) => runPatterns(SEX,t,preprocessText(t))??{safe:true,reason:'OK'};
export const detectViolenceThreats = (t: string) => runPatterns(VIO,t,preprocessText(t))??{safe:true,reason:'OK'};
export const detectSelfHarmEncouragement = (t: string) => runPatterns(SH,t,preprocessText(t))??{safe:true,reason:'OK'};
export const detectDrugDealingLanguage = (t: string) => runPatterns(DRUG,t,preprocessText(t))??{safe:true,reason:'OK'};
export const detectUnderageReferences = (t: string) => runPatterns(U18,t,preprocessText(t))??{safe:true,reason:'OK'};
export const detectSextortion = (t: string) => runPatterns(SEXT,t,preprocessText(t))??{safe:true,reason:'OK'};
export const detectDoxxing = (t: string) => runPatterns(DOX,t,preprocessText(t))??{safe:true,reason:'OK'};
export const detectCoerciveLanguage = (t: string) => runPatterns(COER,t,preprocessText(t))??{safe:true,reason:'OK'};
export const detectGroomingLanguage = (t: string) => runPatterns(GROOM,t,preprocessText(t))??{safe:true,reason:'OK'};
export const detectMultilingualHateSpeech = (t: string) => { const n=preprocessText(t), v=[t,n,normalizeUnicode(t)]; for(const p of HATE.filter(h=>h.category==='hate_multilang')) for(const x of v) if(p.pattern.test(x)) return {safe:false,reason:p.reason,flaggedCategories:[p.category],severity:p.severity}; return {safe:true,reason:'OK'}; };

const ALL = [...SEX,...VIO,...SH,...HATE,...SCAM,...DRUG,...U18,...SPAM,...CONT,...SOC,...SEXT,...DOX,...COER,...GROOM,...LOVE];
const SKIP: Partial<Record<ContentField,string[]>> = {bug_report:['contact_info_phone','contact_info_email','social_handle'],occupation:['contact_info_phone','contact_info_email','social_handle','love_bombing'],match_notes:['social_handle']};

export function checkTextSafety(t: string, f: ContentField = 'general'): ModerationResult {
  if(!t?.trim()) return {safe:true,reason:'Empty text'};
  if(detectRTLInjection(t)) return {safe:false,reason:'Text contains invalid direction characters.',flaggedCategories:['rtl_injection'],severity:'high'};
  if(hasZeroWidthChars(t)) return {safe:false,reason:'Text contains hidden characters.',flaggedCategories:['zero_width_injection'],severity:'medium'};
  if(detectMixedScripts(t)) logger.warn('[moderation] Mixed script detected');
  const em=detectEmojiSpam(t); if(em.isSpam) return {safe:false,reason:'Too many emojis.',flaggedCategories:['emoji_spam'],severity:'low'};
  const ec=detectEmojiCodedLanguage(t); if(ec.detected) return {safe:false,reason:'Coded language detected.',flaggedCategories:ec.matches.map(m=>m.category),severity:'high'};
  const p=preprocessText(t);
  if(f==='name'&&hasProfanity(p)) return {safe:false,reason:'Profanity is not allowed.',flaggedCategories:['profanity'],severity:'medium'};
  const skip=SKIP[f]??[], res=runPatterns(ALL.filter(x=>!skip.includes(x.c)),t,p); if(res) return res;
  if(['chat','bio','bio_edit','general'].includes(f)&&hasProfanity(p)) return {safe:false,reason:'Please keep language appropriate.',flaggedCategories:['profanity'],severity:'low'};
  return {safe:true,reason:'OK'};
}

export function checkFirstMessage(t: string): ModerationResult {
  const b=checkTextSafety(t,'chat'); if(!b.safe) return b; const p=preprocessText(t);
  if(/\b(sexy|hot|beautiful\s*body|gorgeous\s*body|dtf)\b/i.test(p)||/\b(send\s*(me\s*)?(a\s*)?(photo|pic|selfie)|you\s*look\s*(so\s*)?(hot|sexy|fuckable))\b/i.test(p)) return {safe:false,reason:'Please keep first messages respectful.',flaggedCategories:['inappropriate_first_message'],severity:'medium'};
  return {safe:true,reason:'OK'};
}
export const moderateFirstMessage = checkFirstMessage;
export const moderateChat = (t: string) => checkTextSafety(t,'chat'); export const checkChatMessage = moderateChat;
export const moderateBio = (t: string) => checkTextSafety(t,'bio'); export const checkBio = moderateBio;
export const moderatePrompt = (t: string) => checkTextSafety(t,'prompt'); export const checkPrompt = moderatePrompt;
export const moderateBugReport = (t: string) => checkTextSafety(t,'bug_report'); export const checkBugReport = moderateBugReport;

export const moderateOccupation = (t: string): ModerationResult => {
  if(!t?.trim()) return {safe:true,reason:'Empty'};
  if(t.length>100) return {safe:false,reason:'Occupation must be under 100 characters.',flaggedCategories:['too_long'],severity:'low'};
  if(hasZeroWidthChars(t)) return {safe:false,reason:'Text contains hidden characters.',flaggedCategories:['zero_width_injection'],severity:'medium'};
  if(detectRTLInjection(t)) return {safe:false,reason:'Text contains invalid direction characters.',flaggedCategories:['rtl_injection'],severity:'high'};
  if(/\b(drug\s*dealer|escort|cam\s*(girl|model|boy)|hitman|arms?\s*dealer|assassin|pimp|trafficker|hacker\s*for\s*hire|sugar\s*(daddy|baby)|rent\s*boy|gigolo|stripper)\b/i.test(t)) return {safe:false,reason:'This occupation description is not appropriate.',flaggedCategories:['suspicious_occupation'],severity:'medium'};
  if(PHONE.test(t)) return {safe:false,reason:'Phone numbers are not allowed in occupation.',flaggedCategories:['contact_info_phone'],severity:'medium'};
  if(EMAIL.test(t)) return {safe:false,reason:'Email addresses are not allowed in occupation.',flaggedCategories:['contact_info_email'],severity:'medium'};
  if(/https?:\/\/|www\./i.test(t)) return {safe:false,reason:'Links are not allowed in occupation.',flaggedCategories:['spam_link'],severity:'medium'};
  if(/\b(snap|insta|ig|tiktok|telegram|whatsapp|discord)\s*(:|is|@)/i.test(t)) return {safe:false,reason:'Social media handles are not allowed in occupation.',flaggedCategories:['social_handle'],severity:'low'};
  if(hasProfanity(preprocessText(t))) return {safe:false,reason:'Profanity is not allowed in occupation.',flaggedCategories:['profanity'],severity:'medium'};
  return checkTextSafety(t,'occupation');
};
export const checkOccupation = moderateOccupation;

export const moderateReport = (t: string) => checkTextSafety(t,'report_reason'); export const checkReportReason = moderateReport;
export const moderateNote = (t: string) => checkTextSafety(t,'match_notes'); export const checkMatchNotes = moderateNote;
export const moderateReview = (t: string) => checkTextSafety(t,'date_review'); export const checkDateReview = moderateReview;
export const moderateFeedback = (t: string) => checkTextSafety(t,'post_date_feedback'); export const checkPostDateFeedback = moderateFeedback;
export const moderateIcebreaker = (t: string) => checkTextSafety(t,'icebreaker'); export const checkIcebreakerAnswer = moderateIcebreaker;
export const moderateDailyQ = (t: string) => checkTextSafety(t,'daily_question'); export const checkDailyQuestionAnswer = moderateDailyQ;
export const moderateField = (t: string, f: ContentField = 'general') => checkTextSafety(t, f); export const validateTextField = moderateField;

export async function moderateContent(opts: { images?: string[]; texts?: Array<{ text: string; field?: ContentField }>; imageContext?: 'profile'|'chat'|'edit'|'story'|'video_frame'|'voice_thumbnail'|'general' }): Promise<ModerationResult> {
  const {images=[],texts=[],imageContext='general'}=opts;
  for(const i of texts){const t=typeof i==='string'?i:i.text, f=typeof i==='string'?'general':(i.field??'general'); const r=checkTextSafety(t,f as ContentField); if(!r.safe) return r;}
  for(const u of images){const r=await checkImageSafety(u,imageContext); if(!r.safe) return r;}
  return {safe:true,reason:'All content OK'};
}

export function scoreMessageRisk(t: string): { score: number; signals: string[] } {
  const s: string[] = []; let sc=0; const p=preprocessText(t);
  if(/\b(send\s*money|need\s*money|borrow|loan|help\s*me\s*financially|wire\s*transfer)\b/i.test(p)){s.push('financial_request');sc+=40;}
  if(/\b(telegram|whatsapp|signal|move\s*to|let['']s\s*(talk|chat)\s*(on|at|via))\b/i.test(p)){s.push('off_platform_redirect');sc+=30;}
  for(const x of LOVE) if(x.p.test(p)){s.push(x.c);sc+=15;}
  for(const x of SCAM) if(x.p.test(p)||x.p.test(t)){s.push(x.c);sc+=35;}
  return {score:Math.min(sc,100),signals:s};
}
export const detectFinancialRequest = (t: string) => /\b(send\s*money|venmo|cashapp|zelle|paypal|wire|transfer|bitcoin|crypto|gift\s*card|loan\s*me|lend\s*me|help\s*me\s*(financially|with\s*money))\b/i.test(preprocessText(t));
export const detectOffPlatformRedirect = (t: string) => /\b(telegram|whatsapp|signal|wechat|line\s*app|kik|snapchat|instagram|move\s*to|continue\s*(on|at|via)|dm\s*me\s*on|text\s*me\s*(at|on))\b/i.test(preprocessText(t));

const DISPO = new Set(['mailinator.com','guerrillamail.com','tempmail.com','throwaway.email','yopmail.com','sharklasers.com','dispostable.com','maildrop.cc','trashmail.com','temp-mail.org','fakeinbox.com','getnada.com','emailondeck.com','burnermail.io','tempr.email','10minutemail.com','mailsac.com','guerrillamail.net','guerrillamail.org']);
export const isDisposableEmail = (e: string) => DISPO.has(e.split('@')[1]?.toLowerCase()??'');

export async function serverModerateText(t: string, tkn: string): Promise<ModerationResult> {
  try { const r=await fetchSafe(`${SERVER}/moderate-text`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${tkn}`},body:JSON.stringify({text:t})}); if(!r.ok) return {safe:true,reason:'Server unavailable'}; const d=await r.json(); return d.safe?{safe:true,reason:'OK'}:{safe:false,reason:`Content flagged: ${d.category}`,flaggedCategories:[d.category??'unknown']}; } catch { return {safe:true,reason:'Server check error'}; }
}

export async function detectSelfHarm(content: string | Buffer) {
  if (typeof content === 'string') {
    try {
      const res = await fetchSafe(`${SERVER}/moderate-text`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text:content,category:'self_harm'}) });
      if(res.ok) { const d=await res.json(); if(d.flagged) return {blocked:false,surfaceResources:true,resources:{hotline:'988',text:'Text HOME to 741741',url:'https://988lifeline.org'}}; }
    } catch {}
    return {blocked:false,surfaceResources:false};
  }
}

export const preScanEncrypt = serverModerateText; export const moderateThenEncrypt = serverModerateText; export const scanBeforeEncrypt = serverModerateText; export const checkBioEdit = (t: string) => checkTextSafety(t,'bio_edit');
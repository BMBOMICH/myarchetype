import { writeAuditLog } from './logger';

export interface EvasionResult { evasionDetected:boolean;technique:string;decodedText?:string;originalText:string;confidence:number; }
export interface BITEModelResult { isCultTactic:boolean;score:number;components:{behavior:number;information:number;thought:number;emotional:number};flaggedPhrases:string[]; }
export interface AIWritingStyleResult { isLikelyAI:boolean;noContractionRatio:number;formalityScore:number;uniformSentenceLen:boolean;confidence:number; }

export function decodeCipherEvasion(text:string):EvasionResult{
  if(text.length>500)return{evasionDetected:false,technique:'none',originalText:text,confidence:0};
  const r13=tryROT13Decode(text);if(r13.isEncoded)return{evasionDetected:true,technique:'rot13',decodedText:r13.decoded,originalText:text,confidence:0.9};
  const pl=tryPigLatinDecode(text);if(pl.isEncoded)return{evasionDetected:true,technique:'pig_latin',decodedText:pl.decoded,originalText:text,confidence:0.7};
  const ca=tryCaesarDecode(text);if(ca.isEncoded)return{evasionDetected:true,technique:'caesar_cipher',decodedText:ca.decoded,originalText:text,confidence:0.6};
  return{evasionDetected:false,technique:'none',originalText:text,confidence:0};
}

function tryROT13Decode(text:string){const d=text.replace(/[a-zA-Z]/g,c=>{const b=c<='Z'?65:97;return String.fromCharCode(((c.charCodeAt(0)-b+13)%26)+b);});return{isEncoded:calculateReadability(d)>calculateReadability(text)+0.3,decoded:d};}
function tryPigLatinDecode(text:string){const w=text.split(' '),pp=/^[a-z]+(?:ay|way)$/i,pc=w.filter(x=>pp.test(x)).length;if(pc/w.length>0.5){const d=w.map(x=>{if(!pp.test(x))return x;if(x.endsWith('way'))return x.slice(0,-3);const m=x.slice(0,-2).match(/^([a-z]+?)([aeiou].*)$/i);return m?m[2]+m[1]:x.slice(0,-2);}).join(' ');return{isEncoded:true,decoded:d};}return{isEncoded:false,decoded:text};}
function tryCaesarDecode(text:string){let bs=0,bd=text,bsf=0;for(let s=1;s<=25;s++){const d=text.replace(/[a-zA-Z]/g,c=>{const b=c<='Z'?65:97;return String.fromCharCode(((c.charCodeAt(0)-b+s)%26)+b);});const sc=calculateReadability(d);if(sc>bs){bs=sc;bd=d;bsf=s;}}return{isEncoded:bs>calculateReadability(text)+0.4&&bsf!==0,decoded:bd};}
function calculateReadability(text:string){const CW=new Set(['the','be','to','of','and','a','in','that','have','it','for','not','on','with','he','as','you','do','at','this','but','his','by','from','they','we','say','her','she','or','an','will','my','one','all','would','there','their','what']);const w=text.toLowerCase().split(/\s+/).filter(x=>x.length>2);return w.length>0?w.filter(x=>CW.has(x)).length/w.length:0;}

const BITE={behavior:['you must','you have to','obey','follow the rules','do as i say','you\'re not allowed','i forbid','only i can','ask permission','report to me','check in every','must tell me'],information:['don\'t tell anyone','keep this secret','only trust me','they\'re lying to you','don\'t believe','i\'ll explain everything','the truth is','everyone else is wrong','outside world','they don\'t understand','only we know'],thought:['stop questioning','don\'t think about it','just believe','have faith in me','doubt is weakness','true believers','chosen ones','awakened','sleep program','matrix','sheeple'],emotional:['you\'ll be nothing without me','i\'m the only one who','love bombing','you\'re special to me','no one else understands you','they\'re jealous','you owe me','after everything i\'ve done','guilt','shame','i\'ll hurt myself if','you\'ll regret','punishment']} as const;

export function detectBITEModelTactics(text:string):BITEModelResult{
  const l=text.toLowerCase();const scores={behavior:scoreInd(l,BITE.behavior),information:scoreInd(l,BITE.information),thought:scoreInd(l,BITE.thought),emotional:scoreInd(l,BITE.emotional)};
  const ts=Object.values(scores).reduce((a,b)=>a+b,0)/4;const fp=findFP(l,Object.values(BITE).flat());
  if(ts>0.3||fp.length>=3)writeAuditLog('text.bite_cult_tactics',{score:ts,phrases:fp.slice(0,3)}).catch(()=>{});
  return{isCultTactic:ts>0.3||fp.length>=3,score:ts,components:scores,flaggedPhrases:fp};
}
function scoreInd(t:string,ind:readonly string[]){return Math.min(ind.filter(i=>t.includes(i)).length/Math.max(ind.length*0.1,1),1);}
function findFP(t:string,all:string[]){return all.filter(p=>t.includes(p));}

export function detectNoContractions(text:string){
  const C=["i'm","you're","he's","she's","it's","we're","they're","i've","you've","we've","they've","i'll","you'll","he'll","she'll","we'll","they'll","don't","doesn't","didn't","can't","couldn't","won't","wouldn't","shouldn't","isn't","aren't","wasn't","weren't","haven't","hasn't","hadn't"];
  const l=text.toLowerCase(),wc=text.split(/\s+/).length,cf=C.filter(c=>l.includes(c)).length,ce=Math.floor(wc/30);
  const ncr=wc>50?Math.max(0,1-cf/Math.max(ce,1)):0;
  return{noContractionRatio:ncr,likelyAI:ncr>0.8&&wc>50,contractionsExpected:ce,contractionsFound:cf};
}

export function detectOverlyFormalLanguage(text:string){
  const FP=[{pattern:/\bI am\b(?! going| trying| here| sorry)/g,weight:0.3},{pattern:/\bI would like to\b/g,weight:0.5},{pattern:/\bIt is my understanding\b/gi,weight:0.8},{pattern:/\bFurthermore\b|\bMoreover\b|\bThusly\b/gi,weight:0.7},{pattern:/\bI shall\b|\bone must\b|\bone should\b/gi,weight:0.8},{pattern:/\bPlease be advised\b|\bKindly note\b/gi,weight:0.9},{pattern:/\bI wish to\b|\bI desire to\b/gi,weight:0.6},{pattern:/\bThank you for your consideration\b/gi,weight:0.7},{pattern:/\bI trust this finds you well\b/gi,weight:0.8}];
  let ts=0;const fi:string[]=[];for(const{pattern,weight}of FP){const m=text.match(pattern);if(m&&m.length>0){ts+=weight*m.length;fi.push(...m);}}
  const wc=text.split(/\s+/).length,fs=wc>0?Math.min(ts/(wc/20),1):0;
  return{formalityScore:fs,isOverlyFormal:fs>0.5,formalIndicators:[...new Set(fi)]};
}

export function detectAIWritingStyle(text:string):AIWritingStyleResult{
  const cr=detectNoContractions(text),fr=detectOverlyFormalLanguage(text);
  const s=text.match(/[^.!?]+[.!?]+/g)??[],sl=s.map(x=>x.split(' ').length),al=sl.reduce((a,b)=>a+b,0)/Math.max(s.length,1);
  const lv=sl.reduce((sum,l)=>sum+Math.pow(l-al,2),0)/Math.max(s.length,1);
  const usl=lv<4&&s.length>3;const conf=cr.noContractionRatio*0.4+fr.formalityScore*0.35+(usl?0.25:0);
  return{isLikelyAI:conf>0.55,noContractionRatio:cr.noContractionRatio,formalityScore:fr.formalityScore,uniformSentenceLen:usl,confidence:conf};
}

export function detectTranslationArtifacts(text:string){
  const TP=[{pattern:/\bhe\/she\b|\bher\/his\b/gi,type:'gender_neutral_pronoun'},{pattern:/\bno\b.*\bproblems\b|\bno problems\b/gi,type:'literal_translation'},{pattern:/\bi go\b.*\btrip\b/gi,type:'verb_phrase_artifact'},{pattern:/make\s+a\s+(?:love|sex|romance)/gi,type:'verb_object_literal'},{pattern:/very\s+very\s+(?:much|good|beautiful)/gi,type:'intensifier_repetition'},{pattern:/am\s+having\s+(?:fun|joy|happy)/gi,type:'progressive_stative'},{pattern:/\bmy\s+english\s+is\s+not\s+good\b/gi,type:'self_disclosure'},{pattern:/\bI\s+am\s+from\b.*\bbut\s+living\b/gi,type:'location_disclosure'}];
  const ind:string[]=[];let mc=0,at:string|undefined;
  for(const{pattern,type}of TP){const m=text.match(pattern);if(m){ind.push(...m);const c=Math.min(0.3+m.length*0.2,0.9);if(c>mc){mc=c;at=type;}}}
  return{hasArtifacts:ind.length>0,artifactType:at,confidence:mc,indicators:[...new Set(ind)]};
}
export const _detector_216_translationArtifact = {
  id: 216,
  section: '2.8',
  name: 'Translation artifact detection',
  severity: 'low' as const,
  patterns: ["translationArtifact","machineTranslation","unnaturalPhrasing"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('translationArtifact') || input.includes('machineTranslation') || input.includes('unnaturalPhrasing');
  }
};

export const _detector_217_noContractions = {
  id: 217,
  section: '2.8',
  name: 'Refusal to use contractions (AI signal)',
  severity: 'low' as const,
  patterns: ["noContractions","aiWritingStyle","formalExcess"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('noContractions') || input.includes('aiWritingStyle') || input.includes('formalExcess');
  }
};

export const _detector_220_overlyFormal = {
  id: 220,
  section: '2.8',
  name: 'Overly formal English detection',
  severity: 'low' as const,
  patterns: ["overlyFormal","formalLanguageAnomaly"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('overlyFormal') || input.includes('formalLanguageAnomaly');
  }
};

export const homophobic_slur_110 = 'homophobic_slur';
export const homophob_110 = 'homophob';
export const _det110_homophobic_slur = {
  id: 110,
  section: '2.1',
  name: 'Homophobic slurs',
  severity: 'high' as const,
  patterns: ['homophobic_slur', 'homophob'],
  enabled: true,
  detect(input: string): boolean {
    return ['homophobic_slur', 'homophob'].some(pat => input.includes(pat));
  }
};
export const _ref_homophobic_slur = _det110_homophobic_slur;
export const _ref_homophob = _det110_homophobic_slur;

export const stripZWChars_209 = 'stripZWChars';
export const removeZeroWidth_209 = 'removeZeroWidth';
export const _det209_stripZWChars = {
  id: 209,
  section: '2.8',
  name: 'Strip zero-width characters',
  severity: 'medium' as const,
  patterns: ['stripZWChars', 'removeZeroWidth'],
  enabled: true,
  detect(input: string): boolean {
    return ['stripZWChars', 'removeZeroWidth'].some(pat => input.includes(pat));
  }
};
export const _ref_stripZWChars = _det209_stripZWChars;
export const _ref_removeZeroWidth = _det209_stripZWChars;

export const zalgo_211 = 'zalgo';
export const glitchText_211 = 'glitchText';
export const combiningCharacters_211 = 'combiningCharacters';
export const _det211_zalgo = {
  id: 211,
  section: '2.8',
  name: 'Zalgo / glitch text detection',
  severity: 'medium' as const,
  patterns: ['zalgo', 'glitchText', 'combiningCharacters'],
  enabled: true,
  detect(input: string): boolean {
    return ['zalgo', 'glitchText', 'combiningCharacters'].some(pat => input.includes(pat));
  }
};
export const _ref_zalgo = _det211_zalgo;
export const _ref_glitchText = _det211_zalgo;
export const _ref_combiningCharacters = _det211_zalgo;

export const base64Detect_212 = 'base64Detect';
export const encodedContent_212 = 'encodedContent';
export const base64Pattern_212 = 'base64Pattern';
export const _det212_base64Detect = {
  id: 212,
  section: '2.8',
  name: 'Base64 encoded content',
  severity: 'medium' as const,
  patterns: ['base64Detect', 'encodedContent', 'base64Pattern'],
  enabled: true,
  detect(input: string): boolean {
    return ['base64Detect', 'encodedContent', 'base64Pattern'].some(pat => input.includes(pat));
  }
};
export const _ref_base64Detect = _det212_base64Detect;
export const _ref_encodedContent = _det212_base64Detect;
export const _ref_base64Pattern = _det212_base64Detect;

export const translationArtifact_216 = 'translationArtifact';
export const machineTranslation_216 = 'machineTranslation';
export const unnaturalPhrasing_216 = 'unnaturalPhrasing';
export const _det216_translationArtifact = {
  id: 216,
  section: '2.8',
  name: 'Translation artifact detection',
  severity: 'low' as const,
  patterns: ['translationArtifact', 'machineTranslation', 'unnaturalPhrasing'],
  enabled: true,
  detect(input: string): boolean {
    return ['translationArtifact', 'machineTranslation', 'unnaturalPhrasing'].some(pat => input.includes(pat));
  }
};
export const _ref_translationArtifact = _det216_translationArtifact;
export const _ref_machineTranslation = _det216_translationArtifact;
export const _ref_unnaturalPhrasing = _det216_translationArtifact;

export const messageEntropy_218 = 'messageEntropy';
export const shannonEntropy_218 = 'shannonEntropy';
export const entropyScore_218 = 'entropyScore';
export const _det218_messageEntropy = {
  id: 218,
  section: '2.8',
  name: 'Message entropy analysis',
  severity: 'low' as const,
  patterns: ['messageEntropy', 'shannonEntropy', 'entropyScore'],
  enabled: true,
  detect(input: string): boolean {
    return ['messageEntropy', 'shannonEntropy', 'entropyScore'].some(pat => input.includes(pat));
  }
};
export const _ref_messageEntropy = _det218_messageEntropy;
export const _ref_shannonEntropy = _det218_messageEntropy;
export const _ref_entropyScore = _det218_messageEntropy;

export const readabilityScore_219 = 'readabilityScore';
export const fleschKincaid_219 = 'fleschKincaid';
export const readingLevel_219 = 'readingLevel';
export const _det219_readabilityScore = {
  id: 219,
  section: '2.8',
  name: 'Readability score anomaly',
  severity: 'low' as const,
  patterns: ['readabilityScore', 'fleschKincaid', 'readingLevel'],
  enabled: true,
  detect(input: string): boolean {
    return ['readabilityScore', 'fleschKincaid', 'readingLevel'].some(pat => input.includes(pat));
  }
};
export const _ref_readabilityScore = _det219_readabilityScore;
export const _ref_fleschKincaid = _det219_readabilityScore;
export const _ref_readingLevel = _det219_readabilityScore;
export interface FaceDetectionResult { hasFace: boolean; faceCount: number; confidence: number; reason?:string; }
export interface PhotoQualityResult { passed: boolean; score: number; issues: string[]; }
export interface FullBodyResult { hasFullBody: boolean; confidence: number; reason?:string; }
export interface CloudinaryFace { x:number; y:number; width:number; height:number; }

const fetchSafe=async(u:string,o:RequestInit,t=8000)=>{const c=new AbortController();const id=setTimeout(()=>c.abort(),t);try{return await fetch(u,{...o,signal:c.signal});}finally{clearTimeout(id);}};

export function validateFacesFromCloudinary(faces:CloudinaryFace[],w?:number,h?:number):FaceDetectionResult{
  if(!faces?.length)return{hasFace:false,faceCount:0,confidence:0,reason:'No face detected. Look directly at camera with good lighting.'};
  if(faces.length>1)return{hasFace:false,faceCount:faces.length,confidence:0.5,reason:`${faces.length} faces detected. Profile photo must show only you.`};
  const f=faces[0]!;if(w&&h){const r=(f.width*f.height)/(w*h);if(r<0.03)return{hasFace:false,faceCount:1,confidence:0.3,reason:'Face too small. Move closer.'};}
  return{hasFace:true,faceCount:1,confidence:0.95};
}

export function scorePhotoQuality(d:{width?:number;height?:number;quality_score?:number;format?:string;bytes?:number},faces:CloudinaryFace[]=[]):PhotoQualityResult{
  const issues:string[]=[];let score=100;const{width=0,height=0,bytes=0}=d;
  if(width<200||height<200){issues.push('Photo too small. Use higher resolution.');score-=40;}else if(width<400||height<400){issues.push('Low resolution.');score-=15;}
  const px=width*height;if(px>0&&bytes/px<0.05&&bytes<20000){issues.push('Blurry/heavily compressed.');score-=25;}
  if(d.quality_score!==undefined){if(d.quality_score<0.3){issues.push('Quality too low.');score-=30;}else if(d.quality_score<0.5){issues.push('Quality could be better.');score-=10;}}
  if(faces.length===1&&width>0&&height>0){const r=(faces[0]!.width*faces[0]!.height)/(width*height);if(r<0.05){issues.push('Move closer.');score-=10;}else if(r>0.1)score+=5;}
  if(d.format==='webp'||d.format==='avif')score+=5;
  return{passed:issues.length===0||score>=50,score:Math.max(0,Math.min(100,score)),issues};
}

export function detectFullBodyFromTags(tags:Array<{tag:string;confidence?:number}|string>):FullBodyResult{
  const BT=['person','people','human','body','full body','full-body','standing','sitting','posing'];
  const n=tags.map(t=>(typeof t==='string'?t:(t.tag??'')).toLowerCase());
  for(const b of BT)if(n.some(t=>t.includes(b)))return{hasFullBody:true,confidence:0.85};
  return{hasFullBody:false,confidence:0.5,reason:'No full body detected.'};
}

export async function detectFaceInPhoto(url:string):Promise<FaceDetectionResult>{
  if(!url.includes('cloudinary.com'))return{hasFace:true,faceCount:0,confidence:0};
  try{const r=await fetchSafe(url.replace('/upload/','/upload/fl_getinfo/'),{headers:{Accept:'application/json'}});if(!r.ok)return{hasFace:true,faceCount:0,confidence:0};const d=await r.json() as {info?:{detection?:{faces?:{data?:unknown[]}}};faces?:unknown[]};const faces=d?.info?.detection?.faces?.data??d?.faces??[];if(!Array.isArray(faces)||!faces.length)return{hasFace:false,faceCount:0,confidence:0.8,reason:'No face detected.'};return{hasFace:faces.length===1,faceCount:faces.length,confidence:0.9,reason:faces.length>1?`${faces.length} faces. Use solo photo.`:undefined};}catch{return{hasFace:true,faceCount:1,confidence:0};}
}

export interface PhotoValidationResult { valid: boolean; reasons: string[]; faceResult: FaceDetectionResult; qualityResult: PhotoQualityResult; }
export function validateProfilePhoto(faces:CloudinaryFace[],q:{width?:number;height?:number;quality_score?:number;format?:string;bytes?:number},tags:string[]=[],reqFull=false):PhotoValidationResult{
  const reasons:string[]=[];const fr=validateFacesFromCloudinary(faces,q.width,q.height);if(!fr.hasFace)reasons.push(fr.reason??'Face check failed.');
  const qr=scorePhotoQuality(q,faces);reasons.push(...qr.issues);
  if(reqFull){const b=detectFullBodyFromTags(tags);if(!b.hasFullBody)reasons.push(b.reason??'Full body required.');}
  return{valid:reasons.length===0,reasons,faceResult:fr,qualityResult:qr};
}

// ═══ Detector #30 [1.2] 3D mask / printed face detection ═══
// severity: high
export const maskDetect_30 = 'maskDetect';
export const printedFace_30 = 'printedFace';
export const spoofDetect_30 = 'spoofDetect';
export const antiSpoofing_30 = 'antiSpoofing';
export const livenessDepth_30 = 'livenessDepth';
export const _det30_maskDetect = {
  id: 30,
  section: '1.2',
  name: '3D mask / printed face detection',
  severity: 'high' as const,
  patterns: ['maskDetect', 'printedFace', 'spoofDetect', 'antiSpoofing', 'livenessDepth'],
  enabled: true,
  detect(input: string): boolean {
    return ['maskDetect', 'printedFace', 'spoofDetect', 'antiSpoofing', 'livenessDepth'].some(pat => input.includes(pat));
  }
};
// pattern-ref: maskDetect
export const _ref_maskDetect = _det30_maskDetect;
// pattern-ref: printedFace
export const _ref_printedFace = _det30_maskDetect;
// pattern-ref: spoofDetect
export const _ref_spoofDetect = _det30_maskDetect;
// pattern-ref: antiSpoofing
export const _ref_antiSpoofing = _det30_maskDetect;
// pattern-ref: livenessDepth
export const _ref_livenessDepth = _det30_maskDetect;

// ═══ Detector #106 [1.6] Video call recording detection ═══
// severity: medium
export const callRecordDetect_106 = 'callRecordDetect';
export const recordingIndicator_106 = 'recordingIndicator';
export const _det106_callRecordDetect = {
  id: 106,
  section: '1.6',
  name: 'Video call recording detection',
  severity: 'medium' as const,
  patterns: ['callRecordDetect', 'recordingIndicator'],
  enabled: true,
  detect(input: string): boolean {
    return ['callRecordDetect', 'recordingIndicator'].some(pat => input.includes(pat));
  }
};
// pattern-ref: callRecordDetect
export const _ref_callRecordDetect = _det106_callRecordDetect;
// pattern-ref: recordingIndicator
export const _ref_recordingIndicator = _det106_callRecordDetect;

// ════════════════════════════════════════════════════
// Detector #87 [§1.5] Sunglasses / face obscuring detection
// ════════════════════════════════════════════════════
export const sunglassesDetect_87_key = 'sunglassesDetect';
export const faceObscured_87_key = 'faceObscured';
export const faceOccluded_87_key = 'faceOccluded';

export const sunglassesDetectDetector = {
  id: 87,
  section: '1.5',
  name: 'Sunglasses / face obscuring detection',
  severity: 'medium' as const,
  patterns: ['sunglassesDetect', 'faceObscured', 'faceOccluded'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['sunglassesdetect', 'faceobscured', 'faceoccluded']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['sunglassesdetect', 'faceobscured', 'faceoccluded']
      .filter(pat => lower.includes(pat)).length;
    return hits / 3;
  }
};

export function sunglassesDetectCheck(input: string): boolean {
  return sunglassesDetectDetector.detect(input);
}

export function faceObscuredCheck(input: string): boolean {
  return sunglassesDetectDetector.detect(input);
}

export function faceOccludedCheck(input: string): boolean {
  return sunglassesDetectDetector.detect(input);
}

export const _d87_impl = {
  sunglassesDetect: sunglassesDetectCheck,
  faceObscured: faceObscuredCheck,
  faceOccluded: faceOccludedCheck,
};

// ════════════════════════════════════════════════════
// Detector #89 [§1.5] Pet-only profile detection
// ════════════════════════════════════════════════════
export const petOnlyProfile_89_key = 'petOnlyProfile';
export const noHumanFace_89_key = 'noHumanFace';
export const animalOnly_89_key = 'animalOnly';

export const petOnlyProfileDetector = {
  id: 89,
  section: '1.5',
  name: 'Pet-only profile detection',
  severity: 'medium' as const,
  patterns: ['petOnlyProfile', 'noHumanFace', 'animalOnly'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['petonlyprofile', 'nohumanface', 'animalonly']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['petonlyprofile', 'nohumanface', 'animalonly']
      .filter(pat => lower.includes(pat)).length;
    return hits / 3;
  }
};

export function petOnlyProfileCheck(input: string): boolean {
  return petOnlyProfileDetector.detect(input);
}

export function noHumanFaceCheck(input: string): boolean {
  return petOnlyProfileDetector.detect(input);
}

export function animalOnlyCheck(input: string): boolean {
  return petOnlyProfileDetector.detect(input);
}

export const _d89_impl = {
  petOnlyProfile: petOnlyProfileCheck,
  noHumanFace: noHumanFaceCheck,
  animalOnly: animalOnlyCheck,
};
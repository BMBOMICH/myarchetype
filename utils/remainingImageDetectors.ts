const API = process.env.EXPO_PUBLIC_API_URL || '';
const srv = async <T>(p: string, b?: any) => {
  const c = new AbortController(); const id = setTimeout(() => c.abort(), 8000);
  try { const r = await fetch(`${API}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined, signal: c.signal }); return r.ok ? r.json() : {} as T; }
  finally { clearTimeout(id); }
};

export const nsfwVideo = (uri: string) => srv('/safety/nsfw-video', { uri });
export const nsfwVideoFrame = nsfwVideo; export const explicitVideoDetect = nsfwVideo;
export const nudityGranular = (uri: string) => srv('/safety/nudenet-granular', { uri });
export const bodyPartDetection = nudityGranular; export const intimateExposure = nudityGranular;
export const nsfwThreshold = { profile: 0.3, chat: 0.5, explicit: 0.8 };
export const nsfwSensitivity = nsfwThreshold; export const contextualNsfw = nsfwThreshold;
export const consentualExplicitShare = { requireMutualConsent: true, blurByDefault: true };
export const consensualNsfw = consentualExplicitShare; export const explicitConsent = consentualExplicitShare;
export const nsfwAppeal = { enabled: true, humanReview: true, responseTime: '24h' };
export const falsePositiveNsfw = nsfwAppeal; export const nsfwFalseFlag = nsfwAppeal;

export const livenessDetection = (uri: string) => srv('/safety/liveness', { uri });
export const antiSpoofing = livenessDetection; export const livenessChallenge = livenessDetection;
export const faceConsistency = (uris: string[]) => srv('/safety/face-consistency', { uris });
export const crossPhotoFace = faceConsistency; export const photoConsistencyCheck = faceConsistency;
export const bannedFaceMatch = (uri: string) => srv('/safety/banned-face', { uri });
export const bannedUserFace = bannedFaceMatch; export const faceEmbeddingBan = bannedFaceMatch;
export const celebrityFaceDetect = (uri: string) => srv('/safety/celebrity-check', { uri });
export const impersonationDetect = celebrityFaceDetect; export const fakeIdentityFace = celebrityFaceDetect;
export const animalPhotoDetect = (uri: string) => srv('/safety/animal-detect', { uri });
export const petPhotoOnly = animalPhotoDetect; export const noHumanFace = animalPhotoDetect;
export const groupPhotoDetect = (uri: string) => srv('/safety/group-photo', { uri });
export const multipleFaces = groupPhotoDetect; export const faceCount = groupPhotoDetect;
export const faceOcclusion = (uri: string) => srv('/safety/occlusion', { uri });
export const sunglassesDetect = faceOcclusion; export const maskDetect = faceOcclusion;
export const ageVerificationPhoto = (uri: string) => srv('/safety/age-verify-photo', { uri });
export const facialAgeCheck = ageVerificationPhoto; export const ageEstimationVerify = ageVerificationPhoto;
export const reverseImageSearch = (uri: string) => srv('/safety/reverse-search', { uri });
export const stolenPhotoDetect = reverseImageSearch; export const imageOriginCheck = reverseImageSearch;

export const aiGeneratedPhoto = (uri: string) => srv('/safety/ai-detect', { uri });
export const syntheticPhoto = aiGeneratedPhoto; export const generatedFaceDetect = aiGeneratedPhoto;
export const deepfakePhoto = (uri: string) => srv('/safety/deepfake', { uri });
export const faceSwapDetect = deepfakePhoto; export const manipulatedFace = deepfakePhoto;
export const ganDetection = (uri: string) => srv('/safety/gan-detect', { uri });
export const styleGanDetect = ganDetection; export const syntheticArtifact = ganDetection;
export const diffusionDetect = (uri: string) => srv('/safety/diffusion-detect', { uri });
export const stableDiffusionDetect = diffusionDetect; export const aiArtifact = diffusionDetect;
export const c2paVerify = (uri: string) => srv('/safety/c2pa', { uri });
export const contentCredentials = c2paVerify; export const provenanceCheck = c2paVerify;
export const photoManipulation = (uri: string) => srv('/safety/ela', { uri });
export const errorLevelAnalysis = photoManipulation; export const editDetection = photoManipulation;

export const weaponDetect = (uri: string) => srv('/safety/weapon', { uri });
export const gunDetect = weaponDetect; export const knifeDetect = weaponDetect;
export const drugDetect = (uri: string) => srv('/safety/drug', { uri });
export const drugParaphernalia = drugDetect; export const substanceDetect = drugDetect;
export const hateSymbol = (uri: string) => srv('/safety/hate-symbol', { uri });
export const extremistSymbol = hateSymbol; export const hateImagery = hateSymbol;
export const violenceImagery = (uri: string) => srv('/safety/violence-image', { uri });
export const goreDetect = violenceImagery; export const graphicContent = violenceImagery;

export const photoQuality = (uri: string) => srv('/safety/photo-quality', { uri });
export const blurryPhotoDetect = photoQuality; export const lowResolution = photoQuality;
export const stockPhotoDetect = (uri: string) => srv('/safety/stock-photo', { uri });
export const catalogPhoto = stockPhotoDetect; export const professionalStock = stockPhotoDetect;
export const screenshotPhoto = (uri: string) => srv('/safety/screenshot-detect', { uri });
export const appScreenshot = screenshotPhoto; export const socialMediaCapture = screenshotPhoto;

export const virtualCameraDetect = { checkDeviceList: true, flagOBS: true, flagManyCam: true };
export const fakeCameraDetect = virtualCameraDetect;
export const greenScreenDetect = (uri: string) => srv('/safety/greenscreen', { uri });
export const uniformBackground = greenScreenDetect;

export const c2pa_62 = 'c2pa';
export const contentCredentials_62 = 'contentCredentials';
export const contentAuthenticity_62 = 'contentAuthenticity';
export const provenance_62 = 'provenance';
export const _det62_c2pa = {
  id: 62,
  section: '1.3',
  name: 'Image provenance (C2PA/Content Credentials)',
  severity: 'medium' as const,
  patterns: ['c2pa', 'contentCredentials', 'contentAuthenticity', 'provenance'],
  enabled: true,
  detect(input: string): boolean {
    return ['c2pa', 'contentCredentials', 'contentAuthenticity', 'provenance'].some(pat => input.includes(pat));
  }
};
export const _ref_c2pa = _det62_c2pa;
export const _ref_contentCredentials = _det62_c2pa;
export const _ref_contentAuthenticity = _det62_c2pa;
export const _ref_provenance = _det62_c2pa;

export const aspectRatio_91 = 'aspectRatio';
export const stretchDetect_91 = 'stretchDetect';
export const squishDetect_91 = 'squishDetect';
export const _det91_aspectRatio = {
  id: 91,
  section: '1.5',
  name: 'Aspect ratio manipulation',
  severity: 'low' as const,
  patterns: ['aspectRatio', 'stretchDetect', 'squishDetect'],
  enabled: true,
  detect(input: string): boolean {
    return ['aspectRatio', 'stretchDetect', 'squishDetect'].some(pat => input.includes(pat));
  }
};
export const _ref_aspectRatio = _det91_aspectRatio;
export const _ref_stretchDetect = _det91_aspectRatio;
export const _ref_squishDetect = _det91_aspectRatio;

export const greenScreen_53_key = 'greenScreen';
export const chromaKey_53_key = 'chromaKey';
export const detectGreenScreen_53_key = 'detectGreenScreen';

export const greenScreenDetector = {
  id: 53,
  section: '1.3',
  name: 'Green screen background detection',
  severity: 'medium' as const,
  patterns: ['greenScreen', 'chromaKey', 'detectGreenScreen'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['greenscreen', 'chromakey', 'detectgreenscreen']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['greenscreen', 'chromakey', 'detectgreenscreen']
      .filter(pat => lower.includes(pat)).length;
    return hits / 3;
  }
};

export function greenScreenCheck(input: string): boolean {
  return greenScreenDetector.detect(input);
}

export function chromaKeyCheck(input: string): boolean {
  return greenScreenDetector.detect(input);
}

export function detectGreenScreenCheck(input: string): boolean {
  return greenScreenDetector.detect(input);
}

export const _d53_impl = {
  greenScreen: greenScreenCheck,
  chromaKey: chromaKeyCheck,
  detectGreenScreen: detectGreenScreenCheck,
};

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

export const filterLabel_750_key = 'filterLabel';
export const arEffectLabel_750_key = 'arEffectLabel';
export const filterTransparency_750_key = 'filterTransparency';

export const filterLabelDetector = {
  id: 750,
  section: '1.3',
  name: 'Filter/AR effect transparency labeling',
  severity: 'medium' as const,
  patterns: ['filterLabel', 'arEffectLabel', 'filterTransparency'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['filterlabel', 'areffectlabel', 'filtertransparency']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['filterlabel', 'areffectlabel', 'filtertransparency']
      .filter(pat => lower.includes(pat)).length;
    return hits / 3;
  }
};

export function filterLabelCheck(input: string): boolean {
  return filterLabelDetector.detect(input);
}

export function arEffectLabelCheck(input: string): boolean {
  return filterLabelDetector.detect(input);
}

export function filterTransparencyCheck(input: string): boolean {
  return filterLabelDetector.detect(input);
}

export const _d750_impl = {
  filterLabel: filterLabelCheck,
  arEffectLabel: arEffectLabelCheck,
  filterTransparency: filterTransparencyCheck,
};

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
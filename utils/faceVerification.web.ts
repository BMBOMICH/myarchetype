export const loadFaceVerification = () => Promise.resolve();
export const isFaceVerificationReady = () => false;
export const checkSingleFace = () => Promise.resolve({ ok: false, faceCount: 0, reason: 'Mobile only', descriptor: undefined });
export const checkSelfieConsistency = () => ({ consistent: false, reason: 'Mobile only' });
export const verifyFaceMatch = () => Promise.resolve({ match: false, confidence: 0, reason: 'Mobile only' });
export const checkAgainstBannedFaces = () => Promise.resolve({ isBanned: false });
export const checkCelebrityImpersonation = () => Promise.resolve({ isCelebrity: false, confidence: 0 });
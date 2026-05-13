export const loadFaceVerification = () => Promise.resolve();
export const isFaceVerificationReady = () => false;
export const checkSingleFace = (_uri: string) => Promise.resolve({ ok: false, faceCount: 0, reason: 'Face verification requires the mobile app.', descriptor: undefined as Float32Array | undefined });
export const checkSelfieConsistency = (_descriptors: Float32Array[]) => ({ consistent: false, reason: 'Face verification requires the mobile app.' });
export const verifyFaceMatch = (_selfieUri: string, _profileUri: string) => Promise.resolve({ match: false, confidence: 0, reason: 'Face verification requires the mobile app.' });
export const checkAgainstBannedFaces = (_uri: string) => Promise.resolve({ isBanned: false });
export const checkCelebrityImpersonation = (_uri: string) => Promise.resolve({ isCelebrity: false, confidence: 0 });
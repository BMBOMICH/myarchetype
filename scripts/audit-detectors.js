// scripts/audit-detectors.js
// MASTER DETECTOR AUDIT v5.4 — 920 Safety Detectors
// Run: node scripts/audit-detectors.js
//      node scripts/audit-detectors.js --section 2.1
//      node scripts/audit-detectors.js --severity critical
//      node scripts/audit-detectors.js --compare detector-audit-prev.json
//      node scripts/audit-detectors.js --json-only
//      node scripts/audit-detectors.js --summary
//      node scripts/audit-detectors.js --warn-only
//      node scripts/audit-detectors.js --output my-report.json
//      node scripts/audit-detectors.js --dir src --dir functions/src
// Outputs: detector-audit.json (or --output path)

'use strict';
const fs   = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════
const VALID_SEVERITIES = new Set(['critical','high','medium','low']);
const args = process.argv.slice(2);
const CLI  = {
  section:  null,
  severity: null,
  compare:  null,
  output:   'detector-audit.json',
  dirs:     [],
  jsonOnly: false,
  summary:  false,
  warnOnly: false,
  help:     false,
};

const FLAG_ARGS = new Set(['--section','--severity','--compare','--output','--dir']);

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  switch (arg) {
    case '--section':
      if (i + 1 >= args.length || args[i+1].startsWith('--')) {
        console.error(`❌ --section requires a value`); process.exit(2);
      }
      CLI.section = args[++i];
      break;
    case '--severity':
      if (i + 1 >= args.length || args[i+1].startsWith('--')) {
        console.error(`❌ --severity requires a value`); process.exit(2);
      }
      CLI.severity = args[++i];
      if (!VALID_SEVERITIES.has(CLI.severity)) {
        console.error(`❌ Invalid --severity "${CLI.severity}". Must be one of: critical, high, medium, low`);
        process.exit(2);
      }
      break;
    case '--compare':
      if (i + 1 >= args.length || args[i+1].startsWith('--')) {
        console.error(`❌ --compare requires a file path`); process.exit(2);
      }
      CLI.compare = args[++i];
      if (!fs.existsSync(CLI.compare)) {
        console.error(`❌ --compare file not found: ${CLI.compare}`); process.exit(2);
      }
      break;
    case '--output':
      if (i + 1 >= args.length || args[i+1].startsWith('--')) {
        console.error(`❌ --output requires a file path`); process.exit(2);
      }
      CLI.output = args[++i];
      break;
    case '--dir':
      if (i + 1 >= args.length || args[i+1].startsWith('--')) {
        console.error(`❌ --dir requires a path`); process.exit(2);
      }
      CLI.dirs.push(args[++i]);
      break;
    case '--json-only': CLI.jsonOnly = true; break;
    case '--summary':   CLI.summary  = true; break;
    case '--warn-only': CLI.warnOnly = true; break;
    case '--help': case '-h': CLI.help = true; break;
    default:
      console.warn(`⚠️  Unknown flag ignored: ${arg}`);
      // If this unknown flag looks like it takes a value, skip next token
      if (FLAG_ARGS.has(arg)) i++;
  }
}

if (CLI.help) {
  console.log(`
Usage: node scripts/audit-detectors.js [options]
  --section <id>     Filter to section (e.g., 2.1, 13)
  --severity <level> Filter by min severity (critical, high, medium, low)
  --compare <file>   Compare against previous audit JSON
  --output <file>    Output JSON path (default: detector-audit.json)
  --dir <path>       Add extra scan directory (repeatable)
  --json-only        Output only JSON, no console
  --summary          Show compact summary only (no per-detector lists)
  --warn-only        Exit 0 even when critical detectors are missing
  --help, -h         Show help
`);
  process.exit(0);
}

// ═══════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════
function sectionCompare(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? -1, vb = pb[i] ?? -1;
    if (va !== vb) return va - vb;
  }
  return 0;
}

const sevRank = { critical: 4, high: 3, medium: 2, low: 1 };

// Normalize line endings to LF for consistent processing
function normalizeLF(str) {
  return str.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

// ═══════════════════════════════════════════════════════════
// DETECTOR REGISTRY — 920 detectors, all with severity
// NOTE: IDs are non-sequential for historical reasons.
//       Do not renumber — external tooling may reference them.
// ═══════════════════════════════════════════════════════════
const DETECTORS_RAW = [

// §1.1 NSFW / Adult Content
{id:1,   section:'1.1', name:'Profile photo NSFW scan',                    severity:'high',     patterns:['checkImageSafety','nsfwjs','nsfwModel','preloadSafetyModel','nsfw_image_detection','nsfw-image-detection'],        freeTools:['Llama Guard 4 (12B, Meta, multimodal)','Marqo/nsfw-image-detection-384 (MIT, 98.56% acc)','NudeNet (MIT)','NSFWJS (MIT, client-side)','Falconsai/nsfw_image_detection (Apache 2.0)']},
{id:2,   section:'1.1', name:'Chat image NSFW scan',                       severity:'high',     patterns:['checkChatImageSafety','moderateContent.*chat','chat.*imageModerat'],                                              freeTools:['Llama Guard 4 (12B, Meta, multimodal)','Marqo/nsfw-image-detection-384 (MIT, 98.56% acc)','NudeNet (MIT)','NSFWJS (MIT, client-side)']},
{id:3,   section:'1.1', name:'Edit profile photo NSFW',                    severity:'high',     patterns:['runFullImageScan','editPhoto.*checkSafety','revalidateProfilePhoto'],                                            freeTools:['Llama Guard 4 (12B, Meta, multimodal)','Marqo/nsfw-image-detection-384 (MIT, 98.56% acc)','NudeNet (MIT)','NSFWJS (MIT, client-side)']},
{id:4,   section:'1.1', name:'Story NSFW scan',                            severity:'high',     patterns:['checkStoryNSFW','story.*checkImageSafety','moderateStoryContent'],                                               freeTools:['Llama Guard 4 (12B, Meta, multimodal)','Marqo/nsfw-image-detection-384 (MIT, 98.56% acc)','NudeNet (MIT)','NSFWJS (MIT, client-side)']},
{id:5,   section:'1.1', name:'Video frame NSFW scan',                      severity:'high',     patterns:['checkVideoFramesSafety','checkVideoNSFW','moderateVideo','extractVideoFrames'],                                   freeTools:['NSFWJS on extracted frames (ffmpeg frame extraction classify)','NudeNet on key frames']},
{id:6,   section:'1.1', name:'Voice thumbnail NSFW',                       severity:'medium',   patterns:['checkVoiceThumbnail','voice_thumbnail','voiceThumbnail'],                                                        freeTools:['Llama Guard 4 (12B, Meta, multimodal)','NSFWJS (MIT, client-side)']},
{id:7,   section:'1.1', name:'Server-side NSFW backstop',                  severity:'high',     patterns:['verify-photo-nsfw','verify-video-nsfw','SERVER_URL.*nsfw','server.*nsfw.*check'],                                freeTools:['Llama Guard 4 server-side','Marqo/nsfw-image-detection-384 server-side']},
{id:8,   section:'1.1', name:'Nude body part detection (NudeNet)',          severity:'high',     patterns:['checkNudeParts','detect-nude-parts','NudeDetector','nudenet','nude_detection'],                                  freeTools:['NudeNet (MIT) — 18 body-part labels with auto-censoring']},
{id:9,   section:'1.1', name:'Partial nudity detection',                   severity:'medium',   patterns:['partialNudity','partial_nudity','suggestiveContent','nudityLevel'],                                              freeTools:['NudeNet partial labels','Marqo/nsfw with threshold tuning']},
{id:10,  section:'1.1', name:'Sexual pose detection',                      severity:'medium',   patterns:['sexualPose','sexual_pose','poseDetection.*sexual','detectSexualPose'],                                           freeTools:['YOLO pose estimation + custom classifier','NudeNet exposed body parts as proxy']},
{id:11,  section:'1.1', name:'Suggestive clothing detection',              severity:'low',      patterns:['suggestiveClothing','clothing_detection','detectSuggestiveClothing'],                                            freeTools:['Freepik/nsfw_image_detector 4-level scoring','CLIP zero-shot with clothing prompts']},
{id:12,  section:'1.1', name:'Underwear/swimwear context scoring',         severity:'low',      patterns:['underwearContext','swimwear','contextScoring.*clothing'],                                                         freeTools:['Freepik/nsfw_image_detector level scoring','CLIP zero-shot classification']},
{id:13,  section:'1.1', name:'CSAM detection (hash matching)',             severity:'critical', patterns:['scanForCSAM','CSAMhash','photoDNA','PhotoDNA','csam_scan'],                                                      freeTools:['PhotoDNA (Microsoft, free via NCMEC)','Cloudflare CSAM Scanning Tool (free)','PDQ (Meta, open-source hash matching)']},
{id:14,  section:'1.1', name:'CSAM adjacent content detection',            severity:'critical', patterns:['csamAdjacent','csam_adjacent','nearCSAM'],                                                                       freeTools:['Google CSAI Match (free API for video)','PDQ with expanded hash database']},
{id:15,  section:'1.1', name:'Drawn/animated CSAM detection',             severity:'critical', patterns:['drawnCSAM','animatedCSAM','cartoon_csam'],                                                                       freeTools:['Custom classifier needed — no free off-the-shelf tool']},
{id:16,  section:'1.1', name:'NCII hash matching (StopNCII)',              severity:'critical', patterns:['stopNCII','ncii_hash','NCIIHash','takeItDown'],                                                                  freeTools:['StopNCII.org hash sharing API (free for qualifying platforms)','PDQ hashing']},
{id:17,  section:'1.1', name:'Revenge porn detection',                     severity:'critical', patterns:['revengePorn','revenge_porn','ncii_detection'],                                                                   freeTools:['StopNCII hash matching','Report-based + human review']},
{id:18,  section:'1.1', name:'Nudity in video thumbnails',                 severity:'high',     patterns:['videoThumbnail.*nsfw','checkVideoThumbnail','thumbnailNSFW'],                                                    freeTools:['NSFWJS (MIT, client-side)','NudeNet (MIT)']},
{id:19,  section:'1.1', name:'Nudity in story thumbnails',                 severity:'high',     patterns:['storyThumbnail.*nsfw','checkStoryThumbnail'],                                                                    freeTools:['NSFWJS (MIT, client-side)','NudeNet (MIT)']},
{id:600, section:'1.1', name:'Cyberflashing / unsolicited nude auto-blur', severity:'high',     patterns:['cyberflash','autoBlur.*nude','privateDetector','unsolicitedNude'],                                               freeTools:['NudeNet detection auto-blur before display','NSFWJS client-side pre-screen']},

// §1.2 Identity & Face Verification
{id:20,  section:'1.2', name:'Verify face exists',                         severity:'high',   patterns:['detectFace','faceCount','checkSingleFace','faceDetection','face-api','faceapi'],                                  freeTools:['InsightFace/RetinaFace (Apache 2.0)','DeepFace (MIT)','MediaPipe Face Detection (Apache 2.0)']},
{id:21,  section:'1.2', name:'Verify exactly one face',                    severity:'high',   patterns:['faceCount.*1','faceCount > 1','faceCount !== 1','singleFace','checkSingleFace'],                                  freeTools:['RetinaFace count detected faces','DeepFace.extract_faces()']},
{id:22,  section:'1.2', name:'Match selfie to profile',                    severity:'high',   patterns:['verifyFaceMatch','compareFaces','checkSelfieConsistency','faceVerify'],                                           freeTools:['InsightFace ArcFace (Apache 2.0)','FaceNet512 (MIT)','DeepFace.verify() (MIT)']},
{id:23,  section:'1.2', name:'Verify all photos same person',              severity:'high',   patterns:['verifyAllPhotos','samePersonCheck','verify-all-photos-same-person','checkAllPhotosConsistency'],                  freeTools:['InsightFace pairwise comparison','DeepFace.verify() across all photos']},
{id:24,  section:'1.2', name:'Banned user face re-registration',           severity:'high',   patterns:['checkAgainstBannedFaces','bannedFace','BannedFaceCheckResult'],                                                   freeTools:['InsightFace embeddings compare against banned DB','CompreFace (Apache 2.0) face collection matching']},
{id:25,  section:'1.2', name:'Celebrity impersonation',                    severity:'medium', patterns:['checkCelebrityImpersonation','isCelebrity','celebrity.*confidence'],                                              freeTools:['InsightFace against celebrity embedding DB','Custom embedding database']},
{id:26,  section:'1.2', name:'Staff impersonation via face',               severity:'medium', patterns:['staffFaceImpersonation','staff_face_check'],                                                                      freeTools:['InsightFace against staff photo DB']},
{id:27,  section:'1.2', name:'Deepfake image detection',                   severity:'high',   patterns:['deepfakeDetect','detectDeepfake','deepfake_image','isDeepfake'],                                                  freeTools:['DeepfakeBench (36 detection methods)','selimsef/dfdc_deepfake_challenge (Kaggle winner)']},
{id:28,  section:'1.2', name:'Deepfake video detection',                   severity:'high',   patterns:['deepfakeVideo','detectDeepfakeVideo','video.*deepfake'],                                                          freeTools:['DeepfakeBench video methods','selimsef model on extracted frames']},
{id:29,  section:'1.2', name:'Deepfake in live video call',                severity:'high',   patterns:['liveDeepfake','realtime.*deepfake','videoCall.*deepfake'],                                                        freeTools:['No production-ready free tool — research-grade only']},
{id:30,  section:'1.2', name:'3D mask / printed face detection',           severity:'high',   patterns:['maskDetect','printedFace','spoofDetect','antiSpoofing','livenessDepth'],                                          freeTools:['Faceplugin 3D Liveness (free on-premise)','MiniAI SDK (free on-premise)','InsightFace anti-spoofing models']},
{id:31,  section:'1.2', name:'Makeup / prosthetic detection',              severity:'low',    patterns:['makeupDetect','prostheticDetect','disguiseDetect'],                                                               freeTools:['No free off-the-shelf tool — custom model needed']},
{id:32,  section:'1.2', name:'Infrared liveness check',                    severity:'low',    patterns:['infraredLiveness','irLiveness','nearInfrared'],                                                                   freeTools:['Requires IR camera hardware — no software-only free tool']},
{id:33,  section:'1.2', name:'Twin / sibling impersonation',               severity:'low',    patterns:['twinDetect','siblingImpersonation'],                                                                              freeTools:['InsightFace with high similarity threshold + behavioral signals']},
{id:34,  section:'1.2', name:'Consistent eye color across photos',         severity:'low',    patterns:['eyeColor.*consistency','checkEyeColor'],                                                                          freeTools:['Custom model on face landmark crops']},
{id:35,  section:'1.2', name:'Tattoo consistency across photos',           severity:'low',    patterns:['tattooConsistency','detectTattoo'],                                                                               freeTools:['YOLO fine-tuned for tattoo detection + matching']},
{id:36,  section:'1.2', name:'Scar / birthmark consistency',               severity:'low',    patterns:['scarConsistency','birthmarkDetect'],                                                                              freeTools:['Custom segmentation model needed']},
{id:37,  section:'1.2', name:'Height estimation from photos',              severity:'low',    patterns:['heightEstimate','estimateHeight'],                                                                                freeTools:['Pose estimation + reference object scaling (custom)']},
{id:38,  section:'1.2', name:'Age estimation from selfie',                 severity:'high',   patterns:['estimateAgeFromPhoto','estimateAge','ageEstimation','age_predict'],                                               freeTools:['DeepFace.analyze(actions=["age"]) (MIT)','InsightFace age prediction']},
{id:39,  section:'1.2', name:'Face age vs claimed age consistency',        severity:'high',   patterns:['faceAge.*claimedAge','ageConsistency','ageMismatch'],                                                             freeTools:['DeepFace age estimation compare to profile DOB']},
{id:40,  section:'1.2', name:'Selfie-to-ID face match',                    severity:'high',   patterns:['selfieToID','idFaceMatch','documentFaceMatch'],                                                                   freeTools:['InsightFace verify selfie vs ID crop','CompreFace verification']},
{id:41,  section:'1.2', name:'Photo aging consistency',                    severity:'low',    patterns:['photoAging','agingConsistency','photoRecency'],                                                                   freeTools:['EXIF date analysis + face age estimation comparison']},
{id:42,  section:'1.2', name:'Background consistency across photos',       severity:'low',    patterns:['backgroundConsistency','bgConsistency'],                                                                          freeTools:['Custom — scene embedding comparison']},
{id:43,  section:'1.2', name:'Lighting consistency across photos',         severity:'low',    patterns:['lightingConsistency','lightDirection'],                                                                            freeTools:['Custom image analysis — no free tool']},
{id:44,  section:'1.2', name:'Resolution inconsistency detection',         severity:'low',    patterns:['resolutionInconsistency','resolutionCheck','dpiMismatch'],                                                        freeTools:['EXIF resolution comparison + pixel analysis']},
{id:45,  section:'1.2', name:'Repeated clothing detection',                severity:'low',    patterns:['repeatedClothing','clothingDetect','sameOutfit'],                                                                 freeTools:['CLIP clothing embeddings comparison']},
{id:46,  section:'1.2', name:'Facial symmetry scoring (AI signal)',        severity:'low',    patterns:['facialSymmetry','symmetryScore','aiGeneratedSymmetry'],                                                           freeTools:['Face landmark analysis symmetry calculation']},
{id:693, section:'1.2', name:'Mandatory video selfie verification',        severity:'high',   patterns:['videoSelfieVerification','mandatoryVideoSelfie','onboardingVideoVerify'],                                         freeTools:['InsightFace + liveness challenge sequence']},
{id:694, section:'1.2', name:'Periodic re-verification prompt',            severity:'medium', patterns:['periodicReverify','reVerificationPrompt','scheduledVerification'],                                                freeTools:['Custom timer + existing verification pipeline']},
{id:695, section:'1.2', name:'Video selfie freshness enforcement',         severity:'medium', patterns:['selfieExpiry','selfieFreshness','videoSelfieAge'],                                                                freeTools:['Timestamp check + re-verification trigger']},

// §1.3 AI Generated & Manipulated
{id:47,  section:'1.3', name:'Detect AI-generated images via EXIF',       severity:'medium', patterns:['checkExifForAI','image_metadata','AI_SW','detectAIGeneratedFromMetadata','midjourney'],                           freeTools:['Exiftool (free) — check Software, Comment, Description fields for AI tool names']},
{id:48,  section:'1.3', name:'AI image GAN fingerprint detection',         severity:'medium', patterns:['ganFingerprint','detectGAN','gan_artifact'],                                                                      freeTools:['DeepfakeBench GAN detection methods']},
{id:49,  section:'1.3', name:'Diffusion model artifact detection',         severity:'medium', patterns:['diffusionArtifact','detectDiffusion','stableDiffusion.*detect'],                                                  freeTools:['DeepfakeBench diffusion detectors','Custom frequency analysis']},
{id:50,  section:'1.3', name:'Pixel-level manipulation detection',         severity:'medium', patterns:['pixelManipulation','errorLevelAnalysis','ELA','forensicAnalysis'],                                                freeTools:['Error Level Analysis (ELA) — custom implementation']},
{id:51,  section:'1.3', name:'Inpainting / healing brush detection',       severity:'low',    patterns:['inpaintingDetect','healingBrush','detectInpainting'],                                                             freeTools:['Custom CNN trained on inpainting artifacts']},
{id:52,  section:'1.3', name:'Splicing / compositing detection',           severity:'medium', patterns:['splicingDetect','compositingDetect','detectSplicing'],                                                            freeTools:['ELA + noise inconsistency analysis']},
{id:53,  section:'1.3', name:'Green screen background detection',          severity:'low',    patterns:['greenScreen','chromaKey','detectGreenScreen'],                                                                    freeTools:['Color histogram analysis for uniform green backgrounds']},
{id:54,  section:'1.3', name:'Consistent shadow direction check',          severity:'low',    patterns:['shadowDirection','shadowConsistency','detectShadowInconsistency'],                                                freeTools:['Custom — no free off-the-shelf tool']},
{id:55,  section:'1.3', name:'Lens distortion fingerprinting',             severity:'low',    patterns:['lensDistortion','lensFingerprint','barrelDistortion'],                                                            freeTools:['Custom — lens profile matching from EXIF']},
{id:56,  section:'1.3', name:'HDR / beauty filter detection',              severity:'low',    patterns:['beautyFilter','hdrDetect','filterDetection','faceSmoothing'],                                                     freeTools:['Custom texture analysis — no free off-the-shelf tool']},
{id:57,  section:'1.3', name:'Color grading consistency',                  severity:'low',    patterns:['colorGrading','colorConsistency','whiteBalance'],                                                                 freeTools:['Custom color histogram analysis']},
{id:58,  section:'1.3', name:'Image compression fingerprinting',           severity:'low',    patterns:['jpegArtifact','compressionLevel','compressionFingerprint','quantizationTable'],                                   freeTools:['Custom JPEG quantization table analysis']},
{id:59,  section:'1.3', name:'Screenshot metadata detection',              severity:'low',    patterns:['screenshotMeta','isScreenshot','detectScreenshot'],                                                               freeTools:['Exiftool — check dimensions, DPI, Software field']},
{id:60,  section:'1.3', name:'Screenshot of another profile detection',    severity:'medium', patterns:['screenshotOfProfile','profileScreenshot','appUIDetect'],                                                          freeTools:['OCR + UI element detection (custom)']},
{id:61,  section:'1.3', name:'Stock photo detection',                      severity:'medium', patterns:['stockPhoto','watermarkDetect','stockImage','shutterstock','gettyImages'],                                         freeTools:['Reverse image search via TinEye API (limited free)','Watermark detection (custom)']},
{id:62,  section:'1.3', name:'Image provenance (C2PA/Content Credentials)',severity:'medium', patterns:['c2pa','contentCredentials','contentAuthenticity','provenance'],                                                   freeTools:['c2patool (open-source C2PA verification)']},
{id:63,  section:'1.3', name:'NFT / stolen digital art detection',         severity:'low',    patterns:['nftDetect','stolenArt','digitalArtTheft'],                                                                       freeTools:['Reverse image search + perceptual hashing']},
{id:64,  section:'1.3', name:'Steganography detection',                    severity:'medium', patterns:['steganography','hiddenData','detectSteganography','stegDetect'],                                                  freeTools:['StegExpose (open-source)','zsteg for PNG']},
{id:65,  section:'1.3', name:'Metadata stripping verification',            severity:'high',   patterns:['stripMetadata','removeExif','metadataStrip','sanitizeMetadata'],                                                  freeTools:['Exiftool -all= (free)','sharp.rotate() strips EXIF']},
{id:750, section:'1.3', name:'Filter/AR effect transparency labeling',     severity:'low',    patterns:['filterLabel','arEffectLabel','filterTransparency'],                                                               freeTools:['Custom UI labeling — no detection tool needed']},

// §1.4 Dangerous Content in Images
{id:66,  section:'1.4', name:'Hate symbols detection',                     severity:'high',   patterns:['detectHateSymbol','detect-hate-symbol','hateSymbol','hate_symbol'],                                              freeTools:['YOLO fine-tuned on ADL hate symbol database','CLIP zero-shot with hate symbol prompts']},
{id:67,  section:'1.4', name:'Weapons detection',                          severity:'high',   patterns:['detectWeapons','detect-weapons','weaponDetect','gunDetect','knifeDetect'],                                        freeTools:['YOLO (Ultralytics, AGPL-3.0) fine-tuned for weapons']},
{id:68,  section:'1.4', name:'Drug paraphernalia detection',               severity:'medium', patterns:['detectDrugParaphernalia','detect-drug-paraphernalia','drug_paraphernalia'],                                       freeTools:['YOLO fine-tuned for drug items','CLIP zero-shot classification']},
{id:69,  section:'1.4', name:'Offensive gestures',                         severity:'medium', patterns:['detectOffensiveGesture','detect-offensive-gesture','offensiveGesture','middleFinger'],                           freeTools:['MediaPipe Hands + gesture classifier']},
{id:70,  section:'1.4', name:'Fake verification badge in photo',           severity:'medium', patterns:['detectFakeBadgeInPhoto','detect-fake-badge','fakeBadge'],                                                        freeTools:['Template matching + OCR']},
{id:71,  section:'1.4', name:'QR code in photos',                          severity:'medium', patterns:['detectQRCode','qrCode','qr_code'],                                                                               freeTools:['OpenCV QR detector','zbar (open-source)']},
{id:72,  section:'1.4', name:'Text overlay detection (phone numbers)',     severity:'medium', patterns:['textOverlay','extractTextFromImage','ocr-extract','ocrExtract'],                                                  freeTools:['PaddleOCR-VL (Apache 2.0, superior to Tesseract)','Tesseract OCR (Apache 2.0)']},
{id:73,  section:'1.4', name:'OCR contact info in images',                 severity:'medium', patterns:['ocrContactInfo','hasContactInfo','ocrPhone','ocrEmail'],                                                          freeTools:['PaddleOCR-VL regex for phone/email patterns']},
{id:74,  section:'1.4', name:'OCR hate speech in images',                  severity:'high',   patterns:['ocrThenModerate','ocr.*hate','extractText.*moderate'],                                                           freeTools:['PaddleOCR-VL text safety classifier (DuoGuard/Llama Guard)']},
{id:75,  section:'1.4', name:'Background scene analysis',                  severity:'medium', patterns:['sceneAnalysis','backgroundScene','detectDangerousScene','prisonDetect'],                                          freeTools:['CLIP zero-shot scene classification']},
{id:76,  section:'1.4', name:'Minor in photo detection',                   severity:'critical',patterns:['minorDetect','childInPhoto','detectMinor','underageInPhoto'],                                                   freeTools:['DeepFace age estimation — flag if estimated age < 18']},
{id:77,  section:'1.4', name:'Alcohol / intoxication context',             severity:'low',    patterns:['alcoholDetect','intoxication','drinkingContext'],                                                                 freeTools:['YOLO object detection for bottles/cans + CLIP context']},
{id:78,  section:'1.4', name:'Self-harm imagery detection',                severity:'critical',patterns:['selfHarmImage','cuttingDetect','selfInjury'],                                                                   freeTools:['Llama Guard 4 safety categories','Custom classifier needed']},
{id:79,  section:'1.4', name:'Extremist imagery detection',                severity:'high',   patterns:['extremistImagery','terroristFlag','isisFlag'],                                                                   freeTools:['GIFCT hash sharing database','CLIP + known extremist symbol database']},
{id:80,  section:'1.4', name:'Gang signs detection',                       severity:'medium', patterns:['gangSign','detectGangSign','gangGesture'],                                                                       freeTools:['MediaPipe Hands + custom gesture classifier']},
{id:81,  section:'1.4', name:'Nazi / white supremacist symbols',           severity:'high',   patterns:['naziSymbol','swastika','whiteSupremacist','ssRunes'],                                                            freeTools:['YOLO + ADL symbol database']},
{id:82,  section:'1.4', name:'Terrorist organization symbols',             severity:'high',   patterns:['terroristSymbol','isisLogo','terrorOrg'],                                                                        freeTools:['GIFCT + YOLO object detection']},
{id:83,  section:'1.4', name:'Warrant / mugshot detection',                severity:'low',    patterns:['mugshotDetect','warrantPhoto','detectMugshot'],                                                                  freeTools:['Scene classification — uniform backgrounds + aspect ratios']},

// §1.5 Photo Quality & Authenticity
{id:84,  section:'1.5', name:'Photo quality scoring',                      severity:'medium', patterns:['photoQuality','scorePhotoQuality','qualityScore','PhotoQualityResult'],                                           freeTools:['Custom — resolution, blur detection (Laplacian), lighting analysis']},
{id:85,  section:'1.5', name:'Full body detection',                        severity:'low',    patterns:['detectFullBodyPhoto','bodyDetect','fullBody','bodyTypeDetect','hasFullBody'],                                      freeTools:['YOLO pose estimation — check all keypoints visible']},
{id:86,  section:'1.5', name:'Engagement ring detection',                  severity:'low',    patterns:['engagementRing','detectRing','ring.*detect','CLIP.*ring'],                                                       freeTools:['CLIP zero-shot: engagement ring on hand']},
{id:87,  section:'1.5', name:'Sunglasses / face obscuring detection',      severity:'low',    patterns:['sunglassesDetect','faceObscured','faceOccluded'],                                                                freeTools:['Face landmark analysis — eye region occlusion check']},
{id:88,  section:'1.5', name:'Multiple people ratio (always group)',       severity:'low',    patterns:['groupPhotoRatio','multiplepeople','alwaysGroupPhoto'],                                                            freeTools:['Face detection count across all user photos']},
{id:89,  section:'1.5', name:'Pet-only profile detection',                 severity:'low',    patterns:['petOnlyProfile','noHumanFace','animalOnly'],                                                                     freeTools:['YOLO animal detection + no face detected']},
{id:90,  section:'1.5', name:'Photo recency estimation',                   severity:'medium', patterns:['photoRecency','estimatePhotoAge','oldPhoto'],                                                                    freeTools:['EXIF DateTimeOriginal + image style analysis']},
{id:91,  section:'1.5', name:'Aspect ratio manipulation',                  severity:'low',    patterns:['aspectRatio','stretchDetect','squishDetect'],                                                                    freeTools:['EXIF original dimensions vs displayed']},
{id:92,  section:'1.5', name:'Invisible watermarks (embedding)',           severity:'medium', patterns:['embedWatermark','invisibleWatermark','watermark-embed'],                                                          freeTools:['invisible-watermark (Python, MIT)']},
{id:93,  section:'1.5', name:'Watermark detection (others)',               severity:'medium', patterns:['detectWatermark','watermark-detect','hasWatermark'],                                                             freeTools:['Custom edge/text detection in corners']},
{id:94,  section:'1.5', name:'Reverse image search',                       severity:'medium', patterns:['reverseImageSearch','tineye','googleLens'],                                                                      freeTools:['TinEye API (limited free tier)','SauceNAO (free)']},
{id:95,  section:'1.5', name:'Reverse video search',                       severity:'low',    patterns:['reverseVideoSearch','videoSearch'],                                                                              freeTools:['Frame extraction reverse image search']},
{id:96,  section:'1.5', name:'Cross-account duplicate photo (PDQ)',        severity:'high',   patterns:['pdq-cross-account','PDQHash','checkCrossAccountDuplicate','crossAccountPDQ','checkDuplicatePhotoCrossUsers'],     freeTools:['PDQ (Meta, open-source)','DINOHash (MIT, SOTA, robust to attacks)']},
{id:97,  section:'1.5', name:'Duplicate photos same user',                 severity:'low',    patterns:['checkDuplicatePhotoSameUser','duplicatePhoto','perceptualHash','dHash','computeImageHash','hammingDistance'],     freeTools:['PDQ / pHash / dHash — Hamming distance comparison']},
{id:98,  section:'1.5', name:'Thermal camera detection',                   severity:'low',    patterns:['thermalCamera','infraredImage','thermalDetect'],                                                                 freeTools:['EXIF analysis for IR camera models']},
{id:749, section:'1.5', name:'Significant photo age discrepancy via EXIF', severity:'medium', patterns:['photoAgeDiscrepancy','exifAgeDiscrepancy','oldExifDate'],                                                        freeTools:['Exiftool date extraction compare to upload date']},

// §1.6 Camera & Capture Verification
{id:99,  section:'1.6', name:'Virtual camera detection',                   severity:'high',   patterns:['detectVirtualCamera','isVirtualCamera','VIRTUAL_CAM_KW','virtualCam','obsCam'],                                  freeTools:['Check device camera list for known virtual cam names (OBS, ManyCam)']},
{id:100, section:'1.6', name:'Validate EXIF timestamp',                    severity:'medium', patterns:['image_metadata','hasValidTimestamp','validateVideoMetadata','DateTimeOriginal'],                                  freeTools:['Exiftool (free)']},
{id:101, section:'1.6', name:'Validate camera make/model',                 severity:'medium', patterns:['Make.*Model','EXIF.*Make','cameraMake','No camera make'],                                                        freeTools:['Exiftool (free)']},
{id:102, section:'1.6', name:'Enforce in-app selfie capture',              severity:'high',   patterns:['enforceCamera','enforceInAppCaptureOnly','inAppCapture'],                                                        freeTools:['Custom — disable gallery picker for verification photos']},
{id:103, section:'1.6', name:'Liveness challenge',                         severity:'high',   patterns:['LivenessChallenge','look_left','look_right','blinkDetect','headTurn','livenessChallenge'],                       freeTools:['MediaPipe Face Mesh + challenge prompts','Faceplugin 3D Liveness (free on-premise)']},
{id:104, section:'1.6', name:'Continuous face tracking video',             severity:'medium', patterns:['trackFaceInVideo','faceTrack','facePresentFrames'],                                                              freeTools:['MediaPipe Face Detection continuous tracking']},
{id:105, section:'1.6', name:'Screenshot in video frame detection',        severity:'low',    patterns:['screenshotInVideo','staticFrameDetect'],                                                                         freeTools:['Frame difference analysis — detect static regions']},
{id:106, section:'1.6', name:'Video call recording detection',             severity:'medium', patterns:['callRecordDetect','recordingIndicator'],                                                                         freeTools:['Custom — monitor recording APIs on device']},
{id:107, section:'1.6', name:'Screen recording detection during call',     severity:'medium', patterns:['screenRecordDetect','isCaptured','screenCapture'],                                                               freeTools:['iOS: UIScreen.isCaptured','Android: FLAG_SECURE']},

// §1.7 Children in Photos
{id:782, section:'1.7', name:'Minor face detection in profile photos',     severity:'critical',patterns:['minorFaceDetect','childFaceDetect','underageFace'],                                                             freeTools:['DeepFace age estimation — flag < 18']},
{id:783, section:'1.7', name:'Child photo blur/block enforcement',          severity:'critical',patterns:['blurChildPhoto','blockChildPhoto','childPhotoPolicy'],                                                         freeTools:['Age estimation + auto-blur/reject']},
{id:784, section:'1.7', name:'Child photo predator attraction risk',        severity:'critical',patterns:['predatorRiskWarning','childPhotoRisk'],                                                                        freeTools:['Educational prompt — no detection tool needed']},

// §1.8 AI-Generated NCII / Nudification Defense
{id:771, section:'1.8', name:'AI nudification output detection',            severity:'critical',patterns:['nudificationDetect','aiNudification','clothesRemoval'],                                                        freeTools:['DeepfakeBench + NudeNet combined analysis']},
{id:772, section:'1.8', name:'Photo scraping-for-nudification defense',     severity:'high',   patterns:['scrapingDefense','photoProtection','downloadPrevention'],                                                       freeTools:['Watermarking + right-click disable + screenshot detection']},
{id:773, section:'1.8', name:'AI-generated NCII hash sharing',              severity:'critical',patterns:['nciiHashShare','stopNCIIIntegration','takeItDownHash'],                                                       freeTools:['StopNCII.org API','Take It Down (NCMEC)']},
{id:774, section:'1.8', name:'Nudification model training set notification', severity:'low',   patterns:['nudificationTraining','modelTrainingAlert'],                                                                   freeTools:['HaveIBeenTrained.com integration (concept only)']},

// §1.9 Screenshot / Screen Recording Weaponization
{id:855, section:'1.9', name:'Screenshot content auto-blur',               severity:'medium', patterns:['screenshotBlur','captureBlur','blurOnCapture'],                                                                 freeTools:['Custom — blur view on screenshot event']},
{id:856, section:'1.9', name:'Screen recording content protection',        severity:'medium', patterns:['screenRecordProtect','FLAG_SECURE','captureProtection'],                                                        freeTools:['Android: FLAG_SECURE','iOS: UIScreen.isCaptured notification']},
{id:857, section:'1.9', name:'External camera capture detection',          severity:'low',    patterns:['externalCameraDetect','cameraHoleDetect'],                                                                     freeTools:['No reliable free tool — fundamental limitation']},

// §2.1 Hate Speech & Slurs
{id:108, section:'2.1', name:'Profanity / hate speech',                    severity:'high',   patterns:['checkTextSafety','PROFANITY_WORDS','containsProfanity','hateSpeech','toxicityScore'],                           freeTools:['DuoGuard (0.5B, 29 langs, fastest)','Llama Guard 4 (12B)','Perspective API (free)','Detoxify (MIT)','OpenAI Moderation API (free)']},
{id:109, section:'2.1', name:'Racial slurs',                               severity:'high',   patterns:['racial_slur','IDENTITY_ATTACK','racialSlur'],                                                                  freeTools:['DuoGuard identity_attack category','Perspective API IDENTITY_ATTACK','Detoxify identity_attack']},
{id:110, section:'2.1', name:'Homophobic slurs',                           severity:'high',   patterns:['homophobic_slur','homophob'],                                                                                  freeTools:['DuoGuard/Llama Guard hate categories','Perspective API IDENTITY_ATTACK']},
{id:111, section:'2.1', name:'Transphobic slurs',                          severity:'high',   patterns:['transphobic_slur','transphob'],                                                                               freeTools:['DuoGuard/Llama Guard hate categories']},
{id:112, section:'2.1', name:'Misogynistic language',                      severity:'high',   patterns:['misogynistic','misogyny','sexist_language'],                                                                   freeTools:['DuoGuard/Detoxify gender-based categories']},
{id:113, section:'2.1', name:'Antisemitic language',                       severity:'high',   patterns:['antisemitic','antisemitism'],                                                                                  freeTools:['DuoGuard + custom keyword list']},
{id:114, section:'2.1', name:'Islamophobic language',                      severity:'high',   patterns:['islamophobic','islamophobia'],                                                                                 freeTools:['DuoGuard + custom keyword list']},
{id:115, section:'2.1', name:'Ableist slurs',                              severity:'high',   patterns:['ableist','ableism','disability_slur'],                                                                         freeTools:['Custom keyword list + DuoGuard']},
{id:116, section:'2.1', name:'Non-English hate speech',                    severity:'high',   patterns:['hate_multilang','detectMultilingualHateSpeech','madarchod','sibal','maldito'],                                 freeTools:['Qwen3Guard (119 languages)','DuoGuard (29 languages)','Perspective API (20+ languages)']},
{id:117, section:'2.1', name:'Micro-aggression detection',                 severity:'low',    patterns:['microAggression','subtleDiscrimination'],                                                                      freeTools:['No reliable free tool — very context-dependent']},
{id:118, section:'2.1', name:'Negging patterns',                           severity:'medium', patterns:['negging','backhandedCompliment','NEGGING_PATTERNS'],                                                            freeTools:['Custom pattern matching + sentiment analysis']},
{id:119, section:'2.1', name:'Coded hate speech',                          severity:'high',   patterns:['codedHate','dogWhistle','coded_hate'],                                                                         freeTools:['Custom keyword list of known dog-whistles + DuoGuard']},

// §2.2 Sexual Content & Solicitation
{id:120, section:'2.2', name:'Sexual solicitation',                        severity:'high',   patterns:['sexual_solicitation','SEXUAL_PATTERNS','sexualSolicitation','detectSexualSolicitation'],                        freeTools:['DuoGuard sexual_content category','Llama Guard 4 S1/S2','OpenAI Moderation sexual category']},
{id:121, section:'2.2', name:'Unsolicited explicit first message',         severity:'high',   patterns:['checkFirstMessageSafety','moderateFirstMessage','inappropriate_first_message'],                                  freeTools:['Apply stricter thresholds on first message with DuoGuard/Llama Guard']},
{id:122, section:'2.2', name:'Escalating photo request pattern',           severity:'high',   patterns:['photoRequestEscalation','escalatingPhotoRequest','photoRequestPattern'],                                        freeTools:['Custom conversation tracking — no free off-the-shelf tool']},
{id:123, section:'2.2', name:'Blackmail setup pattern',                    severity:'critical',patterns:['blackmailSetup','blackmail_pattern'],                                                                          freeTools:['Custom pattern matching + sextortion detection']},
{id:124, section:'2.2', name:'Sextortion patterns',                        severity:'critical',patterns:['SEXTORTION_PATTERNS','sextortion','sextort'],                                                                 freeTools:['Custom keyword patterns + Llama Guard']},
{id:125, section:'2.2', name:'NSFW speech in voice intros',                severity:'high',   patterns:['checkNsfwSpeech','NSFW_SPEECH_PATTERNS','nsfw_speech','nsfwSpeech'],                                           freeTools:['Whisper (MIT) transcription DuoGuard text scan']},
{id:126, section:'2.2', name:'Child sexual exploitation language',         severity:'critical',patterns:['cseLanguage','csam_language','childExploitation'],                                                            freeTools:['Llama Guard child safety category','Custom high-priority keyword list']},
{id:127, section:'2.2', name:'Grooming language patterns',                 severity:'critical',patterns:['GROOMING_PATTERNS','grooming','groomingDetect'],                                                              freeTools:['No free off-the-shelf tool — custom classifier needed']},
{id:128, section:'2.2', name:'References to underage',                     severity:'critical',patterns:['UNDERAGE_PATTERNS','category.*underage','underage','preteen','barely.legal','ddlg'],                         freeTools:['Keyword matching + Llama Guard child safety category']},
{id:885, section:'2.2', name:'Sugar daddy/momma scam script detection',    severity:'medium', patterns:['sugarDaddy','sugarMomma','sugarScam','allowance'],                                                             freeTools:['Custom keyword patterns']},
{id:886, section:'2.2', name:'Sugar arrangement language',                 severity:'medium', patterns:['sugarArrangement','arrangement_language'],                                                                     freeTools:['Custom keyword patterns']},
{id:887, section:'2.2', name:'Verification fee scam',                      severity:'high',   patterns:['verificationFee','payToVerify','sendMoney.*verify'],                                                           freeTools:['Custom keyword patterns']},
{id:888, section:'2.2', name:'Escort/sex work solicitation',               severity:'high',   patterns:['escortSolicitation','sexWork','companionship.*fee'],                                                           freeTools:['Custom keyword patterns + DuoGuard']},
{id:889, section:'2.2', name:'Paid companionship emoji patterns',          severity:'medium', patterns:['paidCompanionEmoji','roses.*emoji'],                                                                           freeTools:['Custom emoji sequence detection']},
{id:890, section:'2.2', name:'Sex trafficking victim identification',      severity:'critical',patterns:['traffickingVictim','traffickingIdentification','forcedLabor'],                                                freeTools:['NCMEC CyberTipline + keyword patterns']},
{id:891, section:'2.2', name:'Coded pricing language',                     severity:'medium', patterns:['codedPricing','priceCode','roses.*hundred'],                                                                   freeTools:['Custom pattern matching']},
{id:892, section:'2.2', name:'Third-party controlled profile',             severity:'critical',patterns:['controlledProfile','pimpControl','thirdPartyProfile'],                                                        freeTools:['Behavioral signals — no free tool']},

// §2.3 Violence & Threats
{id:129, section:'2.3', name:'Violence / death threats',                   severity:'critical',patterns:['violence_threat','VIOLENCE_PATTERNS','detectViolenceThreats','deathThreat'],                                  freeTools:['DuoGuard violence category','Llama Guard 4 S1','Perspective API THREAT']},
{id:130, section:'2.3', name:'Self-harm encouragement',                    severity:'critical',patterns:['self_harm','SELF_HARM_PATTERNS','detectSelfHarmEncouragement','kys'],                                         freeTools:['DuoGuard self-harm category','Llama Guard 4 S5 (self-harm)']},
{id:131, section:'2.3', name:'Suicide / crisis intervention',              severity:'critical',patterns:['suicidePrevention','crisisIntervention','CRISIS_KEYWORDS','suicidalIdeation'],                                freeTools:['Keyword triggers crisis helpline routing']},
{id:132, section:'2.3', name:'Doxxing / PII sharing',                      severity:'critical',patterns:['DOXXING_PATTERNS','doxxing','category.*pii','piiSharing'],                                                   freeTools:['Roblox PII Classifier (98% recall)','Presidio (Microsoft, MIT)']},
{id:133, section:'2.3', name:'Coercive / controlling language',            severity:'high',   patterns:['COERCIVE_PATTERNS','coercive','controllingLanguage'],                                                          freeTools:['Custom pattern matching — no free off-the-shelf tool']},
{id:134, section:'2.3', name:'Punishment for rejection pattern',           severity:'high',   patterns:['rejectionPunishment','rejectRetaliation','punishmentForNo'],                                                  freeTools:['Custom pattern matching + sentiment shift detection']},
{id:135, section:'2.3', name:'Stalking language patterns',                 severity:'high',   patterns:['stalkingLanguage','STALKING_PATTERNS','obsessiveLanguage'],                                                   freeTools:['Custom keyword patterns']},
{id:136, section:'2.3', name:'DARVO patterns',                             severity:'medium', patterns:['darvo','denyAttackReverse','victimBlaming'],                                                                   freeTools:['No free tool — custom classifier needed']},
{id:137, section:'2.3', name:'Gaslighting language',                       severity:'high',   patterns:['gaslighting','GASLIGHTING_PATTERNS','youreOverreacting'],                                                     freeTools:['Custom keyword patterns']},

// §2.4 Scam & Fraud Language
{id:138, section:'2.4', name:'Crypto / money scam solicitation',           severity:'high',   patterns:['cryptoScam','SCAM_PATTERNS','investment_scam','crypto_address'],                                              freeTools:['Custom keyword patterns + crypto address regex']},
{id:139, section:'2.4', name:'Pig butchering scripts',                     severity:'high',   patterns:['pigButchering','sha_zhu_pan','investmentScam.*romance'],                                                      freeTools:['No free tool — custom classifier with known scripts']},
{id:140, section:'2.4', name:'Romance scam vocabulary',                    severity:'high',   patterns:['romanceScamVocab','ROMANCE_SCAM_WORDS','scamVocabulary'],                                                     freeTools:['Custom keyword list from known scam scripts']},
{id:141, section:'2.4', name:'Military romance scam vocabulary',           severity:'high',   patterns:['militaryScam','deployedOverseas','militaryRomance'],                                                          freeTools:['Custom keyword patterns']},
{id:142, section:'2.4', name:'Oil rig / engineer overseas narrative',      severity:'medium', patterns:['oilRigScam','engineerOverseas','offshoreNarrative'],                                                          freeTools:['Custom narrative pattern matching']},
{id:143, section:'2.4', name:'Dead spouse narrative opener',               severity:'medium', patterns:['deadSpouseOpener','widowerNarrative'],                                                                        freeTools:['Custom narrative pattern matching']},
{id:144, section:'2.4', name:'Child sympathy manipulation',                severity:'medium', patterns:['childSympathy','sickChild','childManipulation'],                                                              freeTools:['Custom pattern matching']},
{id:145, section:'2.4', name:'Medical emergency scripts',                  severity:'medium', patterns:['medicalEmergencyScam','hospitalBill','urgentMedical'],                                                        freeTools:['Custom keyword patterns']},
{id:146, section:'2.4', name:'Visa / immigration scam',                    severity:'medium', patterns:['visaScam','immigrationScam','greenCard'],                                                                     freeTools:['Custom keyword patterns']},
{id:147, section:'2.4', name:'Shipping / customs fee scam',                severity:'medium', patterns:['shippingFeeScam','customsFee','packageStuck'],                                                               freeTools:['Custom keyword patterns']},
{id:148, section:'2.4', name:'Job offer scam',                             severity:'medium', patterns:['jobOfferScam','workFromHome.*scam','easyMoney'],                                                              freeTools:['Custom keyword patterns']},
{id:149, section:'2.4', name:'Fake dying relative / inheritance',          severity:'medium', patterns:['inheritanceScam','dyingRelative','willBeneficiary'],                                                          freeTools:['Custom keyword patterns']},
{id:150, section:'2.4', name:'Recovery scam detection',                    severity:'medium', patterns:['recoveryScam','getYourMoneyBack','scamRecovery'],                                                             freeTools:['Custom keyword patterns']},
{id:151, section:'2.4', name:'Gift card request detection',                severity:'high',   patterns:['giftCardRequest','iTunesCard','steamCard','googlePlayCard'],                                                  freeTools:['Keyword matching for gift card brand names']},
{id:152, section:'2.4', name:'Wire transfer solicitation',                 severity:'high',   patterns:['wireTransfer','westernUnion','moneyGram','bankTransfer'],                                                     freeTools:['Keyword matching']},
{id:153, section:'2.4', name:'Zelle / CashApp / Venmo request',            severity:'high',   patterns:['zelleRequest','cashApp','venmo.*send','paypalRequest'],                                                       freeTools:['Keyword + payment handle regex']},
{id:154, section:'2.4', name:'Crypto address sharing',                     severity:'high',   patterns:['crypto_address','bitcoinAddress','ethAddress','0x[a-fA-F0-9]{40,}','bc1[a-zA-Z0-9]{6,87}'],                  freeTools:['Regex for BTC/ETH/SOL address formats']},
{id:155, section:'2.4', name:'Drug dealing language',                      severity:'high',   patterns:['drug_dealing','DRUG_PATTERNS','detectDrugDealingLanguage'],                                                   freeTools:['Custom keyword + emoji patterns']},
{id:156, section:'2.4', name:'Financial requests in chat',                 severity:'high',   patterns:['detectFinancialRequest','financial_solicitation','sendMoney','lendMoney'],                                    freeTools:['Custom keyword patterns']},
{id:881, section:'2.4', name:'MLM recruitment language',                   severity:'medium', patterns:['mlmRecruit','passiveIncome','beYourOwnBoss','groundFloor'],                                                   freeTools:['Custom keyword list']},
{id:882, section:'2.4', name:'MLM pivot pattern',                          severity:'medium', patterns:['mlmPivot','romanticToBusinessPitch'],                                                                         freeTools:['Custom conversation flow analysis']},
{id:883, section:'2.4', name:'Known MLM company names',                    severity:'medium', patterns:['knownMLMCompany','herbalife','amway','primerica','itWorks'],                                                  freeTools:['Keyword list of known MLM companies']},
{id:884, section:'2.4', name:'Fake date to sales pitch reporting',         severity:'medium', patterns:['fakeDateSalesPitch','salesPitchDate'],                                                                        freeTools:['Report category + keyword detection']},

// §2.5 Manipulation Patterns
{id:157, section:'2.5', name:'Love bombing patterns',                      severity:'high',   patterns:['LOVE_BOMBING_PATTERNS','love_bombing','loveBombDetect'],                                                       freeTools:['Custom — message frequency + sentiment velocity analysis']},
{id:158, section:'2.5', name:'Love bombing escalation',                    severity:'high',   patterns:['loveBombEscalation','escalatingLoveBomb'],                                                                    freeTools:['Custom — track compliment density over time']},
{id:159, section:'2.5', name:'Fast-escalating conversations',              severity:'high',   patterns:['detectFastEscalation','escalatesQuickly','ESCALATION_PATTERNS','conversationEscalation'],                     freeTools:['Custom — message sentiment + intimacy score velocity']},
{id:160, section:'2.5', name:'Future faking language',                     severity:'medium', patterns:['futureFaking','weWillBeTogether','planningFuture.*early'],                                                    freeTools:['Custom keyword patterns']},
{id:161, section:'2.5', name:'Breadcrumbing detection',                    severity:'medium', patterns:['breadcrumbing','intermittentReinforcement'],                                                                  freeTools:['Custom — reply pattern analysis']},
{id:162, section:'2.5', name:'Trauma bonding language',                    severity:'high',   patterns:['traumaBonding','traumaBond'],                                                                                freeTools:['No free tool — custom classifier']},
{id:163, section:'2.5', name:'Religious manipulation',                     severity:'medium', patterns:['religiousManipulation','godWantsUs','divinePlan'],                                                           freeTools:['Custom keyword patterns']},
{id:164, section:'2.5', name:'Excessive compliment velocity',              severity:'medium', patterns:['complimentVelocity','excessiveCompliments'],                                                                  freeTools:['Custom — sentiment analysis + frequency']},
{id:165, section:'2.5', name:'Question bombing / PII extraction',          severity:'high',   patterns:['questionBombing','piiExtraction','excessiveQuestions'],                                                       freeTools:['Roblox PII Classifier (98% recall)','Custom question frequency detection']},
{id:166, section:'2.5', name:'Reciprocity exploitation',                   severity:'medium', patterns:['reciprocityExploit','iDidForYou'],                                                                           freeTools:['Custom pattern matching']},
{id:167, section:'2.5', name:'Fake shared interests mirroring',            severity:'medium', patterns:['interestMirroring','fakeMirroring'],                                                                         freeTools:['Custom — compare stated interests to conversation patterns']},
{id:168, section:'2.5', name:'Trust test manipulation',                    severity:'high',   patterns:['trustTest','proveYourLove','ifYouLovedMe'],                                                                  freeTools:['Custom keyword patterns']},
{id:169, section:'2.5', name:'Manufactured jealousy',                      severity:'medium', patterns:['manufacturedJealousy','makeJealous'],                                                                        freeTools:['Custom pattern matching']},
{id:170, section:'2.5', name:'False scarcity patterns',                    severity:'medium', patterns:['falseScarcity','lastChance','limitedTime.*relationship'],                                                    freeTools:['Custom keyword patterns']},
{id:171, section:'2.5', name:'Sunk cost exploitation',                     severity:'medium', patterns:['sunkCost','weveComeThisFar','afterEverything'],                                                              freeTools:['Custom keyword patterns']},
{id:172, section:'2.5', name:'Isolation tactics',                          severity:'high',   patterns:['isolationTactic','dontTellAnyone','justBetweenUs','friendsDontUnderstand'],                                  freeTools:['Custom keyword patterns']},
{id:173, section:'2.5', name:'Urgency manufacturing',                      severity:'high',   patterns:['urgencyManufacturing','actNow','emergencyPlease','needItTonight'],                                           freeTools:['Custom keyword patterns']},
{id:174, section:'2.5', name:'Digital footprint coaching',                 severity:'high',   patterns:['deleteMessages','clearHistory','dontScreenshot'],                                                            freeTools:['Custom keyword patterns']},
{id:175, section:'2.5', name:'Proof of life refusal pattern',              severity:'high',   patterns:['proofOfLifeRefusal','cantVideoCall','camerasBroken','noVideoChat'],                                          freeTools:['Custom — track video call refusal frequency']},
{id:176, section:'2.5', name:'BITE model cult tactics',                    severity:'medium', patterns:['biteModel','cultTactic','behaviorControl.*informationControl'],                                              freeTools:['No free tool — custom classifier']},
{id:177, section:'2.5', name:'Sentiment manipulation trajectory',          severity:'medium', patterns:['sentimentTrajectory','emotionalTrajectory','moodManipulation'],                                              freeTools:['Custom — sentiment over time analysis']},
{id:178, section:'2.5', name:'Second chance scam',                         severity:'high',   patterns:['secondChanceScam','comeBackAfterBlock','newAccountSamePerson'],                                              freeTools:['Device fingerprint + face matching after re-registration']},
{id:179, section:'2.5', name:'Homesickness / isolation narrative',         severity:'medium', patterns:['homesickness','farFromHome','noFriendsHere'],                                                               freeTools:['Custom keyword patterns']},
{id:180, section:'2.5', name:'Excessive spiritual / fate language',        severity:'medium', patterns:['fateLanguage','meantToBe','soulmate.*early','destinyBroughtUs'],                                            freeTools:['Custom keyword + frequency analysis']},
{id:181, section:'2.5', name:'Benign opener then pivot detection',         severity:'medium', patterns:['benignPivot','openerThenPivot','normalThenScam'],                                                           freeTools:['Custom conversation phase analysis']},
{id:182, section:'2.5', name:'Consistent persona inconsistency',           severity:'high',   patterns:['personaInconsistency','contradictingDetails','storyChanges'],                                               freeTools:['Custom — named entity tracking across messages']},
{id:183, section:'2.5', name:'Selective memory detection',                 severity:'medium', patterns:['selectiveMemory','forgotWhatISaid','amnesia'],                                                              freeTools:['Custom — compare references to previous conversation']},
{id:184, section:'2.5', name:'Scripted conversation detection',            severity:'high',   patterns:['scriptedConversation','templateMessage','scriptDetect'],                                                    freeTools:['Sentence-Transformers semantic similarity to known scripts']},
{id:185, section:'2.5', name:'Flattery-to-request ratio',                  severity:'medium', patterns:['flatteryToRequest','complimentThenAsk'],                                                                    freeTools:['Custom — sentiment + intent analysis']},
{id:186, section:'2.5', name:'Excessive self-disclosure early',            severity:'medium', patterns:['excessiveDisclosure','tooMuchTooSoon'],                                                                     freeTools:['Custom — personal detail density scoring']},
{id:187, section:'2.5', name:'Wealth signaling response spike',            severity:'medium', patterns:['wealthSignaling','richResponse','luxuryMention'],                                                           freeTools:['Custom — track engagement delta after wealth mentions']},
{id:188, section:'2.5', name:'Loneliness exploitation',                    severity:'high',   patterns:['lonelinessExploit','youMustBeLonely','illKeepYouCompany'],                                                  freeTools:['Custom keyword patterns']},
{id:189, section:'2.5', name:'Grief exploitation',                         severity:'high',   patterns:['griefExploit','iLostSomeone','griefManipulation'],                                                         freeTools:['Custom keyword patterns']},
{id:190, section:'2.5', name:'Health vulnerability exploitation',          severity:'high',   patterns:['healthExploit','youreNotWell','illTakeCareOfYou.*early'],                                                   freeTools:['Custom keyword patterns']},
{id:191, section:'2.5', name:'Addiction vulnerability exploitation',       severity:'high',   patterns:['addictionExploit','sobrieryManipulation'],                                                                  freeTools:['Custom keyword patterns']},
{id:192, section:'2.5', name:'Cognitive vulnerability indicators',         severity:'high',   patterns:['cognitiveVulnerability','confusedUser','elderlyTarget'],                                                    freeTools:['Custom — reading level + response coherence analysis']},
{id:193, section:'2.5', name:'Sudden platform switch urgency',             severity:'high',   patterns:['platformSwitchUrgent','moveToWhatsApp','switchToTelegram','offPlatformUrgent'],                             freeTools:['Keyword detection for messaging app names + urgency words']},

// §2.6 PUA / Manipulative Seduction
{id:848, section:'2.6', name:'Negging pattern detection',                  severity:'medium', patterns:['systematicNegging','puaNegging','neggingPattern'],                                                           freeTools:['Custom — backhanded compliment pattern classifier']},
{id:849, section:'2.6', name:'Push-pull manipulation',                     severity:'medium', patterns:['pushPull','hotCold','intermittentReinforcement.*systematic'],                                               freeTools:['Custom conversation sentiment oscillation analysis']},
{id:850, section:'2.6', name:'Structured escalation ladder',               severity:'medium', patterns:['escalationLadder','kinoEscalation','complianceTesting'],                                                   freeTools:['Custom — progressive request pattern analysis']},
{id:851, section:'2.6', name:'Multi-target parallel scripting',            severity:'high',   patterns:['parallelScripting','sameMessageMultipleUsers','massMessage'],                                              freeTools:['Sentence-Transformers similarity across conversations']},

// §2.7 Contact Info & Redirection
{id:194, section:'2.7', name:'Embedded phone numbers',                     severity:'medium', patterns:['contact_info_phone','PHONE_REGEX','extractPhoneNumbers'],                                                   freeTools:['Regex patterns','Presidio (Microsoft, MIT)']},
{id:195, section:'2.7', name:'Embedded email addresses',                   severity:'medium', patterns:['contact_info_email','EMAIL_REGEX'],                                                                         freeTools:['Regex patterns','Presidio (MIT)']},
{id:196, section:'2.7', name:'Social media handles',                       severity:'medium', patterns:['social_handle','SOCIAL_PATTERNS','instagramHandle','snapchatHandle'],                                       freeTools:['Regex patterns for @handles and platform URLs']},
{id:197, section:'2.7', name:'Off-platform redirection detection',         severity:'high',   patterns:['detectOffPlatformRedirect','off_platform','offPlatformRedirectDetect'],                                    freeTools:['Keyword + URL detection for messaging apps']},
{id:198, section:'2.7', name:'Spam links',                                 severity:'high',   patterns:['SPAM_PATTERNS','safeBrowsing','spam_link','checkUrlSafety'],                                               freeTools:['Google Safe Browsing API (free)','VirusTotal API (limited free)','urlscan.io (5000/day free)']},
{id:199, section:'2.7', name:'Safe Browsing check for links',              severity:'high',   patterns:['checkUrlSafety','safeBrowsingApi','SafeBrowsingResult'],                                                   freeTools:['Google Safe Browsing API (free)']},
{id:200, section:'2.7', name:'Redirect chain detection',                   severity:'medium', patterns:['checkRedirectChain','redirectChain','urlUnshorten'],                                                       freeTools:['Custom — follow redirects and check final destination']},

// §2.8 Text Evasion Techniques
{id:201, section:'2.8', name:'Unicode homoglyph abuse',                    severity:'medium', patterns:['normalizeConfusables','CONFUSABLES','homoglyph'],                                                          freeTools:['Python confusables library','ICU confusables.txt']},
{id:202, section:'2.8', name:'Zero-width character injection',             severity:'medium', patterns:['stripZeroWidthChars','hasZeroWidthChars','ZW_RE','zero_width_injection'],                                  freeTools:['Regex strip unicode zero-width chars']},
{id:203, section:'2.8', name:'Leet speak normalization',                   severity:'medium', patterns:['normalizeLeetSpeak','LEET','leetSpeak'],                                                                   freeTools:['Custom character substitution map']},
{id:204, section:'2.8', name:'RTL text injection',                         severity:'medium', patterns:['detectRTLInjection','rtl_injection','bidiOverride'],                                                       freeTools:['Regex for RTL override characters']},
{id:205, section:'2.8', name:'Emoji-coded drug/sex language',              severity:'medium', patterns:['drug_emoji','sexual_emoji','DRUG_EMOJI_SEQS','detectEmojiCodedLanguage'],                                  freeTools:['Custom emoji sequence matching']},
{id:206, section:'2.8', name:'NFKC normalization',                         severity:'medium', patterns:['normalizeUnicode','NFKC','unicodeNormalize'],                                                              freeTools:['Built-in: str.normalize NFKC / unicodedata']},
{id:207, section:'2.8', name:'Mixed-script detection',                     severity:'medium', patterns:['detectMixedScripts','mixedScript'],                                                                        freeTools:['Unicode script detection per character']},
{id:208, section:'2.8', name:'Confusable character normalization',         severity:'medium', patterns:['normalizeConfusableChars','confusableNormalize'],                                                          freeTools:['ICU confusables mapping']},
{id:209, section:'2.8', name:'Strip zero-width characters',                severity:'medium', patterns:['stripZWChars','removeZeroWidth'],                                                                          freeTools:['Regex strip']},
{id:210, section:'2.8', name:'Emoji spam detection',                       severity:'low',    patterns:['detectEmojiSpam','emojiRatio','emojiFlood'],                                                              freeTools:['Custom — emoji-to-text ratio threshold']},
{id:211, section:'2.8', name:'Zalgo / glitch text detection',              severity:'medium', patterns:['zalgo','glitchText','combiningCharacters'],                                                               freeTools:['Regex for excessive combining characters']},
{id:212, section:'2.8', name:'Base64 encoded content',                     severity:'medium', patterns:['base64Detect','encodedContent','base64Pattern'],                                                          freeTools:['Regex for base64 patterns + decode and scan']},
{id:213, section:'2.8', name:'Pig Latin / ROT13 evasion',                  severity:'low',    patterns:['pigLatin','rot13','caesarCipher'],                                                                        freeTools:['Custom decode re-scan']},
{id:214, section:'2.8', name:'Invisible character steganography',          severity:'medium', patterns:['invisibleSteg','whitespaceSteg','hiddenCharacters'],                                                      freeTools:['Custom detection of unusual whitespace patterns']},
{id:215, section:'2.8', name:'Multilingual code-switching evasion',        severity:'medium', patterns:['codeSwitching','languageSwitchEvasion'],                                                                  freeTools:['Qwen3Guard multilingual support']},
{id:216, section:'2.8', name:'Translation artifact detection',             severity:'low',    patterns:['translationArtifact','machineTranslation','unnaturalPhrasing'],                                           freeTools:['Custom — check for translation-specific phrasings']},
{id:217, section:'2.8', name:'Refusal to use contractions (AI signal)',    severity:'low',    patterns:['noContractions','aiWritingStyle','formalExcess'],                                                         freeTools:['Custom — contraction ratio analysis']},
{id:218, section:'2.8', name:'Message entropy analysis',                   severity:'low',    patterns:['messageEntropy','shannonEntropy','entropyScore'],                                                         freeTools:['Custom — Shannon entropy calculation']},
{id:219, section:'2.8', name:'Readability score anomaly',                  severity:'low',    patterns:['readabilityScore','fleschKincaid','readingLevel'],                                                        freeTools:['textstat library (MIT)']},
{id:220, section:'2.8', name:'Overly formal English detection',            severity:'low',    patterns:['overlyFormal','formalLanguageAnomaly'],                                                                   freeTools:['Custom — formality scoring']},

// §2.9 Spam & Automation
{id:221, section:'2.9', name:'Copy-paste mass messaging',                  severity:'high',   patterns:['copyPaste','massMessage','duplicateMessage','identicalMessages'],                                          freeTools:['Sentence-Transformers similarity across sent messages']},
{id:222, section:'2.9', name:'Bot-like timing',                            severity:'high',   patterns:['analyzeMessageTiming','botTiming','stdDevMs','messageTimingAnomaly'],                                     freeTools:['Custom — standard deviation of response times']},
{id:223, section:'2.9', name:'Semantic similarity to known scam scripts',  severity:'high',   patterns:['scamSimilarity','semanticMatch.*scam','knownScamScript'],                                                freeTools:['Sentence-Transformers + known scam script embeddings']},
{id:224, section:'2.9', name:'Named entity consistency',                   severity:'medium', patterns:['namedEntityConsistency','entityTracking','nameChanged'],                                                  freeTools:['Custom NER tracking across conversation']},
{id:225, section:'2.9', name:'Pronoun inconsistency',                      severity:'medium', patterns:['pronounInconsistency','genderSwitch'],                                                                   freeTools:['Custom — track pronoun usage patterns']},
{id:226, section:'2.9', name:'Temporal language inconsistency',            severity:'medium', patterns:['temporalInconsistency','timeContradiction'],                                                              freeTools:['Custom — temporal reference tracking']},
{id:227, section:'2.9', name:'Time zone inconsistency',                    severity:'medium', patterns:['timezoneInconsistency','timeZoneMismatch','messagingHours'],                                              freeTools:['Custom — message timestamps vs claimed location']},
{id:228, section:'2.9', name:'Response length manipulation',               severity:'low',    patterns:['responseLength','messageLengthAnomaly'],                                                                  freeTools:['Custom — statistical analysis of message lengths']},
{id:229, section:'2.9', name:'AI-generated text detection',                severity:'medium', patterns:['detectAIGeneratedText','likelyAI','ai_vocabulary','gptDetect'],                                          freeTools:['Custom heuristics (perplexity, burstiness) — no reliable free detector exists']},
{id:230, section:'2.9', name:'Scripted response detection',                severity:'medium', patterns:['scriptedResponse','cannedResponse','templateDetect'],                                                    freeTools:['Sentence-Transformers similarity scoring']},

// §2.10 Field-Specific Moderation
{id:231, section:'2.10', name:'Moderate chat messages',                    severity:'high',   patterns:['moderateChat','checkChatMessage'],                                                                        freeTools:['DuoGuard (0.5B) per-message']},
{id:232, section:'2.10', name:'Moderate bio text',                         severity:'high',   patterns:['moderateBio','checkBio','checkBioEdit'],                                                                  freeTools:['DuoGuard/Llama Guard on bio content']},
{id:233, section:'2.10', name:'Moderate prompts',                          severity:'medium', patterns:['moderatePrompt','checkPrompt'],                                                                           freeTools:['DuoGuard on prompt answers']},
{id:234, section:'2.10', name:'Moderate bug reports',                      severity:'low',    patterns:['moderateBugReport','checkBugReport'],                                                                    freeTools:['Light-touch DuoGuard scan']},
{id:235, section:'2.10', name:'Moderate occupation field',                 severity:'medium', patterns:['moderateOccupation','checkOccupation','suspicious_occupation'],                                          freeTools:['Keyword list + DuoGuard']},
{id:236, section:'2.10', name:'Moderate reports text',                     severity:'low',    patterns:['moderateReport','checkReportReason'],                                                                    freeTools:['DuoGuard scan']},
{id:237, section:'2.10', name:'Moderate match notes',                      severity:'low',    patterns:['moderateNote','checkMatchNotes'],                                                                        freeTools:['DuoGuard scan']},
{id:238, section:'2.10', name:'Moderate date spot reviews',                severity:'low',    patterns:['moderateReview','checkDateReview'],                                                                      freeTools:['DuoGuard scan']},
{id:239, section:'2.10', name:'Moderate feedback',                         severity:'low',    patterns:['moderateFeedback','checkPostDateFeedback'],                                                              freeTools:['DuoGuard scan']},
{id:240, section:'2.10', name:'Moderate icebreakers',                      severity:'medium', patterns:['moderateIcebreaker','checkIcebreakerAnswer'],                                                           freeTools:['DuoGuard scan']},
{id:241, section:'2.10', name:'Moderate daily questions',                  severity:'medium', patterns:['moderateDailyQ','checkDailyQuestionAnswer'],                                                            freeTools:['DuoGuard scan']},
{id:242, section:'2.10', name:'Moderate other text fields',                severity:'medium', patterns:['moderateField','validateTextField','ContentField'],                                                      freeTools:['DuoGuard scan']},

// §2.11 Sextortion (Expanded)
{id:831, section:'2.11', name:'Financial sextortion escalation',           severity:'critical',patterns:['financialSextortion','sextortionEscalation','payOrIllShare'],                                           freeTools:['Custom keyword + threat pattern matching']},
{id:832, section:'2.11', name:'Sextortion payment does not stop threats',  severity:'critical',patterns:['sextortionLoop','keepPaying','neverEnough'],                                                            freeTools:['Custom pattern matching']},
{id:833, section:'2.11', name:'Male-targeted sextortion',                  severity:'critical',patterns:['maleTargetedSextortion','videoCallBlackmail'],                                                         freeTools:['Custom — detect video call threat sequence']},
{id:834, section:'2.11', name:'Post-sextortion re-victimization',          severity:'critical',patterns:['reVictimization','sextortionRecoveryScam'],                                                            freeTools:['Custom — detect follow-up targeting']},
{id:835, section:'2.11', name:'Sextortion victim support auto-routing',    severity:'critical',patterns:['sextortionSupport','victimRouting','crisisRouting'],                                                   freeTools:['Keyword trigger helpline routing']},
{id:836, section:'2.11', name:'Off-platform sextortion continuation',      severity:'high',   patterns:['offPlatformSextortion','sextortionWarning'],                                                            freeTools:['Educational warning on platform switch detection']},

// §2.12 AI Emotional Manipulation
{id:837, section:'2.12', name:'AI-simulated attachment cue detection',     severity:'medium', patterns:['aiAttachment','syntheticAttachment','aiEmotionalCue'],                                                  freeTools:['Custom — no free off-the-shelf tool']},
{id:838, section:'2.12', name:'Synthetic intimacy pattern scoring',        severity:'medium', patterns:['syntheticIntimacy','artificialIntimacy'],                                                               freeTools:['Custom classifier']},
{id:839, section:'2.12', name:'AI language mirroring detection',           severity:'medium', patterns:['aiMirroring','languageMirroring.*ai'],                                                                  freeTools:['Custom — compare vocab overlap rate']},

// §2.13 Continued Contact After Block
{id:852, section:'2.13', name:'Post-block contact attempt',                severity:'high',   patterns:['postBlockContact','blockCircumvent','blockCircumvention','newAccountAfterBlock'],                        freeTools:['Device fingerprint + face matching']},
{id:853, section:'2.13', name:'Post-rejection escalation scoring',         severity:'high',   patterns:['rejectionEscalation','postRejection','noMeansNo'],                                                     freeTools:['Custom — sentiment shift after unmatch/block']},
{id:854, section:'2.13', name:'Cross-platform block circumvention',        severity:'high',   patterns:['crossPlatformBlock','contactOnOtherApp'],                                                              freeTools:['User reporting + educational warning']},

// §3 Identity & Document Verification
{id:243, section:'3', name:'Real name format',                             severity:'medium', patterns:['validateDisplayName','NameValidationResult','nameFormat'],                                               freeTools:['Custom regex + Unicode script validation']},
{id:244, section:'3', name:'Offensive display names',                      severity:'high',   patterns:['checkTextSafety.*name','name.*profan','profane.*name'],                                                 freeTools:['DuoGuard on display name']},
{id:245, section:'3', name:'All-caps names',                               severity:'low',    patterns:['isAllCaps','allCapsName'],                                                                              freeTools:['Simple regex all caps check']},
{id:246, section:'3', name:'Keyboard spam names',                          severity:'medium', patterns:['isKeyboardSpam','SPAM_RE','charDiversity'],                                                             freeTools:['Custom — character diversity + ngram analysis']},
{id:247, section:'3', name:'Celebrity name blocking',                      severity:'medium', patterns:['isCelebName','CELEBS','celebrityName'],                                                                freeTools:['Custom celebrity name database']},
{id:248, section:'3', name:'Fake verification symbols in name',            severity:'medium', patterns:['VERIFY_RE','fakeVerify','checkmark.*name'],                                                            freeTools:['Regex for verification emojis']},
{id:249, section:'3', name:'Number / emoji-only names',                    severity:'low',    patterns:['isEmojiOnly','emojiOnly','numberOnlyName'],                                                            freeTools:['Regex character class check']},
{id:250, section:'3', name:'Staff impersonation via name',                 severity:'high',   patterns:['STAFF_KW','staffImperson','impersonat','adminName','moderatorName'],                                   freeTools:['Keyword list: admin, moderator, support, official']},
{id:251, section:'3', name:'ID document verification',                     severity:'high',   patterns:['idVerification','documentVerify','idScan'],                                                            freeTools:['No free production tool — commercial APIs (Onfido, Jumio)']},
{id:252, section:'3', name:'Document liveness verification',               severity:'high',   patterns:['documentLiveness','idLiveness','holdID'],                                                              freeTools:['InsightFace + document edge detection']},
{id:253, section:'3', name:'NFC chip reading for passports',               severity:'low',    patterns:['nfcPassport','chipRead','ePassport'],                                                                  freeTools:['Requires NFC hardware — react-native-nfc-manager']},
{id:254, section:'3', name:'ID document authenticity check',               severity:'high',   patterns:['idAuthenticity','documentAuthentic','fakeIDDetect'],                                                   freeTools:['No free tool — commercial only']},
{id:255, section:'3', name:'Age from ID vs selfie vs claimed',             severity:'high',   patterns:['ageConsistencyTriple','idAge.*selfieAge.*claimedAge'],                                                 freeTools:['DeepFace age estimation + OCR on ID + profile DOB comparison']},
{id:256, section:'3', name:'Name on ID vs profile name',                   severity:'high',   patterns:['nameMatch.*id','idName.*profileName'],                                                                 freeTools:['OCR on ID + string similarity']},
{id:257, section:'3', name:'Expired ID detection',                         severity:'medium', patterns:['expiredID','idExpiry','documentExpired'],                                                              freeTools:['OCR on expiry date field']},
{id:258, section:'3', name:'Known fraudulent ID templates',                severity:'high',   patterns:['fraudulentTemplate','fakeIDTemplate'],                                                                 freeTools:['No free tool — commercial only']},
{id:259, section:'3', name:'Sex offender registry cross-check',            severity:'critical',patterns:['sexOffenderCheck','sexOffenderRegistry','NSOPW'],                                                     freeTools:['NSOPW API (US only, free)']},
{id:260, section:'3', name:'OFAC individual sanctions screening',          severity:'high',   patterns:['ofacScreen','sanctionsScreen','sanctionsList'],                                                        freeTools:['OFAC SDN list (free download)']},
{id:639, section:'3', name:'Background check integration',                 severity:'high',   patterns:['backgroundCheck','criminalRecord'],                                                                    freeTools:['No free tool — commercial APIs']},
{id:640, section:'3', name:'Criminal record screening',                    severity:'high',   patterns:['criminalScreening','felonyCheck'],                                                                     freeTools:['No free tool — commercial APIs']},

// §4.1 Registration Security
{id:261, section:'4.1', name:'Email verification gate',                    severity:'high',   patterns:['emailVerified','sendEmailVerification','verifyEmail'],                                                  freeTools:['Firebase Auth email verification (free)','Custom SMTP verification']},
{id:262, section:'4.1', name:'Disposable email blocking',                  severity:'high',   patterns:['isDisposableEmail','DISPOSABLE_DOMAINS','disposableEmail'],                                            freeTools:['isDisposable (100k+ domains)','disposable-email-domains (npm)']},
{id:263, section:'4.1', name:'Email alias abuse detection',                severity:'medium', patterns:['emailAlias','plusAlias','dotAlias','gmailDot'],                                                        freeTools:['Custom — normalize Gmail dots and plus aliases']},
{id:264, section:'4.1', name:'Apple Hide My Email abuse',                  severity:'medium', patterns:['appleRelay','hideMyEmail','privaterelay.appleid.com'],                                                 freeTools:['Detect privaterelay.appleid.com domain']},
{id:265, section:'4.1', name:'Phone verification',                         severity:'high',   patterns:['phoneVerif','phoneVerified','smsVerification'],                                                       freeTools:['Firebase Phone Auth (free tier)','Twilio Verify (limited free)']},
{id:266, section:'4.1', name:'Google Voice / VOIP number detection',       severity:'medium', patterns:['voipDetect','googleVoice','virtualNumber'],                                                            freeTools:['No reliable free tool — Twilio Lookup API (paid)']},
{id:267, section:'4.1', name:'Phone number recycling detection',           severity:'medium', patterns:['phoneRecycling','numberRecycled'],                                                                    freeTools:['Custom — track phone-to-account history']},
{id:268, section:'4.1', name:'Silent SMS / SS7 attack detection',          severity:'medium', patterns:['silentSMS','ss7Attack'],                                                                              freeTools:['No free tool — carrier-level detection']},
{id:269, section:'4.1', name:'Breached password check',                    severity:'high',   patterns:['checkPasswordBreached','isPasswordBreached','pwnedpasswords'],                                        freeTools:['HaveIBeenPwned Pwned Passwords API (free, unlimited, no auth)']},
{id:270, section:'4.1', name:'Passkey / WebAuthn support',                 severity:'medium', patterns:['passkey','webauthn','fido2','publicKeyCredential'],                                                   freeTools:['simplewebauthn (MIT)','Browser WebAuthn API (free)']},
{id:271, section:'4.1', name:'SIM swap detection',                         severity:'high',   patterns:['simSwap','simChanged','carrierChange'],                                                               freeTools:['No free tool — carrier API required']},

// §4.2 Login Security
{id:272, section:'4.2', name:'Device fingerprinting',                      severity:'high',   patterns:['getDeviceFingerprint','Thumbmark','deviceFingerprint','trackDeviceFingerprint'],                       freeTools:['ThumbmarkJS (MIT, 90.5-95.5% accuracy)']},
{id:273, section:'4.2', name:'Multiple accounts same device',              severity:'high',   patterns:['checkDeviceMultiAccount','multiAccount','checkMultiAccountDevice'],                                   freeTools:['ThumbmarkJS fingerprint — track per-device account count']},
{id:274, section:'4.2', name:'Banned user re-registration',                severity:'high',   patterns:['checkUserBanned','bannedUsers','bannedReuse'],                                                        freeTools:['Device fingerprint + email hash + face embedding matching']},
{id:275, section:'4.2', name:'Account takeover detection',                 severity:'critical',patterns:['detectAccountTakeover','recordDeviceLogin','ato_suspicious','atoSuspicious'],                        freeTools:['Custom — new device + location change + behavior shift']},
{id:276, section:'4.2', name:'Credential stuffing detection',              severity:'high',   patterns:['credentialStuffing','loginBruteForce','failedLoginRate'],                                            freeTools:['Rate limiting + IP tracking']},
{id:277, section:'4.2', name:'Password spray detection',                   severity:'high',   patterns:['passwordSpray','commonPasswordAttempt'],                                                             freeTools:['Custom — track failed logins across accounts from same IP']},
{id:278, section:'4.2', name:'Magic link abuse',                           severity:'medium', patterns:['magicLinkAbuse','linkReuse','magicLinkRate'],                                                        freeTools:['Custom — single-use + expiry enforcement']},
{id:279, section:'4.2', name:'OAuth token theft detection',                severity:'high',   patterns:['oauthTheft','tokenTheft','suspiciousTokenUse'],                                                      freeTools:['Custom — monitor token usage patterns']},
{id:280, section:'4.2', name:'Session token binding',                      severity:'high',   patterns:['sessionBinding','tokenBind','deviceBoundToken'],                                                     freeTools:['Custom — bind session to device fingerprint']},
{id:281, section:'4.2', name:'Refresh token rotation enforcement',         severity:'medium', patterns:['refreshTokenRotation','rotateRefreshToken'],                                                          freeTools:['Firebase Auth handles this','Custom implementation']},
{id:282, section:'4.2', name:'JWT claim tampering detection',              severity:'high',   patterns:['jwtTamper','claimTamper','verifyJWT'],                                                               freeTools:['jsonwebtoken library signature verification']},
{id:283, section:'4.2', name:'Replay attack detection',                    severity:'high',   patterns:['replayAttack','nonceCheck','requestNonce'],                                                          freeTools:['Custom — nonce + timestamp validation']},
{id:284, section:'4.2', name:'Account enumeration via timing',             severity:'medium', patterns:['accountEnumeration','timingAttack','constantTimeCompare'],                                           freeTools:['crypto.timingSafeEqual() in responses']},
{id:285, section:'4.2', name:'Login from datacenter IP',                   severity:'medium', patterns:['datacenterIP','hostingProvider','cloudIP'],                                                          freeTools:['MaxMind GeoLite2 ASN database (free)']},
{id:286, section:'4.2', name:'Impossible login hours',                     severity:'low',    patterns:['impossibleHours','loginTime.*suspicious','nightLogin'],                                              freeTools:['Custom — login time vs timezone analysis']},
{id:287, section:'4.2', name:'Keyboard dynamics analysis',                 severity:'low',    patterns:['keyboardDynamics','typingPattern','keystrokeAnalysis'],                                              freeTools:['Custom — inter-key timing analysis']},
{id:288, section:'4.2', name:'Copy-paste login detection',                 severity:'low',    patterns:['copyPasteLogin','pastedCredentials'],                                                                freeTools:['Custom — detect paste events in login fields']},

// §4.3 Session Security
{id:289, section:'4.3', name:'Concurrent session enforcement',             severity:'high',   patterns:['enforceSessionLimit','checkConcurrentSessions','MAX_SESSIONS'],                                      freeTools:['Firebase Auth session management']},
{id:290, section:'4.3', name:'Account sharing detection',                  severity:'medium', patterns:['accountSharing','sharedAccount','multipleLocations'],                                                freeTools:['Device fingerprint + location diversity analysis']},
{id:291, section:'4.3', name:'Account warming detection',                  severity:'medium', patterns:['accountWarming','dormantThenActive'],                                                                freeTools:['Custom — activity pattern analysis']},
{id:292, section:'4.3', name:'Bot detection (App Check)',                  severity:'high',   patterns:['getAppCheckToken','AppCheck','appCheck'],                                                            freeTools:['Firebase App Check (free)','SafetyNet/Play Integrity (free)']},
{id:293, section:'4.3', name:'Root / jailbreak detection',                 severity:'high',   patterns:['isRooted','jailbreak','RootBeer','dtTJailbreak'],                                                   freeTools:['Play Integrity API','Custom checks (su binary, Cydia, etc)']},
{id:294, section:'4.3', name:'Emulator detection',                         severity:'high',   patterns:['isEmulator','generic_fingerprint','knownEmulators'],                                                freeTools:['Play Integrity API','Custom hardware property checks']},
{id:295, section:'4.3', name:'Tampered APK detection',                     severity:'high',   patterns:['apkTamper','tampered_apk','appSignature.*expectedSignature','integrityCheck'],                     freeTools:['Play Integrity API','Custom signature verification']},
{id:296, section:'4.3', name:'Debug mode detection',                       severity:'medium', patterns:['FLAG_DEBUGGABLE','isDebug','debug_mode','check-device-integrity'],                                  freeTools:['Custom — check BuildConfig.DEBUG / debuggable flag']},
{id:297, section:'4.3', name:'Developer options enabled',                  severity:'medium', patterns:['DEVELOPMENT_SETTINGS','developerOptions','developer_options'],                                      freeTools:['Android: Settings.Global.DEVELOPMENT_SETTINGS_ENABLED']},
{id:298, section:'4.3', name:'USB debugging active',                       severity:'medium', patterns:['ADB_ENABLED','usbDebug','adbEnabled','adb_enabled'],                                                freeTools:['Android: Settings.Global.ADB_ENABLED']},
{id:299, section:'4.3', name:'Frida / hooking detection',                  severity:'high',   patterns:['fridaDetected','hasFrida','frida_detected','hookDetect'],                                          freeTools:['Custom — check for frida-server, Substrate, Xposed']},
{id:300, section:'4.3', name:'Memory tampering detection',                 severity:'high',   patterns:['memoryTamper','checksumMemory','memory_tamper'],                                                   freeTools:['Custom — runtime integrity checks']},
{id:301, section:'4.3', name:'Mock location apps',                         severity:'high',   patterns:['hasMockLocation','ALLOW_MOCK_LOCATION','mock_location','mockGPS'],                                  freeTools:['Android: Settings.Secure.ALLOW_MOCK_LOCATION']},
{id:302, section:'4.3', name:'Screen recording detection',                 severity:'medium', patterns:['isCaptured','screenRecord','screen_recording'],                                                    freeTools:['iOS: UIScreen.isCaptured','Android: MediaProjection detection']},
{id:303, section:'4.3', name:'Accessibility service abuse',                severity:'medium', patterns:['accessibilityAbuse','getEnabledAccessibility','accessibility_abuse'],                               freeTools:['Custom — enumerate running accessibility services']},
{id:304, section:'4.3', name:'App clone detection',                        severity:'medium', patterns:['appClone','dualSpace','parallelSpace'],                                                             freeTools:['Custom — check for known clone app packages']},
{id:305, section:'4.3', name:'Overlay attack detection',                   severity:'high',   patterns:['overlayAttack','TYPE_APPLICATION_OVERLAY','drawOverApps'],                                         freeTools:['Android: detect active overlays']},
{id:306, section:'4.3', name:'Tapjacking prevention',                      severity:'high',   patterns:['tapjacking','filterTouchesWhenObscured'],                                                          freeTools:['Android: filterTouchesWhenObscured=true']},
{id:307, section:'4.3', name:'Deep link hijacking',                        severity:'medium', patterns:['deepLinkHijack','intentHijack','universalLink.*verification'],                                     freeTools:['Custom — verify deep link domains']},
{id:308, section:'4.3', name:'Clipboard sniffing detection',               severity:'medium', patterns:['clipboardSniff','pasteboardAccess','clipboardMonitor'],                                            freeTools:['iOS 14+: paste notification','Custom monitoring']},
{id:309, section:'4.3', name:'Push notification spoofing',                 severity:'medium', patterns:['pushSpoof','notificationSpoof'],                                                                   freeTools:['Custom — verify notification source']},
{id:310, section:'4.3', name:'Biometric bypass detection',                 severity:'high',   patterns:['biometricBypass','biometricSpoof','fakeBiometric'],                                               freeTools:['Custom — monitor biometric API calls']},
{id:311, section:'4.3', name:'MDM / enterprise certificate abuse',         severity:'medium', patterns:['mdmAbuse','enterpriseCert','provisioningProfile'],                                                 freeTools:['Custom — check for enterprise provisioning']},

// §4.4 Account Creation by Proxy
{id:905, section:'4.4', name:'Proxy account creation detection',           severity:'medium', patterns:['proxyAccountCreation','accountProxy','thirdPartyCreation'],                                         freeTools:['Custom — behavioral signals']},
{id:906, section:'4.4', name:'Account credential handoff detection',       severity:'medium', patterns:['credentialHandoff','accountHandover'],                                                             freeTools:['Custom — device change + behavior shift']},

// §4.5 Shared Device Safety
{id:801, section:'4.5', name:'Public/shared computer detection',           severity:'medium', patterns:['publicComputer','sharedDevice','publicTerminal'],                                                   freeTools:['Custom — check for known public device characteristics']},
{id:802, section:'4.5', name:'Auto-logout on shared device',               severity:'medium', patterns:['autoLogout','sharedDeviceLogout'],                                                                 freeTools:['Custom — shorter session timeout on detected shared devices']},
{id:803, section:'4.5', name:'Browser data auto-clear',                    severity:'low',    patterns:['autoClearData','clearOnClose','privateMode'],                                                      freeTools:['Custom — prompt for private browsing']},

// §5.1 Scam Behavioral Patterns
{id:312, section:'5.1', name:'Romance scam scoring',                       severity:'high',   patterns:['romanceScam','scamScore','computeRomanceScamScore'],                                               freeTools:['No free off-the-shelf tool — custom scoring model (scikit-learn/XGBoost)']},
{id:313, section:'5.1', name:'Catfish likelihood score',                   severity:'high',   patterns:['computeCatfishScore','catfishScore','catfishLikelihood'],                                         freeTools:['Custom composite score: face match + verification + behavior']},
{id:314, section:'5.1', name:'Pig butchering phase detection',             severity:'high',   patterns:['pigButcheringPhase','sha_zhu_pan_phase','butcheringPhase'],                                       freeTools:['No free tool — custom conversation phase classifier']},
{id:315, section:'5.1', name:'Swarming behavior',                          severity:'high',   patterns:['swarmingBehavior','multiAccountVictim','coordinatedTargeting'],                                   freeTools:['Custom — graph analysis (NetworkX/igraph)']},
{id:316, section:'5.1', name:'Victim profiling detection',                 severity:'high',   patterns:['victimProfiling','targetSelection','vulnerableUserTarget'],                                       freeTools:['Custom — analyze target selection patterns']},
{id:317, section:'5.1', name:'Network analysis of victim overlap',         severity:'medium', patterns:['victimOverlap','sharedVictims','networkAnalysis'],                                                freeTools:['NetworkX/igraph graph analysis']},
{id:318, section:'5.1', name:'Behavioral fingerprinting across accounts',  severity:'high',   patterns:['behavioralFingerprint','crossAccountBehavior','typingFingerprint'],                               freeTools:['Custom — typing patterns + interaction style analysis']},
{id:319, section:'5.1', name:'Second chance scam (return after block)',    severity:'high',   patterns:['returnAfterBlock','reEngageVictim','secondChanceScamDetect'],                                     freeTools:['Device fingerprint + face match on new accounts']},
{id:320, section:'5.1', name:'Recovery scam targeting',                    severity:'high',   patterns:['recoveryScamTarget','getMoneyBack.*scam'],                                                        freeTools:['Custom keyword patterns']},
{id:785, section:'5.1', name:'Strategic imperfection scam pattern',        severity:'medium', patterns:['strategicImperfection','deliberateFlaw','tooGoodExceptOne'],                                     freeTools:['No free tool']},
{id:786, section:'5.1', name:'Evolving scam narrative classifier',         severity:'medium', patterns:['evolvingNarrative','scamNarrativeUpdate'],                                                        freeTools:['Sentence-Transformers + periodic retraining']},
{id:787, section:'5.1', name:'Widowed/divorced professional clustering',   severity:'medium', patterns:['widowedProfessional','divorceNarrative.*professional'],                                          freeTools:['Custom clustering on profile fields']},

// §5.2 Predatory Patterns
{id:321, section:'5.2', name:'Age-gap predator patterns',                  severity:'critical',patterns:['detectAgePredatorPattern','agePredator','ageGapPredator'],                                       freeTools:['Custom — age preference + messaging pattern analysis']},
{id:322, section:'5.2', name:'Grooming behavioral sequence',               severity:'critical',patterns:['groomingSequence','groomingBehavior','progressiveGrooming'],                                     freeTools:['No free tool — custom sequential classifier']},
{id:323, section:'5.2', name:'Escalating boundary testing',                severity:'high',   patterns:['boundaryTesting','escalatingBoundary','pushingLimits'],                                          freeTools:['Custom — track progressive boundary violations']},
{id:324, section:'5.2', name:'Photo request pressure pattern',             severity:'high',   patterns:['photoRequestPressure','pressureForPhotos'],                                                      freeTools:['Custom — track repeated photo request + escalation']},
{id:325, section:'5.2', name:'Blackmail escalation trajectory',            severity:'critical',patterns:['blackmailEscalation','threatTrajectory'],                                                       freeTools:['Custom — sentiment + threat scoring over time']},
{id:326, section:'5.2', name:'Hoovering patterns',                         severity:'medium', patterns:['hoovering','hooverPattern','comeBackAfterNC'],                                                   freeTools:['Custom — detect re-contact after block/unmatch']},
{id:327, section:'5.2', name:'Politically exposed person detection',       severity:'medium', patterns:['pepDetection','politicallyExposed'],                                                             freeTools:['OpenSanctions PEP lists (free)']},
{id:328, section:'5.2', name:'Journalist / activist targeting',            severity:'medium', patterns:['journalistTargeting','activistTarget','pressTarget'],                                            freeTools:['No free tool — policy-based']},

// §5.3 Child Predator Targeting Single Parents
{id:818, section:'5.3', name:'Single parent targeting pattern',            severity:'critical',patterns:['singleParentTargeting','targetSingleParent'],                                                   freeTools:['Custom — analyze messaging to users with parent in profile']},
{id:819, section:'5.3', name:'Child access motivation scoring',            severity:'critical',patterns:['childAccessMotivation','kidsMention.*early'],                                                   freeTools:['Custom — detect early/excessive children-related questions']},
{id:820, section:'5.3', name:'Child-related question velocity',            severity:'critical',patterns:['childQuestionVelocity','kidsQuestionRate'],                                                     freeTools:['Custom — keyword frequency analysis']},
{id:821, section:'5.3', name:'Sex offender behavioral profile matching',   severity:'critical',patterns:['sexOffenderProfile','behavioralProfileMatch'],                                                  freeTools:['Custom classifier based on research literature']},
{id:822, section:'5.3', name:'Meet the kids velocity detector',            severity:'critical',patterns:['meetTheKids','kidsIntroduction.*early'],                                                       freeTools:['Custom — keyword + timing analysis']},
{id:823, section:'5.3', name:'Single parent safety education prompt',      severity:'high',   patterns:['singleParentSafetyPrompt','parentSafetyEducation'],                                            freeTools:['Custom educational UI']},

// §5.4 Engagement Fraud
{id:329, section:'5.4', name:'Rapid unmatching detection',                 severity:'medium', patterns:['trackUnmatch','unmatch.*suspicious','unmatchRate'],                                             freeTools:['Custom — unmatch rate threshold']},
{id:330, section:'5.4', name:'Stalking via profile views',                 severity:'high',   patterns:['trackProfileView','profileView.*suspicious','excessiveViews'],                                 freeTools:['Custom — view frequency per target']},
{id:331, section:'5.4', name:'Mass false reporting',                       severity:'high',   patterns:['trackReport','report.*suspicious','falseReport','validateReporter','trackReportDaily'],        freeTools:['Custom — reporter credibility scoring']},
{id:332, section:'5.4', name:'Ghost / inactive profiles',                  severity:'medium', patterns:['ghostProfile','isGhostProfile','inactiveProfile'],                                             freeTools:['Custom — last activity threshold']},
{id:333, section:'5.4', name:'Elo / ranking manipulation',                 severity:'medium', patterns:['detectEloManipulation','eloManipul','scoreManipul'],                                          freeTools:['Custom — statistical anomaly detection on scores']},
{id:334, section:'5.4', name:'Boost abuse',                                severity:'medium', patterns:['detectBoostAbuse','checkBoostAllowed','boostAbuse','boostLimit'],                             freeTools:['Custom — rate limiting + pattern analysis']},
{id:335, section:'5.4', name:'Review manipulation (Bayesian)',             severity:'medium', patterns:['wilsonScore','detectRatingManipulation','reviewManipul'],                                     freeTools:['Wilson score interval implementation']},
{id:336, section:'5.4', name:'Swipe reset abuse',                          severity:'medium', patterns:['trackAccountCreation','account.*creation.*suspicious','swipeReset'],                          freeTools:['Device fingerprint tracking across accounts']},
{id:337, section:'5.4', name:'Super like abuse',                           severity:'low',    patterns:['checkSuperLikeLimit','superLikeLimit','superLikeAbuse'],                                      freeTools:['Custom — rate limiting']},
{id:338, section:'5.4', name:'Bot story views',                            severity:'medium', patterns:['detectBotStoryViews','botStoryView','botViewStory'],                                          freeTools:['Custom — view timing + device fingerprint analysis']},
{id:339, section:'5.4', name:'Referral fraud',                             severity:'medium', patterns:['detectReferralFraud','referralFraud'],                                                        freeTools:['Custom — device fingerprint + referral pattern analysis']},
{id:340, section:'5.4', name:'Swipe pattern anomalies',                    severity:'medium', patterns:['swipeAnomaly','likesEveryone','swipeRatio'],                                                  freeTools:['Custom — like/pass ratio analysis']},
{id:341, section:'5.4', name:'Profile view without interaction (scraping)',severity:'medium', patterns:['scrapingDetect','viewWithoutInteract','passiveScrape'],                                       freeTools:['Custom — view-to-interaction ratio']},
{id:342, section:'5.4', name:'Fake engagement signals',                    severity:'medium', patterns:['detectFakeEngagement','engagementAnomaly','fakeEngagement'],                                  freeTools:['Custom — statistical anomaly detection']},
{id:343, section:'5.4', name:'Conversion fraud',                           severity:'medium', patterns:['detectConversionFraud','conversionFraud','fraudConversion'],                                  freeTools:['Custom — attribution analysis']},
{id:344, section:'5.4', name:'Night shift messaging only',                 severity:'low',    patterns:['nightShiftOnly','nightTimeOnly','messagingHoursAnomaly'],                                     freeTools:['Custom — message time distribution analysis']},
{id:345, section:'5.4', name:'Systematic ghosting (read no reply)',        severity:'low',    patterns:['systematicGhosting','readNoReply','ghostingPattern'],                                        freeTools:['Custom — read receipt no reply rate']},

// §5.5 Conversation Analysis
{id:346, section:'5.5', name:'Video call refusal patterns',                severity:'high',   patterns:['detectVideoCallRefusal','refuseVideo','video.*call.*refus'],                                  freeTools:['Custom — track video call invitation refusal sequences']},
{id:347, section:'5.5', name:'Off-platform redirection behavioral',        severity:'high',   patterns:['offPlatformBehavior','platformSwitchTracking','switchAppBehavior'],                          freeTools:['Keyword detection for messaging app names']},
{id:348, section:'5.5', name:'Fast-escalating conversation behavioral',    severity:'high',   patterns:['fastEscalationBehavior','escalationSpeed','rapidIntimacy'],                                  freeTools:['Custom — intimacy score velocity']},
{id:349, section:'5.5', name:'Financial requests behavioral',              severity:'high',   patterns:['financialRequestBehavior','askForMoney','lendMeMoney'],                                      freeTools:['Keyword patterns']},
{id:350, section:'5.5', name:'Crypto scam patterns',                       severity:'high',   patterns:['cryptoScamPattern','investmentOpportunity','crypto.*profit'],                               freeTools:['Keyword patterns + crypto address regex']},
{id:351, section:'5.5', name:'Love bombing escalation behavioral',         severity:'high',   patterns:['loveBombingBehavior','intenseLoveBomb','loveBombEscalate'],                                 freeTools:['Custom sentiment velocity']},
{id:352, section:'5.5', name:'Conversation mirroring',                     severity:'medium', patterns:['conversationMirroring','echoBack','parrotResponse'],                                        freeTools:['Sentence-Transformers similarity between sent/received']},

// §5.6 Forced Scammer / Trafficking
{id:767, section:'5.6', name:'Forced scammer distress signal',             severity:'critical',patterns:['forcedScammer','distressSignal','scamCompound'],                                            freeTools:['Custom keyword patterns for coded distress']},
{id:768, section:'5.6', name:'Scam compound operating pattern',            severity:'high',   patterns:['scamCompoundPattern','shiftPattern','compoundOperation'],                                   freeTools:['Custom — time pattern + IP clustering']},
{id:769, section:'5.6', name:'Trafficking victim referral pathway',        severity:'critical',patterns:['traffickingReferral','victimPathway','polarisTipline'],                                    freeTools:['National Human Trafficking Hotline routing']},
{id:770, section:'5.6', name:'Scam script template matching',              severity:'high',   patterns:['scamTemplate','playbook.*match','knownScript'],                                            freeTools:['Sentence-Transformers similarity to known scripts']},

// §5.7 Post-Relationship Platform Abuse
{id:739, section:'5.7', name:'Ex-partner profile monitoring',              severity:'high',   patterns:['exPartnerMonitoring','exStalking','exProfileView'],                                        freeTools:['Custom — repeated views of specific profile']},
{id:740, section:'5.7', name:'Revenge swiping / mass-right-swipe',        severity:'medium', patterns:['revengeSwiping','massSwipe.*contacts'],                                                    freeTools:['Custom — contact list correlation']},
{id:741, section:'5.7', name:'Post-breakup impersonation',                 severity:'high',   patterns:['postBreakupImpersonation','exImpersonation'],                                             freeTools:['Face matching against reported impersonation']},
{id:742, section:'5.7', name:'Coordinated friend-group harassment',        severity:'high',   patterns:['coordinatedHarassment','friendGroupAttack'],                                              freeTools:['Graph analysis of report sources']},

// §5.8 Proxy Account Operation
{id:788, section:'5.8', name:'Paid matchmaker operation detection',        severity:'medium', patterns:['paidMatchmaker','conciergeOperation','managedAccount'],                                    freeTools:['Custom — behavior consistency analysis']},
{id:789, section:'5.8', name:'Parent-created profile for adult',           severity:'medium', patterns:['parentCreatedProfile','thirdPartyProfileOp'],                                            freeTools:['Custom — behavior + writing style analysis']},
{id:790, section:'5.8', name:'Account selling / marketplace (behavioral)', severity:'medium', patterns:['accountSellingBehavior','buyAccount','accountSale'],                                     freeTools:['Custom — sudden behavior change + device change']},

// §5.9 Married / Relationship Status Deception
{id:899, section:'5.9', name:'Ring/wedding band detection',                severity:'medium', patterns:['ringDetection','weddingBand','marriedSignal'],                                           freeTools:['CLIP zero-shot: wedding ring on hand','YOLO fine-tuned']},
{id:900, section:'5.9', name:'Relationship status inconsistency',          severity:'medium', patterns:['relationshipInconsistency','marriedOnOtherPlatform'],                                   freeTools:['Cross-platform signal (user reports)']},
{id:901, section:'5.9', name:'Affair-seeking on non-affair platforms',     severity:'medium', patterns:['affairSeeking','discreetMeeting','marriedButLooking'],                                  freeTools:['Keyword patterns + behavioral signals']},

// §5.10 State-Sponsored Espionage / Honeytrap
{id:824, section:'5.10', name:'State-sponsored honeytrap pattern',         severity:'high',   patterns:['honeytrapPattern','stateSponsored','espionagePattern'],                                  freeTools:['No free tool — intelligence-level analysis']},
{id:825, section:'5.10', name:'Intelligence elicitation pattern',          severity:'high',   patterns:['elicitationPattern','probing.*classified'],                                             freeTools:['Custom keyword patterns for security-sensitive topics']},
{id:826, section:'5.10', name:'Malware-link-via-dating-chat',              severity:'high',   patterns:['malwareLink','trojanLink','spywareLink'],                                               freeTools:['Google Safe Browsing + VirusTotal']},
{id:827, section:'5.10', name:'Geolocation intelligence harvesting',       severity:'high',   patterns:['geoIntHarvesting','locationHarvesting'],                                               freeTools:['Custom — detect excessive location queries']},
{id:828, section:'5.10', name:'Foreign intelligence TTP matching',         severity:'high',   patterns:['foreignIntelTTP','ttpMatching'],                                                       freeTools:['MISP threat intelligence (free)']},

// §5.11 Extremist Recruitment via Dating
{id:812, section:'5.11', name:'Incel / manosphere radicalization',         severity:'high',   patterns:['incelRadicalization','manosphere','blackpill','redpill'],                             freeTools:['Custom keyword list + Perspective API']},
{id:813, section:'5.11', name:'Extremist recruitment via romance',         severity:'high',   patterns:['extremistRecruitment','radicalRecruitment'],                                         freeTools:['Custom keyword patterns + GIFCT']},
{id:814, section:'5.11', name:'Conspiracy theory propagation',             severity:'medium', patterns:['conspiracyTheory','qanon','flatEarth','deepState'],                                  freeTools:['Custom keyword list']},

// §6 Location & Physical Safety
{id:353, section:'6', name:'Geographic impossibility',                     severity:'high',   patterns:['haversineKm','checkGeoImpossibility','impossibleTravel','detectImpossibleTravel'],   freeTools:['Haversine formula + time delta calculation']},
{id:354, section:'6', name:'Mock GPS detection',                           severity:'high',   patterns:['mockGPS','mockLocation','detectMockLocation','ALLOW_MOCK_LOCATION'],                 freeTools:['Android: Settings.Secure.ALLOW_MOCK_LOCATION check']},
{id:355, section:'6', name:'Geofencing sanctioned countries',              severity:'high',   patterns:['SANCTIONED','isSanctioned','sanctionedCountry','countryBlock'],                     freeTools:['MaxMind GeoLite2 (free) + OFAC country list']},
{id:356, section:'6', name:'IP vs GPS mismatch',                           severity:'high',   patterns:['checkIPGPSMismatch','ipGPSMismatch','ipMismatch'],                                  freeTools:['MaxMind GeoLite2 IP compare to GPS coordinates']},
{id:357, section:'6', name:'VPN / Proxy / Tor detection',                  severity:'high',   patterns:['detectVPNProxy','isProxy','isTor','vpnDetect'],                                    freeTools:['GetIPIntel (free)','MaxMind GeoLite2 ASN database']},
{id:358, section:'6', name:'Impossible travel between check-ins',          severity:'high',   patterns:['checkImpossibleCheckin','impossibleCheckin','travelSpeed'],                         freeTools:['Haversine distance / time delta']},
{id:359, section:'6', name:'International location change without notice', severity:'medium', patterns:['internationalChange','countryChange','crossBorder'],                               freeTools:['GeoLite2 country change detection']},
{id:360, section:'6', name:'Location history consistency',                 severity:'medium', patterns:['locationHistory','locationConsistency','gpsHistory'],                             freeTools:['Custom — track location patterns over time']},
{id:361, section:'6', name:'Location sharing revoked mid-date',            severity:'high',   patterns:['locationRevoked','stoppedSharing','gpsDisabled'],                                 freeTools:['Custom — monitor sharing status during date window']},
{id:362, section:'6', name:'High-risk area flagging',                      severity:'medium', patterns:['highRiskArea','dangerousArea','crimeHotspot'],                                    freeTools:['OpenStreetMap + crime data APIs (varies by city)']},
{id:363, section:'6', name:'Human trafficking corridor detection',         severity:'critical',patterns:['traffickingCorridor','traffickingRoute','borderCorridor'],                        freeTools:['Custom — geographic pattern matching']},
{id:364, section:'6', name:'Motel / hotel address detection',              severity:'medium', patterns:['motelDetect','hotelAddress','lodgingDetect'],                                     freeTools:['OpenStreetMap Overpass API — query amenity=hotel/motel']},
{id:365, section:'6', name:'Isolated location detection',                  severity:'high',   patterns:['isolatedLocation','remoteArea','noNearbyServices'],                              freeTools:['OpenStreetMap — check POI density around coordinates']},
{id:366, section:'6', name:'Recurring location with different matches',    severity:'medium', patterns:['recurringLocation','sameLocationDifferentDates'],                               freeTools:['Custom — cluster analysis of meeting locations']},
{id:367, section:'6', name:'Meeting location changed last minute',         severity:'high',   patterns:['lastMinuteChange','locationChanged','suddenLocationChange'],                     freeTools:['Custom — track location updates close to meeting time']},
{id:368, section:'6', name:'Geofence escape detection',                    severity:'high',   patterns:['geofenceEscape','leftSafeZone'],                                                 freeTools:['Custom — geofence monitoring']},
{id:369, section:'6', name:'Speed of location change post-date',           severity:'medium', patterns:['postDateSpeed','rapidLocationChange'],                                          freeTools:['Haversine speed calculation']},
{id:370, section:'6', name:'Cluster of reports from same location',        severity:'high',   patterns:['reportCluster','locationReportCluster'],                                       freeTools:['Custom — spatial clustering (DBSCAN)']},
{id:371, section:'6', name:'Border crossing detection',                    severity:'medium', patterns:['borderCrossing','countryBoundary'],                                            freeTools:['GeoLite2 country change']},
{id:372, section:'6', name:'Safe meeting locations',                       severity:'high',   patterns:['safeMeetingLocation','getSafeMeetingLocationSuggestions','dateSafety'],       freeTools:['OpenStreetMap Overpass — query public venues']},
{id:373, section:'6', name:'Meeting location safety scoring',              severity:'medium', patterns:['locationSafetyScore','meetingLocationScore'],                                 freeTools:['Custom — POI density + public transit proximity + lighting']},
{id:374, section:'6', name:'Late night first meeting detection',           severity:'medium', patterns:['lateNightMeeting','firstDateNight','meetingHourCheck'],                      freeTools:['Custom — time of meeting analysis']},
{id:375, section:'6', name:'Share meeting location with trusted contact',  severity:'high',   patterns:['createMeetingLocationShare','shareMeeting','share-meeting-location','trustedContact'], freeTools:['Custom feature implementation']},
{id:616, section:'6', name:'Distance-based triangulation prevention',      severity:'high',   patterns:['triangulationPrevention','distanceAttack','trilateration'],                  freeTools:['H3 / S2 Geometry — snap to hex/cell centers']},
{id:617, section:'6', name:'Fuzzy/approximate distance display',           severity:'high',   patterns:['fuzzyDistance','approximateDistance','distanceBucket'],                     freeTools:['H3 hexagonal binning']},
{id:618, section:'6', name:'Location precision reduction for non-matches', severity:'high',   patterns:['locationPrecision','reducePrecision','coarseLocation'],                    freeTools:['Round coordinates to fewer decimal places']},

// §6.1 Robbery / Violent Crime Lure
{id:874, section:'6.1', name:'Robbery lure pattern detection',             severity:'high',   patterns:['robberyLure','lurePattern','meetupRobbery'],                              freeTools:['Custom — isolated location + first meeting + night time signals']},
{id:875, section:'6.1', name:'Bait-and-switch meetup',                     severity:'high',   patterns:['baitAndSwitch','differentPerson','notWhoExpected'],                      freeTools:['Post-date report category + face verification']},
{id:876, section:'6.1', name:'LGBTQ+ targeted robbery pattern',            severity:'high',   patterns:['lgbtqRobbery','gayBashing','targetedAttack'],                            freeTools:['Custom — combine LGBTQ+ user flag + location risk + behavioral signals']},
{id:877, section:'6.1', name:'Repeat lure location clustering',            severity:'high',   patterns:['lureLocationCluster','repeatDangerousLocation'],                        freeTools:['DBSCAN spatial clustering of incident reports']},
{id:878, section:'6.1', name:'Post-meetup emergency signal',               severity:'critical',patterns:['emergencySignal','panicButton','postMeetupSOS'],                        freeTools:['Custom SOS feature']},
{id:879, section:'6.1', name:'Drugging/incapacitation risk alert',         severity:'high',   patterns:['druggingRisk','drinkSpiking','incapacitation'],                         freeTools:['Educational prompt + post-date check-in']},
{id:880, section:'6.1', name:'Burglary-through-dating pattern',            severity:'high',   patterns:['burglaryPattern','homeAddressExploit','casTheJoint'],                   freeTools:['Custom — home address sharing detection']},

// §7 Voice & Audio Safety
{id:376, section:'7', name:'Voice cloning detection',                      severity:'high',   patterns:['detectVoiceCloneHeuristic','likelyCloned','voiceClone'],                freeTools:['WeDefense (open-source)','FakeVoiceFinder (research-grade)','ASVspoof baselines']},
{id:377, section:'7', name:'Voice gender vs profile gender',               severity:'medium', patterns:['checkVoiceGenderConsistency','voiceGender','analyzeVoiceGender'],      freeTools:['Whisper transcription + pitch analysis (librosa)']},
{id:378, section:'7', name:'Transcribe audio + scan',                      severity:'high',   patterns:['transcribeAndModerateAudio','transcribeAndModerate'],                  freeTools:['Whisper (MIT) DuoGuard/Llama Guard text scan']},
{id:379, section:'7', name:'Pre-recorded audio anomalies',                 severity:'medium', patterns:['detectPreRecordedAudio','likelyPreRecorded'],                         freeTools:['Custom — audio quality/compression analysis']},
{id:380, section:'7', name:'NSFW speech in voice intros (audio section)',  severity:'high',   patterns:['checkNsfwSpeechVoice','nsfw_speech_voice'],                           freeTools:['Whisper DuoGuard sexual_content category']},
{id:381, section:'7', name:'Audio deepfake (full synthesis)',              severity:'high',   patterns:['audioDeepfake','syntheticVoice','voiceSynthesisDetect'],              freeTools:['WeDefense','ASVspoof baselines (research-grade)']},
{id:382, section:'7', name:'Real-time voice deepfake detection',           severity:'high',   patterns:['realtimeVoiceDeepfake','liveVoiceDeepfake'],                         freeTools:['Resemble Detect (free non-commercial, up to 2min)']},
{id:383, section:'7', name:'Background noise analysis (call center)',      severity:'medium', patterns:['backgroundNoise','callCenterDetect','ambientNoise'],                 freeTools:['Custom — spectral analysis for call center patterns']},
{id:384, section:'7', name:'Accent vs claimed location mismatch',          severity:'medium', patterns:['accentMismatch','accentLocation','dialectAnalysis'],                 freeTools:['No reliable free tool']},
{id:385, section:'7', name:'Multiple voices in audio',                     severity:'medium', patterns:['multipleVoices','speakerDiarization','voiceCount'],                 freeTools:['pyannote.audio (MIT) speaker diarization']},
{id:386, section:'7', name:'Audio splicing detection',                     severity:'medium', patterns:['audioSplicing','audioEditDetect'],                                 freeTools:['Custom — discontinuity detection']},
{id:387, section:'7', name:'Emotional authenticity scoring',               severity:'low',    patterns:['emotionalAuthenticity','emotionAnalysis','sentimentVoice'],         freeTools:['Custom — prosody analysis']},
{id:388, section:'7', name:'Script-reading detection',                     severity:'medium', patterns:['scriptReading','readingDetect','monotoneDetect'],                  freeTools:['Custom — prosody + pause pattern analysis']},
{id:389, section:'7', name:'Background music fingerprinting',              severity:'low',    patterns:['musicFingerprint','backgroundMusic','audioFingerprint'],           freeTools:['chromaprint / acoustid (open-source)']},
{id:390, section:'7', name:'Room acoustics consistency',                   severity:'low',    patterns:['roomAcoustics','reverbAnalysis','environmentConsistency'],         freeTools:['Custom — reverb profile analysis']},
{id:391, section:'7', name:'Phone quality vs claimed device',              severity:'low',    patterns:['phoneQuality','audioQualityDevice','codecMismatch'],              freeTools:['Custom — audio codec/bitrate analysis']},
{id:392, section:'7', name:'DTMF tone detection (call center)',            severity:'medium', patterns:['dtmfDetect','toneDetect','touchtone'],                            freeTools:['Custom — DTMF frequency detection']},
{id:393, section:'7', name:'Hold music detection',                         severity:'low',    patterns:['holdMusic','holdMusicDetect'],                                    freeTools:['Custom — music detection during pauses']},
{id:394, section:'7', name:'Echo / delay pattern detection',               severity:'low',    patterns:['echoDetect','delayPattern','latencyAnomaly'],                    freeTools:['Custom — echo cancellation residual analysis']},
{id:395, section:'7', name:'Keyword spotting in calls',                    severity:'medium', patterns:['keywordSpotting','callKeyword','voiceKeyword'],                  freeTools:['Whisper transcription keyword search']},
{id:396, section:'7', name:'Voice stress analysis',                        severity:'low',    patterns:['voiceStress','stressAnalysis','voiceTremor'],                    freeTools:['No scientifically validated free tool']},
{id:397, section:'7', name:'Coached response detection',                   severity:'medium', patterns:['coachedResponse','promptedAnswer','feedResponse'],               freeTools:['Custom — pause pattern + background voice detection']},

// §8 Encryption & Privacy
{id:398, section:'8', name:'E2EE for text messages',                       severity:'high',   patterns:['encryptTextForRecipient','decryptTextFromSender','ensureMyE2EEIdentity','e2ee.*text'],   freeTools:['Signal Protocol / libsignal (open-source)','TweetNaCl (MIT)']},
{id:399, section:'8', name:'E2EE for images',                              severity:'high',   patterns:['encryptAndUploadImageForRecipient','encryptImage','e2ee.*image'],                        freeTools:['Signal Protocol for media','NaCl box encryption']},
{id:400, section:'8', name:'E2EE for voice',                               severity:'high',   patterns:['encryptAndUploadVoiceForRecipient','encryptVoice','e2eeVoice','E2EEAudio'],              freeTools:['Signal Protocol for media']},
{id:401, section:'8', name:'Scan before encryption',                       severity:'high',   patterns:['scanBeforeEncrypt','preScanEncrypt','moderateThenEncrypt'],                              freeTools:['Client-side NSFWJS/DuoGuard then encrypt']},
{id:402, section:'8', name:'E2EE key injection detection',                 severity:'high',   patterns:['verifyKeyIntegrity','computeKeyFingerprint','key.*fingerprint'],                        freeTools:['Custom — key fingerprint comparison']},
{id:403, section:'8', name:'Key transparency logs',                        severity:'medium', patterns:['appendKeyTransparencyLog','keyTransparency'],                                          freeTools:['Custom — append-only key log']},
{id:404, section:'8', name:'Privacy / data controls',                      severity:'high',   patterns:['logPrivacySettingsUpdate','requestDataDeletion','deleteMyData'],                       freeTools:['Custom feature implementation']},
{id:405, section:'8', name:'Prevent photo saving (FLAG_SECURE)',           severity:'medium', patterns:['FLAG_SECURE','FlagSecure','preventScreenshot'],                                        freeTools:['Android: FLAG_SECURE','iOS: custom screenshot prevention']},
{id:406, section:'8', name:'Screenshot detection',                         severity:'medium', patterns:['logScreenshotEvent','screenshotDetect'],                                               freeTools:['react-native-screenshot-detect','iOS: UIApplicationUserDidTakeScreenshotNotification']},
{id:407, section:'8', name:'SSL certificate pinning',                      severity:'high',   patterns:['MIN_TLS_VERSION','TLSv1\\.2','TLSv1\\.3','certPinning','sslPinning'],                 freeTools:['react-native-ssl-pinning','TrustKit (open-source)']},
{id:408, section:'8', name:'Minimum TLS version',                          severity:'high',   patterns:['MIN_TLS_VERSION','TLSv1\\.2','TLSv1\\.3','minTLSVersion'],                            freeTools:['Server config: minVersion TLSv1.2']},
{id:409, section:'8', name:'Certificate transparency monitoring',          severity:'medium', patterns:['certificateTransparency','ctLog','certTransparency'],                                 freeTools:['crt.sh (free CT log search)']},
{id:410, section:'8', name:'Secure enclave usage',                         severity:'high',   patterns:['secureEnclave','keychain','keystoreGeneric','SecureStore'],                           freeTools:['expo-secure-store','react-native-keychain']},
{id:411, section:'8', name:'Session hijacking detection',                  severity:'high',   patterns:['sessionHijack','tokenTheft','sessionBind'],                                          freeTools:['Custom — bind session to device fingerprint + IP']},

// §9 Physical Date Safety
{id:412, section:'9', name:'Emergency SOS button',                         severity:'critical',patterns:['triggerSOS','emergencyContact','date-safety','EmergencyContact','panicButton'],      freeTools:['Custom feature — call emergency contact + share location']},
{id:413, section:'9', name:'Date check-in reminders',                      severity:'high',   patterns:['dateCheckin','DateCheckin','scheduleCheckInNotification'],                           freeTools:['Custom — scheduled notification']},
{id:414, section:'9', name:'Missed check-in alert',                        severity:'critical',patterns:['missedCheckin','missedCheckinAlertSent'],                                           freeTools:['Custom — alert emergency contact if check-in missed']},
{id:415, section:'9', name:'Safe meeting locations (date safety)',         severity:'high',   patterns:['safeMeetingLocation','safeVenue','publicPlace'],                                   freeTools:['OpenStreetMap Overpass API']},
{id:416, section:'9', name:'Share meeting location (date safety)',         severity:'high',   patterns:['createMeetingLocationShare','shareMeeting'],                                      freeTools:['Custom feature']},
{id:417, section:'9', name:'User never checks in detection',               severity:'medium', patterns:['neverChecksIn','skipCheckIn','ignoredCheckIn'],                                   freeTools:['Custom — track check-in compliance']},
{id:418, section:'9', name:'Speed dating fraud',                           severity:'medium', patterns:['speedDatingFraud','eventFraud'],                                                  freeTools:['Custom']},
{id:419, section:'9', name:'Recurring same meeting location',              severity:'medium', patterns:['recurringSameLocation','alwaysSamePlace'],                                       freeTools:['Custom — location clustering']},
{id:651, section:'9', name:'Bluetooth tracker awareness alert',            severity:'medium', patterns:['bluetoothTracker','airtag','trackerDetect','findMy'],                           freeTools:['Educational prompt pre-date']},
{id:652, section:'9', name:'Post-date Bluetooth scan prompt',              severity:'medium', patterns:['postDateScan','bluetoothScan','trackerScan'],                                   freeTools:['Prompt to use OS tracker detection']},
{id:653, section:'9', name:'OS-level tracker alert integration',           severity:'medium', patterns:['unknownTrackerAlert','trackerNotification'],                                    freeTools:['iOS/Android built-in tracker detection']},
{id:752, section:'9', name:'Ride-share integration',                       severity:'medium', patterns:['rideShare','uberIntegration','lyftIntegration'],                               freeTools:['Deep link to ride-share apps']},
{id:753, section:'9', name:'Do not get in their car prompt',               severity:'medium', patterns:['dontGetInCar','ownTransportation','carSafety'],                               freeTools:['Custom educational prompt']},
{id:754, section:'9', name:'Transportation cost barrier detection',        severity:'medium', patterns:['transportationBarrier','noTransportation','controlMechanism'],                freeTools:['Custom — detect patterns of controlling transportation']},
{id:907, section:'9', name:'Pre-date drink safety education',              severity:'medium', patterns:['drinkSafety','neverLeaveYourDrink','drinkSpiking'],                          freeTools:['Educational prompt']},
{id:908, section:'9', name:'Post-date wellbeing check',                    severity:'medium', patterns:['postDateWellbeing','wellbeingCheck','howDidItGo'],                          freeTools:['Custom notification + resource routing']},
{id:909, section:'9', name:'Drugging report category',                     severity:'medium', patterns:['druggingReport','drinkSpiked','druggedReport'],                           freeTools:['Report category + resource routing']},
{id:913, section:'9', name:'Mandatory conversation minimum',               severity:'medium', patterns:['conversationMinimum','chatBeforeMeet','minimumMessages'],                freeTools:['Custom — message count gate before location sharing']},
{id:914, section:'9', name:'Match velocity throttling',                    severity:'medium', patterns:['matchThrottle','matchVelocity','slowDating'],                          freeTools:['Custom — rate limit matches per day']},
{id:915, section:'9', name:'Are you ready to meet checklist',              severity:'medium', patterns:['readyToMeet','safetyChecklist','meetupChecklist'],                      freeTools:['Custom UI prompt']},

// §10 Trust & Reputation
{id:420, section:'10', name:'User trust score (0-100)',                    severity:'high',   patterns:['trustScore','TrustScoreDisplay','calculateTrust'],                     freeTools:['Custom scoring model']},
{id:421, section:'10', name:'Auto-warn/restrict/ban by threshold',         severity:'high',   patterns:['enforceTrustThreshold','autoRestrict','autoBan'],                     freeTools:['Custom — threshold-based enforcement']},
{id:422, section:'10', name:'Reporter credibility scoring',                severity:'high',   patterns:['reporterCredib','ReporterCredibility','validateReporter'],             freeTools:['Custom — track reporter accuracy history']},
{id:423, section:'10', name:'Profile completeness scoring',                severity:'medium', patterns:['profileCompleteness','ProfileCompletionCard','calculateCompletion'],  freeTools:['Custom — field completion percentage']},
{id:424, section:'10', name:'Verification badge display',                  severity:'medium', patterns:['verificationBadge','VerificationBadge','verified.*badge'],            freeTools:['Custom UI component']},
{id:425, section:'10', name:'Trust score decay',                           severity:'medium', patterns:['scoreDecay','applyTrustDecay','trustDecay'],                         freeTools:['Custom — time-based decay function']},
{id:426, section:'10', name:'Account age gate',                            severity:'medium', patterns:['checkAccountAgeGate','accountAgeGate','account.*age.*gate'],         freeTools:['Custom — restrict features for new accounts']},
{id:427, section:'10', name:'Ghost / inactive profile detection',          severity:'medium', patterns:['ghostProfileDetect','isGhostProfile','inactiveProfileDetect'],       freeTools:['Custom — last activity threshold']},
{id:428, section:'10', name:'Shadow ban system',                           severity:'medium', patterns:['shadowBan','silentRestrict','hiddenBan'],                           freeTools:['Custom — reduce visibility without notification']},
{id:429, section:'10', name:'Honeypot profiles',                           severity:'medium', patterns:['honeypot','trapProfile','decoyProfile'],                            freeTools:['Custom — operated profiles to detect bad actors']},
{id:430, section:'10', name:'Appeal / dispute workflow',                   severity:'medium', patterns:['appealWorkflow','disputeProcess','banAppeal'],                      freeTools:['Custom workflow']},
{id:431, section:'10', name:'Victim support workflow',                     severity:'high',   patterns:['victimSupport','supportWorkflow','crisisSupport'],                  freeTools:['Custom — resource routing + support agent queue']},
{id:432, section:'10', name:'Evidence preservation on report',             severity:'high',   patterns:['evidencePreservation','preserveEvidence','snapshotOnReport'],       freeTools:['Custom — snapshot content on report submission']},
{id:433, section:'10', name:'Human review queue',                          severity:'high',   patterns:['humanReview','moderationQueue','reviewQueue'],                      freeTools:['Label Studio (Apache 2.0)']},
{id:434, section:'10', name:'Moderator queue prioritization',              severity:'medium', patterns:['queuePriority','moderatorPriority','urgentQueue'],                  freeTools:['Custom — severity-based queue ordering']},
{id:435, section:'10', name:'Moderator bias detection',                    severity:'medium', patterns:['moderatorBias','modBias','reviewerBias'],                          freeTools:['Custom — statistical analysis of mod decisions by demographic']},
{id:436, section:'10', name:'False positive rate tracking',                severity:'medium', patterns:['falsePositiveRate','fprTracking','detectorAccuracy'],               freeTools:['Custom metrics collection']},
{id:437, section:'10', name:'Inter-rater reliability',                     severity:'medium', patterns:['interRater','cohensKappa','raterAgreement'],                       freeTools:['Custom — Cohen Kappa calculation']},
{id:438, section:'10', name:'Moderator wellbeing monitoring',              severity:'medium', patterns:['modWellbeing','moderatorHealth','secondaryTrauma'],                 freeTools:['Custom — shift limits, content exposure tracking']},

// §10.1 Ghost/Zombie Profile
{id:798, section:'10.1', name:'Inactive profile reactivation consent',    severity:'medium', patterns:['reactivationConsent','zombieProfile'],                             freeTools:['Custom — consent prompt on reactivation']},
{id:799, section:'10.1', name:'Deceased user account detection',           severity:'medium', patterns:['deceasedUser','memorialAccount','deathNotification'],             freeTools:['Custom — inactivity + external notification process']},
{id:800, section:'10.1', name:'Ghost profile inflation audit',             severity:'medium', patterns:['profileInflation','ghostAudit','activeUserCount'],               freeTools:['Custom — active vs total ratio analysis']},

// §10.2 Systematic Failure / Litigation
{id:861, section:'10.2', name:'Duty of care audit trail',                  severity:'high',   patterns:['dutyOfCare','careDuty','auditTrail'],                           freeTools:['Custom — comprehensive logging']},
{id:862, section:'10.2', name:'Response time SLA enforcement',             severity:'high',   patterns:['responseSLA','slaEnforcement','responseTime'],                  freeTools:['Custom — timestamp tracking on reports']},
{id:863, section:'10.2', name:'Repeat report escalation',                  severity:'high',   patterns:['repeatEscalation','multipleReports.*escalate'],                freeTools:['Custom — auto-escalate on N reports']},
{id:864, section:'10.2', name:'Litigation risk scoring',                   severity:'medium', patterns:['litigationRisk','legalRisk','riskScore.*legal'],               freeTools:['Custom scoring model']},

// §10.3 Safety Feature Weaponization
{id:918, section:'10.3', name:'Block circumvention detection',             severity:'high',   patterns:['blockCircumventionDetect','blockEvasion','mirroredInterests'],  freeTools:['Device fingerprint + face matching']},
{id:919, section:'10.3', name:'Weaponized reporting detection',            severity:'high',   patterns:['weaponizedReport','massReport.*sameTarget','coordinatedReporting'], freeTools:['Custom — detect coordinated reports against single user']},
{id:920, section:'10.3', name:'Safety feature documentation accuracy',    severity:'medium', patterns:['safetyDocAccuracy','featureDocumentation'],                    freeTools:['Manual audit process']},

// §11 Social Verification
{id:439, section:'11', name:'Instagram URL format',                        severity:'low',    patterns:['validateInstagramUsername','validateInstagram'],                freeTools:['Regex validation']},
{id:440, section:'11', name:'Instagram profile exists',                    severity:'low',    patterns:['checkInstagramProfileExists','checkInstagram'],                freeTools:['Custom — HTTP check (rate-limited)']},
{id:441, section:'11', name:'Spotify URL format',                          severity:'low',    patterns:['validateSpotifyUrl','validateSpotify'],                        freeTools:['Regex validation']},
{id:442, section:'11', name:'TikTok URL format',                           severity:'low',    patterns:['validateTikTokUsername','validateTikTok'],                     freeTools:['Regex validation']},
{id:443, section:'11', name:'LinkedIn URL format',                         severity:'low',    patterns:['validateLinkedInUrl','validateLinkedIn'],                      freeTools:['Regex validation']},
{id:444, section:'11', name:'Username consistency check',                  severity:'medium', patterns:['checkUsernameConsistency','usernameConsistency'],              freeTools:['Custom — cross-platform username matching']},
{id:445, section:'11', name:'Social media handle cross-platform consistency', severity:'medium', patterns:['crossPlatformConsistency','handleConsistency'],            freeTools:['Custom string similarity (Levenshtein)']},
{id:446, section:'11', name:'Social account age check',                    severity:'medium', patterns:['socialAccountAge','accountCreationDate'],                    freeTools:['Custom — API check where available']},
{id:447, section:'11', name:'Social follower count plausibility',          severity:'medium', patterns:['followerPlausibility','followerCount','followersCheck'],       freeTools:['Custom — API check where available']},
{id:448, section:'11', name:'Social account activity recency',             severity:'medium', patterns:['socialActivity','lastPost','accountRecency'],                 freeTools:['Custom — API check where available']},

// §12 Payments & Financial Fraud
{id:449, section:'12', name:'Stolen credit card detection',                severity:'high',   patterns:['stolenCard','fraudCard','cardFraud'],                         freeTools:['Stripe Radar (included free with Stripe)']},
{id:450, section:'12', name:'Chargeback fraud detection',                  severity:'high',   patterns:['chargebackFraud','disputeFraud','chargeback'],                freeTools:['Stripe Radar']},
{id:451, section:'12', name:'Card testing detection',                      severity:'high',   patterns:['cardTesting','microCharge','cardTest'],                       freeTools:['Stripe Radar + custom rate limiting']},
{id:452, section:'12', name:'Velocity checks on purchases',                severity:'medium', patterns:['velocityCheck','purchaseRate','purchaseVelocity'],            freeTools:['Custom — rate limiting on payment attempts']},
{id:453, section:'12', name:'Refund abuse detection',                      severity:'medium', patterns:['refundAbuse','excessiveRefund','refundPattern'],              freeTools:['Custom — refund rate per user']},
{id:454, section:'12', name:'Gift subscription abuse',                     severity:'medium', patterns:['giftAbuse','giftSubscription.*abuse'],                       freeTools:['Custom — track gift patterns']},
{id:455, section:'12', name:'Subscription stacking abuse',                 severity:'medium', patterns:['subscriptionStacking','duplicateSub'],                       freeTools:['Custom — detect duplicate subscriptions']},
{id:456, section:'12', name:'Promo code brute force',                      severity:'medium', patterns:['promoCodeBruteForce','promoBruteForce','codeAttemptRate'],   freeTools:['Rate limiting + code entropy']},
{id:457, section:'12', name:'In-app currency farming',                     severity:'medium', patterns:['currencyFarming','coinFarming','rewardAbuse'],               freeTools:['Custom — activity vs reward analysis']},
{id:458, section:'12', name:'Premium feature sharing',                     severity:'medium', patterns:['featureSharing','accountSharing.*premium'],                  freeTools:['Custom — device fingerprint + concurrent usage']},
{id:459, section:'12', name:'Money mule detection',                        severity:'high',   patterns:['moneyMule','muleAccount','fundsPassing'],                    freeTools:['Custom — payment flow analysis']},
{id:460, section:'12', name:'Cryptocurrency mixing detection',             severity:'medium', patterns:['cryptoMixing','tumbling','mixerDetect'],                     freeTools:['Custom — blockchain analysis']},
{id:461, section:'12', name:'Wire transfer social engineering',            severity:'high',   patterns:['wireTransferSE','socialEngineering.*wire'],                  freeTools:['Keyword patterns']},
{id:462, section:'12', name:'Tax fraud via platform',                      severity:'medium', patterns:['taxFraud','incomeReporting'],                                freeTools:['Compliance process']},
{id:643, section:'12', name:'Free trial cycling abuse',                    severity:'medium', patterns:['trialCycling','freeTrialAbuse','trialAbuse'],                freeTools:['Device fingerprint + email hash tracking']},

// §13 API & Infrastructure Security
{id:463, section:'13', name:'Server API rate limiting',                    severity:'high',   patterns:['express-rate-limit','rateLimit\\(','globalLimiter','apiRateLimit'],                   freeTools:['express-rate-limit (MIT)']},
{id:464, section:'13', name:'Client-side rate limiting',                   severity:'medium', patterns:['checkRateLimit','LIMITS\\[','RateLimitResult','clientRateLimit'],                    freeTools:['Custom — in-memory rate counters']},
{id:465, section:'13', name:'Webhook / API abuse detection',               severity:'medium', patterns:['trackWebhookCall','webhookAbuse','webhookLimiter'],                                  freeTools:['Custom — rate limiting + signature verification']},
{id:466, section:'13', name:'CORS policy',                                 severity:'high',   patterns:['cors\\(','CORS_OPTIONS','ALLOWED_ORIGINS','Access-Control-Allow-Origin'],           freeTools:['cors npm package (MIT)']},
{id:467, section:'13', name:'Origin header validation',                    severity:'medium', patterns:['validateOrigin','ALLOWED_ORIGINS','origin_not_allowed'],                            freeTools:['Custom middleware']},
{id:468, section:'13', name:'HMAC request signing',                        severity:'high',   patterns:['createHmac','verifyHMAC','HMAC_SECRET','timingSafeEqual'],                         freeTools:['Node.js crypto.createHmac (built-in)']},
{id:469, section:'13', name:'App integrity (App Check)',                   severity:'high',   patterns:['getAppCheckToken','AppCheck','appCheck'],                                          freeTools:['Firebase App Check (free)']},
{id:470, section:'13', name:'API key rotation',                            severity:'medium', patterns:['rotateApiKey','keyRotation','API_KEY_CACHE'],                                      freeTools:['Custom — scheduled rotation']},
{id:471, section:'13', name:'GraphQL depth limiting',                      severity:'medium', patterns:['depthLimit','graphqlDepth','maxDepth'],                                            freeTools:['graphql-depth-limit (MIT)','GraphQL Armor (MIT)']},
{id:472, section:'13', name:'GraphQL batching abuse',                      severity:'medium', patterns:['batchLimit','graphqlBatch','maxBatchSize'],                                        freeTools:['GraphQL Armor']},
{id:473, section:'13', name:'GraphQL introspection abuse',                 severity:'medium', patterns:['introspectionDisable','disableIntrospection'],                                    freeTools:['GraphQL Armor']},
{id:474, section:'13', name:'REST API versioning abuse',                   severity:'low',    patterns:['apiVersioning','versionAbuse','deprecatedAPI'],                                   freeTools:['Custom — track usage of deprecated versions']},
{id:475, section:'13', name:'WebSocket abuse',                             severity:'medium', patterns:['websocketAbuse','wsRateLimit','socketAbuse'],                                     freeTools:['Custom — rate limiting on WS connections']},
{id:476, section:'13', name:'Server-Sent Events abuse',                    severity:'low',    patterns:['sseAbuse','eventStreamAbuse'],                                                    freeTools:['Custom — connection limiting']},
{id:477, section:'13', name:'Cache poisoning detection',                   severity:'medium', patterns:['cachePoisoning','cacheAttack'],                                                   freeTools:['Custom — cache key validation']},
{id:478, section:'13', name:'HTTP request smuggling',                      severity:'high',   patterns:['requestSmuggling','httpSmuggling'],                                               freeTools:['ZAP (Checkmarx, free DAST)']},
{id:479, section:'13', name:'SSRF prevention',                             severity:'high',   patterns:['ssrfPrevention','serverSideRequest','internalURLBlock'],                         freeTools:['Custom — block internal IP ranges in requests']},
{id:480, section:'13', name:'XXE prevention',                              severity:'high',   patterns:['xxePrevention','xmlExternalEntity','disableDTD'],                               freeTools:['Parser config: disable external entities']},
{id:481, section:'13', name:'Mass assignment prevention',                  severity:'medium', patterns:['massAssignment','allowedFields','fieldWhitelist'],                              freeTools:['Custom — explicit field whitelisting']},
{id:482, section:'13', name:'Broken object level authorization (IDOR)',    severity:'high',   patterns:['idor','objectLevelAuth','ownershipCheck','checkOwnership'],                     freeTools:['Akto (open-source, OWASP-endorsed)','ZAP']},
{id:483, section:'13', name:'Excessive data exposure',                     severity:'medium', patterns:['dataExposure','excessiveFields','fieldFiltering'],                             freeTools:['Custom — response field filtering']},
{id:484, section:'13', name:'DNS rebinding attack prevention',             severity:'medium', patterns:['dnsRebinding','hostHeaderValidation'],                                         freeTools:['Custom — Host header validation']},
{id:485, section:'13', name:'API key enumeration detection',               severity:'medium', patterns:['keyEnumeration','apiKeyBruteForce'],                                          freeTools:['Rate limiting + monitoring']},
{id:486, section:'13', name:'Race condition abuse',                        severity:'high',   patterns:['raceCondition','atomicOperation','lockMechanism'],                            freeTools:['Custom — database-level locking']},
{id:487, section:'13', name:'TOCTOU vulnerability detection',              severity:'medium', patterns:['toctou','timeOfCheck','checkThenAct'],                                        freeTools:['Custom — atomic operations']},
{id:488, section:'13', name:'Replay attack detection',                     severity:'high',   patterns:['replayAttackDetect','nonceValidation','requestNonceCheck'],                   freeTools:['Custom — nonce + timestamp validation']},

// §13.1 API Data Exposure
{id:665, section:'13.1', name:'User profile data exposure (IDOR audit)',   severity:'high',   patterns:['idorAudit','profileDataExposure','unauthorizedProfileAccess'],              freeTools:['Akto (open-source)','ZAP']},
{id:666, section:'13.1', name:'Location data precision leakage',           severity:'high',   patterns:['locationPrecisionLeakage','exactCoordinatesAPI'],                          freeTools:['Custom — audit API responses for full precision coordinates']},
{id:667, section:'13.1', name:'Sensitive field exposure in API',           severity:'high',   patterns:['sensitiveFieldExposure','hivStatus','orientationLeak'],                    freeTools:['Custom — audit API response fields']},
{id:668, section:'13.1', name:'Unauthenticated endpoint scanning',         severity:'high',   patterns:['unauthenticatedEndpoint','publicEndpointAudit'],                          freeTools:['Dastardly (PortSwigger, free)','ZAP']},
{id:669, section:'13.1', name:'API response field filtering by state',     severity:'medium', patterns:['fieldFilterByState','matchStateFiltering','relationshipFiltering'],       freeTools:['Custom — dynamic response filtering']},

// §13.2 Mass Profile Scraping Defense
{id:717, section:'13.2', name:'Automated profile scraping detection',      severity:'high',   patterns:['scrapingDetection','antiScraping','botScraping'],                         freeTools:['Custom — behavioral analysis + rate limiting']},
{id:718, section:'13.2', name:'Photo bulk download detection',             severity:'high',   patterns:['bulkDownload','photoDownloadRate'],                                       freeTools:['Custom — download rate limiting']},
{id:719, section:'13.2', name:'Facial dataset harvesting prevention',      severity:'high',   patterns:['facialHarvesting','datasetPrevention'],                                   freeTools:['Custom — rate limiting + watermarking']},
{id:720, section:'13.2', name:'Rate-limit profile viewing by pattern',     severity:'medium', patterns:['profileViewRateLimit','viewingPattern'],                                 freeTools:['Custom — anomaly detection on view patterns']},
{id:721, section:'13.2', name:'Headless browser detection',                severity:'medium', patterns:['headlessBrowser','puppeteerDetect','seleniumDetect'],                    freeTools:['Custom — navigator.webdriver check + behavioral signals']},
{id:722, section:'13.2', name:'User-agent anomaly detection',              severity:'medium', patterns:['userAgentAnomaly','uaAnomaly','suspiciousUA'],                           freeTools:['Custom — UA pattern matching']},

// §13.3 Platform Cybersecurity Infrastructure
{id:843, section:'13.3', name:'Software patching cadence monitoring',      severity:'medium', patterns:['patchCadence','patchMonitor','softwarePatch'],                           freeTools:['Dependabot','Renovate','Snyk (free tier)']},
{id:844, section:'13.3', name:'Email security configuration audit (SPF, DKIM, DMARC)', severity:'medium', patterns:['SPF','DKIM','DMARC','emailSecurity','dmarcRecord'],       freeTools:['MXToolbox (free)','dmarcian (free tier)']},
{id:845, section:'13.3', name:'System reputation scoring',                 severity:'low',    patterns:['systemReputation','reputationScore','systemRep'],                       freeTools:['Custom scoring']},
{id:846, section:'13.3', name:'External attack surface monitoring',        severity:'medium', patterns:['attackSurface','externalScan','surfaceMonitor'],                        freeTools:['Shodan (free tier)','Censys (free tier)']},
{id:847, section:'13.3', name:'Security grade benchmarking',               severity:'low',    patterns:['securityGrade','securityBenchmark','peerBenchmark'],                    freeTools:['Mozilla Observatory (free)','SecurityHeaders.com']},

// §14 Device & Platform Integrity
{id:489, section:'14', name:'A/B test integrity',                          severity:'medium', patterns:['validateABTestIntegrity','assignABTest','GrowthBook','abTestIntegrity'], freeTools:['GrowthBook (open-source)','Custom HMAC validation']},
{id:490, section:'14', name:'Spoofed analytics events',                    severity:'medium', patterns:['validateAnalyticsEvent','signEvent','validateEventHmac','spoofedAnalytics'], freeTools:['Custom — HMAC event signing']},
{id:491, section:'14', name:'Bot traffic filtering',                       severity:'high',   patterns:['detectBotTraffic','botTraffic','check-bot','botFilter'],                freeTools:['Firebase App Check (free)','Custom heuristics']},
{id:492, section:'14', name:'Coordinated inauthentic behavior',            severity:'high',   patterns:['detectCoordinatedInauthentic','coordinatedInauthentic','check-cib','CIB'], freeTools:['NetworkX/igraph (graph analysis)','Custom clustering']},
{id:493, section:'14', name:'Fake review networks',                        severity:'medium', patterns:['detectFakeReviewNetwork','fakeReviewNetwork','fake.*review.*network'],  freeTools:['Custom — graph + temporal analysis']},
{id:494, section:'14', name:'Detector evasion monitoring',                 severity:'medium', patterns:['detectorEvasion','evasionMonitor','bypassDetect'],                     freeTools:['Custom — A/B canary comparison']},
{id:495, section:'14', name:'Dark web monitoring',                         severity:'medium', patterns:['darkWebMonitor','torMonitor','onionScan'],                             freeTools:['MISP (open-source)','OnionScan (open-source)']},
{id:496, section:'14', name:'Threat intelligence feed integration',        severity:'medium', patterns:['threatIntel','threatFeed','MISP','iocFeed'],                           freeTools:['MISP (open-source)','OpenCTI (open-source)','AbuseIPDB (free tier)']},
{id:497, section:'14', name:'CVE monitoring for dependencies',             severity:'high',   patterns:['cveMonitor','vulnerabilityAlert','dependabot','snyk'],                 freeTools:['Dependabot (free)','Snyk (free tier)','npm audit']},
{id:498, section:'14', name:'Supply chain attack detection',               severity:'high',   patterns:['supplyChainAttack','lockfileIntegrity','packageIntegrity'],            freeTools:['Socket.dev (free tier)','npm audit signatures','Sigstore']},
{id:499, section:'14', name:'Insider threat monitoring',                   severity:'high',   patterns:['insiderThreat','privilegedAccess','adminAbuse'],                      freeTools:['Custom — admin audit logs + anomaly detection']},
{id:500, section:'14', name:'Privileged access management',                severity:'high',   patterns:['privilegedAccess','adminRole','PAM','roleEscalation'],               freeTools:['Custom RBAC','Keycloak (open-source)']},
{id:501, section:'14', name:'Data loss prevention',                        severity:'high',   patterns:['dataLossPrevention','DLP','sensitiveDataExfil','dlpScan'],           freeTools:['Custom — regex + Presidio for PII']},
{id:502, section:'14', name:'Adversarial input detection',                 severity:'medium', patterns:['adversarialInput','adversarialDetect','inputAnomaly'],               freeTools:['ART (IBM Adversarial Robustness Toolbox)']},
{id:503, section:'14', name:'Canary deployment for detectors',             severity:'medium', patterns:['canaryDeploy','canaryDetector','detectorCanary'],                    freeTools:['Custom — feature flags + GrowthBook']},
{id:504, section:'14', name:'Detector correlation analysis',               severity:'medium', patterns:['detectorCorrelation','correlateDetectors','signalCorrelation'],      freeTools:['Custom — statistical analysis']},
{id:505, section:'14', name:'Transparency report generation',              severity:'medium', patterns:['transparencyReport','generateTransparencyReport','safetyReport'],    freeTools:['Custom report generator']},
{id:506, section:'14', name:'Law enforcement request handling',            severity:'high',   patterns:['lawEnforcementRequest','subpoenaProcess','legalRequest'],            freeTools:['Custom workflow + audit log']},
{id:507, section:'14', name:'Trusted flagger program',                     severity:'medium', patterns:['trustedFlagger','priorityReporter','ngoFlagger'],                   freeTools:['Custom — role-based reporter tiers']},
{id:508, section:'14', name:'Security.txt / responsible disclosure',       severity:'medium', patterns:['security.txt','responsibleDisclosure','bugBounty','securityTxt'],   freeTools:['security.txt standard (free)','HackerOne (free basic)']},

// §14.1 Network/Graph Analysis
{id:624, section:'14.1', name:'Account creation burst detection',          severity:'high',   patterns:['accountCreationBurst','registrationBurst','signupSpike','burstDetect'], freeTools:['Custom — time-series anomaly detection']},
{id:625, section:'14.1', name:'Ring/clique detection',                     severity:'high',   patterns:['cliqueDetect','ringDetect','mutualNetwork','graphClique'],            freeTools:['NetworkX (Python)','igraph']},
{id:626, section:'14.1', name:'Coordinated mass-swipe campaigns',          severity:'high',   patterns:['massSwipeCampaign','coordinatedSwipe','swipeCampaign'],              freeTools:['Custom — velocity + IP clustering']},
{id:627, section:'14.1', name:'Cross-app scammer intelligence sharing',    severity:'medium', patterns:['crossAppIntel','scammerIntel','sharedIntelligence'],                freeTools:['MISP (open-source)','STIX/TAXII (open standard)']},

// §14.2 Fake Dating App / Malware Defense
{id:728, section:'14.2', name:'Brand impersonation app detection',         severity:'medium', patterns:['brandImpersonation','fakeApp','appImpersonation'],                  freeTools:['Google Play Protect','Custom — app store monitoring']},
{id:729, section:'14.2', name:'Phishing site impersonation monitoring',    severity:'high',   patterns:['phishingSite','domainImpersonation','phishMonitor'],                freeTools:['Google Safe Browsing API','PhishTank (free)','urlscan.io']},
{id:730, section:'14.2', name:'Fraudulent deep link detection',            severity:'medium', patterns:['fraudulentDeepLink','deepLinkHijack','maliciousDeepLink'],          freeTools:['Custom — deep link validation']},
{id:829, section:'14.2', name:'Spyware-disguised-as-dating-app detection', severity:'high',   patterns:['spywareDetect','malwareDisguise','spywareDating'],                  freeTools:['VirusTotal API (free tier)']},
{id:830, section:'14.2', name:'ClickFix / device-linking hijack detection',severity:'medium', patterns:['clickFix','deviceLinkHijack','clickFixDetect'],                    freeTools:['Custom — behavioral analysis']},

// §14.3 Cross-Platform Banned User Intelligence
{id:700, section:'14.3', name:'Cross-platform banned user intelligence sharing', severity:'high', patterns:['crossPlatformBan','sharedBanList','banIntelligence'],          freeTools:['MISP (open-source)','Custom shared hash DB']},
{id:701, section:'14.3', name:'Repeat offender pattern matching',          severity:'high',   patterns:['repeatOffender','reRegistrationDetect','bannedReuse','offenderPattern'], freeTools:['Custom — device/behavioral fingerprinting']},
{id:702, section:'14.3', name:'Multi-report correlation across time',      severity:'medium', patterns:['multiReportCorrelation','reportCorrelation','temporalReportAnalysis'], freeTools:['Custom — statistical analysis']},

// §14.4 Third-Party Cheater Tool Defense
{id:916, section:'14.4', name:'Third-party profile search tool defense',   severity:'medium', patterns:['cheaterbuster','profileSearchDefense','thirdPartySearch'],          freeTools:['Custom — rate limiting + honeypots']},
{id:917, section:'14.4', name:'Profile discoverability controls',          severity:'medium', patterns:['profileDiscoverability','discoverabilityControl','hideProfile'],    freeTools:['Custom — privacy settings']},

// §15 AI/ML System Safety
{id:509, section:'15', name:'Model poisoning detection',                   severity:'high',   patterns:['modelPoisoning','trainingDataPoison','poisonDetect'],               freeTools:['ART (IBM Adversarial Robustness Toolbox)']},
{id:510, section:'15', name:'Prompt injection in user content',            severity:'high',   patterns:['promptInjection','detectPromptInjection','injectionDetect'],        freeTools:['Garak (NVIDIA)','Rebuff (open-source)','DuoGuard']},
{id:511, section:'15', name:'Model inversion attack prevention',           severity:'medium', patterns:['modelInversion','inversionAttack','privacyAttack'],                 freeTools:['ART (IBM)','Custom — differential privacy']},
{id:512, section:'15', name:'Membership inference attack prevention',      severity:'medium', patterns:['membershipInference','inferenceAttack','memberInfer'],              freeTools:['ART (IBM)','ML-Privacy-Meter (open-source)']},
{id:513, section:'15', name:'Adversarial example detection',               severity:'medium', patterns:['adversarialExample','adversarialDetect','perturbationDetect'],     freeTools:['ART (IBM)','Foolbox (open-source)']},
{id:514, section:'15', name:'Model confidence calibration',                severity:'medium', patterns:['confidenceCalibration','calibrateModel','temperatureScaling'],     freeTools:['Custom — temperature scaling','Netcal (open-source)']},
{id:515, section:'15', name:'Distribution shift detection',                severity:'medium', patterns:['distributionShift','dataShift','covariateDrift','driftDetect'],    freeTools:['Evidently AI (Apache 2.0)','Alibi-Detect (for images)']},
{id:516, section:'15', name:'Fairness / bias monitoring',                  severity:'high',   patterns:['fairnessAudit','biasMonitor','demographicParity','equalizedOdds'], freeTools:['IBM AIF360','Fairlearn (Microsoft)','Aequitas']},
{id:517, section:'15', name:'Explainability for adverse decisions',        severity:'medium', patterns:['explainDecision','shapValue','limeExplain','modelExplain'],        freeTools:['SHAP','LIME']},
{id:518, section:'15', name:'Model version control / rollback',            severity:'medium', patterns:['modelVersion','modelRollback','versionControl.*model'],            freeTools:['MLflow (Apache 2.0)','DVC (open-source)']},
{id:519, section:'15', name:'Detector drift monitoring',                   severity:'medium', patterns:['detectorDrift','driftMonitor','performanceDrift'],                 freeTools:['Evidently AI','Alibi-Detect']},
{id:520, section:'15', name:'Detector efficacy metrics',                   severity:'medium', patterns:['detectorEfficacy','precisionRecall','falsePositiveRate','efficacyMetrics'], freeTools:['scikit-learn metrics','Custom dashboards']},

// §15.1 AI Feature Privacy & Consent
{id:611, section:'15.1', name:'AI feature opt-in consent verification',    severity:'medium', patterns:['aiOptIn','aiConsent','featureOptIn.*ai','aiFeatureConsent'],       freeTools:['Custom — consent management']},
{id:612, section:'15.1', name:'AI training data opt-out enforcement',      severity:'medium', patterns:['trainingOptOut','aiTrainingOptOut','doNotTrain'],                  freeTools:['Custom — data pipeline filters']},
{id:613, section:'15.1', name:'Third-party AI data sharing detection',     severity:'medium', patterns:['thirdPartyAI','aiDataSharing','externalAISharing'],               freeTools:['Custom — SDK audit + network monitoring']},
{id:614, section:'15.1', name:'AI-generated icebreaker/conversation safety scan', severity:'medium', patterns:['aiIcebreakerSafety','scanAIIcebreaker','aiConversationScan'], freeTools:['DuoGuard','Llama Guard 4']},
{id:615, section:'15.1', name:'AI photo editing authenticity boundary',    severity:'medium', patterns:['aiPhotoEdit','editBoundary','aiEditLimit','photoEditAuthenticity'], freeTools:['Custom — edit detection heuristics']},

// §15.2 AI Agent / Concierge Safety
{id:677, section:'15.2', name:'AI-agent-to-human disclosure requirement',  severity:'medium', patterns:['aiDisclosure','agentDisclosure','botDisclosure','isAIAgent'],     freeTools:['Custom — labeling system']},
{id:678, section:'15.2', name:'AI-agent-to-AI-agent interaction detection',severity:'medium', patterns:['agentToAgent','aiToAi','botToBotDetect'],                        freeTools:['Custom — behavioral analysis']},
{id:679, section:'15.2', name:'AI concierge consent boundary enforcement', severity:'medium', patterns:['conciergeBoundary','aiConsentBoundary','agentBoundary'],          freeTools:['Custom — policy engine']},
{id:680, section:'15.2', name:'AI-authored message transparency labeling', severity:'medium', patterns:['aiMessageLabel','aiAuthored','generatedByAI','aiLabel'],          freeTools:['Custom — message metadata tagging']},

// §15.3 AI-Powered Platform Infrastructure Safety
{id:731, section:'15.3', name:'AI conversation starter safety scan',       severity:'medium', patterns:['aiStarterSafety','conversationStarterScan','aiStarterModerate'],  freeTools:['DuoGuard','Llama Guard 4','Qwen3Guard']},
{id:732, section:'15.3', name:'AI matching recommendation audit',          severity:'medium', patterns:['matchingAudit','recommendationAudit','aiMatchBias'],              freeTools:['IBM AIF360','Fairlearn']},
{id:733, section:'15.3', name:'AI-generated profile content disclosure',   severity:'medium', patterns:['aiProfileContent','generatedContent','aiContentDisclosure'],      freeTools:['Custom — content provenance tagging']},
{id:734, section:'15.3', name:'AI hallucination in platform-generated content', severity:'medium', patterns:['aiHallucination','hallucinationDetect','factCheck'],        freeTools:['Custom — grounding verification','Vectara HHEM (open-source)']},

// §15.4 AI-Powered Scam Detection Failure Modes
{id:865, section:'15.4', name:'AI scam scaling detection',                 severity:'high',   patterns:['aiScamScaling','scaledScam','aiAssistedScam'],                    freeTools:['Custom — velocity + template matching']},
{id:866, section:'15.4', name:'AI conversation coherence analysis',        severity:'medium', patterns:['coherenceAnalysis','conversationCoherence','aiCoherence'],        freeTools:['Custom — NLI models (DeBERTa)']},
{id:867, section:'15.4', name:'Deepfake live-call quality escalation',     severity:'high',   patterns:['deepfakeLiveCall','liveCallDeepfake','videoCallDeepfake'],        freeTools:['DeepfakeBench','Custom — frame analysis']},

// §15.5 Algorithmic Bias & Discrimination
{id:659, section:'15.5', name:'Racial bias audit of matching algorithm',   severity:'high',   patterns:['racialBiasAudit','matchingBias.*race','demographicParity'],       freeTools:['IBM AIF360','Fairlearn','Aequitas']},
{id:660, section:'15.5', name:'Popularity bias detection in recommendations', severity:'medium', patterns:['popularityBias','longTailBias','recommendationBias'],        freeTools:['Custom — distribution analysis']},
{id:661, section:'15.5', name:'Socioeconomic bias in profile visibility',  severity:'medium', patterns:['socioeconomicBias','visibilityBias','classBasedBias'],           freeTools:['Fairlearn','Custom metrics']},
{id:662, section:'15.5', name:'Ethnicity-based filtering abuse detection', severity:'medium', patterns:['ethnicityFilter','raceFilter','discriminatoryFilter'],           freeTools:['Custom — filter usage analytics']},
{id:663, section:'15.5', name:'Algorithmic de-biasing verification',       severity:'medium', patterns:['debiasing','debiasVerify','biasCorrection'],                     freeTools:['IBM AIF360','Fairlearn']},
{id:664, section:'15.5', name:'Matching outcome disparity monitoring',     severity:'medium', patterns:['outcomeDisparity','demographicOutcome','matchingDisparity'],     freeTools:['Aequitas','Custom dashboards']},

// §16.1 Age & Child Safety
{id:521, section:'16.1', name:'18+ age verification',                      severity:'critical',patterns:['ageVerification','minimumAge','validateDateOfBirth','AgeVerification','under18'], freeTools:['Custom — DOB validation + selfie age estimation']},
{id:522, section:'16.1', name:'Age-gated content compliance',              severity:'high',   patterns:['ageGatedContent','contentGate','ageRestricted'],                 freeTools:['Custom — content classification']},
{id:523, section:'16.1', name:'COPPA compliance',                          severity:'critical',patterns:['COPPA','checkCOPPACompliance','under13','childrenPrivacy'],     freeTools:['Custom — age gate + data handling']},
{id:524, section:'16.1', name:'UK Age Appropriate Design Code',            severity:'medium', patterns:['ageAppropriate','AADC','childrenCode','ukAgeCode'],              freeTools:['Custom — policy implementation']},
{id:525, section:'16.1', name:'Minor account recovery process',            severity:'high',   patterns:['minorAccountRecovery','underageRecovery','childAccount'],        freeTools:['Custom workflow']},
{id:526, section:'16.1', name:'Child safety officer designation',          severity:'medium', patterns:['childSafetyOfficer','CSO','designatedSafetyOfficer'],           freeTools:['Organizational — role designation']},
{id:527, section:'16.1', name:'Auto-report CSAM to NCMEC',                severity:'critical',patterns:['reportToNCMEC','NCMEC','CyberTipline','csamReport'],           freeTools:['NCMEC CyberTipline API (free for qualifying)','PhotoDNA (free)']},
{id:528, section:'16.1', name:'NCMEC membership',                          severity:'high',   patterns:['NCMEC.*member','ncmecMembership'],                              freeTools:['NCMEC membership (free for platforms)']},
{id:529, section:'16.1', name:'INHOPE network membership',                 severity:'medium', patterns:['INHOPE','inhopeMember'],                                        freeTools:['INHOPE membership']},
{id:530, section:'16.1', name:'Tech Coalition membership',                 severity:'medium', patterns:['techCoalition','TechCoalition'],                                freeTools:['Tech Coalition membership']},
{id:791, section:'16.1', name:'Post-registration minor behavioral signal detection', severity:'high', patterns:['minorBehavior','underageBehavior','childBehaviorSignal'], freeTools:['Custom — behavioral heuristics']},
{id:792, section:'16.1', name:'Age-gate circumvention detection',          severity:'high',   patterns:['ageGateCircumvent','ageBypass','ageGateEvasion'],               freeTools:['Custom — re-verification triggers']},
{id:793, section:'16.1', name:'School hours activity pattern detection',   severity:'medium', patterns:['schoolHoursActivity','schoolHours','daytimeMinor'],             freeTools:['Custom — time-pattern analysis']},

// §16.2 Privacy Laws
{id:531, section:'16.2', name:'GDPR data export',                          severity:'high',   patterns:['gdprExport','exportUserData','dataPortability','gdpr_export'],  freeTools:['Custom — data export pipeline']},
{id:532, section:'16.2', name:'GDPR right to erasure enforcement',         severity:'high',   patterns:['rightToErasure','deleteUserData','gdprDelete','dataDeletion'],  freeTools:['Custom — cascading delete']},
{id:533, section:'16.2', name:'GDPR purpose limitation enforcement',       severity:'medium', patterns:['purposeLimitation','dataProcessingPurpose','gdprPurpose'],     freeTools:['Custom — data flow mapping']},
{id:534, section:'16.2', name:'GDPR data minimization enforcement',        severity:'medium', patterns:['dataMinimization','minimalData','gdprMinimize'],               freeTools:['Custom — field audit']},
{id:535, section:'16.2', name:'GDPR legitimate interest documentation',    severity:'medium', patterns:['legitimateInterest','gdprLegitimate','legalBasis'],           freeTools:['Custom — documentation']},
{id:536, section:'16.2', name:'GDPR processor agreement tracking',         severity:'medium', patterns:['processorAgreement','DPA','dataProcessingAgreement'],         freeTools:['Custom — contract management']},
{id:537, section:'16.2', name:'GDPR cross-border transfer mechanisms',     severity:'medium', patterns:['crossBorderTransfer','SCCs','adequacyDecision','dataTransfer'], freeTools:['Custom — transfer impact assessment']},
{id:538, section:'16.2', name:'GDPR automated decision transparency',      severity:'medium', patterns:['automatedDecision','algorithmicTransparency','gdprAutomated'], freeTools:['SHAP','LIME','Custom explanations']},
{id:539, section:'16.2', name:'GDPR profiling opt-out',                    severity:'medium', patterns:['profilingOptOut','gdprProfiling','optOutProfiling'],           freeTools:['Custom — preference management']},
{id:540, section:'16.2', name:'CCPA / CPRA compliance',                    severity:'high',   patterns:['CCPA','CPRA','doNotSell','californiaPrivacy'],                 freeTools:['Custom — opt-out mechanism']},
{id:541, section:'16.2', name:'CCPA opt-out signal detection',             severity:'medium', patterns:['GPC','globalPrivacyControl','optOutSignal','ccpaOptOut'],      freeTools:['Custom — GPC header detection']},
{id:542, section:'16.2', name:'PIPEDA compliance (Canada)',                severity:'medium', patterns:['PIPEDA','pipedaCompliance','canadaPrivacy'],                   freeTools:['Custom — policy implementation']},
{id:543, section:'16.2', name:'LGPD compliance (Brazil)',                  severity:'medium', patterns:['LGPD','lgpdCompliance','brazilPrivacy'],                       freeTools:['Custom — policy implementation']},
{id:544, section:'16.2', name:'POPIA compliance (South Africa)',           severity:'medium', patterns:['POPIA','popiaCompliance','saPrivacy'],                         freeTools:['Custom — policy implementation']},
{id:545, section:'16.2', name:'PDPA compliance (Thailand/Singapore)',      severity:'medium', patterns:['PDPA','pdpaCompliance','thaiPrivacy','sgPrivacy'],             freeTools:['Custom — policy implementation']},
{id:546, section:'16.2', name:'APP compliance (Australia)',                severity:'medium', patterns:['APP.*compliance','australianPrivacy','appCompliance'],         freeTools:['Custom — policy implementation']},
{id:547, section:'16.2', name:'eSafety compliance (Australia)',            severity:'medium', patterns:['eSafety','esafetyCompliance','australianSafety'],             freeTools:['Custom — reporting pipeline']},
{id:548, section:'16.2', name:'AIDA compliance (Canada)',                  severity:'medium', patterns:['AIDA','aidaCompliance','canadaAI'],                           freeTools:['Custom — AI governance']},

// §16.3 Biometric & Sensitive Data
{id:549, section:'16.3', name:'Illinois BIPA consent',                     severity:'high',   patterns:['BIPA','bipaConsent','biometricConsent','illinoisBiometric'],   freeTools:['Custom — consent flow']},
{id:550, section:'16.3', name:'Biometric data consent logging',            severity:'high',   patterns:['biometricConsentLog','logBiometricConsent','faceDataConsent'], freeTools:['Custom — audit trail']},
{id:551, section:'16.3', name:'Sensitive data category detection',         severity:'medium', patterns:['sensitiveDataCategory','specialCategory','sensitiveData'],     freeTools:['Presidio (Microsoft)','Custom classifiers']},
{id:552, section:'16.3', name:'Sexual orientation data protection',        severity:'high',   patterns:['orientationProtection','sexualOrientation.*protect','lgbtqDataProtect'], freeTools:['Custom — field-level encryption + ACL']},
{id:553, section:'16.3', name:'Health data protection',                    severity:'high',   patterns:['healthDataProtect','medicalData','hivStatus.*protect'],        freeTools:['Custom — field-level encryption + ACL']},
{id:554, section:'16.3', name:'Religious data protection',                 severity:'medium', patterns:['religiousDataProtect','religionData','faithData'],             freeTools:['Custom — field-level encryption + ACL']},
{id:555, section:'16.3', name:'Political opinion data protection',         severity:'medium', patterns:['politicalDataProtect','politicalOpinion','politicsData'],     freeTools:['Custom — field-level encryption + ACL']},

// §16.4 Sensitive Health Data (Dating-Specific)
{id:685, section:'16.4', name:'HIV status data sharing prevention',        severity:'high',   patterns:['hivStatus','hivProtect','hivSharing','stiStatus'],            freeTools:['Custom — field-level ACL']},
{id:686, section:'16.4', name:'STI status field access controls',          severity:'high',   patterns:['stiAccess','stiFieldControl','healthFieldAccess'],            freeTools:['Custom — progressive disclosure']},
{id:687, section:'16.4', name:'Reproductive health data isolation',        severity:'high',   patterns:['reproductiveHealth','reproData','fertilityData'],             freeTools:['Custom — data isolation']},
{id:688, section:'16.4', name:'Health data third-party sharing audit',     severity:'medium', patterns:['healthDataSharing','thirdPartyHealth','healthAudit'],         freeTools:['Custom — SDK audit']},

// §16.5 Platform-Specific Laws
{id:556, section:'16.5', name:'EU Digital Services Act compliance',        severity:'high',   patterns:['DSA','digitalServicesAct','dsaCompliance'],                   freeTools:['Custom — reporting mechanism + transparency']},
{id:557, section:'16.5', name:'EU AI Act compliance',                      severity:'high',   patterns:['AIAct','euAIAct','aiActCompliance'],                          freeTools:['Custom — risk classification + documentation']},
{id:558, section:'16.5', name:'UK Online Safety Act compliance',           severity:'high',   patterns:['onlineSafetyAct','ukOSA','osaCompliance'],                    freeTools:['Custom — duty of care implementation']},
{id:559, section:'16.5', name:'FTC Section 5 compliance',                  severity:'medium', patterns:['FTCSection5','ftcCompliance','unfairPractice'],               freeTools:['Custom — policy review']},
{id:560, section:'16.5', name:'FCRA compliance',                           severity:'medium', patterns:['FCRA','fcraCompliance','fairCredit'],                         freeTools:['Custom — if running background checks']},
{id:561, section:'16.5', name:'ECPA compliance',                           severity:'medium', patterns:['ECPA','ecpaCompliance','electronicCommunications'],           freeTools:['Custom — policy implementation']},
{id:562, section:'16.5', name:'CFAA compliance',                           severity:'medium', patterns:['CFAA','cfaaCompliance','computerFraud'],                      freeTools:['Custom — access controls']},
{id:563, section:'16.5', name:'VAWA compliance',                           severity:'medium', patterns:['VAWA','vawaCompliance','violenceAgainstWomen'],               freeTools:['Custom — reporting + resources']},
{id:564, section:'16.5', name:'Human trafficking reporting',               severity:'critical',patterns:['humanTrafficking','traffickingReport','FOSTA','SESTA'],      freeTools:['NCMEC CyberTipline','Custom reporting']},
{id:565, section:'16.5', name:'Sanctions screening (OFAC countries)',      severity:'high',   patterns:['sanctionedCountr','OFAC.*countr','countrySanction'],          freeTools:['OFAC SDN list (free)','Custom country blocking']},
{id:566, section:'16.5', name:'OFAC individual sanctions screening',       severity:'high',   patterns:['ofacIndividual','sdnScreen','sanctionsScreen.*name'],         freeTools:['OFAC SDN list (free download)','OpenSanctions (open-source)']},
{id:567, section:'16.5', name:'Data breach notification system',           severity:'high',   patterns:['breachNotification','dataBreachAlert','breachNotify'],        freeTools:['Custom — notification pipeline']},
{id:568, section:'16.5', name:'Retention policy enforcement',              severity:'medium', patterns:['retentionPolicy','dataRetention','autoDelete.*retention'],    freeTools:['Custom — TTL + scheduled cleanup']},
{id:569, section:'16.5', name:'Data residency enforcement',                severity:'medium', patterns:['dataResidency','geoFencedData','regionBound'],               freeTools:['Custom — multi-region Firestore rules']},
{id:570, section:'16.5', name:'Cookie consent verification',               severity:'medium', patterns:['cookieConsent','cookieBanner','gdprCookie'],                  freeTools:['Custom cookie banner','Orestbida/cookieconsent (MIT)']},

// §16.6 Take It Down Act / NCII
{id:775, section:'16.6', name:'Take It Down Act compliance (48-hour NCII removal)', severity:'critical', patterns:['takeItDown','nciiRemoval','48Hour.*removal','ncii48h'], freeTools:['StopNCII.org hash sharing (free)','Custom SLA pipeline']},
{id:776, section:'16.6', name:'NCII removal request processing pipeline',  severity:'high',   patterns:['nciiRequest','nciiRemovalPipeline','intimateImageRemoval'],   freeTools:['Custom — priority queue + hash matching']},
{id:777, section:'16.6', name:'NCII re-upload prevention',                 severity:'high',   patterns:['nciiReupload','nciiHashBlock','preventReupload.*ncii'],       freeTools:['PDQ/PhotoDNA hash blocking','StopNCII.org']},

// §16.7 Romance Scam Prevention Act
{id:778, section:'16.7', name:'Fraud ban notification system',             severity:'medium', patterns:['fraudBanNotify','scamBanNotification','fraudBanAlert'],      freeTools:['Custom — notification system']},
{id:779, section:'16.7', name:'Banned user interaction history tracking',  severity:'medium', patterns:['bannedUserHistory','interactionHistory.*banned','bannedInteraction'], freeTools:['Custom — audit log']},
{id:780, section:'16.7', name:'Romance Scam Prevention Act required content delivery', severity:'medium', patterns:['romanceScamAct','scamPreventionAct','requiredScamContent'], freeTools:['Custom — educational content delivery']},
{id:781, section:'16.7', name:'Off-platform continuation warning',         severity:'medium', patterns:['offPlatformWarning','scamContinuation','contactedByBanned'], freeTools:['Custom — user notification']},

// §16.8 Audit & Legal Process
{id:571, section:'16.8', name:'Consent audit trail',                       severity:'high',   patterns:['consentAudit','logConsent','consentTrail','writeAuditLog'],  freeTools:['Custom — immutable audit log']},
{id:572, section:'16.8', name:'DMCA takedown workflow',                    severity:'medium', patterns:['dmcaTakedown','DMCA','copyrightTakedown'],                   freeTools:['Custom workflow']},
{id:573, section:'16.8', name:'Admin audit log',                           severity:'high',   patterns:['adminAuditLog','logAdminAction','writeAuditLog'],            freeTools:['Custom — Firestore/DB audit log']},
{id:574, section:'16.8', name:'Evidence preservation',                     severity:'high',   patterns:['evidencePreserve','preserveEvidence','legalHold'],           freeTools:['Custom — immutable storage']},
{id:575, section:'16.8', name:'Law enforcement subpoena process',          severity:'high',   patterns:['subpoenaProcess','lawEnforcement.*request','legalRequest'],  freeTools:['Custom — secure request portal']},
{id:576, section:'16.8', name:'MLAT request handling',                     severity:'medium', patterns:['MLAT','mlatRequest','mutualLegalAssistance'],               freeTools:['Custom workflow']},
{id:577, section:'16.8', name:'Transparency report generation',            severity:'medium', patterns:['transparencyReportGen','generateReport.*transparency'],     freeTools:['Custom report generator']},

// §16.9 Platform Liability / Foreseeable Harm
{id:902, section:'16.9', name:'Foreseeable harm documentation system',     severity:'high',   patterns:['foreseeableHarm','harmDocumentation','dutyOfCareDoc'],      freeTools:['Custom — risk documentation']},
{id:903, section:'16.9', name:'Safety marketing accuracy audit',           severity:'medium', patterns:['safetyMarketingAudit','marketingAccuracy','safetyClaimAudit'], freeTools:['Custom — claim vs. feature audit']},
{id:904, section:'16.9', name:'Known dangerous user escalation protocol',  severity:'critical',patterns:['dangerousUser','knownDangerous','escalateUser'],           freeTools:['Custom — priority escalation queue']},

// §16.10 Dating App Addiction Litigation
{id:868, section:'16.10', name:'Addictive design litigation risk audit',   severity:'medium', patterns:['addictiveDesignRisk','darkPatternLitigation','addictionRisk'], freeTools:['Custom — design review checklist']},
{id:869, section:'16.10', name:'Minor engagement pattern detection',       severity:'high',   patterns:['minorEngagement','behavioralAge','underageActivity'],        freeTools:['Custom — behavioral heuristics']},
{id:870, section:'16.10', name:'Informed consent for algorithmic engagement', severity:'medium', patterns:['algorithmicConsent','engagementConsent','informedConsent.*algorithm'], freeTools:['Custom — consent flow']},

// §16.11 DSAR Weaponization
{id:765, section:'16.11', name:'DSAR abuse detection',                     severity:'medium', patterns:['dsarAbuse','dsarFrequency','subjectAccessAbuse'],           freeTools:['Custom — rate limiting + pattern detection']},
{id:766, section:'16.11', name:'Report-text PII leakage prevention',       severity:'medium', patterns:['reportPIILeakage','piiInReport','sanitizeReport'],          freeTools:['Presidio (Microsoft)','Custom redaction']},

// §17 Accessibility
{id:578, section:'17', name:'WCAG 2.1 AA compliance',                      severity:'high',   patterns:['WCAG','wcagAA','accessibilityAudit','auditWCAG'],            freeTools:['axe-core (MPL-2.0)','Pa11y','Accessibility Insights']},
{id:579, section:'17', name:'WCAG 2.1 AAA compliance',                     severity:'medium', patterns:['wcagAAA','tripleA','wcag.*aaa'],                             freeTools:['axe-core','Pa11y','Manual testing']},
{id:580, section:'17', name:'ADA Title III compliance',                    severity:'high',   patterns:['ADA','adaCompliance','titleIII'],                           freeTools:['axe-core','WAVE']},
{id:581, section:'17', name:'Font scale limits',                           severity:'medium', patterns:['maxFontSizeMultiplier','fontScale','allowFontScaling'],      freeTools:['React Native built-in props']},
{id:582, section:'17', name:'Color contrast ratios',                       severity:'medium', patterns:['checkColorContrast','colorContrast','contrastRatio'],        freeTools:['axe-core','Colour Contrast Analyser (free)']},
{id:583, section:'17', name:'Screen reader compatibility',                 severity:'high',   patterns:['accessibilityLabel','accessibilityRole','accessibilityHint','a11y'], freeTools:['VoiceOver (iOS)','TalkBack (Android)','axe-core']},
{id:584, section:'17', name:'Motor impairment accommodation',              severity:'medium', patterns:['motorImpairment','switchAccess','largeTarget','touchTarget'], freeTools:['Custom — touch target sizing']},
{id:585, section:'17', name:'Cognitive load assessment',                   severity:'low',    patterns:['cognitiveLoad','simplifyUI','cognitiveAccessibility'],       freeTools:['Manual UX review']},
{id:586, section:'17', name:'Seizure risk detection',                      severity:'high',   patterns:['seizureRisk','flashingContent','photosensitive','PEAT'],    freeTools:['PEAT (Photosensitive Epilepsy Analysis Tool, free)']},
{id:587, section:'17', name:'Deaf / HoH accommodation',                   severity:'medium', patterns:['deafAccommodation','captioning','signLanguage','hearingImpairment'], freeTools:['Whisper (OpenAI) for auto-captioning']},
{id:588, section:'17', name:'Low vision mode verification',                severity:'medium', patterns:['lowVision','highContrast','largeText','magnification'],      freeTools:['OS accessibility features + manual testing']},
{id:589, section:'17', name:'Touch target size enforcement',               severity:'medium', patterns:['touchTarget','hitSlop','minTouchTarget','targetSize'],       freeTools:['axe-core','Custom lint rules']},

// §18 Platform Operations
{id:590, section:'18', name:'Match expiration',                            severity:'medium', patterns:['matchExpir','calculateMatchExpiry','getMatchExpiryInfo','matchTTL'], freeTools:['Custom — TTL logic']},
{id:591, section:'18', name:'Rate limit profile views',                    severity:'medium', patterns:['profileViewLimit','checkProfileViewLimit','viewRateLimit'],  freeTools:['Custom — Redis/Firestore counters']},
{id:592, section:'18', name:'Fake verification badge display prevention',  severity:'high',   patterns:['fakeBadgePrevention','detectFakeBadge','verificationBadge.*fake'], freeTools:['Custom — server-side badge rendering']},
{id:593, section:'18', name:'Profile strength scoring',                    severity:'medium', patterns:['profileStrength','profileCompleteness','profileScore'],      freeTools:['Custom scoring algorithm']},
{id:594, section:'18', name:'Secondary trauma support for mods',          severity:'medium', patterns:['modWellbeingSupport','moderatorWellbeing','secondaryTrauma','modSupport'], freeTools:['Organizational — wellness programs']},
{id:595, section:'18', name:'Air-gap sensitive operations',                severity:'medium', patterns:['airGap','sensitiveOperation','isolatedExecution'],           freeTools:['Custom — network isolation']},
{id:596, section:'18', name:'Bug bounty program',                          severity:'medium', patterns:['bugBounty','responsibleDisclosure','securityReward'],        freeTools:['HackerOne (free basic)','Bugcrowd (free basic)']},
{id:597, section:'18', name:'Red team / penetration test schedule',        severity:'medium', patterns:['redTeam','penTest','penetrationTest','securityAudit'],       freeTools:['ZAP (Checkmarx)','Dastardly','Custom schedule']},
{id:598, section:'18', name:'App store review fraud',                      severity:'medium', patterns:['reviewFraud','fakeReview','appStoreManipulation'],           freeTools:['Custom — review monitoring']},
{id:599, section:'18', name:'App clone / modified APK detection',          severity:'high',   patterns:['apkClone','modifiedAPK','appCloneDetect','tampered_apk'],    freeTools:['Play Integrity API','Custom signature check']},

// §19 LGBTQ+ Safety
{id:601, section:'19', name:'LGBTQ+ Traveler Alert in hostile countries',  severity:'high',   patterns:['lgbtqTraveler','travelerAlert','hostileCountry.*lgbtq','lgbtqSafety'], freeTools:['ILGA World database (free)','Custom geofencing']},
{id:602, section:'19', name:'Auto-hide LGBTQ+ profile in criminalized jurisdictions', severity:'high', patterns:['autoHideLgbtq','hideProfile.*criminalized','lgbtqAutoHide'], freeTools:['Custom — geofenced visibility rules']},
{id:603, section:'19', name:'Strip sexual orientation/gender identity in hostile regions', severity:'high', patterns:['stripOrientation','stripGenderIdentity','redactSensitive.*region'], freeTools:['Custom — region-based field redaction']},
{id:604, section:'19', name:'LGBTQ+ entrapment pattern detection',         severity:'high',   patterns:['entrapment','lgbtqEntrapment','stingOperation'],             freeTools:['Custom — behavioral pattern matching']},
{id:605, section:'19', name:'Discreet/incognito mode for at-risk users',   severity:'high',   patterns:['discreetMode','incognitoMode','stealthMode','privateProfile'], freeTools:['Custom — enhanced privacy settings']},

// §20 User Wellbeing & Compulsive Use
{id:606, section:'20', name:'Compulsive usage / doom-swiping detection',   severity:'medium', patterns:['compulsiveUsage','doomSwiping','excessiveSwipe','sessionOveruse'], freeTools:['Custom — session analytics']},
{id:607, section:'20', name:'Break/pause reminders',                       severity:'medium', patterns:['breakReminder','pauseReminder','takeABreak','usageReminder'], freeTools:['Custom — timer-based notifications']},
{id:608, section:'20', name:'Rejection sensitivity overload detection',    severity:'medium', patterns:['rejectionOverload','rejectionSensitivity','massRejection'],  freeTools:['Custom — rejection rate monitoring']},
{id:609, section:'20', name:'Self-esteem impact monitoring',               severity:'medium', patterns:['selfEsteemImpact','wellbeingScore','mentalHealthImpact'],    freeTools:['Custom — survey + behavioral signals']},
{id:610, section:'20', name:'Session duration health caps',                severity:'medium', patterns:['sessionCap','sessionLimit','healthyCap','maxSessionDuration'], freeTools:['Custom — enforced session limits']},
{id:735, section:'20', name:'Algorithmic engagement vs wellbeing tradeoff',severity:'medium', patterns:['engagementVsWellbeing','wellbeingTradeoff','engagementBalance'], freeTools:['Custom — A/B testing framework']},
{id:736, section:'20', name:'Rejection overexposure throttling',           severity:'medium', patterns:['rejectionThrottle','rejectionOverexposure','throttleRejection'], freeTools:['Custom — queue management']},
{id:737, section:'20', name:'Negative feedback loop detection',            severity:'medium', patterns:['negativeFeedbackLoop','negativeLoop','spiralDetect'],        freeTools:['Custom — behavioral trajectory analysis']},
{id:738, section:'20', name:'Match quality vs quantity optimization gate', severity:'medium', patterns:['matchQualityGate','qualityVsQuantity','matchOptimize'],      freeTools:['Custom — recommendation tuning']},

// §20.1 Emotional Labor / Normalized Harassment
{id:896, section:'20.1', name:'Cumulative harassment exposure scoring',    severity:'high',   patterns:['harassmentExposure','cumulativeHarassment','exposureScore'],  freeTools:['Custom — incident aggregation scoring']},
{id:897, section:'20.1', name:'Emotional fatigue intervention',            severity:'medium', patterns:['emotionalFatigue','fatigueIntervention','burnoutDetect'],    freeTools:['Custom — behavioral signal + intervention']},
{id:898, section:'20.1', name:'Harassment normalization prevention',       severity:'medium', patterns:['harassmentNormalization','normalizedHarassment','preventNormalization'], freeTools:['Custom — threshold escalation']},

// §21 Cross-Platform OSINT Defense
{id:619, section:'21', name:'Reverse image search OSINT defense',          severity:'medium', patterns:['reverseImageSearch','osintDefense','photoOSINT'],            freeTools:['TinEye API (free tier)','Custom — user education']},
{id:620, section:'21', name:'Cross-platform profile correlation prevention',severity:'high',  patterns:['profileCorrelation','crossPlatformCorrelation','deAnonymization'], freeTools:['Custom — username uniqueness + metadata stripping']},
{id:621, section:'21', name:'Photo metadata OSINT risk scoring',           severity:'medium', patterns:['metadataOSINT','exifRisk','photoMetadataRisk'],             freeTools:['ExifTool','Custom — metadata analysis']},
{id:622, section:'21', name:'Background location leakage in photos',       severity:'high',   patterns:['backgroundLeakage','locationLeakage','identifiableBackground'], freeTools:['Custom — landmark detection + blur']},
{id:623, section:'21', name:'Delivery photo / routine inference',          severity:'medium', patterns:['routineInference','deliveryPhoto','habitInference'],         freeTools:['Custom — pattern detection']},

// §22 Profile Field Semantic Abuse
{id:631, section:'22', name:'Occupation field fraud',                      severity:'medium', patterns:['occupationFraud','fakeOccupation','jobFieldFraud','suspicious_occupation'], freeTools:['Custom — keyword + pattern matching']},
{id:632, section:'22', name:'Education field fraud',                       severity:'medium', patterns:['educationFraud','fakeEducation','schoolFieldFraud'],         freeTools:['Custom — known institution DB']},
{id:633, section:'22', name:'Height/weight field plausibility check',      severity:'low',    patterns:['heightPlausibility','weightPlausibility','bodyFieldCheck'],  freeTools:['Custom — statistical range validation']},
{id:634, section:'22', name:'Income/wealth signaling field manipulation',  severity:'medium', patterns:['incomeManipulation','wealthSignaling','incomeField'],        freeTools:['Custom — anomaly detection']},
{id:635, section:'22', name:'Employer verification',                       severity:'medium', patterns:['employerVerify','companyVerification','workVerify'],         freeTools:['Custom — domain email verification']},
{id:751, section:'22', name:'Body type misrepresentation reporting category', severity:'low', patterns:['bodyMisrepresentation','bodyTypeReport','physicalMismatch'], freeTools:['Custom — report category']},

// §23 Communication Channel Safety
{id:636, section:'23', name:'Push notification content moderation',        severity:'medium', patterns:['moderateNotification','notificationModeration','pushContentSafety'], freeTools:['DuoGuard','Custom text check']},
{id:637, section:'23', name:'Notification frequency abuse',                severity:'medium', patterns:['notificationAbuse','notificationFrequency','spamNotification'], freeTools:['Custom — rate limiting']},
{id:638, section:'23', name:'Are you sure pause prompt',                   severity:'medium', patterns:['sendPause','areYouSure','offensivePrompt','cooldownPrompt'], freeTools:['Custom — client-side intervention']},
{id:743, section:'23', name:'Communication consent gate',                  severity:'medium', patterns:['communicationConsent','messageConsent','consentToMessage'],  freeTools:['Custom — match-first-then-chat']},
{id:744, section:'23', name:'Unsolicited video call blocking',             severity:'medium', patterns:['unsolicitedCall','videoCallBlock','callConsent'],            freeTools:['Custom — opt-in call settings']},
{id:745, section:'23', name:'Communication preference mismatch escalation',severity:'medium', patterns:['preferenceMismatch','commPreference','escalationMismatch'], freeTools:['Custom — preference matching']},

// §23.1 Read Receipt / Online Status Weaponization
{id:689, section:'23.1', name:'Read receipt stalking pattern detection',   severity:'medium', patterns:['readReceiptStalking','obsessiveReadReceipt','readReceiptAbuse'], freeTools:['Custom — frequency analysis']},
{id:690, section:'23.1', name:'Last online status obsessive checking',     severity:'medium', patterns:['lastOnlineStalking','onlineStatusObsessive','statusCheckAbuse'], freeTools:['Custom — access pattern analysis']},
{id:691, section:'23.1', name:'Typing indicator anxiety exploitation',     severity:'low',    patterns:['typingIndicatorAbuse','typingAnxiety','indicatorManipulation'], freeTools:['Custom — can disable typing indicators']},
{id:692, section:'23.1', name:'Online status visibility granular controls',severity:'medium', patterns:['statusVisibility','onlineVisibility','hideOnlineStatus'],    freeTools:['Custom — privacy settings']},

// §24 VR/AR Dating Safety
{id:628, section:'24', name:'VR environment content moderation',           severity:'medium', patterns:['vrModeration','vrContent','metaverseModeration'],            freeTools:['Custom — spatial audio + visual analysis']},
{id:629, section:'24', name:'Avatar harassment detection',                 severity:'medium', patterns:['avatarHarassment','virtualGroping','personalSpaceBubble'],  freeTools:['Custom — proximity detection']},
{id:630, section:'24', name:'VR identity verification',                    severity:'medium', patterns:['vrIdentity','avatarVerification','vrRealPerson'],            freeTools:['Custom — linked verification']},

// §25 Wearable Device & Biometric Data
{id:670, section:'25', name:'Wearable device data consent verification',   severity:'medium', patterns:['wearableConsent','deviceDataConsent','biometricDeviceConsent'], freeTools:['Custom — consent flow']},
{id:671, section:'25', name:'Biometric data collection limitation',        severity:'medium', patterns:['biometricCollection','heartRateLimit','biometricMinimization'], freeTools:['Custom — data minimization']},
{id:672, section:'25', name:'Wearable ambient audio capture prevention',   severity:'medium', patterns:['ambientAudio','wearableAudioCapture','microphonePrevent'],  freeTools:['Custom — permission controls']},

// §26 Group Dating / Social Feature Safety
{id:673, section:'26', name:'Group date participant identity verification',severity:'medium', patterns:['groupDateVerify','groupIdentity','participantVerify'],       freeTools:['Custom — linked verification']},
{id:674, section:'26', name:'Group date consent verification',             severity:'medium', patterns:['groupConsent','allPartyConsent','groupDateConsent'],         freeTools:['Custom — multi-party consent flow']},
{id:675, section:'26', name:'Group chat moderation',                       severity:'medium', patterns:['groupChatModeration','multiPartyChat','groupDynamics'],      freeTools:['DuoGuard','Llama Guard 4','Custom']},
{id:676, section:'26', name:'Outnumbering detection (1v3 meetup safety)',  severity:'high',   patterns:['outnumberDetect','groupSizeImbalance','meetupImbalance'],    freeTools:['Custom — participant ratio check']},
{id:910, section:'26', name:'Event attendee repeat offender screening',    severity:'medium', patterns:['eventOffender','attendeeScreen','eventSafetyCheck'],         freeTools:['Custom — trust score check']},
{id:911, section:'26', name:'Event photo privacy controls',                severity:'medium', patterns:['eventPhotoPrivacy','photoOptOut','eventPhotoConsent'],       freeTools:['Custom — consent per photo']},
{id:912, section:'26', name:'Event organizer verification',                severity:'medium', patterns:['organizerVerify','eventOrganizerCheck','hostVerification'],  freeTools:['Custom — identity verification']},

// §27 Contact List & Social Graph Harvesting
{id:681, section:'27', name:'Contact list access scope limitation',        severity:'medium', patterns:['contactListScope','contactAccessLimit','contactPermission'],  freeTools:['Custom — minimal permission request']},
{id:682, section:'27', name:'Contact syncing hash-only verification',      severity:'medium', patterns:['contactHash','hashOnlySync','contactSyncHash'],              freeTools:['Custom — SHA-256 phone hash matching']},
{id:683, section:'27', name:'Social graph inference prevention',           severity:'high',   patterns:['socialGraphInference','graphPrevention','connectionInference'], freeTools:['Custom — differential privacy']},
{id:684, section:'27', name:'People you may know leakage prevention',      severity:'high',   patterns:['pymkLeakage','peopleYouMayKnow','pymkPrivacy'],             freeTools:['Custom — opt-in only + no mutual info']},

// §28 Third-Party Data Leakage & Data Broker
{id:654, section:'28', name:'Third-party SDK data exfiltration audit',     severity:'high',   patterns:['sdkExfiltration','sdkDataAudit','thirdPartySdkAudit'],       freeTools:['Custom — network traffic analysis','Exodus Privacy (Android)']},
{id:655, section:'28', name:'Ad network sensitive data leakage prevention',severity:'high',   patterns:['adNetworkLeakage','adDataLeakage','sensitiveAdData'],        freeTools:['Custom — ad SDK configuration audit']},
{id:656, section:'28', name:'Analytics SDK PII stripping verification',    severity:'medium', patterns:['analyticsPII','piiStripping','analyticsSanitize'],           freeTools:['Custom — data layer audit']},
{id:657, section:'28', name:'Data broker exposure monitoring',             severity:'medium', patterns:['dataBrokerExposure','dataBrokerMonitor','personalDataExposure'], freeTools:['Custom — user education + opt-out links']},
{id:658, section:'28', name:'Cross-portfolio data sharing controls',       severity:'medium', patterns:['crossPortfolio','dataShareControl','portfolioSharing'],      freeTools:['Custom — data isolation']},
{id:815, section:'28', name:'SDK data exfiltration runtime audit',         severity:'high',   patterns:['runtimeSdkAudit','sdkRuntimeExfil','networkAudit'],          freeTools:['mitmproxy (open-source)','Charles Proxy (free trial)']},
{id:816, section:'28', name:'Ad network bid stream data leakage prevention',severity:'medium',patterns:['bidStreamLeakage','rtbLeakage','adBidData'],                 freeTools:['Custom — RTB field filtering']},
{id:817, section:'28', name:'Privacy nutrition label accuracy verification',severity:'medium',patterns:['privacyLabel','nutritionLabel','appPrivacyLabel'],           freeTools:['Custom — automated vs. declared comparison']},

// §29 IPV & Stalkerware Defense
{id:709, section:'29', name:'Stalkerware awareness prompt post-match',     severity:'medium', patterns:['stalkerwarePrompt','stalkerwareAwareness','spywareAlert'],    freeTools:['Custom — educational prompt']},
{id:710, section:'29', name:'Coercive partner account monitoring detection',severity:'high',  patterns:['coercivePartner','partnerMonitoring','accountSurveillance'], freeTools:['Custom — session/device anomaly']},
{id:711, section:'29', name:'IPV risk assessment integration',             severity:'high',   patterns:['ipvRisk','ipvAssessment','domesticViolence'],                freeTools:['Custom — danger assessment questionnaire']},
{id:712, section:'29', name:'Forced account creation detection',           severity:'high',   patterns:['forcedCreation','coercedSignup','forcedAccount'],            freeTools:['Custom — behavioral signals']},
{id:713, section:'29', name:'Block my contacts feature',                   severity:'high',   patterns:['blockContacts','blockMyContacts','contactBlock'],            freeTools:['Custom — contact hash matching']},
{id:714, section:'29', name:'Shared device safety mode',                   severity:'high',   patterns:['safetyMode','discreetIcon','panicClose','clearHistory','sharedDeviceSafety'], freeTools:['Custom — stealth mode implementation']},
{id:715, section:'29', name:'IPV resource surfacing',                      severity:'high',   patterns:['ipvResource','domesticViolenceResource','hotlineLink'],      freeTools:['Custom — hotline integration (NDVH free)']},
{id:716, section:'29', name:'Quick-exit / boss button',                    severity:'high',   patterns:['quickExit','bossButton','exitQuickly'],                      freeTools:['Custom — instant redirect/close']},

// §29.1 Reproductive Coercion & IPV Sub-Types
{id:809, section:'29.1', name:'Reproductive coercion language detection',  severity:'high',   patterns:['reproductiveCoercion','birthControlCoercion','pregnancyCoercion'], freeTools:['Custom — keyword patterns + DuoGuard']},
{id:810, section:'29.1', name:'Financial abuse language patterns',         severity:'high',   patterns:['financialAbuse','moneyControl','financialCoercion'],         freeTools:['Custom — pattern matching']},
{id:811, section:'29.1', name:'Immigration status weaponization',          severity:'high',   patterns:['immigrationWeapon','visaThreats','deportationThreats'],      freeTools:['Custom — threat pattern detection']},

// §30 Elder-Specific Fraud Protection
{id:723, section:'30', name:'Elder-targeted scam pattern detection',       severity:'high',   patterns:['elderScam','seniorFraud','elderTargeted'],                   freeTools:['Custom — age-correlated scam patterns']},
{id:724, section:'30', name:'Trusted contact / family guardian alert system',severity:'high', patterns:['trustedContact','familyGuardian','guardianAlert'],           freeTools:['Custom — trusted contact designation']},
{id:725, section:'30', name:'Financial transaction velocity alerts for older users',severity:'medium',patterns:['elderFinancialAlert','seniorTransaction','financialVelocity.*elder'], freeTools:['Custom — age-adjusted thresholds']},
{id:726, section:'30', name:'Simplified reporting flow',                   severity:'medium', patterns:['simplifiedReport','easyReport','accessibleReport'],         freeTools:['Custom — simplified UI flow']},
{id:727, section:'30', name:'Caretaker exploitation detection',            severity:'high',   patterns:['caretakerExploitation','elderAbuse','caretakerAbuse'],       freeTools:['Custom — behavioral patterns']},

// §31 Privacy-Preserving Verification
{id:840, section:'31', name:'Privacy-preserving identity verification',    severity:'medium', patterns:['privacyPreservingVerify','minimalVerification','privacyVerify'], freeTools:['Custom — hash-based verification']},
{id:841, section:'31', name:'Zero-knowledge proof verification',           severity:'medium', patterns:['zeroKnowledge','zkProof','zkVerify'],                        freeTools:['snarkjs (open-source)','circom']},
{id:842, section:'31', name:'Minimal data collection audit',               severity:'medium', patterns:['minimalCollection','dataMinimization.*audit','collectionAudit'], freeTools:['Custom — field necessity review']},

// §32 Progressive Profile Disclosure
{id:706, section:'32', name:'Progressive disclosure controls',             severity:'medium', patterns:['progressiveDisclosure','matchOnly.*reveal','disclosureControl'], freeTools:['Custom — match-state-based field visibility']},
{id:707, section:'32', name:'Sensitive field visibility by match state',   severity:'medium', patterns:['sensitiveFieldVisibility','matchStateVisibility','fieldByMatchState'], freeTools:['Custom — ACL by relationship state']},
{id:708, section:'32', name:'Profile information minimization enforcement',severity:'medium', patterns:['profileMinimization','infoMinimization','minimalProfile'],   freeTools:['Custom — required vs. optional fields']},

// §33 Sensitive Profession Risk
{id:703, section:'33', name:'Military / intelligence professional profile protection',severity:'high',patterns:['militaryProtection','intelligenceProfile','milProfile'], freeTools:['Custom — enhanced privacy settings']},
{id:704, section:'33', name:'Government employee data isolation',          severity:'medium', patterns:['govEmployee','governmentData','govDataIsolation'],            freeTools:['Custom — data segmentation']},
{id:705, section:'33', name:'Activist / journalist enhanced privacy mode', severity:'high',   patterns:['activistPrivacy','journalistProtection','enhancedPrivacy'],  freeTools:['Custom — Tor-friendly + metadata stripping']},

// §34 Disability-Specific Exploitation
{id:758, section:'34', name:'Disability fetishization / devotee exploitation',severity:'medium',patterns:['disabilityFetish','devoteeExploitation','fetishizationDetect'], freeTools:['Custom — pattern matching + DuoGuard']},
{id:759, section:'34', name:'Cognitive disability targeting detection',    severity:'high',   patterns:['cognitiveTargeting','intellectualDisability.*target','vulnerableTargeting'], freeTools:['Custom — behavioral signals']},
{id:760, section:'34', name:'Accessibility-based scam vectors',            severity:'medium', patterns:['accessibilityScam','disabilityScam','a11yScamVector'],       freeTools:['Custom — scam pattern adaptation']},

// §35 Cultural & Religious Sensitivity
{id:761, section:'35', name:'Honor-based violence risk detection',         severity:'critical',patterns:['honorViolence','honorBased','honorKilling'],                freeTools:['Custom — pattern matching']},
{id:762, section:'35', name:'Forced marriage grooming pattern',            severity:'critical',patterns:['forcedMarriage','marriageGrooming','arrangedForced'],       freeTools:['Custom — behavioral patterns']},
{id:763, section:'35', name:'Caste-based discrimination detection',        severity:'high',   patterns:['casteDiscrimination','casteAbuse','casteBias'],              freeTools:['Custom — keyword + pattern detection']},
{id:764, section:'35', name:'Interfaith exploitation pattern',             severity:'medium', patterns:['interfaithExploitation','religiousExploitation','faithExploit'], freeTools:['Custom — pattern matching']},
{id:644, section:'35', name:'Niche community-specific moderation',         severity:'medium', patterns:['communityModeration','nicheModeration','culturalModeration'], freeTools:['Custom — community-specific rules']},

// §36 Data Breach Weaponization Defense
{id:794, section:'36', name:'Breach data cross-reference defense',         severity:'high',   patterns:['breachCrossRef','breachDefense','leakedDataDefense'],        freeTools:['HaveIBeenPwned API (free)','Custom — hash comparison']},
{id:795, section:'36', name:'Compromised credential proactive monitoring', severity:'high',   patterns:['compromisedCredential','credentialMonitor','passwordCompromise'], freeTools:['HaveIBeenPwned (free)','Custom — periodic checks']},
{id:796, section:'36', name:'Post-breach user notification and forced password rotation',severity:'high',patterns:['breachNotify','forcedPasswordReset','breachResponse'], freeTools:['Custom — notification + force reset flow']},
{id:797, section:'36', name:'Ashley Madison-style extortion detection',    severity:'high',   patterns:['breachExtortion','dataExtortion','ashleyMadisonPattern'],    freeTools:['Custom — threat pattern detection']},

// §37 Platform-to-Platform Migration Safety
{id:807, section:'37', name:'Account export data sanitization',            severity:'medium', patterns:['exportSanitize','dataSanitization','exportClean'],           freeTools:['Custom — PII redaction + Presidio']},
{id:808, section:'37', name:'Cross-platform import fraud',                 severity:'medium', patterns:['importFraud','crossPlatformImport','fakeImport'],            freeTools:['Custom — verification of imported data']},

// §38 Social Engineering of Support Staff
{id:804, section:'38', name:'Customer support social engineering detection',severity:'high',  patterns:['supportSocialEng','socialEngineeringSupport','csSocialEngineering'], freeTools:['Custom — script + verification protocols']},
{id:805, section:'38', name:'Support staff impersonation phishing defense', severity:'high',  patterns:['supportPhishing','staffImpersonation.*phish','fakeSupport'], freeTools:['Custom — verified support channels']},
{id:806, section:'38', name:'Insider access abuse detection',              severity:'high',   patterns:['insiderAbuse','insiderAccess','adminAbuseDetect','privilegeAbuse'], freeTools:['Custom — admin audit log + anomaly detection']},

// §39 Anonymous Account Safety
{id:858, section:'39', name:'Anonymous account abuse detection',           severity:'medium', patterns:['anonAbuse','anonymousAbuse','throwawayAbuse'],               freeTools:['Custom — behavioral scoring']},
{id:859, section:'39', name:'Pseudonymous reputation persistence',         severity:'medium', patterns:['pseudonymousReputation','persistentReputation','anonReputation'], freeTools:['Custom — linked reputation system']},
{id:860, section:'39', name:'Anonymous reporting credibility scoring',     severity:'medium', patterns:['anonReportCredibility','anonymousReportScore','reportCredibility'], freeTools:['Custom — report quality scoring']},

// §40 Seasonal & Event-Based Threat Amplification
{id:746, section:'40', name:'Holiday/Valentines Day scam amplification',   severity:'medium', patterns:['holidayScam','valentineScam','seasonalScam'],               freeTools:['Custom — threshold adjustment by calendar']},
{id:747, section:'40', name:'Disaster/crisis loneliness exploitation',     severity:'medium', patterns:['crisisExploitation','disasterLoneliness','pandemicScam'],    freeTools:['Custom — event-triggered sensitivity']},
{id:748, section:'40', name:'Seasonal new-user surge fraud screening',     severity:'medium', patterns:['seasonalSurge','newUserSurge','surgeScreening'],             freeTools:['Custom — enhanced screening during spikes']},

// §41 Metadata Weaponization
{id:871, section:'41', name:'Internal metadata searchability audit',       severity:'medium', patterns:['metadataSearch','internalSearchAudit','metadataExposure'],   freeTools:['Custom — access control audit']},
{id:872, section:'41', name:'Preference/kink data isolation',              severity:'high',   patterns:['kinkIsolation','preferenceIsolation','sensitivePreference'], freeTools:['Custom — field-level encryption']},
{id:873, section:'41', name:'Transaction history anonymization',           severity:'medium', patterns:['transactionAnonymize','paymentAnonymize','purchasePrivacy'], freeTools:['Custom — data anonymization']},

// §42 Platform Dark Pattern Self-Audit
{id:696, section:'42', name:'Safety feature paywalling prevention',        severity:'high',   patterns:['safetyPaywall','paywallSafety','freeSafetyFeature'],         freeTools:['Custom — policy audit']},
{id:697, section:'42', name:'Addictive design pattern audit',              severity:'medium', patterns:['addictiveDesignAudit','darkPatternAudit','addictiveMechanism'], freeTools:['Custom — design review checklist','Deceptive Design (reference)']},
{id:698, section:'42', name:'Subscription cancellation friction audit',    severity:'medium', patterns:['cancellationFriction','cancelSubscription.*friction','easyCancel'], freeTools:['Custom — UX audit']},
{id:699, section:'42', name:'Deceptive urgency in premium upsells',        severity:'medium', patterns:['deceptiveUrgency','fakeScarcity','urgentUpsell'],            freeTools:['Custom — copy audit']},
{id:755, section:'42', name:'Safety feature accessibility audit',          severity:'medium', patterns:['safetyAccessibility','a11ySafety','accessibleSafetyFeature'], freeTools:['axe-core','Pa11y']},
{id:756, section:'42', name:'Premium feature weaponization detection',     severity:'medium', patterns:['premiumWeaponization','featureWeaponize','premiumAbuse'],    freeTools:['Custom — abuse pattern detection']},
{id:757, section:'42', name:'See who liked you privacy audit',             severity:'medium', patterns:['seeWhoLiked','likedYouPrivacy','likeVisibilityAudit'],       freeTools:['Custom — privacy impact assessment']},

// §43 Safety Map & Transparency
{id:893, section:'43', name:'Safety feature completeness self-audit',      severity:'medium', patterns:['safetyCompleteness','featureCompleteness','safetyAudit'],   freeTools:['This detector audit script!']},
{id:894, section:'43', name:'Safety feature discoverability audit',        severity:'medium', patterns:['safetyDiscoverability','featureDiscoverability','findSafetyFeature'], freeTools:['Custom — UX audit']},
{id:895, section:'43', name:'Safety feature usage analytics',              severity:'medium', patterns:['safetyUsageAnalytics','featureUsageTracking','safetyAdoption'], freeTools:['Custom — analytics dashboards']},

// §44 Miscellaneous
{id:641, section:'44', name:'Account selling / marketplace detection',     severity:'medium', patterns:['accountSellingDetect','accountMarketplaceDetect','sellAccount'], freeTools:['Custom — behavioral + listing detection']},
{id:642, section:'44', name:'Premium feature exploitation for harassment', severity:'medium', patterns:['premiumHarassment','featureExploit.*harass','premiumHarassAbuse'], freeTools:['Custom — abuse pattern detection']},
{id:645, section:'44', name:'Discriminatory filtering detection',          severity:'medium', patterns:['discriminatoryFilter','biasedFilter','discriminationDetect'], freeTools:['Fairlearn','Custom — filter audit']},
{id:646, section:'44', name:'Data deletion verification post-account-removal',severity:'high',patterns:['deletionVerify','dataWipe','accountRemovalVerify'],          freeTools:['Custom — cascading delete + audit']},
{id:647, section:'44', name:'Historical email address association tracking',severity:'medium',patterns:['emailHistory','historicalEmail','emailAssociation'],          freeTools:['Custom — hash-based tracking']},
{id:648, section:'44', name:'Code word / distress signal in messages',     severity:'high',   patterns:['codeWord','distressSignal','safeWord','panicCode'],          freeTools:['Custom — keyword trigger to trusted contact']},
{id:649, section:'44', name:'Drink spiking / safety awareness contextual alerts',severity:'medium',patterns:['drinkSpikingAlert','drinkSafety','spikingAlert'],       freeTools:['Custom — date safety tips']},
{id:650, section:'44', name:'Post-date safety check-in with escalation',   severity:'high',   patterns:['postDateCheckin','afterDateSafety','dateFollowup','checkPostDateFeedback'], freeTools:['Custom — scheduled notification + escalation']},
];

// ═══════════════════════════════════════════════════════════
// DETECTOR REGISTRY VALIDATION
// ═══════════════════════════════════════════════════════════
const VALID_SEVERITY_SET = new Set(['critical','high','medium','low']);

// Validate all detectors at definition time
const registryErrors = [];
for (const d of DETECTORS_RAW) {
  if (!d.id || typeof d.id !== 'number')
    registryErrors.push(`Detector missing numeric id: ${JSON.stringify(d).slice(0,60)}`);
  if (!d.section || typeof d.section !== 'string')
    registryErrors.push(`Detector #${d.id} missing section`);
  if (!d.name || typeof d.name !== 'string')
    registryErrors.push(`Detector #${d.id} missing name`);
  if (!VALID_SEVERITY_SET.has(d.severity))
    registryErrors.push(`Detector #${d.id} "${d.name}" has invalid severity: "${d.severity}"`);
  if (!Array.isArray(d.patterns) || d.patterns.length === 0)
    registryErrors.push(`Detector #${d.id} "${d.name}" has empty patterns array`);
  if (!Array.isArray(d.freeTools))
    registryErrors.push(`Detector #${d.id} "${d.name}" missing freeTools array`);
}
if (registryErrors.length > 0) {
  console.error('❌ Registry validation errors:');
  for (const e of registryErrors) console.error('   ' + e);
  process.exit(1);
}

// Deduplicate — keep FIRST occurrence (not last), warn on dupes
const seen    = new Map(); // id -> first detector
const dupeIds = new Set();
const DETECTORS = [];
for (const d of DETECTORS_RAW) {
  if (seen.has(d.id)) {
    dupeIds.add(d.id);
  } else {
    seen.set(d.id, d);
    DETECTORS.push(d);
  }
}
if (dupeIds.size > 0) {
  console.warn(`⚠️  Skipped ${dupeIds.size} duplicate detector IDs (keeping first occurrence): ${[...dupeIds].join(', ')}`);
}

// Compile patterns — warn on broken regex, track which are plain strings
for (const d of DETECTORS) {
  d._compiled = d.patterns.map(p => {
    // Test if pattern is a valid regex
    try {
      // Use 'u' flag for proper unicode/emoji support, plus 'ig' for case-insensitive global
      const flags = p.includes('\\u') || /[\u{1F000}-\u{1FFFF}]/u.test(p) ? 'giu' : 'gi';
      return { regex: new RegExp(p, flags), source: p, isPlain: false };
    } catch (e) {
      console.warn(`⚠️  Invalid regex in detector #${d.id} "${d.name}": /${p}/ — ${e.message} — will use plain string match`);
      return { regex: null, source: p, isPlain: true };
    }
  });
}

// Validate sectionNames covers all used sections
const usedSections = new Set(DETECTORS.map(d => d.section));

// ═══════════════════════════════════════════════════════════
// UPGRADE CHECKS — find ALL matches per file, not just first
// Patterns check all occurrences across entire codebase
// ═══════════════════════════════════════════════════════════
const UPGRADE_CHECKS = [
  {
    name: 'YOLO (outdated version)',
    // Match yolov5 through yolov25 as outdated; yolo26+ is current
    outdated: /yolov?([5-9]|1\d|2[0-5])\b/gi,
    rec: 'YOLO26 (Ultralytics, AGPL-3.0) — latest, best accuracy',
  },
  {
    name: 'Whisper model (outdated size)',
    // Match whisper with tiny/base/small/medium/large-v1/large-v2 within 40 chars
    outdated: /whisper[\s\S]{0,40}?\b(tiny|base|small|medium|large-v[12])\b/gi,
    rec: 'Whisper large-v3-turbo — faster + more accurate',
  },
  {
    name: 'Llama Guard (outdated version)',
    outdated: /llama[\s_-]?guard[\s_-]?[123]\b/gi,
    rec: 'Llama Guard 4 (12B, multimodal, Meta)',
  },
  {
    name: 'Tesseract OCR',
    outdated: /\btesseract\b/gi,
    rec: 'PaddleOCR-VL (Apache 2.0) — superior accuracy',
  },
  {
    name: 'face-api.js',
    outdated: /\bface-api\b/gi,
    rec: 'InsightFace/RetinaFace (Apache 2.0, faster + more accurate)',
  },
  {
    name: 'NudeNet v1/v2',
    outdated: /\bnudenet\s*v?[12]\b/gi,
    rec: 'NudeNet v3.4+ (MIT)',
  },
  {
    name: 'dHash/pHash (basic perceptual hash)',
    outdated: /\b[dp]Hash\b/gi,
    rec: 'PDQ (Meta, open-source) or DINOHash (MIT, SOTA, robust to attacks)',
  },
  {
    name: 'all-MiniLM embeddings',
    outdated: /\ball-MiniLM\b/gi,
    rec: 'BGE-M3 or GTE-large-v1.5 (better multilingual)',
  },
  {
    name: 'Detoxify',
    outdated: /\bdetoxify\b/gi,
    rec: 'DuoGuard (0.5B, 29 langs) — faster, more categories, self-hosted',
  },
  {
    name: 'BERT toxicity classifier',
    outdated: /bert[\s\S]{0,20}?toxic|toxic[\s\S]{0,20}?bert/gi,
    rec: 'DuoGuard (0.5B) — purpose-built for content safety',
  },
  {
    name: 'OpenCV Haar Cascade face detection',
    outdated: /haarcascade|CascadeClassifier/gi,
    rec: 'MediaPipe Face Detection or RetinaFace (far more accurate)',
  },
  {
    name: 'FaceNet (non-512)',
    // Match 'facenet' not followed by '512'
    outdated: /\bfacenet\b(?!512)/gi,
    rec: 'FaceNet512 (MIT) or InsightFace ArcFace (better accuracy)',
  },
  {
    name: 'sharp EXIF strip via rotate()',
    outdated: /sharp\s*\(\s*\)\s*\.rotate\s*\(\s*\)/gi,
    rec: 'Use Exiftool -all= for thorough stripping; sharp.rotate() only strips orientation',
  },
  {
    name: 'Perspective API (without supplementary safety model)',
    // Flag if perspective api used but no duoguard/llama guard on same line or nearby
    // We check per-file: flag all files that import/use Perspective but not DuoGuard/LlamaGuard
    outdated: /perspective.*api/gi,
    rec: 'Add DuoGuard/Llama Guard 4 — Perspective lacks sexual/self-harm/grooming categories',
    // Special handling: suppress if file also contains duoguard or llama guard
    suppressIfPresent: /duoguard|llama[\s_-]?guard/gi,
  },
];

// ═══════════════════════════════════════════════════════════
// FILE SCANNING
// ═══════════════════════════════════════════════════════════
const DEFAULT_SCAN_DIRS = [
  'app','utils','components','server/src','functions/src','src','lib',
  'hooks','services','api','screens','features','modules','providers',
  'context','store','middleware',
];
const SCAN_DIRS  = CLI.dirs.length > 0 ? [...CLI.dirs, ...DEFAULT_SCAN_DIRS] : DEFAULT_SCAN_DIRS;
const EXTENSIONS = new Set(['.ts','.tsx','.js','.jsx']);
const SKIP_DIRS  = new Set(['node_modules','.git','dist','build','.expo','.next','coverage',
                             '__tests__','__mocks__','test','tests','spec','specs',
                             '__fixtures__','vendor','tmp','.cache']);
// Hard limit: skip files larger than 2MB to avoid OOM
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const SELF_PATH = (() => {
  try { return fs.realpathSync(__filename); } catch { return path.resolve(__filename); }
})();

let scanErrors  = 0;
const scanErrorDetails = [];

function getAllFiles(dir) {
  const results = [];
  let absDir;
  try { absDir = fs.realpathSync(dir); } catch { return results; }
  if (!fs.existsSync(absDir)) return results;

  let entries;
  try { entries = fs.readdirSync(absDir); }
  catch (e) { scanErrors++; scanErrorDetails.push(`readdirSync(${absDir}): ${e.message}`); return results; }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(absDir, entry);
    try {
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        results.push(...getAllFiles(full));
      } else if (EXTENSIONS.has(path.extname(entry).toLowerCase())) {
        // Skip files that are too large
        if (stat.size > MAX_FILE_BYTES) {
          if (!CLI.jsonOnly) console.warn(`⚠️  Skipping large file (${Math.round(stat.size/1024)}KB): ${full}`);
          continue;
        }
        try {
          const resolved = fs.realpathSync(full);
          if (resolved !== SELF_PATH) results.push(resolved);
        } catch { results.push(full); }
      }
    } catch (e) {
      scanErrors++;
      scanErrorDetails.push(`statSync(${full}): ${e.message}`);
    }
  }
  return results;
}

function loadFiles() {
  // Warn on missing --dir paths
  for (const d of CLI.dirs) {
    if (!fs.existsSync(d)) console.warn(`⚠️  --dir path does not exist: ${d}`);
  }

  // Collect all files, deduplicated by resolved real path
  const fileSet = new Set();
  for (const dir of SCAN_DIRS) {
    for (const f of getAllFiles(dir)) fileSet.add(f);
  }

  // Also scan root-level source files
  try {
    const rootEntries = fs.readdirSync('.');
    for (const f of rootEntries) {
      if (!EXTENSIONS.has(path.extname(f).toLowerCase())) continue;
      try {
        const stat = fs.statSync(f);
        if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
        const resolved = fs.realpathSync(f);
        if (resolved !== SELF_PATH) fileSet.add(resolved);
      } catch { /* skip */ }
    }
  } catch (e) {
    scanErrors++;
    scanErrorDetails.push(`readdirSync(.): ${e.message}`);
  }

  const contents = {};
  for (const f of fileSet) {
    try {
      const raw = fs.readFileSync(f, 'utf8');
      // Normalize line endings to LF for consistent processing
      contents[f] = normalizeLF(raw);
    } catch (e) {
      scanErrors++;
      scanErrorDetails.push(`readFileSync(${f}): ${e.message}`);
    }
  }
  return contents;
}

// ═══════════════════════════════════════════════════════════
// STRING-AWARE POSITION CLASSIFICATION
// Determine if a position in content is inside a string or comment,
// handling multi-line strings, block comments, and template literals.
// Returns a boolean array: true = inside string/comment, false = code.
// ═══════════════════════════════════════════════════════════
function buildStringMap(content) {
  const map = new Uint8Array(content.length); // 1 = in string/comment, 0 = code
  let i = 0;
  const len = content.length;

  while (i < len) {
    // Block comment /* ... */
    if (content[i] === '/' && content[i+1] === '*') {
      const start = i;
      i += 2;
      while (i < len && !(content[i-1] === '*' && content[i] === '/')) i++;
      i++; // skip closing /
      map.fill(1, start, Math.min(i, len));
      continue;
    }
    // Line comment // ...
    if (content[i] === '/' && content[i+1] === '/') {
      const start = i;
      while (i < len && content[i] !== '\n') i++;
      map.fill(1, start, i);
      continue;
    }
    // Template literal ` ... ` (simplified: doesn't handle nested ${})
    if (content[i] === '`') {
      const start = i;
      i++;
      while (i < len) {
        if (content[i] === '\\') { i += 2; continue; }
        if (content[i] === '`') { i++; break; }
        i++;
      }
      map.fill(1, start, Math.min(i, len));
      continue;
    }
    // Double-quoted string
    if (content[i] === '"') {
      const start = i;
      i++;
      while (i < len) {
        if (content[i] === '\\') { i += 2; continue; }
        if (content[i] === '"' || content[i] === '\n') { i++; break; }
        i++;
      }
      map.fill(1, start, Math.min(i, len));
      continue;
    }
    // Single-quoted string
    if (content[i] === "'") {
      const start = i;
      i++;
      while (i < len) {
        if (content[i] === '\\') { i += 2; continue; }
        if (content[i] === "'" || content[i] === '\n') { i++; break; }
        i++;
      }
      map.fill(1, start, Math.min(i, len));
      continue;
    }
    i++;
  }
  return map;
}

// ═══════════════════════════════════════════════════════════
// FUNCTION BODY EXTRACTION
// Extracts the enclosing function body around a match index.
// Handles strings/comments in brace counting via stringMap.
// ═══════════════════════════════════════════════════════════
function extractFunctionBody(content, matchIndex, stringMap) {
  const before = content.substring(0, matchIndex);
  const lines   = before.split('\n');

  // Look back up to 30 lines for a function declaration
  const LOOKBACK_LINES = 30;
  const startLine = Math.max(0, lines.length - LOOKBACK_LINES);
  const searchBack = lines.slice(startLine).join('\n');

  // Patterns for various function styles including class methods, generators, decorators
  const funcPattern = /(?:(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*\w*\s*\(|(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\(?[^)]*\)?\s*=>|(?:async\s+)?\w+\s*\([^)]{0,200}\)\s*(?::\s*[\w<>\[\]|&]+\s*)?\{|set\s+\w+\s*\(|get\s+\w+\s*\()/g;

  let lastFunc = -1;
  let fm;
  while ((fm = funcPattern.exec(searchBack)) !== null) lastFunc = fm.index;

  // Cap at 5000 chars for large functions (up from 2000)
  const BODY_CAP = 5000;

  if (lastFunc === -1) {
    // Fallback: return lines around match
    const matchLine = lines.length - 1;
    const allLines  = content.split('\n');
    return allLines.slice(Math.max(0, matchLine - 3), matchLine + 12).join('\n');
  }

  const funcAbsPos = before.length - searchBack.length + lastFunc;

  // Count braces, skipping strings/comments via stringMap
  let braceDepth = 0;
  let inBody     = false;
  let bodyEnd    = Math.min(content.length, funcAbsPos + BODY_CAP);

  for (let i = funcAbsPos; i < Math.min(content.length, funcAbsPos + BODY_CAP); i++) {
    // Skip positions inside strings/comments
    if (stringMap[i] === 1) continue;
    const ch = content[i];
    if (ch === '{') { braceDepth++; inBody = true; }
    else if (ch === '}') {
      braceDepth--;
      if (inBody && braceDepth <= 0) { bodyEnd = i + 1; break; }
    }
  }

  return content.substring(funcAbsPos, bodyEnd);
}

// ═══════════════════════════════════════════════════════════
// IMPLEMENTATION EVIDENCE SCORING
// Scores the extracted function body for real implementation signals.
// ═══════════════════════════════════════════════════════════
function scoreBody(body) {
  // Strong signals — genuine implementation indicators
  // Note: we exclude control flow keywords from hasFunctionCall
  const strong = {
    // Real async operation (not just the word 'await' in a string/comment — already filtered)
    hasAwait:        /\bawait\s+\w/.test(body),
    // Firebase/DB operations — specific enough to not false-positive on variable names
    hasFirebaseOp:   /\b(?:addDoc|setDoc|updateDoc|getDoc|getDocs|deleteDoc|runTransaction|writeBatch)\s*\(/.test(body),
    // HTTP calls — specific method patterns
    hasApiCall:      /\b(?:fetch|axios)\s*\(|\.(?:post|get|put|delete|patch)\s*\(\s*['"`]/.test(body),
    // Specific DB client patterns (not generic variable names)
    hasDbCall:       /\b(?:prisma\.\w+\.|supabase\.\w+\.|mongoose\.model|pool\.query|redis\.(?:get|set|del))\s*\(/.test(body),
    // Throw with a value (not throw in a string)
    hasThrow:        /\bthrow\s+(?:new\s+\w+|\w+)/.test(body),
    // Function call that is NOT a control flow keyword
    hasFunctionCall: /\b(?!if\b|while\b|for\b|switch\b|catch\b|return\b)(\w{3,})\s*\([^)]{0,200}\)/.test(body),
    // Return with a value
    hasReturn:       /\breturn\s+(?!\s*[;)])/.test(body),
    // Error handling
    hasErrorHandle:  /\bcatch\s*\(\s*\w/.test(body),
  };

  // Medium signals — weaker indicators
  const medium = {
    // Variable assignment (meaningful)
    hasConstDef:    /\b(?:const|let|var)\s+\w+\s*=\s*(?!(?:true|false|null|undefined|\d+)\s*[;,)])/.test(body),
    // Conditional logic
    hasConditional: /\bif\s*\([^)]+\)\s*\{/.test(body),
    // React hooks (implementation context)
    hasStateHook:   /\b(?:useState|useEffect|useCallback|useRef|useMemo)\s*\(/.test(body),
    // Structured logging (not just console.log("todo"))
    hasLogging:     /\b(?:logger\.|winston\.|pino\.|log\.)(?:info|warn|error|debug)\s*\(/.test(body),
    // TypeScript type annotation (meaningful, not just ': string')
    hasTypeAnnot:   /:\s*(?:Promise<|Observable<|Record<|Map<|\w+\[\])/.test(body),
    // Array/object operations
    hasDataOp:      /\.\b(?:map|filter|reduce|find|forEach|includes|push|splice)\s*\(/.test(body),
    // Async/Promise pattern
    hasPromise:     /\b(?:Promise\.|\.then\s*\(|\.catch\s*\(|async\s+function|async\s*\()/.test(body),
  };

  const strongCount  = Object.values(strong).filter(Boolean).length;
  const mediumCount  = Object.values(medium).filter(Boolean).length;

  return { strong, medium, strongCount, mediumCount };
}

function classifyFromScore(strongCount, mediumCount) {
  if (strongCount >= 4)                          return 'strong';
  if (strongCount >= 3)                          return 'strong';
  if (strongCount >= 2 && mediumCount >= 1)      return 'solid';
  if (strongCount >= 2)                          return 'solid';
  if (strongCount >= 1 && mediumCount >= 3)      return 'solid';
  if (strongCount >= 1 && mediumCount >= 2)      return 'moderate';
  if (strongCount >= 1 && mediumCount >= 1)      return 'moderate';
  if (strongCount >= 1)                          return 'weak';
  if (mediumCount >= 3)                          return 'weak';
  if (mediumCount >= 1)                          return 'reference';
  return 'reference';
}

// ═══════════════════════════════════════════════════════════
// IMPLEMENTATION EVIDENCE EXTRACTION
// ═══════════════════════════════════════════════════════════
function getImplementationEvidence(content, compiledPatterns, stringMap) {
  const ev = {
    matchedPatterns: new Set(),
    codeLines:       [],
    bestScore:       { strongCount: 0, mediumCount: 0 },
  };

  for (const { regex, source, isPlain } of compiledPatterns) {

    if (isPlain || !regex) {
      // Plain string fallback — case-insensitive substring search
      const lower   = content.toLowerCase();
      const pattern = source.toLowerCase();
      let idx = lower.indexOf(pattern);
      while (idx !== -1) {
        if (stringMap[idx] === 0) {
          ev.matchedPatterns.add(source);
          break; // one match is enough for plain string
        }
        idx = lower.indexOf(pattern, idx + 1);
      }
      continue;
    }

    // Recreate regex per scan to avoid shared lastIndex bugs
    const safeRegex = new RegExp(regex.source, regex.flags);
    let match;

    while ((match = safeRegex.exec(content)) !== null) {
      // Guard against zero-length match infinite loop
      if (match[0].length === 0) { safeRegex.lastIndex++; continue; }

      const matchIdx = match.index;

      // Skip if inside string or comment
      if (stringMap[matchIdx] === 1) continue;

      ev.matchedPatterns.add(source);

      // Capture code line for display (limit to 3)
      if (ev.codeLines.length < 3) {
        const lineStart = content.lastIndexOf('\n', matchIdx) + 1;
        const lineEnd   = content.indexOf('\n', matchIdx);
        const line      = content.substring(lineStart, lineEnd === -1 ? content.length : lineEnd).trim();
        if (line && !ev.codeLines.includes(line)) {
          ev.codeLines.push(line.substring(0, 140));
        }
      }

      // Extract function body and score it
      const body  = extractFunctionBody(content, matchIdx, stringMap);
      const score = scoreBody(body);

      // Keep best score across all matches
      if (score.strongCount > ev.bestScore.strongCount ||
         (score.strongCount === ev.bestScore.strongCount &&
          score.mediumCount > ev.bestScore.mediumCount)) {
        ev.bestScore = score;
      }
    }
  }

  ev.matchedPatterns = [...ev.matchedPatterns]; // convert Set to Array
  return ev;
}

// ═══════════════════════════════════════════════════════════
// CHECK DETECTOR ACROSS ALL FILES
// ═══════════════════════════════════════════════════════════
const ranks = { strong:5, solid:4, moderate:3, weak:2, reference:1, none:0 };

function checkDetector(detector, contents) {
  const fileMatches      = [];
  let bestClassification = 'none';
  let bestStrongCount    = 0;
  let bestMediumCount    = 0;

  for (const [file, content] of Object.entries(contents)) {
    // Build string map once per file (cached per call)
    const stringMap = buildStringMap(content);
    const ev = getImplementationEvidence(content, detector._compiled, stringMap);
    if (ev.matchedPatterns.length === 0) continue;

    const cls = classifyFromScore(ev.bestScore.strongCount, ev.bestScore.mediumCount);

    // Keep best classification across all files — ties go to higher strong count then medium
    const isBetter = (ranks[cls] ?? 0) > (ranks[bestClassification] ?? 0) ||
      ((ranks[cls] ?? 0) === (ranks[bestClassification] ?? 0) &&
       (ev.bestScore.strongCount > bestStrongCount ||
        (ev.bestScore.strongCount === bestStrongCount && ev.bestScore.mediumCount > bestMediumCount)));

    if (isBetter) {
      bestClassification = cls;
      bestStrongCount    = ev.bestScore.strongCount;
      bestMediumCount    = ev.bestScore.mediumCount;
    }

    fileMatches.push({
      file:           path.relative(process.cwd(), file),
      classification: cls,
      codeLines:      ev.codeLines,
      strongCount:    ev.bestScore.strongCount,
      mediumCount:    ev.bestScore.mediumCount,
    });
  }

  // Sort file matches by quality descending for consistent output
  fileMatches.sort((a, b) => (ranks[b.classification] ?? 0) - (ranks[a.classification] ?? 0));

  return { fileMatches, bestClassification, bestStrongCount, bestMediumCount };
}

// ═══════════════════════════════════════════════════════════
// UPGRADE VERSION CHECKER
// Finds ALL matches per file, handles suppressIfPresent,
// skips strings/comments via stringMap
// ═══════════════════════════════════════════════════════════
function checkUpgrades(contents) {
  const results = [];

  for (const check of UPGRADE_CHECKS) {
    const foundFiles = [];

    for (const [file, content] of Object.entries(contents)) {
      // If this check has a suppressIfPresent pattern and the file contains it, skip
      if (check.suppressIfPresent) {
        const suppressRe = new RegExp(check.suppressIfPresent.source, check.suppressIfPresent.flags);
        if (suppressRe.test(content)) continue;
      }

      const stringMap = buildStringMap(content);
      const re = new RegExp(check.outdated.source, check.outdated.flags);
      const fileMatches = [];
      let match;

      while ((match = re.exec(content)) !== null) {
        if (match[0].length === 0) { re.lastIndex++; continue; }
        // Skip matches inside strings/comments
        if (stringMap[match.index] === 1) continue;

        const lineStart = content.lastIndexOf('\n', match.index) + 1;
        const lineEnd   = content.indexOf('\n', match.index);
        const line = content.substring(lineStart, lineEnd === -1 ? content.length : lineEnd).trim();

        fileMatches.push({
          file:  path.relative(process.cwd(), file),
          match: match[0],
          line:  line.substring(0, 120),
        });
      }

      if (fileMatches.length > 0) foundFiles.push(...fileMatches);
    }

    if (foundFiles.length > 0) {
      results.push({ name: check.name, upgrade: check.rec, files: foundFiles });
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════
// FILTER ACTIVE DETECTORS
// ═══════════════════════════════════════════════════════════
let activeDetectors = DETECTORS;

if (CLI.section) {
  activeDetectors = activeDetectors.filter(d =>
    d.section === CLI.section ||
    d.section.startsWith(CLI.section + '.')
  );
}

if (CLI.severity) {
  activeDetectors = activeDetectors.filter(d =>
    (sevRank[d.severity] ?? 0) >= (sevRank[CLI.severity] ?? 0)
  );
}

if (activeDetectors.length === 0) {
  console.error(`❌ No detectors match filters (section=${CLI.section ?? 'any'}, severity=${CLI.severity ?? 'any'}). Use --help for usage.`);
  process.exit(2); // exit 2 for user input errors, not runtime errors
}

// ═══════════════════════════════════════════════════════════
// SECTION NAMES
// ═══════════════════════════════════════════════════════════
const sectionNames = {
  '1.1':'NSFW / Adult Content',                   '1.2':'Identity & Face Verification',
  '1.3':'AI Generated & Manipulated',             '1.4':'Dangerous Content in Images',
  '1.5':'Photo Quality & Authenticity',           '1.6':'Camera & Capture Verification',
  '1.7':'Children in Photos',                     '1.8':'AI-Generated NCII / Nudification',
  '1.9':'Screenshot Weaponization',
  '2.1':'Hate Speech & Slurs',                    '2.2':'Sexual Content & Solicitation',
  '2.3':'Violence & Threats',                     '2.4':'Scam & Fraud Language',
  '2.5':'Manipulation Patterns',                  '2.6':'PUA Techniques',
  '2.7':'Contact Info & Redirection',             '2.8':'Text Evasion Techniques',
  '2.9':'Spam & Automation',                      '2.10':'Field-Specific Moderation',
  '2.11':'Sextortion',                            '2.12':'AI Emotional Manipulation',
  '2.13':'Continued Contact After Block',
  '3':'Identity & Document Verification',
  '4.1':'Registration Security',                  '4.2':'Login Security',
  '4.3':'Session Security',                       '4.4':'Account Creation by Proxy',
  '4.5':'Shared Device Safety',
  '5.1':'Scam Behavioral Patterns',               '5.2':'Predatory Patterns',
  '5.3':'Child Predator Targeting',               '5.4':'Engagement Fraud',
  '5.5':'Conversation Analysis',                  '5.6':'Forced Scammer / Trafficking',
  '5.7':'Post-Relationship Abuse',                '5.8':'Proxy Account Operation',
  '5.9':'Married / Relationship Deception',       '5.10':'State-Sponsored Espionage',
  '5.11':'Extremist Recruitment',
  '6':'Location & Physical Safety',               '6.1':'Robbery / Violent Crime Lure',
  '7':'Voice & Audio Safety',
  '8':'Encryption & Privacy',
  '9':'Physical Date Safety',
  '10':'Trust & Reputation',                      '10.1':'Ghost/Zombie Profile',
  '10.2':'Systematic Failure / Litigation',       '10.3':'Safety Feature Weaponization',
  '11':'Social Verification',
  '12':'Payments & Financial Fraud',
  '13':'API & Infrastructure Security',           '13.1':'API Data Exposure',
  '13.2':'Mass Profile Scraping Defense',         '13.3':'Platform Cybersecurity',
  '14':'Device & Platform Integrity',             '14.1':'Network/Graph Analysis',
  '14.2':'Fake Dating App / Malware',             '14.3':'Cross-Platform Banned User Intel',
  '14.4':'Third-Party Cheater Tool Defense',
  '15':'AI/ML System Safety',                     '15.1':'AI Feature Privacy & Consent',
  '15.2':'AI Agent / Concierge Safety',           '15.3':'AI-Powered Infrastructure Safety',
  '15.4':'AI Scam Detection Failure Modes',       '15.5':'Algorithmic Bias & Discrimination',
  '16.1':'Age & Child Safety',                    '16.2':'Privacy Laws',
  '16.3':'Biometric & Sensitive Data',            '16.4':'Sensitive Health Data',
  '16.5':'Platform-Specific Laws',                '16.6':'Take It Down Act / NCII',
  '16.7':'Romance Scam Prevention Act',           '16.8':'Audit & Legal Process',
  '16.9':'Platform Liability / Foreseeable Harm', '16.10':'Dating App Addiction Litigation',
  '16.11':'DSAR Weaponization',
  '17':'Accessibility',
  '18':'Platform Operations',
  '19':'LGBTQ+ Safety',
  '20':'User Wellbeing & Compulsive Use',         '20.1':'Emotional Labor / Normalized Harassment',
  '21':'Cross-Platform OSINT Defense',
  '22':'Profile Field Semantic Abuse',
  '23':'Communication Channel Safety',            '23.1':'Read Receipt / Status Weaponization',
  '24':'VR/AR Dating Safety',
  '25':'Wearable Device & Biometric Data',
  '26':'Group Dating / Social Feature Safety',
  '27':'Contact List & Social Graph Harvesting',
  '28':'Third-Party Data Leakage & Data Broker',
  '29':'IPV & Stalkerware Defense',               '29.1':'Reproductive Coercion & IPV Sub-Types',
  '30':'Elder-Specific Fraud Protection',
  '31':'Privacy-Preserving Verification',
  '32':'Progressive Profile Disclosure',
  '33':'Sensitive Profession Risk',
  '34':'Disability-Specific Exploitation',
  '35':'Cultural & Religious Sensitivity',
  '36':'Data Breach Weaponization Defense',
  '37':'Platform Migration Safety',
  '38':'Social Engineering of Support Staff',
  '39':'Anonymous Account Safety',
  '40':'Seasonal & Event-Based Threat Amplification',
  '41':'Metadata Weaponization',
  '42':'Platform Dark Pattern Self-Audit',
  '43':'Safety Map & Transparency',
  '44':'Miscellaneous',
};

// Warn if any detector section has no name
for (const sec of usedSections) {
  if (!sectionNames[sec] && !CLI.jsonOnly) {
    console.warn(`⚠️  No section name defined for section "${sec}" — add it to sectionNames`);
  }
}

// ═══════════════════════════════════════════════════════════
// RUN AUDIT
// ═══════════════════════════════════════════════════════════
if (!CLI.jsonOnly) {
  console.log('\n🔍 MASTER DETECTOR AUDIT v5.4 — All ~920 Detectors');
  console.log('═'.repeat(65));
}

const allContents = loadFiles();
const fileCount   = Object.keys(allContents).length;

if (!CLI.jsonOnly) {
  console.log(`📁 Scanned ${fileCount} source files`);
  if (scanErrors > 0) {
    console.log(`⚠️  ${scanErrors} scan errors (use --section to see details)`);
    if (CLI.section) {
      for (const e of scanErrorDetails.slice(0, 10)) console.log(`   ${e}`);
    }
  }
  console.log('');
}

// Build string maps cache — one per file, reused across all detectors
const stringMaps = {};
for (const [file, content] of Object.entries(allContents)) {
  stringMaps[file] = buildStringMap(content);
}

// Optimized checkDetector that uses cached string maps
function checkDetectorCached(detector, contents) {
  const fileMatches      = [];
  let bestClassification = 'none';
  let bestStrongCount    = 0;
  let bestMediumCount    = 0;

  for (const [file, content] of Object.entries(contents)) {
    const stringMap = stringMaps[file];
    const ev = getImplementationEvidence(content, detector._compiled, stringMap);
    if (ev.matchedPatterns.length === 0) continue;

    const cls = classifyFromScore(ev.bestScore.strongCount, ev.bestScore.mediumCount);

    const isBetter = (ranks[cls] ?? 0) > (ranks[bestClassification] ?? 0) ||
      ((ranks[cls] ?? 0) === (ranks[bestClassification] ?? 0) &&
       (ev.bestScore.strongCount > bestStrongCount ||
        (ev.bestScore.strongCount === bestStrongCount &&
         ev.bestScore.mediumCount > bestMediumCount)));

    if (isBetter) {
      bestClassification = cls;
      bestStrongCount    = ev.bestScore.strongCount;
      bestMediumCount    = ev.bestScore.mediumCount;
    }

    fileMatches.push({
      file:           path.relative(process.cwd(), file),
      classification: cls,
      codeLines:      ev.codeLines,
      strongCount:    ev.bestScore.strongCount,
      mediumCount:    ev.bestScore.mediumCount,
    });
  }

  fileMatches.sort((a, b) => (ranks[b.classification] ?? 0) - (ranks[a.classification] ?? 0));
  return { fileMatches, bestClassification, bestStrongCount, bestMediumCount };
}

const total        = activeDetectors.length;
const implemented  = [];
const partial      = [];
const referenceOnly = [];
const missing      = [];

for (const detector of activeDetectors) {
  const result = checkDetectorCached(detector, allContents);
  const entry  = { ...detector, ...result };
  if (result.fileMatches.length === 0) {
    missing.push(entry);
  } else if (['strong','solid'].includes(result.bestClassification)) {
    implemented.push(entry);
  } else if (['moderate','weak'].includes(result.bestClassification)) {
    partial.push(entry);
  } else {
    referenceOnly.push(entry);
  }
}

const implementedIds  = new Set(implemented.map(d => d.id));
const partialIds      = new Set(partial.map(d => d.id));
const referenceIds    = new Set(referenceOnly.map(d => d.id));

// ═══════════════════════════════════════════════════════════
// UPGRADE CHECKS (uses cached string maps internally via contents)
// ═══════════════════════════════════════════════════════════
const upgrades = checkUpgrades(allContents);

// ═══════════════════════════════════════════════════════════
// SECTION STATS — computed once, used for both console and JSON
// ═══════════════════════════════════════════════════════════
const sectionStats = {};
for (const d of activeDetectors) {
  const sec = d.section;
  if (!sectionStats[sec]) sectionStats[sec] = { total:0, implemented:0, partial:0, reference:0, missing:0 };
  sectionStats[sec].total++;
  if (implementedIds.has(d.id))    sectionStats[sec].implemented++;
  else if (partialIds.has(d.id))   sectionStats[sec].partial++;
  else if (referenceIds.has(d.id)) sectionStats[sec].reference++;
  else                             sectionStats[sec].missing++;
}

// ═══════════════════════════════════════════════════════════
// CONSOLE OUTPUT
// ═══════════════════════════════════════════════════════════
if (!CLI.jsonOnly) {
  const sep = '═'.repeat(65);

  if (!CLI.summary) {

    // ── Implemented ──
    console.log(sep);
    console.log(`✅ FULLY IMPLEMENTED (${implemented.length}/${total})`);
    console.log(sep);
    for (const d of implemented) {
      console.log(`  ✅ #${String(d.id).padStart(3,'0')} [${d.section}] ${d.name} [${d.bestClassification}]`);
      // Show ALL file matches, not just first
      for (const fm of d.fileMatches) {
        console.log(`        → ${fm.file} [${fm.classification}]`);
      }
    }

    // ── Partial ──
    console.log(`\n${sep}`);
    console.log(`🔶 PARTIALLY IMPLEMENTED (${partial.length}/${total})`);
    console.log(sep);
    for (const d of partial) {
      console.log(`  🔶 #${String(d.id).padStart(3,'0')} [${d.section}] ${d.name} [${d.bestClassification}] (strong:${d.bestStrongCount} medium:${d.bestMediumCount})`);
      for (const fm of d.fileMatches.slice(0, 3)) {
        console.log(`        → ${fm.file}`);
        if (fm.codeLines[0]) console.log(`          ${fm.codeLines[0]}`);
      }
      if (d.freeTools?.length) {
        for (const tool of d.freeTools) console.log(`          free: ${tool}`);
      }
    }

    // ── Reference Only ──
    console.log(`\n${sep}`);
    console.log(`⚠️  REFERENCE ONLY (${referenceOnly.length}/${total})`);
    console.log(sep);
    for (const d of referenceOnly) {
      console.log(`  ⚠️  #${String(d.id).padStart(3,'0')} [${d.section}] ${d.name}`);
      for (const fm of d.fileMatches.slice(0, 2)) console.log(`        → ${fm.file}`);
      if (d.freeTools?.length) {
        for (const tool of d.freeTools) console.log(`          free: ${tool}`);
      }
    }

    // ── Missing ──
    console.log(`\n${sep}`);
    console.log(`❌ MISSING (${missing.length}/${total})`);
    console.log(sep);
    const missingBySection = {};
    for (const d of missing) {
      if (!missingBySection[d.section]) missingBySection[d.section] = [];
      missingBySection[d.section].push(d);
    }
    for (const [sec, detectors] of Object.entries(missingBySection).sort((a,b) => sectionCompare(a[0],b[0]))) {
      console.log(`\n  [${sec}] ${sectionNames[sec] ?? sec}`);
      for (const d of detectors) {
        const sev = d.severity==='critical'?'🔴':d.severity==='high'?'🟠':d.severity==='medium'?'🟡':'⚪';
        console.log(`    ❌ ${sev} #${String(d.id).padStart(3,'0')} ${d.name} [${d.severity}]`);
        console.log(`          need: ${d.patterns.join(' | ')}`);
        if (d.freeTools?.length) {
          for (const tool of d.freeTools) console.log(`          free: ${tool}`);
        }
      }
    }
  }

  // ── Upgrade Recommendations ──
  console.log(`\n${sep}`);
  if (upgrades.length > 0) {
    console.log(`⬆️  UPGRADE RECOMMENDATIONS (${upgrades.length} outdated tool patterns found)`);
    console.log(sep);
    for (const u of upgrades) {
      console.log(`\n  ⬆️  ${u.name}`);
      console.log(`      → ${u.upgrade}`);
      console.log(`      Found in ${u.files.length} location(s):`);
      // Show ALL occurrences, not just first 3
      for (const f of u.files) {
        console.log(`        📁 ${f.file}`);
        console.log(`           found: "${f.match}"`);
        if (f.line) console.log(`           ${f.line}`);
      }
    }
  } else {
    console.log(`⬆️  UPGRADE RECOMMENDATIONS — all detected tools are current ✅`);
    console.log(sep);
  }

  // ── Section Coverage ──
  console.log(`\n${sep}`);
  console.log('📊 SECTION-BY-SECTION COVERAGE');
  console.log(sep);
  for (const [sec, stats] of Object.entries(sectionStats).sort((a,b) => sectionCompare(a[0],b[0]))) {
    const pct    = Math.round((stats.implemented / stats.total) * 100);
    const filled = Math.round(pct * 20 / 100);
    const bar    = '█'.repeat(filled) + '░'.repeat(20 - filled);
    const name   = sectionNames[sec] ?? sec;
    console.log(`  [${sec.padEnd(5)}] [${bar}] ${String(pct).padStart(3)}% (${stats.implemented}✅ ${stats.partial}🔶 ${stats.reference}⚠️  ${stats.missing}❌) ${name}`);
  }

  // ── Overall Summary ──
  const critMiss = missing.filter(d => d.severity==='critical');
  const highMiss = missing.filter(d => d.severity==='high');
  console.log(`\n${sep}`);
  console.log('📊 OVERALL SUMMARY');
  console.log(sep);
  console.log(`  ✅ Fully implemented : ${implemented.length}/${total} (${Math.round(implemented.length/total*100)}%)`);
  console.log(`  🔶 Partial/weak      : ${partial.length}/${total} (${Math.round(partial.length/total*100)}%)`);
  console.log(`  ⚠️  Reference only    : ${referenceOnly.length}/${total} (${Math.round(referenceOnly.length/total*100)}%)`);
  console.log(`  ❌ Missing            : ${missing.length}/${total} (${Math.round(missing.length/total*100)}%)`);
  console.log(`  ⬆️  Upgrade needed    : ${upgrades.length} tool(s)`);
  console.log(`\n  Total detectors: ${total} | Files scanned: ${fileCount} | Scan errors: ${scanErrors}`);

  if (critMiss.length > 0) {
    console.log(`\n  🔴 CRITICAL MISSING (${critMiss.length}):`);
    // Show ALL critical missing, not just first 10
    for (const d of critMiss) console.log(`     #${String(d.id).padStart(3,'0')} [${d.section}] ${d.name}`);
  }
  if (highMiss.length > 0) {
    console.log(`\n  🟠 HIGH MISSING (${highMiss.length}):`);
    for (const d of highMiss.slice(0, 20)) console.log(`     #${String(d.id).padStart(3,'0')} [${d.section}] ${d.name}`);
    if (highMiss.length > 20) console.log(`     ... and ${highMiss.length - 20} more`);
  }

  // Warn if scan errors affected coverage
  if (scanErrors > 0) {
    console.log(`\n  ⚠️  WARNING: ${scanErrors} files failed to scan — coverage may be understated`);
  }

  console.log(sep);
}

// ═══════════════════════════════════════════════════════════
// FREE TOOLS SUMMARY
// ═══════════════════════════════════════════════════════════
const TOOL_CATEGORIES = {
  'Content Safety / Guardrails':     /guard|duoguard|qwen|apriel|safeguard|shieldgemma|granite/i,
  'NSFW / Nudity Detection':         /nsfw|nudenet|nsfwjs|marqo|freepik/i,
  'Face Recognition':                /face|insightface|adaface|facenet|deepface|compreface|auraface|inspireface/i,
  'Deepfake Detection':              /deepfake|deepsafe|deepfakebench|selimsef/i,
  'Object Detection / OCR':         /yolo|tesseract|paddleocr|clip|mediapipe/i,
  'Perceptual Hashing / CSAM':       /hash|pdq|photodna|dinohash|stopncii|cloudflare.*csam/i,
  'PII Detection':                   /presidio|roblox|pii/i,
  'URL / Link Safety':               /safe.browsing|urlscan|virustotal|phish/i,
  'Accessibility':                   /axe|pa11y|wave|accessibility|peat/i,
  'Fairness / Bias':                 /aif360|fairlearn|aequitas/i,
  'ML Monitoring':                   /evidently|alibi|mlflow|shap|lime|netcal/i,
  'AI Security':                     /garak|art.*ibm|rebuff|foolbox/i,
  'API Security':                    /zap|akto|dastardly|graphql.armor/i,
  'Voice / Audio':                   /whisper|wedefense|fakevoice|asvspoof|resemble|pyannote|chromaprint/i,
  'Threat Intelligence':             /misp|opencti|yara|abuseipdb|opensanctions/i,
  'Dependency Security':             /dependabot|snyk|socket|renovate/i,
  'Location / GeoIP':                /maxmind|getipintel|h3|s2|osm|overpass/i,
  'Account Security':                /haveibeenpwned|disposable|thumbmark/i,
  'Encryption':                      /signal|tweetnacl|tls|trustkit|ssl/i,
  'Text Safety APIs':                /perspective|openai.*moderation|detoxify/i,
  'Human Review':                    /label.studio/i,
  'Metadata':                        /exiftool|c2patool/i,
  'Child Safety':                    /ncmec|cloudflare.*csam|csai/i,
  'Device Integrity':                /play.integrity|safetynet/i,
};

// Deduplicate tool strings by normalizing them
const freeToolsRaw = new Map(); // normalized -> original
for (const d of DETECTORS) {
  if (!d.freeTools) continue;
  for (const t of d.freeTools) {
    if (/^(Custom|Organizational|Manual|No\s|Requires\s|None\b)/i.test(t)) continue;
    const normalized = t.toLowerCase().replace(/\s*\(.*?\)/g, '').trim();
    if (!freeToolsRaw.has(normalized)) freeToolsRaw.set(normalized, t);
  }
}

const toolsByCategory = {};
for (const [, tool] of [...freeToolsRaw].sort((a,b) => a[0].localeCompare(b[0]))) {
  let cat = 'Other';
  for (const [category, regex] of Object.entries(TOOL_CATEGORIES)) {
    if (regex.test(tool)) { cat = category; break; }
  }
  if (!toolsByCategory[cat]) toolsByCategory[cat] = [];
  toolsByCategory[cat].push(tool);
}

if (!CLI.jsonOnly) {
  const sep = '═'.repeat(65);
  console.log(`\n${sep}`);
  console.log('🛠️  RECOMMENDED FREE TOOLS BY CATEGORY');
  console.log(sep);
  for (const [cat, tools] of Object.entries(toolsByCategory).sort()) {
    console.log(`\n  [${cat}]`);
    for (const tool of tools) console.log(`    🛠️  ${tool}`);
  }
}

// ═══════════════════════════════════════════════════════════
// DELTA COMPARISON WITH PREVIOUS AUDIT
// ═══════════════════════════════════════════════════════════
let delta = null;
if (CLI.compare) {
  try {
    const prevRaw = fs.readFileSync(CLI.compare, 'utf8');
    const prev    = JSON.parse(prevRaw);

    const prevImplIds   = new Set((prev.implemented   || []).map(d => d.id));
    const prevPartIds   = new Set((prev.partial        || []).map(d => d.id));
    const prevRefIds    = new Set((prev.referenceOnly  || []).map(d => d.id));
    const prevMissIds   = new Set((prev.missing        || []).map(d => d.id));

    const newlyImplemented = implemented.filter(d => !prevImplIds.has(d.id));
    const promotedToFull   = implemented.filter(d => prevPartIds.has(d.id) || prevRefIds.has(d.id));
    const demotedFromFull  = partial.filter(d => prevImplIds.has(d.id));
    // Regressions: was implemented or partial, now missing
    // Also catch reference -> missing
    const regressions = missing.filter(d =>
      prevImplIds.has(d.id) || prevPartIds.has(d.id) || prevRefIds.has(d.id)
    );

    // Deduplicate: promotedToFull may overlap with newlyImplemented
    const promotedIds = new Set(promotedToFull.map(d => d.id));
    const newlyImplDeduped = newlyImplemented.filter(d => !promotedIds.has(d.id));

    delta = {
      previousTotal:       prev.summary?.total       ?? '?',
      previousImplemented: prev.summary?.implemented ?? '?',
      currentImplemented:  implemented.length,
      newlyImplemented:    newlyImplDeduped.map(d => ({ id: d.id, name: d.name, section: d.section })),
      promotedToFull:      promotedToFull.map(d => ({ id: d.id, name: d.name, section: d.section })),
      demotedFromFull:     demotedFromFull.map(d => ({ id: d.id, name: d.name, section: d.section })),
      regressions:         regressions.map(d => ({ id: d.id, name: d.name, section: d.section })),
    };

    if (!CLI.jsonOnly) {
      const sep = '═'.repeat(65);
      console.log(`\n${sep}`);
      console.log('📈 DELTA vs PREVIOUS AUDIT');
      console.log(sep);
      console.log(`  Previous: ${delta.previousImplemented}/${delta.previousTotal} | Current: ${implemented.length}/${total}`);
      if (newlyImplDeduped.length)  { console.log(`\n  🆕 Newly ✅ (${newlyImplDeduped.length}):`);  for (const d of newlyImplDeduped)  console.log(`     ✅ #${d.id} [${d.section}] ${d.name}`); }
      if (promotedToFull.length)    { console.log(`\n  ⬆️  🔶/⚠️→✅ (${promotedToFull.length}):`);    for (const d of promotedToFull)    console.log(`     ✅ #${d.id} [${d.section}] ${d.name}`); }
      if (demotedFromFull.length)   { console.log(`\n  ⬇️  ✅→🔶 (${demotedFromFull.length}):`);      for (const d of demotedFromFull)   console.log(`     🔶 #${d.id} [${d.section}] ${d.name}`); }
      if (regressions.length)       { console.log(`\n  ❌ Regressions (${regressions.length}):`);      for (const d of regressions)       console.log(`     ❌ #${d.id} [${d.section}] ${d.name}`); }
      if (!newlyImplDeduped.length && !promotedToFull.length && !demotedFromFull.length && !regressions.length) {
        console.log('  No changes detected.');
      }
    }
  } catch (e) {
    if (!CLI.jsonOnly) console.error(`⚠️  Could not load/parse comparison file "${CLI.compare}": ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════
// SAVE JSON REPORT
// ═══════════════════════════════════════════════════════════
const report = {
  timestamp:      new Date().toISOString(),
  version:        '5.4',
  scannedFiles:   fileCount,
  scanErrors,
  scanErrorDetails: scanErrors > 0 ? scanErrorDetails : undefined,
  totalDetectors: total,
  filterApplied:  { section: CLI.section ?? null, severity: CLI.severity ?? null },
  summary: {
    implemented:        implemented.length,
    partial:            partial.length,
    referenceOnly:      referenceOnly.length,
    missing:            missing.length,
    total,
    implementedPercent: Math.round(implemented.length / total * 100),
    partialPercent:     Math.round(partial.length / total * 100),
    referencePercent:   Math.round(referenceOnly.length / total * 100),
    missingPercent:     Math.round(missing.length / total * 100),
    criticalMissing:    missing.filter(d => d.severity==='critical').length,
    highMissing:        missing.filter(d => d.severity==='high').length,
    upgradesAvailable:  upgrades.length,
  },
  upgrades: upgrades.map(u => ({
    tool:    u.name,
    upgrade: u.upgrade,
    // All occurrences, not sliced
    files:   u.files.map(f => ({ file: f.file, found: f.match, line: f.line })),
  })),
  sectionCoverage: Object.entries(sectionStats)
    .map(([sec, stats]) => ({
      section:  sec,
      name:     sectionNames[sec] ?? sec,
      ...stats,
      coverage: Math.round((stats.implemented / stats.total) * 100),
    }))
    .sort((a,b) => sectionCompare(a.section, b.section)),
  implemented: implemented.map(d => ({
    id: d.id, section: d.section, name: d.name, severity: d.severity,
    quality:       d.bestClassification,
    strongSignals: d.bestStrongCount,
    mediumSignals: d.bestMediumCount,
    freeTools:     d.freeTools ?? [],
    // All files, not sliced; no raw code samples in JSON to avoid source leakage
    files: d.fileMatches.map(f => ({
      file:        f.file,
      quality:     f.classification,
      strongCount: f.strongCount,
      mediumCount: f.mediumCount,
    })),
  })),
  partial: partial.map(d => ({
    id: d.id, section: d.section, name: d.name, severity: d.severity,
    quality:       d.bestClassification,
    strongSignals: d.bestStrongCount,
    mediumSignals: d.bestMediumCount,
    freeTools:     d.freeTools ?? [],
    files: d.fileMatches.map(f => ({
      file:        f.file,
      quality:     f.classification,
      strongCount: f.strongCount,
      mediumCount: f.mediumCount,
    })),
  })),
  referenceOnly: referenceOnly.map(d => ({
    id: d.id, section: d.section, name: d.name, severity: d.severity,
    freeTools: d.freeTools ?? [],
    files: d.fileMatches.map(f => f.file),
  })),
  missing: missing.map(d => ({
    id:        d.id,
    section:   d.section,
    name:      d.name,
    severity:  d.severity,
    lookFor:   d.patterns,    // all patterns
    freeTools: d.freeTools ?? [],
  })),
  freeToolsSummary: toolsByCategory,
  ...(delta ? { delta } : {}),
};

// Write report — with error handling and no concurrent write corruption risk
// (atomic write: write to temp file then rename)
const tmpOutput = CLI.output + '.tmp.' + process.pid;
try {
  const jsonStr = JSON.stringify(report, null, 2);
  fs.writeFileSync(tmpOutput, jsonStr, 'utf8');
  fs.renameSync(tmpOutput, CLI.output);
  if (!CLI.jsonOnly) {
    console.log(`\n💾 Full report saved → ${CLI.output}`);
    console.log(`📊 ${total} detectors audited | ${fileCount} files scanned | ${Object.keys(sectionNames).length} sections\n`);
  } else {
    // --json-only: print the JSON to stdout
    console.log(jsonStr);
  }
} catch (e) {
  // Clean up temp file if rename failed
  try { fs.unlinkSync(tmpOutput); } catch { /* ignore */ }
  console.error(`❌ Failed to write report to "${CLI.output}": ${e.message}`);
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════
// EXIT CODE
// ═══════════════════════════════════════════════════════════
const criticalMissing = missing.filter(d => d.severity === 'critical');
const highMissing     = missing.filter(d => d.severity === 'high');

if (!CLI.warnOnly) {
  if (criticalMissing.length > 0) {
    if (!CLI.jsonOnly) {
      console.log(`⚠️  Exiting with code 1: ${criticalMissing.length} CRITICAL + ${highMissing.length} HIGH detectors missing`);
    }
    process.exit(1);
  }
}

// Warn explicitly even under --warn-only --json-only so CI logs capture it
if (criticalMissing.length > 0 && CLI.warnOnly) {
  process.stderr.write(`WARN: ${criticalMissing.length} critical detectors missing (--warn-only suppresses exit code 1)\n`);
}

// Scan errors affect reliability — exit 1 if more than 20% of expected files failed
if (scanErrors > 0 && fileCount > 0 && !CLI.warnOnly) {
  const errorRate = scanErrors / (scanErrors + fileCount);
  if (errorRate > 0.20) {
    if (!CLI.jsonOnly) console.log(`⚠️  Exiting with code 1: scan error rate ${Math.round(errorRate*100)}% exceeds 20% threshold`);
    process.exit(1);
  }
}

process.exit(0);
// server/src/nsfwEndpoints.ts
// REPLACES previous — hardens #007, adds #009/#012/#600 detector signals
// Patterns: verify-photo-nsfw | verify-video-nsfw | SERVER_URL.*nsfw | cyberflash | partial_nudity
import { spawn } from 'child_process';
import crypto from 'crypto';
import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs/promises';
import path from 'path';

const router = express.Router();

// ─── Types ──────────────────────────────────────────────────────────────────
interface NsfwScanRequest {
  image?: string;
  imageUrl?: string;
  checks?: string[];
}
interface VideoScanRequest {
  videoUrl: string;
  sampleRate?: number;
}
interface ScanResult {
  safe: boolean;
  confidence: number;
  reason: string | null;
  shouldBlur: boolean;
  needsReview: boolean;
  signals: {
    partialNudity: boolean;
    contextScore: number;
    cyberflashSignal: boolean;
    explicitParts: string[];
    aiArtifactRisk: number;
  };
  layers: Record<string, unknown>;
}

// ─── Audit Logger (#16.8, #007) ─────────────────────────────────────────────
const auditLog = (endpoint: string, result: Partial<ScanResult>, meta: Record<string, unknown>) => {
  process.stdout.write(JSON.stringify({
    severity: 'MODERATION_AUDIT',
    endpoint,
    ts: new Date().toISOString(),
    id: `MOD-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    safe: result.safe,
    confidence: result.confidence,
    shouldBlur: result.shouldBlur,
    signals: result.signals,
    ...meta
  }) + '\n');
};

// ─── Safe Python Runner (stdin/stdout, no shell injection) ──────────────────
function runPython(script: string, input?: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', ['-c', script], { env: { ...process.env, PYTHONIOENCODING: 'utf8' } });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    if (input) proc.stdin.write(typeof input === 'string' ? input : JSON.stringify(input));
    proc.stdin.end();
    proc.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(err || `exit ${code}`)));
  });
}

// ─── Temp File Helper ───────────────────────────────────────────────────────
const TMP_DIR = '/tmp/nsfw_scans';
fs.mkdir(TMP_DIR, { recursive: true }).catch(() => {});
async function writeTempImage(b64: string): Promise<string> {
  const tmp = path.join(TMP_DIR, `${crypto.randomBytes(6).toString('hex')}.jpg`);
  await fs.writeFile(tmp, Buffer.from(b64, 'base64'));
  return tmp;
}

// ─── Rate Limiting ──────────────────────────────────────────────────────────
const scanLimiter = rateLimit({ windowMs: 60_000, max: 50, message: { error: 'Too many scan requests' } });

// ════════════════════════════════════════════════════════════════════════════
// #007  POST /api/verify-photo-nsfw  ← PRIMARY SERVER-SIDE NSFW BACKSTOP
// ════════════════════════════════════════════════════════════════════════════
router.post('/verify-photo-nsfw', scanLimiter, async (req: Request, res: Response) => {
  const { image, imageUrl, checks = ['nsfw', 'nudity'] } = req.body as NsfwScanRequest;
  if (!image && !imageUrl) return res.status(400).json({ error: 'image or imageUrl required' });

  let tmpPath: string | null = null;
  try {
    if (image) tmpPath = await writeTempImage(image);
    const src = tmpPath ?? imageUrl!;

    // ── Unified Python Scanner (Marqo + NudeNet + Context/Signals) ─────────
    const script = `
import sys, json, warnings, os, re
warnings.filterwarnings('ignore')
from transformers import pipeline
try:
    from nudenet import NudeDetector
except:
    NudeDetector = None

src = "${src}"
is_url = src.startswith('http')

# Layer 1: Marqo
marqo = pipeline("image-classification", model="Marqo/nsfw-image-detection-384", device=-1)
m_res = marqo(src)
m_scores = {r['label']: r['score'] for r in m_res}
m_nsfw = m_scores.get('nsfw', 0)

# Layer 2: NudeNet
n_res = {"explicit_parts":[],"partial_parts":[],"max_score":0.0,"is_explicit":False,"is_partial":False}
if NudeDetector:
    det = NudeDetector()
    dets = det.detect(src)
    EXPL = {'FEMALE_BREAST_EXPOSED','MALE_GENITALIA_EXPOSED','FEMALE_GENITALIA_EXPOSED','BUTTOCKS_EXPOSED','ANUS_EXPOSED'}
    PART = {'FEMALE_BREAST_COVERED','FEMALE_GENITALIA_COVERED','MALE_GENITALIA_COVERED','BUTTOCKS_COVERED'}
    SWIM = {'UNDERWEAR','SWIMWEAR'}
    
    expl = [d for d in dets if d['class'] in EXPL and d['score'] > 0.55]
    part = [d for d in dets if d['class'] in PART and d['score'] > 0.60]
    swim = [d for d in dets if d['class'] in SWIM and d['score'] > 0.65]
    
    max_s = max((d['score'] for d in dets), default=0)
    n_res = {
        "explicit_parts": [d['class'] for d in expl],
        "partial_parts": [d['class'] for d in part],
        "max_score": max_s,
        "is_explicit": len(expl) > 0,
        "is_partial": len(part) > 0,
        "context_score": len(swim) / max(len(dets), 1),
        "cyberflash_signal": len(swim) == 0 and max_s > 0.85 and any(p in str(part) for p in ['COVERED'])
    }

# Combine
conf = max(m_nsfw, n_res['max_score'])
is_nsfw = m_nsfw > 0.72 or n_res['is_explicit']
needs_rev = (0.48 < m_nsfw <= 0.72) or n_res['is_partial']
blur = n_res['is_explicit'] or (n_res['cyberflash_signal'] and conf > 0.6)
reason = None
if n_res['is_explicit']: reason = f"explicit:{n_res['explicit_parts'].join(',')}"
elif n_res['cyberflash_signal']: reason = "cyberflash_unsolicited"
elif m_nsfw > 0.72: reason = f"nsfw_score:{m_nsfw:.3f}"

print(json.dumps({
    "safe": not is_nsfw, "confidence": conf, "reason": reason, "shouldBlur": blur, "needsReview": needs_rev,
    "signals": {"partialNudity": n_res['is_partial'], "contextScore": n_res.get('context_score',0), 
                "cyberflashSignal": n_res.get('cyberflash_signal',False), "explicitParts": n_res['explicit_parts'], "aiArtifactRisk": 0.0},
    "layers": {"marqo_nsfw": m_nsfw, "nudenet": n_res}
}))
`;

    const raw = await runPython(script).catch(e => JSON.stringify({
      safe: true, confidence: 0, reason: 'scan_error', shouldBlur: false, needsReview: true,
      signals: { partialNudity:false, contextScore:0, cyberflashSignal:false, explicitParts:[], aiArtifactRisk:0 },
      layers: { error: String(e) }
    }));

    const result = JSON.parse(raw) as ScanResult;
    auditLog('/verify-photo-nsfw', result, { ip: req.ip, userId: req.headers['x-user-id'] });
    return res.json(result);

  } catch (err) {
    console.error('[/verify-photo-nsfw]', err);
    return res.status(500).json({ error: 'Internal scan error' });
  } finally {
    if (tmpPath) await fs.unlink(tmpPath).catch(() => {});
  }
});

// ════════════════════════════════════════════════════════════════════════════
// #007  POST /api/verify-video-nsfw  ← VIDEO NSFW BACKSTOP
// ════════════════════════════════════════════════════════════════════════════
router.post('/verify-video-nsfw', scanLimiter, async (req: Request, res: Response) => {
  const { videoUrl, sampleRate = 1 } = req.body as VideoScanRequest;
  if (!videoUrl) return res.status(400).json({ error: 'videoUrl required' });

  const frameDir = path.join(TMP_DIR, `frames_${crypto.randomBytes(6).toString('hex')}`);
  try {
    await fs.mkdir(frameDir, { recursive: true });

    const extractScript = `
import subprocess, json, os, sys
fd, v, r = "${frameDir}", "${videoUrl}", ${sampleRate}
try:
    subprocess.run(['ffmpeg','-i',v,'-vf',f'fps={r}','-frames:v','24',f'{fd}/f_%04d.jpg','-y','-loglevel','quiet'], check=True)
    frames = sorted([os.path.join(fd,f) for f in os.listdir(fd) if f.endswith('.jpg')])
    print(json.dumps({"frames":frames,"count":len(frames)}))
except Exception as e:
    print(json.dumps({"frames":[],"count":0,"error":str(e)}))
`;

    const exRaw = await runPython(extractScript);
    const { frames = [], count = 0, error } = JSON.parse(exRaw);
    if (!count) return res.json({ safe: true, confidence: 0, reason: error || 'no_frames', flaggedFrames: 0, totalFrames: 0 });

    const scanScript = `
import json, warnings
warnings.filterwarnings('ignore')
from transformers import pipeline
frames = ${JSON.stringify(frames)}
clf = pipeline("image-classification", model="Marqo/nsfw-image-detection-384", device=-1)
results = []
for f in frames:
    try:
        preds = clf(f)
        sc = {r['label']: r['score'] for r in preds}.get('nsfw', 0)
        results.append({"nsfw_score": sc, "is_nsfw": sc > 0.68})
    except: results.append({"nsfw_score": 0, "is_nsfw": False})
flagged = [r for r in results if r['is_nsfw']]
max_s = max((r['nsfw_score'] for r in results), default=0)
print(json.dumps({
    "safe": len(flagged) == 0, "confidence": max_s,
    "flaggedFrames": len(flagged), "totalFrames": len(results),
    "reason": "nsfw_frames_detected" if len(flagged) > 0 else None
}))
`;

    const scanRaw = await runPython(scanScript);
    const result = JSON.parse(scanRaw) as ScanResult & { flaggedFrames: number; totalFrames: number };
    auditLog('/verify-video-nsfw', result, { ip: req.ip, userId: req.headers['x-user-id'] });
    return res.json(result);

  } catch (err) {
    console.error('[/verify-video-nsfw]', err);
    return res.status(500).json({ error: 'Internal video scan error' });
  } finally {
    await fs.rm(frameDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
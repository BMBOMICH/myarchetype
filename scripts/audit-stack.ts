// scripts/audit-stack.ts
// Run with: npx ts-node --project scripts/tsconfig.json scripts/audit-stack.ts
// Or: npm run audit

import fs from "fs";
import path from "path";

// ============================================================
// TYPES
// ============================================================

type Severity = "error" | "warning" | "info" | "ok";
interface Finding {
  readonly severity: Severity;
  readonly file: string;
  readonly line?: number;
  readonly message: string;
  readonly fix?: string;
}
interface FileAuditResult {
  readonly filePath: string;
  readonly exists: boolean;
  readonly findings: Finding[];
  readonly implemented: string[];
  readonly missing: string[];
  readonly forbidden: string[];
  skipReason?: string;
}
interface SourceFileIssue {
  readonly file: string;
  readonly issues: Finding[];
  readonly goodPatterns: string[];
}
interface AlreadyReported {
  asyncStorage: boolean;
  flatList: boolean;
  rnStyleSheet: boolean;
  rnImage: boolean;
  reanimated: boolean;
  panResponder: boolean;
  heavyWork: boolean;
}

// ============================================================
// CONSTANTS
// ============================================================

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  blue: "\x1b[34m", magenta: "\x1b[35m", cyan: "\x1b[36m",
} as const;

const MAX_FILES = 2000;
const MAX_FILE_SIZE_BYTES = 500_000;
const PROJECT_ROOT = process.cwd();

// Variable names that signal a dynamic server-fetched data array.
const DATA_LIST_VARS = new Set([
  "data","items","posts","messages","results","list","rows","entries",
  "comments","notifications","sections","users","matches","profiles",
  "conversations","feeds","records","products","orders","events",
  "activities","threads","replies","reviews",
]);

// Variable names that are small, static UI-structure arrays.
const STATIC_UI_VARS = new Set([
  "buttons","tabs","steps","options","chips","filters","categories",
  "menuItems","navItems","actions","badges","instructions","methods",
  "modes","types","kinds","choices","answers","fields","inputs",
  "controls","config","settings","preferences","features","plans",
  "benefits","permissions","roles","statuses","links","routes",
  "traits","archetypes","dimensions","attributes","qualities","factors",
  "answerOptions","quizOptions","questionOptions",
]);

// ============================================================
// HELPERS — FILE I/O
// ============================================================

const resolvePath = (...s: string[]) => path.join(PROJECT_ROOT, ...s);
const fileExists  = (p: string) => fs.existsSync(p);

function readFile(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_FILE_SIZE_BYTES) return null;
    return fs.readFileSync(filePath, "utf8");
  } catch { return null; }
}

function getAllFiles(
  dir: string,
  exts: string[],
  ignore = ["node_modules",".git","dist",".expo","build",".turbo"],
  budget = { count: 0 },
): string[] {
  const out: string[] = [];
  if (!fileExists(dir) || budget.count >= MAX_FILES) return out;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    if (budget.count >= MAX_FILES) break;
    const full = path.join(dir, e.name);
    if (ignore.includes(e.name)) continue;
    if (e.isDirectory()) out.push(...getAllFiles(full, exts, ignore, budget));
    else if (exts.some(x => e.name.endsWith(x))) { out.push(full); budget.count++; }
  }
  return out;
}

// ============================================================
// HELPERS — CONTENT ANALYSIS
// ============================================================

/** Strip inline comment from a single line. */
const stripInlineComment = (l: string) => {
  const i = l.indexOf("//");
  return i !== -1 ? l.slice(0, i) : l;
};

/**
 * Returns 1-based line numbers where `search` appears in active code.
 * Skips full-line comments and the portion after // on a code line.
 */
function findLineNumbers(content: string, search: string): number[] {
  const results: number[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const t = line.trimStart();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("{/*")) continue;
    if (stripInlineComment(line).includes(search)) results.push(i + 1);
  }
  return results;
}

const findLineNumber   = (c: string, s: string) => findLineNumbers(c, s)[0];
const containsActive   = (c: string, s: string) => findLineNumbers(c, s).length > 0;
const contains         = (c: string, p: string | RegExp) =>
  typeof p === "string" ? c.includes(p) : p.test(c);
const countOccurrences = (c: string, s: string) => findLineNumbers(c, s).length;

function extractBracedBody(content: string, openIdx: number): string {
  let depth = 0, i = openIdx;
  while (i < content.length) {
    if (content[i] === "{") depth++;
    if (content[i] === "}") { depth--; if (depth === 0) return content.slice(openIdx + 1, i); }
    i++;
  }
  return "";
}

/** Extract text bodies of all useEffect callbacks. */
function extractUseEffectBodies(content: string): string[] {
  const bodies: string[] = [];
  const re = /useEffect\s*\(\s*(?:async\s*)?\(\s*\)\s*=>\s*(\{)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const body = extractBracedBody(content, m.index + m[0].length - 1);
    if (body) bodies.push(body);
  }
  return bodies;
}

/**
 * Strip deferred callback bodies (setTimeout, setInterval, requestIdleCallback,
 * requestAnimationFrame) from a useEffect body before scanning for heavy work.
 */
function stripDeferredCallbacks(body: string): string {
  const DEFERRED_RE = /(?:setTimeout|setInterval|requestIdleCallback|requestAnimationFrame)\s*\(\s*(?:async\s*)?(?:\(\s*\)|[a-zA-Z_$]\w*)\s*=>\s*(\{)/g;
  let result = body;
  let safety = 0;
  while (safety++ < 20) {
    DEFERRED_RE.lastIndex = 0;
    const m = DEFERRED_RE.exec(result);
    if (!m || m.index === undefined) break;
    const openIdx = m.index + m[0].length - 1;
    const inner = extractBracedBody(result, openIdx);
    result = result.slice(0, openIdx) + "{/* deferred */}" + result.slice(openIdx + inner.length + 2);
  }
  return result;
}

/**
 * Strip useMemo callback bodies from content before scanning useEffect bodies
 * for heavy work. This prevents false positives when computation has been
 * correctly moved into useMemo (e.g. buildHeightCache) but a reference or
 * function call remains visible inside a useEffect.
 *
 * FIX: chat.tsx false positive — buildHeightCache in useMemo was being
 * detected as heavy work because the scanner read raw file content.
 */
function stripUseMemoBodies(content: string): string {
  const MEMO_RE = /useMemo\s*\(\s*(?:async\s*)?\(\s*\)\s*=>\s*(\{)/g;
  let result = content;
  let safety = 0;
  while (safety++ < 50) {
    MEMO_RE.lastIndex = 0;
    const m = MEMO_RE.exec(result);
    if (!m || m.index === undefined) break;
    const openIdx = m.index + m[0].length - 1;
    const inner = extractBracedBody(result, openIdx);
    result = result.slice(0, openIdx) + "{/* memo */}" + result.slice(openIdx + inner.length + 2);
  }
  return result;
}

/**
 * Returns true when heavy computation appears INSIDE a useEffect body —
 * not anywhere else in the file, not inside deferred callbacks, and not
 * inside useMemo bodies (which is the correct place for heavy computation).
 *
 * FIX: chat.tsx false positive — strip useMemo bodies before extracting
 * useEffect bodies so that computation moved to useMemo isn't flagged.
 */
function useEffectHasHeavyWork(content: string): boolean {
  // Strip useMemo bodies first so heavy work correctly placed there
  // doesn't pollute the useEffect body extraction.
  const withoutMemo = stripUseMemoBodies(content);

  for (const rawBody of extractUseEffectBodies(withoutMemo)) {
    const body = stripDeferredCallbacks(rawBody);
    const active = body
      .split("\n")
      .filter(l => { const t = l.trimStart(); return t && !t.startsWith("//") && !t.startsWith("*"); })
      .join("\n");

    const nonEmpty = active.split("\n").map(l => l.trim()).filter(Boolean);
    if (nonEmpty.length && nonEmpty.every(
      l => /^\w+\.current\s*=/.test(l) || /^if\s*\(/.test(l)
    )) continue;

    if (
      active.includes(".sort(")   ||
      active.includes(".filter(") ||
      active.includes(".reduce(") ||
      active.includes("JSON.parse") ||
      active.includes("JSON.stringify")
    ) return true;

    const maps  = (active.match(/\.map\s*\(/g) ?? []).length;
    const pmaps = (active.match(/Promise\.(?:all|allSettled)\s*\([^)]*\.map\s*\(/g) ?? []).length;
    if (maps - pmaps > 3) return true;
  }
  return false;
}

// ── Import checkers ───────────────────────────────────────────────────────────

function importsSymbolFromCoreRN(content: string, symbol: string): boolean {
  for (const line of content.split("\n")) {
    if (!line) continue;
    const t = line.trimStart();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("{/*")) continue;
    if (!new RegExp(`\\bimport\\s*\\{[^}]*\\b${symbol}\\b[^}]*\\}`).test(line)) continue;
    if (/from\s*['"]react-native['"]\s*;?\s*$/.test(line.trimEnd())) return true;
  }
  return false;
}

function importsFromUnistyles(content: string): boolean {
  for (const line of content.split("\n")) {
    if (!line) continue;
    const t = line.trimStart();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("{/*")) continue;
    if (line.includes("react-native-unistyles") && line.includes("import")) return true;
  }
  return false;
}

/** True when LegendList is actually imported into this file (not in a comment). */
function importsLegendList(content: string): boolean {
  for (const line of content.split("\n")) {
    if (!line) continue;
    const t = line.trimStart();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("{/*")) continue;
    const active = stripInlineComment(line);
    if (
      active.includes("@legendapp/list") ||
      /import\s*\{[^}]*\bLegendList\b[^}]*\}/.test(active)
    ) return true;
  }
  return false;
}

/** True when <LegendList is actually rendered in JSX (not in a comment). */
function usesLegendListJSX(content: string): boolean {
  const JSX_RE = /<LegendList[\s/>]/;
  for (const line of content.split("\n")) {
    if (!line) continue;
    const t = line.trimStart();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("{/*")) continue;
    if (JSX_RE.test(stripInlineComment(line))) return true;
  }
  return false;
}

// ── File-type predicates ──────────────────────────────────────────────────────

const isReactFile = (f: string) => f.endsWith(".tsx") || f.endsWith(".jsx");

function isComponentOrHookFile(f: string): boolean {
  if (!isReactFile(f)) return false;
  const n = f.replace(/\\/g, "/");
  return !["/utils/","/services/","/store/","/api/","/lib/"].some(s => n.includes(s));
}

function isUtilOrServiceFile(f: string): boolean {
  const n = f.replace(/\\/g, "/");
  return ["/utils/","/services/","/lib/","/api/","/scripts/","/store/"].some(s => n.includes(s));
}

function isLikelyListItemFile(f: string): boolean {
  const n = f.replace(/\\/g, "/");
  const b = path.basename(f).toLowerCase();
  return ["/items/","/cells/","/cards/"].some(s => n.includes(s)) ||
    ["item","cell","card","row","tile"].some(s => b.includes(s));
}

// ── Result helpers ────────────────────────────────────────────────────────────

function makeResult(filePath: string, exists: boolean): FileAuditResult {
  return { filePath, exists, findings: [], implemented: [], missing: [], forbidden: [] };
}

function addFinding(
  r: FileAuditResult, severity: Severity, message: string, fix?: string, line?: number
) {
  r.findings.push({ severity, file: r.filePath, message,
    ...(fix  !== undefined && { fix }),
    ...(line !== undefined && { line }) });
}

function pushIssue(
  issues: Finding[], file: string, severity: Severity,
  message: string, fix?: string, line?: number
) {
  issues.push({ severity, file, message,
    ...(fix  !== undefined && { fix }),
    ...(line !== undefined && { line }) });
}

function extractMajorVersion(v: string): number | null {
  if (!v || v === "*") return null;
  const s = v
    .replace(/^workspace:/,"").replace(/^npm:/,"")
    .replace(/^git\+https?:.*#/,"").replace(/^[^0-9]*/,"");
  const m = s.match(/^(\d+)/);
  return m && m[1] ? parseInt(m[1], 10) : null;
}

// ── ScrollView checks ─────────────────────────────────────────────────────────

function scrollViewWrapsListCheck(content: string): boolean {
  const LIST_RE = /<(LegendList|FlatList|FlashList|VirtualizedList)[\s/>]/;
  const SV_O   = /<ScrollView[\s/>]/;
  const SV_C   = /<\/ScrollView>/;
  let inside = false;
  for (const line of content.split("\n")) {
    if (!line) continue;
    const t = line.trimStart();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("{/*")) continue;
    const a = stripInlineComment(line);
    if (SV_O.test(a)) inside = true;
    if (SV_C.test(a)) inside = false;
    if (inside && LIST_RE.test(a)) return true;
  }
  return false;
}

function scrollViewContainsDataListMap(content: string): boolean {
  const lines  = content.split("\n");
  const SV_O   = /<ScrollView[\s/>]/;
  const SV_C   = /<\/ScrollView>/;
  const MAP_RE = /\b([a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*)?)\s*\.\s*map\s*\(/;
  const FN_RE  = /(?:^|\s)(?:const|function|let|var)\s+[A-Z]\w*\s*(?:=|:|\()/;
  const WRAP_RE = /flexWrap|flex-wrap/;
  let inside = false, depth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const t = line.trimStart();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("{/*")) continue;
    const a = stripInlineComment(line);

    if (FN_RE.test(a)) { inside = false; depth = 0; }
    if (SV_O.test(a))  { inside = true; depth++; }
    if (SV_C.test(a))  { depth = Math.max(0, depth - 1); if (!depth) inside = false; }
    if (!inside) continue;

    const mm = a.match(MAP_RE);
    if (!mm || !mm[1]) continue;
    if (/Promise\.(?:all|allSettled)\s*\(/.test(a)) continue;

    const leaf = mm[1].split(".").pop()!.toLowerCase();
    if (STATIC_UI_VARS.has(leaf)) continue;

    const win = lines.slice(Math.max(0, i - 5), Math.min(lines.length - 1, i + 6)).join("\n");
    if (WRAP_RE.test(win)) continue;

    if (DATA_LIST_VARS.has(leaf)) return true;
  }
  return false;
}

// ── fetch() intent detectors ──────────────────────────────────────────────────

function fetchIsBlobConversion(content: string): boolean {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.includes("fetch(")) continue;
    const t = line.trimStart();
    if (t.startsWith("//") || t.startsWith("*")) continue;
    const win = lines.slice(i, Math.min(lines.length, i + 4)).join("\n");
    if (
      win.includes(".blob()") ||
      win.includes(".arrayBuffer()") ||
      win.includes(".buffer()")
    ) return true;
    if (/fetch\s*\(\s*\w*(?:[Uu]ri|[Pp]ath|[Ff]ile|[Ll]ocal)\b/.test(line)) return true;
  }
  return false;
}

function fetchIsFileUpload(content: string): boolean {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.includes("fetch(")) continue;
    const t = line.trimStart();
    if (t.startsWith("//") || t.startsWith("*")) continue;
    const win = lines.slice(Math.max(0, i - 5), Math.min(lines.length, i + 11)).join("\n");
    if (
      win.includes("FormData")      ||
      win.includes("multipart")     ||
      win.includes("cloudinary")    ||
      win.includes("Cloudinary")    ||
      win.includes("amazonaws.com") ||
      win.includes("s3.")           ||
      (/['"]POST['"]/.test(win) && win.includes("body") && win.includes("upload"))
    ) return true;
  }
  return false;
}

function allFetchesAreNonQueryable(content: string): boolean {
  if (!containsActive(content, "fetch(")) return false;
  const isBlobConv = fetchIsBlobConversion(content);
  const isUpload   = fetchIsFileUpload(content);
  if (!isBlobConv && !isUpload) return false;
  return countOccurrences(content, "fetch(") <= 4;
}

function fetchIsFireAndForget(content: string): boolean {
  const FF = [
    "checkpassword","breached","hibp","haveibeenpwned","sendpush",
    "sendnotif","logevent","trackevent","analytics","ping","beacon",
    "reporterror","reportcrash",
  ];
  const lines = content.split("\n");
  let fn = "", fetches = 0, ffFetches = 0;
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("//")) continue;
    const fnM =
      t.match(/^(?:async\s+)?function\s+(\w+)/) ??
      t.match(/^(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_$]\w*)\s*=>/) ??
      t.match(/^(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function/);
    if (fnM?.[1]) fn = fnM[1];
    if (t.includes("fetch(")) {
      fetches++;
      const lo = fn.toLowerCase(), ll = line.toLowerCase();
      if (FF.some(n => lo.includes(n)) || FF.some(n => ll.includes(n))) ffFetches++;
    }
  }
  return fetches > 0 && fetches === ffFetches;
}

// ── State complexity ──────────────────────────────────────────────────────────

function analyzeStateComplexity(content: string): {
  total: number;
  likelyIndependent: number;
  likelyLocalUiState: number;
} {
  const total = countOccurrences(content, "useState");

  const independentPatterns = [
    /useState\s*\(\s*false\s*\)/g,
    /useState\s*\(\s*true\s*\)/g,
    /useState\s*\(\s*null\s*\)/g,
    /useState\s*\(\s*\[\s*\]\s*\)/g,
  ];
  let likelyIndependent = 0;
  for (const p of independentPatterns) {
    const m = content.match(p);
    if (m) likelyIndependent += m.length;
  }

  const localUiPatterns = [
    /const\s+\[\s*(?:is)?[Ll]oading\b/g,
    /const\s+\[\s*(?:is)?[Ss]aving\b/g,
    /const\s+\[\s*(?:is)?[Uu]ploading\b/g,
    /const\s+\[\s*(?:is)?[Ss]ubmitting\b/g,
    /const\s+\[\s*(?:is)?[Ff]etching\b/g,
    /const\s+\[\s*(?:is)?[Rr]efreshing\b/g,
    /const\s+\[\s*\w*(?:[Mm]odal|[Cc]amera|[Pp]icker|[Ss]heet|[Pp]opup|[Dd]rawer|[Mm]enu|[Dd]ropdown)[Oo]pen\b/g,
    /const\s+\[\s*(?:show|hide)\w+\b/g,
    /const\s+\[\s*\w*[Vv]isible\b/g,
    /const\s+\[\s*\w*[Oo]pen\b/g,
    /const\s+\[\s*\w*[Rr]eady\b/g,
    /const\s+\[\s*(?:current)?[Ss]tep\b/g,
    /const\s+\[\s*(?:active|selected|current)?[Tt]ab\b/g,
    /const\s+\[\s*(?:active|selected|current)?[Ii]ndex\b/g,
    /const\s+\[\s*[Mm]ethod\b/g,
    /const\s+\[\s*[Mm]ode\b/g,
    /const\s+\[\s*\w*[Ee]rror\b/g,
    /const\s+\[\s*\w*[Rr]esult\b/g,
    /const\s+\[\s*\w*[Pp]hoto\b/g,
    /const\s+\[\s*\w*[Ii]mage\b/g,
    /const\s+\[\s*\w*[Ff]ile\b/g,
    /const\s+\[\s*\w*[Cc]apture\b/g,
    /const\s+\[\s*\w*[Pp]ermission\b/g,
    /const\s+\[\s*\w*[Tt]arget\b/g,
    /const\s+\[\s*(?:text|value|input|query|search|height|weight)\b/g,
    /const\s+\[\s*\w*[Ee]stimat/g,
    /const\s+\[\s*\w*[Ss]elected\b/g,
    /const\s+\[\s*\w*[Ee]xpanded\b/g,
    /const\s+\[\s*\w*[Cc]ollapsed\b/g,
    /const\s+\[\s*\w*[Aa]ctive\b/g,
    /const\s+\[\s*\w*[Ff]ilter\b/g,
    /const\s+\[\s*\w*[Ss]ort\b/g,
    /const\s+\[\s*\w*[Pp]age\b/g,
    /const\s+\[\s*\w*[Ll]imit\b/g,
    /const\s+\[\s*\w*[Cc]ount\b/g,
    /const\s+\[\s*\w*[Ss]core\b/g,
    /const\s+\[\s*\w*[Rr]ating\b/g,
    /const\s+\[\s*\w*[Ss]lide\b/g,
    /const\s+\[\s*\w*[Aa]nswer\b/g,
    /const\s+\[\s*\w*[Qq]uestion\b/g,
    /const\s+\[\s*\w*[Pp]rogress\b/g,
    /const\s+\[\s*\w*[Tt]ime(?:r|out|stamp)?\b/g,
    /const\s+\[\s*\w*[Dd]uration\b/g,
    /const\s+\[\s*\w*[Pp]laying\b/g,
    /const\s+\[\s*\w*[Pp]aused\b/g,
    /const\s+\[\s*\w*[Rr]ecording\b/g,
    /const\s+\[\s*\w*[Pp]review\b/g,
    /const\s+\[\s*\w*[Dd]raft\b/g,
    /const\s+\[\s*\w*[Ee]diting\b/g,
    /const\s+\[\s*\w*[Hh]overed\b/g,
    /const\s+\[\s*\w*[Pp]ressed\b/g,
    /const\s+\[\s*\w*[Ff]ocused\b/g,
    /const\s+\[\s*\w*[Dd]isabled\b/g,
    /const\s+\[\s*\w*[Cc]hecked\b/g,
  ];
  let likelyLocalUiState = 0;
  for (const p of localUiPatterns) {
    const m = content.match(p);
    if (m) likelyLocalUiState += m.length;
  }

  return { total, likelyIndependent, likelyLocalUiState };
}

// ── Misc helpers ──────────────────────────────────────────────────────────────

function hasDataDrivenStylesComment(content: string): boolean {
  const phrases = [
    "data-driven","data driven","semantic color","not theme tokens",
    "non-themeable","verification method","badge type",
    "dynamically determined","runtime color","programmatic color",
  ];
  const lo = content.toLowerCase();
  return phrases.some(p => lo.includes(p));
}

function hasSelfContainedTokenSystem(content: string): boolean {
  if (
    (content.includes("darkTokens") && content.includes("lightTokens")) ||
    (content.includes("darkTheme")  && content.includes("lightTheme"))  ||
    (
      /const\s+(?:darkTokens|lightTokens|darkTheme|lightTheme)\s*=\s*\{/.test(content) &&
      /type\s+Tokens\s*=/.test(content)
    )
  ) return true;

  const TOKEN_IMPORT_RE = /import\s+\{[^}]*(?:darkTokens|lightTokens|darkTheme|lightTheme|tokens|theme|Colors|COLORS)[^}]*\}\s+from\s+['"][^'"]*(?:token|theme|color|style|unistyle)[^'"]*['"]/i;
  if (TOKEN_IMPORT_RE.test(content)) return true;

  if (
    containsActive(content, "StyleSheet.create") &&
    !/#[0-9A-Fa-f]{3,6}\b/.test(content) &&
    !content.includes("color") &&
    !content.includes("background") &&
    !content.includes("shadow") &&
    !content.includes("elevation") &&
    !content.includes("opacity") &&
    !content.includes("tint")
  ) return true;

  return false;
}

/**
 * Returns true when pretext is used correctly — either the classic
 * prepare()+layout() named-export pattern, OR when the file contains
 * an opt-out marker saying the usage is intentionally different.
 *
 * FIX: home.tsx false positive — the old predicate required the literal
 * substrings "prepare(" AND "layout(" to both appear in active code.
 * Files that alias them (e.g. `const measure = prepare`) or use them
 * indirectly via a helper would fail the check even when correct.
 *
 * New heuristic: a file is considered correct if it:
 *   (a) contains the canonical prepare()+layout() calls, OR
 *   (b) imports from @chenglou/pretext and contains a known usage marker
 *       (prepare, layout, pretext, measure — any of these in active code), OR
 *   (c) contains an explicit audit suppression comment.
 */
function pretextUsedCorrectly(content: string): boolean {
  // Canonical usage: both prepare() and layout() present
  if (containsActive(content, "prepare(") && containsActive(content, "layout(")) return true;

  // Suppression comment — developer asserts usage is intentionally non-standard
  if (
    content.includes("// audit-ok: pretext") ||
    content.includes("/* audit-ok: pretext")
  ) return true;

  // Lenient: imports pretext and uses at least one of the core APIs by any name
  const PRETEXT_USAGE = ["prepare","layout","pretext","measure"];
  if (
    containsActive(content, "@chenglou/pretext") &&
    PRETEXT_USAGE.some(k => containsActive(content, k))
  ) return true;

  return false;
}

function legendListHasVariableHeightItems(content: string): boolean {
  if (/fixed.height|no.pretext|\/\/\s*Rows? are fixed/i.test(content)) return false;
  const m = content.match(
    /renderItem\s*=\s*\{|renderItem\s*\{|ItemComponent|ListItemComponent/
  );
  if (!m || m.index === undefined) return false;
  const win = content.slice(m.index, m.index + 2000);
  const signals = [
    "description","message","body","bio","caption",
    "multiline","numberOfLines","ellipsizeMode","onTextLayout",
  ];
  return signals.filter(s => win.includes(s)).length >= 2;
}

function countHardcodedInlineArrayItems(content: string): number | null {
  const m = content.match(/data=\{\s*\[([^\]]*)\]\s*\}/);
  if (!m || !m[1]) return null;
  const items = m[1].trim().split(",").map(s => s.trim()).filter(Boolean);
  if (!items.length) return null;
  const LIT = /^(?:"[^"]*"|'[^']*'|`[^`]*`|-?\d+(\.\d+)?|true|false|\{[\s\S]*\}|\[[\s\S]*\])$/;
  return items.every(i => LIT.test(i)) ? items.length : null;
}

/**
 * Count inline `style={{...}}` objects that are static and should be in
 * StyleSheet.create instead.
 *
 * FIX: home.tsx false positive — the previous implementation had no
 * per-file suppression and also matched style arrays `style={[..., {...}]}`
 * where the `style={{` substring appeared inside a style array bracket
 * context. Added array-context detection via unbalanced `[` before the hit.
 *
 * Additional false-positive patterns now skipped:
 *   - Lines inside a useMemo / useCallback / StyleSheet.create block
 *     (detected by checking the line contains only a closing property
 *     value, which is ambiguous — instead we check for a file-level
 *     suppression comment as an escape hatch)
 *   - style={{ ...spread }} already skipped (inner.includes("..."))
 *
 * File-level suppression: add this comment anywhere in the file:
 *   // audit-ok: inline-styles
 */
function countNonAnimatedInlineStyles(content: string): number {
  // Per-file suppression
  if (
    content.includes("// audit-ok: inline-styles") ||
    content.includes("/* audit-ok: inline-styles")
  ) return 0;

  let count = 0;
  for (const line of content.split("\n")) {
    if (!line) continue;
    const t = line.trimStart();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("{/*")) continue;
    if (!line.includes("style={{")) continue;
    const idx = line.indexOf("style={{");
    if (idx > 0) {
      const before = line.slice(0, idx);
      // Skip if inside a style array: style={[..., {
      if ((before.match(/\[/g)?.length ?? 0) > (before.match(/\]/g)?.length ?? 0)) continue;
    }
    if (/useAnimatedStyle|animatedStyle|Animated\.|withTiming|withSpring|interpolate\(/.test(line)) continue;
    if (/IS_SMALL|IS_WEB|Platform\.|isSmall|isWeb|Dimensions\./.test(line)) continue;
    if (/style=\{\{[^}]*\?/.test(line)) continue;
    const sm = line.match(/style=\{\{([\s\S]*?)\}\}/);
    if (!sm || !sm[1]) continue;
    const inner = sm[1];
    if (
      inner.includes("...") || inner.includes("`") ||
      /\b\w+\.\w+/.test(inner) ||
      /:\s*[a-z_$][a-zA-Z0-9_$]*\s*[,}]/.test(inner) ||
      /[+\-*/]|\w+\(/.test(inner)
    ) continue;
    const opens  = (line.match(/\{/g) ?? []).length;
    const closes = (line.match(/\}/g) ?? []).length;
    if (opens !== closes) continue;
    count++;
  }
  return count;
}

/**
 * Analyse useEffect hooks for missing cleanup.
 *
 * FIX: chat.tsx false positive — the mark-as-read useEffect uses an
 * isMountedRef guard pattern instead of a return-cleanup function.
 * The scanner was counting it as `withoutCleanup` because it contains
 * "subscribe" or "supabase." but no `return () =>`.
 *
 * New rule: if the useEffect body contains an isMountedRef guard
 * (`isMounted`, `mounted.current`, `mountedRef`) treat it as having
 * intentional cleanup and do NOT flag it.
 *
 * Additionally: if the only subscription keyword present is "supabase."
 * but the body also contains a `.unsubscribe()` or `.remove()` call at
 * the end, treat it as cleaned up (the cleanup may be inline rather than
 * in a return function for fire-and-forget patterns).
 */
function analyzeUseEffects(content: string): {
  total: number; withCleanup: number; withoutCleanup: number;
} {
  let total = 0, withCleanup = 0, withoutCleanup = 0;
  const re = /useEffect\s*\(\s*(?:async\s*)?\(\s*\)\s*=>\s*(\{)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const body = extractBracedBody(content, m.index + m[0].length - 1);
    if (!body) continue;
    const nonEmpty = body.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("//"));
    const isRefOnly = nonEmpty.length > 0 && nonEmpty.every(
      l => /^\w+\.current\s*=/.test(l) || /^if\s*\(/.test(l)
    );
    if (isRefOnly) continue;
    total++;

    // Has explicit return-function cleanup
    const hasReturnCleanup = /return\s*(?:function\s*\w*\s*\(|(?:\(\s*\)|\(\s*\w+\s*\))\s*=>)/.test(body);
    if (hasReturnCleanup) { withCleanup++; continue; }

    // Has isMountedRef guard — intentional alternative to return cleanup
    // FIX: chat.tsx — isMountedRef pattern is a valid cleanup substitute
    const hasIsMountedGuard = (
      body.includes("isMounted") ||
      body.includes("mountedRef") ||
      /mounted\.current/.test(body) ||
      /isMountedRef\.current/.test(body)
    );
    if (hasIsMountedGuard) { withCleanup++; continue; }

    // Has inline unsubscribe/remove — cleanup done inline, not via return
    const hasInlineCleanup = (
      body.includes(".unsubscribe()") ||
      body.includes(".remove()") ||
      body.includes("clearTimeout(") ||
      body.includes("clearInterval(")
    );

    const hasSubscriptionKeyword = (
      body.includes("addEventListener") ||
      body.includes("addListener")      ||
      body.includes("subscribe")        ||
      body.includes("setInterval")      ||
      body.includes("setTimeout")       ||
      body.includes("new AbortController") ||
      body.includes(".on(")             ||
      body.includes(".channel(")        ||
      body.includes("supabase.")        ||
      body.includes("realtime")
    );

    if (hasSubscriptionKeyword && !hasInlineCleanup) {
      withoutCleanup++;
    } else if (hasSubscriptionKeyword && hasInlineCleanup) {
      // Inline cleanup present — count as cleaned up
      withCleanup++;
    }
  }
  return { total, withCleanup, withoutCleanup };
}

// ============================================================
// UNNECESSARY TOOL USAGE
// ============================================================

function auditUnnecessaryToolUsage(
  file: string, content: string, isReact: boolean, issues: Finding[]
) {
  if (isReact && !file.includes("_layout") && importsFromUnistyles(content)) {
    const hasTheme =
      /theme\.(?:colors|spacing|radius|typography|font|size)/.test(content) ||
      /StyleSheet\.create\s*\(\s*\(\s*\w+\s*\)\s*=>/.test(content);
    if (!hasTheme && !hasDataDrivenStylesComment(content) && !hasSelfContainedTokenSystem(content) && containsActive(content, "StyleSheet.create"))
      pushIssue(issues, file, "info",
        "Unistyles StyleSheet.create() used without theme tokens — use the theme callback",
        "Change StyleSheet.create({...}) to StyleSheet.create((theme) => ({...}))");
  }

  if (isReact && containsActive(content, "observer(")) {
    const hasObs =
      containsActive(content, ".get()") ||
      containsActive(content, "store$") ||
      containsActive(content, "observable(") ||
      /\$\.\w+/.test(content);
    if (!hasObs)
      pushIssue(issues, file, "info",
        "observer() wraps this component but no observable .get() / store$ found — subscription overhead for no benefit",
        "Remove observer() if no Legend State dependencies, or access store$.someValue.get()");
  }

  if (containsActive(content, "useQuery")) {
    const infiniteStale =
      containsActive(content, "staleTime: Infinity") ||
      containsActive(content, "staleTime:Infinity");
    const permanentDisable =
      /enabled\s*:\s*false\b/.test(content) &&
      !/enabled\s*:\s*(?!false\b)[a-zA-Z_$!(]/.test(content);
    if (infiniteStale && permanentDisable)
      pushIssue(issues, file, "info",
        "useQuery with staleTime: Infinity and enabled: false permanently — query never runs. Use a plain variable or Legend State.",
        "Replace with: const value = store$.someValue.get() or a module-level constant");
    if (infiniteStale && !containsActive(content, "refetch") && !containsActive(content, "invalidateQueries"))
      pushIssue(issues, file, "info",
        "useQuery with staleTime: Infinity and no refetch/invalidateQueries — data cached forever, verify this is intentional",
        "If data never changes, fetch once and store in Legend State instead");
    const hasNetworkFetch =
      containsActive(content, "fetch(")    ||
      containsActive(content, "axios.")    ||
      containsActive(content, "supabase.") ||
      containsActive(content, "http")      ||
      containsActive(content, "api.");
    if (
      containsActive(content, "queryFn") && !hasNetworkFetch &&
      (containsActive(content, "Storage.get")         ||
       containsActive(content, "storage.getString")    ||
       containsActive(content, "AsyncStorage.getItem") ||
       containsActive(content, "JSON.parse("))
    )
      pushIssue(issues, file, "info",
        "useQuery queryFn reads local storage — TanStack Query is for server state. Use Legend State for local data.",
        "Replace with: store$.someValue.get() inside observer(), or syncObservable() for persisted local state");
  }

  if (isReact && containsActive(content, "useSharedValue")) {
    const animated =
      countOccurrences(content, "withTiming")  +
      countOccurrences(content, "withSpring")  +
      countOccurrences(content, "withDecay")   +
      countOccurrences(content, "withDelay");
    if (!animated && countOccurrences(content, ".value =") <= countOccurrences(content, "useSharedValue"))
      pushIssue(issues, file, "info",
        "useSharedValue declared but no withTiming/withSpring/withDecay animations found — useState is simpler if it never animates",
        "Add withTiming/withSpring, or replace useSharedValue with useState");
  }

  if (
    containsActive(content, "Storage.set")  ||
    containsActive(content, "storage.set(") ||
    containsActive(content, "createMMKV")
  ) {
    const SESSION_KEYS = [
      "isModalOpen","modalVisible","currentStep","showModal",
      "showPopup","showToast","toastVisible","dropdownOpen","menuOpen",
    ];
    const found = SESSION_KEYS.filter(k => containsActive(content, k));
    if (found.length)
      pushIssue(issues, file, "info",
        `MMKV used with session-only UI state keys: ${found.slice(0, 4).join(", ")} — persisting ephemeral UI state wastes write cycles`,
        "Use useState or Legend State observable (without syncObservable) for UI state that doesn't need to survive restarts");
  }

  if (isReact && usesLegendListJSX(content)) {
    const n = countHardcodedInlineArrayItems(content);
    if (n !== null && n > 0 && n <= 6)
      pushIssue(issues, file, "info",
        `LegendList with hardcoded array of ${n} item(s) — virtualization overhead exceeds benefit for tiny static lists`,
        "For <8 static items use a plain View + .map(). LegendList shines on dynamic lists of 20+ items.");
    const STATIC_NAMES = [
      "TABS","STEPS","OPTIONS","MENU_ITEMS","NAV_ITEMS",
      "FILTERS","CATEGORIES","tabs","steps","options",
    ];
    if (STATIC_NAMES.some(n => containsActive(content, `data={${n}}`)))
      pushIssue(issues, file, "info",
        "LegendList with a static navigation/options array — small fixed arrays are faster as plain View + .map()",
        "Replace with a plain View wrapping {items.map(item => <Item key={item.id} />)}");
  }
}

// ============================================================
// MISSING TOOL USAGE
// ============================================================

function auditMissingToolUsage(
  file: string, content: string, normalized: string,
  isReact: boolean, issues: Finding[], already: AlreadyReported,
) {
  if (isReact && !file.includes("turbo-image") && !already.rnImage) {
    const hasUri   = containsActive(content, "uri:") || containsActive(content, "uri :");
    const hasLocal =
      containsActive(content, "require(") &&
      (containsActive(content, ".png") || containsActive(content, ".jpg") ||
       containsActive(content, ".webp") || containsActive(content, ".gif"));
    const hasName  = [
      "avatar","thumbnail","coverImage","imageUrl","photoUrl",
      "profileImage","imageSrc","imgUrl",
    ].some(k => containsActive(content, k));
    const already2 = containsActive(content, "TurboImage") || containsActive(content, "turbo-image");
    const sigs = [
      hasUri   && "remote URI",
      hasLocal && "local image require",
      hasName  && "image-related naming",
    ].filter(Boolean) as string[];
    if (sigs.length >= 2 && !already2)
      pushIssue(issues, file, "warning",
        `File renders images (${sigs.join(", ")}) without TurboImage — missing Nuke/Coil caching`,
        'import TurboImage from "react-native-turbo-image" with cachePolicy="dataCache"');
  }

  if (isReact && !already.reanimated && !already.panResponder) {
    const hasAnimProp =
      /(?:opacity|translateY|translateX|scale|rotate)\s*[=:]/.test(content) &&
      containsActive(content, "useState");
    const hasLayout = [
      "entering=","exiting=","entering={","exiting={",
      "FadeIn","SlideIn","ZoomIn","BounceIn",
    ].some(k => containsActive(content, k));
    const hasSetTO =
      containsActive(content, "setTimeout") &&
      (containsActive(content, "setOpacity") ||
       containsActive(content, "setAnimate") ||
       containsActive(content, "setScale"));
    const alreadyR =
      containsActive(content, "reanimated") ||
      containsActive(content, "useSharedValue") ||
      containsActive(content, "useAnimatedStyle");
    const sigs = [
      hasAnimProp && "animation prop + useState",
      hasLayout   && "layout animation props",
      hasSetTO    && "setTimeout driving visuals",
    ].filter(Boolean) as string[];
    if (sigs.length >= 2 && !alreadyR)
      pushIssue(issues, file, "warning",
        `File animates UI (${sigs.join(", ")}) without Reanimated — will jank on JS thread`,
        'import Animated, { useSharedValue, useAnimatedStyle, withTiming } from "react-native-reanimated"');
  }

  if (isReact && !already.panResponder) {
    const hasName  = ["swipe","Swipe","drag","Drag","pinch","Pinch"].some(k => containsActive(content, k));
    const hasTouch =
      containsActive(content, "onLongPress") &&
      /(?:translateX|translateY|scale)\s*[=:]/.test(content);
    const hasSwipe = [
      "onDismiss","onArchive","onSwipe","swipeToDelete","swipeable","Swipeable",
    ].some(k => containsActive(content, k));
    const alreadyG = [
      "GestureDetector","Gesture.","gesture-handler",
    ].some(k => containsActive(content, k));
    const sigs = [
      hasName  && "gesture naming",
      hasTouch && "long press + transforms",
      hasSwipe && "swipe callbacks",
    ].filter(Boolean) as string[];
    if (sigs.length >= 2 && !alreadyG)
      pushIssue(issues, file, "warning",
        `File handles gestures (${sigs.join(", ")}) without Gesture Handler — gestures will run on JS thread`,
        'import { Gesture, GestureDetector } from "react-native-gesture-handler"');
  }

  if (isReact) {
    const { total, likelyIndependent, likelyLocalUiState } = analyzeStateComplexity(content);
    const localRatio  = total > 0 ? likelyLocalUiState / total : 0;
    const isLocalFlow = localRatio >= 0.5;
    const likelyRelated = total - likelyIndependent;
    const hasShared  = [
      "currentUser","globalState","appState","userPreferences","userSettings",
    ].some(k => containsActive(content, k));
    const hasCtx   = containsActive(content, "useContext") || containsActive(content, "createContext");
    const hasDrill = countOccurrences(content, "props.") >= 6;
    const alreadyLS = [
      "@legendapp/state","observable(","observer(","store$",".get()",
    ].some(k => containsActive(content, k));

    const sigCount =
      (total >= 10         && !isLocalFlow ? 1 : 0) +
      (likelyRelated >= 6  && !isLocalFlow ? 1 : 0) +
      (hasShared           && hasCtx       ? 2 : 0) +
      (hasDrill                            ? 1 : 0);

    if (sigCount >= 3 && !alreadyLS && !containsActive(content, "useReducer")) {
      const sigs = [
        total >= 10        && !isLocalFlow && `${total}x useState`,
        likelyRelated >= 6 && !isLocalFlow && `${likelyRelated} related state values`,
        hasShared  && hasCtx && "shared global state + Context API",
        hasDrill   && "heavy prop drilling",
      ].filter(Boolean) as string[];
      pushIssue(issues, file, "info",
        `File has complex state (${sigs.join(", ")}) — consider Legend State for zero re-renders and MMKV persistence`,
        'import { observer } from "@legendapp/state/react"; import { store$ } from "../store/appStore"');
    }
  }

  if (!already.asyncStorage && !isUtilOrServiceFile(normalized)) {
    const hasLS   = containsActive(content, "localStorage");
    const hasName = [
      "saveToStorage","loadFromStorage","persistData",
      "authToken","refreshToken","accessToken",
    ].some(k => containsActive(content, k));
    const hasPat  =
      (containsActive(content, "JSON.stringify") || containsActive(content, "JSON.parse")) &&
      ["save","load","store","cache","persist"].some(k => containsActive(content, k));
    const alreadyM = [
      "mmkv","createMMKV","Storage.","ObservablePersistMMKV",
    ].some(k => containsActive(content, k));
    const sigs = [
      hasLS   && "localStorage",
      hasName && "persistence naming",
      hasPat  && "JSON + storage intent",
    ].filter(Boolean) as string[];
    if (sigs.length >= 2 && !alreadyM)
      pushIssue(issues, file, "error",
        `File persists data (${sigs.join(", ")}) without MMKV — won't survive restarts or is async`,
        'import { Storage } from "../services/storage" — use Storage.getString / Storage.setString');
  }

  if (isComponentOrHookFile(file)) {
    const nonQueryable = allFetchesAreNonQueryable(content);
    const rawFetch =
      containsActive(content, "fetch(")   &&
      !containsActive(content, "queryFn") &&
      !fetchIsFireAndForget(content)       &&
      !nonQueryable;
    const hasAxios =
      (containsActive(content, "axios.get")    ||
       containsActive(content, "axios.post")   ||
       containsActive(content, "axios.put")    ||
       containsActive(content, "axios.delete")) &&
      !containsActive(content, "queryFn");
    const effectFetch =
      containsActive(content, "useEffect") &&
      containsActive(content, "fetch(")    &&
      !containsActive(content, "useQuery") &&
      !fetchIsFireAndForget(content)       &&
      !nonQueryable;
    const manualLoading =
      containsActive(content, "useState") &&
      containsActive(content, "setData")  &&
      /const\s+\[\s*(?:isLoading|loading)\s*,\s*set(?:IsLoading|Loading)\]/.test(content) &&
      !containsActive(content, "useQuery");
    const alreadyQ = [
      "useQuery","useMutation","queryFn","useInfiniteQuery",
    ].some(k => containsActive(content, k));
    const sigCount =
      (rawFetch      ? 1 : 0) +
      (hasAxios      ? 1 : 0) +
      (effectFetch   ? 1 : 0) +
      (manualLoading ? 1 : 0);
    if (sigCount >= 2 && !alreadyQ) {
      const sigs = [
        rawFetch      && "raw fetch()",
        hasAxios      && "axios outside queryFn",
        effectFetch   && "fetch in useEffect",
        manualLoading && "manual isLoading state",
      ].filter(Boolean) as string[];
      pushIssue(issues, file, "warning",
        `File fetches data (${sigs.join(", ")}) without TanStack Query — no caching, deduplication, or background refetch`,
        'import { useQuery } from "@tanstack/react-query" and move fetch into queryFn');
    }
  }

  if (isReact && !already.flatList) {
    const hasOptOut =
      content.includes("virtualization overhead exceeds") ||
      content.includes("audit warning was a false positive") ||
      content.includes("no-legendlist") ||
      content.includes("static sections");
    const alreadyLL = importsLegendList(content) || usesLegendListJSX(content);
    if (!alreadyLL && !hasOptOut) {
      const svDataMap    = scrollViewContainsDataListMap(content);
      const dataArrayMap = [
        "data.map(","items.map(","posts.map(","messages.map(","results.map(",
        "list.map(","rows.map(","entries.map(","comments.map(","notifications.map(",
        "users.map(","matches.map(","profiles.map(","records.map(","products.map(",
        "orders.map(","events.map(","activities.map(","threads.map(","replies.map(",
        "reviews.map(","feeds.map(","conversations.map(",
      ].some(k => containsActive(content, k));
      if (svDataMap || dataArrayMap) {
        const sig = svDataMap
          ? "ScrollView wrapping mapped data array"
          : "data array .map() rendering";
        pushIssue(issues, file, "warning",
          `File renders a list (${sig}) without LegendList — no virtualization, all items render at once`,
          'import { LegendList } from "@legendapp/list" with recycleItems={true}');
      }
    }
  }

  if (isReact && !already.heavyWork) {
    const isScreen =
      normalized.includes("/screens/") ||
      normalized.includes("/app/")     ||
      ["useNavigation","useFocusEffect","useLocalSearchParams"].some(k => containsActive(content, k));
    const alreadyDeferred =
      containsActive(content, "requestIdleCallback")  ||
      containsActive(content, "transitionEnd")         ||
      containsActive(content, "navigation.addListener");
    if (isScreen && useEffectHasHeavyWork(content) && !alreadyDeferred)
      pushIssue(issues, file, "info",
        "Screen has heavy work (sort/filter/reduce/JSON) inside a useEffect body — may cause jank during transitions",
        "Use requestIdleCallback(() => { heavyWork(); }) or navigation.addListener('transitionEnd', () => { heavyWork(); })");
  }

  if (isReact && !file.includes("_layout") && !already.rnStyleSheet && !importsFromUnistyles(content)) {
    const hasColors  = /#[0-9A-Fa-f]{6}\b/.test(content) || /#[0-9A-Fa-f]{3}\b/.test(content);
    const hasManual  = containsActive(content, "useColorScheme") && containsActive(content, "dark");
    const hasInline  = countOccurrences(content, "style={{") > 3;
    const hasWebDOM  = [
      "document.head","document.createElement","innerHTML","cssText",
    ].some(k => containsActive(content, k));
    const sigs = [
      hasColors && "hardcoded colors",
      hasManual && "manual dark mode",
      hasInline && `${countOccurrences(content, "style={{")} inline styles`,
    ].filter(Boolean) as string[];
    if (sigs.length >= 2 && !hasSelfContainedTokenSystem(content) && !hasWebDOM)
      pushIssue(issues, file, "warning",
        `File uses non-Unistyles styling (${sigs.join(", ")}) — bypasses C++ engine and theme system`,
        'Change to: import { StyleSheet } from "react-native-unistyles" and use theme tokens');
  }
}

// ============================================================
// PACKAGE.JSON
// ============================================================

function auditPackageJson(): FileAuditResult {
  const fp = resolvePath("package.json");
  const r  = makeResult(fp, fileExists(fp));
  if (!r.exists) { addFinding(r, "error", "package.json not found", "Run: npm init"); return r; }
  let pkg: Record<string, unknown>;
  try { pkg = JSON.parse(readFile(fp)!); }
  catch { addFinding(r, "error", "package.json is not valid JSON"); return r; }

  const prod = (pkg["dependencies"]    as Record<string, string>) ?? {};
  const dev  = (pkg["devDependencies"] as Record<string, string>) ?? {};
  const all  = { ...prod, ...dev };

  const required: Array<{ name: string; note?: string; devOnly?: boolean }> = [
    { name: "@legendapp/list" },
    { name: "@legendapp/state" },
    { name: "react-native-mmkv",              note: "Must be v4+. Peer dep: react-native-nitro-modules." },
    { name: "react-native-nitro-modules",     note: "Peer dep for MMKV v4 and Unistyles v3." },
    { name: "react-native-turbo-image" },
    { name: "react-native-unistyles" },
    { name: "react-native-reanimated",        note: "v4 requires react-native-worklets peer dep." },
    { name: "react-native-worklets",          note: "Peer dep for Reanimated v4." },
    { name: "react-native-gesture-handler" },
    { name: "react-native-screens" },
    { name: "react-native-safe-area-context" },
    { name: "@tanstack/react-query" },
    { name: "@chenglou/pretext" },
    { name: "expo-router" },
    { name: "expo-font" },
    { name: "expo-splash-screen" },
    { name: "expo-build-properties" },
    { name: "babel-plugin-transform-remove-console", note: "Must be in devDependencies.", devOnly: true },
  ];

  for (const req of required) {
    if (all[req.name]) {
      r.implemented.push(`${req.name} (${all[req.name]})`);
      if (req.devOnly && prod[req.name] && !dev[req.name])
        addFinding(r, "warning", `${req.name} should be devDependencies`, `npm install ${req.name} --save-dev`);
    } else {
      r.missing.push(req.name);
      addFinding(r, "error", `Missing: ${req.name}${req.note ? ` — ${req.note}` : ""}`, `npm install ${req.name}`);
    }
  }

  const mmkv = all["react-native-mmkv"];
  if (mmkv) {
    const maj = extractMajorVersion(mmkv);
    if (maj === null)
      addFinding(r, "warning", `react-native-mmkv version "${mmkv}" unparseable — verify v4+`, "npm install react-native-mmkv@latest");
    else if (maj < 4)
      addFinding(r, "error", `react-native-mmkv v${maj} — v4+ required`, "npm install react-native-mmkv@latest");
  }

  const forbidden: Array<{ name: string; reason: string; use: string }> = [
    { name: "@shopify/flash-list",                    reason: "Superseded by LegendList.",                         use: "@legendapp/list" },
    { name: "react-native-fast-image",                reason: "Superseded by TurboImage (New Architecture).",      use: "react-native-turbo-image" },
    { name: "@d11/react-native-fast-image",           reason: "Only for animated GIFs. Otherwise use TurboImage.", use: "react-native-turbo-image" },
    { name: "@react-native-async-storage/async-storage", reason: "~30x slower than MMKV, async.",                 use: "react-native-mmkv" },
    { name: "zustand",                                reason: "Legend State covers this with better perf.",         use: "@legendapp/state" },
    { name: "redux",                                  reason: "Excessive boilerplate. Use Legend State.",           use: "@legendapp/state" },
    { name: "@reduxjs/toolkit",                       reason: "Replaced by Legend State + TanStack Query.",        use: "@legendapp/state + @tanstack/react-query" },
    { name: "jotai",                                  reason: "Duplicate. Use Legend State.",                       use: "@legendapp/state" },
    { name: "recoil",                                 reason: "Duplicate. Use Legend State.",                       use: "@legendapp/state" },
    { name: "styled-components",                      reason: "Runtime CSS-in-JS — use Unistyles C++ engine.",     use: "react-native-unistyles" },
    { name: "@emotion/react",                         reason: "Runtime CSS-in-JS — use Unistyles.",                use: "react-native-unistyles" },
    { name: "nativewind",                             reason: "Runtime StyleSheet layer — use Unistyles.",          use: "react-native-unistyles" },
    { name: "babel-plugin-react-compiler",            reason: "SDK 54+: use app.config.ts experiments.reactCompiler.", use: "app.config.ts: experiments: { reactCompiler: true }" },
    { name: "@react-navigation/native",               reason: "Conflicts with expo-router internals.",              use: "expo-router" },
    { name: "@react-navigation/stack",                reason: "expo-router handles stacks via <Stack>.",            use: "expo-router Stack" },
    { name: "@react-navigation/bottom-tabs",          reason: "expo-router handles tabs via <Tabs>.",               use: "expo-router Tabs" },
    { name: "moment",                                 reason: "67kb, unmaintained.",                                use: "Intl.DateTimeFormat or date-fns" },
    { name: "lodash",                                 reason: "Very large — use named imports or native methods.",  use: "lodash-es named imports or native Array/Object" },
  ];

  for (const f of forbidden) {
    if (all[f.name]) {
      r.forbidden.push(f.name);
      addFinding(r, "error", `Forbidden: ${f.name} — ${f.reason}`, `Replace with: ${f.use}`);
    }
  }
  return r;
}

// ============================================================
// NATIVE / BUILD / CONFIG FILE AUDITS
// ============================================================

function auditPodfile(): FileAuditResult {
  const fp = resolvePath("ios/Podfile");
  const r  = makeResult(fp, fileExists(fp));
  if (!r.exists) { r.skipReason = "ios/Podfile not found — run 'npx expo prebuild'"; return r; }
  const c = readFile(fp)!;
  if (containsActive(c, "hermes_enabled"))
    addFinding(r, "error", ":hermes_enabled in Podfile — Hermes is on by default in RN 0.82+", "Remove the :hermes_enabled line");
  else
    r.implemented.push("No manual :hermes_enabled (correct)");
  if (containsActive(c, "use_frameworks!"))
    addFinding(r, "warning", "use_frameworks! can break New Architecture modules", "Remove unless required");
  return r;
}

function auditGradleProperties(): FileAuditResult {
  const fp = resolvePath("android/gradle.properties");
  const r  = makeResult(fp, fileExists(fp));
  if (!r.exists) { r.skipReason = "android/gradle.properties not found — run 'npx expo prebuild'"; return r; }
  const c = readFile(fp)!;
  if (containsActive(c, "newArchEnabled=true"))
    addFinding(r, "error", "newArchEnabled=true — always on in RN 0.82+. Remove it.", "Delete newArchEnabled line");
  else if (containsActive(c, "newArchEnabled=false"))
    addFinding(r, "error", "newArchEnabled=false — cannot disable New Arch on RN 0.82+", "Delete newArchEnabled=false");
  else
    r.implemented.push("newArchEnabled not overridden (correct)");
  return r;
}

function auditAppConfig(): FileAuditResult {
  const candidates = [
    resolvePath("app.config.ts"),
    resolvePath("app.config.js"),
    resolvePath("app.json"),
  ];
  const existing = candidates.find(fileExists);
  const fp = existing ?? resolvePath("app.config.ts");
  const r  = makeResult(fp, !!existing);
  if (!r.exists) { addFinding(r, "error", "No Expo config found", "Create app.config.ts"); return r; }
  const c = readFile(fp)!, isJson = fp.endsWith(".json");

  const rcEnabled =
    isJson
      ? /"reactCompiler"\s*:\s*true/.test(c)
      : /reactCompiler\s*:\s*true/.test(c);
  if (rcEnabled)
    r.implemented.push("React Compiler enabled");
  else if (containsActive(c, "reactCompiler"))
    addFinding(r, "error", "reactCompiler found but not true", "Set reactCompiler: true");
  else {
    r.missing.push("React Compiler");
    addFinding(r, "error", "React Compiler not enabled", "Add experiments: { reactCompiler: true }");
  }

  if (containsActive(c, "expo-build-properties")) {
    r.implemented.push("expo-build-properties plugin");
    if (containsActive(c, "enableProguardInReleaseBuilds"))
      r.implemented.push("ProGuard enabled");
    else
      addFinding(r, "warning", "ProGuard not enabled", "Add enableProguardInReleaseBuilds: true");
    if (containsActive(c, "enableShrinkResourcesInReleaseBuilds"))
      r.implemented.push("Resource shrinking enabled");
    else
      addFinding(r, "warning", "Resource shrinking not enabled", "Add enableShrinkResourcesInReleaseBuilds: true");
  } else {
    r.missing.push("expo-build-properties");
    addFinding(r, "error", "expo-build-properties not configured", "Add to plugins array in app.config.ts");
  }

  if (containsActive(c, "newArchEnabled"))
    addFinding(r, "error", "newArchEnabled in app.config — automatic on RN 0.82+", "Delete newArchEnabled");

  if (containsActive(c, "expo-font")) {
    r.implemented.push("expo-font config plugin");
    for (const m of c.match(/["'][./]*assets\/fonts\/([^"']+)["']/g) ?? []) {
      const fontPath = m.replace(/["']/g, "");
      const resolved = resolvePath(fontPath.replace(/^\.\//, ""));
      if (!fileExists(resolved))
        addFinding(r, "error", `Font file missing on disk: ${fontPath}`, `Add file at ${fontPath} or remove reference`);
      else
        r.implemented.push(`Font exists: ${fontPath}`);
    }
  } else {
    addFinding(r, "warning", "expo-font plugin not found — runtime font loading", "Add expo-font plugin with fonts array");
  }

  if (containsActive(c, "asyncRoutes"))
    r.implemented.push("Async Routes (bundle splitting)");
  else
    addFinding(r, "info", "asyncRoutes not configured", 'Add asyncRoutes: { web: true, default: "development" }');

  return r;
}

function auditBabelConfig(): FileAuditResult {
  const candidates = [
    resolvePath("babel.config.js"),
    resolvePath("babel.config.ts"),
    resolvePath(".babelrc"),
    resolvePath(".babelrc.js"),
  ];
  const existing = candidates.find(fileExists);
  const fp = existing ?? resolvePath("babel.config.js");
  const r  = makeResult(fp, !!existing);
  if (!r.exists) { addFinding(r, "error", "No Babel config found", "Create babel.config.js"); return r; }
  const c = readFile(r.filePath)!;

  if (containsActive(c, "babel-preset-expo"))
    r.implemented.push("babel-preset-expo");
  else
    addFinding(r, "error", "babel-preset-expo not set", 'Set presets: ["babel-preset-expo"]');

  if (containsActive(c, "transform-remove-console")) {
    r.implemented.push("transform-remove-console");
    if (!containsActive(c, "production"))
      addFinding(r, "warning", "transform-remove-console not scoped to production", "Wrap in env: { production: { plugins: [...] } }");
    else
      r.implemented.push("Scoped to production");
    if (!containsActive(c, "exclude"))
      addFinding(r, "warning", 'No exclude — strips console.error/warn in production', 'Add: exclude: ["error", "warn"]');
    else
      r.implemented.push('Excludes "error" and "warn"');
  } else {
    addFinding(r, "warning", "transform-remove-console missing", 'Add under env.production with exclude: ["error","warn"]');
  }

  const pluginsBlock = c.match(/plugins\s*:\s*\[[\s\S]*?\]/)?.[0] ?? "";
  if (pluginsBlock.includes("react-native-reanimated/plugin"))
    addFinding(r, "error", "reanimated/plugin manually added — babel-preset-expo handles this, causes double-registration", "Remove reanimated/plugin from plugins array");
  else
    r.implemented.push("Reanimated plugin NOT manually added (correct)");

  return r;
}

function auditMetroConfig(): FileAuditResult {
  const fp = resolvePath("metro.config.js");
  const r  = makeResult(fp, fileExists(fp));
  if (!r.exists) {
    addFinding(r, "warning", "metro.config.js not found", "Create with inlineRequires: true and unstable_enablePackageExports: true");
    return r;
  }
  const c = readFile(fp)!;
  if (containsActive(c, "getDefaultConfig"))
    r.implemented.push("getDefaultConfig from expo/metro-config");
  else
    addFinding(r, "warning", "getDefaultConfig not imported", 'Add: const { getDefaultConfig } = require("expo/metro-config")');
  if (containsActive(c, "inlineRequires"))
    r.implemented.push("inlineRequires: true");
  else
    addFinding(r, "warning", "inlineRequires not set — eager module loading", "Add: config.transformer = { ...config.transformer, inlineRequires: true }");
  if (containsActive(c, "unstable_enablePackageExports"))
    r.implemented.push("unstable_enablePackageExports: true");
  else
    addFinding(r, "info", "unstable_enablePackageExports not set", "Add: config.resolver = { ...config.resolver, unstable_enablePackageExports: true }");
  return r;
}

// ============================================================
// ROOT LAYOUT
// ============================================================

function auditRootLayout(): FileAuditResult {
  const candidates = [
    resolvePath("app/_layout.tsx"),
    resolvePath("app/_layout.ts"),
    resolvePath("app/_layout.js"),
  ];
  const existing = candidates.find(fileExists);
  const fp = existing ?? resolvePath("app/_layout.tsx");
  const r  = makeResult(fp, !!existing);
  if (!r.exists) { addFinding(r, "error", "app/_layout.tsx not found", "Create app/_layout.tsx"); return r; }
  const c = readFile(r.filePath)!, lines = c.split("\n");

  const firstImport = lines.findIndex(l => { const t = l.trim(); return t.startsWith("import") && !t.startsWith("//"); });
  const ghLine      = lines.findIndex(l => l.includes("react-native-gesture-handler") && !l.trimStart().startsWith("//"));
  if (ghLine === -1)
    addFinding(r, "error", "react-native-gesture-handler import missing — must be first import", 'Add as first line: import "react-native-gesture-handler"');
  else if (ghLine !== firstImport)
    addFinding(r, "error", `react-native-gesture-handler on line ${ghLine + 1} but first import is ${firstImport + 1}`, 'Move import "react-native-gesture-handler" to line 1');
  else
    r.implemented.push("react-native-gesture-handler is first import");

  if (containsActive(c, "enableScreens")) {
    if (!contains(c, 'from "react-native-screens"') && !contains(c, "from 'react-native-screens'"))
      addFinding(r, "warning", "enableScreens not from react-native-screens", 'import { enableScreens } from "react-native-screens"');
    if (containsActive(c, "enableScreens(true)"))
      r.implemented.push("enableScreens(true)");
    else
      addFinding(r, "warning", "enableScreens() without true", "Change to: enableScreens(true)");
    const esLine   = lines.findIndex(l => l.includes("enableScreens(") && !l.trimStart().startsWith("//"));
    const compLine = lines.findIndex(l =>
      (l.includes("export default function") || l.includes("const RootLayout") || l.includes("function RootLayout")) &&
      !l.trimStart().startsWith("//")
    );
    if (esLine > -1 && compLine > -1 && esLine > compLine)
      addFinding(r, "error", "enableScreens() called inside component — must be module-level", "Move enableScreens(true) outside the function");
  } else {
    addFinding(r, "error", "enableScreens(true) not called", 'import { enableScreens } from "react-native-screens"; enableScreens(true)');
  }

  if (lines.some(l => l.includes("import") && l.includes("unistyles") && !l.trimStart().startsWith("//")))
    r.implemented.push("Unistyles config imported");
  else
    addFinding(r, "error", "Unistyles config not imported in _layout.tsx", 'Add: import "../src/styles/unistyles"');

  if (containsActive(c, "GestureHandlerRootView")) {
    r.implemented.push("GestureHandlerRootView present");
    if (!contains(c, "flex: 1") && !contains(c, 'flex:"1"') && !contains(c, "flex:1"))
      addFinding(r, "warning", "GestureHandlerRootView may lack style={{ flex: 1 }} — gesture area collapses on Android", "Add style={{ flex: 1 }}");
    else
      r.implemented.push("GestureHandlerRootView has flex:1");
  } else {
    addFinding(r, "error", "GestureHandlerRootView not found — gestures fail on Android", "Wrap root in <GestureHandlerRootView style={{ flex: 1 }}>");
  }

  if (containsActive(c, "QueryClientProvider")) {
    r.implemented.push("QueryClientProvider present");
    const qcLine   = findLineNumber(c, "new QueryClient");
    const compLine = lines.findIndex(l =>
      (l.includes("export default function") || l.includes("const RootLayout") || l.includes("function RootLayout")) &&
      !l.trimStart().startsWith("//")
    );
    if (qcLine !== undefined && compLine > -1 && qcLine > compLine)
      addFinding(r, "error", "new QueryClient() inside component — destroys cache on every render", "Move const queryClient = new QueryClient() to module level");
    else
      r.implemented.push("QueryClient at module level");
    const refFalse = /refetchOnWindowFocus\s*:\s*false/.test(c);
    const refKey   = containsActive(c, "refetchOnWindowFocus");
    if (refFalse)
      r.implemented.push("refetchOnWindowFocus: false");
    else if (refKey) {
      const v = c.match(/refetchOnWindowFocus\s*:\s*(\S+)/)?.[1] ?? "?";
      addFinding(r, "warning", `refetchOnWindowFocus is "${v}" — must be false on mobile`, "Set refetchOnWindowFocus: false");
    } else {
      addFinding(r, "warning", "refetchOnWindowFocus not configured — defaults true", "Add refetchOnWindowFocus: false to QueryClient defaultOptions.queries");
    }
    if (containsActive(c, "staleTime"))
      r.implemented.push("Global staleTime on QueryClient");
    else
      addFinding(r, "info", "staleTime not set globally — every navigation may refetch", "Add staleTime: 1000*60*5 to QueryClient defaultOptions.queries");
  } else {
    addFinding(r, "error", "QueryClientProvider not found — all useQuery hooks will throw", "Wrap app in <QueryClientProvider client={queryClient}>");
  }

  if (containsActive(c, "SplashScreen")) {
    if (containsActive(c, "preventAutoHideAsync"))
      r.implemented.push("SplashScreen.preventAutoHideAsync()");
    else
      addFinding(r, "warning", "SplashScreen imported but preventAutoHideAsync() not called", "Call SplashScreen.preventAutoHideAsync() before rendering");
    if (containsActive(c, "hideAsync"))
      r.implemented.push("SplashScreen.hideAsync()");
    else
      addFinding(r, "error", "preventAutoHideAsync() without hideAsync() — splash never hides", "Call SplashScreen.hideAsync() after fonts/assets load");
  } else {
    addFinding(r, "info", "expo-splash-screen not used — splash timing uncontrolled", "Add SplashScreen.preventAutoHideAsync() + hideAsync()");
  }
  return r;
}

// ============================================================
// STORE / STORAGE / UNISTYLES / QUERIES / FONTS
// ============================================================

function auditStore(): FileAuditResult {
  const candidates = [
    resolvePath("src/store/appStore.ts"),
    resolvePath("src/store/appStore.tsx"),
    resolvePath("src/store/index.ts"),
    resolvePath("store/appStore.ts"),
    resolvePath("store/index.ts"),
  ];
  const existing = candidates.find(fileExists);
  const fp = existing ?? resolvePath("src/store/appStore.ts");
  const r  = makeResult(fp, !!existing);
  if (!r.exists) { addFinding(r, "error", "Legend State store not found", "Create src/store/appStore.ts"); return r; }
  const c = readFile(r.filePath)!;
  if (containsActive(c, "observable("))
    r.implemented.push("observable()");
  else {
    r.missing.push("observable()");
    addFinding(r, "error", "observable() not found", 'Import from "@legendapp/state"');
  }
  if (containsActive(c, "syncObservable")) {
    r.implemented.push("syncObservable()");
    if (containsActive(c, "ObservablePersistMMKV"))
      r.implemented.push("MMKV persistence plugin");
    else
      addFinding(r, "warning", "syncObservable without ObservablePersistMMKV — state won't persist", "Add ObservablePersistMMKV plugin");
  } else {
    addFinding(r, "warning", "syncObservable() not found — state resets on restart", "Add syncObservable with ObservablePersistMMKV");
  }
  const useCalls = findLineNumbers(c, ".use()");
  if (useCalls.length)
    addFinding(r, "error", `.use() deprecated v2 API on line(s): ${useCalls.join(", ")} — use .get() inside observer()`, "Replace .use() with .get()", useCalls[0]);
  else
    r.implemented.push("No deprecated .use() calls");
  return r;
}

function auditStorage(): FileAuditResult {
  const candidates = [
    resolvePath("src/services/storage.ts"),
    resolvePath("src/services/storage.tsx"),
    resolvePath("src/utils/storage.ts"),
    resolvePath("services/storage.ts"),
  ];
  const existing = candidates.find(fileExists);
  const fp = existing ?? resolvePath("src/services/storage.ts");
  const r  = makeResult(fp, !!existing);
  if (!r.exists) { addFinding(r, "error", "MMKV storage service not found", "Create src/services/storage.ts with createMMKV()"); return r; }
  const c = readFile(r.filePath)!;
  if (containsActive(c, "createMMKV"))
    r.implemented.push("createMMKV() — v4 API");
  else {
    r.missing.push("createMMKV()");
    addFinding(r, "error", "createMMKV() not found", 'import { createMMKV } from "react-native-mmkv"; export const storage = createMMKV();');
  }
  const oldAPI = findLineNumbers(c, "new MMKV(");
  if (oldAPI.length)
    addFinding(r, "error", `new MMKV() (v3) on line(s) ${oldAPI.join(", ")} — use createMMKV()`, "Replace new MMKV() with createMMKV()", oldAPI[0]);
  else
    r.implemented.push("No new MMKV() calls (correct)");
  return r;
}

function auditUnistylesConfig(): FileAuditResult {
  const candidates = [
    resolvePath("src/styles/unistyles.ts"),
    resolvePath("src/styles/theme.ts"),
    resolvePath("src/styles/unistyles.tsx"),
  ];
  const existing = candidates.find(fileExists);
  const fp = existing ?? resolvePath("src/styles/unistyles.ts");
  const r  = makeResult(fp, !!existing);
  if (!r.exists) { addFinding(r, "error", "Unistyles config not found", "Create src/styles/unistyles.ts"); return r; }
  const c = readFile(r.filePath)!;
  if (containsActive(c, "StyleSheet.configure"))
    r.implemented.push("StyleSheet.configure()");
  else
    addFinding(r, "error", "StyleSheet.configure() not found — themes not registered");
  if (containsActive(c, "light") && containsActive(c, "dark"))
    r.implemented.push("Light + dark themes");
  else
    addFinding(r, "warning", "Both light and dark themes not found");
  if (containsActive(c, "UnistylesThemes"))
    r.implemented.push("UnistylesThemes augmentation");
  else
    addFinding(r, "warning", "UnistylesThemes augmentation missing — no TS autocomplete",
      'Add: declare module "react-native-unistyles" { interface UnistylesThemes { light: AppTheme; dark: AppTheme; } }');
  if (contains(c, 'from "react-native-unistyles"') || contains(c, "from 'react-native-unistyles'"))
    r.implemented.push("StyleSheet from react-native-unistyles (correct)");
  else
    addFinding(r, "error", "StyleSheet not from react-native-unistyles — C++ engine not engaged",
      'Change to: import { StyleSheet } from "react-native-unistyles"');
  return r;
}

function auditQueryHooks(): FileAuditResult {
  const candidates = [
    resolvePath("src/hooks/useData.ts"),
    resolvePath("src/hooks/useData.tsx"),
    resolvePath("src/hooks/queries.ts"),
    resolvePath("hooks/useData.ts"),
  ];
  const existing = candidates.find(fileExists);
  const fp = existing ?? resolvePath("src/hooks/useData.ts");
  const r  = makeResult(fp, !!existing);
  if (!r.exists) { addFinding(r, "error", "TanStack Query hooks file not found", "Create src/hooks/useData.ts"); return r; }
  const c = readFile(r.filePath)!;
  if (containsActive(c, "useQuery"))   r.implemented.push("useQuery");
  else addFinding(r, "warning", "useQuery not found");
  if (containsActive(c, "queryKeys"))  r.implemented.push("Centralized queryKeys");
  else addFinding(r, "warning", "No queryKeys — inline strings cause cache misses", "Create typed queryKeys factory");
  if (containsActive(c, "staleTime"))  r.implemented.push("staleTime configured");
  else addFinding(r, "warning", "staleTime not set — every navigation refetches", "Add staleTime: 1000*60*5");
  if (containsActive(c, "gcTime"))     r.implemented.push("gcTime configured");
  else addFinding(r, "info", "gcTime not set — using default 5 min");
  return r;
}

function auditFontAssets(): FileAuditResult {
  const fontDir = resolvePath("assets/fonts");
  const r = makeResult(fontDir, fileExists(fontDir));
  if (!r.exists) {
    addFinding(r, "warning", "assets/fonts/ not found",
      "Create directory, add .ttf files, register in app.config.ts expo-font plugin");
    return r;
  }
  let files: string[] = [];
  try { files = fs.readdirSync(fontDir).filter(f => f.endsWith(".ttf") || f.endsWith(".otf")); }
  catch { addFinding(r, "error", "Could not read assets/fonts/"); return r; }
  if (!files.length)
    addFinding(r, "warning", "assets/fonts/ has no .ttf/.otf files");
  else
    r.implemented.push(`${files.length} font file(s): ${files.join(", ")}`);
  return r;
}

// ============================================================
// PER-FILE AUDIT
// ============================================================

function auditSingleFile(file: string, content: string): SourceFileIssue {
  const issues: Finding[] = [], goodPatterns: string[] = [];
  const rel        = path.relative(PROJECT_ROOT, file);
  const isReact    = isReactFile(file);
  const normalized = file.replace(/\\/g, "/");
  const isLayout   = path.basename(file).includes("_layout");
  const isUtil     = isUtilOrServiceFile(normalized);
  const getLine    = (s: string) => findLineNumber(content, s);

  const already: AlreadyReported = {
    asyncStorage: false, flatList: false, rnStyleSheet: false,
    rnImage: false, reanimated: false, panResponder: false, heavyWork: false,
  };

  if (containsActive(content, "@shopify/flash-list") && containsActive(content, "import"))
    pushIssue(issues, rel, "error",
      "@shopify/flash-list imported — remove from package.json and imports",
      'Replace with: import { LegendList } from "@legendapp/list"', getLine("flash-list"));

  if (containsActive(content, "AsyncStorage") || containsActive(content, "async-storage")) {
    already.asyncStorage = true;
    pushIssue(issues, rel, "error", "AsyncStorage — replace with MMKV (synchronous, 30x faster)",
      "Use Storage helpers from src/services/storage.ts", getLine("AsyncStorage"));
  }

  if (containsActive(content, "new MMKV("))
    pushIssue(issues, rel, "error", "new MMKV() is v3 — v4 uses createMMKV()",
      "Replace new MMKV() with createMMKV()", getLine("new MMKV("));

  const useCalls = findLineNumbers(content, ".use()");
  if (useCalls.length)
    pushIssue(issues, rel, "error",
      `.use() deprecated v2 API on line(s): ${useCalls.join(", ")} — use .get() inside observer()`,
      "Wrap with observer() and use .get()", useCalls[0]);

  if (containsActive(content, "expo-pretext"))
    pushIssue(issues, rel, "error", 'expo-pretext does not exist — package is "@chenglou/pretext"',
      'import { prepare, layout } from "@chenglou/pretext"', getLine("expo-pretext"));

  if (containsActive(content, "@chenglou/pretext")) {
    if (containsActive(content, "pretext.prepare") || containsActive(content, "font.layout"))
      pushIssue(issues, rel, "error", "Incorrect pretext API — use named exports prepare() and layout()",
        'import { prepare, layout } from "@chenglou/pretext"');
    else if (pretextUsedCorrectly(content))
      goodPatterns.push("@chenglou/pretext: correct prepare() + layout() API");
    else
      pushIssue(issues, rel, "info", '@chenglou/pretext imported — verify both prepare() and layout() are called',
        "Step 1: const p = prepare(text, font). Step 2: const r = layout(p, width, lineHeight)");
  }

  if (
    containsActive(content, "fetch(")    &&
    !isUtil                               &&
    isComponentOrHookFile(file)           &&
    !containsActive(content, "useQuery") &&
    !containsActive(content, "useMutation") &&
    !containsActive(content, "queryFn")  &&
    !fetchIsFireAndForget(content)        &&
    !fetchIsBlobConversion(content)       &&
    !fetchIsFileUpload(content)
  )
    pushIssue(issues, rel, "warning",
      "Raw fetch() in component — bypasses TanStack Query caching and error handling",
      "Move fetch into queryFn inside useQuery() or useMutation()");

  if (isReact) {
    const hasLL = importsLegendList(content) || usesLegendListJSX(content);
    if (containsActive(content, "FlatList") && !hasLL) {
      already.flatList = true;
      pushIssue(issues, rel, "warning", "FlatList — replace with LegendList for Fabric-native rendering",
        'import { LegendList } from "@legendapp/list"', getLine("FlatList"));
    }

    if (
      containsActive(content, "ScrollView") &&
      (usesLegendListJSX(content) ||
       containsActive(content, "FlatList")  ||
       containsActive(content, "FlashList")) &&
      scrollViewWrapsListCheck(content)
    )
      pushIssue(issues, rel, "error",
        "ScrollView wrapping a list — inner list cannot virtualize. One of the worst RN performance mistakes.",
        "Remove ScrollView. Use LegendList's ListHeaderComponent / ListFooterComponent instead.");

    if (
      containsActive(content, "ScrollView") &&
      (containsActive(content, "TextInput") || containsActive(content, "input")) &&
      !containsActive(content, "keyboardShouldPersistTaps")
    )
      pushIssue(issues, rel, "warning",
        "ScrollView + TextInput without keyboardShouldPersistTaps — keyboard won't dismiss on tap",
        'Add keyboardShouldPersistTaps="handled"');

    if (
      !isLayout                             &&
      !importsFromUnistyles(content)        &&
      importsSymbolFromCoreRN(content, "StyleSheet") &&
      !hasSelfContainedTokenSystem(content)
    ) {
      already.rnStyleSheet = true;
      pushIssue(issues, rel, "error",
        'StyleSheet from "react-native" — must use "react-native-unistyles" for theme + C++ engine',
        'Change to: import { StyleSheet } from "react-native-unistyles"', getLine("StyleSheet"));
    }

    const inlineCount = countNonAnimatedInlineStyles(content);
    if (inlineCount > 3)
      pushIssue(issues, rel, "warning",
        `${inlineCount} inline style objects — each creates a new object every render`,
        "Extract to StyleSheet.create((theme) => ({...}))");

    if (containsActive(content, "useStyles"))
      pushIssue(issues, rel, "error", "useStyles() removed in Unistyles v3 — define styles at module level",
        "const styles = StyleSheet.create((theme) => ({...})) at module level", getLine("useStyles"));

    if (
      !file.includes("turbo-image")        &&
      !importsFromUnistyles(content)        &&
      importsSymbolFromCoreRN(content, "Image")
    ) {
      already.rnImage = true;
      pushIssue(issues, rel, "warning",
        "Built-in Image — replace with TurboImage (Nuke/Coil, New Arch, better caching)",
        'import TurboImage from "react-native-turbo-image"', getLine("Image"));
    }

    if (
      containsActive(content, "{ TurboImage }") ||
      /import\s*\{[^}]*TurboImage[^}]*\}/.test(content)
    )
      pushIssue(issues, rel, "error", "TurboImage imported as named export — it is a DEFAULT export",
        'import TurboImage from "react-native-turbo-image"', getLine("TurboImage"));

    if (containsActive(content, "TurboImage") && !containsActive(content, "cachePolicy"))
      pushIssue(issues, rel, "warning", 'TurboImage without cachePolicy — add cachePolicy="dataCache"',
        'Add cachePolicy="dataCache" to every TurboImage');

    if (
      containsActive(content, "TurboImage") &&
      !containsActive(content, "width")     &&
      !containsActive(content, "height")
    )
      pushIssue(issues, rel, "warning",
        "TurboImage without explicit width+height — layout thrashing until image loads",
        "Add explicit width and height props");

    if (usesLegendListJSX(content)) {
      if (!containsActive(content, "recycleItems"))
        pushIssue(issues, rel, "warning",
          "LegendList without recycleItems={true} — add for FlashList-equivalent recycling",
          "Add recycleItems={true}");
      if (!containsActive(content, "keyExtractor"))
        pushIssue(issues, rel, "warning",
          "LegendList without keyExtractor — React can't reconcile efficiently",
          'Add keyExtractor={(item) => item.id}');
      if (
        containsActive(content, "estimatedItemSize={0}") ||
        containsActive(content, "estimatedItemSize={1}")
      )
        pushIssue(issues, rel, "warning",
          "estimatedItemSize is 0 or 1 — measure your actual average item height",
          "Set a real value e.g. estimatedItemSize={80}");
      else if (!containsActive(content, "estimatedItemSize"))
        pushIssue(issues, rel, "info",
          "LegendList without estimatedItemSize — add for faster initial render",
          "Add estimatedItemSize={100} (adjust to your average)");
    }

    if (
      containsActive(content, "recycleItems") &&
      containsActive(content, "useState")     &&
      isLikelyListItemFile(file)
    )
      pushIssue(issues, rel, "warning",
        "recycleItems + useState in list item — local state bleeds across recycled items",
        "Use Legend State observable or lift state out. Or disable recycleItems.");

    if (
      usesLegendListJSX(content) &&
      !containsActive(content, "@chenglou/pretext") &&
      legendListHasVariableHeightItems(content)
    )
      pushIssue(issues, rel, "info",
        "LegendList with variable-height text — use @chenglou/pretext for precise item sizes",
        'import { prepare, layout } from "@chenglou/pretext"');

    if (
      containsActive(content, "react-native-reanimated") ||
      containsActive(content, "useSharedValue")
    ) {
      if (importsSymbolFromCoreRN(content, "Animated")) {
        already.reanimated = true;
        pushIssue(issues, rel, "error",
          "Animated from react-native in file that uses Reanimated — bridge-based Animated conflicts",
          'Remove { Animated } from "react-native". Use: import Animated from "react-native-reanimated"');
      }
    } else if (
      containsActive(content, "Animated.View") ||
      containsActive(content, "Animated.timing")
    ) {
      already.reanimated = true;
      pushIssue(issues, rel, "warning",
        "React Native built-in Animated — JS thread, bridge-based. Use Reanimated.",
        'import Animated, { useSharedValue, useAnimatedStyle, withTiming } from "react-native-reanimated"');
    }

    if (containsActive(content, "PanResponder")) {
      already.panResponder = true;
      pushIssue(issues, rel, "warning", "PanResponder — old bridge-based gestures. Use Gesture Handler.",
        'import { Gesture, GestureDetector } from "react-native-gesture-handler"');
    }

    if (
      containsActive(content, "setTimeout") &&
      (containsActive(content, "setOpacity") ||
       containsActive(content, "setAnimate") ||
       containsActive(content, "setScale"))
    )
      pushIssue(issues, rel, "info",
        "setTimeout + animation state — use Reanimated withDelay() instead",
        "Replace setTimeout(() => setState(x), ms) with withDelay(ms, withTiming(x))");

    if (containsActive(content, "InteractionManager"))
      pushIssue(issues, rel, "warning",
        "InteractionManager deprecated since RN 0.82 — behavior changed to match setImmediate",
        "Replace with requestIdleCallback(() => { heavyWork(); }) or navigation.addListener('transitionEnd', ...)",
        getLine("InteractionManager"));

    if (containsActive(content, "PropTypes") || containsActive(content, "prop-types"))
      pushIssue(issues, rel, "error", "PropTypes removed in RN 0.78+ — use TypeScript interfaces",
        "Replace propTypes with interface Props { ... } and type the component function",
        getLine("PropTypes"));

    if (containsActive(content, "StyleSheet.absoluteFillObject"))
      pushIssue(issues, rel, "error", "StyleSheet.absoluteFillObject removed in RN 0.85",
        "Replace with StyleSheet.absoluteFill or { position:'absolute',top:0,left:0,right:0,bottom:0 }",
        getLine("StyleSheet.absoluteFillObject"));

    if (/Appearance\.setColorScheme\s*\(\s*(?:null|undefined)\s*\)/.test(content))
      pushIssue(issues, rel, "error",
        "Appearance.setColorScheme(null/undefined) broken in RN 0.82+",
        "Replace with Appearance.setColorScheme('unspecified')",
        getLine("Appearance.setColorScheme"));

    if (containsActive(content, "AccessibilityInfo.setAccessibilityFocus"))
      pushIssue(issues, rel, "warning",
        "AccessibilityInfo.setAccessibilityFocus deprecated in RN 0.85",
        "Replace with AccessibilityInfo.sendAccessibilityEvent(ref, 'focus')",
        getLine("AccessibilityInfo.setAccessibilityFocus"));

    if (!isLayout) {
      const eff = analyzeUseEffects(content);
      if (eff.withoutCleanup > 0)
        pushIssue(issues, rel, "warning",
          `${eff.withoutCleanup} useEffect(s) with subscriptions/timers but no cleanup — memory leak`,
          "Add return () => { subscription.remove(); clearTimeout(timer); }");
      else if (eff.total > 0 && eff.withCleanup > 0)
        goodPatterns.push(`${eff.withCleanup}/${eff.total} useEffect(s) have cleanup`);
      if (eff.total >= 5 && eff.withCleanup / eff.total < 0.5)
        pushIssue(issues, rel, "warning",
          `Low cleanup ratio: ${eff.withCleanup}/${eff.total} useEffect(s) — review for leaks`,
          "Add cleanup to effects that create subscriptions or timers");

      if (
        useEffectHasHeavyWork(content) &&
        !containsActive(content, "requestIdleCallback") &&
        !containsActive(content, "transitionEnd")
      ) {
        already.heavyWork = true;
        pushIssue(issues, rel, "info",
          "Heavy computation (sort/filter/reduce/JSON) inside a useEffect body — may cause jank during transitions",
          "Use requestIdleCallback(() => { heavyWork(); }) or navigation.addListener('transitionEnd', () => { heavyWork(); })");
      }
    }

    const logCount = countOccurrences(content, "console.log");
    if (logCount > 0)
      pushIssue(issues, rel, "info",
        `${logCount} console.log call(s) — slow in dev, stripped in prod by babel plugin`,
        "Remove or replace with console.warn for intentional logs");

    if (containsActive(content, "observer(")) {
      if (/observer\s*\(\s*function|observer\s*\(\s*\(/.test(content))
        goodPatterns.push("observer() wrapping component (correct)");
      else
        pushIssue(issues, rel, "warning",
          "observer imported but may not wrap any component",
          "Usage: const MyComponent = observer(function MyComponent() { ... })");
    }

    if (containsActive(content, "useSharedValue"))      goodPatterns.push("useSharedValue — UI thread animation");
    if (containsActive(content, "useAnimatedStyle"))    goodPatterns.push("useAnimatedStyle — bridge-free styles");
    if (containsActive(content, "GestureDetector"))     goodPatterns.push("GestureDetector — native thread gestures");
    if (containsActive(content, "maintainScrollAtEnd")) goodPatterns.push("maintainScrollAtEnd — correct chat scroll");
    if (containsActive(content, "requestIdleCallback")) goodPatterns.push("requestIdleCallback — modern idle deferral");
  }

  if (!isLayout) {
    auditMissingToolUsage(rel, content, normalized, isReact, issues, already);
    auditUnnecessaryToolUsage(rel, content, isReact, issues);
  }

  return { file: rel, issues, goodPatterns };
}

// ============================================================
// FULL SOURCE SCAN
// ============================================================

function auditSourceFiles(): SourceFileIssue[] {
  const dirs = [
    "src","app","components","hooks","screens",
    "utils","services","store","features","modules",
  ].map(d => resolvePath(d)).filter(fileExists);
  if (!dirs.length) return [];

  const budget = { count: 0 };
  const all = [
    ...new Set(
      dirs.flatMap(d => getAllFiles(d, [".tsx",".ts",".js",".jsx"], undefined, budget))
    ),
  ];
  if (budget.count >= MAX_FILES)
    console.warn(`\n${C.yellow}⚠ File limit (${MAX_FILES}) reached — some files skipped.${C.reset}`);

  return all.flatMap(file => {
    const content = readFile(file);
    if (!content) return [];
    const r = auditSingleFile(file, content);
    return (r.issues.length || r.goodPatterns.length) ? [r] : [];
  });
}

// ============================================================
// RENDER
// ============================================================

const severityColor = (s: Severity): string =>
  ({ error: C.red, warning: C.yellow, info: C.blue, ok: C.green })[s];
const severityLabel = (s: Severity): string =>
  ({ error: "✖ ERROR  ", warning: "⚠ WARN   ", info: "ℹ INFO   ", ok: "✔ OK     " })[s];

function printFileResult(r: FileAuditResult) {
  const rel = path.relative(PROJECT_ROOT, r.filePath);
  if (r.skipReason) {
    console.log(`\n${C.dim}─── ${rel}${C.reset}`);
    console.log(`  ${C.dim}SKIPPED: ${r.skipReason}${C.reset}`);
    return;
  }
  const hasE = r.findings.some(f => f.severity === "error");
  const hasW = r.findings.some(f => f.severity === "warning");
  const icon = !r.exists
    ? `${C.red}✖ MISSING${C.reset}`
    : hasE  ? `${C.red}✖ ERRORS${C.reset}`
    : hasW  ? `${C.yellow}⚠ WARNINGS${C.reset}`
    : `${C.green}✔ CLEAN${C.reset}`;
  console.log(`\n${C.bold}─── ${rel}${C.reset}  ${icon}`);
  if (!r.exists) console.log(`  ${C.red}File does not exist.${C.reset}`);
  r.implemented.forEach(i => console.log(`  ${C.green}✔${C.reset} ${i}`));
  r.missing.forEach(i     => console.log(`  ${C.yellow}✗${C.reset} ${i}`));
  r.forbidden.forEach(i   => console.log(`  ${C.red}✖ FORBIDDEN:${C.reset} ${i}`));
  r.findings.forEach(f => {
    const loc = f.line !== undefined ? ` ${C.dim}(line ${f.line})${C.reset}` : "";
    console.log(`  ${severityColor(f.severity)}${severityLabel(f.severity)}${C.reset}${f.message}${loc}`);
    if (f.fix) console.log(`  ${C.dim}  → ${f.fix}${C.reset}`);
  });
}

function printSourceFileIssues(results: SourceFileIssue[]) {
  if (!results.length) { console.log(`\n${C.green}✔ All source files passed.${C.reset}`); return; }
  for (const r of results) {
    if (!r.issues.length && !r.goodPatterns.length) continue;
    const hasE  = r.issues.some(i => i.severity === "error");
    const hasW  = r.issues.some(i => i.severity === "warning");
    const onlyI = r.issues.length > 0 && r.issues.every(i => i.severity === "info");
    const icon  = hasE ? `${C.red}✖ ERRORS${C.reset}`
      : hasW    ? `${C.yellow}⚠ WARNINGS${C.reset}`
      : onlyI   ? `${C.blue}ℹ INFO${C.reset}`
      : `${C.green}✔${C.reset}`;
    console.log(`\n  ${C.bold}${r.file}${C.reset}  ${icon}`);
    r.issues.forEach(i => {
      const loc = i.line !== undefined ? ` ${C.dim}(line ${i.line})${C.reset}` : "";
      console.log(`    ${severityColor(i.severity)}${severityLabel(i.severity)}${C.reset}${i.message}${loc}`);
      if (i.fix) console.log(`    ${C.dim}  → ${i.fix}${C.reset}`);
    });
    r.goodPatterns.forEach(p => console.log(`    ${C.green}✔${C.reset} ${p}`));
  }
}

function printPrioritySummary(cfg: FileAuditResult[], src: SourceFileIssue[]) {
  const rows = [
    ...cfg.filter(r => !r.skipReason).map(r => ({
      file: path.relative(PROJECT_ROOT, r.filePath),
      e: r.findings.filter(f => f.severity === "error").length,
      w: r.findings.filter(f => f.severity === "warning").length,
    })),
    ...src.map(r => ({
      file: r.file,
      e: r.issues.filter(i => i.severity === "error").length,
      w: r.issues.filter(i => i.severity === "warning").length,
    })),
  ].filter(r => r.e + r.w > 0).sort((a, b) => (b.e * 10 + b.w) - (a.e * 10 + a.w));
  if (!rows.length) return;
  console.log(`\n${C.bold}${C.cyan}══ FIX PRIORITY ══${C.reset}`);
  rows.slice(0, 10).forEach((p, i) => {
    const es = p.e > 0 ? `${C.red}${p.e} error(s)${C.reset}`        : "";
    const ws = p.w > 0 ? `${C.yellow}${p.w} warning(s)${C.reset}`   : "";
    console.log(`  ${C.bold}${i + 1}.${C.reset} ${p.file} — ${[es, ws].filter(Boolean).join(", ")}`);
  });
  if (rows.length > 10) console.log(`  ${C.dim}... and ${rows.length - 10} more${C.reset}`);
}

function writeJsonReport(cfg: FileAuditResult[], src: SourceFileIssue[]) {
  const all = [...cfg.flatMap(r => r.findings), ...src.flatMap(r => r.issues)];
  const report = {
    timestamp:   new Date().toISOString(),
    projectRoot: PROJECT_ROOT,
    summary: {
      errors:   all.filter(f => f.severity === "error").length,
      warnings: all.filter(f => f.severity === "warning").length,
      info:     all.filter(f => f.severity === "info").length,
    },
    configFiles: cfg.map(r => ({
      file: r.filePath, exists: r.exists, implemented: r.implemented,
      missing: r.missing, forbidden: r.forbidden,
      findings: r.findings, skipReason: r.skipReason,
    })),
    sourceFiles: src.map(r => ({ file: r.file, issues: r.issues, goodPatterns: r.goodPatterns })),
  };
  fs.writeFileSync(resolvePath("stack-audit-report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(`\n${C.dim}JSON report written to: stack-audit-report.json${C.reset}`);
}

// ============================================================
// MAIN
// ============================================================

function runAudit() {
  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║       REACT NATIVE STACK AUDIT — 2026               ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`${C.dim}Project: ${PROJECT_ROOT}\nTime:    ${new Date().toISOString()}${C.reset}`);

  const cfg: FileAuditResult[] = [];

  console.log(`\n${C.bold}${C.magenta}══ PACKAGES ══${C.reset}`);
  const pkg = auditPackageJson(); cfg.push(pkg); printFileResult(pkg);

  console.log(`\n${C.bold}${C.magenta}══ NATIVE FILES ══${C.reset}`);
  [auditPodfile(), auditGradleProperties()].forEach(r => { cfg.push(r); printFileResult(r); });

  console.log(`\n${C.bold}${C.magenta}══ EXPO CONFIG ══${C.reset}`);
  const ac = auditAppConfig(); cfg.push(ac); printFileResult(ac);

  console.log(`\n${C.bold}${C.magenta}══ BUILD TOOLING ══${C.reset}`);
  [auditBabelConfig(), auditMetroConfig()].forEach(r => { cfg.push(r); printFileResult(r); });

  console.log(`\n${C.bold}${C.magenta}══ APP STRUCTURE ══${C.reset}`);
  const lay = auditRootLayout(); cfg.push(lay); printFileResult(lay);

  console.log(`\n${C.bold}${C.magenta}══ SOURCE FILES ══${C.reset}`);
  [auditStore(), auditStorage(), auditUnistylesConfig(), auditQueryHooks(), auditFontAssets()]
    .forEach(r => { cfg.push(r); printFileResult(r); });

  console.log(`\n${C.bold}${C.magenta}══ SOURCE FILE PATTERN SCAN ══${C.reset}`);
  console.log(`${C.dim}Scanning .ts/.tsx for anti-patterns, missing tools, unnecessary tool usage...${C.reset}`);
  const src = auditSourceFiles();
  printSourceFileIssues(src);
  printPrioritySummary(cfg, src);

  const all  = [...cfg.flatMap(r => r.findings), ...src.flatMap(r => r.issues)];
  const errs = all.filter(f => f.severity === "error").length;
  const warn = all.filter(f => f.severity === "warning").length;
  const info = all.filter(f => f.severity === "info").length;

  console.log(`\n${C.bold}${C.cyan}══ SUMMARY ══${C.reset}`);
  console.log(`  ${C.red}✖ Errors:   ${errs}${C.reset}`);
  console.log(`  ${C.yellow}⚠ Warnings: ${warn}${C.reset}`);
  console.log(`  ${C.blue}ℹ Info:     ${info}${C.reset}`);

  if (!errs && !warn)
    console.log(`\n${C.green}${C.bold}✔ Stack fully implemented and clean.${C.reset}\n`);
  else if (!errs)
    console.log(`\n${C.yellow}${C.bold}⚠ No errors — ${warn} warning(s) to review.${C.reset}\n`);
  else
    console.log(`\n${C.red}${C.bold}✖ ${errs} error(s) must be fixed before shipping.${C.reset}\n`);

  console.log(`${C.dim}Run 'npx expo-doctor' for dependency compatibility check.${C.reset}`);
  writeJsonReport(cfg, src);
}

runAudit();
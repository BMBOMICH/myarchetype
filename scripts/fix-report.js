// scripts/fix-report.js
'use strict';

const fs            = require('fs');
const path          = require('path');
const { execSync }  = require('child_process');

// ─── CLI flags ────────────────────────────────────────────────────────────────

const JSON_OUTPUT  = process.argv.includes('--json');
const VERBOSE      = process.argv.includes('--verbose');
const DEAD_EXPORTS = process.argv.includes('--dead-exports');
const SKIP_TSC     = process.argv.includes('--skip-tsc');
const SKIP_ESLINT  = process.argv.includes('--skip-eslint');
const ONLY_PATTERN = process.argv.find(a => a.startsWith('--only='))?.slice(7)  ?? null;
const SHOW_LIMIT   = parseInt(process.argv.find(a => a.startsWith('--limit='))?.slice(8) ?? '30', 10);

// ─── Config ───────────────────────────────────────────────────────────────────

const TARGET_DIRS = ['app', 'utils', 'components', 'server/src'];
const EXTENSIONS  = new Set(['.ts', '.tsx', '.js', '.jsx']);
const MAX_DEPTH   = 12;
const MAX_FILE_KB = 500;

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '.expo', '.next', '.cache',
  'coverage', '__pycache__', '.turbo', '.git',
]);

// ─── Colors ───────────────────────────────────────────────────────────────────

const USE_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  red:    s => USE_COLOR ? `\x1b[31m${s}\x1b[0m` : s,
  yellow: s => USE_COLOR ? `\x1b[33m${s}\x1b[0m` : s,
  green:  s => USE_COLOR ? `\x1b[32m${s}\x1b[0m` : s,
  cyan:   s => USE_COLOR ? `\x1b[36m${s}\x1b[0m` : s,
  bold:   s => USE_COLOR ? `\x1b[1m${s}\x1b[0m`  : s,
  dim:    s => USE_COLOR ? `\x1b[2m${s}\x1b[0m`  : s,
  gray:   s => USE_COLOR ? `\x1b[90m${s}\x1b[0m` : s,
};

// ─── Issue store ──────────────────────────────────────────────────────────────

const issues = {
  // Hook rules (regex-based — fast, no tooling needed)
  hookInJsxProp:      [],
  hookInConditional:  [],
  hookInLoop:         [],
  hookInCallback:     [],
  // Memory (regex-based)
  memoryLeaks:        [],
  staleClosure:       [],
  missingDepArray:    [],
  // React (regex-based)
  scrollViewAbuse:    [],
  mapNoKey:           [],
  inlineStyleObjects: [],
  missingMemo:        [],
  // TypeScript — from real tsc output
  tsErrors:           [],
  // ESLint — from real eslint output
  eslintErrors:       [],
  // Async (regex-based)
  asyncNoTryCatch:    [],
  // any type (regex-based, tsc catches more)
  anyTypes:           [],
  // Architecture
  largeFiles:         [],
  circularDeps:       [],
  deadExports:        [],
};

const push = (cat, item) => issues[cat].push(item);

// ═════════════════════════════════════════════════════════════════════════════
// REAL TOOL RUNNERS
// ═════════════════════════════════════════════════════════════════════════════

// ── TypeScript compiler ───────────────────────────────────────────────────────

function runTsc() {
  if (SKIP_TSC) {
    if (!JSON_OUTPUT) console.log(c.dim('  [tsc] Skipped (--skip-tsc)\n'));
    return;
  }

  if (!JSON_OUTPUT) process.stdout.write(c.dim('  [tsc] Type-checking... '));

  // Find tsconfig — prefer tsconfig.json, fall back to tsconfig.*.json
  const tsconfigCandidates = [
    'tsconfig.json',
    'tsconfig.app.json',
    'tsconfig.base.json',
  ];
  const tsconfig = tsconfigCandidates.find(f => fs.existsSync(f));

  if (!tsconfig) {
    if (!JSON_OUTPUT) console.log(c.yellow('no tsconfig.json found — skipped'));
    return;
  }

  // Check tsc is available
  let tscBin;
  try {
    tscBin = execSync('npx --no-install tsc --version', { stdio: 'pipe' }).toString().trim();
  } catch {
    if (!JSON_OUTPUT) console.log(c.yellow('tsc not found — run: npm install typescript'));
    return;
  }

  if (VERBOSE && !JSON_OUTPUT) console.log(c.dim(`\n  Using: ${tscBin}`));

  let output = '';
  try {
    // --noEmit: don't write files
    // --pretty false: machine-readable output
    // --skipLibCheck: don't check node_modules types (faster)
    execSync(
      `npx tsc --noEmit --pretty false --skipLibCheck -p ${tsconfig}`,
      { stdio: 'pipe' },
    );
    if (!JSON_OUTPUT) console.log(c.green('✔ no errors'));
  } catch (e) {
    output = (e.stdout ?? '').toString() + (e.stderr ?? '').toString();
    if (!JSON_OUTPUT) console.log(c.red(`✖ errors found`));
  }

  if (!output.trim()) return;

  // Parse tsc output format:
  // path/to/file.ts(line,col): error TS1234: message
  // path/to/file.ts(line,col): warning TS1234: message
  const re = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/gm;
  let m;

  while ((m = re.exec(output)) !== null) {
    const [, filePath, line, col, level, code, message] = m;

    // Filter to only our target files
    const rel = path.relative(process.cwd(), filePath.trim()).replace(/\\/g, '/');
    if (ONLY_PATTERN && !rel.includes(ONLY_PATTERN)) continue;

    // Skip node_modules errors
    if (rel.includes('node_modules')) continue;

    // Categorise by error code
    const severity = level === 'error' ? 'error' : 'warn';

    push('tsErrors', {
      file:     rel,
      line:     parseInt(line, 10),
      col:      parseInt(col, 10),
      severity,
      label:    code,
      code:     message.trim().slice(0, 120),
      fix:      getTscFix(code, message),
    });
  }

  if (VERBOSE && !JSON_OUTPUT) {
    console.log(c.dim(`  [tsc] Parsed ${issues.tsErrors.length} diagnostics`));
  }
}

// Map common TS error codes to human-readable fix hints
function getTscFix(code, message) {
  const fixes = {
    // Type errors
    'TS2322': 'Type mismatch — check the assigned value matches the declared type',
    'TS2345': 'Argument type mismatch — check the types passed to this function',
    'TS2339': 'Property does not exist — check spelling or add it to the type/interface',
    'TS2304': 'Cannot find name — check imports and spelling',
    'TS2305': 'Module has no exported member — check the export name and package types',
    'TS2307': 'Cannot find module — check the import path and that the package is installed',
    'TS2349': 'Not callable — the value is not a function; check the type',
    'TS2351': 'Not constructable — cannot use "new" with this type',
    'TS2362': 'Left side of arithmetic must be number type',
    'TS2363': 'Right side of arithmetic must be number type',
    'TS2365': 'Operator cannot be applied to these types',
    'TS2366': 'Function lacks return statement — add a return or change return type to void',
    'TS2367': 'This condition always evaluates to the same value — check your logic',
    'TS2395': 'Duplicate function implementation',
    'TS2403': 'Subsequent variable declarations must have the same type',
    'TS2416': 'Property is not assignable to the same property in base type',
    'TS2420': 'Class does not implement interface correctly — add missing members',
    'TS2448': 'Block-scoped variable used before declaration',
    'TS2451': 'Cannot redeclare block-scoped variable',
    'TS2454': 'Variable used before being assigned',
    'TS2532': 'Object is possibly undefined — add a null check or use optional chaining',
    'TS2533': 'Object is possibly null or undefined — add a null check',
    'TS2540': 'Cannot assign to read-only property',
    'TS2551': 'Property does not exist — did you mean a different property?',
    'TS2554': 'Wrong number of arguments — check the function signature',
    'TS2555': 'Expected at least N arguments',
    'TS2556': 'Spread arguments must be a tuple or passed to rest parameter',
    'TS2571': 'Object is of type unknown — narrow the type before using it',
    'TS2590': 'Expression produces a union type that is too complex to represent',
    'TS2693': 'Type used as a value — did you mean typeof X?',
    'TS2694': 'Namespace has no exported member',
    'TS2698': 'Spread types may only be created from object types',
    'TS2769': 'No overload matches this call — check all argument types',
    'TS2783': 'Property will overwrite the base type property',
    'TS4114': 'Override modifier required — add "override" keyword',
    // Implicit any
    'TS7006': 'Parameter implicitly has "any" type — add an explicit type annotation',
    'TS7015': 'Element implicitly has "any" type — type the index signature',
    'TS7017': 'Element implicitly has "any" type — add index signature to the type',
    'TS7031': 'Binding element implicitly has "any" type — destructure with explicit types',
    'TS7034': 'Variable implicitly has type "any" in some locations — add explicit type',
    // Strict null
    'TS2531': 'Object is possibly null — add a null check before accessing',
    'TS2721': 'Cannot invoke an object which is possibly null',
    'TS2722': 'Cannot invoke an object which is possibly undefined',
    // Module
    'TS1192': 'Module has no default export — use named import { X } instead',
    'TS2613': 'Module has no exported member — check the import name',
    // Syntax
    'TS1005': 'Syntax error — missing token',
    'TS1128': 'Declaration or statement expected',
    'TS1161': 'Unterminated regular expression literal',
    'TS1002': 'Unterminated string literal',
    // Async
    'TS1308': '"await" expression only allowed in async functions',
    'TS1378': 'Top-level await only allowed in modules — add "type: module" or use async IIFE',
    // Decorators
    'TS1240': 'Unable to resolve signature of class decorator',
    // JSX
    'TS2602': 'JSX element type does not have any construct signatures',
    'TS2604': 'JSX element type does not have any call signatures',
    'TS2605': 'JSX element type is not valid — must be a string or class/function',
    'TS2607': 'JSX element does not support attributes',
    'TS2741': 'Missing required JSX prop — add the missing property',
    'TS17004': 'Cannot use JSX unless "--jsx" flag is provided',
  };

  if (fixes[code]) return fixes[code];

  // Fallback: extract the key phrase from the message
  const shortened = message.replace(/\s*\(.*\)$/, '').trim();
  return `${code}: ${shortened.slice(0, 100)}`;
}

// ── ESLint ────────────────────────────────────────────────────────────────────

function runEslint() {
  if (SKIP_ESLINT) {
    if (!JSON_OUTPUT) console.log(c.dim('  [eslint] Skipped (--skip-eslint)\n'));
    return;
  }

  if (!JSON_OUTPUT) process.stdout.write(c.dim('  [eslint] Linting... '));

  // Check eslint is available
  try {
    execSync('npx --no-install eslint --version', { stdio: 'pipe' });
  } catch {
    if (!JSON_OUTPUT) console.log(c.yellow('eslint not found — run: npm install eslint'));
    return;
  }

  // Check eslint config exists
  const eslintConfigs = [
    '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json',
    '.eslintrc.yaml', '.eslintrc.yml', 'eslint.config.js', 'eslint.config.mjs',
  ];
  const hasEslintConfig = eslintConfigs.some(f => fs.existsSync(f)) ||
    (() => {
      try {
        const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        return !!pkg.eslintConfig;
      } catch { return false; }
    })();

  if (!hasEslintConfig) {
    if (!JSON_OUTPUT) console.log(c.yellow('no eslint config found — skipped'));
    return;
  }

  const extensions = 'ts,tsx,js,jsx';
  const dirs       = TARGET_DIRS.filter(d => fs.existsSync(d)).join(' ');
  if (!dirs) { if (!JSON_OUTPUT) console.log(c.yellow('no target dirs found')); return; }

  let output = '';
  try {
    // --format json: machine-readable
    // --max-warnings=-1: don't fail on warnings (we handle exit ourselves)
    output = execSync(
      `npx eslint ${dirs} --ext ${extensions} --format json --max-warnings=-1`,
      { stdio: 'pipe', maxBuffer: 32 * 1024 * 1024 },
    ).toString();
    if (!JSON_OUTPUT) console.log(c.green('✔ no issues'));
  } catch (e) {
    output = (e.stdout ?? '').toString();
    if (!JSON_OUTPUT) {
      const msg = e.stderr?.toString()?.trim();
      console.log(msg?.includes('Error') ? c.red('✖ issues found') : c.yellow('⚠ issues found'));
    }
  }

  if (!output.trim()) return;

  let parsed;
  try { parsed = JSON.parse(output); }
  catch {
    if (VERBOSE && !JSON_OUTPUT) console.error(c.red('  [eslint] Failed to parse JSON output'));
    return;
  }

  for (const fileResult of parsed) {
    const rel = path.relative(process.cwd(), fileResult.filePath).replace(/\\/g, '/');
    if (ONLY_PATTERN && !rel.includes(ONLY_PATTERN)) continue;
    if (rel.includes('node_modules')) continue;

    for (const msg of fileResult.messages) {
      const severity = msg.severity === 2 ? 'error' : 'warn';

      // Skip if it duplicates something our own scanners already catch
      // (hooks/exhaustive-deps covered by our scanner, but ESLint is more accurate)
      push('eslintErrors', {
        file:     rel,
        line:     msg.line ?? 0,
        col:      msg.column ?? 0,
        severity,
        label:    msg.ruleId ?? 'eslint',
        code:     (msg.message ?? '').slice(0, 120),
        fix:      getEslintFix(msg.ruleId, msg.message),
      });
    }
  }

  if (VERBOSE && !JSON_OUTPUT) {
    console.log(c.dim(`  [eslint] Parsed ${issues.eslintErrors.length} diagnostics`));
  }
}

function getEslintFix(ruleId, message) {
  if (!ruleId) return message ?? 'Fix the ESLint violation';

  const fixes = {
    // React hooks
    'react-hooks/rules-of-hooks':        'Hook called conditionally or inside a nested function — move to top level of component',
    'react-hooks/exhaustive-deps':        'Missing or unnecessary dependency in hook dep array — add/remove the listed dependency',
    // React
    'react/prop-types':                   'Missing PropTypes — use TypeScript types instead (remove prop-types)',
    'react/display-name':                 'Component is missing displayName — add MyComponent.displayName = "MyComponent"',
    'react/no-deprecated':                'Using a deprecated React API — check the React migration guide',
    'react/no-direct-mutation-state':     'Do not mutate state directly — use setState() or a state setter',
    'react/no-find-dom-node':             'findDOMNode is deprecated — use ref callbacks or useRef',
    'react/no-is-mounted':                'isMounted is deprecated — use a ref to track mount status',
    'react/no-render-return-value':       'Do not use the return value of ReactDOM.render()',
    'react/no-string-refs':               'String refs are removed — use useRef() or callback refs',
    'react/no-unknown-property':          'Unknown JSX property — check spelling (e.g. class → className)',
    'react/jsx-key':                      'Missing key prop in list — add key={item.id} to the root element',
    'react/jsx-no-duplicate-props':       'Duplicate JSX prop — remove the duplicate',
    'react/jsx-no-undef':                 'JSX component is not defined — check import and spelling',
    'react/jsx-uses-react':               'React must be in scope for JSX (React 16 only)',
    'react/react-in-jsx-scope':           'React must be imported for JSX (add: import React from "react")',
    'react/self-closing-comp':            'Use self-closing tag for components with no children: <Foo />',
    // React Native
    'react-native/no-inline-styles':      'Inline style object — move to StyleSheet.create()',
    'react-native/no-unused-styles':      'StyleSheet has unused style rules — remove them',
    'react-native/no-color-literals':     'Hard-coded color — move to a constants/theme file',
    'react-native/no-raw-text':           'Raw text outside <Text> — wrap in <Text> component',
    'react-native/split-platform-components': 'Use platform-specific file (Foo.ios.tsx / Foo.android.tsx) instead of Platform.OS checks',
    // TypeScript
    '@typescript-eslint/no-explicit-any':             '"any" type — replace with "unknown" or a specific type',
    '@typescript-eslint/no-non-null-assertion':       '"!" non-null assertion — use optional chaining or a null check',
    '@typescript-eslint/no-unused-vars':              'Unused variable — remove it or prefix with "_" to suppress',
    '@typescript-eslint/no-use-before-define':        'Variable used before definition — reorder declarations',
    '@typescript-eslint/ban-ts-comment':              '@ts-ignore / @ts-nocheck — use @ts-expect-error with a description',
    '@typescript-eslint/ban-types':                   'Banned type (Object, Function, etc.) — use specific types',
    '@typescript-eslint/explicit-function-return-type': 'Function missing explicit return type annotation',
    '@typescript-eslint/no-floating-promises':        'Floating promise — add await, void, or .catch()',
    '@typescript-eslint/no-misused-promises':         'Promise used where boolean expected — check the condition',
    '@typescript-eslint/await-thenable':              '"await" on a non-Promise value — remove await',
    '@typescript-eslint/no-unsafe-assignment':        'Unsafe assignment from "any" type',
    '@typescript-eslint/no-unsafe-call':              'Unsafe call of an "any" typed value',
    '@typescript-eslint/no-unsafe-member-access':     'Unsafe member access on "any" typed value',
    '@typescript-eslint/no-unsafe-return':            'Unsafe return of "any" typed value',
    '@typescript-eslint/require-await':               'Async function has no await — remove async or add await',
    '@typescript-eslint/no-unnecessary-type-assertion': 'Type assertion is unnecessary — remove the "as" cast',
    '@typescript-eslint/prefer-nullish-coalescing':   'Use nullish coalescing (??) instead of || for null/undefined checks',
    '@typescript-eslint/prefer-optional-chain':       'Use optional chaining (?.) instead of && chain',
    '@typescript-eslint/no-shadow':                   'Variable shadows outer scope variable — rename one of them',
    '@typescript-eslint/consistent-type-imports':     'Use "import type" for type-only imports',
    '@typescript-eslint/no-inferrable-types':         'Type annotation is redundant — TypeScript can infer it',
    // Import
    'import/no-cycle':                    'Circular import detected — extract shared code to a third module',
    'import/no-unused-modules':           'Module is never imported — remove or add to barrel index',
    'import/no-deprecated':               'Importing a deprecated export — check the package changelog',
    'import/order':                       'Imports are not in the correct order — run eslint --fix to auto-sort',
    'import/no-duplicates':               'Duplicate import from same module — merge into one import statement',
    // General
    'no-console':                         'console.log left in code — remove or replace with a logger',
    'no-debugger':                        '"debugger" statement left in code — remove before committing',
    'no-eval':                            '"eval()" is a security risk — never use eval()',
    'no-var':                             '"var" is legacy — use "const" or "let"',
    'prefer-const':                       'Variable is never reassigned — use "const" instead of "let"',
    'no-unused-vars':                     'Unused variable — remove it or prefix with "_"',
    'no-undef':                           'Variable is not defined — check imports and spelling',
    'eqeqeq':                             'Use === instead of == to avoid type coercion bugs',
    'no-shadow':                          'Variable shadows a variable in outer scope — rename one',
    'no-use-before-define':               'Variable used before it is defined — reorder declarations',
    'prefer-template':                    'Use template literal instead of string concatenation',
    'object-shorthand':                   'Use object shorthand: { foo } instead of { foo: foo }',
    'no-param-reassign':                  'Do not reassign function parameters — use a local variable',
    'no-return-assign':                   'Do not assign inside a return statement',
    'no-throw-literal':                   'Throw an Error object, not a literal: throw new Error("...")',
    'require-await':                      'Async function has no await — remove async or add await',
    'no-async-promise-executor':          'Do not use async function as Promise executor — use then/catch instead',
    'no-await-in-loop':                   '"await" inside a loop — consider Promise.all() for parallel execution',
    'no-promise-executor-return':         'Do not return a value from a Promise executor function',
    'prefer-promise-reject-errors':       'Promise.reject() should be called with an Error object',
    'no-restricted-globals':              'Restricted global — use a safer alternative',
    'consistent-return':                  'Function should either always or never return a value',
    'array-callback-return':              'Array method callback must return a value',
    'for-direction':                      'for loop direction is wrong — infinite loop risk',
    'getter-return':                      'getter must return a value',
    'no-constant-condition':              'Condition is always true or always false — check your logic',
    'no-dupe-keys':                       'Duplicate object key — the second value will silently overwrite the first',
    'no-duplicate-case':                  'Duplicate case in switch — one will never be reached',
    'no-empty':                           'Empty block statement — add code or a comment explaining why',
    'no-ex-assign':                       'Do not assign to the catch parameter',
    'no-extra-boolean-cast':              'Unnecessary boolean cast — remove the !! or Boolean()',
    'no-fallthrough':                     'switch case falls through — add break or /* falls through */ comment',
    'no-irregular-whitespace':            'Irregular whitespace character — use normal spaces',
    'no-unreachable':                     'Unreachable code after return/throw — remove the dead code',
    'valid-typeof':                       'Invalid typeof comparison — use "string", "number", etc.',
    // Security
    'no-secrets/no-secrets':              'Possible secret/token found in code — move to environment variable',
    'security/detect-eval-with-expression': 'eval() with dynamic expression — security risk',
    'security/detect-non-literal-regexp': 'RegExp with non-literal — potential ReDoS vulnerability',
    'security/detect-possible-timing-attacks': 'Possible timing attack — use crypto.timingSafeEqual()',
    // Accessibility
    'jsx-a11y/alt-text':                  'Image missing alt text — add accessibilityLabel or alt prop',
    'jsx-a11y/accessible-emoji':          'Emoji needs accessibility label — add aria-label or accessibilityLabel',
    'jsx-a11y/no-autofocus':              'autofocus disrupts screen readers — remove or handle carefully',
  };

  if (fixes[ruleId]) return fixes[ruleId];
  return message ?? `Fix the "${ruleId}" ESLint violation`;
}

// ═════════════════════════════════════════════════════════════════════════════
// CORE PARSING UTILITIES  (unchanged — used by regex-based scanners)
// ═════════════════════════════════════════════════════════════════════════════

function buildSafeMap(src) {
  const len  = src.length;
  const safe = new Uint8Array(len);
  let   i    = 0;
  while (i < len) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') { while (i < len && src[i] !== '\n') i++; continue; }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < len - 1 && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2; continue;
    }
    if (ch === '"' || ch === "'") {
      const q = ch; i++;
      while (i < len) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q)    { i++; break; }
        i++;
      }
      continue;
    }
    if (ch === '`') {
      i++;
      while (i < len) {
        if (src[i] === '\\')  { i += 2; continue; }
        if (src[i] === '`')   { i++; break; }
        if (src[i] === '$' && src[i + 1] === '{') {
          i += 2; let d = 1;
          while (i < len && d > 0) {
            if (src[i] === '\\') { i += 2; continue; }
            if (src[i] === '{')  { d++; safe[i] = 1; i++; continue; }
            if (src[i] === '}')  { d--; if (d > 0) safe[i] = 1; i++; continue; }
            safe[i] = 1; i++;
          }
          continue;
        }
        i++;
      }
      continue;
    }
    safe[i] = 1; i++;
  }
  return safe;
}

function blankNonCode(src) {
  const safe = buildSafeMap(src);
  const arr  = [];
  for (let i = 0; i < src.length; i++) {
    arr.push(safe[i] ? src[i] : (src[i] === '\n' ? '\n' : ' '));
  }
  return arr.join('');
}

function findClosing(src, openIdx, openCh, closeCh) {
  let depth = 0, i = openIdx;
  const len = src.length;
  while (i < len) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') { while (i < len && src[i] !== '\n') i++; continue; }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < len - 1 && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2; continue;
    }
    if (ch === '"' || ch === "'") {
      const q = ch; i++;
      while (i < len) { if (src[i] === '\\') { i += 2; continue; } if (src[i] === q) { i++; break; } i++; }
      continue;
    }
    if (ch === '`') {
      i++;
      while (i < len) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '`')  { i++; break; }
        if (src[i] === '$' && src[i + 1] === '{') {
          i += 2; let d = 1;
          while (i < len && d > 0) {
            if (src[i] === '\\') { i += 2; continue; }
            if (src[i] === '{') d++;
            if (src[i] === '}') { if (--d === 0) break; }
            i++;
          }
          if (i < len) i++; continue;
        }
        i++;
      }
      continue;
    }
    if (ch === openCh)  depth++;
    if (ch === closeCh) { if (--depth === 0) return i; }
    i++;
  }
  return -1;
}

function buildLineIndex(src) {
  const idx = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') idx.push(i + 1);
  return idx;
}

function lineOf(lineIndex, charIdx) {
  let lo = 0, hi = lineIndex.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineIndex[mid] <= charIdx) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

function containsJSX(src) {
  const safe = buildSafeMap(src);
  const re   = /<[A-Za-z][A-Za-z0-9.]*[\s\/>]/g;
  let   m;
  while ((m = re.exec(src)) !== null) if (safe[m.index]) return true;
  return false;
}

// ─── File helpers ─────────────────────────────────────────────────────────────

function walk(dir, depth = 0) {
  if (!fs.existsSync(dir) || depth > MAX_DEPTH) return [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!e.name.startsWith('.') && !SKIP_DIRS.has(e.name)) out.push(...walk(full, depth + 1));
      continue;
    }
    if (!e.isFile()) continue;
    if (!EXTENSIONS.has(path.extname(e.name)))   continue;
    if (/\.min\.[jt]sx?$/.test(e.name))          continue;
    if (/\.d\.[jt]s$/.test(e.name))              continue;
    if (/\.(test|spec)\.[jt]sx?$/.test(e.name))  continue;
    let size; try { size = fs.statSync(full).size; } catch { continue; }
    if (size > MAX_FILE_KB * 1024) continue;
    out.push(full);
  }
  return out;
}

const readSrc = fp => { try { return fs.readFileSync(fp, 'utf8'); } catch { return null; } };
const relPath = fp => path.relative(process.cwd(), fp).replace(/\\/g, '/');

// ═════════════════════════════════════════════════════════════════════════════
// REGEX-BASED SCANNERS  (kept for patterns tsc/eslint miss or run too slow for)
// ═════════════════════════════════════════════════════════════════════════════

const COMP_OPEN_RE = /^(?:export\s+(?:default\s+)?)?(?:(?:async\s+)?function\s+((?:[A-Z]\w*)|(?:use[A-Z]\w*))\s*[<(]|(?:const|let)\s+((?:[A-Z]\w*)|(?:use[A-Z]\w*))\s*=\s*(?:React\.memo\s*\(\s*)?(?:React\.forwardRef\s*\(\s*)?(?:async\s*)?\s*\()/;
const COND_OPEN_RE = /^(?:if|else\s+if|else|switch)\b/;
const LOOP_OPEN_RE = /^(?:for|while|do)\b/;

function scanHookInJsxProp(filePath, src) {
  const ext = path.extname(filePath);
  if (!['.tsx', '.jsx'].includes(ext) && !containsJSX(src)) return;
  const safe      = buildSafeMap(src);
  const lineIndex = buildLineIndex(src);
  const srcLines  = src.split('\n');
  const re        = /\b(\w+)\s*=\s*\{\s*(use[A-Z]\w*)\s*\(/g;
  let   m;
  while ((m = re.exec(src)) !== null) {
    if (!safe[m.index]) continue;
    const propName = m[1];
    const hookName = m[2];
    const ln       = lineOf(lineIndex, m.index);
    const line     = srcLines[ln - 1] ?? '';
    const trimmed  = line.trimStart();
    if (/^(?:export\s+)?(?:const|let|var)\s/.test(trimmed)) continue;
    if (/^(?:function|async\s+function)/.test(trimmed))     continue;
    const jsxPropRe = /^(?:on[A-Z]|style|value|key|ref|data-|aria-|class|id|type|href|src|alt|title|placeholder|disabled|checked|selected|multiple|required|readOnly|autoFocus|tab)/i;
    const looksLikeJsxProp = jsxPropRe.test(propName) ||
      /<[A-Za-z]/.test(srcLines.slice(Math.max(0, ln - 3), ln + 1).join(' '));
    if (!looksLikeJsxProp) continue;
    push('hookInJsxProp', {
      file: relPath(filePath), line: ln, hook: hookName, severity: 'error',
      code: trimmed.slice(0, 100),
      fix:  `Extract ${hookName}() to a const above the return statement — hooks cannot be JSX prop values`,
    });
  }
}

function analyzeHookUsage(filePath, src) {
  const ext = path.extname(filePath);
  if (!['.tsx', '.jsx'].includes(ext) && !containsJSX(src)) return;
  if (!/\buse[A-Z]/.test(src)) return;
  const code      = blankNonCode(src);
  const srcLines  = src.split('\n');
  const lineIndex = buildLineIndex(src);
  const codeLines = code.split('\n');
  const bodies    = [];
  for (let li = 0; li < codeLines.length; li++) {
    const trimmed = codeLines[li].trimStart();
    const m       = trimmed.match(COMP_OPEN_RE);
    if (!m) continue;
    const name = m[1] ?? m[2];
    if (!name) continue;
    const lineCharStart = lineIndex[li] ?? 0;
    let   braceIdx      = -1;
    const searchEnd     = Math.min(code.length, lineCharStart + 600);
    for (let ci = lineCharStart; ci < searchEnd; ci++) {
      if (code[ci] === '{') { braceIdx = ci; break; }
    }
    if (braceIdx === -1) continue;
    const closeIdx = findClosing(src, braceIdx, '{', '}');
    if (closeIdx === -1) continue;
    const bodyContent = src.slice(braceIdx + 1, closeIdx);
    if (bodyContent.split('\n').length < 5) continue;
    if (!/\buse[A-Z]/.test(bodyContent)) continue;
    if (bodies.some(b => Math.abs(b.bodyStart - braceIdx) < 10)) continue;
    bodies.push({ name, bodyStart: braceIdx, bodyEnd: closeIdx, startLine: li + 1 });
  }
  for (const body of bodies) scanBodyForHookViolations(body, src, code, srcLines, lineIndex, filePath);
}

function scanBodyForHookViolations(body, src, code, srcLines, lineIndex, filePath) {
  const { name, bodyStart, bodyEnd } = body;
  const bodySrc       = src.slice(bodyStart + 1, bodyEnd);
  const bodyCode      = code.slice(bodyStart + 1, bodyEnd);
  const bodyLines     = bodySrc.split('\n');
  const codeBodyLines = bodyCode.split('\n');
  const offset        = bodyStart + 1;
  const stack         = [];
  let   depth         = 0;
  const lineOffsets   = [0];
  for (let i = 0; i < bodyLines.length - 1; i++)
    lineOffsets.push(lineOffsets[i] + bodyLines[i].length + 1);
  for (let li = 0; li < bodyLines.length; li++) {
    const rawLine  = bodyLines[li];
    const codeLine = codeBodyLines[li] ?? '';
    const trimmed  = rawLine.trimStart();
    const opens    = (codeLine.match(/\{/g) ?? []).length;
    const closes   = (codeLine.match(/\}/g) ?? []).length;
    if (opens > closes && trimmed.length > 0 && li > 0) {
      if (COND_OPEN_RE.test(trimmed))        stack.push({ type: 'cond', openDepth: depth + 1 });
      else if (LOOP_OPEN_RE.test(trimmed))   stack.push({ type: 'loop', openDepth: depth + 1 });
      else if (opensNestedFunction(trimmed)) stack.push({ type: 'fn',   openDepth: depth + 1 });
    }
    depth += opens - closes;
    if (depth < 0) depth = 0;
    while (stack.length > 0 && depth < stack[stack.length - 1].openDepth) stack.pop();
    if (!trimmed.includes('use')) continue;
    if (/^(?:export\s+)?(?:async\s+)?function\s+use[A-Z]/.test(trimmed)) continue;
    if (/^(?:export\s+)?(?:const|let)\s+use[A-Z]\w*\s*=/.test(trimmed))  continue;
    if (/^import\s/.test(trimmed))                                         continue;
    if (/^(?:type|interface)\s/.test(trimmed))                            continue;
    if (/_inlineHook\d|_extracteduse|_rescued/.test(trimmed))             continue;
    const hookRe = /\b(use[A-Z]\w*)\s*\(/g;
    let   hm;
    while ((hm = hookRe.exec(rawLine)) !== null) {
      const hookName  = hm[1];
      const before    = rawLine.slice(0, hm.index).trimEnd();
      if (/(?:function|const|let|var)\s+$/.test(before)) continue;
      const innermost = stack[stack.length - 1];
      if (!innermost) continue;
      const charInBody = lineOffsets[li] + hm.index;
      const absChar    = offset + charInBody;
      const ln         = lineOf(lineIndex, absChar);
      const snippet    = srcLines[ln - 1]?.trimStart().slice(0, 100) ?? '';
      if (innermost.type === 'cond') {
        push('hookInConditional', { file: relPath(filePath), line: ln, hook: hookName, severity: 'error', code: snippet, fix: `Move ${hookName}() to the top level of ${name} — hooks cannot be inside conditionals` });
      } else if (innermost.type === 'loop') {
        push('hookInLoop', { file: relPath(filePath), line: ln, hook: hookName, severity: 'error', code: snippet, fix: `Move ${hookName}() to the top level of ${name} — hooks cannot be inside loops` });
      } else if (innermost.type === 'fn') {
        if (stack.filter(s => s.type === 'fn').length >= 2) {
          push('hookInCallback', { file: relPath(filePath), line: ln, hook: hookName, severity: 'error', code: snippet, fix: `${hookName}() is inside a nested function inside ${name} — hooks cannot be inside callbacks` });
        }
      }
    }
  }
}

function opensNestedFunction(trimmed) {
  if (/(?:\)|\w)\s*=>\s*\{/.test(trimmed)) {
    if (/^type\s/.test(trimmed) || /^interface\s/.test(trimmed)) return false;
    if (COMP_OPEN_RE.test(trimmed)) return false;
    return true;
  }
  if (/\bfunction\s*(?:\*\s*)?[a-z_$]?\w*\s*\(/.test(trimmed)) {
    if (COMP_OPEN_RE.test(trimmed)) return false;
    return true;
  }
  return false;
}

function scanMissingDepArrays(filePath, src) {
  const code      = blankNonCode(src);
  const lineIndex = buildLineIndex(src);
  const re        = /\buseEffect\s*\(/g;
  let   m;
  while ((m = re.exec(code)) !== null) {
    const op = m.index + m[0].length - 1;
    const cp = findClosing(src, op, '(', ')');
    if (cp === -1) continue;
    const inner = code.slice(op + 1, cp);
    let depth = 0, commas = 0;
    for (const ch of inner) {
      if ('([{'.includes(ch)) depth++;
      if (')]}'.includes(ch)) depth--;
      if (ch === ',' && depth === 0) commas++;
    }
    if (commas === 0) push('missingDepArray', { file: relPath(filePath), line: lineOf(lineIndex, m.index), severity: 'warn', fix: 'useEffect has no dependency array — add [] to run once, or [dep1, dep2] to react to changes' });
  }
}

const STABLE_NAMES = new Set([
  'dispatch','setState','navigate','router','navigation','console','Math','Date','JSON',
  'Object','Array','Promise','Number','String','Boolean','Symbol','window','document',
  'navigator','global','process','true','false','null','undefined','NaN','Infinity',
  'parseInt','parseFloat','isNaN','isFinite','encodeURIComponent','decodeURIComponent',
  'setTimeout','setInterval','clearTimeout','clearInterval','requestAnimationFrame',
  'cancelAnimationFrame','Alert','Linking','Platform','Dimensions','StyleSheet','Animated',
]);
const SKIP_TOKEN = /^(use[A-Z]|set[A-Z]|async|await|return|const|let|var|if|else|for|while|new|typeof|instanceof|this|of|in|from|import|export|default|function|class|extends|switch|case|break|continue|throw|try|catch|finally|delete|yield|static|get|set|do|void|true|false|null|undefined)$/;

function scanStaleClosure(filePath, src) {
  const code      = blankNonCode(src);
  const lineIndex = buildLineIndex(src);
  const re        = /\b(useEffect|useCallback|useMemo)\s*\(/g;
  let   m;
  while ((m = re.exec(code)) !== null) {
    const op = m.index + m[0].length - 1;
    const cp = findClosing(src, op, '(', ')');
    if (cp === -1) continue;
    const inner = code.slice(op + 1, cp);
    let depth = 0, lastComma = -1;
    for (let i = 0; i < inner.length; i++) {
      if ('([{'.includes(inner[i])) depth++;
      if (')]}'.includes(inner[i])) depth--;
      if (inner[i] === ',' && depth === 0) lastComma = i;
    }
    if (lastComma === -1) continue;
    const depPart  = inner.slice(lastComma + 1).trim();
    const bodyPart = inner.slice(0, lastComma);
    if (!/^\[\s*\]/.test(depPart)) continue;
    const tokens   = (bodyPart.match(/\b[a-z_$][a-zA-Z0-9_$]*\b/g) ?? []);
    const suspects = [...new Set(tokens.filter(v => v.length > 1 && !STABLE_NAMES.has(v) && !SKIP_TOKEN.test(v)))];
    if (!suspects.length) continue;
    const declRe   = /(?:const|let|var)\s+(?:\[(\w+)[^\]]*\]|(\w+))\s*=/g;
    const declared = new Set();
    let   dm;
    while ((dm = declRe.exec(src.slice(0, m.index))) !== null) {
      if (dm[1]) declared.add(dm[1]);
      if (dm[2]) declared.add(dm[2]);
    }
    const confirmed = suspects.filter(v => declared.has(v));
    if (!confirmed.length) continue;
    push('staleClosure', { file: relPath(filePath), line: lineOf(lineIndex, m.index), hook: m[1], severity: 'warn', detail: `empty [] but body may reference: ${confirmed.slice(0, 6).join(', ')}`, fix: `Add to dep array: [${confirmed.slice(0, 4).join(', ')}]` });
  }
}

function scanMemoryLeaks(filePath, src) {
  const code      = blankNonCode(src);
  const lineIndex = buildLineIndex(src);
  const re        = /\buseEffect\s*\(/g;
  let   m;
  while ((m = re.exec(code)) !== null) {
    const op = m.index + m[0].length - 1;
    const cp = findClosing(src, op, '(', ')');
    if (cp === -1) continue;
    const inner     = src.slice(op + 1, cp);
    const codeInner = code.slice(op + 1, cp);
    let depth = 0, lastComma = -1;
    for (let i = 0; i < codeInner.length; i++) {
      if ('([{'.includes(codeInner[i])) depth++;
      if (')]}'.includes(codeInner[i])) depth--;
      if (codeInner[i] === ',' && depth === 0) lastComma = i;
    }
    const callback   = lastComma === -1 ? inner : inner.slice(0, lastComma);
    const cleanupM   = /\breturn\s*(?:\(\s*\)\s*=>|function\s*\()/.exec(callback);
    const cleanupSrc = cleanupM ? callback.slice(cleanupM.index) : '';
    const effectLine = lineOf(lineIndex, m.index);
    const addCount   = (callback.match(/\.addEventListener\s*\(/g)    ?? []).length;
    const rmCount    = (callback.match(/\.removeEventListener\s*\(/g) ?? []).length;
    if (addCount > rmCount && (cleanupSrc.match(/\.removeEventListener\s*\(/g) ?? []).length < addCount)
      push('memoryLeaks', { file: relPath(filePath), line: effectLine, severity: 'error', detail: `${addCount} addEventListener, ${rmCount} removeEventListener in this useEffect`, fix: 'Return a cleanup: return () => element.removeEventListener(event, handler)' });
    const timerCount = (callback.match(/\b(?:setInterval|setTimeout)\s*\(/g)    ?? []).length;
    const clearCount = (callback.match(/\b(?:clearInterval|clearTimeout)\s*\(/g) ?? []).length;
    if (timerCount > clearCount && (cleanupSrc.match(/\b(?:clearInterval|clearTimeout)\s*\(/g) ?? []).length < timerCount)
      push('memoryLeaks', { file: relPath(filePath), line: effectLine, severity: 'error', detail: `${timerCount} timer(s) started, ${clearCount} cleared in this useEffect`, fix: 'Return a cleanup: return () => clearInterval(id) / clearTimeout(id)' });
    const subCount   = (callback.match(/\.subscribe\s*\(/g)   ?? []).length;
    const unsubCount = (callback.match(/\.unsubscribe\s*\(/g) ?? []).length;
    if (subCount > unsubCount && (cleanupSrc.match(/\.unsubscribe\s*\(/g) ?? []).length < subCount)
      push('memoryLeaks', { file: relPath(filePath), line: effectLine, severity: 'warn', detail: `${subCount} .subscribe(), ${unsubCount} .unsubscribe() in this useEffect`, fix: 'Return a cleanup: return () => subscription.unsubscribe()' });
  }
}

function scanAnyTypes(filePath, src) {
  if (!['.ts', '.tsx'].includes(path.extname(filePath))) return;
  const safe      = buildSafeMap(src);
  const lineIndex = buildLineIndex(src);
  const srcLines  = src.split('\n');
  const reported  = new Set();
  const check = (re, fixMsg) => {
    let m;
    while ((m = re.exec(src)) !== null) {
      if (!safe[m.index]) continue;
      const ln = lineOf(lineIndex, m.index);
      if (reported.has(ln)) continue;
      const line = srcLines[ln - 1] ?? '';
      if (line.includes('eslint-disable')) continue;
      reported.add(ln);
      push('anyTypes', { file: relPath(filePath), line: ln, severity: 'warn', code: line.trimStart().slice(0, 90), fix: fixMsg });
    }
  };
  check(/:\s*any\b/g,    '": any" — replace with a specific type or "unknown"');
  check(/\bas\s+any\b/g, '"as any" cast — use "as unknown" then narrow');
}

function scanAsyncNoTryCatch(filePath, src) {
  const code      = blankNonCode(src);
  const lineIndex = buildLineIndex(src);
  const re        = /\basync\s+(?:function\s*\*?\s*\w*\s*\(|(?:\([^)]*\)|\w+)\s*=>)\s*\{/g;
  let   m;
  while ((m = re.exec(code)) !== null) {
    let bi = m.index + m[0].length - 1;
    while (bi < code.length && code[bi] !== '{') bi++;
    if (bi >= code.length) continue;
    const ci = findClosing(src, bi, '{', '}');
    if (ci === -1) continue;
    const body = code.slice(bi + 1, ci);
    if (!/\bawait\b/.test(body)) continue;
    if (/\btry\s*\{/.test(body)) continue;
    if (body.includes('.catch('))  continue;
    push('asyncNoTryCatch', { file: relPath(filePath), line: lineOf(lineIndex, m.index), severity: 'warn', fix: 'Async function uses await without try/catch — wrap in try/catch to handle errors' });
  }
}

function scanScrollViewAbuse(filePath, src) {
  if (!['.tsx', '.jsx'].includes(path.extname(filePath))) return;
  const safe      = buildSafeMap(src);
  const lineIndex = buildLineIndex(src);
  const re        = /<ScrollView\b/g;
  let   m;
  while ((m = re.exec(src)) !== null) {
    if (!safe[m.index]) continue;
    const closeTag = '</ScrollView>';
    const closeIdx = src.indexOf(closeTag, m.index);
    const end      = closeIdx === -1 ? Math.min(src.length, m.index + 4000) : closeIdx + closeTag.length;
    const block    = src.slice(m.index, end);
    if (block.includes('.map(') && !block.includes('FlatList') && !block.includes('LegendList') && !block.includes('FlashList') && !block.includes('SectionList') && !block.includes('VirtualizedList')) {
      push('scrollViewAbuse', { file: relPath(filePath), line: lineOf(lineIndex, m.index), severity: 'warn', fix: 'ScrollView + .map() renders all items at once — use FlashList or FlatList for virtualization' });
    }
  }
}

function scanMapNoKey(filePath, src) {
  if (!['.tsx', '.jsx'].includes(path.extname(filePath))) return;
  const code      = blankNonCode(src);
  const safe      = buildSafeMap(src);
  const lineIndex = buildLineIndex(src);
  const srcLines  = src.split('\n');
  const re        = /\.map\s*\(/g;
  let   m;
  while ((m = re.exec(code)) !== null) {
    if (!safe[m.index]) continue;
    const op = m.index + m[0].length - 1;
    const cp = findClosing(src, op, '(', ')');
    if (cp === -1) continue;
    const body = src.slice(op + 1, cp);
    if (!/<[A-Za-z]/.test(body)) continue;
    if (/\bkey\s*=/.test(body))   continue;
    if (!/(?:=>\s*[\n\s]*<|=>\s*\([\n\s]*<)/.test(body) && !/=>\s*</.test(body)) continue;
    const ln = lineOf(lineIndex, m.index);
    push('mapNoKey', { file: relPath(filePath), line: ln, severity: 'error', code: srcLines[ln - 1]?.trimStart().slice(0, 90) ?? '', fix: 'Add key={item.id} (or stable unique value) to the root JSX element in .map()' });
  }
}

function scanInlineStyleObjects(filePath, src) {
  if (!['.tsx', '.jsx'].includes(path.extname(filePath))) return;
  const safe      = buildSafeMap(src);
  const lineIndex = buildLineIndex(src);
  const srcLines  = src.split('\n');
  const re        = /\b(?:style|contentContainerStyle|headerStyle|containerStyle|inputContainerStyle)\s*=\s*\{\s*\{/g;
  let   m;
  while ((m = re.exec(src)) !== null) {
    if (!safe[m.index]) continue;
    const ln   = lineOf(lineIndex, m.index);
    const line = srcLines[ln - 1] ?? '';
    if (/\bstyles\.\w+/.test(line)) continue;
    push('inlineStyleObjects', { file: relPath(filePath), line: ln, severity: 'warn', code: line.trimStart().slice(0, 90), fix: 'Move to StyleSheet.create() or useMemo() — inline objects create new references every render' });
  }
}

function scanLargeFiles(filePath, src) {
  const n = src.split('\n').length;
  if (n <= 400) return;
  push('largeFiles', { file: relPath(filePath), lines: n, severity: n > 800 ? 'error' : 'warn', fix: `${n} lines — split into smaller modules (aim for <300 lines each)` });
}

function scanMissingMemo(filePath, src) {
  if (!['.tsx', '.jsx'].includes(path.extname(filePath))) return;
  const rel = relPath(filePath);
  if (/(?:^|[/\\])app[/\\]/.test(rel))                          return;
  if (/(?:screen|page|layout|modal)\.[jt]sx?$/.test(rel))       return;
  if (/(?:screens?|pages?|routes?|navigation)[/\\]/i.test(rel)) return;
  if (/\bReact\.memo\b|\bmemo\s*\(/.test(src))                  return;
  const exportedComps = [...src.matchAll(/^export\s+(?:default\s+)?(?:function\s+[A-Z]|const\s+[A-Z])/gm)];
  if (exportedComps.length !== 1) return;
  const compRe = /^export\s+(?:default\s+)?(?:function\s+([A-Z]\w*)|const\s+([A-Z]\w*)\s*=)/m;
  const cm     = compRe.exec(src);
  if (!cm) return;
  const name    = cm[1] ?? cm[2];
  const lineNum = src.slice(0, cm.index).split('\n').length + 1;
  const srcLines = src.split('\n');
  const block   = srcLines.slice(lineNum - 1, lineNum + 5).join(' ');
  if (!/\(\s*\{/.test(block) && !/\(\s*props\s*[):,]/.test(block)) return;
  push('missingMemo', { file: relPath(filePath), line: lineNum, name, severity: 'info', fix: `Wrap in React.memo: export default React.memo(${name})` });
}

// ═════════════════════════════════════════════════════════════════════════════
// DEAD EXPORTS
// ═════════════════════════════════════════════════════════════════════════════

function scanDeadExports(files) {
  if (!DEAD_EXPORTS) return;
  const exportMap   = new Map();
  const importedSet = new Set();
  for (const fp of files) {
    const src = readSrc(fp);
    if (!src) continue;
    const rel = relPath(fp);
    if (/(?:^|[/\\])app[/\\]/.test(rel))    continue;
    if (/(?:^|[/\\])pages[/\\]/.test(rel))  continue;
    if (/(?:^|[/\\])server[/\\]/.test(rel)) continue;
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trimStart().startsWith('//')) continue;
      const namedM = line.match(/^export\s+(?:default\s+)?(?:const|function\s*\*?|class|abstract\s+class)\s+(\w+)/);
      if (namedM) { exportMap.set(namedM[1], { file: rel, line: i + 1 }); continue; }
      const groupM = line.match(/^export\s+\{([^}]+)\}(?:\s+from\s+['"][^'"]+['"])?/);
      if (groupM && !line.includes('export type')) {
        for (const seg of groupM[1].split(',')) {
          const name = seg.trim().split(/\s+as\s+/).pop()?.trim();
          if (name && /^\w+$/.test(name)) exportMap.set(name, { file: rel, line: i + 1 });
        }
      }
    }
  }
  for (const fp of files) {
    const src = readSrc(fp);
    if (!src) continue;
    const addName = n => { if (n && /^\w+$/.test(n)) importedSet.add(n); };
    for (const m of src.matchAll(/\bimport\s+(?:type\s+)?\{([^}]+)\}/g))
      m[1].split(',').forEach(s => addName(s.trim().split(/\s+as\s+/)[0].trim()));
    for (const m of src.matchAll(/\bimport\s+(?:type\s+)?(\w+)\s+from\b/g)) addName(m[1]);
    for (const m of src.matchAll(/\bimport\s+(\w+)\s*,\s*\{([^}]+)\}/g)) {
      addName(m[1]);
      m[2].split(',').forEach(s => addName(s.trim().split(/\s+as\s+/)[0].trim()));
    }
    for (const m of src.matchAll(/\bexport\s+(?:type\s+)?\{([^}]+)\}\s+from\b/g))
      m[1].split(',').forEach(s => addName(s.trim().split(/\s+as\s+/)[0].trim()));
    for (const m of src.matchAll(/<([A-Z]\w*)\b/g)) addName(m[1]);
    for (const m of src.matchAll(/(?:const|let|var)\s+\{([^}]+)\}\s*=\s*require\s*\(/g))
      m[1].split(',').forEach(s => addName(s.trim()));
  }
  const SKIP_NAMES = new Set(['default', 'App', 'Root', 'Provider']);
  const ENTRY_RE   = /(?:index|App|_app|_layout|entry|main|\+not-found|\+error)\.[jt]sx?$/;
  for (const [name, info] of exportMap) {
    if (importedSet.has(name))    continue;
    if (SKIP_NAMES.has(name))     continue;
    if (ENTRY_RE.test(info.file)) continue;
    push('deadExports', { file: info.file, line: info.line, name, severity: 'info', fix: `'${name}' is never imported — remove the export or add to an index.ts barrel` });
  }
  issues.deadExports.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

// ═════════════════════════════════════════════════════════════════════════════
// CIRCULAR DEPS
// ═════════════════════════════════════════════════════════════════════════════

function scanCircularDeps(files) {
  const fileSet  = new Set(files.map(f => path.resolve(f)));
  const graph    = new Map();
  const reported = new Set();
  const EXTS     = ['.ts', '.tsx', '.js', '.jsx'];
  const resolve  = (from, spec) => {
    if (!spec.startsWith('.')) return null;
    const base = path.resolve(path.dirname(from), spec);
    if (fileSet.has(base)) return base;
    for (const ext of EXTS) { const c = base + ext; if (fileSet.has(c)) return c; }
    for (const ext of EXTS) { const c = path.join(base, `index${ext}`); if (fileSet.has(c)) return c; }
    return null;
  };
  for (const fp of files) {
    const src  = readSrc(fp);
    if (!src) continue;
    const code = blankNonCode(src);
    const deps = new Set();
    for (const m of code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
      const r = resolve(fp, m[1]);
      if (r && r !== path.resolve(fp)) deps.add(r);
    }
    graph.set(path.resolve(fp), deps);
  }
  const visited  = new Set();
  const recStack = new Set();
  function dfs(start) {
    const stack = [{ node: start, iter: null }];
    const chain = [start];
    recStack.add(start); visited.add(start);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (!frame.iter) frame.iter = (graph.get(frame.node) ?? new Set()).values();
      const { value: next, done } = frame.iter.next();
      if (done) { stack.pop(); chain.pop(); recStack.delete(frame.node); continue; }
      if (recStack.has(next)) {
        const idx = chain.indexOf(next);
        if (idx !== -1) {
          const cycle = chain.slice(idx).concat(next);
          const key   = [...cycle].map(f => relPath(f)).sort().join('|');
          if (!reported.has(key)) {
            reported.add(key);
            push('circularDeps', { cycle: cycle.map(f => relPath(f)).join(' → '), length: cycle.length - 1, severity: 'error', fix: 'Extract shared logic to a third module that neither file imports' });
          }
        }
        continue;
      }
      if (!visited.has(next)) {
        visited.add(next); recStack.add(next); chain.push(next);
        stack.push({ node: next, iter: null });
      }
    }
  }
  for (const fp of files) { const abs = path.resolve(fp); if (!visited.has(abs)) dfs(abs); }
  issues.circularDeps.sort((a, b) => a.length - b.length);
}

// ═════════════════════════════════════════════════════════════════════════════
// OUTPUT
// ═════════════════════════════════════════════════════════════════════════════

function outputJSON() {
  const summary = {};
  let total = 0;
  for (const [k, v] of Object.entries(issues)) { summary[k] = v.length; total += v.length; }
  process.stdout.write(JSON.stringify({ summary, total, issues }, null, 2) + '\n');
}

const SEV_ICON = { error: c.red('✖'), warn: c.yellow('⚠'), info: c.cyan('ℹ') };

function printIssue(item) {
  const { severity = 'warn', label, file, line, col, detail, code, fix } = item;
  const icon     = SEV_ICON[severity] ?? SEV_ICON.warn;
  const location = line ? `${c.dim(':')}${c.yellow(String(line))}${col ? c.dim(':') + c.dim(String(col)) : ''}` : '';
  if (label)  console.log(`  ${icon}  ${c.bold(label)}`);
  if (file)   console.log(`     ${c.dim('File')}  : ${c.cyan(file)}${location}`);
  if (detail) console.log(`     ${c.dim('Info')}  : ${detail}`);
  if (code)   console.log(`     ${c.dim('Code')}  : ${c.dim(code)}`);
  if (fix)    console.log(`     ${c.dim('Fix ')}  : ${fix}`);
}

function printSection(title, items, { hideIfEmpty = false } = {}) {
  if (!items.length) {
    if (hideIfEmpty) return;
    console.log(`\n${c.green('✔')} ${c.bold(title)}: ${c.gray('none')}`);
    return;
  }
  const counts = { error: 0, warn: 0, info: 0 };
  for (const it of items) counts[it.severity ?? 'warn']++;
  const badge = counts.error > 0 ? c.red(`${counts.error} error${counts.error > 1 ? 's' : ''}`)
              : counts.warn  > 0 ? c.yellow(`${counts.warn} warning${counts.warn > 1 ? 's' : ''}`)
              : c.cyan(`${counts.info} info`);
  const total = items.length;
  console.log(`\n${'─'.repeat(72)}`);
  console.log(`  ${c.bold(title)}  — ${badge}${total > SHOW_LIMIT ? c.dim(` (showing ${SHOW_LIMIT} of ${total})`) : ''}`);
  console.log(`${'─'.repeat(72)}`);
  for (const it of items.slice(0, SHOW_LIMIT)) { printIssue(it); console.log(); }
  if (total > SHOW_LIMIT)
    console.log(c.dim(`  … and ${total - SHOW_LIMIT} more. Use --limit=N or --json to see all.\n`));
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN
// ═════════════════════════════════════════════════════════════════════════════

if (!JSON_OUTPUT) {
  console.log(c.bold('╔══════════════════════════════════════════════════════════════╗'));
  console.log(c.bold('║         fix-report.js  —  Manual Fix Guide                  ║'));
  console.log(c.bold('╚══════════════════════════════════════════════════════════════╝'));
  console.log();
}

// ── Run real tools first ──────────────────────────────────────────────────────

if (!JSON_OUTPUT) console.log(c.bold('Running type checkers...\n'));
runTsc();
runEslint();
if (!JSON_OUTPUT) console.log();

// ── Regex-based scans ─────────────────────────────────────────────────────────

const allFiles = TARGET_DIRS.flatMap(d => walk(d));
const files    = ONLY_PATTERN ? allFiles.filter(f => f.includes(ONLY_PATTERN)) : allFiles;

if (!JSON_OUTPUT) console.log(`Scanning ${c.bold(String(files.length))} files with pattern checks...\n`);

for (const fp of files) {
  const src = readSrc(fp);
  if (!src || !src.trim()) continue;
  const run = fn => {
    try { fn(fp, src); }
    catch (e) {
      if (VERBOSE) console.error(c.red(`[ERR] ${fn.name} on ${relPath(fp)}: ${e.message}\n${e.stack}`));
    }
  };
  run(scanLargeFiles);
  run(scanHookInJsxProp);
  run(analyzeHookUsage);
  run(scanMissingDepArrays);
  run(scanMemoryLeaks);
  run(scanStaleClosure);
  run(scanScrollViewAbuse);
  run(scanMapNoKey);
  run(scanAnyTypes);
  run(scanAsyncNoTryCatch);
  run(scanInlineStyleObjects);
  run(scanMissingMemo);
}

try { scanDeadExports(files);  } catch (e) { console.error(c.red(`Dead export scan failed: ${e.message}`)); }
try { scanCircularDeps(files); } catch (e) { console.error(c.red(`Circular dep scan failed: ${e.message}`)); }

if (JSON_OUTPUT) { outputJSON(); process.exit(0); }

// ── Print sections ────────────────────────────────────────────────────────────

printSection('HOOK USED AS JSX PROP VALUE',   issues.hookInJsxProp);
printSection('HOOK IN CONDITIONAL',           issues.hookInConditional);
printSection('HOOK IN LOOP',                  issues.hookInLoop);
printSection('HOOK INSIDE NESTED FUNCTION',   issues.hookInCallback);
printSection('MEMORY LEAKS',                  issues.memoryLeaks);
printSection('STALE CLOSURES',                issues.staleClosure);
printSection('MISSING DEP ARRAY',             issues.missingDepArray);
printSection('SCROLLVIEW + .map() ABUSE',     issues.scrollViewAbuse);
printSection('MAP() WITHOUT KEY PROP',        issues.mapNoKey);
printSection('INLINE STYLE OBJECTS',          issues.inlineStyleObjects);
printSection('any TYPE USAGE',                issues.anyTypes);
printSection('TYPESCRIPT ERRORS (tsc)',       issues.tsErrors);
printSection('ESLINT VIOLATIONS',             issues.eslintErrors);
printSection('ASYNC WITHOUT TRY/CATCH',       issues.asyncNoTryCatch);
printSection('LARGE FILES',                   issues.largeFiles);
printSection('MISSING React.memo',            issues.missingMemo);
printSection('CIRCULAR DEPENDENCIES',         issues.circularDeps);
printSection('DEAD EXPORTS',                  issues.deadExports, { hideIfEmpty: !DEAD_EXPORTS });

// ── Summary ───────────────────────────────────────────────────────────────────

const flat       = Object.values(issues).flat();
const total      = flat.length;
const errorCount = flat.filter(i => i.severity === 'error').length;
const warnCount  = flat.filter(i => i.severity === 'warn').length;
const infoCount  = flat.filter(i => i.severity === 'info').length;

console.log(`\n${'═'.repeat(72)}`);
console.log(`  ${c.bold('TOTAL ISSUES')} : ${c.bold(String(total))}`);
console.log(`  ${c.red('Errors')}       : ${errorCount}`);
console.log(`  ${c.yellow('Warnings')}     : ${warnCount}`);
console.log(`  ${c.cyan('Info')}          : ${infoCount}`);
console.log(`${'═'.repeat(72)}`);

console.log(`
  ${c.bold('Fix priority:')}
  ${c.red('1.')}  Circular deps              → architecture / tree-shaking
  ${c.red('2.')}  Hook as JSX prop value     → Rules of Hooks (crash)
  ${c.red('3.')}  Hook in conditional        → Rules of Hooks (crash)
  ${c.red('4.')}  Hook in loop               → Rules of Hooks (crash)
  ${c.red('5.')}  Hook inside callback       → Rules of Hooks (crash)
  ${c.red('6.')}  map() without key          → reconciliation errors
  ${c.red('7.')}  Memory leaks               → crashes & perf degradation
  ${c.red('8.')}  TypeScript errors (tsc)    → type safety / crashes
  ${c.red('9.')}  ESLint violations          → bugs / deprecated APIs / style
  ${c.yellow('10.')} Stale closures             → subtle bugs
  ${c.yellow('11.')} Missing dep array          → infinite loops or stale data
  ${c.yellow('12.')} Async without catch        → silent failures
  ${c.yellow('13.')} ScrollView + .map()        → no virtualization
  ${c.yellow('14.')} Inline style objects       → unnecessary re-renders
  ${c.yellow('15.')} any type usage             → masked runtime errors
  ${c.cyan('16.')} Missing React.memo         → optimization
  ${c.cyan('17.')} Large files                → maintainability
  ${c.cyan('18.')} Dead exports               → bundle size (run with --dead-exports)
`);

console.log(c.dim('  Flags: --json | --verbose | --only=<path> | --limit=N | --dead-exports | --skip-tsc | --skip-eslint'));
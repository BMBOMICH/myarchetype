// project-scanner.js — ULTIMATE PROJECT SCANNER v5.1
// Run: node project-scanner.js
// Out: project-audit.json + project-audit-report.txt

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = process.cwd();
const OUTPUT_JSON = 'project-audit.json';
const OUTPUT_TEXT = 'project-audit-report.txt';

const IGNORE_DIRS = new Set([
  'node_modules','.git','.expo','dist','build','.next','coverage','.turbo',
  '__pycache__','android','ios','.cache','.parcel-cache','.svelte-kit','out',
  '.output','.vercel','.netlify','vendor','pods','.yarn','.pnp',
]);
const IGNORE_FILES = new Set([
  'project-scanner.js','project-audit.json','project-audit-report.txt',
  'detector-audit.json','audit-detectors.js',
]);

// ─── Helpers ──────────────────────────────────────────────
const _cache = new Map();
function readJSON(fp) { try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; } }
function fileExists(p) { try { return fs.existsSync(p); } catch { return false; } }
function run(cmd) { try { return execSync(cmd, { cwd: ROOT, stdio: 'pipe', timeout: 15000 }).toString().trim(); } catch { return null; } }
function readFileAbs(fp) { if (_cache.has(fp)) return _cache.get(fp); try { const c = fs.readFileSync(fp, 'utf8'); _cache.set(fp, c); return c; } catch { return ''; } }
function readFile(rp) { return readFileAbs(path.join(ROOT, rp)); }
function rel(ap) { return ap.replace(ROOT + path.sep, '').replace(ROOT + '/', ''); }
function countLines(c) { return c.split('\n').length; }
function getFileSizeBytes(fp) { try { return fs.statSync(fp).size; } catch { return 0; } }
function formatBytes(b) { if (b === 0) return '0 B'; const k = 1024, s = ['B','KB','MB','GB'], i = Math.floor(Math.log(b)/Math.log(k)); return (b/Math.pow(k,i)).toFixed(1)+' '+s[i]; }
function unique(arr) { return [...new Set(arr)]; }
function stripComments(c) { return c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''); }

function skipIfError(fn, fallback = '') {
  try { const r = fn(); return r !== undefined && r !== null ? r : fallback; }
  catch { return typeof fallback === 'function' ? fallback() : fallback; }
}

function getTopLevelPkg(pkgName) {
  if (!pkgName) return '';
  if (pkgName.startsWith('@')) {
    const p = pkgName.split('/');
    return p.length > 1 ? `${p[0]}/${p[1]}` : pkgName;
  }
  return pkgName.split('/')[0];
}

function getAllFiles(dir, extensions = []) {
  const results = [];
  function walk(current) {
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name) || IGNORE_FILES.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.length === 0 || extensions.includes(ext)) results.push(full);
      }
    }
  }
  if (fs.existsSync(dir)) walk(dir);
  return results;
}

function getAllProjectFiles() {
  return getAllFiles(ROOT, []).filter(f => !rel(f).includes('node_modules'));
}

function getSourceFiles() {
  return getAllFiles(ROOT, ['.ts','.tsx','.js','.jsx']).filter(f => {
    const r = rel(f);
    return !r.includes('node_modules') && !r.includes('.expo') &&
           !r.includes('dist') && !r.includes('build') && !IGNORE_FILES.has(path.basename(f));
  });
}

let _sourceData = null, _allSourceContent = null;
function getSourceData(sourceFiles) {
  if (_sourceData) return _sourceData;
  _sourceData = sourceFiles.map(f => {
    const content = readFileAbs(f);
    return { path: f, rel: rel(f), content, lines: content.split('\n'), ext: path.extname(f).toLowerCase(), bytes: content.length };
  });
  _allSourceContent = _sourceData.map(d => d.content).join('\n');
  return _sourceData;
}
function getAllSourceContent() { return _allSourceContent ?? ''; }

// ─── Import Analyzer ──────────────────────────────────────
function extractActualImports(files) {
  const imports = new Set(), importLines = [];
  for (const file of files) {
    const content = readFileAbs(file), lines = content.split('\n'), stripped = stripComments(content);
    let m;
    const fromRe = /\bfrom\s+['"`]([^'"`]+)['"`]/g;
    while ((m = fromRe.exec(stripped)) !== null) {
      const block = stripped.substring(Math.max(0, m.index - 500), m.index);
      if (/\bimport\s/.test(block) || /\bexport\s/.test(block)) {
        const ln = content.substring(0, m.index).split('\n').length;
        imports.add(m[1]);
        importLines.push({ file: rel(file), pkg: m[1], line: lines[ln-1]?.trim() ?? '', lineNum: ln });
      }
    }
    const reqRe = /\brequire\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
    while ((m = reqRe.exec(stripped)) !== null) { const ln = content.substring(0, m.index).split('\n').length; imports.add(m[1]); importLines.push({ file: rel(file), pkg: m[1], line: lines[ln-1]?.trim() ?? '', lineNum: ln }); }
    const dynRe = /\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
    while ((m = dynRe.exec(stripped)) !== null) { const ln = content.substring(0, m.index).split('\n').length; imports.add(m[1]); importLines.push({ file: rel(file), pkg: m[1], line: lines[ln-1]?.trim() ?? '', lineNum: ln }); }
    const sideRe = /^\s*import\s+['"`]([^'"`]+)['"`]/gm;
    while ((m = sideRe.exec(stripped)) !== null) { const ln = content.substring(0, m.index).split('\n').length; imports.add(m[1]); importLines.push({ file: rel(file), pkg: m[1], line: lines[ln-1]?.trim() ?? '', lineNum: ln }); }
  }
  return { imports, importLines };
}

// ─── 1. Project Identity ──────────────────────────────────
function scanProjectIdentity() {
  console.log('📋 Scanning project identity...');
  const pkg = readJSON(path.join(ROOT, 'package.json'));
  const expo = readJSON(path.join(ROOT, 'app.json'))?.expo;
  const easJson = readJSON(path.join(ROOT, 'eas.json'));
  let packageManager = 'npm';
  if (fileExists(path.join(ROOT, 'pnpm-lock.yaml'))) packageManager = 'pnpm';
  else if (fileExists(path.join(ROOT, 'yarn.lock'))) packageManager = 'yarn';
  else if (fileExists(path.join(ROOT, 'bun.lockb'))) packageManager = 'bun';
  const workspaces = pkg?.workspaces ?? null;
  const isMonorepo = !!(workspaces || fileExists(path.join(ROOT, 'lerna.json')) || fileExists(path.join(ROOT, 'pnpm-workspace.yaml')) || fileExists(path.join(ROOT, 'turbo.json')) || fileExists(path.join(ROOT, 'nx.json')));
  return {
    name: pkg?.name ?? 'unknown', version: pkg?.version ?? 'unknown', description: pkg?.description ?? '',
    license: pkg?.license ?? 'unknown', private: pkg?.private ?? false, author: pkg?.author ?? '',
    homepage: pkg?.homepage ?? '', bugs: typeof pkg?.bugs === 'string' ? pkg.bugs : pkg?.bugs?.url ?? '',
    repository: typeof pkg?.repository === 'string' ? pkg.repository : pkg?.repository?.url ?? '',
    main: pkg?.main ?? '', type: pkg?.type ?? 'commonjs', packageManager, isMonorepo,
    workspaces: workspaces ? (Array.isArray(workspaces) ? workspaces : workspaces.packages ?? []) : [],
    engines: pkg?.engines ?? {}, os: pkg?.os ?? [], cpu: pkg?.cpu ?? [],
    browserslist: pkg?.browserslist ?? null, sideEffects: pkg?.sideEffects ?? null,
    runtime: { node: run('node --version'), npm: run('npm --version'), yarn: run('yarn --version'), pnpm: run('pnpm --version'), bun: run('bun --version') },
    expo: expo ? {
      name: expo.name, slug: expo.slug, version: expo.version, sdkVersion: expo.sdkVersion,
      orientation: expo.orientation, platforms: expo.platforms ?? ['ios','android'], scheme: expo.scheme,
      userInterfaceStyle: expo.userInterfaceStyle, newArchEnabled: expo.newArchEnabled ?? false,
      experiments: expo.experiments ?? {},
      plugins: (expo.plugins ?? []).map(p => Array.isArray(p) ? { name: p[0], config: p[1] } : { name: p }),
      updates: expo.updates, extra: expo.extra ? Object.keys(expo.extra) : [],
      owner: expo.owner, runtimeVersion: expo.runtimeVersion,
      ios: {
        bundleIdentifier: expo.ios?.bundleIdentifier, buildNumber: expo.ios?.buildNumber,
        deploymentTarget: expo.ios?.deploymentTarget, supportsTablet: expo.ios?.supportsTablet,
        requireFullScreen: expo.ios?.requireFullScreen, usesAppleSignIn: expo.ios?.usesAppleSignIn,
        associatedDomains: expo.ios?.associatedDomains ?? [],
        entitlements: expo.ios?.entitlements ? Object.keys(expo.ios.entitlements) : [],
        infoPlistKeys: expo.ios?.infoPlist ? Object.keys(expo.ios.infoPlist) : [],
        privacyManifests: expo.ios?.privacyManifests ?? null,
        config: expo.ios?.config ? Object.keys(expo.ios.config) : [],
      },
      android: {
        package: expo.android?.package, versionCode: expo.android?.versionCode,
        compileSdkVersion: expo.android?.compileSdkVersion, targetSdkVersion: expo.android?.targetSdkVersion,
        minSdkVersion: expo.android?.minSdkVersion, permissions: expo.android?.permissions ?? [],
        blockedPermissions: expo.android?.blockedPermissions ?? [],
        intentFilters: expo.android?.intentFilters ?? [], adaptiveIcon: !!expo.android?.adaptiveIcon,
        googleServicesFile: expo.android?.googleServicesFile ?? null,
        config: expo.android?.config ? Object.keys(expo.android.config) : [],
      },
      web: expo.web ? { output: expo.web.output, bundler: expo.web.bundler, favicon: expo.web.favicon } : null,
      splash: expo.splash ? { backgroundColor: expo.splash.backgroundColor, resizeMode: expo.splash.resizeMode, image: expo.splash.image } : null,
      notification: expo.notification ?? null,
    } : null,
    eas: easJson ? {
      cli: easJson.cli,
      build: Object.entries(easJson.build ?? {}).map(([name, config]) => ({ name, distribution: config.distribution, channel: config.channel, env: config.env ? Object.keys(config.env) : [], ios: config.ios ? Object.keys(config.ios) : [], android: config.android ? Object.keys(config.android) : [] })),
      submit: Object.keys(easJson.submit ?? {}),
    } : null,
    hasAppConfig: fileExists(path.join(ROOT, 'app.config.js')) || fileExists(path.join(ROOT, 'app.config.ts')),
  };
}

// ─── 2. Packages ──────────────────────────────────────────
function scanPackages(actualImports) {
  console.log('📦 Scanning packages...');
  const pkg = readJSON(path.join(ROOT, 'package.json'));
  if (!pkg) return {};
  const deps = pkg.dependencies ?? {}, devDeps = pkg.devDependencies ?? {}, peerDeps = pkg.peerDependencies ?? {}, optDeps = pkg.optionalDependencies ?? {};
  const resolutions = pkg.resolutions ?? pkg.overrides ?? {};
  function getInstalledVersion(n) { return readJSON(path.join(ROOT, 'node_modules', n, 'package.json'))?.version ?? null; }
  function categorizePkg(name) {
    const n = name.toLowerCase();
    if (n.includes('firebase')) return '🔥 Firebase';
    if (n.includes('cloudinary')) return '☁️ Cloudinary';
    if (n.includes('stripe') || n.includes('revenue-cat') || n.includes('revenuecat') || n.includes('purchases')) return '💳 Payments';
    if (n.includes('sentry') || n.includes('bugsnag') || n.includes('datadog')) return '🐛 Monitoring';
    if (n.includes('amplitude') || n.includes('mixpanel') || n.includes('segment') || n.includes('posthog')) return '📊 Analytics';
    if (n.startsWith('expo-') || n === 'expo') return '📱 Expo';
    if (n === 'react-native' || n.startsWith('react-native-')) return '📱 React Native';
    if (n === 'react' || n === 'react-dom') return '⚛️ React';
    if (n.includes('navigation') || n.includes('router')) return '🧭 Navigation';
    if (n.includes('redux') || n.includes('zustand') || n.includes('jotai') || n.includes('mobx') || n.includes('recoil') || n.includes('valtio')) return '🗄️ State';
    if (n.includes('axios') || n.includes('swr') || n.includes('tanstack') || n.includes('react-query') || n.includes('apollo') || n.includes('urql') || n.includes('graphql')) return '🌐 Networking';
    if (n.includes('jest') || n.includes('testing') || n.includes('vitest') || n.includes('detox') || n.includes('cypress') || n.includes('playwright') || n.includes('mocha') || n.includes('chai')) return '🧪 Testing';
    if (n.includes('eslint') || n.includes('prettier') || n.includes('lint') || n.includes('stylelint')) return '✨ Linting';
    if (n === 'typescript' || n.startsWith('@types/')) return '📘 TypeScript';
    if (n.includes('babel') || n.includes('metro') || n.includes('webpack') || n.includes('vite') || n.includes('esbuild') || n.includes('swc') || n.includes('rollup')) return '🔧 Build Tools';
    if (n.includes('crypto') || n.includes('bcrypt') || n.includes('jwt') || n.includes('nacl') || n.includes('argon') || n.includes('helmet') || n.includes('cors')) return '🔒 Security';
    if (n.includes('reanimated') || n.includes('animation') || n.includes('lottie') || n.includes('moti') || n.includes('spring')) return '🎬 Animation';
    if (n.includes('image') || n.includes('camera') || n.includes('video') || n.includes('media') || n.includes('audio') || n.includes('photo')) return '📸 Media';
    if (n.includes('notification') || n.includes('push') || n.includes('messaging')) return '🔔 Notifications';
    if (n.includes('map') || n.includes('location') || n.includes('geo')) return '📍 Location';
    if (n.includes('i18n') || n.includes('intl') || n.includes('locale') || n.includes('translation')) return '🌍 i18n';
    if (n.includes('date') || n.includes('moment') || n.includes('dayjs') || n.includes('luxon') || n.includes('temporal')) return '📅 Date/Time';
    if (n.includes('socket') || n.includes('websocket') || n.includes('ws') || n.includes('pusher') || n.includes('ably')) return '🔌 Realtime';
    if (n.includes('tensorflow') || n.includes('face-api') || n.includes('onnx') || n.includes('openai') || n.includes('langchain')) return '🤖 AI/ML';
    if (n.includes('storage') || n.includes('async-storage') || n.includes('mmkv') || n.includes('sqlite') || n.includes('realm') || n.includes('watermelon')) return '💾 Storage';
    if (n.includes('gesture') || n.includes('haptics')) return '👆 Gestures';
    if (n.includes('icon') || n.includes('svg') || n.includes('font')) return '🎨 UI Assets';
    if (n.includes('form') || n.includes('hook-form') || n.includes('formik') || n.includes('zod') || n.includes('yup') || n.includes('joi') || n.includes('superstruct')) return '📝 Forms/Validation';
    if (n.includes('express') || n.includes('fastify') || n.includes('koa') || n.includes('hono') || n.includes('nest')) return '🖥️ Server';
    if (n.includes('chart') || n.includes('plot') || n.includes('graph') || n.includes('d3') || n.includes('victory')) return '📈 Charts';
    if (n.includes('log') || n.includes('winston') || n.includes('pino') || n.includes('bunyan')) return '📋 Logging';
    if (n.includes('mail') || n.includes('email') || n.includes('sendgrid') || n.includes('nodemailer') || n.includes('resend')) return '📧 Email';
    if (n.includes('cache') || n.includes('redis') || n.includes('memcached')) return '⚡ Caching';
    return '📦 Other';
  }
  const FRAMEWORK_INTERNALS = new Set([
    'expo','expo-asset','expo-constants','expo-font','expo-system-ui','expo-symbols',
    'react-native-screens','react-native-gesture-handler','react-native-reanimated',
    'react-native-web','react-dom','react','@react-navigation/bottom-tabs',
    '@react-navigation/elements','@react-navigation/native','react-native-worklets',
    '@babel/core','typescript','metro','@types/node','@types/react','@types/react-native',
    'react-native-safe-area-context','react-native-svg','expo-linking',
    'expo-splash-screen','expo-status-bar','expo-modules-core','expo-dev-client',
  ]);
  const allDeps = [];
  function processDeps(depsObj, type) {
    for (const [name, specifiedVersion] of Object.entries(depsObj)) {
      const installedVersion = getInstalledVersion(name);
      const isFrameworkInternal = FRAMEWORK_INTERNALS.has(name);
      const isActuallyImported = isFrameworkInternal || actualImports.has(name) || [...actualImports].some(imp => getTopLevelPkg(imp) === name);
      const versionMismatch = installedVersion && specifiedVersion && !specifiedVersion.includes(installedVersion) && installedVersion !== specifiedVersion.replace(/[\^~>=<]/g, '');
      allDeps.push({ name, specifiedVersion, installedVersion, type, category: categorizePkg(name), actuallyImported: isActuallyImported, isFrameworkInternal, installed: !!installedVersion, versionMismatch });
    }
  }
  processDeps(deps, 'production'); processDeps(devDeps, 'development'); processDeps(peerDeps, 'peer'); processDeps(optDeps, 'optional');
  const allDeclared = new Set([...Object.keys(deps), ...Object.keys(devDeps), ...Object.keys(peerDeps), ...Object.keys(optDeps)]);
  const NODE_BUILTINS = new Set(['fs','path','crypto','os','http','https','url','util','stream','buffer','events','child_process','net','tls','zlib','querystring','readline','assert','cluster','dns','domain','module','process','punycode','string_decoder','timers','tty','v8','vm','worker_threads','perf_hooks']);
  const undeclared = unique([...actualImports].map(imp => getTopLevelPkg(imp)).filter(p => p && !allDeclared.has(p) && !NODE_BUILTINS.has(p) && !p.startsWith('.')));
  const possiblyUnused = allDeps.filter(d => d.type === 'production' && !d.actuallyImported && !d.isFrameworkInternal);
  const notInstalled = allDeps.filter(d => !d.installed && d.type !== 'peer' && d.type !== 'optional');
  const duplicateCategories = {};
  for (const dep of allDeps) { if (!duplicateCategories[dep.category]) duplicateCategories[dep.category] = []; duplicateCategories[dep.category].push(dep.name); }
  const potentialDuplicates = Object.entries(duplicateCategories).filter(([cat, pkgs]) => pkgs.length > 3 && !['📦 Other','📘 TypeScript','📱 Expo','📱 React Native'].includes(cat)).map(([cat, pkgs]) => ({ category: cat, packages: pkgs }));
  const byCategory = {};
  for (const dep of allDeps) { if (!byCategory[dep.category]) byCategory[dep.category] = []; byCategory[dep.category].push(dep); }
  return {
    counts: { production: Object.keys(deps).length, development: Object.keys(devDeps).length, peer: Object.keys(peerDeps).length, optional: Object.keys(optDeps).length, total: allDeps.length, actuallyImported: allDeps.filter(d => d.actuallyImported).length, notInstalled: notInstalled.length, categories: Object.keys(byCategory).length },
    all: allDeps, byCategory,
    possiblyUnused: possiblyUnused.map(d => d.name), undeclaredImports: undeclared,
    notInstalled: notInstalled.map(d => d.name), potentialDuplicates,
    resolutions: Object.keys(resolutions).length > 0 ? resolutions : null,
    scripts: pkg.scripts ?? {}, engines: pkg.engines ?? {},
  };
}

// ─── 3. Tech Stack ────────────────────────────────────────
function scanTechStack(actualImports, importLines) {
  console.log('🛠️  Building tech stack profile...');
  const allImportPaths = [...actualImports];
  function uses(...pkgs) { return pkgs.some(pkg => allImportPaths.some(imp => imp === pkg || imp.startsWith(pkg + '/') || imp.startsWith(pkg + '-'))); }
  function getVersion(n) { return readJSON(path.join(ROOT, 'node_modules', n, 'package.json'))?.version ?? null; }
  function findUsedIn(pkg) { return importLines.filter(l => l.pkg === pkg || l.pkg.startsWith(pkg + '/')).map(l => l.file).slice(0, 5); }
  const allContent = getAllSourceContent();
  const stack = {};

  stack.mobileFramework = {
    name: uses('expo') ? 'Expo' : uses('react-native') ? 'React Native (bare)' : 'Unknown',
    version: getVersion('expo') ?? getVersion('react-native'),
    reactVersion: getVersion('react'), reactNativeVersion: getVersion('react-native'),
    expoSdkVersion: readJSON(path.join(ROOT, 'app.json'))?.expo?.sdkVersion,
    newArchitecture: readJSON(path.join(ROOT, 'app.json'))?.expo?.newArchEnabled ?? false,
    workflow: fileExists(path.join(ROOT, 'ios')) || fileExists(path.join(ROOT, 'android')) ? 'bare' : 'managed',
    hermes: (() => { const appJson = readJSON(path.join(ROOT, 'app.json')); return appJson?.expo?.jsEngine === 'hermes' || true; })(),
  };

  const tsconfig = readJSON(path.join(ROOT, 'tsconfig.json'));
  const tsconfigBase = tsconfig?.extends ? readJSON(path.join(ROOT, tsconfig.extends)) : null;
  stack.language = {
    typescript: fileExists(path.join(ROOT, 'tsconfig.json')),
    typescriptVersion: getVersion('typescript'),
    strictMode: tsconfig?.compilerOptions?.strict ?? tsconfigBase?.compilerOptions?.strict ?? false,
    noImplicitAny: tsconfig?.compilerOptions?.noImplicitAny ?? false,
    strictNullChecks: tsconfig?.compilerOptions?.strictNullChecks ?? false,
    noUncheckedIndexedAccess: tsconfig?.compilerOptions?.noUncheckedIndexedAccess ?? false,
    exactOptionalPropertyTypes: tsconfig?.compilerOptions?.exactOptionalPropertyTypes ?? false,
    jsxRuntime: tsconfig?.compilerOptions?.jsx, moduleResolution: tsconfig?.compilerOptions?.moduleResolution,
    target: tsconfig?.compilerOptions?.target, lib: tsconfig?.compilerOptions?.lib ?? [],
    paths: tsconfig?.compilerOptions?.paths ? Object.keys(tsconfig.compilerOptions.paths) : [],
    baseUrl: tsconfig?.compilerOptions?.baseUrl, include: tsconfig?.include ?? [], exclude: tsconfig?.exclude ?? [],
    extends: tsconfig?.extends ?? null, references: tsconfig?.references ?? [],
    skipLibCheck: tsconfig?.compilerOptions?.skipLibCheck ?? false,
    esModuleInterop: tsconfig?.compilerOptions?.esModuleInterop ?? false,
    resolveJsonModule: tsconfig?.compilerOptions?.resolveJsonModule ?? false,
    isolatedModules: tsconfig?.compilerOptions?.isolatedModules ?? false,
  };

  stack.navigation = {
    expoRouter: uses('expo-router'), expoRouterVersion: getVersion('expo-router'),
    reactNavigation: uses('@react-navigation'), reactNavigationVersion: getVersion('@react-navigation/native'),
    reactNavigationStack: uses('@react-navigation/stack') || uses('@react-navigation/native-stack'),
    reactNavigationTabs: uses('@react-navigation/bottom-tabs') || uses('@react-navigation/material-top-tabs'),
    reactNavigationDrawer: uses('@react-navigation/drawer'),
    wouter: uses('wouter'), reactRouter: uses('react-router') || uses('react-router-native'),
  };

  const firebaseUsed = uses('firebase', '@firebase', '@react-native-firebase');
  stack.backend = {
    firebase: {
      used: firebaseUsed, version: getVersion('firebase'), rnFirebase: uses('@react-native-firebase'),
      services: {
        auth: allImportPaths.some(i => i.includes('firebase/auth') || i.includes('@react-native-firebase/auth')),
        firestore: allImportPaths.some(i => i.includes('firebase/firestore') || i.includes('@react-native-firebase/firestore')),
        realtimeDatabase: allImportPaths.some(i => i.includes('firebase/database') || i.includes('@react-native-firebase/database')),
        storage: allImportPaths.some(i => i.includes('firebase/storage') || i.includes('@react-native-firebase/storage')),
        functions: allImportPaths.some(i => i.includes('firebase/functions') || i.includes('@react-native-firebase/functions')),
        appCheck: allImportPaths.some(i => i.includes('firebase/app-check')),
        analytics: allImportPaths.some(i => i.includes('firebase/analytics') || i.includes('@react-native-firebase/analytics')),
        messaging: allImportPaths.some(i => i.includes('firebase/messaging') || i.includes('@react-native-firebase/messaging')),
        remoteConfig: allImportPaths.some(i => i.includes('firebase/remote-config')),
        performance: allImportPaths.some(i => i.includes('firebase/performance')),
        crashlytics: allImportPaths.some(i => i.includes('@react-native-firebase/crashlytics')),
        dynamicLinks: allImportPaths.some(i => i.includes('firebase/dynamic-links')),
        inAppMessaging: allImportPaths.some(i => i.includes('firebase/in-app-messaging')),
      },
      usedIn: findUsedIn('firebase'),
      securityRules: { firestore: fileExists(path.join(ROOT, 'firestore.rules')), storage: fileExists(path.join(ROOT, 'storage.rules')), database: fileExists(path.join(ROOT, 'database.rules.json')) },
      indexes: fileExists(path.join(ROOT, 'firestore.indexes.json')), firebaseJson: fileExists(path.join(ROOT, 'firebase.json')),
    },
    supabase: { used: uses('@supabase/supabase-js'), version: getVersion('@supabase/supabase-js') },
    mongodb: { used: uses('mongoose', 'mongodb'), version: getVersion('mongoose') ?? getVersion('mongodb') },
    redis: { used: uses('ioredis', 'redis'), version: getVersion('ioredis') ?? getVersion('redis') },
    prisma: { used: uses('@prisma/client'), version: getVersion('@prisma/client'), hasSchema: fileExists(path.join(ROOT, 'prisma/schema.prisma')) },
    drizzle: { used: uses('drizzle-orm'), version: getVersion('drizzle-orm') },
    typeorm: { used: uses('typeorm'), version: getVersion('typeorm') },
    graphql: { used: uses('graphql', '@apollo/client', 'urql', '@graphql-codegen'), version: getVersion('graphql') ?? getVersion('@apollo/client') },
    trpc: { used: uses('@trpc/client', '@trpc/server'), version: getVersion('@trpc/client') ?? getVersion('@trpc/server') },
    convex: { used: uses('convex'), version: getVersion('convex') },
    appwrite: { used: uses('appwrite'), version: getVersion('appwrite') },
    pocketbase: { used: uses('pocketbase'), version: getVersion('pocketbase') },
  };

  function detectCloudinaryUsage() {
    const u = [];
    if (allContent.includes('image/upload')) u.push('Image Upload');
    if (allContent.includes('video/upload')) u.push('Video Upload');
    if (allContent.includes('faces')) u.push('Face Detection');
    if (allContent.includes('image_metadata')) u.push('EXIF Metadata');
    if (allContent.includes('moderation')) u.push('Content Moderation');
    if (allContent.includes('quality')) u.push('Quality Analysis');
    if (allContent.includes('auto_tagging') || allContent.includes('categorization')) u.push('Auto Tagging');
    return u;
  }

  stack.media = {
    cloudinary: { used: allContent.includes('cloudinary.com') || allContent.includes('CLOUDINARY'), version: getVersion('cloudinary'), usedFor: detectCloudinaryUsage() },
    aws: { used: uses('aws-sdk', '@aws-sdk'), version: getVersion('aws-sdk') ?? getVersion('@aws-sdk/client-s3') },
    expo: {
      imageManipulator: uses('expo-image-manipulator'), imagePicker: uses('expo-image-picker'),
      mediaLibrary: uses('expo-media-library'), camera: uses('expo-camera'),
      video: uses('expo-video', 'expo-av'), audio: uses('expo-audio', 'expo-av'),
      fileSystem: uses('expo-file-system'), documentPicker: uses('expo-document-picker'),
      print: uses('expo-print'), sharing: uses('expo-sharing'), brightness: uses('expo-brightness'),
      barCodeScanner: uses('expo-barcode-scanner'),
    },
    expoImage: uses('expo-image'), fastImage: uses('react-native-fast-image'), sharp: uses('sharp'),
  };

  const serverFiles = [
    ...getAllFiles(path.join(ROOT, 'server'), ['.ts','.js']), ...getAllFiles(path.join(ROOT, 'api'), ['.ts','.js']),
    ...getAllFiles(path.join(ROOT, 'functions'), ['.ts','.js']), ...getAllFiles(path.join(ROOT, 'backend'), ['.ts','.js']),
    ...getAllFiles(path.join(ROOT, 'src/server'), ['.ts','.js']), ...getAllFiles(path.join(ROOT, 'src/api'), ['.ts','.js']),
  ].filter(f => !f.includes('node_modules'));
  const serverContent = serverFiles.map(f => readFileAbs(f)).join('\n');

  stack.server = {
    hasServer: serverContent.length > 100,
    framework: (() => {
      if (serverContent.includes("from 'express'") || serverContent.includes("require('express')")) return 'Express.js';
      if (serverContent.includes("from 'fastify'")) return 'Fastify';
      if (serverContent.includes("from 'koa'")) return 'Koa';
      if (serverContent.includes("from 'hono'")) return 'Hono';
      if (serverContent.includes("from '@nestjs'")) return 'NestJS';
      return 'None detected';
    })(),
    language: serverFiles.some(f => f.endsWith('.ts')) ? 'TypeScript' : 'JavaScript',
    fileCount: serverFiles.length,
    security: {
      helmet: serverContent.includes('helmet'), cors: serverContent.includes('cors'),
      rateLimit: serverContent.includes('rateLimit') || serverContent.includes('rate-limit') || serverContent.includes('express-rate-limit'),
      compression: serverContent.includes('compression'), hmac: serverContent.includes('createHmac'),
      appCheck: serverContent.includes('appCheck') || serverContent.includes('App Check'),
      validateOrigin: serverContent.includes('validateOrigin') || serverContent.includes('allowedOrigins'),
      requireAuth: serverContent.includes('requireAuth') || serverContent.includes('verifyToken') || serverContent.includes('authenticate'),
      csrf: serverContent.includes('csrf') || serverContent.includes('csurf'), hpp: serverContent.includes('hpp'),
      contentSecurityPolicy: serverContent.includes('contentSecurityPolicy'),
      xssFilter: serverContent.includes('xssFilter') || serverContent.includes('xss'),
      noSniff: serverContent.includes('noSniff'),
      hsts: serverContent.includes('hsts') || serverContent.includes('strictTransportSecurity'),
      inputValidation: serverContent.includes('express-validator') || serverContent.includes('joi') || serverContent.includes('zod') || serverContent.includes('celebrate'),
      sqlInjection: serverContent.includes('parameterized') || serverContent.includes('prepared'),
      requestSizeLimit: serverContent.includes('limit') && serverContent.includes('json'),
    },
    hosting: (() => {
      if (allContent.includes('cloudfunctions.net') || fileExists(path.join(ROOT, 'functions'))) return 'Firebase Cloud Functions';
      if (allContent.includes('railway.app') || fileExists(path.join(ROOT, 'railway.json'))) return 'Railway';
      if (allContent.includes('render.com') || fileExists(path.join(ROOT, 'render.yaml'))) return 'Render';
      if (allContent.includes('fly.io') || fileExists(path.join(ROOT, 'fly.toml'))) return 'Fly.io';
      if (allContent.includes('vercel') || fileExists(path.join(ROOT, 'vercel.json'))) return 'Vercel';
      if (allContent.includes('netlify') || fileExists(path.join(ROOT, 'netlify.toml'))) return 'Netlify';
      if (allContent.includes('heroku') || fileExists(path.join(ROOT, 'Procfile'))) return 'Heroku';
      if (fileExists(path.join(ROOT, 'Dockerfile'))) return 'Docker (unknown host)';
      if (fileExists(path.join(ROOT, 'serverless.yml'))) return 'Serverless Framework';
      return 'Unknown';
    })(),
    endpoints: (() => {
      const eps = [];
      for (const file of serverFiles) {
        const content = readFileAbs(file); const lines = content.split('\n');
        lines.forEach((line, idx) => { const m = line.match(/app\.(get|post|put|patch|delete|all|use|options|head)\s*\(\s*['"`]([^'"`]+)['"`]/i); if (m) eps.push({ method: m[1].toUpperCase(), path: m[2], file: rel(file), line: idx + 1 }); });
      }
      return eps.length;
    })(),
  };

  stack.payments = {
    stripe: { used: uses('@stripe/stripe-react-native', 'stripe'), version: getVersion('@stripe/stripe-react-native') ?? getVersion('stripe') },
    revenueCat: { used: uses('react-native-purchases'), version: getVersion('react-native-purchases') },
    inAppPurchases: uses('expo-in-app-purchases') || uses('react-native-iap'),
    paypal: uses('@paypal'), lemonsqueezy: uses('@lemonsqueezy'),
  };

  stack.authentication = {
    firebaseAuth: allImportPaths.some(i => i.includes('firebase/auth')),
    googleSignIn: uses('@react-native-google-signin/google-signin', 'expo-auth-session'),
    appleSignIn: uses('@invertase/react-native-apple-authentication', 'expo-apple-authentication'),
    facebookAuth: uses('react-native-fbsdk-next'),
    biometric: uses('expo-local-authentication', 'react-native-biometrics'),
    passkeys: uses('react-native-passkey'),
    oauth: uses('expo-auth-session') || allContent.includes('OAuth'),
    jwt: allContent.includes('jsonwebtoken') || allContent.includes('jwt') || allContent.includes('JWT'),
    e2ee: allContent.includes('tweetnacl') || allContent.includes('crypto.subtle') || allContent.includes('SubtleCrypto') || fileExists(path.join(ROOT, 'utils/e2ee.ts')),
    e2eeMethod: (() => {
      const e = readFile('utils/e2ee.ts') + readFile('src/utils/e2ee.ts') + readFile('lib/e2ee.ts');
      if (e.includes('tweetnacl') || e.includes('nacl')) return 'TweetNaCl (X25519 + XSalsa20-Poly1305)';
      if (e.includes('X25519')) return 'X25519 + AES-GCM';
      if (e.includes('ECDH')) return 'ECDH + AES-GCM';
      if (e.includes('Signal Protocol') || e.includes('signal-protocol')) return 'Signal Protocol';
      if (e.length > 100) return 'Custom';
      return 'None';
    })(),
    mfa: allContent.includes('multiFactor') || allContent.includes('MFA') || allContent.includes('2FA') || allContent.includes('totp'),
    sso: allContent.includes('SAML') || allContent.includes('SSO') || allContent.includes('single sign'),
  };

  stack.notifications = {
    expo: uses('expo-notifications'), version: getVersion('expo-notifications'),
    firebase: allImportPaths.some(i => i.includes('firebase/messaging')),
    oneSignal: uses('react-native-onesignal'), webPush: allContent.includes('web-push'),
    notifee: uses('@notifee/react-native'),
  };

  stack.analyticsMonitoring = {
    sentry: { used: uses('@sentry/react-native', 'sentry-expo'), version: getVersion('@sentry/react-native') ?? getVersion('sentry-expo') },
    amplitude: { used: uses('@amplitude/analytics-react-native') }, mixpanel: { used: uses('mixpanel-react-native') },
    segment: { used: uses('@segment/analytics-react-native') },
    firebaseAnalytics: allImportPaths.some(i => i.includes('firebase/analytics')),
    posthog: { used: uses('posthog-react-native', 'posthog-js') },
    datadog: { used: uses('@datadog/mobile-react-native') }, bugsnag: { used: uses('@bugsnag/react-native') },
    crashlytics: { used: uses('@react-native-firebase/crashlytics') },
    plausible: { used: uses('plausible-tracker') }, umami: { used: allContent.includes('umami') },
  };

  stack.aiMl = {
    faceApi: { used: uses('face-api.js', 'face-api'), version: getVersion('face-api.js'), usedIn: findUsedIn('face-api.js') },
    tensorflow: { used: uses('@tensorflow/tfjs'), version: getVersion('@tensorflow/tfjs') },
    nsfwjs: { used: uses('nsfwjs'), version: getVersion('nsfwjs') },
    openai: { used: uses('openai'), version: getVersion('openai') },
    langchain: { used: uses('langchain', '@langchain'), version: getVersion('langchain') },
    anthropic: { used: uses('@anthropic-ai/sdk'), version: getVersion('@anthropic-ai/sdk') },
    replicate: { used: uses('replicate'), version: getVersion('replicate') },
    huggingface: { used: uses('@huggingface/inference'), version: getVersion('@huggingface/inference') },
    cloudinaryAI: detectCloudinaryUsage().length > 0,
    externalEndpoints: (() => {
      const eps = [];
      if (allContent.includes('safebrowsing.googleapis.com')) eps.push('Google Safe Browsing');
      if (allContent.includes('vision.googleapis.com')) eps.push('Google Vision AI');
      if (allContent.includes('api.openai.com')) eps.push('OpenAI API');
      if (allContent.includes('api.anthropic.com')) eps.push('Anthropic Claude');
      if (allContent.includes('generativelanguage.googleapis.com')) eps.push('Google Gemini');
      if (allContent.includes('api.replicate.com')) eps.push('Replicate');
      if (allContent.includes('api-inference.huggingface.co')) eps.push('Hugging Face');
      if (allContent.includes('nudenet')) eps.push('NudeNet');
      return eps;
    })(),
  };

  stack.location = {
    expoLocation: uses('expo-location'), version: getVersion('expo-location'),
    mapbox: uses('@rnmapbox/maps'), googleMaps: uses('react-native-maps'),
    mapView: allContent.includes('MapView'),
    geofencing: allContent.includes('geofenc') || allContent.includes('startGeofencing'),
    backgroundLocation: allContent.includes('requestBackgroundPermissionsAsync') || allContent.includes('startLocationUpdatesAsync'),
    ipGeolocation: (() => {
      const s = [];
      if (allContent.includes('ip-api.com')) s.push('ip-api.com');
      if (allContent.includes('ipapi.co')) s.push('ipapi.co');
      if (allContent.includes('ipinfo.io')) s.push('ipinfo.io');
      if (allContent.includes('maxmind')) s.push('MaxMind GeoIP');
      return s;
    })(),
  };

  stack.stateManagement = {
    redux: uses('@reduxjs/toolkit', 'react-redux'), zustand: uses('zustand'), jotai: uses('jotai'),
    recoil: uses('recoil'), valtio: uses('valtio'), mobx: uses('mobx', 'mobx-react'),
    xstate: uses('xstate', '@xstate/react'), legendState: uses('@legendapp/state'),
    asyncStorage: uses('@react-native-async-storage/async-storage'), mmkv: uses('react-native-mmkv'),
    secureStore: uses('expo-secure-store'), watermelonDB: uses('@nozbe/watermelondb'),
    realm: uses('realm'), sqlite: uses('expo-sqlite', 'react-native-sqlite-storage'),
    contextCount: (allContent.match(/createContext/g) ?? []).length,
    useReducerCount: (allContent.match(/useReducer/g) ?? []).length,
  };

  stack.ui = {
    nativeWind: uses('nativewind'), nativeWindVersion: getVersion('nativewind'),
    tailwindcss: uses('tailwindcss'), tamagui: uses('tamagui', '@tamagui'),
    gluestack: uses('@gluestack-ui'), nativebase: uses('native-base'), paper: uses('react-native-paper'),
    elements: uses('@rneui/themed'), shopifyFlash: uses('@shopify/flash-list'),
    reanimated: { used: uses('react-native-reanimated'), version: getVersion('react-native-reanimated') },
    gesture: { used: uses('react-native-gesture-handler'), version: getVersion('react-native-gesture-handler') },
    skia: uses('@shopify/react-native-skia'), svg: uses('react-native-svg'),
    lottie: uses('lottie-react-native'), rive: uses('rive-react-native'), moti: uses('moti'),
    haptics: uses('expo-haptics'), linearGradient: uses('expo-linear-gradient'),
    blurView: uses('expo-blur') || uses('@react-native-community/blur'),
    bottomSheet: uses('@gorhom/bottom-sheet'), actionSheet: uses('@expo/react-native-action-sheet'),
    toast: uses('react-native-toast-message') || uses('burnt') || uses('sonner-native'),
    modal: uses('react-native-modal'), dropdown: uses('react-native-element-dropdown'),
    calendar: uses('react-native-calendars'), webview: uses('react-native-webview'),
    icons: { expo: uses('@expo/vector-icons'), lucide: uses('lucide-react-native'), phosphor: uses('phosphor-react-native'), heroicons: uses('@heroicons/react'), materialIcons: uses('react-native-vector-icons') },
    carousel: uses('react-native-reanimated-carousel'), pager: uses('react-native-pager-view'),
    charts: uses('react-native-chart-kit') || uses('victory-native') || uses('react-native-gifted-charts'),
  };

  stack.securityLibraries = {
    tweetnacl: uses('tweetnacl'), tweetnaclVersion: getVersion('tweetnacl'),
    sodium: uses('libsodium-wrappers') || uses('react-native-sodium'),
    expoSecureStore: uses('expo-secure-store'), expoCrypto: uses('expo-crypto'),
    webCrypto: allContent.includes('crypto.subtle') || allContent.includes('SubtleCrypto'),
    nodeCrypto: serverContent.includes("'crypto'") || serverContent.includes('"crypto"'),
    hmacSigning: serverContent.includes('createHmac'), bcrypt: uses('bcrypt', 'bcryptjs'), argon2: uses('argon2'),
    helmet: uses('helmet'), csp: allContent.includes('Content-Security-Policy'),
    certificatePinning: allContent.includes('ssl-pinning') || allContent.includes('certificatePinning'),
    jailbreakDetection: uses('jail-monkey') || uses('react-native-jail-monkey') || allContent.includes('isJailBroken'),
    rootDetection: allContent.includes('isRooted') || allContent.includes('rootBeer'),
    obfuscation: uses('javascript-obfuscator') || uses('react-native-obfuscating-transformer'),
    secureRandom: allContent.includes('getRandomValues') || allContent.includes('randomBytes'),
  };

  stack.testing = {
    jest: uses('jest') || fileExists(path.join(ROOT, 'jest.config.js')) || fileExists(path.join(ROOT, 'jest.config.ts')),
    jestVersion: getVersion('jest'), vitest: uses('vitest'),
    testingLibrary: uses('@testing-library/react-native') || uses('@testing-library/react'),
    detox: uses('detox'), maestro: fileExists(path.join(ROOT, '.maestro')),
    appium: uses('appium'), cypress: uses('cypress'), playwright: uses('@playwright/test'),
    msw: uses('msw'), nock: uses('nock'), supertest: uses('supertest'),
    testFiles: getSourceFiles().filter(f => f.includes('.test.') || f.includes('.spec.') || f.includes('__tests__')).length,
    coverageConfig: fileExists(path.join(ROOT, 'jest.config.js')) || fileExists(path.join(ROOT, 'jest.config.ts')) || fileExists(path.join(ROOT, 'vitest.config.ts')),
    snapshotFiles: getAllFiles(ROOT, ['.snap']).length,
  };

  stack.buildDeployment = {
    eas: fileExists(path.join(ROOT, 'eas.json')),
    cicd: {
      githubActions: fileExists(path.join(ROOT, '.github/workflows')),
      githubActionsFiles: fileExists(path.join(ROOT, '.github/workflows')) ? getAllFiles(path.join(ROOT, '.github/workflows'), ['.yml','.yaml']).map(f => path.basename(f)) : [],
      circleci: fileExists(path.join(ROOT, '.circleci')), bitrise: fileExists(path.join(ROOT, 'bitrise.yml')),
      fastlane: fileExists(path.join(ROOT, 'fastlane')), travisci: fileExists(path.join(ROOT, '.travis.yml')),
      jenkinsfile: fileExists(path.join(ROOT, 'Jenkinsfile')), gitlab: fileExists(path.join(ROOT, '.gitlab-ci.yml')),
      codemagic: fileExists(path.join(ROOT, 'codemagic.yaml')), appcenter: fileExists(path.join(ROOT, 'appcenter-post-clone.sh')),
    },
    docker: { dockerfile: fileExists(path.join(ROOT, 'Dockerfile')), dockerCompose: fileExists(path.join(ROOT, 'docker-compose.yml')) || fileExists(path.join(ROOT, 'docker-compose.yaml')) || fileExists(path.join(ROOT, 'compose.yml')), dockerIgnore: fileExists(path.join(ROOT, '.dockerignore')) },
    metro: { hasConfig: fileExists(path.join(ROOT, 'metro.config.js')) || fileExists(path.join(ROOT, 'metro.config.ts')), version: getVersion('metro') },
    babel: { hasConfig: fileExists(path.join(ROOT, 'babel.config.js')) || fileExists(path.join(ROOT, 'babel.config.ts')), version: getVersion('@babel/core') },
    bundleAnalyzer: uses('react-native-bundle-visualizer') || uses('webpack-bundle-analyzer') || uses('source-map-explorer'),
    codePush: uses('react-native-code-push') || uses('@microsoft/code-push'),
    otaUpdates: !!readJSON(path.join(ROOT, 'app.json'))?.expo?.updates?.url,
  };

  stack.externalAPIs = (() => {
    const checks = [
      { name: 'Cloudinary Upload', url: 'api.cloudinary.com', category: 'Media' },
      { name: 'Cloudinary CDN', url: 'res.cloudinary.com', category: 'Media' },
      { name: 'Google Safe Browsing', url: 'safebrowsing.googleapis.com', category: 'Safety' },
      { name: 'Google Vision', url: 'vision.googleapis.com', category: 'AI/ML' },
      { name: 'Google Maps', url: 'maps.googleapis.com', category: 'Location' },
      { name: 'Google Places', url: 'places.googleapis.com', category: 'Location' },
      { name: 'Google Geocoding', url: 'geocoding.googleapis.com', category: 'Location' },
      { name: 'HaveIBeenPwned', url: 'api.pwnedpasswords.com', category: 'Security' },
      { name: 'Firebase Functions', url: 'cloudfunctions.net', category: 'Backend' },
      { name: 'Spotify', url: 'api.spotify.com', category: 'Music' },
      { name: 'OpenAI', url: 'api.openai.com', category: 'AI/ML' },
      { name: 'Anthropic Claude', url: 'api.anthropic.com', category: 'AI/ML' },
      { name: 'Stripe', url: 'api.stripe.com', category: 'Payments' },
      { name: 'RevenueCat', url: 'api.revenuecat.com', category: 'Payments' },
      { name: 'Twilio', url: 'api.twilio.com', category: 'Communications' },
      { name: 'SendGrid', url: 'api.sendgrid.com', category: 'Email' },
      { name: 'Resend', url: 'api.resend.com', category: 'Email' },
      { name: 'ip-api', url: 'ip-api.com', category: 'Location' },
      { name: 'ipapi.co', url: 'ipapi.co', category: 'Location' },
      { name: 'ipinfo.io', url: 'ipinfo.io', category: 'Location' },
      { name: 'GitHub API', url: 'api.github.com', category: 'Dev Tools' },
      { name: 'Slack', url: 'slack.com/api', category: 'Communications' },
      { name: 'Discord', url: 'discord.com/api', category: 'Communications' },
      { name: 'Twitter/X', url: 'api.twitter.com', category: 'Social' },
      { name: 'Facebook Graph', url: 'graph.facebook.com', category: 'Social' },
      { name: 'YouTube', url: 'youtube.googleapis.com', category: 'Media' },
      { name: 'AWS S3', url: 's3.amazonaws.com', category: 'Storage' },
      { name: 'Algolia', url: 'algolia.net', category: 'Search' },
      { name: 'Sentry', url: 'sentry.io', category: 'Monitoring' },
      { name: 'Mapbox', url: 'api.mapbox.com', category: 'Location' },
      { name: 'Pusher', url: 'pusher.com', category: 'Realtime' },
      { name: 'Ably', url: 'ably.io', category: 'Realtime' },
      { name: 'OneSignal', url: 'onesignal.com', category: 'Notifications' },
      { name: 'Expo Push', url: 'exp.host/--/api', category: 'Notifications' },
      { name: 'Apple', url: 'appleid.apple.com', category: 'Auth' },
      { name: 'Google Auth', url: 'accounts.google.com', category: 'Auth' },
      { name: 'Auth0', url: 'auth0.com', category: 'Auth' },
      { name: 'Clerk', url: 'clerk.dev', category: 'Auth' },
    ];
    const sourceData = getSourceData(getSourceFiles());
    return checks.filter(c => allContent.includes(c.url)).map(c => ({
      ...c, usedIn: sourceData.filter(f => f.content.includes(c.url)).map(f => f.rel).slice(0, 5),
    }));
  })();

  stack.permissions = {
    camera: allContent.includes('expo-camera') || allContent.includes('requestCameraPermission'),
    microphone: allContent.includes('Audio.requestPermissionsAsync') || allContent.includes('microphone'),
    location: allContent.includes('requestForegroundPermissionsAsync'),
    backgroundLocation: allContent.includes('requestBackgroundPermissionsAsync'),
    notifications: allContent.includes('Notifications.requestPermissionsAsync'),
    mediaLibrary: allContent.includes('MediaLibrary.requestPermissionsAsync'),
    contacts: allContent.includes('Contacts.requestPermissionsAsync'),
    calendar: allContent.includes('Calendar.requestPermissionsAsync'),
    faceId: allContent.includes('LocalAuthentication'),
    bluetooth: allContent.includes('Bluetooth'),
    motion: allContent.includes('DeviceMotion') || allContent.includes('Accelerometer') || allContent.includes('Gyroscope'),
    tracking: allContent.includes('requestTrackingPermissionsAsync') || allContent.includes('AppTrackingTransparency'),
  };

  return stack;
}

// ─── 4. Environment Variables ─────────────────────────────
function scanEnvironmentVariables() {
  console.log('🔑 Scanning environment variables...');
  const envFiles = ['.env','.env.local','.env.development','.env.production','.env.staging','.env.test','.env.preview','server/.env','server/.env.local','server/.env.production','functions/.env','backend/.env','.env.example','.env.template','.env.sample'];
  const result = {};
  for (const envFile of envFiles) {
    const content = readFile(envFile);
    if (!content) continue;
    const vars = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.substring(0, eqIdx).trim(), value = trimmed.substring(eqIdx + 1).trim();
      const isEmpty = !value || value === '""' || value === "''" || value.includes('YOUR_') || value === 'your_value_here';
      vars.push({
        key, hasValue: !isEmpty,
        isSecret: /key|secret|token|password|api|auth|private|credential|webhook|signing/i.test(key),
        isPlaceholder: value.includes('YOUR_') || value.includes('your_') || value === 'xxx' || value === 'changeme' || value === 'CHANGEME',
        isExpoPublic: key.startsWith('EXPO_PUBLIC_'),
        maskedValue: isEmpty ? '(empty)' : value.length > 4 ? `${value.substring(0, 4)}${'*'.repeat(8)}` : '****',
      });
    }
    if (vars.length > 0) result[envFile] = vars;
  }
  const sourceFiles = getSourceFiles();
  const referencedVars = new Set(), expoPublicVars = new Set();
  for (const file of sourceFiles) {
    const content = readFileAbs(file); let m;
    const envP = /process\.env\.([A-Z_0-9]+)/g;
    while ((m = envP.exec(content)) !== null) referencedVars.add(m[1]);
    const expoP = /Constants\.expoConfig\.extra\.([A-Za-z_0-9]+)/g;
    while ((m = expoP.exec(content)) !== null) referencedVars.add(m[1]);
    const expoPubP = /process\.env\.(EXPO_PUBLIC_[A-Z_0-9]+)/g;
    while ((m = expoPubP.exec(content)) !== null) expoPublicVars.add(m[1]);
  }
  const allDefinedVars = new Set(Object.values(result).flat().map(v => v.key));
  const missingFromEnv = [...referencedVars].filter(v => !allDefinedVars.has(v) && !['NODE_ENV','PORT','HOME','PATH'].includes(v)).sort();
  const exampleVars = result['.env.example'] ?? result['.env.template'] ?? result['.env.sample'] ?? [];
  const mainEnvVars = new Set((result['.env'] ?? []).map(v => v.key));
  const missingFromMain = exampleVars.filter(v => !mainEnvVars.has(v.key)).map(v => v.key);
  const gitignore = readFile('.gitignore');
  const envInGitignore = gitignore.includes('.env') || gitignore.includes('*.env');
  const allVars = Object.values(result).flat();
  const emptyOrPlaceholder = allVars.filter(v => (!v.hasValue || v.isPlaceholder) && !v.key.includes('example')).map(v => v.key);
  return {
    files: result, referencedInCode: [...referencedVars].sort(), expoPublicVars: [...expoPublicVars].sort(),
    missingFromEnvFiles: missingFromEnv, missingFromMainEnv: missingFromMain,
    emptyOrPlaceholder: unique(emptyOrPlaceholder), envInGitignore, hasExample: !!(result['.env.example'] ?? result['.env.template'] ?? result['.env.sample']),
    summary: { totalFiles: Object.keys(result).length, totalVars: allVars.length, uniqueVars: new Set(allVars.map(v => v.key)).size, emptyVars: allVars.filter(v => !v.hasValue).length, placeholderVars: allVars.filter(v => v.isPlaceholder).length, secretVars: allVars.filter(v => v.isSecret).length, expoPublicVars: allVars.filter(v => v.isExpoPublic).length },
  };
}

// ─── 5. Security ──────────────────────────────────────────
function scanSecurity(sourceFiles) {
  console.log('🔒 Scanning security...');
  const dangerousPatterns = [
    { pattern: 'sk_live_', severity: 'critical', message: 'Stripe LIVE secret key hardcoded' },
    { pattern: 'sk_test_', severity: 'critical', message: 'Stripe TEST secret key hardcoded' },
    { pattern: 'ghp_', severity: 'critical', message: 'GitHub personal access token hardcoded' },
    { pattern: 'gho_', severity: 'critical', message: 'GitHub OAuth token hardcoded' },
    { pattern: 'ghs_', severity: 'critical', message: 'GitHub server token hardcoded' },
    { pattern: 'xoxb-', severity: 'critical', message: 'Slack bot token hardcoded' },
    { pattern: 'xoxp-', severity: 'critical', message: 'Slack user token hardcoded' },
    { pattern: 'AKIA', severity: 'critical', message: 'AWS Access Key ID hardcoded' },
    { pattern: 'YOUR_PROJECT_ID', severity: 'critical', message: 'Placeholder project ID not replaced' },
    { pattern: 'YOUR_API_KEY', severity: 'critical', message: 'Placeholder API key not replaced' },
    { pattern: 'BEGIN RSA PRIVATE KEY', severity: 'critical', message: 'RSA private key in source code' },
    { pattern: 'BEGIN PRIVATE KEY', severity: 'critical', message: 'Private key in source code' },
    { pattern: 'BEGIN EC PRIVATE KEY', severity: 'critical', message: 'EC private key in source code' },
    { pattern: "password = '", severity: 'critical', message: 'Hardcoded password string' },
    { pattern: 'AIzaSy', severity: 'high', message: 'Google API key hardcoded (restrict in Google Console)' },
    { pattern: 'dangerouslySetInnerHTML', severity: 'high', message: 'XSS risk via dangerouslySetInnerHTML' },
    { pattern: '@ts-nocheck', severity: 'high', message: 'TypeScript checking disabled for entire file' },
    { pattern: 'document.write', severity: 'high', message: 'document.write — XSS and performance risk' },
    { pattern: 'security: false', severity: 'high', message: 'Security explicitly disabled' },
    { pattern: 'verify: false', severity: 'high', message: 'Verification disabled (possible cert bypass)' },
    { pattern: 'rejectUnauthorized: false', severity: 'high', message: 'SSL verification disabled' },
    { pattern: 'NODE_TLS_REJECT_UNAUTHORIZED', severity: 'high', message: 'Node TLS rejection override' },
    { pattern: 'allowHTTP', severity: 'high', message: 'HTTP (non-HTTPS) explicitly allowed' },
    { pattern: '@ts-ignore', severity: 'medium', message: 'TypeScript error suppressed' },
    { pattern: '@ts-expect-error', severity: 'medium', message: 'TypeScript error expected/suppressed' },
    { pattern: 'innerHTML =', severity: 'medium', message: 'Potential XSS via innerHTML' },
    { pattern: 'outerHTML =', severity: 'medium', message: 'Potential XSS via outerHTML' },
    { pattern: 'cors({ origin: true', severity: 'medium', message: 'CORS allows all origins' },
    { pattern: "cors({ origin: '*'", severity: 'medium', message: 'CORS wildcard origin' },
    { pattern: 'Access-Control-Allow-Origin: *', severity: 'medium', message: 'CORS wildcard header' },
    { pattern: 'localStorage.', severity: 'medium', message: 'localStorage — insecure for sensitive data' },
    { pattern: 'sessionStorage.', severity: 'medium', message: 'sessionStorage — cleared on tab close' },
    { pattern: 'debugger', severity: 'low', message: 'debugger statement in code' },
    { pattern: 'TODO:', severity: 'low', message: 'TODO comment' },
    { pattern: 'FIXME:', severity: 'low', message: 'FIXME comment' },
    { pattern: 'HACK:', severity: 'low', message: 'HACK comment' },
    { pattern: 'XXX:', severity: 'low', message: 'XXX comment' },
    { pattern: 'TEMP:', severity: 'low', message: 'TEMP comment' },
    { pattern: 'WORKAROUND:', severity: 'low', message: 'WORKAROUND comment' },
    { pattern: '__DEV__', severity: 'info', message: 'Dev-only code block' },
    { pattern: 'as any', severity: 'info', message: 'TypeScript "any" cast' },
    { pattern: ': any', severity: 'info', message: 'TypeScript "any" type' },
    { pattern: '<any>', severity: 'info', message: 'TypeScript "any" generic' },
    { pattern: 'eslint-disable', severity: 'info', message: 'ESLint rule disabled' },
    { pattern: 'istanbul ignore', severity: 'info', message: 'Test coverage ignored' },
    { pattern: 'c8 ignore', severity: 'info', message: 'Test coverage ignored (c8)' },
    { pattern: 'noinspection', severity: 'info', message: 'IDE inspection suppressed' },
  ];
  const contextPatterns = [
    { regex: /\beval\s*\(/g, severity: 'critical', message: 'eval() - code injection risk' },
    { regex: /new\s+Function\s*\(/g, severity: 'critical', message: 'new Function() - code injection risk' },
    { regex: /password\s*=\s*['"][^'"]+['"]/gi, severity: 'critical', message: 'Hardcoded password string' },
    { regex: /child_process.*exec|execSync\s*\(|execFile\s*\(/g, severity: 'medium', message: 'exec - potential command injection' },
    { regex: /\bspawn\s*\(/g, severity: 'medium', message: 'spawn() - potential command injection' },
    { regex: /Math\.random\s*\(\)/g, severity: 'info', message: 'Math.random() - not cryptographically secure' },
    { regex: /\bconsole\.(log|warn)\s*\(/g, severity: 'info', message: 'console.log/warn() in code' },
    { regex: /\bwindow\.alert\s*\(/g, severity: 'low', message: 'window.alert() in code' },
    { regex: /\bwindow\.confirm\s*\(/g, severity: 'low', message: 'window.confirm() in code' },
  ];
  const issues = [], fileIssueCounts = {};
  const sourceData = getSourceData(sourceFiles);
  for (const { rel: relPath, content } of sourceData) {
    for (const check of dangerousPatterns) {
      const escaped = check.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matches = content.match(new RegExp(escaped, 'g'));
      if (matches) { issues.push({ file: relPath, severity: check.severity, message: check.message, count: matches.length, pattern: check.pattern }); fileIssueCounts[relPath] = (fileIssueCounts[relPath] ?? 0) + matches.length; }
    }
    for (const check of contextPatterns) {
      const regex = new RegExp(check.regex.source, check.regex.flags);
      const matches = content.match(regex);
      if (matches) { issues.push({ file: relPath, severity: check.severity, message: check.message, count: matches.length, pattern: check.regex.source }); fileIssueCounts[relPath] = (fileIssueCounts[relPath] ?? 0) + matches.length; }
    }
  }
  const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  const gitignore = readFile('.gitignore');
  const gitignoreChecks = {
    envFiles: gitignore.includes('.env'), nodeModules: gitignore.includes('node_modules'),
    buildDirs: gitignore.includes('dist') || gitignore.includes('build'), osFiles: gitignore.includes('.DS_Store'),
    ideFiles: gitignore.includes('.idea') || gitignore.includes('.vscode'), coverage: gitignore.includes('coverage'),
    logs: gitignore.includes('*.log'), keystores: gitignore.includes('.keystore') || gitignore.includes('.jks'),
    certificates: gitignore.includes('.pem') || gitignore.includes('.p12'),
  };
  return {
    issueCount: issues.length,
    bySeverity: { critical: issues.filter(i => i.severity === 'critical').length, high: issues.filter(i => i.severity === 'high').length, medium: issues.filter(i => i.severity === 'medium').length, low: issues.filter(i => i.severity === 'low').length, info: issues.filter(i => i.severity === 'info').length },
    issues, mostProblematicFiles: Object.entries(fileIssueCounts).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([file, count]) => ({ file, issueCount: count })),
    gitignoreChecks,
    securityHeaders: { hasHelmet: getAllSourceContent().includes('helmet'), hasCsp: getAllSourceContent().includes('Content-Security-Policy'), hasHsts: getAllSourceContent().includes('Strict-Transport-Security'), hasXFrame: getAllSourceContent().includes('X-Frame-Options'), hasXContent: getAllSourceContent().includes('X-Content-Type-Options') },
  };
}

// ─── 6. File Structure ────────────────────────────────────
function scanFileStructure(sourceFiles) {
  console.log('📁 Scanning file structure...');
  const allFiles = getAllFiles(ROOT, []);
  const stats = { totalFiles: allFiles.length, totalCodeFiles: sourceFiles.length, byExtension: {}, byDirectory: {}, largestFiles: [], totalLinesOfCode: 0, maxDirectoryDepth: 0, emptyFiles: 0 };
  for (const file of allFiles) { const ext = path.extname(file) || '(none)'; stats.byExtension[ext] = (stats.byExtension[ext] ?? 0) + 1; }
  const fileDetails = [];
  for (const file of sourceFiles) {
    const content = readFileAbs(file), lines = countLines(content);
    stats.totalLinesOfCode += lines;
    if (content.trim().length === 0) stats.emptyFiles++;
    const relPath = rel(file), parts = relPath.split(path.sep), dir = parts[0] || 'root';
    stats.byDirectory[dir] = (stats.byDirectory[dir] ?? 0) + 1;
    stats.maxDirectoryDepth = Math.max(stats.maxDirectoryDepth, parts.length);
    fileDetails.push({ file: relPath, lines, bytes: content.length });
  }
  stats.largestFiles = fileDetails.sort((a, b) => b.lines - a.lines).slice(0, 25);
  stats.averageLinesPerFile = sourceFiles.length > 0 ? Math.round(stats.totalLinesOfCode / sourceFiles.length) : 0;
  stats.medianLinesPerFile = (() => {
    if (fileDetails.length === 0) return 0;
    const sorted = fileDetails.map(f => f.lines).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  })();
  stats.longFiles = fileDetails.filter(f => f.lines > 300).length;
  const namingIssues = [];
  for (const file of sourceFiles) {
    const name = path.basename(file, path.extname(file)), relPath = rel(file);
    if ((relPath.includes('component') || relPath.endsWith('.tsx')) && name[0] && name[0] === name[0].toLowerCase() && !name.startsWith('use') && !name.startsWith('index') && !name.startsWith('_') && !name.startsWith('[') && !name.startsWith('+')) {
      if (!relPath.startsWith('app' + path.sep) && !relPath.startsWith('app/') && !relPath.startsWith('pages'))
        namingIssues.push({ file: relPath, issue: 'Component file not PascalCase' });
    }
  }
  const configFiles = ['tsconfig.json','babel.config.js','babel.config.ts','metro.config.js','metro.config.ts','jest.config.js','jest.config.ts','jest.config.mjs','eslint.config.js','eslint.config.mjs','.eslintrc.js','.eslintrc.json','.eslintrc.yml','.prettierrc','.prettierrc.json','.prettierrc.js','prettier.config.js','prettier.config.mjs','.prettierignore','.eslintignore','app.json','app.config.js','app.config.ts','eas.json','firebase.json','firestore.rules','firestore.indexes.json','storage.rules','Dockerfile','docker-compose.yml','docker-compose.yaml','.dockerignore','.gitignore','.gitattributes','.nvmrc','.node-version','.tool-versions','README.md','CHANGELOG.md','LICENSE','LICENSE.md','SECURITY.md','CONTRIBUTING.md','CODE_OF_CONDUCT.md','.github/workflows','.editorconfig','.browserslistrc','tailwind.config.js','tailwind.config.ts','postcss.config.js','nativewind-env.d.ts','global.css','Procfile','fly.toml','render.yaml','railway.json','vercel.json','netlify.toml','.husky','commitlint.config.js','.commitlintrc','lint-staged.config.js','.lintstagedrc','turbo.json','lerna.json','nx.json','pnpm-workspace.yaml','.env.example','.env.template','renovate.json','.renovaterc','dependabot.yml','.github/dependabot.yml'];
  stats.configFilesPresent = configFiles.filter(f => fileExists(path.join(ROOT, f)));
  stats.configFilesMissing = configFiles.filter(f => !fileExists(path.join(ROOT, f)));
  stats.namingIssues = namingIssues.slice(0, 20);
  stats.topLevelDirs = (() => { try { return fs.readdirSync(ROOT, { withFileTypes: true }).filter(e => e.isDirectory() && !IGNORE_DIRS.has(e.name) && !e.name.startsWith('.')).map(e => e.name); } catch { return []; } })();
  return stats;
}

// ─── 7. Git ───────────────────────────────────────────────
function scanGit() {
  console.log('📝 Scanning git info...');
  return {
    isGitRepo: fileExists(path.join(ROOT, '.git')),
    currentBranch: run('git branch --show-current'),
    lastCommitHash: run('git log -1 --format="%H"'),
    lastCommitAuthor: run('git log -1 --format="%an"'),
    lastCommitDate: run('git log -1 --format="%ai"'),
    lastCommitMessage: run('git log -1 --format="%s"'),
    totalCommits: run('git rev-list --count HEAD'),
    firstCommitDate: run('git log --reverse --format="%ai" -1'),
    remoteUrl: run('git remote get-url origin'),
    uncommittedFiles: (run('git status --short') ?? '').split('\n').filter(Boolean).length,
    stagedFiles: (run('git diff --cached --name-only') ?? '').split('\n').filter(Boolean).length,
    untrackedFiles: (run('git ls-files --others --exclude-standard') ?? '').split('\n').filter(Boolean).length,
    stashCount: (run('git stash list') ?? '').split('\n').filter(Boolean).length,
    hasGitHubActions: fileExists(path.join(ROOT, '.github/workflows')),
    hasGitIgnore: fileExists(path.join(ROOT, '.gitignore')),
    hasGitAttributes: fileExists(path.join(ROOT, '.gitattributes')),
    topContributors: (run('git shortlog -sn HEAD') ?? '').split('\n').slice(0, 10).map(l => l.trim()).filter(Boolean),
    tags: (run('git tag --list') ?? '').split('\n').filter(Boolean),
    branches: (run('git branch -a') ?? '').split('\n').map(b => b.trim().replace('* ', '')).filter(Boolean),
    recentCommits: (run('git log --oneline -20') ?? '').split('\n').filter(Boolean),
    mergeConflicts: (run('git diff --name-only --diff-filter=U') ?? '').split('\n').filter(Boolean),
    largeFiles: (run('git ls-files') ?? '').split('\n').filter(Boolean).length,
    gitHooks: (() => {
      const hooks = {};
      const huskyDir = path.join(ROOT, '.husky');
      if (fileExists(huskyDir)) { try { const files = fs.readdirSync(huskyDir).filter(f => !f.startsWith('.') && !f.startsWith('_')); for (const f of files) hooks[f] = readFileAbs(path.join(huskyDir, f)).trim().split('\n').filter(l => l.trim() && !l.startsWith('#')).join('; '); } catch {} }
      const gitHooksDir = path.join(ROOT, '.git/hooks');
      if (fileExists(gitHooksDir)) { try { const files = fs.readdirSync(gitHooksDir).filter(f => !f.endsWith('.sample')); for (const f of files) hooks[f] = '(custom git hook)'; } catch {} }
      return hooks;
    })(),
    commitConventions: (() => {
      const commits = (run('git log --oneline -50') ?? '').split('\n').filter(Boolean);
      const conventional = commits.filter(c => /^[a-f0-9]+ (feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)(\(.+\))?:/.test(c)).length;
      return { total: commits.length, conventional, ratio: commits.length > 0 ? `${Math.round((conventional / commits.length) * 100)}%` : 'N/A' };
    })(),
    lfs: run('git lfs ls-files') !== null,
    submodules: fileExists(path.join(ROOT, '.gitmodules')),
  };
}

// ─── 8. Code Quality ──────────────────────────────────────
function scanCodeQuality(sourceFiles) {
  console.log('✨ Scanning code quality...');
  let totalLines = 0, commentLines = 0, blankLines = 0, anyCount = 0, tsIgnoreCount = 0, consoleCount = 0, todoCount = 0, fixmeCount = 0;
  let testFiles = 0, componentFiles = 0, utilFiles = 0, hookFiles = 0, typeFiles = 0, constantFiles = 0;
  let longestFunction = { file: '', length: 0, name: '' }, maxComplexity = { file: '', complexity: 0 };
  for (const file of sourceFiles) {
    const relPath = rel(file), content = readFileAbs(file), lines = content.split('\n');
    totalLines += lines.length;
    const bn = path.basename(relPath);
    if (relPath.includes('.test.') || relPath.includes('.spec.') || relPath.includes('__tests__')) testFiles++;
    if (relPath.endsWith('.tsx') || relPath.includes('component')) componentFiles++;
    if (relPath.includes('util') || relPath.includes('helper') || relPath.includes('lib/')) utilFiles++;
    if (bn.startsWith('use') && (relPath.endsWith('.ts') || relPath.endsWith('.tsx'))) hookFiles++;
    if (relPath.includes('types') || relPath.includes('.d.ts') || relPath.includes('interfaces')) typeFiles++;
    if (relPath.includes('constant') || relPath.includes('config')) constantFiles++;
    let funcStart = -1, funcName = '', braceDepth = 0, inFunc = false, ifCount = 0, elseCount = 0, ternaryCount = 0, switchCount = 0, catchCount = 0;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t) { blankLines++; continue; }
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) commentLines++;
      if (t.includes('TODO:') || t.includes('TODO ')) todoCount++;
      if (t.includes('FIXME:') || t.includes('FIXME ')) fixmeCount++;
      if (t.includes(': any') || t.includes('as any') || t.includes('<any>') || t.includes('any[]') || t.includes('any,') || t.includes('any;')) anyCount++;
      if (t.includes('@ts-ignore') || t.includes('@ts-nocheck') || t.includes('@ts-expect-error')) tsIgnoreCount++;
      if (t.match(/console\.(log|error|warn|info|debug|trace)\(/)) consoleCount++;
      if (t.includes('if (') || t.includes('if(')) ifCount++;
      if (t.includes('else')) elseCount++;
      if (t.includes('? ') && t.includes(' : ')) ternaryCount++;
      if (t.includes('switch (') || t.includes('switch(')) switchCount++;
      if (t.includes('catch')) catchCount++;
      const funcMatch = t.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/) || t.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/);
      if (funcMatch && !inFunc) { funcStart = i; funcName = funcMatch[1]; braceDepth = 0; inFunc = true; }
      if (inFunc) { braceDepth += (t.match(/{/g) || []).length - (t.match(/}/g) || []).length; if (braceDepth <= 0 && i > funcStart) { const len = i - funcStart + 1; if (len > longestFunction.length) longestFunction = { file: relPath, length: len, name: funcName }; inFunc = false; } }
    }
    const complexity = ifCount + elseCount + ternaryCount + switchCount + catchCount;
    if (complexity > maxComplexity.complexity) maxComplexity = { file: relPath, complexity };
  }
  const eslintConfig = readFile('.eslintrc.js') || readFile('.eslintrc.json') || readFile('eslint.config.js') || readFile('eslint.config.mjs');
  const prettierConfig = readFile('.prettierrc') || readFile('.prettierrc.json') || readFile('prettier.config.js');
  return {
    totalLines, codeLines: totalLines - commentLines - blankLines, commentLines, blankLines,
    commentRatio: `${Math.round((commentLines / Math.max(totalLines, 1)) * 100)}%`,
    blankRatio: `${Math.round((blankLines / Math.max(totalLines, 1)) * 100)}%`,
    files: { total: sourceFiles.length, test: testFiles, component: componentFiles, util: utilFiles, hook: hookFiles, type: typeFiles, constant: constantFiles },
    issues: { todos: todoCount, fixmes: fixmeCount, anyTypes: anyCount, tsIgnores: tsIgnoreCount, consoleLogs: consoleCount },
    complexity: { longestFunction, maxComplexityFile: maxComplexity },
    hasLinter: eslintConfig.length > 0, hasFormatter: prettierConfig.length > 0,
    hasEditorConfig: fileExists(path.join(ROOT, '.editorconfig')),
    hasLintStaged: fileExists(path.join(ROOT, 'lint-staged.config.js')) || fileExists(path.join(ROOT, '.lintstagedrc')) || !!readJSON(path.join(ROOT, 'package.json'))?.['lint-staged'],
    hasCommitLint: fileExists(path.join(ROOT, 'commitlint.config.js')) || fileExists(path.join(ROOT, '.commitlintrc')),
    hasHusky: fileExists(path.join(ROOT, '.husky')),
    hasConsoleStripping: (() => { const babel = readFile('babel.config.js') + readFile('babel.config.ts'); return babel.includes('transform-remove-console') || babel.includes('strip-console'); })(),
  };
}

// ─── 9. API Endpoints ─────────────────────────────────────
function scanAPIEndpoints() {
  console.log('🔌 Scanning API endpoints...');
  const serverFiles = [...getAllFiles(path.join(ROOT, 'server'), ['.ts','.js']), ...getAllFiles(path.join(ROOT, 'api'), ['.ts','.js']), ...getAllFiles(path.join(ROOT, 'functions'), ['.ts','.js']), ...getAllFiles(path.join(ROOT, 'backend'), ['.ts','.js']), ...getAllFiles(path.join(ROOT, 'src/server'), ['.ts','.js']), ...getAllFiles(path.join(ROOT, 'src/api'), ['.ts','.js']), ...getAllFiles(path.join(ROOT, 'src/routes'), ['.ts','.js'])].filter(f => !f.includes('node_modules'));
  const endpoints = [], middlewares = [];
  for (const file of serverFiles) {
    const content = readFileAbs(file), lines = content.split('\n'), relPath = rel(file);
    lines.forEach((line, idx) => {
      const m = line.match(/(?:app|router)\.(get|post|put|patch|delete|all|use|options|head)\s*\(\s*['"`]([^'"`]+)['"`]/i);
      if (!m) return;
      const context = lines.slice(Math.max(0, idx - 5), idx + 10).join(' ');
      const ep = { method: m[1].toUpperCase(), path: m[2], file: relPath, line: idx + 1, hasAuth: context.includes('requireAuth') || context.includes('verifyToken') || context.includes('authenticate') || context.includes('isAuthenticated') || context.includes('passport'), hasRateLimit: context.includes('Limiter') || context.includes('rateLimit'), hasValidation: context.includes('validate') || context.includes('express-validator') || context.includes('schema') || context.includes('joi') || context.includes('zod'), hasErrorHandler: context.includes('try') && context.includes('catch') };
      if (m[1].toUpperCase() === 'USE') middlewares.push(ep); else endpoints.push(ep);
    });
  }
  const publicEndpoints = ['/health','/healthz','/ping','/status','/ready','/alive','/version'];
  return {
    total: endpoints.length,
    byMethod: { GET: endpoints.filter(e => e.method === 'GET').length, POST: endpoints.filter(e => e.method === 'POST').length, PUT: endpoints.filter(e => e.method === 'PUT').length, PATCH: endpoints.filter(e => e.method === 'PATCH').length, DELETE: endpoints.filter(e => e.method === 'DELETE').length, OPTIONS: endpoints.filter(e => e.method === 'OPTIONS').length, HEAD: endpoints.filter(e => e.method === 'HEAD').length },
    withoutAuth: endpoints.filter(e => !e.hasAuth && !publicEndpoints.includes(e.path)).length,
    withoutRateLimit: endpoints.filter(e => !e.hasRateLimit && !publicEndpoints.includes(e.path)).length,
    withoutValidation: endpoints.filter(e => !e.hasValidation && !publicEndpoints.includes(e.path) && ['POST','PUT','PATCH'].includes(e.method)).length,
    withoutErrorHandler: endpoints.filter(e => !e.hasErrorHandler).length,
    endpoints, middlewares, serverFileCount: serverFiles.length,
  };
}

// ─── 10. Dependency Health ────────────────────────────────
function scanDependencyHealth() {
  console.log('🏥 Scanning dependency health...');
  const hasPackageLock = fileExists(path.join(ROOT, 'package-lock.json')), hasYarnLock = fileExists(path.join(ROOT, 'yarn.lock')), hasPnpmLock = fileExists(path.join(ROOT, 'pnpm-lock.yaml')), hasBunLock = fileExists(path.join(ROOT, 'bun.lockb'));
  const lockfileCount = [hasPackageLock, hasYarnLock, hasPnpmLock, hasBunLock].filter(Boolean).length;
  let vulnerabilities = null;
  try { const out = run('npm audit --json 2>/dev/null'); if (out) { const p = JSON.parse(out); vulnerabilities = p.metadata?.vulnerabilities ?? null; } } catch {}
  let outdated = null;
  try { const out = run('npm outdated --json 2>/dev/null'); if (out) { outdated = Object.entries(JSON.parse(out)).map(([name, info]) => ({ name, current: info.current, wanted: info.wanted, latest: info.latest, isOutdated: info.current !== info.latest, isMajorBehind: (() => { try { return parseInt(info.latest?.split('.')[0]) > parseInt(info.current?.split('.')[0]); } catch { return false; } })() })); } } catch {}
  const pkg = readJSON(path.join(ROOT, 'package.json'));
  const allPkgDeps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const nativeModules = [];
  for (const depName of Object.keys(allPkgDeps)) {
    const depPkg = readJSON(path.join(ROOT, 'node_modules', depName, 'package.json'));
    if (depPkg && (depPkg.nativePackage || depPkg.rnpm || depPkg['react-native'] || fileExists(path.join(ROOT, 'node_modules', depName, 'android')) || fileExists(path.join(ROOT, 'node_modules', depName, 'ios')) || fileExists(path.join(ROOT, 'node_modules', depName, 'cpp')))) nativeModules.push(depName);
  }
  const hasRenovate = fileExists(path.join(ROOT, 'renovate.json')) || fileExists(path.join(ROOT, '.renovaterc'));
  const hasDependabot = fileExists(path.join(ROOT, '.github/dependabot.yml'));
  return {
    lockfile: { packageLock: hasPackageLock, yarnLock: hasYarnLock, pnpmLock: hasPnpmLock, bunLock: hasBunLock, hasAny: lockfileCount > 0, multipleLockfiles: lockfileCount > 1 },
    vulnerabilities, outdatedPackages: outdated, outdatedCount: outdated?.filter(p => p.isOutdated).length ?? null,
    majorUpdatesAvailable: outdated?.filter(p => p.isMajorBehind).length ?? null,
    nativeModules, nativeModuleCount: nativeModules.length,
    autoUpdate: { renovate: hasRenovate, dependabot: hasDependabot, hasAny: hasRenovate || hasDependabot },
  };
}

// ─── 11. Routes & Navigation ─────────────────────────────
function scanRoutes() {
  console.log('🧭 Scanning routes & navigation...');
  const appDir = path.join(ROOT, 'app'), pagesDir = path.join(ROOT, 'pages'), srcAppDir = path.join(ROOT, 'src/app');
  const routeDir = fileExists(appDir) ? appDir : fileExists(srcAppDir) ? srcAppDir : fileExists(pagesDir) ? pagesDir : null;
  const routeType = routeDir === appDir || routeDir === srcAppDir ? 'expo-router' : routeDir === pagesDir ? 'pages' : 'none';
  const routeFiles = routeDir ? getAllFiles(routeDir, ['.tsx','.ts','.jsx','.js']) : [];
  const routes = [], layouts = [], errorBoundaries = [], modals = [], apiRoutes = [], groups = new Set();
  for (const file of routeFiles) {
    const relPath = rel(file), bn = path.basename(file, path.extname(file)), content = readFileAbs(file);
    if (bn === '_layout' || bn === 'layout') layouts.push({ file: relPath, hasTabBar: content.includes('Tabs') || content.includes('BottomTab'), hasStack: content.includes('Stack'), hasDrawer: content.includes('Drawer') });
    else if (bn === '+not-found' || bn === 'not-found' || bn === '404') errorBoundaries.push({ file: relPath, type: 'not-found' });
    else if (bn === '+html' || bn === '_error' || bn === 'error') errorBoundaries.push({ file: relPath, type: bn });
    else if (relPath.includes('+api') || relPath.includes('api/')) apiRoutes.push({ file: relPath });
    else if (!bn.startsWith('_') && !bn.startsWith('+')) {
      const routePath = relPath.replace(/\.(tsx|ts|jsx|js)$/, '').replace(/\\/g, '/');
      const isDynamic = routePath.includes('[');
      const isModal = content.includes('presentation: "modal"') || content.includes("presentation: 'modal'") || relPath.includes('modal');
      if (isModal) modals.push({ file: relPath, route: routePath });
      routes.push({ file: relPath, route: routePath, isDynamic, isModal, params: (routePath.match(/\[([^\]]+)\]/g) ?? []).map(p => p.replace(/[[\]]/g, '')) });
    }
    const groupMatch = relPath.match(/\(([^)]+)\)/g);
    if (groupMatch) groupMatch.forEach(g => groups.add(g));
  }
  const sourceData = getSourceData(getSourceFiles());
  const navigations = [];
  for (const { rel: rp, lines } of sourceData) {
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i];
      if (t.includes('router.push(') || t.includes('router.replace(') || t.includes('router.navigate(') || t.includes('navigation.navigate(') || t.includes('navigation.push(') || t.includes('navigation.goBack(') || t.includes('router.back()') || t.includes('Redirect') || t.includes('<Link')) {
        const urlMatch = t.match(/['"`]([/][^'"`]*?)['"`]/);
        navigations.push({ file: rp, line: i + 1, target: urlMatch?.[1] ?? '(dynamic)' });
      }
    }
  }
  const deepLinks = [];
  const appJson = readJSON(path.join(ROOT, 'app.json'));
  if (appJson?.expo?.scheme) deepLinks.push({ type: 'scheme', value: appJson.expo.scheme });
  if (appJson?.expo?.ios?.associatedDomains) for (const d of appJson.expo.ios.associatedDomains) deepLinks.push({ type: 'associated-domain', value: d });
  if (appJson?.expo?.android?.intentFilters) for (const f of appJson.expo.android.intentFilters) deepLinks.push({ type: 'intent-filter', value: JSON.stringify(f) });
  return {
    type: routeType, totalRoutes: routes.length, dynamicRoutes: routes.filter(r => r.isDynamic).length,
    staticRoutes: routes.filter(r => !r.isDynamic).length, layouts: layouts.length, groups: [...groups],
    modals: modals.length, apiRoutes: apiRoutes.length, errorBoundaries: errorBoundaries.length,
    routes, layouts, errorBoundaries, apiRoutes, navigations: navigations.slice(0, 50), deepLinks,
    hasNotFound: errorBoundaries.some(e => e.type === 'not-found'), hasTabNavigation: layouts.some(l => l.hasTabBar),
    hasStackNavigation: layouts.some(l => l.hasStack), hasDrawerNavigation: layouts.some(l => l.hasDrawer),
  };
}

// ─── 12. Components & Hooks ──────────────────────────────
function scanComponents() {
  console.log('⚛️  Scanning React components & hooks...');
  const sourceData = getSourceData(getSourceFiles());
  const components = [], hooks = [], contexts = [], providers = [], hocs = [];
  for (const { rel: rp, content, lines, ext } of sourceData) {
    const hasJSX = content.includes('return (') && (content.includes('<') || content.includes('jsx'));
    if ((ext === '.tsx' || ext === '.jsx') && hasJSX) {
      components.push({
        file: rp, lines: lines.length,
        usesMemo: /\bReact\.memo\b/.test(content) || /\bexport\s+default\s+memo\(/.test(content) || /\b(?:const|let)\s+\w+\s*=\s*memo\(/.test(content),
        usesForwardRef: content.includes('forwardRef'), usesErrorBoundary: content.includes('componentDidCatch') || content.includes('ErrorBoundary'),
        propsInterface: (content.match(/interface\s+\w+Props/g) ?? []).length,
        stateCount: (content.match(/useState/g) ?? []).length, effectCount: (content.match(/useEffect/g) ?? []).length,
        refCount: (content.match(/useRef/g) ?? []).length, memoCount: (content.match(/useMemo/g) ?? []).length,
        callbackCount: (content.match(/useCallback/g) ?? []).length, hasStyleSheet: content.includes('StyleSheet.create'),
        hasInlineStyles: (content.match(/style=\{\{/g) ?? []).length > 0, inlineStyleCount: (content.match(/style=\{\{/g) ?? []).length,
        isClassComponent: content.includes('extends React.Component') || content.includes('extends Component'),
      });
    }
    const bn = path.basename(rp, path.extname(rp));
    if (bn.startsWith('use') && bn[3] && bn[3] === bn[3].toUpperCase()) {
      hooks.push({ file: rp, name: bn, lines: lines.length, dependencies: unique([...(content.match(/use[A-Z]\w+/g) ?? []).filter(h => h !== bn)]), hasCleanup: content.includes('return () =>') || content.includes('return function'), usesEffect: content.includes('useEffect'), usesState: content.includes('useState'), usesRef: content.includes('useRef'), usesContext: content.includes('useContext'), usesCallback: content.includes('useCallback'), usesMemo: content.includes('useMemo'), isAsync: content.includes('async') || content.includes('Promise') });
    }
    if (content.includes('createContext')) {
      const ctxMatches = content.match(/(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:React\.)?createContext/g) ?? [];
      for (const m of ctxMatches) { const nameMatch = m.match(/(?:const|let)\s+(\w+)/); contexts.push({ file: rp, name: nameMatch?.[1] ?? 'unknown' }); }
    }
    if (content.includes('Provider') && content.includes('value=')) providers.push({ file: rp });
    if (content.includes('withRouter') || content.includes('connect(') || content.match(/with[A-Z]\w+\s*\(/)) hocs.push({ file: rp });
  }
  const propDrilling = [];
  for (const { rel: rp, content } of sourceData) {
    const spreadCount = (content.match(/\{\.\.\.props\}/g) ?? []).length + (content.match(/\.\.\.(?:rest|props|other)/g) ?? []).length;
    if (spreadCount > 2) propDrilling.push({ file: rp, spreadCount });
  }
  return {
    totalComponents: components.length, classComponents: components.filter(c => c.isClassComponent).length,
    functionalComponents: components.filter(c => !c.isClassComponent).length,
    memoizedComponents: components.filter(c => c.usesMemo).length, forwardRefComponents: components.filter(c => c.usesForwardRef).length,
    averageComponentLines: components.length > 0 ? Math.round(components.reduce((a, c) => a + c.lines, 0) / components.length) : 0,
    largestComponents: components.sort((a, b) => b.lines - a.lines).slice(0, 10).map(c => ({ file: c.file, lines: c.lines })),
    componentsWith5PlusState: components.filter(c => c.stateCount >= 5).map(c => ({ file: c.file, stateCount: c.stateCount })),
    componentsWithInlineStyles: components.filter(c => c.hasInlineStyles).map(c => ({ file: c.file, count: c.inlineStyleCount })),
    customHooks: hooks, hookCount: hooks.length,
    hooksWithoutCleanup: hooks.filter(h => h.usesEffect && !h.hasCleanup).map(h => ({ file: h.file, name: h.name })),
    contexts, contextCount: contexts.length, providers: providers.length, hocs: hocs.length,
    propDrilling: propDrilling.slice(0, 10), errorBoundaries: components.filter(c => c.usesErrorBoundary).length,
  };
}

// ─── 13. Error Handling ──────────────────────────────────
function scanErrorHandling() {
  console.log('🚨 Scanning error handling...');
  const sourceData = getSourceData(getSourceFiles());
  let tryCatchBlocks = 0, catchBlocks = 0, emptyTryCatch = 0, errorBoundaries = 0, throwStatements = 0, unhandledPromises = 0, promiseWithCatch = 0, consoleErrorCount = 0, sentryCapture = 0;
  const asyncWithoutTryCatch = [], emptyHandlers = [];
  for (const { rel: rp, content } of sourceData) {
    const tryCount = (content.match(/try\s*\{/g) ?? []).length, catchCount = (content.match(/catch\s*\(/g) ?? []).length;
    tryCatchBlocks += tryCount; catchBlocks += catchCount;
    const emptyCatchMatches = content.match(/catch\s*\([^)]*\)\s*\{\s*(?:\/\/[^\n]*)?\s*\}/g) ?? [];
    emptyTryCatch += emptyCatchMatches.length;
    if (emptyCatchMatches.length > 0) emptyHandlers.push({ file: rp, count: emptyCatchMatches.length });
    if (content.includes('componentDidCatch') || content.includes('ErrorBoundary')) errorBoundaries++;
    throwStatements += (content.match(/throw\s+/g) ?? []).length;
    promiseWithCatch += (content.match(/\.catch\s*\(/g) ?? []).length;
    consoleErrorCount += (content.match(/console\.error\s*\(/g) ?? []).length;
    sentryCapture += (content.match(/Sentry\.capture|captureException|captureMessage/g) ?? []).length;
    const asyncFuncs = content.match(/async\s+(?:function\s+\w+|\(\w*\)|\w+)\s*(?:\([^)]*\))?\s*(?:=>|{)/g) ?? [];
    if (asyncFuncs.length > 0 && tryCount === 0 && catchCount === 0 && content.includes('await')) asyncWithoutTryCatch.push({ file: rp, asyncFunctionCount: asyncFuncs.length });
    const thenCount = (content.match(/\.then\s*\(/g) ?? []).length;
    const fileCatch = (content.match(/\.catch\s*\(/g) ?? []).length;
    if (thenCount > 0 && fileCatch === 0 && tryCount === 0) unhandledPromises++;
  }
  const allContent = getAllSourceContent();
  const globalHandlers = {
    unhandledRejection: allContent.includes('unhandledRejection') || allContent.includes('onunhandledrejection'),
    uncaughtException: allContent.includes('uncaughtException') || allContent.includes('onerror'),
    errorBoundaryWrapper: allContent.includes('ErrorBoundary') && allContent.includes('fallback'),
    globalCatch: allContent.includes('window.onerror') || allContent.includes('ErrorUtils'),
    sentryInit: allContent.includes('Sentry.init'), crashlytics: allContent.includes('crashlytics'),
  };
  return {
    tryCatchBlocks, catchBlocks, throwStatements, emptyTryCatch, promiseWithCatch, errorBoundaries, consoleErrorCount, sentryCapture,
    asyncWithoutTryCatch: asyncWithoutTryCatch.slice(0, 15), emptyHandlers: emptyHandlers.slice(0, 10), globalHandlers,
    errorLogging: sentryCapture > 0 ? 'Sentry' : consoleErrorCount > 0 ? 'console.error only' : 'None detected',
    score: (() => { let s = 0; if (tryCatchBlocks > 0) s += 20; if (errorBoundaries > 0) s += 20; if (emptyTryCatch === 0) s += 15; if (sentryCapture > 0) s += 15; if (globalHandlers.unhandledRejection || globalHandlers.sentryInit) s += 15; if (asyncWithoutTryCatch.length === 0) s += 15; return Math.min(s, 100); })(),
  };
}

// ─── 14. Network & Data Fetching ─────────────────────────
function scanNetworkCalls() {
  console.log('🌐 Scanning network calls...');
  const sourceData = getSourceData(getSourceFiles());
  const fetchCalls = [], axiosCalls = [], urls = new Set();
  let hasTimeout = false, hasRetry = false, hasAbortController = false, hasInterceptor = false, hasGraphQL = false, hasWebSocket = false, hasSSE = false;
  for (const { rel: rp, content, lines } of sourceData) {
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t.includes('fetch(') || t.includes('fetch (')) { const urlMatch = t.match(/fetch\s*\(\s*['"`]([^'"`]+)['"`]/); if (urlMatch) { urls.add(urlMatch[1]); fetchCalls.push({ file: rp, line: i + 1, url: urlMatch[1] }); } else fetchCalls.push({ file: rp, line: i + 1, url: '(dynamic)' }); }
      if (t.includes('axios.') || t.includes('axios(')) { const urlMatch = t.match(/['"`](https?:\/\/[^'"`]+)['"`]/) || t.match(/['"`](\/[^'"`]+)['"`]/); axiosCalls.push({ file: rp, line: i + 1, url: urlMatch?.[1] ?? '(dynamic)' }); if (urlMatch?.[1]) urls.add(urlMatch[1]); }
    }
    if (content.includes('timeout')) hasTimeout = true;
    if (content.includes('retry') || content.includes('retries') || content.includes('maxRetries')) hasRetry = true;
    if (content.includes('AbortController') || content.includes('signal')) hasAbortController = true;
    if (content.includes('interceptor') || content.includes('axios.interceptors')) hasInterceptor = true;
    if (content.includes('graphql') || content.includes('gql`') || content.includes('useQuery') || content.includes('useMutation')) hasGraphQL = true;
    if (content.includes('WebSocket') || content.includes('new WebSocket') || content.includes('socket.io') || content.includes('useWebSocket')) hasWebSocket = true;
    if (content.includes('EventSource') || content.includes('text/event-stream')) hasSSE = true;
  }
  const apiServiceFiles = getSourceFiles().filter(f => { const r = rel(f).toLowerCase(); return r.includes('api') || r.includes('service') || r.includes('client') || r.includes('http'); }).map(f => rel(f));
  const allContent = getAllSourceContent();
  const dataFetching = { tanstackQuery: allContent.includes('@tanstack/react-query') || allContent.includes('useQuery'), swr: allContent.includes('useSWR'), apollo: allContent.includes('@apollo/client'), urql: allContent.includes('urql'), rtk: allContent.includes('createApi') && allContent.includes('fetchBaseQuery'), axios: allContent.includes('axios'), ky: allContent.includes("from 'ky'"), got: allContent.includes("from 'got'") };
  return {
    fetchCalls: fetchCalls.length, axiosCalls: axiosCalls.length, totalNetworkCalls: fetchCalls.length + axiosCalls.length,
    uniqueUrls: [...urls].slice(0, 30), hasTimeout, hasRetry, hasAbortController, hasInterceptor, hasGraphQL, hasWebSocket, hasSSE,
    dataFetchingLibraries: Object.entries(dataFetching).filter(([, v]) => v).map(([k]) => k),
    apiServiceFiles: apiServiceFiles.slice(0, 20), fetchDetails: fetchCalls.slice(0, 30), axiosDetails: axiosCalls.slice(0, 30),
    resilience: { hasTimeout, hasRetry, hasAbortController, hasCircuitBreaker: allContent.includes('circuitBreaker') || allContent.includes('circuit-breaker'), hasBackoff: allContent.includes('backoff') || allContent.includes('exponential') },
  };
}

// ─── 15. Accessibility ───────────────────────────────────
function scanAccessibility() {
  console.log('♿ Scanning accessibility...');
  const sourceData = getSourceData(getSourceFiles());
  let labelCount = 0, roleCount = 0, hintCount = 0, stateCount = 0, accessibleProp = 0, importantForAccessibility = 0, touchableWithoutLabel = 0, imageWithoutAlt = 0, ariaCount = 0;
  const issues = [];
  for (const { rel: rp, content } of sourceData) {
    labelCount += (content.match(/accessibilityLabel/g) ?? []).length;
    roleCount += (content.match(/accessibilityRole/g) ?? []).length;
    hintCount += (content.match(/accessibilityHint/g) ?? []).length;
    stateCount += (content.match(/accessibilityState/g) ?? []).length;
    accessibleProp += (content.match(/accessible[=\s{]/g) ?? []).length;
    importantForAccessibility += (content.match(/importantForAccessibility/g) ?? []).length;
    ariaCount += (content.match(/aria-/g) ?? []).length;
    const touchableMatches = content.match(/<(TouchableOpacity|TouchableHighlight|Pressable|TouchableWithoutFeedback|TouchableNativeFeedback)\b[^>]*>/g) ?? [];
    for (const match of touchableMatches) { if (!match.includes('accessibilityLabel') && !match.includes('aria-label')) { touchableWithoutLabel++; if (touchableWithoutLabel <= 10) issues.push({ file: rp, issue: 'Touchable without accessibilityLabel' }); } }
    const imageMatches = content.match(/<Image\b[^>]*>/g) ?? [];
    for (const match of imageMatches) { if (!match.includes('accessibilityLabel') && !match.includes('alt=') && !match.includes('aria-label')) { imageWithoutAlt++; if (imageWithoutAlt <= 10) issues.push({ file: rp, issue: 'Image without accessibilityLabel/alt' }); } }
  }
  const allContent = getAllSourceContent();
  const hasScreenReaderSupport = allContent.includes('AccessibilityInfo') || allContent.includes('isScreenReaderEnabled');
  const hasDynamicFontSize = allContent.includes('fontScale') || allContent.includes('allowFontScaling') || allContent.includes('maxFontSizeMultiplier');
  const hasReducedMotion = allContent.includes('isReduceMotionEnabled') || allContent.includes('prefersReducedMotion') || allContent.includes('AccessibilityInfo');
  const hasVoiceOver = allContent.includes('announceForAccessibility') || allContent.includes('postAnnouncement');
  return {
    labels: labelCount, roles: roleCount, hints: hintCount, states: stateCount, accessibleProps: accessibleProp, ariaAttributes: ariaCount,
    touchableWithoutLabel, imageWithoutAlt, hasScreenReaderSupport, hasDynamicFontSize, hasReducedMotion, hasVoiceOver,
    issues: issues.slice(0, 20),
    score: (() => { let s = 0; if (labelCount > 0) s += 20; if (roleCount > 0) s += 15; if (hintCount > 0) s += 10; if (touchableWithoutLabel === 0) s += 20; if (imageWithoutAlt === 0) s += 15; if (hasScreenReaderSupport) s += 10; if (hasDynamicFontSize) s += 10; return Math.min(s, 100); })(),
  };
}

// ─── 16. Performance Patterns ─────────────────────────────
function scanPerformance() {
  console.log('⚡ Scanning performance patterns...');
  const sourceData = getSourceData(getSourceFiles());
  const issues = [];
  let inlineFunctions = 0, missingKeys = 0, heavyImports = 0;
  for (const { rel: rp, content } of sourceData) {
    const inlineFuncMatches = content.match(/on\w+=\{\s*\(\s*\)\s*=>/g) ?? [];
    inlineFunctions += inlineFuncMatches.length;
    if (inlineFuncMatches.length > 5) issues.push({ file: rp, issue: `${inlineFuncMatches.length} inline arrow functions in JSX`, severity: 'medium' });
    if (content.includes('<ScrollView') && (content.match(/<View/g) ?? []).length > 20 && !content.includes('FlatList') && !content.includes('FlashList')) issues.push({ file: rp, issue: 'ScrollView with many children — consider FlatList/FlashList', severity: 'high' });
    if (content.includes('.map(') && !content.includes('key=') && !content.includes('key:') && content.includes('return (')) {
      const mapBlocks = content.match(/\.map\(\s*(?:\([^)]*\)|[^=]*)\s*=>\s*(?:\(?\s*<)/g) ?? [];
      if (mapBlocks.length > 0) { const mapContext = content.split('.map('); for (let i = 1; i < mapContext.length; i++) { const block = mapContext[i].substring(0, 200); if (block.includes('<') && !block.includes('key=') && !block.includes('key:')) missingKeys++; } }
    }
    if (content.includes("from 'moment'") || content.includes("from 'lodash'") || content.includes("require('moment')") || content.includes("require('lodash')")) { heavyImports++; issues.push({ file: rp, issue: 'Heavy import (moment/lodash) — consider lighter alternatives', severity: 'medium' }); }
    if (content.split('\n').length > 500 && rp.endsWith('.tsx')) issues.push({ file: rp, issue: `Component file is ${content.split('\n').length} lines — consider splitting`, severity: 'low' });
    const objectInRender = (content.match(/style=\{\{/g) ?? []).length;
    if (objectInRender > 10) issues.push({ file: rp, issue: `${objectInRender} inline style objects — potential re-render cause`, severity: 'low' });
  }
  const allContent = getAllSourceContent();
  const optimizations = {
    usesFlashList: allContent.includes('FlashList'), usesFlatList: allContent.includes('FlatList'),
    usesSectionList: allContent.includes('SectionList'), usesVirtualizedList: allContent.includes('VirtualizedList'),
    usesMemo: (allContent.match(/useMemo/g) ?? []).length, usesCallback: (allContent.match(/useCallback/g) ?? []).length,
    usesReactMemo: (allContent.match(/React\.memo|memo\(/g) ?? []).length,
    usesLazy: allContent.includes('React.lazy') || allContent.includes('lazy('), usesSuspense: allContent.includes('Suspense'),
    usesInteractionManager: allContent.includes('InteractionManager'), usesRequestAnimationFrame: allContent.includes('requestAnimationFrame'),
    usesPureComponent: allContent.includes('PureComponent'),
    hasImageOptimization: allContent.includes('expo-image') || allContent.includes('FastImage') || allContent.includes('resizeMode'),
    hasListOptimization: allContent.includes('getItemLayout') || allContent.includes('removeClippedSubviews') || allContent.includes('windowSize') || allContent.includes('maxToRenderPerBatch'),
    hermes: allContent.includes('hermes') || readJSON(path.join(ROOT, 'app.json'))?.expo?.jsEngine === 'hermes',
    proguard: fileExists(path.join(ROOT, 'android/app/proguard-rules.pro')),
  };
  return {
    issues: issues.slice(0, 30), inlineFunctionsInJSX: inlineFunctions, possiblyMissingKeys: missingKeys, heavyImports, optimizations,
    score: (() => { let s = 50; if (optimizations.usesFlashList) s += 10; if (optimizations.usesMemo > 0) s += 5; if (optimizations.usesCallback > 0) s += 5; if (optimizations.usesReactMemo > 0) s += 5; if (optimizations.hasImageOptimization) s += 5; if (optimizations.hasListOptimization) s += 5; if (heavyImports > 0) s -= 10; if (inlineFunctions > 20) s -= 10; if (issues.filter(i => i.severity === 'high').length > 0) s -= 10; return Math.max(0, Math.min(s, 100)); })(),
  };
}

// ─── 17. Assets & Media ──────────────────────────────────
function scanAssets() {
  console.log('🖼️  Scanning assets...');
  const imageExts = ['.png','.jpg','.jpeg','.gif','.webp','.bmp','.ico','.tiff'], svgExts = ['.svg'], fontExts = ['.ttf','.otf','.woff','.woff2'], videoExts = ['.mp4','.mov','.avi','.webm','.mkv'], audioExts = ['.mp3','.wav','.m4a','.aac','.ogg','.flac'];
  const allAssetExts = [...imageExts, ...svgExts, ...fontExts, ...videoExts, ...audioExts];
  const assetDirs = ['assets','src/assets','public','static','images','fonts','media'];
  const allAssetFiles = [];
  for (const dir of assetDirs) allAssetFiles.push(...getAllFiles(path.join(ROOT, dir), []));
  allAssetFiles.push(...getAllFiles(ROOT, allAssetExts).filter(f => !rel(f).includes('node_modules')));
  const assets = { images: [], svgs: [], fonts: [], videos: [], audios: [], other: [] };
  let totalSize = 0;
  const largeAssets = [];
  for (const file of allAssetFiles) {
    const ext = path.extname(file).toLowerCase(), size = getFileSizeBytes(file);
    totalSize += size;
    const info = { file: rel(file), size, formattedSize: formatBytes(size), ext };
    if (size > 500 * 1024) largeAssets.push(info);
    if (imageExts.includes(ext)) assets.images.push(info);
    else if (svgExts.includes(ext)) assets.svgs.push(info);
    else if (fontExts.includes(ext)) assets.fonts.push(info);
    else if (videoExts.includes(ext)) assets.videos.push(info);
    else if (audioExts.includes(ext)) assets.audios.push(info);
    else if (ext !== '.json') assets.other.push(info);
  }
  const has2x = assets.images.filter(i => i.file.includes('@2x')).length, has3x = assets.images.filter(i => i.file.includes('@3x')).length;
  const appJson = readJSON(path.join(ROOT, 'app.json'))?.expo;
  const allContent = getAllSourceContent();
  const possiblyUnusedAssets = [];
  for (const img of [...assets.images, ...assets.svgs]) { const bn = path.basename(img.file), nameNoExt = path.basename(img.file, path.extname(img.file)).replace(/@[23]x/, ''); if (!allContent.includes(bn) && !allContent.includes(nameNoExt)) possiblyUnusedAssets.push(img.file); }
  const webpCount = assets.images.filter(i => i.ext === '.webp').length, pngCount = assets.images.filter(i => i.ext === '.png').length, jpgCount = assets.images.filter(i => ['.jpg','.jpeg'].includes(i.ext)).length;
  return {
    summary: { totalAssets: allAssetFiles.length, totalSize: formatBytes(totalSize), totalSizeBytes: totalSize, images: assets.images.length, svgs: assets.svgs.length, fonts: assets.fonts.length, videos: assets.videos.length, audios: assets.audios.length },
    imageFormats: { png: pngCount, jpg: jpgCount, webp: webpCount, gif: assets.images.filter(i => i.ext === '.gif').length },
    retina: { baseImages: assets.images.filter(i => !i.file.includes('@2x') && !i.file.includes('@3x')).length, '@2x': has2x, '@3x': has3x },
    largeAssets: largeAssets.sort((a, b) => b.size - a.size).slice(0, 15), possiblyUnusedAssets: possiblyUnusedAssets.slice(0, 20),
    appAssets: { icon: appJson?.icon ?? null, splash: appJson?.splash?.image ?? null, adaptiveIcon: appJson?.android?.adaptiveIcon ?? null, favicon: appJson?.web?.favicon ?? null },
    fonts: assets.fonts.map(f => f.file),
    recommendations: (() => { const r = []; if (pngCount > 10 && webpCount === 0) r.push('Consider converting PNGs to WebP for smaller bundle size'); if (largeAssets.length > 0) r.push(`${largeAssets.length} assets over 500KB — consider compressing`); if (has2x === 0 && has3x === 0 && assets.images.length > 5) r.push('No @2x/@3x image variants detected'); if (possiblyUnusedAssets.length > 5) r.push(`${possiblyUnusedAssets.length} possibly unused assets`); if (assets.fonts.length > 5) r.push('Many custom fonts loaded — consider reducing'); return r; })(),
  };
}

// ─── 18. Internationalization ─────────────────────────────
function scanI18n() {
  console.log('🌍 Scanning internationalization...');
  const allContent = getAllSourceContent();
  const sourceData = getSourceData(getSourceFiles());
  const hasI18n = allContent.includes('i18n') || allContent.includes('intl') || allContent.includes('locale') || allContent.includes('react-intl') || allContent.includes('i18next') || allContent.includes('lingui');
  const library = (() => { if (allContent.includes('i18next') || allContent.includes('react-i18next')) return 'i18next'; if (allContent.includes('react-intl') || allContent.includes('FormatMessage')) return 'react-intl'; if (allContent.includes('@lingui')) return 'Lingui'; if (allContent.includes('expo-localization')) return 'expo-localization'; return null; })();
  const translationFiles = getAllFiles(ROOT, ['.json']).filter(f => { const r = rel(f).toLowerCase(); return (r.includes('locale') || r.includes('translation') || r.includes('i18n') || r.includes('/en.') || r.includes('/en/') || r.includes('lang') || r.includes('messages')) && !r.includes('node_modules'); }).map(f => rel(f));
  const detectedLanguages = new Set();
  const langPattern = /\/([a-z]{2}(?:-[A-Z]{2})?)\.(json|ts|js)$/;
  for (const f of translationFiles) { const m = f.match(langPattern); if (m) detectedLanguages.add(m[1]); }
  let hardcodedStrings = 0;
  for (const { rel: rp, content } of sourceData) { if (!rp.endsWith('.tsx') && !rp.endsWith('.jsx')) continue; hardcodedStrings += (content.match(/<Text[^>]*>\s*[A-Z][a-z]+/g) ?? []).length; }
  const hasRtl = allContent.includes('I18nManager') || allContent.includes('isRTL') || allContent.includes('forceRTL') || allContent.includes('writingDirection');
  return {
    hasI18n, library, translationFiles, detectedLanguages: [...detectedLanguages], languageCount: detectedLanguages.size,
    hardcodedStringsEstimate: hardcodedStrings, hasRtlSupport: hasRtl,
    hasLocaleDetection: allContent.includes('getLocales') || allContent.includes('Localization.locale') || allContent.includes('navigator.language'),
    hasPluralization: allContent.includes('plural') || allContent.includes('count'),
    hasDateFormatting: allContent.includes('Intl.DateTimeFormat') || allContent.includes('formatDate') || allContent.includes('toLocaleDateString'),
    hasNumberFormatting: allContent.includes('Intl.NumberFormat') || allContent.includes('formatNumber') || allContent.includes('toLocaleString'),
    hasCurrencyFormatting: allContent.includes('currency') && (allContent.includes('Intl') || allContent.includes('format')),
  };
}

// ─── 19. Documentation ──────────────────────────────────
function scanDocumentation() {
  console.log('📚 Scanning documentation...');
  const sourceData = getSourceData(getSourceFiles());
  const readme = readFile('README.md') || readFile('readme.md') || readFile('README');
  const readmeLines = readme ? readme.split('\n').length : 0;
  const readmeSections = readme ? (readme.match(/^##?\s+/gm) ?? []).length : 0;
  const hasInstallInstructions = readme.includes('install') || readme.includes('npm ') || readme.includes('yarn ');
  const hasUsageInstructions = readme.includes('usage') || readme.includes('getting started') || readme.includes('run');
  const hasBadges = readme.includes('![') || readme.includes('badge');
  const hasScreenshots = readme.includes('screenshot') || readme.includes('.png)') || readme.includes('.gif)');
  let jsdocCount = 0, inlineCommentCount = 0, blockCommentCount = 0, documentedFunctions = 0, undocumentedExports = 0;
  for (const { content } of sourceData) {
    jsdocCount += (content.match(/\/\*\*[\s\S]*?\*\//g) ?? []).length;
    inlineCommentCount += (content.match(/\/\/[^\n]+/g) ?? []).length;
    blockCommentCount += (content.match(/\/\*(?!\*)[^]*?\*\//g) ?? []).length;
    const totalExports = (content.match(/export\s+(?:default\s+)?(?:async\s+)?function\s+\w+/g) ?? []).length + (content.match(/export\s+(?:default\s+)?const\s+\w+/g) ?? []).length;
    undocumentedExports += totalExports;
    const documented = (content.match(/\/\*\*[\s\S]*?\*\/\s*\n\s*export/g) ?? []).length;
    documentedFunctions += documented; undocumentedExports -= documented;
  }
  const hasChangelog = fileExists(path.join(ROOT, 'CHANGELOG.md')), hasContributing = fileExists(path.join(ROOT, 'CONTRIBUTING.md')), hasCodeOfConduct = fileExists(path.join(ROOT, 'CODE_OF_CONDUCT.md')), hasSecurityPolicy = fileExists(path.join(ROOT, 'SECURITY.md')), hasLicense = fileExists(path.join(ROOT, 'LICENSE')) || fileExists(path.join(ROOT, 'LICENSE.md')), hasApiDocs = fileExists(path.join(ROOT, 'docs/api')) || fileExists(path.join(ROOT, 'API.md'));
  const hasStorybook = fileExists(path.join(ROOT, '.storybook')) || getAllFiles(ROOT, ['.tsx','.ts','.jsx','.js']).filter(f => f.includes('.stories.')).length > 0;
  const storyCount = getAllFiles(ROOT, ['.tsx','.ts','.jsx','.js']).filter(f => f.includes('.stories.')).length;
  return {
    readme: { exists: readme.length > 0, lines: readmeLines, sections: readmeSections, hasInstallInstructions, hasUsageInstructions, hasBadges, hasScreenshots, hasTOC: readme.includes('Table of Contents') || readme.includes('## Contents'), hasApiReference: readme.toLowerCase().includes('api reference') || readme.toLowerCase().includes('api docs') },
    comments: { jsdoc: jsdocCount, inline: inlineCommentCount, block: blockCommentCount },
    documentedExports: documentedFunctions, undocumentedExports: Math.max(0, undocumentedExports),
    documentationRatio: documentedFunctions + undocumentedExports > 0 ? `${Math.round((documentedFunctions / (documentedFunctions + undocumentedExports)) * 100)}%` : 'N/A',
    docsDirectory: fileExists(path.join(ROOT, 'docs')) || fileExists(path.join(ROOT, 'documentation')),
    files: { changelog: hasChangelog, contributing: hasContributing, codeOfConduct: hasCodeOfConduct, security: hasSecurityPolicy, license: hasLicense, apiDocs: hasApiDocs },
    storybook: { hasStorybook, storyCount },
    score: (() => { let s = 0; if (readme.length > 100) s += 15; if (readmeSections >= 3) s += 10; if (hasInstallInstructions) s += 10; if (hasUsageInstructions) s += 10; if (jsdocCount > 5) s += 10; if (hasChangelog) s += 10; if (hasLicense) s += 10; if (hasContributing) s += 5; if (hasStorybook) s += 10; if (documentedFunctions > undocumentedExports) s += 10; return Math.min(s, 100); })(),
  };
}

// ─── 20. Bundle Size Estimation ──────────────────────────
function scanBundleSize() {
  console.log('📏 Estimating bundle size...');
  const sourceFiles = getSourceFiles();
  let totalSourceBytes = 0;
  for (const f of sourceFiles) totalSourceBytes += getFileSizeBytes(f);
  const heavyPackages = ['moment','lodash','firebase','aws-sdk','@firebase/firestore','@firebase/auth','face-api.js','@tensorflow/tfjs','nsfwjs','react-native-maps','lottie-react-native','@sentry/react-native','date-fns','rxjs','core-js','graphql','apollo-client'];
  const packageSizes = [];
  for (const pkg of heavyPackages) {
    const pkgDir = path.join(ROOT, 'node_modules', pkg);
    if (fileExists(pkgDir)) { try { const files = getAllFiles(pkgDir, []); let size = 0; for (const f of files) size += getFileSizeBytes(f); if (size > 100 * 1024) packageSizes.push({ name: pkg, size, formattedSize: formatBytes(size) }); } catch {} }
  }
  const imageExts = ['.png','.jpg','.jpeg','.gif','.webp','.bmp','.svg'], fontExts = ['.ttf','.otf','.woff','.woff2'];
  let imageBytes = 0, fontBytes = 0;
  const allProjectFiles2 = getAllProjectFiles();
  for (const f of allProjectFiles2) { const ext = path.extname(f).toLowerCase(), size = getFileSizeBytes(f); if (imageExts.includes(ext)) imageBytes += size; if (fontExts.includes(ext)) fontBytes += size; }
  const pkg = readJSON(path.join(ROOT, 'package.json'));
  const allContent = getAllSourceContent();
  const treeShaking = {
    esModules: pkg?.type === 'module' || allContent.includes('import ') || allContent.includes('export '),
    sideEffects: pkg?.sideEffects !== undefined,
    barrelFiles: getSourceFiles().filter(f => path.basename(f).startsWith('index.')).length,
    namedExports: (allContent.match(/export\s+(?:const|function|class|type|interface|enum)/g) ?? []).length,
    defaultExports: (allContent.match(/export\s+default/g) ?? []).length,
    wildcardReExports: (allContent.match(/export\s+\*\s+from/g) ?? []).length,
  };
  return {
    sourceCode: { files: sourceFiles.length, totalSize: formatBytes(totalSourceBytes), bytes: totalSourceBytes },
    assets: { images: formatBytes(imageBytes), fonts: formatBytes(fontBytes), imagesBytes: imageBytes, fontsBytes: fontBytes },
    heavyDependencies: packageSizes.sort((a, b) => b.size - a.size).slice(0, 15), treeShaking,
    estimatedBundleSize: formatBytes(totalSourceBytes + imageBytes + fontBytes),
    recommendations: (() => { const r = []; if (packageSizes.some(p => p.name === 'moment')) r.push('Replace moment.js with date-fns or dayjs'); if (packageSizes.some(p => p.name === 'lodash')) r.push('Use lodash-es or individual imports'); if (treeShaking.wildcardReExports > 5) r.push('Many wildcard re-exports — may prevent tree shaking'); if (treeShaking.barrelFiles > 10) r.push('Many barrel files — may slow Metro bundler'); if (imageBytes > 5 * 1024 * 1024) r.push('Image assets exceed 5MB — consider CDN or compression'); if (fontBytes > 2 * 1024 * 1024) r.push('Font assets exceed 2MB — consider subsetting'); return r; })(),
  };
}

// ─── 21. Type Safety ─────────────────────────────────────
function scanTypeSafety() {
  console.log('📘 Scanning type safety...');
  const sourceData = getSourceData(getSourceFiles());
  let anyCount = 0, unknownCount = 0, neverCount = 0, typeAssertions = 0, nonNullAssertions = 0, genericUsage = 0, typeGuards = 0, interfaceCount = 0, typeAliasCount = 0, enumCount = 0, tsIgnores = 0, tsNoChecks = 0, tsExpectErrors = 0, strictFiles = 0, looseFiles = 0;
  const worstFiles = [];
  for (const { rel: rp, content } of sourceData) {
    if (!rp.endsWith('.ts') && !rp.endsWith('.tsx')) continue;
    const fileAnyCount = (content.match(/:\s*any\b|as\s+any\b|<any>|\bany\[\]|\bany,|\bany;|\bany\)/g) ?? []).length;
    anyCount += fileAnyCount; unknownCount += (content.match(/:\s*unknown\b/g) ?? []).length; neverCount += (content.match(/:\s*never\b/g) ?? []).length;
    typeAssertions += (content.match(/\bas\s+(?!any)\w/g) ?? []).length; nonNullAssertions += (content.match(/!\./g) ?? []).length + (content.match(/!\[/g) ?? []).length;
    genericUsage += (content.match(/<[A-Z]\w*(?:,\s*[A-Z]\w*)*>/g) ?? []).length; typeGuards += (content.match(/\)\s*:\s*\w+\s+is\s+\w+/g) ?? []).length;
    interfaceCount += (content.match(/\binterface\s+\w+/g) ?? []).length; typeAliasCount += (content.match(/\btype\s+\w+\s*=/g) ?? []).length; enumCount += (content.match(/\benum\s+\w+/g) ?? []).length;
    tsIgnores += (content.match(/@ts-ignore/g) ?? []).length; tsNoChecks += (content.match(/@ts-nocheck/g) ?? []).length; tsExpectErrors += (content.match(/@ts-expect-error/g) ?? []).length;
    if (fileAnyCount > 5) { worstFiles.push({ file: rp, anyCount: fileAnyCount }); looseFiles++; } else strictFiles++;
  }
  const tsFiles = sourceData.filter(f => f.rel.endsWith('.ts') || f.rel.endsWith('.tsx')).length;
  const jsFiles = sourceData.filter(f => f.rel.endsWith('.js') || f.rel.endsWith('.jsx')).length;
  const dtsFiles = getAllFiles(ROOT, ['.d.ts']).filter(f => !rel(f).includes('node_modules')).length;
  const allContent = getAllSourceContent();
  const runtimeValidation = { zod: allContent.includes('z.object') || allContent.includes("from 'zod'"), yup: allContent.includes('yup.object') || allContent.includes("from 'yup'"), joi: allContent.includes('Joi.object') || allContent.includes("from 'joi'"), superstruct: allContent.includes("from 'superstruct'"), typebox: allContent.includes('@sinclair/typebox'), valibot: allContent.includes("from 'valibot'"), io_ts: allContent.includes('io-ts') };
  return {
    tsFiles, jsFiles, dtsFiles, typescriptCoverage: tsFiles + jsFiles > 0 ? `${Math.round((tsFiles / (tsFiles + jsFiles)) * 100)}%` : 'N/A',
    anyUsage: anyCount, unknownUsage: unknownCount, neverUsage: neverCount, typeAssertions, nonNullAssertions, genericUsage, typeGuards,
    definitions: { interfaces: interfaceCount, typeAliases: typeAliasCount, enums: enumCount },
    suppressions: { tsIgnore: tsIgnores, tsNoCheck: tsNoChecks, tsExpectError: tsExpectErrors, total: tsIgnores + tsNoChecks + tsExpectErrors },
    worstFiles: worstFiles.sort((a, b) => b.anyCount - a.anyCount).slice(0, 10),
    runtimeValidation: Object.entries(runtimeValidation).filter(([, v]) => v).map(([k]) => k),
    score: (() => { let s = 50; if (tsFiles > jsFiles) s += 15; if (anyCount < 10) s += 15; else if (anyCount < 50) s += 5; if (tsIgnores + tsNoChecks === 0) s += 10; if (unknownCount > anyCount * 0.5) s += 5; if (runtimeValidation.zod || runtimeValidation.yup || runtimeValidation.joi) s += 10; if (anyCount > 100) s -= 20; if (tsNoChecks > 0) s -= 15; return Math.max(0, Math.min(s, 100)); })(),
  };
}

// ─── 22. Dependency Graph ────────────────────────────────
function scanDependencyGraph() {
  console.log('🔄 Scanning for circular dependencies...');
  const sourceFiles = getSourceFiles();
  const graph = new Map(), fileMap = new Map();
  for (const f of sourceFiles) { const r = rel(f); fileMap.set(r, f); fileMap.set(r.replace(/\.(ts|tsx|js|jsx)$/, ''), f); }
  for (const f of sourceFiles) {
    const r = rel(f), content = readFileAbs(f), deps = [], dir = path.dirname(f);
    const importMatches = content.matchAll(/(?:import\s+.*?from|require)\s*\(?\s*['"`]([^'"`]+)['"`]/g);
    for (const m of importMatches) {
      const imp = m[1]; if (!imp.startsWith('.')) continue;
      const resolved = path.resolve(dir, imp), relResolved = rel(resolved);
            const candidates = [relResolved, relResolved+'.ts', relResolved+'.tsx', relResolved+'.js', relResolved+'.jsx', path.join(relResolved,'index.ts'), path.join(relResolved,'index.tsx'), path.join(relResolved,'index.js'), path.join(relResolved,'index.jsx')];
      for (const c of candidates) { if (fileMap.has(c)) { deps.push(c); break; } }
    }
    graph.set(r, deps);
  }
  const circularDeps = [], visited = new Set(), inStack = new Set(), stack = [];
  function dfs(node) {
    if (inStack.has(node)) { const cycleStart = stack.indexOf(node); if (cycleStart !== -1) { const cycle = stack.slice(cycleStart).concat(node); if (cycle.length >= 2 && cycle.length <= 10) circularDeps.push(cycle); } return; }
    if (visited.has(node)) return;
    visited.add(node); inStack.add(node); stack.push(node);
    for (const dep of (graph.get(node) ?? [])) dfs(dep);
    stack.pop(); inStack.delete(node);
  }
  for (const node of graph.keys()) { if (!visited.has(node)) dfs(node); }
  const importCounts = {};
  for (const [, deps] of graph) { for (const dep of deps) importCounts[dep] = (importCounts[dep] ?? 0) + 1; }
  const mostImported = Object.entries(importCounts).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([file, count]) => ({ file, importedBy: count }));
  const importedFiles = new Set(Object.keys(importCounts));
  const filesWithImports = new Set([...graph.entries()].filter(([, deps]) => deps.length > 0).map(([f]) => f));
  const orphanFiles = sourceFiles.map(f => rel(f)).filter(f => !importedFiles.has(f) && !filesWithImports.has(f) && !f.includes('index.') && !f.includes('_layout') && !f.includes('+')).slice(0, 20);
  return {
    totalModules: graph.size, totalImports: [...graph.values()].reduce((a, b) => a + b.length, 0),
    circularDependencies: circularDeps.slice(0, 20), circularCount: circularDeps.length,
    mostImportedFiles: mostImported, orphanFiles,
    averageImportsPerFile: graph.size > 0 ? Math.round([...graph.values()].reduce((a, b) => a + b.length, 0) / graph.size * 10) / 10 : 0,
  };
}

// ─── 23. Offline Resilience ─────────────────────────────
function scanOfflineResilience() {
  console.log('📴 Scanning offline resilience...');
  const allContent = getAllSourceContent();
  const hasNetInfo = allContent.includes('@react-native-community/netinfo') || allContent.includes('NetInfo') || allContent.includes('useNetInfo');
  const hasOfflineDetection = allContent.includes('isConnected') || allContent.includes('isInternetReachable') || allContent.includes('onlineManager');
  const hasOfflineQueue = allContent.includes('offlineQueue') || allContent.includes('syncQueue') || allContent.includes('pendingActions');
  const hasOptimisticUpdates = allContent.includes('optimistic') || allContent.includes('rollback') || allContent.includes('onMutate');
  const hasCacheFirst = allContent.includes('cache-first') || allContent.includes('staleWhileRevalidate') || allContent.includes('staleTime');
  const hasPersistence = allContent.includes('persistQueryClient') || allContent.includes('AsyncStorage') || allContent.includes('MMKV');
  const hasOfflineIndicator = allContent.includes('offline') && (allContent.includes('banner') || allContent.includes('toast') || allContent.includes('indicator'));
  const hasSyncOnReconnect = allContent.includes('onReconnect') || allContent.includes('onOnline') || allContent.includes('refetchOnReconnect');
  const hasServiceWorker = allContent.includes('serviceWorker') || allContent.includes('workbox');
  const hasCaching = allContent.includes('localStorage') || allContent.includes('sessionStorage') || allContent.includes('IndexedDB') || allContent.includes('AsyncStorage');
  const hasNetworkStatusHandling = allContent.includes('offline') || allContent.includes('isConnected') || allContent.includes('isOnline') || allContent.includes('networkStatus');
  return {
    hasNetInfo, hasOfflineDetection, hasOfflineQueue, hasOptimisticUpdates, hasCacheFirst,
    hasPersistence, hasOfflineIndicator, hasSyncOnReconnect, hasServiceWorker, hasCaching, hasNetworkStatusHandling,
    score: (() => { let s = 0; if (hasNetInfo || hasOfflineDetection) s += 20; if (hasOfflineQueue) s += 20; if (hasCacheFirst) s += 15; if (hasPersistence) s += 15; if (hasOptimisticUpdates) s += 10; if (hasOfflineIndicator) s += 10; if (hasSyncOnReconnect) s += 10; return Math.min(s, 100); })(),
  };
}

// ─── 24. Code Duplication ──────────────────────────────
function scanCodeDuplication() {
  console.log('📋 Scanning for code duplication...');
  const sourceData = getSourceData(getSourceFiles());
  const similarities = [];
  function simpleHash(str) { let h = 0; for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; } return h; }
  const fps = sourceData.map(sd => {
    const imports = (sd.content.match(/from\s+['"`]([^'"`]+)['"`]/g) || []).sort().join(',');
    const exports = (sd.content.match(/export\s+(?:const|function|class)\s+(\w+)/g) || []).sort().join(',');
    return { file: sd.rel, imports, exports, lineCount: sd.lines.length, hash: simpleHash(sd.content.replace(/\s+/g, '')) };
  });
  for (let i = 0; i < fps.length; i++) {
    for (let j = i + 1; j < fps.length; j++) {
      const a = fps[i], b = fps[j];
      if (a.hash === b.hash && a.lineCount > 10) { similarities.push({ files: [a.file, b.file], type: 'identical', lines: a.lineCount }); continue; }
      if (a.imports === b.imports && a.imports.length > 20 && a.exports === b.exports && a.exports.length > 0) {
        if (Math.abs(a.lineCount - b.lineCount) / Math.max(a.lineCount, b.lineCount) < 0.3) similarities.push({ files: [a.file, b.file], type: 'similar', lines: Math.max(a.lineCount, b.lineCount) });
      }
    }
  }
  return { potentialDuplicates: similarities.slice(0, 20), identicalFiles: similarities.filter(s => s.type === 'identical').length, similarFiles: similarities.filter(s => s.type === 'similar').length, totalCandidates: similarities.length };
}

// ─── 25. Git Secrets ───────────────────────────────────
function scanGitSecrets() {
  console.log('🔐 Scanning git history for secrets...');
  const patterns = ['sk_live_', 'sk_test_', 'AKIA', 'ghp_', 'gho_', 'xoxb-', 'xoxp-', 'BEGIN RSA PRIVATE', 'BEGIN PRIVATE KEY'];
  const findings = [];
  const envInHistory = run('git log --all --diff-filter=A --name-only -- "*.env" ".env*" 2>/dev/null');
  const envFiles = envInHistory ? envInHistory.split('\n').filter(Boolean) : [];
  for (const p of patterns) {
    const r = run(`git log --all -S '${p}' --oneline -5 2>/dev/null`);
    if (r && r.length > 0) findings.push({ pattern: p, commits: r.split('\n').filter(Boolean).slice(0, 3) });
  }
  const tracked = run('git ls-files 2>/dev/null');
  const trackedSecrets = tracked ? tracked.split('\n').filter(f => f.endsWith('.env') || f.endsWith('.env.local') || f.endsWith('.env.production')) : [];
  return {
    envFilesInHistory: envFiles, secretsInHistory: findings, trackedEnvFiles: trackedSecrets,
    hasIssues: envFiles.length > 0 || findings.length > 0 || trackedSecrets.length > 0,
    severity: findings.length > 0 ? 'critical' : envFiles.length > 0 ? 'high' : trackedSecrets.length > 0 ? 'high' : 'none',
  };
}

// ─── 26. Dependency Licenses ─────────────────────────────
function scanDependencyLicenses() {
  console.log('📜 Scanning dependency licenses...');
  const pkg = readJSON(path.join(ROOT, 'package.json'));
  if (!pkg) return { licenses: [], issues: [], totalScanned: 0, licenseCounts: {}, hasGPL: false, hasUnknown: false };
  const prodDeps = Object.keys(pkg.dependencies || {});
  const GPL = ['GPL', 'AGPL', 'LGPL', 'SSPL', 'EUPL'];
  const licenses = [], issues = [];
  for (const dep of prodDeps) {
    const dp = readJSON(path.join(ROOT, 'node_modules', dep, 'package.json'));
    if (!dp) continue;
    const license = dp.license || (dp.licenses && dp.licenses[0] && dp.licenses[0].type) || 'UNKNOWN';
    licenses.push({ name: dep, license });
    if (GPL.some(g => license.toUpperCase().includes(g))) issues.push({ name: dep, license, issue: 'Copyleft license', severity: 'high' });
    else if (license === 'UNKNOWN' || license === 'UNLICENSED') issues.push({ name: dep, license, issue: 'Unknown license', severity: 'medium' });
  }
  const counts = {};
  for (const l of licenses) { const k = l.license.split(' ')[0]; counts[k] = (counts[k] || 0) + 1; }
  return { totalScanned: licenses.length, licenseCounts: counts, issues: issues.slice(0, 20), hasGPL: issues.some(i => i.severity === 'high'), hasUnknown: issues.some(i => i.severity === 'medium') };
}

// ─── 27. Deep Link Validation ────────────────────────────
function scanDeepLinkValidation() {
  console.log('🔗 Scanning deep link completeness...');
  const appJson = readJSON(path.join(ROOT, 'app.json'));
  const expo = appJson?.expo ?? {};
  const allContent = getAllSourceContent();
  const issues = [];
  const scheme = expo.scheme;
  const associatedDomains = expo.ios?.associatedDomains ?? [];
  const intentFilters = expo.android?.intentFilters ?? [];
  if (scheme && !allContent.includes(scheme)) issues.push({ issue: 'Scheme defined but no handler found', severity: 'medium' });
  const hasLinkingConfig = allContent.includes('linking') && (allContent.includes('prefixes') || allContent.includes('config'));
  const hasDeepLinkHandler = allContent.includes('useURL') || allContent.includes('Linking.addEventListener') || allContent.includes('getInitialURL');
  if (associatedDomains.length > 0 && !hasDeepLinkHandler) issues.push({ issue: 'Associated domains without handler', severity: 'high' });
  if (intentFilters.length > 0 && !hasDeepLinkHandler) issues.push({ issue: 'Intent filters without handler', severity: 'high' });
  return { scheme, associatedDomains, intentFilters, hasLinkingConfig, hasDeepLinkHandler, hasUniversalLinks: associatedDomains.length > 0, hasAppLinks: intentFilters.length > 0, issues };
}

// ─── 28. Font Loading ──────────────────────────────────
function scanFontLoading() {
  console.log('🔤 Scanning font loading...');
  const allContent = getAllSourceContent();
  const usesExpoFont = allContent.includes('expo-font') || allContent.includes('Font.loadAsync') || allContent.includes('useFonts');
  const hasUseFonts = allContent.includes('useFonts');
  const hasLoadingGate = (allContent.includes('fontsLoaded') || allContent.includes('loaded') || allContent.includes('isReady')) && (allContent.includes('SplashScreen') || allContent.includes('AppLoading'));
  const fontFiles = getAllProjectFiles().filter(f => ['.ttf', '.otf', '.woff', '.woff2'].includes(path.extname(f).toLowerCase()));
  const googleFonts = allContent.includes('@expo-google-fonts');
  const recs = [];
  if (usesExpoFont && !hasLoadingGate) recs.push('Font loaded without loading gate');
  if (fontFiles.length > 8) recs.push('Many custom fonts — consider reducing');
  return { usesExpoFont, hasLoadAsync: allContent.includes('Font.loadAsync'), hasUseFonts, hasLoadingGate, googleFonts, customFontCount: fontFiles.length, fontFiles: fontFiles.map(f => rel(f)), properlyLoaded: usesExpoFont && hasLoadingGate, recommendations: recs };
}

// ─── 29. Unused Styles ─────────────────────────────────
function scanUnusedStyles() {
  console.log('🎨 Scanning for unused styles...');
  const sourceData = getSourceData(getSourceFiles());
  const unusedStyles = [];
  let totalStyles = 0, usedStyles = 0;
  for (const sd of sourceData) {
    const sheetMatch = sd.content.match(/StyleSheet\.create\(\{([\s\S]*?)\}\s*\)/g);
    if (!sheetMatch) continue;
    for (const sheet of sheetMatch) {
      const nameMatches = sheet.match(/(\w+)\s*:\s*\{/g) || [];
      for (const nm of nameMatches) {
        const nameM = nm.match(/(\w+)\s*:/);
        const name = nameM ? nameM[1] : null;
        if (!name) continue;
        totalStyles++;
        const usedRe = new RegExp('styles\\.' + name + '\\b|\\[styles\\.' + name + '\\]');
        if (usedRe.test(sd.content)) usedStyles++;
        else unusedStyles.push({ file: sd.rel, style: name });
      }
    }
  }
  return { totalStyles, usedStyles, unusedStyles: unusedStyles.slice(0, 30), unusedCount: unusedStyles.length, wasteEstimate: totalStyles > 0 ? Math.round((unusedStyles.length / totalStyles) * 100) + '%' : '0%' };
}

// ─── 30. Firebase Completeness ──────────────────────────
function scanFirebaseCompleteness() {
  console.log('🔥 Scanning Firebase completeness...');
  const allContent = getAllSourceContent();
  if (!allContent.includes('firebase') && !allContent.includes('Firebase')) return { used: false };
  const hasGSJson = fileExists(path.join(ROOT, 'android/app/google-services.json')) || fileExists(path.join(ROOT, 'google-services.json'));
  const hasGSPlist = fileExists(path.join(ROOT, 'ios/GoogleService-Info.plist')) || fileExists(path.join(ROOT, 'GoogleService-Info.plist'));
  const hasAppCheck = allContent.includes('appCheck') || allContent.includes('initializeAppCheck');
  const hasEmulator = allContent.includes('connectFirestoreEmulator') || allContent.includes('useEmulator');
  const issues = [];
  if (!hasGSJson) issues.push('Missing google-services.json for Android');
  if (!hasGSPlist) issues.push('Missing GoogleService-Info.plist for iOS');
  if (allContent.includes('firestore') && !fileExists(path.join(ROOT, 'firestore.rules'))) issues.push('Firestore without security rules');
  if (!hasAppCheck) issues.push('No App Check configured');
  return { used: true, hasGoogleServicesJson: hasGSJson, hasGoogleServiceInfoPlist: hasGSPlist, hasFirebaseJson: fileExists(path.join(ROOT, 'firebase.json')), hasFirestoreRules: fileExists(path.join(ROOT, 'firestore.rules')), hasStorageRules: fileExists(path.join(ROOT, 'storage.rules')), hasAppCheck, hasEmulatorConfig: hasEmulator, issues };
}

// ─── 31. Push Notifications ──────────────────────────────
function scanPushNotifications() {
  console.log('🔔 Scanning push notification setup...');
  const allContent = getAllSourceContent();
  const used = allContent.includes('expo-notifications') || allContent.includes('@react-native-firebase/messaging');
  if (!used) return { used: false };
  const hasPerm = allContent.includes('requestPermissionsAsync') || allContent.includes('requestPermission');
  const hasToken = allContent.includes('getExpoPushTokenAsync') || allContent.includes('getDevicePushTokenAsync') || allContent.includes('getToken');
  const hasFG = allContent.includes('addNotificationReceivedListener') || allContent.includes('setNotificationHandler') || allContent.includes('onMessage');
  const hasBG = allContent.includes('TaskManager') || allContent.includes('setBackgroundMessageHandler');
  const hasResp = allContent.includes('addNotificationResponseReceivedListener') || allContent.includes('onNotificationOpenedApp');
  const issues = [];
  if (!hasPerm) issues.push('No permission request');
  if (!hasToken) issues.push('No token registration');
  if (!hasFG) issues.push('No foreground handler');
  if (!hasBG) issues.push('No background handler');
  if (!hasResp) issues.push('No response handler');
  return { used: true, hasPermissionRequest: hasPerm, hasTokenRegistration: hasToken, hasForegroundHandler: hasFG, hasBackgroundHandler: hasBG, hasResponseHandler: hasResp, hasChannelConfig: allContent.includes('setNotificationChannelAsync'), issues, completeness: [hasPerm, hasToken, hasFG, hasBG, hasResp].filter(Boolean).length * 20 };
}

// ─── 32. Image Optimization ──────────────────────────────
function scanImageOptimization() {
  console.log('🖼️  Scanning image optimization...');
  const allContent = getAllSourceContent();
  const usesCDN = allContent.includes('cloudinary.com') || allContent.includes('imgix.com') || allContent.includes('imagekit.io');
  const usesExpoImage = allContent.includes('expo-image');
  const usesFastImage = allContent.includes('FastImage');
  const hasCaching = allContent.includes('cachePolicy') || allContent.includes('diskCache');
  const hasPlaceholder = allContent.includes('placeholder') || allContent.includes('blurhash') || allContent.includes('thumbhash');
  const hasResponsive = allContent.includes('contentFit') || allContent.includes('resizeMode');
  const hasWebP = allContent.includes('.webp') || allContent.includes('f_auto');
  const hasLazy = allContent.includes('loading="lazy"');
  let score = 0;
  if (usesExpoImage || usesFastImage) score += 20;
  if (usesCDN) score += 15;
  if (hasCaching) score += 15;
  if (hasPlaceholder) score += 15;
  if (hasResponsive) score += 10;
  if (hasWebP) score += 15;
  return { usesCDN, usesExpoImage, usesFastImage, hasCaching, hasPlaceholder, hasResponsiveLoading: hasResponsive, hasWebPSupport: hasWebP, hasLazyLoading: hasLazy, score: Math.min(score, 100) };
}

// ─── 33. Build Config ──────────────────────────────────
function scanBuildConfig() {
  console.log('🔧 Scanning build configuration...');
  const metroConfig = readFile('metro.config.js') + readFile('metro.config.ts');
  const babelConfig = readFile('babel.config.js') + readFile('babel.config.ts');
  const easJson = readJSON(path.join(ROOT, 'eas.json'));
  return {
    metro: { exists: metroConfig.length > 0, hasTreeShaking: metroConfig.includes('experimentalImportSupport') || metroConfig.includes('unstable_enablePackageExports'), hasCustomResolver: metroConfig.includes('resolver'), hasCustomTransformer: metroConfig.includes('transformer') },
    babel: { exists: babelConfig.length > 0, hasReanimated: babelConfig.includes('react-native-reanimated'), hasNativeWind: babelConfig.includes('nativewind'), hasModuleResolver: babelConfig.includes('module-resolver'), hasConsoleRemoval: babelConfig.includes('transform-remove-console') || babelConfig.includes('strip-console'), plugins: (babelConfig.match(/['"]([^'"]*plugin[^'"]*)['"]*/g) || []).map(p => p.replace(/['"]/g, '')) },
    eas: { profiles: easJson ? Object.keys(easJson.build || {}) : [], hasProductionProfile: !!(easJson?.build?.production), hasSubmitConfig: !!(easJson?.submit) },
  };
}

// ─── 34. AsyncStorage Misuse ─────────────────────────────
function scanAsyncStorageMisuse() {
  console.log('💾 Scanning AsyncStorage usage...');
  const sourceData = getSourceData(getSourceFiles());
  const issues = [];
  let largeObjectStores = 0, sensitiveDataInAsync = 0;
  for (const sd of sourceData) {
    if (!sd.content.includes('AsyncStorage') && !sd.content.includes('setItem')) continue;
    const sensitiveKeys = sd.content.match(/(?:setItem|getItem)\s*\(\s*['"`]([^'"`]+)['"`]/g) || [];
    for (const m of sensitiveKeys) {
      const keyM = m.match(/['"`]([^'"`]+)['"`]/);
      const key = keyM ? keyM[1] : '';
      if (/token|password|secret|auth|session|private|credential/i.test(key)) {
        sensitiveDataInAsync++;
        issues.push({ file: sd.rel, issue: 'Sensitive key in AsyncStorage: ' + key + ' — use SecureStore', severity: 'high' });
      }
    }
    const stores = sd.content.match(/setItem\s*\([^,]+,\s*JSON\.stringify\s*\(\s*(\w+)/g) || [];
    for (const m of stores) {
      const vM = m.match(/stringify\s*\(\s*(\w+)/);
      const v = vM ? vM[1] : '';
      if (v && (v.includes('list') || v.includes('all') || v.includes('data') || v.includes('cache'))) {
        largeObjectStores++;
        issues.push({ file: sd.rel, issue: 'Large object in AsyncStorage: ' + v, severity: 'medium' });
      }
    }
  }
  return { issues: issues.slice(0, 20), largeObjectStores, sensitiveDataInAsync, hasSensitiveDataIssue: sensitiveDataInAsync > 0 };
}

// ─── 35. Error Recovery UI ───────────────────────────────
function scanErrorRecoveryUI() {
  console.log('🔄 Scanning error recovery UI...');
  const allContent = getAllSourceContent();
  const hasRetryButton = allContent.includes('retry') || allContent.includes('Retry') || allContent.includes('tryAgain');
  const hasFallbackUI = allContent.includes('fallback') || allContent.includes('Fallback');
  const hasSkeletonLoader = allContent.includes('skeleton') || allContent.includes('Skeleton') || allContent.includes('ShimmerPlaceholder');
  const hasEmptyState = allContent.includes('emptyState') || allContent.includes('EmptyState') || allContent.includes('No Data');
  const hasLoadingState = allContent.includes('isLoading') || allContent.includes('ActivityIndicator');
  const hasErrorState = allContent.includes('isError') || allContent.includes('error &&');
  const hasPullToRefresh = allContent.includes('onRefresh') || allContent.includes('RefreshControl');
  const hasErrorBoundary = allContent.includes('ErrorBoundary') || allContent.includes('componentDidCatch');
  let score = 0;
  if (hasRetryButton) score += 15; if (hasFallbackUI || hasErrorBoundary) score += 15; if (hasSkeletonLoader) score += 10;
  if (hasEmptyState) score += 15; if (hasLoadingState) score += 10; if (hasErrorState) score += 15; if (hasPullToRefresh) score += 10;
  return { hasRetryButton, hasFallbackUI, hasSkeletonLoader, hasEmptyState, hasLoadingState, hasErrorState, hasPullToRefresh, hasErrorBoundary, score: Math.min(score, 100) };
}

// ─── 36. Console Usage ─────────────────────────────────
function scanConsoleUsage() {
  console.log('🖥️  Scanning console usage...');
  const sourceData = getSourceData(getSourceFiles());
  let totalConsole = 0, guardedConsole = 0, ungardedConsole = 0;
  const ungardedFiles = [];
  for (const sd of sourceData) {
    if (sd.rel.includes('.test.') || sd.rel.includes('.spec.') || sd.rel.includes('__tests__')) continue;
    let fileUnguarded = 0;
    for (let i = 0; i < sd.lines.length; i++) {
      const t = sd.lines[i].trim();
      if (t.startsWith('//') || t.startsWith('*')) continue;
      if (!t.match(/\bconsole\.(log|warn|info|debug|trace)\s*\(/)) continue;
      totalConsole++;
      const ctx = sd.lines.slice(Math.max(0, i - 5), i).join('\n');
      if (ctx.includes('__DEV__') || ctx.includes('isDev')) guardedConsole++;
      else { ungardedConsole++; fileUnguarded++; }
    }
    if (fileUnguarded > 0) ungardedFiles.push({ file: sd.rel, count: fileUnguarded });
  }
  const babelConfig = readFile('babel.config.js') + readFile('babel.config.ts');
  const hasConsoleStripping = babelConfig.includes('transform-remove-console') || babelConfig.includes('strip-console');
  const recommendation = hasConsoleStripping ? 'Console stripping configured' : ungardedConsole > 10 ? 'Add babel-plugin-transform-remove-console' : ungardedConsole > 0 ? (ungardedConsole + ' unguarded console statements') : 'Clean';
  return { totalConsole, guardedConsole, ungardedConsole, hasConsoleStripping, ungardedFiles: ungardedFiles.sort((a, b) => b.count - a.count).slice(0, 15), safe: hasConsoleStripping || ungardedConsole === 0, recommendation };
}

// ─── Main Runner ──────────────────────────────────────────
async function runFullScan() {
  console.log('\n🔍 ULTIMATE Project Scanner v5.1');
  console.log('═══════════════════════════════════════════\n');
  const startTime = Date.now();

  console.log('🔬 Pre-analyzing source files...');
  const sourceFiles = getSourceFiles();
  getSourceData(sourceFiles);
  const { imports: actualImports, importLines } = extractActualImports(sourceFiles);

  const audit = {
    _meta: { scannerVersion: '5.1.0', timestamp: new Date().toISOString(), scannedAt: ROOT, nodeVersion: process.version, platform: process.platform, arch: process.arch },
    scanDuration: null,
    project: scanProjectIdentity(),
    techStack: scanTechStack(actualImports, importLines),
    packages: scanPackages(actualImports),
    environmentVariables: scanEnvironmentVariables(),
    security: scanSecurity(sourceFiles),
    fileStructure: scanFileStructure(sourceFiles),
    git: scanGit(),
    codeQuality: scanCodeQuality(sourceFiles),
    apiEndpoints: scanAPIEndpoints(),
    dependencyHealth: scanDependencyHealth(),
    offlineSupport: skipIfError(() => scanOfflineResilience()),
    routes: scanRoutes(),
    components: scanComponents(),
    errorHandling: scanErrorHandling(),
    networkCalls: scanNetworkCalls(),
    accessibility: scanAccessibility(),
    performance: scanPerformance(),
    assets: scanAssets(),
    i18n: scanI18n(),
    documentation: scanDocumentation(),
    bundleSize: scanBundleSize(),
    typeSafety: scanTypeSafety(),
    dependencyGraph: scanDependencyGraph(),
    codeDuplication: skipIfError(() => scanCodeDuplication()),
    gitSecrets: skipIfError(() => scanGitSecrets()),
    dependencyLicenses: skipIfError(() => scanDependencyLicenses()),
    deepLinkValidation: skipIfError(() => scanDeepLinkValidation()),
    fontLoading: skipIfError(() => scanFontLoading()),
    unusedStyles: skipIfError(() => scanUnusedStyles()),
    firebaseCompleteness: skipIfError(() => scanFirebaseCompleteness()),
    pushNotifications: skipIfError(() => scanPushNotifications()),
    imageOptimization: skipIfError(() => scanImageOptimization()),
    buildConfig: skipIfError(() => scanBuildConfig()),
    asyncStorageMisuse: skipIfError(() => scanAsyncStorageMisuse()),
    errorRecoveryUI: skipIfError(() => scanErrorRecoveryUI()),
    consoleUsage: skipIfError(() => scanConsoleUsage()),
  };

  audit.healthScore = calculateHealthScore(audit);
  audit.scanDuration = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(audit, null, 2));
  fs.writeFileSync(OUTPUT_TEXT, generateReport(audit));

  console.log('\n✅ Full scan complete!');
  console.log(`📄 JSON:   ${OUTPUT_JSON}`);
  console.log(`📋 Report: ${OUTPUT_TEXT}`);
  console.log(`⏱️  Time:   ${audit.scanDuration}`);
  console.log(`📊 Health: ${audit.healthScore.overall}/100`);
  printSummary(audit);
}

// ─── Health Score ─────────────────────────────────────────
function calculateHealthScore(a) {
  const scores = {
    security: (() => { let s = 100; s -= (a.security?.bySeverity?.critical ?? 0) * 25; s -= (a.security?.bySeverity?.high ?? 0) * 10; s -= (a.security?.bySeverity?.medium ?? 0) * 3; return Math.max(0, s); })(),
    codeQuality: (() => { let s = 70; if (a.codeQuality?.hasLinter) s += 10; if (a.codeQuality?.hasFormatter) s += 10; if (a.codeQuality?.hasHusky) s += 5; if ((a.codeQuality?.issues?.anyTypes ?? 0) < 10) s += 5; else if ((a.codeQuality?.issues?.anyTypes ?? 0) > 50) s -= 15; if ((a.codeQuality?.issues?.consoleLogs ?? 0) > 20) s -= 10; return Math.max(0, Math.min(s, 100)); })(),
    testing: (() => { const testRatio = (a.codeQuality?.files?.total ?? 1) > 0 ? (a.codeQuality?.files?.test ?? 0) / (a.codeQuality?.files?.total ?? 1) : 0; return Math.min(100, Math.round(testRatio * 500)); })(),
    documentation: a.documentation?.score ?? 0,
    accessibility: a.accessibility?.score ?? 0,
    performance: a.performance?.score ?? 0,
    typeSafety: a.typeSafety?.score ?? 0,
    errorHandling: a.errorHandling?.score ?? 0,
    dependencies: (() => { let s = 80; if (a.dependencyHealth?.lockfile?.hasAny) s += 10; if (a.dependencyHealth?.lockfile?.multipleLockfiles) s -= 15; if ((a.packages?.possiblyUnused?.length ?? 0) > 5) s -= 10; if (a.dependencyHealth?.autoUpdate?.hasAny) s += 10; if ((a.dependencyHealth?.majorUpdatesAvailable ?? 0) > 5) s -= 10; return Math.max(0, Math.min(s, 100)); })(),
    architecture: (() => { let s = 60; if ((a.dependencyGraph?.circularCount ?? 0) === 0) s += 20; else if ((a.dependencyGraph?.circularCount ?? 0) < 5) s += 10; else s -= 10; if (a.routes?.hasNotFound) s += 5; if ((a.components?.errorBoundaries ?? 0) > 0) s += 10; if ((a.components?.customHooks?.length ?? 0) > 3) s += 5; return Math.max(0, Math.min(s, 100)); })(),
  };
  const weights = { security: 0.20, codeQuality: 0.15, testing: 0.10, documentation: 0.05, accessibility: 0.10, performance: 0.10, typeSafety: 0.10, errorHandling: 0.10, dependencies: 0.05, architecture: 0.05 };
  const overall = Math.round(Object.entries(scores).reduce((sum, [key, val]) => sum + val * (weights[key] ?? 0.1), 0));
  return { overall, breakdown: scores };
}

// ─── Report Generator ─────────────────────────────────────
function generateReport(a) {
  const L = [];
  const l = (s = '') => L.push(s);
  const H = (s) => { l(); l('═'.repeat(70)); l(`  ${s}`); l('═'.repeat(70)); };
  const S = (s) => { l(); l(`  ── ${s}`); l('  ' + '─'.repeat(Math.min(s.length + 4, 65))); };
  const row = (label, value) => l(`  ${String(label).padEnd(35)} ${value ?? 'N/A'}`);
  const tick = (bool, label) => l(`  ${bool ? '✅' : '❌'} ${label}`);
  const scoreBar = (score, label) => { const filled = Math.round((score ?? 0) / 5); const bar = '█'.repeat(filled) + '░'.repeat(20 - filled); l(`  ${label.padEnd(20)} [${bar}] ${score ?? 0}/100`); };

  l('╔══════════════════════════════════════════════════════════════════════╗');
  l('║              ULTIMATE PROJECT AUDIT REPORT v5.1                    ║');
  l('╚══════════════════════════════════════════════════════════════════════╝');
  l(`  Generated: ${a._meta.timestamp}`);
  l(`  Duration:  ${a.scanDuration}`);
  l(`  Platform:  ${a._meta.platform} (${a._meta.arch})`);
  l(`  Node:      ${a._meta.nodeVersion}`);

  H('OVERALL HEALTH SCORE');
  l();
  scoreBar(a.healthScore.overall, '🏥 OVERALL');
  l();
  for (const [key, val] of Object.entries(a.healthScore.breakdown)) {
    const emoji = { security:'🔒', codeQuality:'✨', testing:'🧪', documentation:'📚', accessibility:'♿', performance:'⚡', typeSafety:'📘', errorHandling:'🚨', dependencies:'📦', architecture:'🏗️' }[key] ?? '📊';
    scoreBar(val, `${emoji} ${key}`);
  }

  H('1. PROJECT IDENTITY');
  row('Name:', a.project.name); row('Version:', a.project.version); row('License:', a.project.license);
  row('Package Manager:', a.project.packageManager); row('Monorepo:', a.project.isMonorepo ? 'Yes' : 'No');
  row('Module Type:', a.project.type); row('Node.js:', a.project.runtime.node);
  if (a.project.expo) {
    S('Expo');
    row('SDK Version:', a.project.expo.sdkVersion); row('Bundle ID (iOS):', a.project.expo.ios.bundleIdentifier);
    row('Package (Android):', a.project.expo.android.package); row('Scheme:', a.project.expo.scheme);
    row('New Architecture:', a.project.expo.newArchEnabled ? 'ENABLED ✅' : 'Disabled');
    row('OTA Updates:', a.project.expo.updates?.url ?? 'Not configured');
    row('Runtime Version:', a.project.expo.runtimeVersion ?? 'Not set');
    row('Owner:', a.project.expo.owner ?? 'Not set');
    if (a.project.expo.plugins?.length) { S('Expo Plugins'); for (const p of a.project.expo.plugins) l(`  • ${p.name}${p.config ? ' (configured)' : ''}`); }
    if (a.project.eas) { S('EAS Build Profiles'); for (const p of a.project.eas.build) l(`  • ${p.name} (${p.distribution ?? 'default'})${p.channel ? ` → channel: ${p.channel}` : ''}`); }
  }

  H('2. TECH STACK');
  const ts = a.techStack;
  S('Mobile Framework');
  row('Framework:', `${ts.mobileFramework.name} v${ts.mobileFramework.version}`);
  row('React:', ts.mobileFramework.reactVersion); row('React Native:', ts.mobileFramework.reactNativeVersion);
  row('Workflow:', ts.mobileFramework.workflow); row('Hermes:', ts.mobileFramework.hermes ? 'Yes ✅' : 'No');

  S('Language / TypeScript');
  row('TypeScript:', ts.language.typescript ? `v${ts.language.typescriptVersion}` : 'No');
  row('Strict Mode:', ts.language.strictMode ? 'YES ✅' : 'No ⚠️');
  row('No Implicit Any:', ts.language.noImplicitAny ? 'Yes' : 'No');
  row('Strict Null Checks:', ts.language.strictNullChecks ? 'Yes' : 'No');
  row('Module Resolution:', ts.language.moduleResolution);
  row('Path Aliases:', ts.language.paths.length > 0 ? ts.language.paths.join(', ') : 'None');

  S('Navigation');
  tick(ts.navigation.expoRouter, `Expo Router v${ts.navigation.expoRouterVersion ?? '?'}`);
  tick(ts.navigation.reactNavigation, `React Navigation v${ts.navigation.reactNavigationVersion ?? '?'}`);
  tick(ts.navigation.reactNavigationStack, 'Stack Navigator');
  tick(ts.navigation.reactNavigationTabs, 'Tab Navigator');
  tick(ts.navigation.reactNavigationDrawer, 'Drawer Navigator');

  S('Backend Services');
  if (ts.backend.firebase.used) {
    l(`  ✅ Firebase v${ts.backend.firebase.version}`);
    const svcs = Object.entries(ts.backend.firebase.services).filter(([, v]) => v).map(([k]) => k);
    l(`     Services: ${svcs.join(', ')}`);
    tick(ts.backend.firebase.securityRules.firestore, '  Firestore Rules');
    tick(ts.backend.firebase.securityRules.storage, '  Storage Rules');
    tick(ts.backend.firebase.indexes, '  Firestore Indexes');
  }
  tick(ts.backend.supabase.used, `Supabase v${ts.backend.supabase.version ?? '?'}`);
  tick(ts.backend.mongodb.used, `MongoDB v${ts.backend.mongodb.version ?? '?'}`);
  tick(ts.backend.prisma.used, `Prisma v${ts.backend.prisma.version ?? '?'}`);
  tick(ts.backend.graphql.used, `GraphQL v${ts.backend.graphql.version ?? '?'}`);
  tick(ts.backend.trpc.used, `tRPC v${ts.backend.trpc.version ?? '?'}`);

  S('Server');
  row('Framework:', ts.server.framework); row('Language:', ts.server.language);
  row('Hosting:', ts.server.hosting); row('Endpoints:', ts.server.endpoints);
  l('  Security Middleware:');
  tick(ts.server.security.helmet, '  Helmet'); tick(ts.server.security.cors, '  CORS');
  tick(ts.server.security.rateLimit, '  Rate Limiting'); tick(ts.server.security.hmac, '  HMAC Signing');
  tick(ts.server.security.requireAuth, '  Auth Middleware'); tick(ts.server.security.inputValidation, '  Input Validation');
  tick(ts.server.security.csrf, '  CSRF Protection');

  S('Authentication');
  tick(ts.authentication.firebaseAuth, 'Firebase Auth'); tick(ts.authentication.googleSignIn, 'Google Sign-In');
  tick(ts.authentication.appleSignIn, 'Apple Sign-In'); tick(ts.authentication.biometric, 'Biometric / Face ID');
  tick(ts.authentication.e2ee, `E2EE (${ts.authentication.e2eeMethod})`);
  tick(ts.authentication.mfa, 'Multi-Factor Auth'); tick(ts.authentication.jwt, 'JWT');

  S('Payments');
  tick(ts.payments.stripe.used, `Stripe v${ts.payments.stripe.version ?? '?'}`);
  tick(ts.payments.revenueCat.used, `RevenueCat v${ts.payments.revenueCat.version ?? '?'}`);
  tick(ts.payments.inAppPurchases, 'In-App Purchases');

  S('AI / ML');
  tick(ts.aiMl.faceApi.used, `face-api.js v${ts.aiMl.faceApi.version ?? '?'}`);
  tick(ts.aiMl.tensorflow.used, `TensorFlow.js v${ts.aiMl.tensorflow.version ?? '?'}`);
  tick(ts.aiMl.openai.used, `OpenAI v${ts.aiMl.openai.version ?? '?'}`);
  tick(ts.aiMl.cloudinaryAI, 'Cloudinary AI');
  if (ts.aiMl.externalEndpoints.length) for (const ep of ts.aiMl.externalEndpoints) l(`  🌐 ${ep}`);

  S('Media');
  if (ts.media.cloudinary.used) { l('  ✅ Cloudinary'); l(`     Used for: ${ts.media.cloudinary.usedFor.join(', ') || 'N/A'}`); }
  tick(ts.media.expoImage, 'expo-image'); tick(ts.media.expo.imagePicker, 'Image Picker');
  tick(ts.media.expo.camera, 'Camera'); tick(ts.media.expo.video, 'Video');

  S('Security Libraries');
  tick(ts.securityLibraries.tweetnacl, `TweetNaCl v${ts.securityLibraries.tweetnaclVersion ?? '?'}`);
  tick(ts.securityLibraries.expoSecureStore, 'Expo SecureStore'); tick(ts.securityLibraries.expoCrypto, 'Expo Crypto');
  tick(ts.securityLibraries.webCrypto, 'Web Crypto API'); tick(ts.securityLibraries.hmacSigning, 'HMAC signing');
  tick(ts.securityLibraries.certificatePinning, 'Certificate Pinning');

  S('State Management');
  tick(ts.stateManagement.redux, 'Redux Toolkit'); tick(ts.stateManagement.zustand, 'Zustand');
  tick(ts.stateManagement.jotai, 'Jotai'); tick(ts.stateManagement.mmkv, 'MMKV');
  tick(ts.stateManagement.secureStore, 'SecureStore'); tick(ts.stateManagement.asyncStorage, 'AsyncStorage');
  row('createContext() usages:', ts.stateManagement.contextCount);

  S('UI & Animation');
  tick(ts.ui.reanimated.used, `Reanimated v${ts.ui.reanimated.version ?? '?'}`);
  tick(ts.ui.gesture.used, `Gesture Handler v${ts.ui.gesture.version ?? '?'}`);
  tick(ts.ui.nativeWind, `NativeWind v${ts.ui.nativeWindVersion ?? '?'}`);
  tick(ts.ui.bottomSheet, 'Bottom Sheet'); tick(ts.ui.haptics, 'Haptics');

  S('Notifications');
  tick(ts.notifications.expo, `Expo Notifications v${ts.notifications.version ?? '?'}`);
  tick(ts.notifications.firebase, 'Firebase Cloud Messaging');

  S('Analytics & Monitoring');
  tick(ts.analyticsMonitoring.sentry.used, `Sentry v${ts.analyticsMonitoring.sentry.version ?? '?'}`);
  tick(ts.analyticsMonitoring.amplitude.used, 'Amplitude');
  tick(ts.analyticsMonitoring.firebaseAnalytics, 'Firebase Analytics');
  tick(ts.analyticsMonitoring.crashlytics.used, 'Crashlytics');

  S('Testing');
  tick(ts.testing.jest, `Jest v${ts.testing.jestVersion ?? '?'}`); tick(ts.testing.testingLibrary, 'Testing Library');
  tick(ts.testing.detox, 'Detox E2E'); tick(ts.testing.maestro, 'Maestro'); tick(ts.testing.msw, 'MSW');
  row('Test files:', ts.testing.testFiles);

  S('Build & Deployment');
  tick(ts.buildDeployment.eas, 'EAS Build'); tick(ts.buildDeployment.cicd.githubActions, 'GitHub Actions');
  tick(ts.buildDeployment.docker.dockerfile, 'Docker'); tick(ts.buildDeployment.otaUpdates, 'OTA Updates');
  if (ts.buildDeployment.cicd.githubActionsFiles.length) { l('  Workflow files:'); for (const f of ts.buildDeployment.cicd.githubActionsFiles) l(`    • ${f}`); }

  S('Permissions');
  for (const [perm, used] of Object.entries(ts.permissions)) if (used) l(`  ✅ ${perm}`);

  H('3. EXTERNAL APIs');
  l(`  ${ts.externalAPIs.length} external API endpoints detected:\n`);
  const byCategory = {};
  for (const api of ts.externalAPIs) { if (!byCategory[api.category]) byCategory[api.category] = []; byCategory[api.category].push(api); }
  for (const [cat, apis] of Object.entries(byCategory)) { l(`  [${cat}]`); for (const api of apis) { l(`    ✅ ${api.name} (${api.url})`); if (api.usedIn.length) l(`       Used in: ${api.usedIn.join(', ')}`); } l(''); }

  H('4. PACKAGES');
  row('Total:', a.packages.counts?.total); row('Production:', a.packages.counts?.production);
  row('Development:', a.packages.counts?.development); row('Actually imported:', a.packages.counts?.actuallyImported);
  row('Not installed:', a.packages.counts?.notInstalled); row('Categories:', a.packages.counts?.categories);
  if (a.packages.possiblyUnused?.length) { S('⚠️  Possibly Unused'); for (const p of a.packages.possiblyUnused) l(`  • ${p}`); }
  if (a.packages.undeclaredImports?.length) { S('⚠️  Imported but not in package.json'); for (const p of a.packages.undeclaredImports) l(`  • ${p}`); }
  if (a.packages.notInstalled?.length) { S('❌ Not Installed'); for (const p of a.packages.notInstalled) l(`  • ${p}`); }
  if (a.packages.potentialDuplicates?.length) { S('⚠️  Potential Duplicates'); for (const d of a.packages.potentialDuplicates) l(`  ${d.category}: ${d.packages.join(', ')}`); }
  S('All Packages by Category');
  for (const [cat, pkgs] of Object.entries(a.packages.byCategory ?? {})) { l(`\n  ${cat} (${pkgs.length})`); for (const pkg of pkgs) l(`    ${pkg.actuallyImported ? '✅' : '⚪'} ${pkg.name.padEnd(45)} ${pkg.installedVersion ?? pkg.specifiedVersion}`); }
  S('NPM Scripts');
  for (const [name, cmd] of Object.entries(a.packages.scripts ?? {})) l(`  ${name.padEnd(25)} ${cmd}`);

  H('5. ENVIRONMENT VARIABLES');
  row('Total vars:', a.environmentVariables.summary.totalVars); row('Unique vars:', a.environmentVariables.summary.uniqueVars);
  row('Empty:', a.environmentVariables.summary.emptyVars); row('Secrets:', a.environmentVariables.summary.secretVars);
  row('EXPO_PUBLIC_ vars:', a.environmentVariables.summary.expoPublicVars);
  tick(a.environmentVariables.envInGitignore, '.env in .gitignore'); tick(a.environmentVariables.hasExample, '.env.example exists');
  if (a.environmentVariables.emptyOrPlaceholder?.length) { S('❌ Needs Attention'); for (const v of a.environmentVariables.emptyOrPlaceholder) l(`  • ${v}`); }
  if (a.environmentVariables.missingFromEnvFiles?.length) { S('⚠️  Referenced but Missing'); for (const v of a.environmentVariables.missingFromEnvFiles) l(`  • ${v}`); }
  for (const [file, vars] of Object.entries(a.environmentVariables.files)) { S(file); for (const v of vars) l(`  ${v.hasValue && !v.isPlaceholder ? '✅' : '❌'} ${v.isSecret ? '🔑' : '  '} ${v.key.padEnd(45)} ${v.maskedValue}`); }

  H('6. SECURITY');
  row('Critical:', a.security.bySeverity.critical); row('High:', a.security.bySeverity.high);
  row('Medium:', a.security.bySeverity.medium); row('Low:', a.security.bySeverity.low); row('Info:', a.security.bySeverity.info);
  S('.gitignore Coverage');
  for (const [check, val] of Object.entries(a.security.gitignoreChecks)) tick(val, check);
  const actionable = a.security.issues.filter(i => ['critical','high','medium'].includes(i.severity));
  if (actionable.length) { S('Issues Requiring Action'); for (const issue of actionable.slice(0, 30)) { l(`\n  [${issue.severity.toUpperCase()}] ${issue.message}`); l(`  File: ${issue.file} (${issue.count}x)`); } }
  else l('\n  ✅ No critical, high, or medium issues found!');

  H('7. API ENDPOINTS');
  row('Total:', a.apiEndpoints.total); row('Without auth:', a.apiEndpoints.withoutAuth);
  row('Without rate limit:', a.apiEndpoints.withoutRateLimit); row('Without validation:', a.apiEndpoints.withoutValidation);
  if (a.apiEndpoints.endpoints.length) { S('All Endpoints'); for (const ep of a.apiEndpoints.endpoints) { const auth = ep.hasAuth ? '🔒' : ep.path === '/health' ? '🟢' : '🔓'; l(`  ${auth} [${ep.method.padEnd(6)}] ${ep.path.padEnd(35)} ${ep.file}:${ep.line}`); } }

  H('8. ROUTES & NAVIGATION');
  row('Router type:', a.routes.type); row('Total routes:', a.routes.totalRoutes);
  row('Dynamic routes:', a.routes.dynamicRoutes); row('Layouts:', a.routes.layouts.length);
  row('Groups:', a.routes.groups.join(', ') || 'None'); row('Modals:', a.routes.modals);
  tick(a.routes.hasNotFound, '404 / Not Found page'); tick(a.routes.hasTabNavigation, 'Tab navigation');
  tick(a.routes.hasStackNavigation, 'Stack navigation');
  if (a.routes.deepLinks.length) { S('Deep Links'); for (const dl of a.routes.deepLinks) l(`  • [${dl.type}] ${dl.value}`); }

  H('9. COMPONENTS & HOOKS');
  row('Total components:', a.components.totalComponents); row('Functional:', a.components.functionalComponents);
  row('Memoized:', a.components.memoizedComponents); row('Custom hooks:', a.components.hookCount);
  row('Contexts:', a.components.contextCount); row('Error boundaries:', a.components.errorBoundaries);
  row('Avg component lines:', a.components.averageComponentLines);
  if (a.components.componentsWith5PlusState.length) { S('⚠️  Components with 5+ useState'); for (const c of a.components.componentsWith5PlusState) l(`  • ${c.file} (${c.stateCount} states)`); }
  if (a.components.hooksWithoutCleanup.length) { S('⚠️  Hooks with useEffect but no cleanup'); for (const h of a.components.hooksWithoutCleanup) l(`  • ${h.file} (${h.name})`); }

  H('10. ERROR HANDLING');
  row('Try/catch blocks:', a.errorHandling.tryCatchBlocks); row('Empty catch blocks:', a.errorHandling.emptyTryCatch);
  row('Error boundaries:', a.errorHandling.errorBoundaries); row('Sentry captures:', a.errorHandling.sentryCapture);
  row('Error logging:', a.errorHandling.errorLogging);
  scoreBar(a.errorHandling.score, 'Error Handling');
  S('Global Handlers');
  for (const [k, v] of Object.entries(a.errorHandling.globalHandlers)) tick(v, k);
  if (a.errorHandling.asyncWithoutTryCatch.length) { S('⚠️  Async without try/catch'); for (const f of a.errorHandling.asyncWithoutTryCatch.slice(0, 10)) l(`  • ${f.file}`); }

  H('11. NETWORK & DATA FETCHING');
  row('Fetch calls:', a.networkCalls.fetchCalls); row('Axios calls:', a.networkCalls.axiosCalls);
  row('Data libraries:', a.networkCalls.dataFetchingLibraries.join(', ') || 'None');
  tick(a.networkCalls.hasTimeout, 'Timeout configured'); tick(a.networkCalls.hasRetry, 'Retry logic');
  tick(a.networkCalls.hasAbortController, 'AbortController'); tick(a.networkCalls.hasGraphQL, 'GraphQL');
  tick(a.networkCalls.hasWebSocket, 'WebSocket');

  H('12. ACCESSIBILITY');
  scoreBar(a.accessibility.score, 'Accessibility');
  row('Labels:', a.accessibility.labels); row('Roles:', a.accessibility.roles);
  row('Touchable without label:', a.accessibility.touchableWithoutLabel); row('Image without alt:', a.accessibility.imageWithoutAlt);
  tick(a.accessibility.hasScreenReaderSupport, 'Screen reader support'); tick(a.accessibility.hasDynamicFontSize, 'Dynamic font sizing');
  if (a.accessibility.issues.length) { S('Issues'); for (const i of a.accessibility.issues.slice(0, 15)) l(`  ⚠️  ${i.file}: ${i.issue}`); }

  H('13. PERFORMANCE');
  scoreBar(a.performance.score, 'Performance');
  row('Inline functions in JSX:', a.performance.inlineFunctionsInJSX); row('Heavy imports:', a.performance.heavyImports);
  S('Optimizations Used');
  for (const [k, v] of Object.entries(a.performance.optimizations)) { if (typeof v === 'boolean') tick(v, k); else if (typeof v === 'number' && v > 0) row(`  ${k}:`, v); }
  if (a.performance.issues.length) { S('Issues'); for (const i of a.performance.issues.slice(0, 15)) l(`  [${i.severity}] ${i.file}: ${i.issue}`); }

  H('14. ASSETS');
  row('Total assets:', a.assets.summary.totalAssets); row('Total size:', a.assets.summary.totalSize);
  row('Images:', a.assets.summary.images); row('Fonts:', a.assets.summary.fonts);
  if (a.assets.largeAssets.length) { S('Large Assets (>500KB)'); for (const a2 of a.assets.largeAssets.slice(0, 10)) l(`  ⚠️  ${a2.formattedSize.padEnd(10)} ${a2.file}`); }
  if (a.assets.recommendations.length) { S('Recommendations'); for (const r of a.assets.recommendations) l(`  💡 ${r}`); }

  H('15. INTERNATIONALIZATION');
  tick(a.i18n.hasI18n, `i18n (${a.i18n.library ?? 'none'})`);
  row('Languages:', a.i18n.detectedLanguages.join(', ') || 'None');
  tick(a.i18n.hasRtlSupport, 'RTL support'); tick(a.i18n.hasLocaleDetection, 'Locale detection');
  row('Hardcoded strings (est):', a.i18n.hardcodedStringsEstimate);

  H('16. DOCUMENTATION');
  scoreBar(a.documentation.score, 'Documentation');
  tick(a.documentation.readme.exists, `README (${a.documentation.readme.lines} lines)`);
  tick(a.documentation.readme.hasInstallInstructions, 'Install instructions');
  tick(a.documentation.files.changelog, 'CHANGELOG'); tick(a.documentation.files.license, 'LICENSE');
  tick(a.documentation.storybook.hasStorybook, `Storybook (${a.documentation.storybook.storyCount} stories)`);
  row('JSDoc comments:', a.documentation.comments.jsdoc);
  row('Documentation ratio:', a.documentation.documentationRatio);

  H('17. TYPE SAFETY');
  scoreBar(a.typeSafety.score, 'Type Safety');
  row('TS files:', a.typeSafety.tsFiles); row('JS files:', a.typeSafety.jsFiles);
  row('Coverage:', a.typeSafety.typescriptCoverage); row('"any" usage:', a.typeSafety.anyUsage);
  row('Interfaces:', a.typeSafety.definitions.interfaces); row('Type aliases:', a.typeSafety.definitions.typeAliases);
  row('@ts-ignore:', a.typeSafety.suppressions.tsIgnore); row('@ts-nocheck:', a.typeSafety.suppressions.tsNoCheck);
  row('Runtime validation:', a.typeSafety.runtimeValidation.join(', ') || 'None');
  if (a.typeSafety.worstFiles.length) { S('Files with most "any"'); for (const f of a.typeSafety.worstFiles) l(`  ⚠️  ${f.file} (${f.anyCount} any)`); }

  H('18. BUNDLE SIZE ESTIMATION');
  row('Source code:', a.bundleSize.sourceCode.totalSize); row('Image assets:', a.bundleSize.assets.images);
  row('Font assets:', a.bundleSize.assets.fonts); row('Estimated total:', a.bundleSize.estimatedBundleSize);
  row('Barrel (index) files:', a.bundleSize.treeShaking.barrelFiles);
  if (a.bundleSize.heavyDependencies.length) { S('Heavy Dependencies'); for (const d of a.bundleSize.heavyDependencies) l(`  📦 ${d.formattedSize.padEnd(12)} ${d.name}`); }
  if (a.bundleSize.recommendations.length) { S('Recommendations'); for (const r of a.bundleSize.recommendations) l(`  💡 ${r}`); }

  H('19. DEPENDENCY GRAPH');
  row('Total modules:', a.dependencyGraph.totalModules); row('Circular deps:', a.dependencyGraph.circularCount);
  row('Avg imports/file:', a.dependencyGraph.averageImportsPerFile);
  if (a.dependencyGraph.circularDependencies.length) { S('⚠️  Circular Dependencies'); for (const c of a.dependencyGraph.circularDependencies.slice(0, 10)) l(`  🔄 ${c.join(' → ')}`); }
  if (a.dependencyGraph.mostImportedFiles.length) { S('Most Imported Files'); for (const f of a.dependencyGraph.mostImportedFiles.slice(0, 10)) l(`  ${String(f.importedBy).padStart(4)}x  ${f.file}`); }
  if (a.dependencyGraph.orphanFiles.length) { S('Possibly Orphan Files'); for (const f of a.dependencyGraph.orphanFiles.slice(0, 10)) l(`  • ${f}`); }

  H('20. DEPENDENCY HEALTH');
  tick(a.dependencyHealth.lockfile.hasAny, 'Lockfile present');
  if (a.dependencyHealth.lockfile.multipleLockfiles) l('  ⚠️  Multiple lockfiles detected!');
  tick(a.dependencyHealth.autoUpdate.hasAny, 'Auto-update (Renovate/Dependabot)');
  row('Native modules:', a.dependencyHealth.nativeModuleCount);
  row('Outdated packages:', a.dependencyHealth.outdatedCount ?? 'Run npm outdated');
  if (a.dependencyHealth.vulnerabilities) {
    S('Vulnerabilities');
    row('Critical:', a.dependencyHealth.vulnerabilities.critical); row('High:', a.dependencyHealth.vulnerabilities.high);
    row('Moderate:', a.dependencyHealth.vulnerabilities.moderate); row('Low:', a.dependencyHealth.vulnerabilities.low);
  }

  H('21. FILE STRUCTURE');
  row('Total files:', a.fileStructure.totalFiles); row('Code files:', a.fileStructure.totalCodeFiles);
  row('Lines of code:', a.fileStructure.totalLinesOfCode.toLocaleString());
  row('Avg lines/file:', a.fileStructure.averageLinesPerFile); row('Files >300 lines:', a.fileStructure.longFiles);
  row('Empty files:', a.fileStructure.emptyFiles);
  S('Top-Level Directories');
  for (const d of a.fileStructure.topLevelDirs) l(`  📁 ${d}`);
  S('Largest Files');
  for (const f of a.fileStructure.largestFiles.slice(0, 15)) l(`  ${String(f.lines).padStart(6)} lines  ${f.file}`);

  H('22. CODE QUALITY');
  row('Total lines:', a.codeQuality.totalLines.toLocaleString()); row('Code lines:', a.codeQuality.codeLines.toLocaleString());
  row('Comment ratio:', a.codeQuality.commentRatio);
  tick(a.codeQuality.hasLinter, 'ESLint'); tick(a.codeQuality.hasFormatter, 'Prettier');
  tick(a.codeQuality.hasHusky, 'Husky git hooks'); tick(a.codeQuality.hasLintStaged, 'lint-staged');
  tick(a.codeQuality.hasCommitLint, 'commitlint');
  S('Issues');
  row('TODOs:', a.codeQuality.issues.todos); row('FIXMEs:', a.codeQuality.issues.fixmes);
  row('"any" types:', a.codeQuality.issues.anyTypes); row('console.log():', a.codeQuality.issues.consoleLogs);

  H('23. GIT');
  row('Branch:', a.git.currentBranch); row('Total commits:', a.git.totalCommits);
  row('Last commit:', a.git.lastCommitDate); row('Last message:', a.git.lastCommitMessage);
  row('Uncommitted:', a.git.uncommittedFiles); row('Remote:', a.git.remoteUrl);
  row('Tags:', a.git.tags.length); row('Branches:', a.git.branches.length);
  tick(a.git.hasGitHubActions, 'GitHub Actions'); tick(a.git.hasGitIgnore, '.gitignore');
  if (a.git.commitConventions.total > 0) { S('Commit Conventions'); row('Conventional commits:', `${a.git.commitConventions.conventional}/${a.git.commitConventions.total} (${a.git.commitConventions.ratio})`); }
  if (Object.keys(a.git.gitHooks).length > 0) { S('Git Hooks'); for (const [hook, cmd] of Object.entries(a.git.gitHooks)) l(`  ${hook.padEnd(20)} ${cmd}`); }
  if (a.git.recentCommits?.length) { S('Recent Commits'); for (const c of a.git.recentCommits.slice(0, 10)) l(`  ${c}`); }

  // ── NEW SECTIONS ──
  H('24. OFFLINE SUPPORT');
  skipIfError(() => {
    scoreBar(a.offlineSupport?.score ?? 0, 'Offline');
    tick(a.offlineSupport?.hasNetInfo, 'NetInfo / connectivity');
    tick(a.offlineSupport?.hasOfflineQueue, 'Offline queue');
    tick(a.offlineSupport?.hasCacheFirst, 'Cache-first strategy');
    tick(a.offlineSupport?.hasPersistence, 'Data persistence');
    tick(a.offlineSupport?.hasOptimisticUpdates, 'Optimistic updates');
    tick(a.offlineSupport?.hasOfflineIndicator, 'Offline indicator UI');
  });

  H('25. CODE DUPLICATION');
  skipIfError(() => {
    row('Identical files:', a.codeDuplication?.identicalFiles); row('Similar files:', a.codeDuplication?.similarFiles);
    if (a.codeDuplication?.potentialDuplicates?.length) { S('Duplicates'); for (const d of a.codeDuplication.potentialDuplicates.slice(0, 10)) l(`  [${d.type}] ${d.files.join(' <-> ')}`); }
  });

  H('26. GIT SECRET SCANNING');
  skipIfError(() => {
    if (a.gitSecrets?.hasIssues) {
      l('  🔴 ISSUES FOUND');
      if (a.gitSecrets.secretsInHistory?.length) for (const s of a.gitSecrets.secretsInHistory) l(`  • ${s.pattern}`);
      if (a.gitSecrets.trackedEnvFiles?.length) for (const f of a.gitSecrets.trackedEnvFiles) l(`  🔴 Tracked: ${f}`);
    } else l('  ✅ No secrets found');
  });

  H('27. DEPENDENCY LICENSES');
  skipIfError(() => {
    row('Scanned:', a.dependencyLicenses?.totalScanned);
    if (a.dependencyLicenses?.licenseCounts) { S('Distribution'); for (const [k, v] of Object.entries(a.dependencyLicenses.licenseCounts).sort((a, b) => b[1] - a[1])) l(`  ${String(v).padStart(4)}x  ${k}`); }
    if (a.dependencyLicenses?.issues?.length) { S('Issues'); for (const i of a.dependencyLicenses.issues) l(`  [${i.severity}] ${i.name}: ${i.license}`); }
  });

  H('28. DEEP LINK VALIDATION');
  skipIfError(() => {
    row('Scheme:', a.deepLinkValidation?.scheme || 'Not set');
    tick(a.deepLinkValidation?.hasLinkingConfig, 'Linking config');
    tick(a.deepLinkValidation?.hasDeepLinkHandler, 'Deep link handler');
    if (a.deepLinkValidation?.issues?.length) { S('Issues'); for (const i of a.deepLinkValidation.issues) l(`  ⚠️  ${i.issue}`); }
  });

  H('29. FONT LOADING');
  skipIfError(() => {
    tick(a.fontLoading?.usesExpoFont, 'expo-font'); tick(a.fontLoading?.hasUseFonts, 'useFonts hook');
    tick(a.fontLoading?.hasLoadingGate, 'Loading gate'); tick(a.fontLoading?.properlyLoaded, 'Properly loaded');
    row('Custom fonts:', a.fontLoading?.customFontCount);
    if (a.fontLoading?.recommendations?.length) for (const r of a.fontLoading.recommendations) l(`  💡 ${r}`);
  });

  H('30. UNUSED STYLES');
  skipIfError(() => {
    row('Total styles:', a.unusedStyles?.totalStyles); row('Unused:', a.unusedStyles?.unusedCount);
    row('Waste:', a.unusedStyles?.wasteEstimate);
    if (a.unusedStyles?.unusedStyles?.length) { S('Unused'); for (const s of a.unusedStyles.unusedStyles.slice(0, 15)) l(`  ⚪ ${s.file}: ${s.style}`); }
  });

  H('31. FIREBASE COMPLETENESS');
  skipIfError(() => {
    if (!a.firebaseCompleteness?.used) l('  Firebase not detected');
    else {
      tick(a.firebaseCompleteness.hasGoogleServicesJson, 'google-services.json');
      tick(a.firebaseCompleteness.hasGoogleServiceInfoPlist, 'GoogleService-Info.plist');
      tick(a.firebaseCompleteness.hasFirestoreRules, 'Firestore rules'); tick(a.firebaseCompleteness.hasAppCheck, 'App Check');
      if (a.firebaseCompleteness.issues?.length) { S('Issues'); for (const i of a.firebaseCompleteness.issues) l(`  ⚠️  ${i}`); }
    }
  });

  H('32. PUSH NOTIFICATIONS');
  skipIfError(() => {
    if (!a.pushNotifications?.used) l('  Not detected');
    else {
      row('Completeness:', (a.pushNotifications.completeness || 0) + '%');
      tick(a.pushNotifications.hasPermissionRequest, 'Permission request'); tick(a.pushNotifications.hasTokenRegistration, 'Token registration');
      tick(a.pushNotifications.hasForegroundHandler, 'Foreground handler'); tick(a.pushNotifications.hasBackgroundHandler, 'Background handler');
      tick(a.pushNotifications.hasResponseHandler, 'Response handler');
      if (a.pushNotifications.issues?.length) { S('Missing'); for (const i of a.pushNotifications.issues) l(`  ❌ ${i}`); }
    }
  });

  H('33. IMAGE OPTIMIZATION');
  skipIfError(() => {
    scoreBar(a.imageOptimization?.score ?? 0, 'Image Opt');
    tick(a.imageOptimization?.usesExpoImage || a.imageOptimization?.usesFastImage, 'Optimized image component');
    tick(a.imageOptimization?.usesCDN, 'CDN'); tick(a.imageOptimization?.hasCaching, 'Caching');
    tick(a.imageOptimization?.hasPlaceholder, 'Placeholder/blurhash'); tick(a.imageOptimization?.hasWebPSupport, 'WebP');
  });

  H('34. BUILD CONFIGURATION');
  skipIfError(() => {
    tick(a.buildConfig?.metro?.exists, 'metro.config'); tick(a.buildConfig?.metro?.hasTreeShaking, 'Tree shaking');
    tick(a.buildConfig?.babel?.exists, 'babel.config'); tick(a.buildConfig?.babel?.hasConsoleRemoval, 'Console removal');
    tick(a.buildConfig?.babel?.hasReanimated, 'Reanimated plugin');
    row('EAS profiles:', a.buildConfig?.eas?.profiles?.join(', ') || 'None');
  });

  H('35. ASYNC STORAGE MISUSE');
  skipIfError(() => {
    row('Sensitive data in AsyncStorage:', a.asyncStorageMisuse?.sensitiveDataInAsync);
    row('Large object stores:', a.asyncStorageMisuse?.largeObjectStores);
    if (a.asyncStorageMisuse?.issues?.length) { S('Issues'); for (const i of a.asyncStorageMisuse.issues.slice(0, 10)) l(`  [${i.severity}] ${i.file}: ${i.issue}`); }
  });

  H('36. ERROR RECOVERY UI');
  skipIfError(() => {
    scoreBar(a.errorRecoveryUI?.score ?? 0, 'Recovery UI');
    tick(a.errorRecoveryUI?.hasRetryButton, 'Retry button'); tick(a.errorRecoveryUI?.hasFallbackUI, 'Fallback UI');
    tick(a.errorRecoveryUI?.hasSkeletonLoader, 'Skeleton loader'); tick(a.errorRecoveryUI?.hasEmptyState, 'Empty state');
    tick(a.errorRecoveryUI?.hasErrorState, 'Error state'); tick(a.errorRecoveryUI?.hasPullToRefresh, 'Pull to refresh');
    tick(a.errorRecoveryUI?.hasErrorBoundary, 'Error boundary');
  });

  H('37. CONSOLE USAGE');
  skipIfError(() => {
    row('Total:', a.consoleUsage?.totalConsole); row('Guarded (__DEV__):', a.consoleUsage?.guardedConsole);
    row('Unguarded:', a.consoleUsage?.ungardedConsole);
    tick(a.consoleUsage?.hasConsoleStripping, 'Build-time stripping');
    row('Status:', a.consoleUsage?.recommendation);
    if (a.consoleUsage?.ungardedFiles?.length) { S('Unguarded files'); for (const f of a.consoleUsage.ungardedFiles.slice(0, 10)) l(`  ${String(f.count).padStart(4)}x  ${f.file}`); }
  });

  l('\n');
  l('╔══════════════════════════════════════════════════════════════════════╗');
  l('║                        END OF REPORT                               ║');
  l('╚══════════════════════════════════════════════════════════════════════╝');

  return L.join('\n');
}

// ─── Console Summary ──────────────────────────────────────
function printSummary(a) {
  const ts = a.techStack, sec = a.security.bySeverity, hs = a.healthScore;
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║          PROJECT HEALTH DASHBOARD                   ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  const scoreEmoji = hs.overall >= 80 ? '🟢' : hs.overall >= 60 ? '🟡' : hs.overall >= 40 ? '🟠' : '🔴';
  console.log(`\n${scoreEmoji} OVERALL HEALTH: ${hs.overall}/100`);
  console.log('─'.repeat(50));
  for (const [key, val] of Object.entries(hs.breakdown)) {
    const emoji = val >= 80 ? '🟢' : val >= 60 ? '🟡' : val >= 40 ? '🟠' : '🔴';
    const bar = '█'.repeat(Math.round(val / 5)) + '░'.repeat(20 - Math.round(val / 5));
    console.log(`  ${emoji} ${key.padEnd(18)} [${bar}] ${val}`);
  }
  console.log('\n📱 MOBILE');
  console.log(`   Framework:     ${ts.mobileFramework.name} v${ts.mobileFramework.version}`);
  console.log(`   React Native:  ${ts.mobileFramework.reactNativeVersion}`);
  console.log(`   Workflow:      ${ts.mobileFramework.workflow}`);
  console.log(`   Platforms:     ${a.project.expo?.platforms?.join(', ') ?? 'N/A'}`);
  console.log('\n🔥 BACKEND');
  if (ts.backend.firebase.used) { const svcs = Object.entries(ts.backend.firebase.services).filter(([, v]) => v).map(([k]) => k); console.log(`   Firebase:      v${ts.backend.firebase.version} (${svcs.join(', ')})`); }
  console.log(`   Server:        ${ts.server.framework} → ${ts.server.hosting}`);
  console.log(`   API endpoints: ${a.apiEndpoints.total} (${a.apiEndpoints.withoutAuth} without auth)`);
  console.log('\n☁️  SERVICES');
  if (ts.media.cloudinary.used) console.log(`   Cloudinary:    ${ts.media.cloudinary.usedFor.join(', ')}`);
  console.log(`   External APIs: ${ts.externalAPIs.length} detected`);
  const aiList = [ts.aiMl.faceApi.used && 'face-api.js', ts.aiMl.tensorflow.used && 'TensorFlow', ts.aiMl.openai.used && 'OpenAI', ts.aiMl.cloudinaryAI && 'Cloudinary AI'].filter(Boolean);
  console.log(`   AI/ML:         ${aiList.join(', ') || 'None'}`);
  console.log('\n🔒 SECURITY');
  console.log(`   E2EE:          ${ts.authentication.e2ee ? ts.authentication.e2eeMethod : 'No ❌'}`);
  console.log(`   Issues:        ${sec.critical > 0 ? '🔴' : '✅'} ${sec.critical} critical  ${sec.high > 0 ? '🟠' : '✅'} ${sec.high} high  ${sec.medium > 0 ? '🟡' : '✅'} ${sec.medium} medium`);
  console.log('\n📦 CODE');
  console.log(`   Packages:      ${a.packages.counts?.total ?? 0} (${a.packages.counts?.production ?? 0} prod)`);
  console.log(`   Lines:         ${a.fileStructure.totalLinesOfCode.toLocaleString()}`);
  console.log(`   TypeScript:    v${ts.language.typescriptVersion} (strict: ${ts.language.strictMode})`);
  console.log(`   Components:    ${a.components.totalComponents} (${a.components.customHooks.length} hooks)`);
  console.log(`   Test files:    ${a.codeQuality.files.test}`);
  console.log(`   Routes:        ${a.routes.totalRoutes} (${a.routes.dynamicRoutes} dynamic)`);
  console.log('\n🏗️  ARCHITECTURE');
  console.log(`   Circular deps: ${a.dependencyGraph.circularCount}`);
  console.log(`   Error bounds:  ${a.components.errorBoundaries}`);
  console.log(`   Contexts:      ${a.components.contextCount}`);
  console.log(`   Orphan files:  ${a.dependencyGraph.orphanFiles.length}`);

  const recs = [];
  if (sec.critical > 0) recs.push(`🔴 Fix ${sec.critical} CRITICAL security issues immediately`);
  if (sec.high > 0) recs.push(`🟠 Fix ${sec.high} HIGH security issues`);
  if (!ts.language.strictMode) recs.push('📘 Enable TypeScript strict mode');
  if ((a.typeSafety?.anyUsage ?? 0) > 50) recs.push(`📘 Reduce "any" usage (${a.typeSafety.anyUsage} found)`);
  if (a.codeQuality.files.test === 0) recs.push('🧪 Add tests — zero test files detected');
  if (!a.routes.hasNotFound) recs.push('🧭 Add a 404 / not-found page');
  if (a.components.errorBoundaries === 0) recs.push('🚨 Add error boundaries to catch crashes');
  if ((a.accessibility?.score ?? 0) < 50) recs.push('♿ Improve accessibility (labels, roles, hints)');
  if (a.dependencyGraph.circularCount > 0) recs.push(`🔄 Fix ${a.dependencyGraph.circularCount} circular dependencies`);
  if (!a.environmentVariables.envInGitignore) recs.push('🔑 Add .env to .gitignore');
  if (a.errorHandling.emptyTryCatch > 0) recs.push(`🚨 Fix ${a.errorHandling.emptyTryCatch} empty catch blocks`);
  if (!a.documentation.files.changelog) recs.push('📝 Add a CHANGELOG.md');
  if (a.performance.heavyImports > 0) recs.push('📏 Replace heavy imports (moment/lodash)');
  if (!a.dependencyHealth.autoUpdate.hasAny) recs.push('🔄 Add Renovate or Dependabot');

  if (recs.length) { console.log('\n💡 TOP RECOMMENDATIONS:'); for (const r of recs.slice(0, 10)) console.log(`   ${r}`); }
  console.log('\n══════════════════════════════════════════════════════\n');
}

// ─── Run ──────────────────────────────────────────────────
runFullScan().catch(console.error);
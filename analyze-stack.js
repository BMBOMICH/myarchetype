#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// ─── 1. Read package.json ──────────────────────────────────────────────────
const pkgPath = path.resolve('package.json');
if (!fs.existsSync(pkgPath)) { console.error('❌ package.json not found'); process.exit(1); }

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const declaredDeps = { ...pkg.dependencies, ...pkg.devDependencies };

// ─── 2. Scan source files for imports ──────────────────────────────────────
const SRC_DIRS = ['app', 'components', 'utils', 'server', 'functions', 'src', 'scripts', 'web-push'];
const EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const importRegex = /(?:import\s+(?:[\s\S]*?\s+from\s+|)['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*\(\s*['"]([^'"]+)['"]\s*\))/g;

const usedPackages = new Set();
const unlistedImports = new Set();
const nodeBuiltinsUsed = new Set();
const NODE_BUILTINS = new Set(['fs', 'path', 'os', 'crypto', 'http', 'https', 'url', 'querystring', 'util', 'events', 'stream', 'buffer', 'child_process', 'cluster', 'dgram', 'dns', 'net', 'readline', 'repl', 'timers', 'tty', 'v8', 'vm', 'zlib']);

function scanDir(dir) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(dirent => {
    const fullPath = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      if (!dirent.name.startsWith('.') && dirent.name !== 'node_modules' && dirent.name !== '.git') scanDir(fullPath);
    } else if (EXTS.has(path.extname(dirent.name))) {
      const content = fs.readFileSync(fullPath, 'utf8');
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        const raw = match[1] || match[2] || match[3];
        if (!raw) continue;

        // Skip relative paths & non-js
        if (raw.startsWith('.') || raw.endsWith('.json')) continue;

        // Normalize package name
        const normalized = raw.startsWith('@') ? raw.split('/').slice(0, 2).join('/') : raw.split('/')[0];

        if (NODE_BUILTINS.has(normalized)) {
          nodeBuiltinsUsed.add(normalized);
        } else if (declaredDeps[normalized] || fs.existsSync(path.join('node_modules', normalized))) {
          usedPackages.add(normalized);
        } else {
          unlistedImports.add(raw);
        }
      }
    }
  });
}
SRC_DIRS.forEach(scanDir);

// ─── 3. Categorize ─────────────────────────────────────────────────────────
const categories = {
  '📱 Expo & React Native Core': [],
  '🌐 Backend & Cloud Services': [],
  '📊 State, Data & API': [],
  '🎨 UI, Navigation & Animations': [],
  '🔐 Security & Crypto': [],
  '🛠️ Build, Bundler & Transpilation': [],
  '📝 Code Quality & Git': [],
  '🧪 Testing & Debugging': [],
  '📦 Utilities & Helpers': [],
  '🔌 Unlisted / Dynamic Imports': []
};

const classify = (dep) => {
  if (/^expo|^@expo\//.test(dep)) return categories['📱 Expo & React Native Core'];
  if (/^react-native|^@react-native\//.test(dep)) return categories['📱 Expo & React Native Core'];
  if (/^react$|^react-dom$/.test(dep)) return categories['📱 Expo & React Native Core'];
  if (/^firebase|^@firebase|^supabase|^cloudinary|^aws-amplify|^@aws-sdk/.test(dep)) return categories['🌐 Backend & Cloud Services'];
  if (/^axios|^graphql|^@tanstack|^zustand|^@redux|^@react-query|^swr|^got|^node-fetch/.test(dep)) return categories['📊 State, Data & API'];
  if (/^@react-navigation\/|^expo-router/.test(dep)) return categories['🎨 UI, Navigation & Animations'];
  if (/^lottie|^react-native-reanimated|^react-native-gesture|^react-native-screens/.test(dep)) return categories['🎨 UI, Navigation & Animations'];
  if (/^tweetnacl|^crypto-|^libsodium|^jose|^bcrypt|^argon2/.test(dep)) return categories['🔐 Security & Crypto'];
  if (/^@babel|^babel-|^metro|^webpack|^sharp|^terser|^esbuild/.test(dep)) return categories['🛠️ Build, Bundler & Transpilation'];
  if (/^eslint|^prettier|^husky|^lint-staged|^@commitlint|^commitlint/.test(dep)) return categories['📝 Code Quality & Git'];
  if (/^jest|^@testing-library|^cypress|^vitest|^ts-jest|^mock/.test(dep)) return categories['🧪 Testing & Debugging'];
  return categories['📦 Utilities & Helpers'];
};

// Fill declared deps
for (const [dep, version] of Object.entries(declaredDeps)) {
  const cat = classify(dep);
  cat.push(`${dep}@${version}`);
}

// Add unlisted
unlistedImports.forEach(pkg => categories['🔌 Unlisted / Dynamic Imports'].push(pkg));

// ─── 4. Output ─────────────────────────────────────────────────────────────
console.log('\n🔍 COMPLETE PROJECT DEPENDENCY INVENTORY');
console.log('═'.repeat(60));
console.log(`📦 Declared in package.json: ${Object.keys(declaredDeps).length}`);
console.log(`✅ Actually imported in code: ${usedPackages.size}`);
console.log(`🔌 Unlisted / Missing from package.json: ${unlistedImports.size}`);
console.log(`🟢 Node.js built-ins used: ${nodeBuiltinsUsed.size}\n`);

for (const [cat, packages] of Object.entries(categories)) {
  if (packages.length === 0) continue;
  console.log(`\n${cat} (${packages.length}):`);
  packages.sort().forEach(p => console.log(`   • ${p}`));
}

if (nodeBuiltinsUsed.size > 0) {
  console.log('\n🟢 Node.js Built-ins (implicit, not in package.json):');
  [...nodeBuiltinsUsed].sort().forEach(b => console.log(`   • ${b}`));
}

// ─── 5. Toolchain & Config Check ───────────────────────────────────────────
console.log('\n' + '═'.repeat(60));
console.log('🛠️  TOOLCHAIN & CONFIG STATUS');
const configs = [
  'tsconfig.json', 'app.json', 'babel.config.js', 'metro.config.js',
  'commitlint.config.js', 'jest.config.js', '.eslintrc.json', '.prettierrc',
  'tailwind.config.js', 'firebase.json', 'cloudinary.js'
];
configs.forEach(c => console.log(fs.existsSync(c) ? `✅ ${c}` : `⚠️  ${c} (missing)`));

try {
  const nodeVer = process.version;
  console.log(`\n🟢 Node.js: ${nodeVer}`);
  if (fs.existsSync('package-lock.json')) {
    const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
    const count = Object.keys(lock.packages || {}).length;
    console.log(`📦 Installed packages (node_modules): ~${count}`);
  }
} catch {}

console.log('\n✅ Scan complete. Run: node analyze-stack.js > stack-report.txt');
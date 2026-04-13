// full-audit.js — Runs scanner + complementary tools in sequence
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const run = (cmd, ignoreError = false) => {
  try { console.log(`\n⚙️  Running: ${cmd}`); return execSync(cmd, { stdio: 'inherit', timeout: 120000 }); }
  catch (e) { if (!ignoreError) throw e; return null; }
};

console.log('🔍 STARTING FULL PROJECT AUDIT...');
const start = Date.now();

try {
  // 1. Static Scanner (your tool)
  run('node project-scanner.js');

  // 2. Type Safety (AST-level TS checks)
  run('npx tsc --noEmit --pretty', true);

  // 3. Linting & Formatting
  run('npx eslint . --ext .js,.jsx,.ts,.tsx --max-warnings=0', true);
  run('npx prettier --check .', true);

  // 4. Dependency Health
  run('npx depcheck --json > depcheck-report.json', true);
  run('npm audit --json > audit-report.json', true);

  // 5. Bundle Size Estimation (Metro/Webpack)
  if (fs.existsSync('metro.config.js')) run('npx react-native-bundle-visualizer --dry-run', true);
  else if (fs.existsSync('webpack.config.js')) run('npx source-map-explorer build/**/*.js', true);

  console.log('\n✅ FULL AUDIT COMPLETE');
  console.log(`⏱️  Total time: ${((Date.now() - start) / 1000).toFixed(2)}s`);
  console.log('📁 Outputs: project-audit.json, audit-report.json, depcheck-report.json');
} catch (err) {
  console.error('\n❌ Audit failed:', err.message);
  process.exit(1);
}
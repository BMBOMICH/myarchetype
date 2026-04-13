// fix-moderation.js
// Run: node fix-moderation.js

'use strict';
const fs = require('fs');

const filePath = './utils/moderation.ts';
let src = fs.readFileSync(filePath, 'utf8');

// The HP interface likely has shorthand field names but runPatterns
// destructures {pattern, category, reason, severity}
// OR the arrays use {p,c,r,s} but runPatterns expects {pattern,category,reason,severity}
//
// Fix: replace the HP type definition to use p/c/r/s
// AND fix runPatterns to destructure p/c/r/s instead of pattern/category/reason/severity

// Fix runPatterns destructuring - it currently uses {pattern,category,reason,severity}
// but the arrays use {p,c,r,s}
src = src.replace(
  /for\s*\(\s*const\s*\{\s*pattern\s*,\s*category\s*,\s*reason\s*,\s*severity\s*\}\s*of\s*pats\s*\)/g,
  'for(const {p: pattern, c: category, r: reason, s: severity} of pats)'
);

// Fix scoreMessageRisk - uses x.pattern but arrays have x.p
src = src.replace(
  /x\.pattern\.test/g,
  'x.p.test'
);
// Also fix x.category references in scoreMessageRisk loop
// The loop does: s.push(x.category) but should be s.push(x.c)
// Find the specific loops and fix them
src = src.replace(
  /for\s*\(\s*const\s+x\s+of\s+LOVE\s*\)\s*if\s*\(x\.pattern\.test\(p\)\)\s*\{\s*s\.push\(x\.category\)/g,
  'for(const x of LOVE) if(x.p.test(p)){s.push(x.c)'
);
src = src.replace(
  /for\s*\(\s*const\s+x\s+of\s+SCAM\s*\)\s*if\s*\(x\.pattern\.test\(p\)\s*\|\|\s*x\.pattern\.test\(t\)\)\s*\{\s*s\.push\(x\.category\)/g,
  'for(const x of SCAM) if(x.p.test(p)||x.p.test(t)){s.push(x.c)'
);

// Simpler approach - fix all x.pattern and x.category in score loops
src = src.replace(/\bx\.pattern\b/g, 'x.p');
src = src.replace(/\bx\.category\b/g, 'x.c');

// Fix the HP type if it declares pattern/category/reason/severity
// Change it to match the actual p/c/r/s shorthand used in arrays
src = src.replace(
  /interface\s+HP\s*\{[^}]*\}/gs,
  (match) => {
    // Replace full field names with shorthand to match array usage
    return match
      .replace(/\bpattern\s*:/g, 'p:')
      .replace(/\bcategory\s*:/g, 'c:')
      .replace(/\breason\s*:/g, 'r:')
      .replace(/\bseverity\s*:/g, 's:');
  }
);

// Fix type alias if HP is a type alias instead of interface
src = src.replace(
  /type\s+HP\s*=\s*\{[^}]*\}/gs,
  (match) => {
    return match
      .replace(/\bpattern\s*:/g, 'p:')
      .replace(/\bcategory\s*:/g, 'c:')
      .replace(/\breason\s*:/g, 'r:')
      .replace(/\bseverity\s*:/g, 's:');
  }
);

fs.writeFileSync(filePath, src, 'utf8');
console.log('✅ Fixed moderation.ts — field name mismatch resolved');
console.log('Run: npx jest --no-coverage');
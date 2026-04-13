// read-audit-json.js
// Run: node read-audit-json.js
// Shows the exact JSON structure of detector-audit.json

'use strict';
const fs = require('fs');

const raw = fs.readFileSync('./detector-audit.json', 'utf8');
const d = JSON.parse(raw);

console.log('=== TOP LEVEL KEYS ===');
console.log(Object.keys(d));

console.log('\n=== FIRST KEY VALUE TYPE ===');
const firstKey = Object.keys(d)[0];
const firstVal = d[firstKey];
console.log('Key:', firstKey);
console.log('Type:', typeof firstVal);
console.log('IsArray:', Array.isArray(firstVal));

if (Array.isArray(firstVal)) {
  console.log('\n=== FIRST ITEM IN ARRAY ===');
  console.log(JSON.stringify(firstVal[0], null, 2));
} else if (typeof firstVal === 'object') {
  console.log('\n=== KEYS OF FIRST VALUE ===');
  console.log(Object.keys(firstVal));
}

console.log('\n=== FULL STRUCTURE SAMPLE (first 2000 chars) ===');
console.log(raw.slice(0, 2000));
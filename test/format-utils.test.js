const { DATA_FORMATS, VALID_DATA_FORMATS, FORMAT_CONTENT_TYPES, DEFAULT_FORMAT } = require('../src/format-utils');

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log(`✅ ${message}`); }
  else { failed++; console.error(`❌ ${message}`); }
}

console.log('\n--- Test 1: DATA_FORMATS constants ---');
assert(DATA_FORMATS.DELIMITED === 'delimited', 'DATA_FORMATS.DELIMITED is delimited');
assert(DATA_FORMATS.JSON === 'json', 'DATA_FORMATS.JSON is json');
assert(DATA_FORMATS.ESRI_JSON === 'esri-json', 'DATA_FORMATS.ESRI_JSON is esri-json');
assert(DATA_FORMATS.GEO_JSON === 'geo-json', 'DATA_FORMATS.GEO_JSON is geo-json');
assert(DATA_FORMATS.XML === 'xml', 'DATA_FORMATS.XML is xml');

console.log('\n--- Test 2: VALID_DATA_FORMATS ---');
assert(VALID_DATA_FORMATS.size === 5, 'VALID_DATA_FORMATS has 5 entries');
assert(VALID_DATA_FORMATS.has('delimited'), 'VALID_DATA_FORMATS includes delimited');
assert(VALID_DATA_FORMATS.has('json'), 'VALID_DATA_FORMATS includes json');
assert(VALID_DATA_FORMATS.has('esri-json'), 'VALID_DATA_FORMATS includes esri-json');
assert(VALID_DATA_FORMATS.has('geo-json'), 'VALID_DATA_FORMATS includes geo-json');
assert(VALID_DATA_FORMATS.has('xml'), 'VALID_DATA_FORMATS includes xml');
assert(!VALID_DATA_FORMATS.has('csv'), 'VALID_DATA_FORMATS does not include csv');

console.log('\n--- Test 3: FORMAT_CONTENT_TYPES mapping ---');
assert(FORMAT_CONTENT_TYPES['delimited'] === 'text/plain', 'delimited → text/plain');
assert(FORMAT_CONTENT_TYPES['json'] === 'application/json', 'json → application/json');
assert(FORMAT_CONTENT_TYPES['esri-json'] === 'application/json', 'esri-json → application/json');
assert(FORMAT_CONTENT_TYPES['geo-json'] === 'application/geo+json', 'geo-json → application/geo+json');
assert(FORMAT_CONTENT_TYPES['xml'] === 'application/xml', 'xml → application/xml');

console.log('\n--- Test 4: DEFAULT_FORMAT ---');
assert(DEFAULT_FORMAT === 'delimited', 'DEFAULT_FORMAT is delimited');

console.log('\n--- Test 5: Frozen objects ---');
assert(Object.isFrozen(DATA_FORMATS), 'DATA_FORMATS is frozen');
assert(Object.isFrozen(FORMAT_CONTENT_TYPES), 'FORMAT_CONTENT_TYPES is frozen');

console.log(`\n=== Test Results ===`);
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📊 Total: ${passed + failed}`);
if (failed > 0) process.exit(1);


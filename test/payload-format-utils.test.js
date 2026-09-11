const assert = require('assert');
const { DATA_FORMATS } = require('../src/format-utils');
const {
  SOCKET_PAYLOAD_FORMATS,
  SOCKET_PAYLOAD_FORMAT_IDS,
  SOCKET_PAYLOAD_FORMAT_SET,
  SOCKET_PAYLOAD_FORMAT_LABELS,
  DEFAULT_SOCKET_PAYLOAD_FORMAT,
  UDP_MAX_PAYLOAD_BYTES,
  parseDelimitedSource,
  inferScalar,
  encodeRecord,
  convertDelimitedSource,
  validatePayload,
  utf8ByteLength,
  assertUdpPayloadSize,
  assertTcpPayloadSize,
  decodeUdpDatagram,
  createTcpPayloadDecoder,
  createTcpRecordDecoder,
} = require('../src/payload-format-utils');

function throws(pattern, callback) {
  assert.throws(callback, pattern);
}

assert.deepStrictEqual(SOCKET_PAYLOAD_FORMATS, [
  'delimited', 'json', 'geo-json', 'esri-json',
]);
assert.deepStrictEqual(SOCKET_PAYLOAD_FORMAT_IDS, {
  DELIMITED: DATA_FORMATS.DELIMITED,
  JSON: DATA_FORMATS.JSON,
  GEO_JSON: DATA_FORMATS.GEO_JSON,
  ESRI_JSON: DATA_FORMATS.ESRI_JSON,
});
assert(!SOCKET_PAYLOAD_FORMATS.includes(DATA_FORMATS.XML));
assert.strictEqual(SOCKET_PAYLOAD_FORMAT_SET.size, 4);
assert.strictEqual(SOCKET_PAYLOAD_FORMAT_LABELS.delimited, 'Delimited (CSV)');
assert.strictEqual(DEFAULT_SOCKET_PAYLOAD_FORMAT, 'delimited');

const csv = 'name,note,count,active,id,empty\r\n"Ada","line 1\r\nline 2, ""quoted""",2,true,001,\r\n';
const parsed = parseDelimitedSource(csv);
assert.deepStrictEqual(parsed.fieldNames, ['name', 'note', 'count', 'active', 'id', 'empty']);
assert.deepStrictEqual(parsed.records, [{
  name: 'Ada',
  note: 'line 1\r\nline 2, "quoted"',
  count: 2,
  active: true,
  id: '001',
  empty: null,
}]);
assert.strictEqual(parsed.header, 'name,note,count,active,id,empty');
assert.strictEqual(
  parsed.rawEventRecords[0],
  '"Ada","line 1\r\nline 2, ""quoted""",2,true,001,'
);

assert.deepStrictEqual(
  parseDelimitedSource('a|b\n|false', { delimiter: '|', hasHeaderRow: false }).records,
  [{ field_1: 'a', field_2: 'b' }, { field_1: null, field_2: false }]
);
const blanksRetained = parseDelimitedSource('\n\n', { hasHeaderRow: false });
assert.deepStrictEqual(blanksRetained.records, [{ field_1: null }, { field_1: null }]);
const blanksSkipped = parseDelimitedSource('\nname,note\n\nA,"line 1\nline 2"\n\n', {
  skipEmptyRecords: true,
});
assert.deepStrictEqual(blanksSkipped.fieldNames, ['name', 'note']);
assert.deepStrictEqual(blanksSkipped.records, [{ name: 'A', note: 'line 1\nline 2' }]);
assert.strictEqual(blanksSkipped.rawEventRecords[0], 'A,"line 1\nline 2"');
assert.deepStrictEqual(
  convertDelimitedSource('\nname,value\n\nA,1\n\n', {
    format: 'json',
    skipEmptyRecords: true,
  }).payloads,
  ['{"name":"A","value":1}']
);
assert.strictEqual(inferScalar(''), null);
assert.strictEqual(inferScalar('', { emptyValue: 'string' }), '');
assert.strictEqual(inferScalar('01'), '01');
assert.strictEqual(inferScalar('2026-09-10'), '2026-09-10');
assert.strictEqual(inferScalar('1e309'), '1e309');
assert.strictEqual(inferScalar('-1.25e2'), -125);
assert.strictEqual(inferScalar('9007199254740993'), '9007199254740993');
assert.strictEqual(inferScalar('123456789012345.6'), '123456789012345.6');
assert.strictEqual(inferScalar('1.25e2'), 125);
assert.strictEqual(inferScalar('1e-400'), '1e-400');
assert.strictEqual(inferScalar('4e-324'), '4e-324');
assert.strictEqual(inferScalar('1e-307'), 1e-307);
assert.strictEqual(inferScalar('0e-400'), 0);
assert.strictEqual(inferScalar('-0'), '-0');
assert.strictEqual(
  JSON.parse(convertDelimitedSource('id\n9007199254740993\n', 'json').payloads[0]).id,
  '9007199254740993',
);
throws(/unmatched quote/, () => parseDelimitedSource('a,b\n"x,y'));
throws(/Duplicate header/, () => parseDelimitedSource('a,a\n1,2'));
throws(/not allowed/, () => parseDelimitedSource('__proto__,a\nx,y'));
throws(/is empty/, () => parseDelimitedSource('a,\n1,2'));
throws(/Inconsistent column count/, () => parseDelimitedSource('a,b\n1'));

const source = 'name,x,y\n"A, B",10.5,-20\nC,11,-21\n';
const convertedDelimited = convertDelimitedSource(source, 'delimited');
assert.deepStrictEqual(convertedDelimited.payloads, ['"A, B",10.5,-20', 'C,11,-21']);
assert.strictEqual(convertedDelimited.header, 'name,x,y');
assert.strictEqual(convertDelimitedSource(source, { format: 'json' }).payloads.length, 2);
assert.strictEqual(convertDelimitedSource('A,1\nB,2', 'delimited', {
  hasHeaderRow: false,
}).payloads.length, 2);

assert.strictEqual(
  encodeRecord({ name: 'A, "B"', empty: null }, 'delimited', {
    fieldNames: ['name', 'empty'],
  }),
  '"A, ""B""",'
);
assert.deepStrictEqual(JSON.parse(encodeRecord({ id: 1 }, 'json')), { id: 1 });
assert.deepStrictEqual(JSON.parse(encodeRecord(
  { id: '001', lon: -117, lat: 34, z: 2 },
  'geo-json',
  { xField: 'lon', yField: 'lat', zField: 'z', removeCoordinateFields: true }
)), {
  type: 'Feature',
  properties: { id: '001' },
  geometry: { type: 'Point', coordinates: [-117, 34, 2] },
});
assert.deepStrictEqual(JSON.parse(encodeRecord(
  { id: 1, x: 2, y: 3 },
  'esri-json',
  { xField: 'x', yField: 'y', wkid: 3857 }
)), {
  attributes: { id: 1, x: 2, y: 3 },
  geometry: { x: 2, y: 3, spatialReference: { wkid: 3857 } },
});
assert.strictEqual(JSON.parse(encodeRecord({ id: 1 }, 'geo-json')).geometry, null);
assert.strictEqual(JSON.parse(encodeRecord({ id: 1 }, 'esri-json')).geometry, null);
throws(/both xField and yField/, () => encodeRecord({ x: 1 }, 'geo-json', { xField: 'x' }));
throws(/finite number/, () => encodeRecord(
  { x: Infinity, y: 1 }, 'esri-json', { xField: 'x', yField: 'y' }
));
throws(/NaN or Infinity/, () => encodeRecord({ value: NaN }, 'json'));
throws(/WKID 4326/, () => encodeRecord(
  { x: 1, y: 2 }, 'geo-json', { xField: 'x', yField: 'y', wkid: 3857 }
));

assert.deepStrictEqual(validatePayload('{"a":1}', 'json').value, { a: 1 });
assert.strictEqual(validatePayload('[1,2]', 'json').kind, 'array');
throws(/object or array/, () => validatePayload('1', 'json'));
const secretSyntaxPayload = '{"token":"do-not-echo","broken":}';
let secretSyntaxError;
try {
  validatePayload(secretSyntaxPayload, 'json');
} catch (error) {
  secretSyntaxError = error;
}
assert(secretSyntaxError);
assert.match(secretSyntaxError.message, /JSON syntax error/);
assert(!secretSyntaxError.message.includes('do-not-echo'));
assert(!JSON.stringify(secretSyntaxError).includes('do-not-echo'));
assert.strictEqual(validatePayload(
  '{"type":"Feature","properties":{},"geometry":null}', 'geo-json'
).kind, 'Feature');
assert.strictEqual(validatePayload(
  '{"type":"FeatureCollection","features":[]}', 'geo-json'
).kind, 'FeatureCollection');
throws(/Feature or FeatureCollection/, () => validatePayload('{"type":"Point"}', 'geo-json'));
throws(/finite numbers/, () => validatePayload(
  '{"type":"Feature","properties":{},"geometry":{"type":"Point","coordinates":[1,"2"]}}',
  'geo-json'
));
assert.strictEqual(validatePayload('{"attributes":{"a":1}}', 'esri-json').kind, 'Feature');
assert.strictEqual(validatePayload('{"features":[{"attributes":{}}]}', 'esri-json').kind, 'FeatureSet');
throws(/attributes object/, () => validatePayload('{"attributes":null}', 'esri-json'));
assert.strictEqual(validatePayload('"a\nb",c', 'delimited').count, 1);
assert.deepStrictEqual(validatePayload('', 'delimited').value, { field_1: null });
throws(/exactly one logical record/, () => validatePayload('a,b\nc,d', 'delimited'));

assert.strictEqual(utf8ByteLength('😀'), 4);
assert.strictEqual(assertUdpPayloadSize('a'.repeat(UDP_MAX_PAYLOAD_BYTES)), UDP_MAX_PAYLOAD_BYTES);
assert.strictEqual(assertTcpPayloadSize('a'.repeat(1024 * 1024)), 1024 * 1024);
throws(/maximum is 1048576/, () => assertTcpPayloadSize('a'.repeat(1024 * 1024 + 1)));
assert.strictEqual(
  decodeUdpDatagram(Buffer.from('é,a'), { format: 'delimited' }).record.validation.byteLength,
  4
);
throws(/maximum is 65507/, () =>
  assertUdpPayloadSize(`${'a'.repeat(UDP_MAX_PAYLOAD_BYTES - 3)}😀`)
);
throws(/maximum is 65507/, () =>
  assertUdpPayloadSize(Buffer.alloc(UDP_MAX_PAYLOAD_BYTES + 1))
);

function splitAtEveryByte(payload, format, options) {
  const bytes = Buffer.from(payload);
  for (let split = 0; split <= bytes.length; split++) {
    const decoder = createTcpPayloadDecoder(format, options);
    const output = [
      ...decoder.push(bytes.subarray(0, split)),
      ...decoder.push(bytes.subarray(split)),
      ...decoder.end(),
    ];
    assert.deepStrictEqual(output, [payload]);
  }
}

splitAtEveryByte('{"message":"héllo 😀"}', 'json');
splitAtEveryByte('"first\nsecond",😀', 'delimited');

const jsonDecoder = createTcpPayloadDecoder('json');
assert.deepStrictEqual(
  jsonDecoder.push(Buffer.from(' {"a":1}\n[2,{"text":"}"}] {"é":true} ')),
  ['{"a":1}', '[2,{"text":"}"}]', '{"é":true}']
);
assert.deepStrictEqual(jsonDecoder.end(), []);

const geoJsonPayload = '{"type":"Feature","properties":{},"geometry":null}';
const geoJsonDecoder = createTcpPayloadDecoder('geo-json');
assert.deepStrictEqual(geoJsonDecoder.push(geoJsonPayload), [geoJsonPayload]);
const esriJsonPayload = '{"features":[{"attributes":{"id":1}}]}';
const esriJsonDecoder = createTcpPayloadDecoder('esri-json');
assert.deepStrictEqual(esriJsonDecoder.push(esriJsonPayload), [esriJsonPayload]);

const csvDecoder = createTcpPayloadDecoder('delimited');
assert.deepStrictEqual(csvDecoder.push('a,b\r'), []);
assert.deepStrictEqual(csvDecoder.push('\n"x\n'), ['a,b']);
assert.deepStrictEqual(csvDecoder.push('y",z\nlast,row'), ['"x\ny",z']);
assert.deepStrictEqual(csvDecoder.end(), ['last,row']);

const firstDecoder = createTcpPayloadDecoder('json');
const secondDecoder = createTcpPayloadDecoder('json');
assert.deepStrictEqual(firstDecoder.push('{"first":'), []);
assert.deepStrictEqual(secondDecoder.push('{"second":2}'), ['{"second":2}']);
assert.deepStrictEqual(firstDecoder.push('1}'), ['{"first":1}']);

throws(/incomplete JSON payload/, () => {
  const decoder = createTcpPayloadDecoder('json');
  decoder.push('{"a":');
  decoder.end();
});
throws(/unmatched delimited quote/, () => {
  const decoder = createTcpPayloadDecoder('delimited');
  decoder.push('"a');
  decoder.end();
});
throws(/exceeds 5/, () => {
  const decoder = createTcpPayloadDecoder('json', { maxRecordBytes: 5 });
  decoder.push('{"abcd');
});
throws(/exceeds 5/, () => {
  const decoder = createTcpPayloadDecoder('delimited', { maxRecordBytes: 5 });
  decoder.push('abcdef');
});

const tolerantJson = createTcpRecordDecoder('json');
let received = tolerantJson.push('{"ok":1}{"bad":}\n{"later":2}');
assert.deepStrictEqual(
  received.records.map((record) => record.payload),
  ['{"ok":1}', '{"bad":}', '{"later":2}']
);
assert(received.records[0].validation);
assert.strictEqual(received.records[0].warning, null);
assert.strictEqual(received.records[1].validation, null);
assert.match(received.records[1].warning, /validation failed/);
assert(received.records[2].validation);
assert.deepStrictEqual(tolerantJson.end(), { records: [], warnings: [] });

const completeThenEnd = createTcpRecordDecoder('json');
received = completeThenEnd.push('{"complete":true}');
assert.strictEqual(received.records.length, 1);
assert.deepStrictEqual(completeThenEnd.end(), { records: [], warnings: [] });

const partialRetained = createTcpRecordDecoder('json');
assert.deepStrictEqual(partialRetained.push('{"partial":').records, []);
received = partialRetained.push('true}');
assert.strictEqual(received.records[0].payload, '{"partial":true}');
assert.deepStrictEqual(partialRetained.end(), { records: [], warnings: [] });

const tolerantGeoJson = createTcpRecordDecoder('geo-json');
received = tolerantGeoJson.push('{"type":"Point","coordinates":[1,2]}');
assert.strictEqual(received.records.length, 1);
assert.strictEqual(received.records[0].payload, '{"type":"Point","coordinates":[1,2]}');
assert.match(received.records[0].warning, /validation failed/);

const malformedJson = createTcpRecordDecoder('json');
received = malformedJson.push('{"broken":]\n{"ok":true}\n');
assert.strictEqual(received.records.length, 2);
assert.strictEqual(received.records[0].payload, '{"broken":]');
assert.match(received.records[0].warning, /Malformed JSON/);
assert(received.records[1].validation);

const malformedDelimited = createTcpRecordDecoder('delimited');
received = malformedDelimited.push('bad"quote,1\ngood,2\n');
assert.strictEqual(received.records.length, 2);
assert.match(received.records[0].warning, /Malformed delimited/);
assert(received.records[1].validation);

const blankSkippingDelimited = createTcpRecordDecoder('delimited', {
  skipEmptyRecords: true,
});
received = blankSkippingDelimited.push('\n  \r\na,b\n\nc,d\n');
assert.deepStrictEqual(
  received.records.map((record) => record.payload),
  ['a,b', 'c,d']
);
assert.deepStrictEqual(blankSkippingDelimited.end('   '), { records: [], warnings: [] });
const blankRetainingDelimited = createTcpRecordDecoder('delimited');
received = blankRetainingDelimited.push('\n');
assert.strictEqual(received.records.length, 1);
assert.strictEqual(received.records[0].payload, '');

const incompleteJson = createTcpRecordDecoder('json');
assert.deepStrictEqual(incompleteJson.push('{"unfinished": ').records, []);
received = incompleteJson.end();
assert.strictEqual(received.records[0].payload, '{"unfinished": ');
assert.match(received.records[0].warning, /incomplete JSON/);

const oversizedJson = createTcpRecordDecoder('json', { maxRecordBytes: 8 });
received = oversizedJson.push('{"unfinished');
assert.strictEqual(received.records[0].payload, '{"unfinished');
assert.match(received.records[0].warning, /exceeded 8/);
received = oversizedJson.push('{"ok":1}');
assert(received.records[0].validation);

const completeRecordLimit = createTcpRecordDecoder('json', { maxRecordBytes: 16 });
const exactJson = '{"value":"1234"}';
assert.strictEqual(Buffer.byteLength(exactJson), 16);
received = completeRecordLimit.push(exactJson);
assert(received.records[0].validation);
assert.deepStrictEqual(received.warnings, []);
const oversizedCompleteJson = '{"value":"12345"}';
assert.strictEqual(Buffer.byteLength(oversizedCompleteJson), 17);
received = completeRecordLimit.push(oversizedCompleteJson);
assert.strictEqual(received.records[0].payload, oversizedCompleteJson);
assert.strictEqual(received.records[0].validation, null);
assert.match(received.records[0].warning, /exceeded 16/);
assert.deepStrictEqual(completeRecordLimit.end(), { records: [], warnings: [] });

const completeDelimitedLimit = createTcpRecordDecoder('delimited', { maxRecordBytes: 8 });
received = completeDelimitedLimit.push('1234,567\n');
assert.strictEqual(received.records[0].validation.byteLength, 8);
received = completeDelimitedLimit.push('1234,5678\n');
assert.strictEqual(received.records[0].payload, '1234,5678');
assert.match(received.records[0].warning, /exceeded 8/);

const invalidUtf8 = createTcpRecordDecoder('json');
received = invalidUtf8.push(Buffer.concat([
  Buffer.from('{"first":1}'),
  Buffer.from([0xff, 0xfe]),
  Buffer.from('{"second":2}'),
]));
assert.deepStrictEqual(
  received.records.map((record) => record.payload),
  ['{"first":1}', '{"second":2}']
);
assert(received.records.every((record) => record.validation));
assert(received.warnings.some((warning) => /droppedByteLength=2/.test(warning)));
assert(!received.warnings.some((warning) => warning.includes('first') || warning.includes('second')));

const splitUtf8Receive = createTcpRecordDecoder('json');
const unicodeDocument = Buffer.from('{"value":"😀"}');
assert.deepStrictEqual(splitUtf8Receive.push(unicodeDocument.subarray(0, 12)).records, []);
received = splitUtf8Receive.push(unicodeDocument.subarray(12));
assert.strictEqual(received.records[0].payload, '{"value":"😀"}');

let udp = decodeUdpDatagram(Buffer.from('{"ok":1}'), { format: 'json' });
assert(udp.record.validation);
assert.deepStrictEqual(udp.warnings, []);
const bomJsonDatagram = Buffer.from('\uFEFF{"ok":1}');
udp = decodeUdpDatagram(bomJsonDatagram, { format: 'json' });
assert.strictEqual(udp.record.payload, '\uFEFF{"ok":1}');
assert.deepStrictEqual(udp.record.validation.value, { ok: 1 });
assert.strictEqual(udp.record.validation.byteLength, bomJsonDatagram.length);
const bomDelimitedDatagram = Buffer.from('\uFEFFa,b');
udp = decodeUdpDatagram(bomDelimitedDatagram, { format: 'delimited' });
assert.strictEqual(udp.record.payload, '\uFEFFa,b');
assert(udp.record.validation);
assert.strictEqual(udp.record.validation.byteLength, bomDelimitedDatagram.length);
udp = decodeUdpDatagram(Buffer.from('{"type":"Point"}'), { format: 'geo-json' });
assert.strictEqual(udp.record.validation, null);
assert.match(udp.record.warning, /validation failed/);
udp = decodeUdpDatagram(Buffer.from('{"bad":}'), { format: 'json' });
assert.strictEqual(udp.record.payload, '{"bad":}');
assert.match(udp.record.warning, /validation failed/);
udp = decodeUdpDatagram(Buffer.from('secret-value'), { format: 'json' });
assert(!udp.warnings[0].includes('secret-value'));
udp = decodeUdpDatagram(Buffer.from(secretSyntaxPayload), { format: 'json' });
assert(!udp.record.warning.includes('do-not-echo'));
assert(!JSON.stringify(udp.warnings).includes('do-not-echo'));
udp = decodeUdpDatagram(Buffer.from([0xff]), { format: 'json' });
assert.strictEqual(udp.record, null);
assert.match(udp.warnings[0], /droppedByteLength=1/);
udp = decodeUdpDatagram(Buffer.alloc(UDP_MAX_PAYLOAD_BYTES + 1), { format: 'delimited' });
assert.strictEqual(udp.record, null);
assert.match(udp.warnings[0], /droppedByteLength=65508/);

console.log('payload-format-utils tests passed');

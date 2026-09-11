const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadLinesFromFile, loadReplayPayloadsFromFile } = require('../src/file-source');

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'velocity-file-source-'));
  const file = path.join(directory, 'events.csv');
  try {
    fs.writeFileSync(file, 'id,name,longitude,latitude\r\n001,"First\r\nEvent",-117,34\r\n002,Second,-118,35\r\n');

    assert.deepStrictEqual(await loadReplayPayloadsFromFile(file, {
      protocol: 'tcp', format: 'delimited', hasHeaderRow: false,
    }), [
      'id,name,longitude,latitude',
      '001,"First\r\nEvent",-117,34',
      '002,Second,-118,35',
    ]);

    assert.deepStrictEqual((await loadReplayPayloadsFromFile(file, {
      protocol: 'tcp', format: 'json', hasHeaderRow: true,
    })).map(JSON.parse), [
      { id: '001', name: 'First\r\nEvent', longitude: -117, latitude: 34 },
      { id: '002', name: 'Second', longitude: -118, latitude: 35 },
    ]);

    const geoJson = (await loadReplayPayloadsFromFile(file, {
      protocol: 'udp', format: 'geo-json', hasHeaderRow: true,
      xField: 'longitude', yField: 'latitude', wkid: 4326,
    })).map(JSON.parse);
    assert.deepStrictEqual(geoJson[0].geometry.coordinates, [-117, 34]);
    assert.strictEqual(geoJson[0].properties.id, '001');

    await assert.rejects(loadReplayPayloadsFromFile(file, {
      protocol: 'udp', format: 'geo-json', hasHeaderRow: true,
      xField: 'longitude', yField: 'latitude', wkid: 3857,
    }), /WKID 4326/);

    fs.writeFileSync(file, `id,value\n1,${'x'.repeat(65508)}\n`);
    await assert.rejects(loadReplayPayloadsFromFile(file, {
      protocol: 'udp', format: 'delimited', hasHeaderRow: true,
    }), /maximum is 65507/);

    fs.writeFileSync(file, 'first\n\nsecond\n');
    assert.deepStrictEqual(await loadLinesFromFile(file), ['first', 'second']);
    assert.deepStrictEqual(await loadReplayPayloadsFromFile(file, {
      protocol: 'http', format: 'json',
    }), ['first', 'second']);

    console.log('file-source tests passed');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

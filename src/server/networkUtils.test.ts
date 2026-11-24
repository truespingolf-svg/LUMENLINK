import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWindowsHotspotScript,
  classifyJoinUrlProbe,
  deriveSharedPreviewUrl,
  filterLanIPv4Addresses,
  formatWifiQrPayload,
  resolvePublicJoinBaseUrl,
} from './networkUtils';

test('filterLanIPv4Addresses strips 169.254 link-local and loopback and prioritizes hotspot/LAN IPs', () => {
  const filtered = filterLanIPv4Addresses([
    '169.254.8.1',
    '127.0.0.1',
    '10.0.0.15',
    '192.168.1.42',
    '192.168.137.1',
  ]);
  assert.deepEqual(filtered, ['192.168.137.1', '192.168.1.42', '10.0.0.15']);
});

test('formatWifiQrPayload produces valid escaped WIFI auto-join string', () => {
  const payload = formatWifiQrPayload({
    ssid: 'STAGE;WIFI',
    password: 'Pass:123',
    encryption: 'WPA',
  });
  assert.equal(payload, 'WIFI:T:WPA;S:STAGE\\;WIFI;P:Pass\\:123;;');
});

test('formatWifiQrPayload produces passwordless nopass QR when password is empty or encryption is nopass', () => {
  assert.equal(
    formatWifiQrPayload({ ssid: 'LUMENLINK-STAGE', password: '' }),
    'WIFI:T:nopass;S:LUMENLINK-STAGE;;',
  );
  assert.equal(
    formatWifiQrPayload({ ssid: 'LUMENLINK-STAGE', password: 'ignored', encryption: 'nopass' }),
    'WIFI:T:nopass;S:LUMENLINK-STAGE;;',
  );
});

test('deriveSharedPreviewUrl identifies ais-dev URLs and suggests ais-pre public URL', () => {
  const info = deriveSharedPreviewUrl('https://ais-dev-abc123.europe-west3.run.app/');
  assert.equal(info.isAiStudioDevUrl, true);
  assert.equal(info.suggestedSharedUrl, 'https://ais-pre-abc123.europe-west3.run.app');
});

test('resolvePublicJoinBaseUrl exclusively uses shared public URLs and ignores stale private LAN custom URLs when public URL is available', () => {
  assert.equal(
    resolvePublicJoinBaseUrl({
      publicUrl: 'https://ais-dev-xyz.europe-west3.run.app',
      fallbackOrigin: 'http://localhost:3000',
    }),
    'https://ais-pre-xyz.europe-west3.run.app',
  );
  assert.equal(
    resolvePublicJoinBaseUrl({
      customBaseUrl: 'http://192.168.1.42:3000',
      publicUrl: 'https://ais-dev-xyz.europe-west3.run.app',
      fallbackOrigin: 'http://localhost:3000',
    }),
    'https://ais-pre-xyz.europe-west3.run.app',
  );
  assert.equal(
    resolvePublicJoinBaseUrl({
      customBaseUrl: 'https://stage.example.com/',
      publicUrl: 'https://ais-dev-xyz.europe-west3.run.app',
      fallbackOrigin: 'http://localhost:3000',
    }),
    'https://stage.example.com',
  );
  assert.equal(
    resolvePublicJoinBaseUrl({
      publicUrl: 'https://ais-dev-xyz.europe-west3.run.app',
      fallbackOrigin: 'https://lumenlink-live-123.run.app',
    }),
    'https://lumenlink-live-123.run.app',
  );
});

test('classifyJoinUrlProbe classifies 200, 404 ais-pre blank page, and 302 auth redirect', () => {
  assert.equal(
    classifyJoinUrlProbe({ httpStatus: 200, url: 'https://ais-pre-abc.run.app/join/demo' }).status,
    'live',
  );
  assert.equal(
    classifyJoinUrlProbe({ httpStatus: 404, url: 'https://ais-pre-abc.run.app/join/demo' }).status,
    'not_published',
  );
  assert.equal(
    classifyJoinUrlProbe({
      httpStatus: 302,
      locationHeader: '/__cookie_check.html',
      url: 'https://ais-dev-abc.run.app/join/demo',
    }).status,
    'auth_required',
  );
});

test('buildWindowsHotspotScript includes firewall rule and hotspot credentials when password is provided', () => {
  const script = buildWindowsHotspotScript('LUMEN_NET', 'StagePass99', 3000, 'demo-arena-show');
  assert.ok(script.includes('localport=3000'));
  assert.ok(script.includes('LUMEN_NET'));
  assert.ok(script.includes('StagePass99'));
  assert.ok(script.includes('http://192.168.137.1:3000/join/demo-arena-show'));
});

test('buildWindowsHotspotScript supports passwordless open Wi-Fi without forcing Lumen2025', () => {
  const script = buildWindowsHotspotScript('LUMEN_OPEN', '', 3000, 'demo-arena-show');
  assert.ok(script.includes('localport=3000'));
  assert.ok(script.includes('LUMEN_OPEN'));
  assert.ok(script.includes('No Password'));
  assert.equal(script.includes('Lumen2025'), false);
});

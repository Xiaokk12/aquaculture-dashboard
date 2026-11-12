import test from 'node:test';
import assert from 'node:assert/strict';
import { createAquacultureClient, DATA_SOURCE } from './api.ts';
import { createDemoSnapshot, getHistory } from './data.ts';

const NOW = Date.UTC(2026, 10, 12, 13, 0, 0);
const WORKSHOP = 'fish-nursery';
const demo = () => createDemoSnapshot(NOW, WORKSHOP);
const fixture = () => {
  const snapshot = demo();
  return {
    workshopId: WORKSHOP,
    generatedAt: NOW,
    devices: snapshot.devices.map(({ id, status, activePoolId }) => ({ id, status, activePoolId })),
    pools: snapshot.pools.map(({ id, deviceId, channel, measuredAt, values }) => ({ id, deviceId, channel, measuredAt, values })),
  };
};
const historyFixture = () => ({
  poolId: 'F1-01', metric: 'oxygen', unit: 'mg/L', from: NOW - 86_400_000, to: NOW,
  points: [
    { timestamp: NOW - 1_800_000, value: 0 },
    { timestamp: NOW - 900_000, value: null },
    { timestamp: NOW, value: 6.8 },
  ],
});
const response = (data) => Response.json({ code: 0, message: 'ok', data });
const api = (payload, options = {}) => createAquacultureClient({ dataSource: 'api', now: () => NOW, fetchImpl: async () => response(payload), ...options });

test('defaults to demo and never calls transport in demo mode', async () => {
  assert.equal(DATA_SOURCE, 'demo');
  const client = createAquacultureClient({ now: () => NOW, fetchImpl: () => { throw new Error('unexpected request'); } });
  assert.deepEqual(await client.getWorkshopSnapshot(WORKSHOP), demo());
  const pool = demo().pools[0];
  assert.deepEqual(await client.getPoolHistory(pool, 'oxygen', 24, NOW), getHistory(pool, 'oxygen', 24, NOW));
});

test('uses the configured API path and trusted layout rather than backend geometry', async () => {
  let request;
  const payload = fixture();
  payload.pools[0].x = -999;
  payload.devices[0].color = 'red';
  const client = api(payload, { baseUrl: '/service/api/', fetchImpl: async (url, init) => { request = { url, init }; return response(payload); } });
  const snapshot = await client.getWorkshopSnapshot(WORKSHOP);
  assert.equal(request.url, '/service/api/workshops/fish-nursery/snapshot');
  assert.equal(request.init.method, 'GET');
  assert.equal(request.init.cache, 'no-store');
  assert.ok(request.init.signal instanceof AbortSignal);
  assert.equal(snapshot.pools[0].x, demo().pools[0].x);
  assert.equal(snapshot.devices[0].color, demo().devices[0].color);
  assert.deepEqual(snapshot.pools[0].values, payload.pools[0].values);
  assert.equal(snapshot.generatedAt, NOW);
});

test('missing pools and omitted metrics remain null while zero stays a real measurement', async () => {
  const payload = fixture();
  payload.pools = payload.pools.slice(0, 1);
  payload.pools[0].values.oxygen = 0;
  delete payload.pools[0].values.turbidity;
  const snapshot = await api(payload).getWorkshopSnapshot(WORKSHOP);
  assert.equal(snapshot.pools.length, 72);
  assert.equal(snapshot.pools[0].values.oxygen, 0);
  assert.equal(snapshot.pools[0].values.turbidity, null);
  assert.equal(snapshot.pools[1].measuredAt, null);
  assert.ok(Object.values(snapshot.pools[1].values).every((value) => value === null));
  snapshot.pools[1].values.oxygen = 8;
  assert.equal(snapshot.pools[2].values.oxygen, null);
});

test('all declared workshops merge with correct local pool inventory', async () => {
  for (const [workshopId, count] of [['shellfish-nursery', 66], ['fish-nursery', 72], ['shellfish-breeding', 62], ['abalone-first', 39], ['abalone-42', 42]]) {
    const preview = createDemoSnapshot(NOW, workshopId);
    const payload = { workshopId, generatedAt: NOW, devices: preview.devices, pools: [] };
    const snapshot = await api(payload).getWorkshopSnapshot(workshopId);
    assert.equal(snapshot.pools.length, count);
    assert.ok(snapshot.pools.every((pool) => pool.measuredAt === null));
    assert.deepEqual(snapshot.devices.map(({ poolIds }) => poolIds), preview.devices.map(({ poolIds }) => poolIds));
  }
});

for (const [name, mutate, pattern] of [
  ['wrong workshop', (p) => { p.workshopId = 'abalone-first'; }, /workshopId/],
  ['invalid snapshot time', (p) => { p.generatedAt = '1794488400000'; }, /毫秒时间戳/],
  ['missing devices', (p) => { p.devices = []; }, /全部检测机/],
  ['unknown device', (p) => { p.devices[0].id = 'X1'; }, /检测机编号/],
  ['duplicate device', (p) => { p.devices.push(p.devices[0]); }, /重复/],
  ['unknown device state', (p) => { p.devices[0].status = 'connected'; }, /status/],
  ['wrong active pool', (p) => { p.devices[0].activePoolId = 'F2-01'; }, /activePoolId/],
  ['unknown pool', (p) => { p.pools[0].id = 'F1-99'; }, /池号/],
  ['duplicate pool', (p) => { p.pools.push(p.pools[0]); }, /重复/],
  ['wrong pool device', (p) => { p.pools[0].deviceId = 'F2'; }, /检测机或通道/],
  ['wrong pool channel', (p) => { p.pools[0].channel = 2; }, /检测机或通道/],
  ['numeric string', (p) => { p.pools[0].values.oxygen = '6.8'; }, /数值或 null/],
  ['missing sample time', (p) => { delete p.pools[0].measuredAt; }, /毫秒时间戳/],
  ['readings without sample time', (p) => { p.pools[0].measuredAt = null; }, /采集时间/],
]) {
  test(`rejects snapshot contract error: ${name}`, async () => {
    const payload = fixture();
    mutate(payload);
    await assert.rejects(api(payload).getWorkshopSnapshot(WORKSHOP), pattern);
  });
}

test('returns real offline status without inventing sampling activity', async () => {
  const payload = fixture();
  payload.devices[0].status = 'offline';
  delete payload.devices[0].activePoolId;
  const snapshot = await api(payload).getWorkshopSnapshot(WORKSHOP);
  assert.equal(snapshot.devices[0].status, 'offline');
  assert.equal(snapshot.devices[0].activePoolId, null);
});

test('requests history for the exact pool and keeps zero/null points unchanged', async () => {
  const payload = historyFixture();
  let url;
  const client = api(payload, { fetchImpl: async (input) => { url = input; return response(payload); } });
  assert.deepEqual(await client.getPoolHistory(demo().pools[0], 'oxygen', 24, NOW), payload.points);
  assert.equal(url, '/api/pools/F1-01/history?metric=oxygen&hours=24');
  payload.points = [];
  assert.deepEqual(await api(payload).getPoolHistory(demo().pools[0], 'oxygen', 24, NOW), []);
});

for (const [name, mutate, pattern] of [
  ['wrong pool', (p) => { p.poolId = 'F1-02'; }, /池号或参数/],
  ['wrong metric', (p) => { p.metric = 'temperature'; }, /池号或参数/],
  ['wrong unit', (p) => { p.unit = 'ppm'; }, /单位/],
  ['reversed range', (p) => { p.from = NOW + 1; }, /起止时间/],
  ['out of order', (p) => { p.points.reverse(); }, /按时间排序/],
  ['out of range', (p) => { p.points[2].timestamp = NOW + 1; }, /范围/],
  ['missing value', (p) => { delete p.points[0].value; }, /value 缺失/],
]) {
  test(`rejects history contract error: ${name}`, async () => {
    const payload = historyFixture();
    mutate(payload);
    await assert.rejects(api(payload).getPoolHistory(demo().pools[0], 'oxygen', 24, NOW), pattern);
  });
}

test('HTTP, business and invalid-JSON errors propagate without demo fallback', async () => {
  const pool = demo().pools[0];
  for (const [fetchImpl, pattern] of [
    [async () => new Response('unavailable', { status: 503 }), /HTTP 503/],
    [async () => Response.json({ code: 7, message: 'sensor service unavailable', data: null }), /sensor service unavailable/],
    [async () => Response.json({ code: '0', data: fixture() }), /code 应为数字/],
    [async () => new Response('<html>fallback page</html>'), /有效 JSON/],
    [async () => { throw new TypeError('Failed to fetch'); }, /无法连接后端/],
  ]) {
    const client = api(null, { fetchImpl });
    await assert.rejects(client.getWorkshopSnapshot(WORKSHOP), pattern);
    await assert.rejects(client.getPoolHistory(pool, 'oxygen', 24, NOW), pattern);
  }
});

test('timeout aborts the fetch and exposes a useful timeout error', async () => {
  let aborted = false;
  const client = api(null, {
    timeoutMs: 5,
    fetchImpl: (_, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true });
    }),
  });
  await assert.rejects(client.getWorkshopSnapshot(WORKSHOP), /请求超时/);
  assert.equal(aborted, true);
});

test('caller cancellation aborts an in-flight fetch and preserves AbortError', async () => {
  const controller = new AbortController();
  let requested;
  const ready = new Promise((resolve) => { requested = resolve; });
  const client = api(null, {
    fetchImpl: (_, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      requested();
    }),
  });
  const result = client.getWorkshopSnapshot(WORKSHOP, controller.signal);
  await ready;
  controller.abort();
  await assert.rejects(result, { name: 'AbortError' });
  await assert.rejects(client.getWorkshopSnapshot(WORKSHOP, controller.signal), { name: 'AbortError' });
});

test('bad request arguments are rejected before transport', async () => {
  const client = api(null, { fetchImpl: () => { throw new Error('unexpected request'); } });
  await assert.rejects(client.getWorkshopSnapshot('unknown'), /Unknown workshop/);
  await assert.rejects(client.getPoolHistory({ ...demo().pools[0], id: 'unknown' }, 'oxygen', 24, NOW), /Unknown pool/);
  await assert.rejects(client.getPoolHistory(demo().pools[0], 'bad', 24, NOW), /Unknown metric/);
  await assert.rejects(client.getPoolHistory(demo().pools[0], 'oxygen', 0, NOW), /历史时间范围/);
  await assert.rejects(client.getPoolHistory(demo().pools[0], 'oxygen', 73, NOW), /历史时间范围/);
  assert.throws(() => createAquacultureClient({ dataSource: 'invalid' }), /demo 或 api/);
});

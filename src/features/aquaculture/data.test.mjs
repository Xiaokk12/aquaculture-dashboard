import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DATA_STALE_AFTER_MS,
  DEVICE_DEFINITIONS,
  METRICS,
  createDemoSnapshot,
  formatMetric,
  getAlerts,
  getHistory,
  getMetric,
  getPoolStatus,
} from './data.ts';
import { WORKSHOPS, DEFAULT_WORKSHOP_ID, getWorkshop, getWorkshopPools } from './workshops.ts';

const NOW = Date.UTC(2026, 10, 3, 8, 0, 0);
const HOUR = 3_600_000;
const freshPool = () => structuredClone(createDemoSnapshot(NOW).pools[0]);

test('72 unique pools fill every map position and three disjoint devices of 24', () => {
  const { pools, devices } = createDemoSnapshot(NOW);
  assert.equal(pools.length, 72);
  assert.equal(devices.length, 3);
  assert.equal(new Set(pools.map(({ id }) => id)).size, 72);
  assert.equal(new Set(devices.map(({ id }) => id)).size, 3);
  assert.equal(new Set(pools.map(({ number }) => number)).size, 72);
  assert.equal(new Set(pools.map(({ row, position }) => `${row}:${position}`)).size, 72);
  assert.equal(pools[0].id, 'F1-01');
  assert.equal(pools.at(-1).id, 'F3-24');
  assert.deepEqual(devices.map(({ id }) => id), ['F1', 'F2', 'F3']);
  const assigned = [];
  for (const device of devices) {
    assert.equal(device.poolIds.length, 24);
    assert.deepEqual(device.poolIds, Array.from({ length: 24 }, (_, index) => `${device.id}-${String(index + 1).padStart(2, '0')}`));
    assert.ok(!('row' in device) && !('group' in device));
    assert.deepEqual(
      { id: device.id, number: device.number, region: device.region, color: device.color },
      DEVICE_DEFINITIONS.find(({ id }) => id === device.id),
    );
    for (const poolId of device.poolIds) {
      const pool = pools.find(({ id }) => id === poolId);
      assert.ok(pool);
      assert.equal(pool.deviceId, device.id);
      assert.equal(pool.number, (device.number - 1) * 24 + pool.channel);
      assert.ok(pool.channel >= 1 && pool.channel <= 24);
      if (device.id === 'F1') assert.ok(pool.row <= 8 && pool.position >= 4);
      else if (device.id === 'F2') assert.ok(pool.row <= 8 && pool.position <= 3);
      else assert.ok(pool.row >= 9 && pool.row <= 12);
      assigned.push(poolId);
    }
    if (device.activePoolId !== null) assert.ok(device.poolIds.includes(device.activePoolId));
  }
  assert.equal(new Set(assigned).size, 72);
  for (let row = 1; row <= 12; row += 1) {
    assert.deepEqual(pools.filter((pool) => pool.row === row).map(({ position }) => position).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  }
});

test('regional channels increase bottom-to-top and then move left-to-right', () => {
  const { pools } = createDemoSnapshot(NOW);
  const expected = {
    'F1-01': [1, 6], 'F1-03': [1, 4], 'F1-04': [2, 6], 'F1-22': [8, 6], 'F1-24': [8, 4],
    'F2-01': [1, 3], 'F2-03': [1, 1], 'F2-04': [2, 3], 'F2-22': [8, 3], 'F2-24': [8, 1],
    'F3-01': [9, 6], 'F3-06': [9, 1], 'F3-07': [10, 6], 'F3-19': [12, 6], 'F3-24': [12, 1],
  };
  for (const [id, coordinates] of Object.entries(expected)) {
    const pool = pools.find((item) => item.id === id);
    assert.deepEqual([pool.row, pool.position], coordinates, id);
  }
  assert.deepEqual(DEVICE_DEFINITIONS, [
    { id: 'F1', number: 1, region: '左下区', color: '#165fb1' },
    { id: 'F2', number: 2, region: '左上区', color: '#bd5311' },
    { id: 'F3', number: 3, region: '右侧区', color: '#0d8357' },
  ]);
});

test('demo is deterministic and snapshots do not share mutable data', () => {
  const first = createDemoSnapshot(NOW);
  const second = createDemoSnapshot(NOW);
  assert.deepEqual(first, second);
  first.pools[0].values.temperature = 100;
  first.devices[0].poolIds.pop();
  assert.notEqual(first.pools[0].values.temperature, second.pools[0].values.temperature);
  assert.equal(second.devices[0].poolIds.length, 24);
  assert.throws(() => createDemoSnapshot(NaN), RangeError);
});

test('demo contains five water examples, six stale pools and three empty pools', () => {
  const snapshot = createDemoSnapshot(NOW);
  const counts = snapshot.pools.reduce((all, pool) => {
    const status = getPoolStatus(pool, NOW);
    all[status] = (all[status] ?? 0) + 1;
    return all;
  }, {});
  assert.deepEqual(counts, { normal: 58, warning: 5, stale: 6, empty: 3 });
  assert.equal(getPoolStatus(snapshot.pools[0], NOW), 'normal');
  assert.ok(snapshot.devices.every(({ status }) => status === 'online'));
  assert.deepEqual(snapshot.pools.filter((pool) => getPoolStatus(pool, NOW) === 'warning').map(({ number }) => number), [7, 14, 35, 52, 61]);
  assert.deepEqual(snapshot.pools.filter((pool) => getPoolStatus(pool, NOW) === 'stale').map(({ number }) => number), [22, 23, 24, 49, 50, 51]);
  assert.deepEqual(snapshot.pools.filter((pool) => getPoolStatus(pool, NOW) === 'empty').map(({ id }) => id), ['F3-22', 'F3-23', 'F3-24']);
});

test('freshness boundary, future timestamps and missing metrics never look normal', () => {
  const pool = freshPool();
  pool.measuredAt = NOW - DATA_STALE_AFTER_MS;
  assert.equal(getPoolStatus(pool, NOW), 'normal');
  pool.measuredAt -= 1;
  assert.equal(getPoolStatus(pool, NOW), 'stale');
  pool.measuredAt = NOW + 1;
  assert.equal(getPoolStatus(pool, NOW), 'stale');
  pool.measuredAt = NaN;
  assert.equal(getPoolStatus(pool, NOW), 'stale');
  pool.measuredAt = NOW;
  pool.values.oxygen = null;
  assert.equal(getPoolStatus(pool, NOW), 'warning');
  for (const metric of METRICS) pool.values[metric.key] = null;
  assert.equal(getPoolStatus(pool, NOW), 'empty');
  const noTimestamp = freshPool();
  noTimestamp.measuredAt = null;
  assert.equal(getPoolStatus(noTimestamp, NOW), 'empty');
});

test('demo thresholds are inclusive and genuine zero is different from missing', () => {
  for (const metric of METRICS) {
    const pool = freshPool();
    pool.values[metric.key] = metric.min;
    assert.equal(getPoolStatus(pool, NOW), 'normal');
    pool.values[metric.key] = metric.max;
    assert.equal(getPoolStatus(pool, NOW), 'normal');
    pool.values[metric.key] = metric.max + 0.01;
    assert.equal(getPoolStatus(pool, NOW), 'warning');
  }
  const pool = freshPool();
  pool.values.turbidity = 0;
  assert.equal(getPoolStatus(pool, NOW), 'normal');
  assert.equal(formatMetric(0, 'turbidity'), '0.0');
  assert.equal(formatMetric(null, 'turbidity'), '—');
  assert.equal(formatMetric(NaN, 'oxygen'), '—');
  assert.equal(formatMetric(Infinity, 'oxygen'), '—');
  assert.equal(formatMetric(8, 'ph'), '8.00');
  assert.equal(formatMetric(6.6, 'oxygen'), '6.6');
  for (const metric of METRICS) {
    assert.equal(getMetric(metric.key), metric);
    assert.match(metric.color, /^#[0-9a-f]{6}$/i);
  }
});

test('alerts agree with statuses and device mapping without duplicates', () => {
  const snapshot = createDemoSnapshot(NOW);
  const alerts = getAlerts(snapshot, NOW);
  assert.equal(alerts.length, 14);
  assert.equal(new Set(alerts.map(({ id }) => id)).size, alerts.length);
  const counts = alerts.reduce((all, alert) => ({ ...all, [alert.kind]: (all[alert.kind] ?? 0) + 1 }), {});
  assert.deepEqual(counts, { water: 5, stale: 6, empty: 3 });
  for (const alert of alerts) {
    assert.ok(alert.occurredAt <= NOW);
    if (alert.poolId === null) {
      assert.equal(alert.kind, 'offline');
      assert.equal(snapshot.devices.find(({ id }) => id === alert.deviceId).status, 'offline');
      continue;
    }
    const pool = snapshot.pools.find(({ id }) => id === alert.poolId);
    assert.equal(alert.deviceId, pool.deviceId);
    assert.notEqual(getPoolStatus(pool, NOW), 'normal');
    if (alert.kind === 'water') {
      assert.equal(getPoolStatus(pool, NOW), 'warning');
      const metric = getMetric(alert.metric);
      assert.ok(pool.values[metric.key] < metric.min || pool.values[metric.key] > metric.max);
      assert.equal(alert.occurredAt, pool.measuredAt);
    } else assert.equal(getPoolStatus(pool, NOW), alert.kind);
  }
});

test('an explicit offline state adds one machine event without inventing 24 expired samples', () => {
  const snapshot = createDemoSnapshot(NOW);
  const originalPoolStates = snapshot.pools.map((pool) => getPoolStatus(pool, NOW));
  snapshot.devices[1].status = 'offline';
  snapshot.devices[1].activePoolId = null;
  const offline = getAlerts(snapshot, NOW).filter(({ kind }) => kind === 'offline');
  assert.equal(offline.length, 1);
  assert.equal(offline[0].deviceId, 'F2');
  assert.equal(offline[0].poolId, null);
  assert.equal(offline[0].occurredAt, snapshot.generatedAt);
  assert.deepEqual(snapshot.pools.map((pool) => getPoolStatus(pool, NOW)), originalPoolStates);
});

test('stale values are not emitted as current water alarms and partial missing values are reported', () => {
  const snapshot = createDemoSnapshot(NOW);
  const alarmPool = snapshot.pools.find(({ id }) => id === 'F1-07');
  alarmPool.measuredAt = NOW - DATA_STALE_AFTER_MS - 1;
  const partialPool = snapshot.pools[0];
  partialPool.values.oxygen = null;
  const alerts = getAlerts(snapshot, NOW);
  assert.deepEqual(alerts.filter(({ poolId }) => poolId === 'F1-07').map(({ kind }) => kind), ['stale']);
  const missing = alerts.find(({ poolId }) => poolId === 'F1-01');
  assert.equal(missing.kind, 'empty');
  assert.equal(missing.metric, 'oxygen');
  assert.equal(getPoolStatus(partialPool, NOW), 'warning');
});

test('every history stays inside its window and ends with the exact current sample', () => {
  const snapshot = createDemoSnapshot(NOW);
  for (const pool of snapshot.pools) {
    for (const { key } of METRICS) {
      const history = getHistory(pool, key, 24, NOW);
      if (pool.measuredAt === null) {
        assert.deepEqual(history, []);
        continue;
      }
      assert.ok(history.length > 0 && history.length <= 49);
      assert.deepEqual(history.at(-1), { timestamp: pool.measuredAt, value: pool.values[key] });
      for (let index = 0; index < history.length; index += 1) {
        const point = history[index];
        assert.ok(point.timestamp >= NOW - 24 * HOUR);
        assert.ok(point.timestamp <= pool.measuredAt && point.timestamp <= NOW);
        if (index > 0) assert.ok(point.timestamp > history[index - 1].timestamp);
        assert.ok(point.value === null || Number.isFinite(point.value));
      }
      if (getPoolStatus(pool, NOW) === 'stale') assert.ok(history.some(({ value }) => value === null));
    }
  }
});

test('history does not fabricate samples for future timestamps or absent windows', () => {
  const pool = freshPool();
  pool.measuredAt = NOW + 1;
  assert.deepEqual(getHistory(pool, 'temperature', 24, NOW), []);
  pool.measuredAt = NOW - 2 * HOUR;
  assert.deepEqual(getHistory(pool, 'temperature', 1, NOW), []);
  for (const hours of [0, -1, NaN, Infinity]) assert.deepEqual(getHistory(pool, 'temperature', hours, NOW), []);
  pool.measuredAt = null;
  assert.deepEqual(getHistory(pool, 'temperature', 24, NOW), []);
});

test('missing metric histories remain null and regular history preserves gaps', () => {
  const pool = freshPool();
  const regular = getHistory(pool, 'oxygen', 24, NOW);
  assert.ok(regular.some(({ value }) => value === null));
  pool.values.oxygen = null;
  const missing = getHistory(pool, 'oxygen', 24, NOW);
  assert.ok(missing.length > 0);
  assert.ok(missing.every(({ value }) => value === null));
});

test('advancing display time ages the data without rewriting any sample or creating later points', () => {
  const snapshot = createDemoSnapshot(NOW);
  const original = structuredClone(snapshot);
  for (const pool of snapshot.pools) {
    if (pool.measuredAt !== null) {
      assert.equal(getPoolStatus(pool, NOW + HOUR), 'stale');
      const history = getHistory(pool, 'oxygen', 24, NOW + HOUR);
      assert.equal(history.at(-1).timestamp, pool.measuredAt);
      assert.equal(history.at(-1).value, pool.values.oxygen);
    }
  }
  assert.equal(getAlerts(snapshot, NOW + HOUR).filter(({ kind }) => kind === 'water').length, 0);
  assert.deepEqual(snapshot, original);
});


test('five drawing pages have independent pool inventories and the stated device allocations', () => {
  const expected = [
    ['shellfish-nursery', 1, 66, [['S1', 22], ['S2', 22], ['S3', 22]]],
    ['fish-nursery', 2, 72, [['F1', 24], ['F2', 24], ['F3', 24]]],
    ['shellfish-breeding', 3, 62, [['B1', 22], ['B2', 20], ['B3', 20]]],
    ['abalone-first', 4, 39, [['A1', 14], ['A2', 25]]],
    ['abalone-42', 5, 42, [['C1', 14], ['C2', 28]]],
  ];
  assert.equal(DEFAULT_WORKSHOP_ID, 'fish-nursery');
  assert.deepEqual(WORKSHOPS.map(({ id }) => id), expected.map(([id]) => id));
  const allPoolIds = new Set();
  for (const [id, page, total, allocation] of expected) {
    const definition = getWorkshop(id);
    const snapshot = createDemoSnapshot(NOW, id);
    assert.equal(definition.drawingPage, page);
    assert.equal(definition.poolCount, total);
    assert.equal(snapshot.workshopId, id);
    assert.equal(snapshot.pools.length, total);
    assert.equal(new Set(snapshot.pools.map(({ id }) => id)).size, total);
    assert.deepEqual(snapshot.devices.map(({ id, poolIds }) => [id, poolIds.length]), allocation);
    assert.equal(snapshot.devices.reduce((sum, device) => sum + device.poolIds.length, 0), total);
    for (const device of snapshot.devices) {
      assert.deepEqual(device.poolIds, Array.from({ length: device.poolCount }, (_, i) => `${device.id}-${String(i + 1).padStart(2, '0')}`));
      for (const poolId of device.poolIds) {
        assert.ok(snapshot.pools.some((pool) => pool.id === poolId && pool.deviceId === device.id));
        assert.ok(!allPoolIds.has(poolId), `cross-page duplicate ${poolId}`);
        allPoolIds.add(poolId);
      }
    }
    for (const alert of getAlerts(snapshot, NOW)) {
      assert.ok(snapshot.devices.some((device) => device.id === alert.deviceId));
      if (alert.poolId) assert.ok(snapshot.pools.some((pool) => pool.id === alert.poolId));
    }
    const refreshed = createDemoSnapshot(NOW + HOUR, id);
    assert.equal(refreshed.workshopId, id);
    assert.deepEqual(refreshed.pools.map(({ id }) => id), snapshot.pools.map(({ id }) => id));
    assert.equal(refreshed.pools.filter((pool) => getPoolStatus(pool, NOW + HOUR) === 'empty').length, 3);
  }
  assert.throws(() => getWorkshop('unknown'), RangeError);
  assert.throws(() => createDemoSnapshot(NOW, 'unknown'), RangeError);
});

test('all drawing rectangles stay inside the common map, remain separate, and preserve key source positions', () => {
  for (const workshop of WORKSHOPS) {
    const pools = getWorkshopPools(workshop.id);
    for (const pool of pools) {
      assert.ok(pool.x >= 44.99 && pool.y >= 104.99);
      assert.ok(pool.width > 0 && pool.height > 0);
      assert.ok(pool.x + pool.width <= 1055.02 && pool.y + pool.height <= 635.02);
    }
    for (let a = 0; a < pools.length; a += 1) {
      for (let b = a + 1; b < pools.length; b += 1) {
        const first = pools[a], second = pools[b];
        const overlapWidth = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
        const overlapHeight = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);
        assert.ok(overlapWidth <= 0.03 || overlapHeight <= 0.03, `${workshop.id}: ${first.id} overlaps ${second.id}`);
      }
    }
  }
  const find = (workshopId, poolId) => getWorkshopPools(workshopId).find(({ id }) => id === poolId);
  assert.ok(find('shellfish-nursery', 'S1-01').y > find('shellfish-nursery', 'S1-13').y);
  assert.ok(find('shellfish-nursery', 'S2-11').y < find('shellfish-nursery', 'S2-01').y);
  assert.ok(find('shellfish-nursery', 'S3-01').x > find('shellfish-nursery', 'S1-12').x);
  assert.ok(find('shellfish-breeding', 'B2-01').x > find('shellfish-breeding', 'B2-05').x);
  assert.ok(find('shellfish-breeding', 'B3-05').y > find('shellfish-breeding', 'B2-05').y);
  assert.ok(find('abalone-first', 'A1-01').y > find('abalone-first', 'A1-07').y);
  assert.ok(find('abalone-42', 'C2-28').x > find('abalone-42', 'C2-21').x);
  assert.ok(find('abalone-42', 'C2-28').y < find('abalone-42', 'C2-22').y);
  const original = getWorkshopPools('abalone-42');
  original[0].x = -1;
  assert.notEqual(getWorkshopPools('abalone-42')[0].x, -1);
});


test('all thirteen machine markers retain their PDF positions relative to the pool plans', () => {
  // Independent coordinate references from the PDF's large-circle centers.
  const expected = {
    S1: [333.59, 612.87], S2: [331.77, 130.25], S3: [884.71, 360.14],
    F1: [392.88, 462.74], F2: [379, 279.39], F3: [868.35, 282.56],
    B1: [354.79, 236.22], B2: [853.8, 298.59], B3: [855.71, 427.33],
    A1: [317.33, 519.97], A2: [755.16, 340.42],
    C1: [313.49, 518.92], C2: [762.87, 335.97],
  };
  const markers = new Map();
  for (const workshop of WORKSHOPS) {
    assert.deepEqual(workshop.mapDevices.map(({ id }) => id).sort(), workshop.devices.map(({ id }) => id).sort());
    assert.equal(new Set(workshop.mapDevices.map(({ id }) => id)).size, workshop.devices.length);
    for (const marker of workshop.mapDevices) {
      assert.ok(Number.isFinite(marker.x) && marker.x > 0 && marker.x < 1100);
      assert.ok(Number.isFinite(marker.y) && marker.y > 0 && marker.y < 744);
      assert.ok(Math.abs(marker.x - expected[marker.id][0]) <= 0.02, `${marker.id} source x`);
      assert.ok(Math.abs(marker.y - expected[marker.id][1]) <= 0.02, `${marker.id} source y`);
      assert.ok(!markers.has(marker.id));
      markers.set(marker.id, marker);
    }
  }
  assert.equal(markers.size, 13);

  const pools = new Map(WORKSHOPS.flatMap(({ id }) => getWorkshopPools(id)).map((pool) => [pool.id, pool]));
  const bottom = (id) => pools.get(id).y + pools.get(id).height;
  const right = (id) => pools.get(id).x + pools.get(id).width;
  const owned = (id) => [...pools.values()].filter(({ deviceId }) => deviceId === id);
  // S1 is below its bottom row; S2/B1 are above their top rows.
  assert.ok(markers.get('S1').y > Math.max(...owned('S1').map((pool) => pool.y + pool.height)));
  for (const id of ['S2', 'B1']) assert.ok(markers.get(id).y < Math.min(...owned(id).map(({ y }) => y)));
  assert.ok(markers.get('S3').y > bottom('S3-12') && markers.get('S3').y < pools.get('S3-06').y);
  // The fish-nursery machines occupy the source aisle gaps, not the footer.
  for (const [id, above, below] of [['F1', 'F1-03', 'F1-02'], ['F2', 'F2-02', 'F2-01'], ['F3', 'F3-05', 'F3-04']]) {
    assert.ok(markers.get(id).y > bottom(above) && markers.get(id).y < pools.get(below).y);
  }
  assert.ok(Math.abs(markers.get('B2').y - bottom('B2-03')) < 3);
  assert.ok(Math.abs(markers.get('B3').y - bottom('B3-03')) < 10);
  // The abalone machines lie beside their sampled columns; circle centers are unchanged.
  for (const prefix of ['A', 'C']) {
    const first = markers.get(`${prefix}1`), second = markers.get(`${prefix}2`);
    assert.ok(first.x > right(`${prefix}1-08`));
    assert.ok(first.y > bottom(`${prefix}1-09`) && first.y < pools.get(`${prefix}1-08`).y);
    assert.ok(second.x > right(`${prefix}2-11`) && second.x < pools.get(`${prefix}2-18`).x);
  }
});

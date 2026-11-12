import { DEFAULT_WORKSHOP_ID, getWorkshop, getWorkshopPools } from './workshops.ts';

export type MetricKey = 'temperature' | 'salinity' | 'turbidity' | 'ph' | 'oxygen';
export type PoolStatus = 'normal' | 'warning' | 'stale' | 'empty';
export type DeviceStatus = 'online' | 'offline';
export type DeviceId = string;

export interface DeviceDefinition {
  id: DeviceId;
  number: number;
  region: string;
  color: string;
}

/** Default fish-nursery allocation, retained for existing integrations. */
export const DEVICE_DEFINITIONS: DeviceDefinition[] = getWorkshop(DEFAULT_WORKSHOP_ID).devices.map(
  ({ id, number, region, color }) => ({ id, number, region, color }),
);

export interface MetricDefinition {
  key: MetricKey;
  label: string;
  unit: string;
  precision: number;
  min: number;
  max: number;
  color: string;
}

/** All limits and units below are demonstration settings, not husbandry standards. */
export const METRICS: MetricDefinition[] = [
  { key: 'temperature', label: '温度', unit: '℃', precision: 1, min: 22, max: 30, color: '#f7b267' },
  { key: 'salinity', label: '盐度', unit: 'PSU', precision: 1, min: 20, max: 35, color: '#62c9ed' },
  { key: 'turbidity', label: '浊度', unit: 'NTU', precision: 1, min: 0, max: 20, color: '#b6a0ff' },
  { key: 'ph', label: 'pH', unit: '', precision: 2, min: 7, max: 8.8, color: '#7cddb7' },
  { key: 'oxygen', label: '溶解氧', unit: 'mg/L', precision: 1, min: 5, max: 10, color: '#5b9eff' },
];

export interface Pool {
  id: string;
  number: number;
  channel: number;
  row: number;
  position: number;
  x: number;
  y: number;
  width: number;
  height: number;
  deviceId: DeviceId;
  values: Record<MetricKey, number | null>;
  measuredAt: number | null;
}

export interface Device extends DeviceDefinition {
  poolCount: number;
  poolIds: string[];
  status: DeviceStatus;
  activePoolId: string | null;
}

export interface DemoSnapshot {
  workshopId: string;
  pools: Pool[];
  devices: Device[];
  generatedAt: number;
}

export interface Alert {
  id: string;
  poolId: string | null;
  deviceId: DeviceId;
  metric: MetricKey | null;
  kind: 'water' | 'offline' | 'stale' | 'empty';
  severity: 'warning' | 'critical' | 'info';
  title: string;
  occurredAt: number;
}

export interface HistoryPoint {
  timestamp: number;
  value: number | null;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** A UI demo setting only; the real detection cycle has not been specified. */
export const DATA_STALE_AFTER_MS = 30 * MINUTE;

const metricByKey = new Map(METRICS.map((metric) => [metric.key, metric]));
const stalePoolNumbers = new Set([22, 23, 24, 49, 50, 51]);
const isValue = (value: number | null): value is number => value !== null && Number.isFinite(value);
const rounded = (value: number, precision: number): number => Number(value.toFixed(precision));

export function getMetric(key: MetricKey): MetricDefinition {
  const metric = metricByKey.get(key);
  if (!metric) throw new RangeError(`Unknown metric: ${key}`);
  return metric;
}

/** Returns the value only. Render getMetric(key).unit separately. */
export function formatMetric(value: number | null, key: MetricKey): string {
  return isValue(value) ? value.toFixed(getMetric(key).precision) : '—';
}

export function createDemoSnapshot(now: number = Date.now(), workshopId: string = DEFAULT_WORKSHOP_ID): DemoSnapshot {
  if (!Number.isFinite(now)) throw new RangeError('Demo time must be finite');

  const workshop = getWorkshop(workshopId);
  const layoutPools = getWorkshopPools(workshopId);
  const pools: Pool[] = layoutPools.map((layout, index) => {
    const number = index + 1;
    const values: Record<MetricKey, number | null> = {
      temperature: rounded(26 + Math.sin(number * 0.73) * 1.7, 1),
      salinity: rounded(28.5 + Math.sin(number * 0.49) * 2.5, 1),
      turbidity: rounded(5 + (number % 8) * 0.6, 1),
      ph: rounded(8 + Math.sin(number * 0.31) * 0.14, 2),
      oxygen: rounded(6.6 + Math.sin(number * 0.43) * 0.8, 1),
    };

    // Explicit, repeatable examples rather than random live-looking measurements.
    if (number === 7) values.temperature = 31.6;
    if (number === 14) values.ph = 6.72;
    if (number === 35) values.oxygen = 3.8;
    if (number === 52) values.turbidity = 29.5;
    if (number === 61) values.salinity = 18.2;

    let measuredAt: number | null = now - (2 + (number * 7) % 15) * MINUTE;
    if (stalePoolNumbers.has(number)) measuredAt = now - (100 + (number * 9) % 25) * MINUTE;
    if (number > workshop.poolCount - 3) {
      for (const metric of METRICS) values[metric.key] = null;
      measuredAt = null;
    }

    return {
      ...layout, number, values, measuredAt,
    };
  });

  const devices: Device[] = workshop.devices.map((definition, index) => {
    const poolIds = pools.filter((pool) => pool.deviceId === definition.id).map((pool) => pool.id);
    return {
      ...definition,
      poolIds,
      // Preview state only: no real machine connectivity has been reported.
      status: 'online',
      activePoolId: poolIds[index],
    };
  });

  return { workshopId, pools, devices, generatedAt: now };
}

export function getPoolStatus(pool: Pool, now: number = Date.now()): PoolStatus {
  const present = METRICS.filter(({ key }) => isValue(pool.values[key]));
  if (present.length === 0 || pool.measuredAt === null) return 'empty';
  if (!Number.isFinite(pool.measuredAt) || pool.measuredAt > now || now - pool.measuredAt > DATA_STALE_AFTER_MS) return 'stale';
  if (present.length !== METRICS.length) return 'warning';
  return METRICS.some(({ key, min, max }) => {
    const value = pool.values[key];
    return isValue(value) && (value < min || value > max);
  }) ? 'warning' : 'normal';
}

export function getAlerts(snapshot: DemoSnapshot, now: number = Date.now()): Alert[] {
  const alerts: Alert[] = [];
  for (const device of snapshot.devices) {
    if (device.status === 'offline') {
      alerts.push({
        id: `offline:${device.id}`, poolId: null, deviceId: device.id, metric: null,
        kind: 'offline', severity: 'critical', title: `${device.id} 检测机离线`,
        // The snapshot records observation time, not a fabricated disconnect time.
        occurredAt: snapshot.generatedAt,
      });
    }
  }

  for (const pool of snapshot.pools) {
    const status = getPoolStatus(pool, now);
    if (status === 'empty') {
      alerts.push({
        id: `empty:${pool.id}`, poolId: pool.id, deviceId: pool.deviceId, metric: null,
        kind: 'empty', severity: 'info', title: `${pool.id} 暂无有效采集数据`, occurredAt: snapshot.generatedAt,
      });
      continue;
    }
    if (status === 'stale') {
      const validTime = pool.measuredAt !== null && Number.isFinite(pool.measuredAt) && pool.measuredAt <= now;
      alerts.push({
        id: `stale:${pool.id}`, poolId: pool.id, deviceId: pool.deviceId, metric: null,
        kind: 'stale', severity: 'warning', title: `${pool.id} ${validTime ? '数据已过期' : '采集时间异常'}`,
        occurredAt: validTime ? pool.measuredAt! + DATA_STALE_AFTER_MS : snapshot.generatedAt,
      });
      // Old samples must not be presented as current water-quality alarms.
      continue;
    }
    for (const metric of METRICS) {
      const value = pool.values[metric.key];
      if (!isValue(value)) {
        alerts.push({
          id: `missing:${pool.id}:${metric.key}`, poolId: pool.id, deviceId: pool.deviceId, metric: metric.key,
          kind: 'empty', severity: 'info', title: `${pool.id} ${metric.label}缺测`, occurredAt: pool.measuredAt!,
        });
      } else if (value < metric.min || value > metric.max) {
        alerts.push({
          id: `water:${pool.id}:${metric.key}`, poolId: pool.id, deviceId: pool.deviceId, metric: metric.key,
          kind: 'water', severity: metric.key === 'oxygen' && value < metric.min ? 'critical' : 'warning',
          title: `${pool.id} ${metric.label}${value < metric.min ? '偏低' : '偏高'} ${formatMetric(value, metric.key)}${metric.unit}`,
          occurredAt: pool.measuredAt!,
        });
      }
    }
  }

  const severityOrder = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || b.occurredAt - a.occurredAt || a.id.localeCompare(b.id));
}

/**
 * Synthetic history for preview only. It ends at the actual snapshot sample time;
 * never extrapolate a stale sample to the present. Nulls preserve missing segments.
 */
export function getHistory(pool: Pool, key: MetricKey, hours: number, now: number = Date.now()): HistoryPoint[] {
  if (!Number.isFinite(hours) || hours <= 0 || !Number.isFinite(now)) return [];
  const end = pool.measuredAt;
  if (end === null || !Number.isFinite(end) || end > now) return [];
  const duration = hours * HOUR;
  const start = now - duration;
  if (!Number.isFinite(duration) || end < start) return [];

  const metric = getMetric(key);
  const current = pool.values[key];
  const step = duration / 48;
  const intervals = Math.min(48, Math.floor((end - start) / step));
  const stale = getPoolStatus(pool, now) === 'stale';
  const amplitude = { temperature: 0.65, salinity: 0.8, turbidity: 1.3, ph: 0.09, oxygen: 0.35 }[key];
  const phase = pool.number * 0.71;
  const result: HistoryPoint[] = [];

  for (let distance = intervals; distance >= 0; distance -= 1) {
    const timestamp = end - distance * step;
    const missing = !isValue(current) || (distance > 0 && (distance + pool.number) % 17 === 0) || (stale && distance >= 1 && distance <= 2);
    const value = missing ? null : distance === 0 ? current : rounded(
      Math.max(0, current! + (Math.sin(phase - distance * 0.55) - Math.sin(phase)) * amplitude),
      metric.precision,
    );
    result.push({ timestamp, value });
  }
  return result;
}

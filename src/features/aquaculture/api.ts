import {
  METRICS,
  createDemoSnapshot,
  getHistory,
  getMetric,
} from './data.ts';
import type { DemoSnapshot, Device, HistoryPoint, MetricKey, Pool } from './data.ts';
import { WORKSHOPS, getWorkshop, getWorkshopPools } from './workshops.ts';

export type DataSource = 'demo' | 'api';

type Environment = Record<string, string | undefined>;
const environment = (import.meta as ImportMeta & { env?: Environment }).env;

function parseDataSource(value: string | undefined): DataSource {
  if (!value || value === 'demo') return 'demo';
  if (value === 'api') return 'api';
  throw new Error('VITE_DATA_SOURCE 必须为 demo 或 api');
}

export const DATA_SOURCE = parseDataSource(environment?.VITE_DATA_SOURCE);

export interface AquacultureClientOptions {
  dataSource?: DataSource;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

type JsonObject = Record<string, unknown>;
const knownPoolIds = new Set(WORKSHOPS.flatMap(({ id }) => getWorkshopPools(id).map((pool) => pool.id)));

function invalid(detail: string): never {
  throw new Error(`接口数据格式错误：${detail}`);
}

function object(value: unknown, field: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(`${field} 应为对象`);
  return value as JsonObject;
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) invalid(`${field} 应为数组`);
  return value;
}

function timestamp(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000) {
    invalid(`${field} 应为有效的 Unix 毫秒时间戳`);
  }
  return value;
}

function nullableTimestamp(value: unknown, field: string): number | null {
  return value === null ? null : timestamp(value, field);
}

function measurement(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(`${field} 应为数值或 null`);
  return value;
}

function emptyValues(): Pool['values'] {
  return { temperature: null, salinity: null, turbidity: null, ph: null, oxygen: null };
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('请求已取消', 'AbortError');
}

/** Merge measurements into trusted local geometry; API responses never define pool positions. */
function parseSnapshot(payload: unknown, workshopId: string): DemoSnapshot {
  const data = object(payload, 'data');
  if (data.workshopId !== workshopId) invalid('workshopId 与请求的车间不一致');
  const generatedAt = timestamp(data.generatedAt, 'generatedAt');
  const workshop = getWorkshop(workshopId);
  const layout = getWorkshopPools(workshopId);
  const layoutById = new Map(layout.map((pool) => [pool.id, pool]));
  const deviceDefinitions = new Map(workshop.devices.map((device) => [device.id, device]));
  const receivedDevices = new Map<string, Device>();

  for (const entry of array(data.devices, 'devices')) {
    const device = object(entry, 'devices[]');
    if (typeof device.id !== 'string' || !deviceDefinitions.has(device.id)) invalid('检测机编号不属于当前车间');
    if (receivedDevices.has(device.id)) invalid(`检测机编号 ${device.id} 重复`);
    if (device.status !== 'online' && device.status !== 'offline') invalid(`${device.id}.status 应为 online 或 offline`);
    if (device.lastSeenAt !== undefined) nullableTimestamp(device.lastSeenAt, `${device.id}.lastSeenAt`);
    const activePoolId = device.activePoolId ?? null;
    if (activePoolId !== null && (typeof activePoolId !== 'string' || layoutById.get(activePoolId)?.deviceId !== device.id)) {
      invalid(`${device.id}.activePoolId 不属于该检测机`);
    }
    receivedDevices.set(device.id, {
      ...deviceDefinitions.get(device.id)!,
      poolIds: layout.filter((pool) => pool.deviceId === device.id).map((pool) => pool.id),
      status: device.status,
      activePoolId: activePoolId as string | null,
    });
  }
  // A missing entry is a malformed snapshot, not proof of an offline machine.
  if (receivedDevices.size !== workshop.devices.length) invalid('devices 必须包含当前车间的全部检测机');

  const receivedPools = new Map<string, Pick<Pool, 'values' | 'measuredAt'>>();
  for (const entry of array(data.pools, 'pools')) {
    const pool = object(entry, 'pools[]');
    if (typeof pool.id !== 'string' || !layoutById.has(pool.id)) invalid('池号不属于当前车间');
    if (receivedPools.has(pool.id)) invalid(`池号 ${pool.id} 重复`);
    const definition = layoutById.get(pool.id)!;
    if (pool.deviceId !== definition.deviceId || pool.channel !== definition.channel) {
      invalid(`${pool.id} 的检测机或通道号与池号不一致`);
    }
    const measuredAt = nullableTimestamp(pool.measuredAt, `${pool.id}.measuredAt`);
    const rawValues = object(pool.values, `${pool.id}.values`);
    const values = emptyValues();
    for (const { key } of METRICS) values[key] = measurement(rawValues[key], `${pool.id}.${key}`);
    if (measuredAt === null && METRICS.some(({ key }) => values[key] !== null)) {
      invalid(`${pool.id} 有读数时必须提供采集时间`);
    }
    receivedPools.set(pool.id, { values, measuredAt });
  }

  return {
    workshopId,
    generatedAt,
    devices: workshop.devices.map(({ id }) => receivedDevices.get(id)!),
    pools: layout.map((pool, index) => ({
      ...pool,
      number: index + 1,
      ...(receivedPools.get(pool.id) ?? { values: emptyValues(), measuredAt: null }),
    })),
  };
}

function parseHistory(payload: unknown, poolId: string, key: MetricKey): HistoryPoint[] {
  const data = object(payload, 'data');
  if (data.poolId !== poolId || data.metric !== key) invalid('历史数据的池号或参数与请求不一致');
  if (data.unit !== getMetric(key).unit) invalid('历史数据的单位与接口约定不一致');
  const from = timestamp(data.from, 'from');
  const to = timestamp(data.to, 'to');
  if (from > to) invalid('历史数据起止时间倒置');
  let previous = from;
  return array(data.points, 'points').map((entry) => {
    const point = object(entry, 'points[]');
    const time = timestamp(point.timestamp, 'points[].timestamp');
    if (time < previous || time > to) invalid('历史点必须按时间排序且位于 from / to 范围内');
    previous = time;
    if (!('value' in point)) invalid('points[].value 缺失');
    return { timestamp: time, value: measurement(point.value, 'points[].value') };
  });
}

/** Injectable client keeps transport tests independent of Vite and the actual backend. */
export function createAquacultureClient(options: AquacultureClientOptions = {}) {
  const dataSource = parseDataSource(options.dataSource ?? DATA_SOURCE);
  const baseUrl = (options.baseUrl ?? environment?.VITE_API_BASE_URL ?? '/api').replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('请求超时必须为正数');
  const fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const now = options.now ?? Date.now;

  async function request(path: string, signal?: AbortSignal): Promise<unknown> {
    checkAborted(signal);
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`接口请求失败（HTTP ${response.status}）`);
      let decoded: unknown;
      try {
        decoded = await response.json();
      } catch (error) {
        if (controller.signal.aborted) throw error;
        throw new Error('接口未返回有效 JSON，请检查后端地址和代理配置');
      }
      checkAborted(controller.signal);
      const envelope = object(decoded, '响应');
      if (typeof envelope.code !== 'number') invalid('响应 code 应为数字');
      if (envelope.code !== 0) {
        throw new Error(typeof envelope.message === 'string' && envelope.message ? envelope.message : `接口返回错误（code ${envelope.code}）`);
      }
      return envelope.data;
    } catch (error) {
      checkAborted(signal);
      if (timedOut) throw new Error('接口请求超时，请检查后端服务后重试');
      if (error instanceof TypeError) throw new Error('无法连接后端服务，请检查网络和代理配置');
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  return {
    dataSource,
    async getWorkshopSnapshot(workshopId: string, signal?: AbortSignal): Promise<DemoSnapshot> {
      getWorkshop(workshopId);
      checkAborted(signal);
      if (dataSource === 'demo') return createDemoSnapshot(now(), workshopId);
      return parseSnapshot(await request(`/workshops/${encodeURIComponent(workshopId)}/snapshot`, signal), workshopId);
    },
    async getPoolHistory(pool: Pool, key: MetricKey, hours: number, at: number = now(), signal?: AbortSignal): Promise<HistoryPoint[]> {
      if (!knownPoolIds.has(pool.id)) throw new RangeError(`Unknown pool: ${pool.id}`);
      getMetric(key);
      if (!Number.isFinite(hours) || hours <= 0 || hours > 72) throw new RangeError('历史时间范围应大于 0 且不超过 72 小时');
      timestamp(at, 'now');
      checkAborted(signal);
      if (dataSource === 'demo') return getHistory(pool, key, hours, at);
      const query = new URLSearchParams({ metric: key, hours: String(hours) });
      return parseHistory(await request(`/pools/${encodeURIComponent(pool.id)}/history?${query}`, signal), pool.id, key);
    },
  };
}

const client = createAquacultureClient();
export const getWorkshopSnapshot = client.getWorkshopSnapshot;
export const getPoolHistory = client.getPoolHistory;

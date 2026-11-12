<script setup lang="ts">
import { computed } from 'vue';
import { type Pool, type Device, type MetricKey, getPoolStatus, getMetric, formatMetric } from './data';
import type { WorkshopDefinition } from './workshops';

const props = defineProps<{
  workshop: WorkshopDefinition;
  pools: Pool[];
  devices: Device[];
  selectedPoolId: string;
  selectedDeviceId: string;
  selectionMode: 'pool' | 'device';
  metricKey: MetricKey | 'status';
  now: number;
}>();
const emit = defineEmits<{ selectPool: [id: string]; selectDevice: [id: string] }>();
const statusLabels = { normal: '正常', warning: '超限', stale: '待更新', empty: '无数据' };
const metric = computed(() => props.metricKey === 'status' ? null : getMetric(props.metricKey));
const deviceColors = computed(() => new Map(props.devices.map(device => [device.id, device.color])));
// The circle center is the PDF's large positioning circle, in the same
// normalized coordinate system as the pool rectangles. Only its label is offset.
const deviceMarkers = computed(() => props.devices.flatMap(device => {
  const point = props.workshop.mapDevices.find(point => point.id === device.id);
  if (!point) return [];
  const label = device.id === 'S1' ? { x: 12, y: 14 }
    : device.id === 'S2' || device.id === 'B1' || /^[AC]/.test(device.id) ? { x: 12, y: -30 }
    : { x: 13, y: -11 };
  return [{ ...device, x: point.x, y: point.y, label }];
}));
const compactRegions = computed(() => props.devices.flatMap(device => {
  const pools = props.pools.filter(pool => pool.deviceId === device.id);
  if (!pools.length || pools.every(pool => pool.width >= 34)) return [];
  return [{ id: device.id, color: device.color, x: Math.min(...pools.map(pool => pool.x)), y: Math.min(...pools.map(pool => pool.y)) - 18 }];
}));
const footprint = computed(() => {
  if (!props.pools.length) return { x: 35, y: 95, width: 1030, height: 550 };
  const left = Math.min(...props.pools.map(pool => pool.x));
  const top = Math.min(...props.pools.map(pool => pool.y));
  return {
    x: left - 12, y: top - 12,
    width: Math.max(...props.pools.map(pool => pool.x + pool.width)) - left + 24,
    height: Math.max(...props.pools.map(pool => pool.y + pool.height)) - top + 24,
  };
});
function status(pool: Pool) { return getPoolStatus(pool, props.now); }
function isGrouped(pool: Pool) { return props.selectionMode === 'device' && pool.deviceId === props.selectedDeviceId; }
function poolLabel(pool: Pool) {
  const state = statusLabels[status(pool)];
  const base = `养殖池 ${pool.id}，通道 ${String(pool.channel).padStart(2, '0')}，${state}，所属检测机 ${pool.deviceId}`;
  if (props.metricKey === 'status') return base;
  const config = getMetric(props.metricKey);
  const value = pool.values[props.metricKey];
  const reading = value === null || !Number.isFinite(value) ? '无数据' : `${formatMetric(value, props.metricKey)} ${config.unit}`;
  return `${base}，${config.label} ${reading}`;
}
function deviceLabel(device: Device) {
  return `检测机 ${device.id}，${device.status === 'online' ? '在线' : '离线'}，${device.region}，负责 ${device.poolIds.length} 个池，图示定位点，点击定位整组`;
}
function metricValue(pool: Pool) {
  return props.metricKey === 'status' ? statusLabels[status(pool)] : formatMetric(pool.values[props.metricKey], props.metricKey);
}
function numberSize(pool: Pool) { return pool.width < 34 ? 12 : Math.min(16, Math.max(10, pool.width / 3.4)); }
function readingSize(pool: Pool) { return Math.min(13, Math.max(9, pool.width / 4)); }
</script>

<template>
  <div class="pool-map">
    <svg class="map-canvas" :class="{ 'has-device-selection': selectionMode === 'device' }" viewBox="0 0 1100 744" preserveAspectRatio="xMidYMid meet" role="group"
      :aria-label="`${workshop.title}养殖池二维分布图，共${pools.length}池、${devices.length}台检测机，池位与编号依据图纸第${workshop.drawingPage}页`">
      <rect x="15" y="12" width="1070" height="720" class="map-surface" />
      <g class="map-heading" aria-hidden="true">
        <text x="38" y="44">养殖池分布</text>
        <text x="1060" y="44" text-anchor="end" class="map-subheading">图纸 {{ String(workshop.drawingPage).padStart(2, '0') }} / 05 · {{ pools.length }} 池 · {{ devices.length }} 台检测机</text>
        <line x1="38" y1="61" x2="1060" y2="61" />
        <text x="38" y="84" class="map-subheading">{{ workshop.shortName }} · 池位按图纸平面排列</text>
        <text x="1060" y="84" text-anchor="end" class="view-label">{{ metric ? `${metric.label}${metric.unit ? ' / ' + metric.unit : ''}` : '综合状态' }}</text>
      </g>
      <rect class="building-border" :x="footprint.x" :y="footprint.y" :width="footprint.width" :height="footprint.height" />
      <g class="compact-region-labels" aria-hidden="true"><text v-for="region in compactRegions" :key="region.id" :x="region.x" :y="region.y" :style="{ '--region-color': region.color }">{{ region.id }} 检测机分区</text></g>
      <g class="pools">
        <g v-for="pool in pools" :key="`${workshop.id}-${pool.id}`" class="pool-control"
          :class="[`pool-${status(pool)}`, { 'is-selected': pool.id === selectedPoolId, 'is-grouped': isGrouped(pool), 'compact-pool': pool.width < 34 }]"
          :transform="`translate(${pool.x},${pool.y})`"
          :style="{ '--region-color': deviceColors.get(pool.deviceId) }"
          role="button" tabindex="0" :aria-label="poolLabel(pool)" :aria-pressed="pool.id === selectedPoolId"
          :data-testid="`pool-${pool.id}`" :data-device-id="pool.deviceId" :data-channel="pool.channel"
          :data-row="pool.row" :data-position="pool.position" :data-map-column="pool.row" :data-map-position="pool.position"
          @click="emit('selectPool', pool.id)" @keydown.enter.prevent="emit('selectPool', pool.id)" @keydown.space.prevent="emit('selectPool', pool.id)">
          <title>{{ poolLabel(pool) }}</title>
          <rect class="pool-group-outline" x="-2" y="-2" :width="pool.width + 4" :height="pool.height + 4" rx="2" />
          <rect class="pool-selection-outline" x="-4" y="-4" :width="pool.width + 8" :height="pool.height + 8" rx="3" />
          <rect class="pool-body" :width="pool.width" :height="pool.height" rx="1" />
          <circle class="pool-indicator" :cx="pool.width - 5" cy="6" :r="pool.width < 44 ? 1.8 : 2.5" />
          <text class="pool-number" :x="pool.width / 2" :y="pool.width < 34 && metricKey === 'status' ? pool.height / 2 + 4 : pool.height / 2 - 5" text-anchor="middle" :style="{ fontSize: numberSize(pool) + 'px' }">{{ pool.width < 34 ? String(pool.channel).padStart(2, '0') : pool.id }}</text>
          <text v-if="pool.width >= 34 || metricKey !== 'status'" class="pool-reading" :class="{ 'status-reading': metricKey === 'status' }" :x="pool.width / 2" :y="pool.height / 2 + 12" text-anchor="middle" :style="{ fontSize: readingSize(pool) + 'px' }">{{ metricValue(pool) }}</text>
        </g>
      </g>
      <g class="device-markers">
        <g v-for="device in deviceMarkers" :key="device.id" class="device-control"
          :class="{ 'is-selected': selectionMode === 'device' && selectedDeviceId === device.id, 'is-offline': device.status === 'offline' }"
          :transform="`translate(${device.x},${device.y})`" :style="{ '--region-color': device.color }"
          role="button" tabindex="0" :aria-label="deviceLabel(device)" :aria-pressed="selectionMode === 'device' && selectedDeviceId === device.id"
          :data-testid="`device-${device.id}`" :data-device-id="device.id" :data-region="device.region" :data-pool-count="device.poolIds.length" :data-map-x="device.x" :data-map-y="device.y"
          @click="emit('selectDevice', device.id)" @keydown.enter.prevent="emit('selectDevice', device.id)" @keydown.space.prevent="emit('selectDevice', device.id)">
          <title>{{ deviceLabel(device) }}</title>
          <circle class="device-hit-area" r="18" />
          <circle class="device-halo" r="13" />
          <circle class="device-body" r="7.5" />
          <rect class="device-icon" x="-2.8" y="-3.5" width="5.6" height="7" rx=".6" />
          <path class="device-icon" d="M -1 -1 H 1 M -1 1.2 H 1" />
          <rect class="device-label-bg" :x="device.label.x" :y="device.label.y" width="32" height="22" rx="3" />
          <text class="device-number" :x="device.label.x + 16" :y="device.label.y + 15.5" text-anchor="middle">{{ device.id }}</text>
        </g>
      </g>
      <text class="map-footnote" x="550" y="726" text-anchor="middle">检测机圆心按图纸定位点 · 点击检测机高亮关联池位</text>
    </svg>
  </div>
</template>

<style scoped>
.pool-map { width: 100%; height: 100%; min-height: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.map-canvas { display: block; width: 100%; height: 100%; max-height: 100%; font-family: 'DIN Alternate', 'Bahnschrift', 'PingFang SC', 'Microsoft YaHei', sans-serif; user-select: none; }
.map-surface { fill: #061525; fill-opacity: .78; }
.map-heading { fill: #c0e0ee; font-size: 17px; font-weight: 600; }
.map-heading line { stroke: #24475f; stroke-width: 1; }
.map-subheading { fill: #779bb5; font-size: 12px; font-weight: 400; }
.view-label { fill: #9fc9df; font-size: 12px; font-weight: 500; }
.building-border { fill: none; stroke: #2b536e; stroke-width: 1; }
.pool-control { cursor: pointer; outline: none; --status-color: #43cdb4; transition: opacity 160ms ease; }
.pool-warning { --status-color: #ffb565; }
.pool-stale { --status-color: #95acc4; }
.pool-empty { --status-color: #8299b1; }
.pool-body { fill: #0a2738; stroke: var(--status-color); stroke-opacity: .6; stroke-width: 1; transition: fill 160ms ease, stroke-opacity 160ms ease, filter 160ms ease; }
.pool-stale .pool-body { fill: #142438; stroke-dasharray: 5 2; }
.pool-empty .pool-body { fill: #101f30; stroke-dasharray: 2 3; }
.pool-control.is-selected .pool-body { stroke-opacity: 1; stroke-width: 1.5; }
/* Region color is introduced only by an explicit machine selection. */
.pool-control.is-grouped .pool-body { fill: color-mix(in srgb, var(--region-color) 42%, #071d2e); stroke: var(--region-color); stroke-opacity: 1; stroke-width: 1.8; }
.pool-control:hover .pool-body { filter: brightness(1.12); }
.has-device-selection .pool-control:not(.is-grouped) { opacity: .46; }
.has-device-selection .pool-control:not(.is-grouped):hover { opacity: .62; }
.pool-group-outline { fill: none; stroke: var(--region-color); stroke-width: 1.5; opacity: 0; }
.pool-control.is-grouped .pool-group-outline { opacity: .9; }
.pool-selection-outline { fill: none; stroke: #d4f5ff; stroke-width: 2; opacity: 0; }
.pool-control.is-selected .pool-selection-outline, .pool-control:focus-visible .pool-selection-outline { opacity: 1; }
.pool-number { fill: #d8eaf3; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -.3px; }
.pool-control.is-grouped .pool-number { fill: #f0f8ff; }
.pool-reading { fill: var(--status-color); font-weight: 500; font-variant-numeric: tabular-nums; }
.pool-reading.status-reading { font-weight: 400; }
.pool-indicator { fill: var(--status-color); }
.compact-pool .pool-number { letter-spacing: 0; }
.compact-region-labels { font-size: 12px; font-weight: 500; fill: #9ab6cb; }
.device-control { cursor: pointer; outline: none; --marker-color: color-mix(in srgb, var(--region-color) 72%, #d6f1ff); }
.device-hit-area { fill: transparent; stroke: transparent; pointer-events: all; }
.device-halo { fill: #081b2b; fill-opacity: .72; stroke: var(--marker-color); stroke-opacity: .26; stroke-width: 1; transition: fill 160ms ease, stroke-opacity 160ms ease; }
.device-body { fill: #0c2539; stroke: var(--marker-color); stroke-width: 2; }
.device-icon { fill: none; stroke: #dceef9; stroke-width: 1; stroke-linecap: round; }
.device-label-bg { fill: #091e31; fill-opacity: .96; stroke: var(--marker-color); stroke-opacity: .65; stroke-width: .9; }
.device-number { fill: #d9edfa; font-size: 14px; font-weight: 600; }
.device-control.is-selected .device-halo { fill: var(--region-color); fill-opacity: .27; stroke-opacity: .9; stroke-width: 1.5; }
.device-control.is-selected .device-body { fill: var(--region-color); stroke: #d4f5ff; stroke-width: 1.5; }
.device-control.is-selected .device-label-bg { fill: color-mix(in srgb, var(--region-color) 38%, #071d2e); stroke-opacity: 1; stroke-width: 1.2; }
.device-control.is-selected .device-number { fill: #f2faff; }
.device-control:hover .device-halo { stroke-opacity: .9; }
.device-control:hover .device-body { filter: brightness(1.15); }
.device-control:focus-visible .device-hit-area { stroke: #d4f5ff; stroke-width: 1.5; }
.device-control.is-offline .device-body { stroke: #8297aa; stroke-dasharray: 2 2; }
.map-footnote { fill: #6f91ab; font-size: 11px; }
@media (prefers-reduced-motion: reduce) { .pool-control, .pool-body, .device-halo { transition: none; } }
</style>

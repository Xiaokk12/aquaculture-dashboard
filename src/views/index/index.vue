<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { WORKSHOPS, getWorkshop, DEFAULT_WORKSHOP_ID } from "@/features/aquaculture/workshops";
import ItemWrap from "@/components/item-wrap";
import PoolMap from "@/features/aquaculture/PoolMap.vue";
import HistoryChart from "@/features/aquaculture/HistoryChart.vue";
import { METRICS, formatMetric, getAlerts, getMetric, getPoolStatus } from "@/features/aquaculture/data";
import { DATA_SOURCE, getWorkshopSnapshot } from "@/features/aquaculture/api";
import type { Alert, DemoSnapshot, MetricKey, Pool, PoolStatus } from "@/features/aquaculture/data";

const route = useRoute();
const router = useRouter();
const initialWorkshopId = typeof route.query.workshop === "string" && WORKSHOPS.some(item => item.id === route.query.workshop) ? route.query.workshop : DEFAULT_WORKSHOP_ID;
const activeWorkshopId = ref(initialWorkshopId);
const workshop = computed(() => getWorkshop(activeWorkshopId.value));
const snapshot = ref<DemoSnapshot | null>(null);
const loading = ref(false);
const loadError = ref("");
const lastLoadedAt = ref<number | null>(null);
let snapshotController: AbortController | undefined;
let snapshotRequest = 0;
let refreshTimer: ReturnType<typeof setInterval>;
const deviceAllocation = computed(() => (snapshot.value?.devices ?? []).map(device => `${device.id} ${device.poolIds.length} 池`).join(" · "));
const searchExample = computed(() => `${workshop.value.devices[0].id}-08`);
const now = ref(Date.now());
const selectedPoolId = ref("");
const selectedDeviceId = ref("");
const selectionMode = ref<"pool" | "device">("pool");
const activeMetric = ref<MetricKey>("oxygen");
const mapMetric = ref<MetricKey | "status">("status");
const historyHours = ref(24);
const alertFilter = ref<"all" | "water" | "device">("all");
const poolQuery = ref("");
const searchNotice = ref("");
let clockTimer: ReturnType<typeof setInterval>;
const statusNames: Record<PoolStatus, string> = { normal: "水质正常", warning: "水质超限", stale: "数据过期", empty: "暂无数据" };
const statusColors: Record<PoolStatus, string> = { normal: "#43cdb4", warning: "#ffb565", stale: "#91a8bc", empty: "#6e8ca8" };
const states: PoolStatus[] = ["normal", "warning", "stale", "empty"];

const selectedPool = computed(() => snapshot.value?.pools.find(pool => pool.id === selectedPoolId.value)!);
const selectedDevice = computed(() => snapshot.value?.devices.find(device => device.id === selectedDeviceId.value)!);
const selectedStatus = computed(() => getPoolStatus(selectedPool.value, now.value));
const groupPools = computed(() => (snapshot.value?.pools ?? []).filter(pool => pool.deviceId === selectedDeviceId.value));
const statusCounts = computed(() => {
  const counts = { normal: 0, warning: 0, stale: 0, empty: 0 };
  snapshot.value?.pools.forEach(pool => { counts[getPoolStatus(pool, now.value)] += 1; });
  return counts;
});
const onlineCount = computed(() => (snapshot.value?.devices ?? []).filter(device => device.status === "online").length);
const deviceSummaries = computed(() => (snapshot.value?.devices ?? []).map(device => {
  const counts = { normal: 0, warning: 0, stale: 0, empty: 0 };
  (snapshot.value?.pools ?? []).filter(pool => pool.deviceId === device.id).forEach(pool => { counts[getPoolStatus(pool, now.value)] += 1; });
  return { ...device, counts };
}));
const alerts = computed(() => snapshot.value ? getAlerts(snapshot.value, now.value) : []);
const visibleAlerts = computed(() => alerts.value.filter(alert => alertFilter.value === "all" || (alertFilter.value === "water" ? alert.kind === "water" : alert.kind !== "water")));
const selectedMetricDefinition = computed(() => getMetric(activeMetric.value));
const selectedReadingIsOld = computed(() => selectedStatus.value === "stale");
const dateTime = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const shortTime = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function sampleTime(value: number | null) { return value === null ? "尚未采集" : dateTime.format(value); }
function ageText(pool: Pool) {
  if (pool.measuredAt === null) return "尚未采集";
  const minutes = Math.max(0, Math.floor((now.value - pool.measuredAt) / 60_000));
  return minutes < 1 ? "刚刚采集" : minutes < 60 ? minutes + " 分钟前" : Math.floor(minutes / 60) + " 小时 " + (minutes % 60) + " 分钟前";
}
function selectPool(id: string) {
  const pool = snapshot.value?.pools.find(item => item.id === id);
  if (!pool) return;
  selectedPoolId.value = id;
  selectedDeviceId.value = pool.deviceId;
  selectionMode.value = "pool";
  searchNotice.value = "";
}
function selectDevice(id: string) {
  const device = snapshot.value?.devices.find(item => item.id === id);
  if (!device) return;
  selectedDeviceId.value = id;
  selectedPoolId.value = device.poolIds.includes(selectedPoolId.value) ? selectedPoolId.value : device.poolIds[0];
  selectionMode.value = "device";
  searchNotice.value = "";
}
function selectAlert(alert: Alert) {
  if (alert.poolId) selectPool(alert.poolId);
  else selectDevice(alert.deviceId);
  if (alert.metric) activeMetric.value = alert.metric;
}
function setMapMetric(key: MetricKey | "status") {
  mapMetric.value = key;
  if (key !== "status") activeMetric.value = key;
}
function applyWorkshop(id: string) {
  if (!WORKSHOPS.some(item => item.id === id)) return;
  snapshotController?.abort();
  snapshotRequest += 1;
  activeWorkshopId.value = id;
  snapshot.value = null;
  lastLoadedAt.value = null;
  loadError.value = "";
  selectedPoolId.value = "";
  selectedDeviceId.value = "";
  selectionMode.value = "pool";
  poolQuery.value = "";
  searchNotice.value = "";
  alertFilter.value = "all";
}
function switchWorkshop(id: string) {
  if (id === activeWorkshopId.value) return;
  applyWorkshop(id);
  router.push({ query: { ...route.query, workshop: id } });
}
watch(() => route.query.workshop, id => {
  const nextId = typeof id === "string" && WORKSHOPS.some(item => item.id === id) ? id : DEFAULT_WORKSHOP_ID;
  if (nextId !== activeWorkshopId.value) applyWorkshop(nextId);
});
function findPool() {
  const match = /^([A-Z]\d)[-－—\s]?(\d{1,2})$/.exec(poolQuery.value.trim().toUpperCase());
  const id = match ? `${match[1]}-${match[2].padStart(2, "0")}` : "";
  const pool = snapshot.value?.pools.find(item => item.id === id);
  if (pool) { selectPool(pool.id); searchNotice.value = "已定位 " + pool.id + " · " + selectedDevice.value.region; }
  else searchNotice.value = `当前车间未找到该池，请输入图中池号，如 ${searchExample.value}`;
}
function resetView() {
  if (!snapshot.value) return;
  selectPool(snapshot.value.pools[0].id); mapMetric.value = "status"; poolQuery.value = "";
}
async function refreshSnapshot() {
  const requestId = ++snapshotRequest;
  const workshopId = activeWorkshopId.value;
  snapshotController?.abort();
  const controller = new AbortController();
  snapshotController = controller;
  loading.value = true;
  loadError.value = "";
  try {
    const result = await getWorkshopSnapshot(workshopId, controller.signal);
    if (requestId !== snapshotRequest) return;
    snapshot.value = result;
    now.value = Date.now();
    lastLoadedAt.value = now.value;
    if (!result.pools.some(pool => pool.id === selectedPoolId.value)) {
      selectedPoolId.value = result.pools[0].id;
    }
    const currentPool = result.pools.find(pool => pool.id === selectedPoolId.value)!;
    selectedDeviceId.value = currentPool.deviceId;
  } catch (error) {
    if (requestId !== snapshotRequest || controller.signal.aborted) return;
    loadError.value = error instanceof Error ? error.message : "数据请求失败";
  } finally {
    if (requestId === snapshotRequest) loading.value = false;
  }
}
watch(activeWorkshopId, () => { void refreshSnapshot(); }, { immediate: true });
function metricState(key: MetricKey) {
  const value = selectedPool.value.values[key];
  if (value === null || !Number.isFinite(value)) return "缺测";
  if (selectedReadingIsOld.value) return "历史值";
  const metric = getMetric(key);
  return value < metric.min || value > metric.max ? "超限" : "正常";
}
onMounted(() => {
  clockTimer = setInterval(() => { now.value = Date.now(); }, 15_000);
  refreshTimer = setInterval(() => { if (!loading.value) void refreshSnapshot(); }, 30_000);
});
onUnmounted(() => {
  snapshotRequest += 1;
  snapshotController?.abort();
  clearInterval(clockTimer);
  clearInterval(refreshTimer);
});
</script>

<template>
  <div class="dashboard-page">
    <nav class="workshop-nav" aria-label="车间页面">
      <button v-for="item in WORKSHOPS" :key="item.id" type="button" :class="{ active: activeWorkshopId === item.id }" :aria-current="activeWorkshopId === item.id ? 'page' : undefined" :data-testid="'workshop-' + item.id" @click="switchWorkshop(item.id)">
        <span class="workshop-nav-index">{{ String(item.drawingPage).padStart(2, '0') }}</span>
        <span class="workshop-nav-copy"><strong>{{ item.shortName }}</strong><small>{{ item.title.split(' ')[0] }}</small></span>
        <span class="workshop-nav-count">{{ item.poolCount }}<small>池</small></span>
      </button>
    </nav>
    <div class="data-status" :class="{ 'data-error': loadError }" :role="loadError ? 'alert' : 'status'" data-testid="snapshot-status" :aria-busy="loading">
      <span v-if="loadError">{{ DATA_SOURCE === 'api' ? '接口读取失败' : '数据加载失败' }}：{{ loadError }}。{{ snapshot ? '当前保留上次成功快照，读数可能已过期。' : '暂未取得数据。' }}30 秒后自动重试。</span>
      <span v-else-if="loading">{{ snapshot ? '正在刷新数据…' : '正在加载车间数据…' }}</span>
      <span v-else>{{ DATA_SOURCE === 'demo' ? '模拟数据' : '后端接口' }} · 最近读取 {{ sampleTime(lastLoadedAt) }} · 每 30 秒自动刷新</span>
      <button v-if="loadError" type="button" class="quiet-button" :disabled="loading" @click="refreshSnapshot">重试</button>
    </div>
    <div v-if="snapshot" class="dashboard" :data-workshop="workshop.id">
    <aside class="left-column">
      <ItemWrap class="panel overview-panel" title="养殖概况">
        <div class="overview-total"><div><span class="muted">当前车间养殖池</span><div class="total-number">{{ snapshot.pools.length }} <small>池</small></div></div><div class="overview-side"><strong>{{ snapshot.devices.length }} <small>台检测机</small></strong><span>按图纸分区配置</span></div></div>
        <div class="distribution-bar" aria-hidden="true"><span v-for="state in states" :key="state" :style="{ width: (statusCounts[state] / snapshot.pools.length * 100) + '%', background: statusColors[state] }"></span></div>
        <div class="status-stats"><div v-for="state in states" :key="state"><span class="stat-label"><i :style="{ background: statusColors[state] }"></i>{{ statusNames[state] }}</span><strong :data-testid="'count-' + state" :style="{ color: statusColors[state] }">{{ statusCounts[state] }}<small>池</small></strong></div></div>
      </ItemWrap>

      <ItemWrap class="panel devices-panel" title="检测机状态">
        <div class="section-caption"><span><i class="dot online"></i>在线 <b>{{ onlineCount }}</b></span><span><i class="dot offline"></i>离线 <b>{{ snapshot.devices.length - onlineCount }}</b></span><span class="muted">点击定位整组池位</span></div>
        <div class="device-grid">
          <button v-for="device in deviceSummaries" :key="device.id" type="button" class="device-tile" :class="{ selected: selectedDeviceId === device.id, offline: device.status === 'offline' }" :style="{ '--device-color': device.color }" :data-testid="'device-list-' + device.id" :aria-pressed="selectedDeviceId === device.id" :aria-label="device.id + '检测机，' + device.region + '，' + (device.status === 'online' ? '在线' : '离线') + '，负责' + device.poolIds.length + '个池，点击定位整组'" @click="selectDevice(device.id)">
            <span class="device-card-heading"><strong :style="{ color: `color-mix(in srgb, ${device.color} 60%, #e3f4ff)` }">{{ device.id }}</strong><b>{{ device.region }}</b><span><i class="dot" :class="device.status"></i>{{ device.status === "online" ? "在线" : "离线" }}</span></span>
            <span class="device-card-range">{{ device.poolIds[0] }} ～ {{ device.poolIds[device.poolIds.length - 1] }} <b>{{ device.poolIds.length }} 池</b></span>
            <span class="device-card-counts"><span v-for="state in states" :key="state"><i :style="{ background: statusColors[state] }"></i>{{ { normal: '正常', warning: '超限', stale: '过期', empty: '无数据' }[state] }} <b>{{ device.counts[state] }}</b></span></span>
          </button>
        </div>
        <div class="subtle-footnote">{{ deviceAllocation }}</div>
      </ItemWrap>

      <ItemWrap class="panel alerts-panel" title="报警与事件">
        <div class="alert-toolbar"><div class="segmented"><button v-for="filter in (['all', 'water', 'device'] as const)" :key="filter" type="button" :class="{ active: alertFilter === filter }" :aria-pressed="alertFilter === filter" @click="alertFilter = filter">{{ { all: "全部", water: "水质", device: "设备 / 数据" }[filter] }}</button></div><span class="event-count">{{ visibleAlerts.length }} 条</span></div>
        <div class="alert-list" data-testid="alert-list">
          <button v-for="alert in visibleAlerts" :key="alert.id" type="button" class="alert-row" :class="'severity-' + alert.severity" :data-testid="'alert-' + alert.id" @click="selectAlert(alert)" :aria-label="alert.title + '，点击定位'">
            <i class="alert-mark">{{ alert.severity === "critical" ? "!" : alert.kind === "water" ? "!" : "·" }}</i>
            <div><strong>{{ alert.title }}</strong><span>{{ alert.deviceId }} · {{ snapshot.devices.find(device => device.id === alert.deviceId)?.region }}<span class="alert-time">{{ shortTime.format(alert.occurredAt) }}</span></span></div>
            <span class="row-arrow" aria-hidden="true">›</span>
          </button>
          <div v-if="visibleAlerts.length === 0" class="empty-alerts">当前无此类事件</div>
        </div>
        <div class="subtle-footnote">点击事件定位 · 水质阈值为演示设置</div>
      </ItemWrap>
    </aside>

    <section class="center-column">
      <ItemWrap class="panel map-panel" title="养殖池平面分布">
        <div class="map-topbar"><div class="workshop-label"><span class="workshop-icon" aria-hidden="true">▤</span><div><strong>{{ workshop.title }}</strong><span>{{ workshop.poolCount }} 池 · {{ snapshot.devices.length }} 台检测机 · 图纸第 {{ workshop.drawingPage }} / 5 页</span></div></div><div class="map-actions"><button type="button" class="quiet-button" @click="resetView" data-testid="reset-view">回到总览</button><button type="button" class="quiet-button" :disabled="loading" @click="refreshSnapshot" data-testid="refresh-snapshot"><span aria-hidden="true">↻</span> {{ loading ? "刷新中…" : "刷新数据" }}</button></div></div>
        <div class="map-controls"><div class="metric-tabs" aria-label="池内显示项目"><button type="button" :class="{ active: mapMetric === 'status' }" :aria-pressed="mapMetric === 'status'" @click="setMapMetric('status')">综合状态</button><button v-for="metric in METRICS" :key="metric.key" type="button" :class="{ active: mapMetric === metric.key }" :aria-pressed="mapMetric === metric.key" :data-testid="'map-metric-' + metric.key" @click="setMapMetric(metric.key)">{{ metric.label }}</button></div><form class="pool-search" @submit.prevent="findPool"><input v-model="poolQuery" aria-label="查找池号" :placeholder="'池号，如 ' + searchExample" maxlength="8" autocomplete="off"/><button type="submit">定位</button></form></div>
        <p class="drawing-note" :class="{ 'needs-confirmation': workshop.id === 'abalone-first' }">{{ workshop.note }}</p>
        <div class="map-legend"><span v-for="state in states" :key="state"><i :style="{ background: statusColors[state] }"></i>{{ statusNames[state] }}</span><span class="legend-selection"><i></i>当前选中</span></div>
        <div class="map-content"><PoolMap :workshop="workshop" :pools="snapshot.pools" :devices="snapshot.devices" :selected-pool-id="selectedPoolId" :selected-device-id="selectedDeviceId" :selection-mode="selectionMode" :metric-key="mapMetric" :now="now" @select-pool="selectPool" @select-device="selectDevice" /></div>
        <div class="map-selection" data-testid="map-selection"><div class="selection-icon" aria-hidden="true">⌖</div><div><span class="muted">{{ selectionMode === "pool" ? "当前选中养殖池" : "当前选中检测机" }}</span><strong>{{ selectionMode === "pool" ? selectedPool.id : selectedDevice.id }} <small>{{ selectedDevice.region }}<template v-if="selectionMode === 'pool'"> · 第 {{ String(selectedPool.channel).padStart(2, "0") }} 池</template></small></strong></div><div class="selection-association"><span class="muted">{{ selectionMode === "pool" ? "对应检测机" : `负责池位 · 共 ${selectedDevice.poolIds.length} 池` }}</span><strong>{{ selectionMode === "pool" ? selectedDevice.id : `${selectedDevice.poolIds[0]} ～ ${selectedDevice.poolIds[selectedDevice.poolIds.length - 1]}` }}</strong></div><span class="selection-status" :class="selectionMode === 'device' ? (selectedDevice.status === 'online' ? 'status-normal' : 'status-stale') : 'status-' + selectedStatus">{{ selectionMode === "device" ? (selectedDevice.status === "online" ? "设备在线" : "设备离线") : statusNames[selectedStatus] }}</span></div>
        <div class="map-bottom"><span role="status" class="search-notice">{{ searchNotice || "点击池位查看水质 · 点击检测机定位整组" }}</span><span>分区 / 池号按五区取样管路图</span></div>
      </ItemWrap>
    </section>

    <aside class="right-column">
      <ItemWrap class="panel details-panel" :title="selectionMode === 'device' ? '检测机与单池详情' : '单池水质详情'">
        <div class="selection-panel" data-testid="selection-panel" :data-selected-pool="selectedPool.id" :data-selected-device="selectedDevice.id" :data-selection-mode="selectionMode">
          <div class="pool-detail-heading"><div><span class="pool-detail-number">{{ selectedPool.id }} <small>养殖池</small></span><span class="pool-detail-location">{{ selectedDevice.region }} · {{ selectedDevice.id }} 检测机 · 第 {{ String(selectedPool.channel).padStart(2, "0") }} 池</span></div><span class="quality-badge" :class="'status-' + selectedStatus">{{ statusNames[selectedStatus] }}</span></div>
          <div class="device-association"><span>对应检测机 <b>{{ selectedDevice.id }}</b></span><span :class="{ 'offline-text': selectedDevice.status === 'offline' }"><i class="dot" :class="selectedDevice.status"></i>{{ selectedDevice.status === "online" ? "在线" : "离线" }}</span></div>
          <div class="group-picker"><label for="group-pool-select">同机池位 <small>{{ groupPools.length }} 池</small></label><select id="group-pool-select" v-model="selectedPoolId" @change="selectPool(selectedPoolId)" aria-label="切换同机池位" data-testid="group-pool-select"><option v-for="pool in groupPools" :key="pool.id" :value="pool.id">{{ pool.id }} · {{ statusNames[getPoolStatus(pool, now)] }}</option></select></div>
          <div class="metric-cards">
            <button v-for="metric in METRICS" :key="metric.key" type="button" class="metric-card" :class="{ active: activeMetric === metric.key, wide: metric.key === 'oxygen', 'reading-old': selectedReadingIsOld }" :aria-pressed="activeMetric === metric.key" :data-testid="'metric-' + metric.key" @click="activeMetric = metric.key">
              <div class="metric-card-label"><span><i :style="{ background: metric.color }"></i>{{ metric.label }}</span><small :class="{ exceeded: metricState(metric.key) === '超限' }">{{ metricState(metric.key) }}</small></div>
              <div class="metric-number"><strong :data-testid="'metric-value-' + metric.key">{{ formatMetric(selectedPool.values[metric.key], metric.key) }}</strong><span>{{ metric.unit }}</span><small v-if="metric.key === 'oxygen'" class="trend-hint">查看趋势 →</small></div>
            </button>
          </div>
          <div class="sample-time" :class="{ outdated: selectedReadingIsOld }"><span>{{ selectedReadingIsOld ? "最近历史采集" : "最近采集时间" }}<b>{{ sampleTime(selectedPool.measuredAt) }}</b></span><strong>{{ ageText(selectedPool) }}</strong></div>
          <p class="details-note">{{ selectedReadingIsOld ? "该池数据已过期，以上为历史读数。" : selectedStatus === "empty" ? "该池暂无测量数据，待设备采集后更新。" : "点击参数卡片，查看下方对应历史曲线。" }}</p>
        </div>
      </ItemWrap>

      <ItemWrap class="panel history-panel" title="水质变化趋势">
        <div class="history-heading"><span>{{ selectedPool.id }}<b :style="{ color: selectedMetricDefinition.color }">{{ selectedMetricDefinition.label }}</b></span><div class="segmented"><button v-for="hours in [6, 24, 72]" :key="hours" type="button" :aria-pressed="historyHours === hours" :class="{ active: historyHours === hours }" @click="historyHours = hours">{{ hours }}h</button></div></div>
        <div class="history-content"><HistoryChart :pool="selectedPool" :metric-key="activeMetric" :hours="historyHours" :now="now" :refresh-key="lastLoadedAt ?? undefined" /></div>
        <div class="history-footnote"><span><i :style="{ background: selectedMetricDefinition.color }"></i>{{ selectedMetricDefinition.label }}<template v-if="selectedMetricDefinition.unit"> / {{ selectedMetricDefinition.unit }}</template></span><span>{{ DATA_SOURCE === "demo" ? "模拟历史" : "接口历史" }} · 缺测保留断点</span></div>
        <p class="threshold-notice">阈值与单位为演示配置，需按现场要求确认。</p>
      </ItemWrap>
    </aside>
  </div>
  <div v-else class="snapshot-placeholder" data-testid="snapshot-empty">
    <strong>{{ loading ? '正在加载 ' + workshop.shortName : '车间数据暂不可用' }}</strong>
    <span>{{ loading ? '请稍候' : '请检查后端服务与接口配置后重试' }}</span>
  </div>
  </div>
</template>

<style scoped>
.dashboard-page { display: flex; flex-direction: column; gap: 16px; height: 100%; min-height: 0; }
.data-status { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 24px; color: #8aadc4; font-size: 11px; line-height: 1.6; flex-shrink: 0; }
.data-error { color: #efbe76; background: #d79a2510; border: 1px solid #ffb65d40; padding: 8px 12px; border-radius: 4px; }
.snapshot-placeholder { display: flex; flex: 1; min-height: 280px; flex-direction: column; align-items: center; justify-content: center; gap: 16px; color: #8aadc4; border: 1px solid #23455f; background: #0b1c2f; }
.snapshot-placeholder strong { font-size: 18px; font-weight: 500; }
button:disabled { cursor: wait; opacity: .6; }
.workshop-nav { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; flex-shrink: 0; }
.workshop-nav button { display: flex; align-items: center; gap: 10px; padding: 12px 14px; min-width: 0; text-align: left; border: 1px solid #23455f; border-radius: 5px; background: #0b1c2f; color: #8faec5; }
.workshop-nav button.active { background: #12344b; border-color: #3a9ac2; color: #dbf4ff; box-shadow: inset 0 2px #42c7e6; }
.workshop-nav button:hover { border-color: #45a4c9; background: #102b41; }
.workshop-nav-index { font-size: 13px; font-variant-numeric: tabular-nums; opacity: .65; }
.workshop-nav-copy { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.workshop-nav-copy strong { font-size: 14px; font-weight: 600; white-space: nowrap; }
.workshop-nav-copy small { font-size: 10px; opacity: .75; }
.workshop-nav-count { margin-left: auto; font-size: 25px; font-weight: 500; font-variant-numeric: tabular-nums; white-space: nowrap; }
.workshop-nav-count small { font-size: 11px; margin-left: 3px; font-weight: 400; }
.drawing-note { color: #7b9db7; font-size: 10px; line-height: 1.6; margin: 10px 7px 0; }
.drawing-note.needs-confirmation { color: #e5b26c; }
@media (max-width: 1150px) { .dashboard-page { height: auto; } .workshop-nav { grid-template-columns: repeat(3,minmax(0,1fr)); } }
@media (max-width: 650px) { .workshop-nav { grid-template-columns: repeat(2,minmax(0,1fr)); gap: 7px; } .workshop-nav button { padding: 10px; gap: 7px; } .workshop-nav-copy strong { font-size: 12px; white-space: normal; } .workshop-nav-index { display: none; } .workshop-nav-count { font-size: 22px; } }

.dashboard { display: grid; grid-template-columns: 300px minmax(0, 1fr) 340px; gap: 16px; flex: 1; height: auto; min-height: 0; }
.left-column, .right-column, .center-column { min-width: 0; min-height: 0; }
.left-column { display: grid; grid-template-rows: 205px 415px minmax(190px, 1fr); gap: 14px; }
.right-column { display: grid; grid-template-rows: 560px minmax(300px, 1fr); gap: 14px; }
.center-column { display: flex; }
.panel { background: linear-gradient(155deg, #0e1d2e99, #07101fbb); min-width: 0; min-height: 0; }
.panel :deep(.dv-border-box-content) { padding: 5px 15px 12px; display: flex; flex-direction: column; }
.panel :deep(.item_title) { flex-shrink: 0; height: 37px; line-height: 37px; font-size: 14px; }
.panel :deep(.title-inner) { font-weight: 600; letter-spacing: 2px; }
.panel :deep(.zuo), .panel :deep(.you) { width: 32px; background-size: auto 14px; opacity: .75; }
.panel :deep(.item_title_content) { flex: 1; height: auto; min-height: 0; display: flex; flex-direction: column; }
button { cursor: pointer; transition: border-color .15s, background .15s, color .15s; }
button:focus-visible, input:focus-visible { outline: 2px solid #8be7ff; outline-offset: 3px; }
.muted { color: #7c9ab3; font-size: 11px; }
.overview-total { display: flex; justify-content: space-between; align-items: center; padding: 6px 0 10px; }
.total-number { font-size: 42px; color: #e0f4ff; line-height: 1.15; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: 1px; }
.total-number small { font-size: 12px; color: #779cb4; font-weight: 400; }
.overview-side { display: flex; flex-direction: column; gap: 9px; text-align: right; }
.overview-side strong { font-size: 23px; font-weight: 500; color: #69c3e5; }
.overview-side small { font-size: 11px; color: #7c9ab3; }
.overview-side > span { font-size: 10px; color: #6588a1; }
.distribution-bar { display: flex; width: 100%; height: 4px; border-radius: 4px; gap: 3px; margin-bottom: 13px; overflow: hidden; }
.status-stats { display: grid; grid-template-columns: repeat(4, 1fr); }
.status-stats > div { display: flex; flex-direction: column; gap: 6px; }
.stat-label { font-size: 9px; color: #809bb1; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.stat-label i, .map-legend i, .metric-card-label i, .history-footnote i { width: 5px; height: 5px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
.status-stats strong { font-size: 20px; font-weight: 500; font-variant-numeric: tabular-nums; padding-left: 8px; }
.status-stats small { font-size: 9px; margin-left: 4px; font-weight: 400; color: #5f7d94; }
.section-caption { display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #849fb5; margin: 6px 0 12px; }
.section-caption b { font-weight: 500; color: #c0d7e7; margin-left: 4px; }
.dot { width: 5px; height: 5px; display: inline-block; border-radius: 50%; background: #43cdb4; margin-right: 5px; }
.dot.online { background: #43cdb4; }
.dot.offline { background: #70849b; }
.device-grid { display: flex; flex-direction: column; flex: 1; gap: 9px; min-height: 0; }
.device-tile { background: #0b2236; border: 1px solid #203b52; border-left: 3px solid var(--device-color); border-radius: 4px; display: flex; flex-direction: column; justify-content: center; align-items: stretch; gap: 11px; padding: 10px 12px; color: #9fb8cd; flex: 1; min-height: 0; font-size: 11px; text-align: left; }
.device-card-heading { display: flex; align-items: center; gap: 9px; }
.device-card-heading > strong { font-size: 22px; font-weight: 500; letter-spacing: .5px; line-height: 1; }
.device-card-heading > b { font-size: 12px; font-weight: 400; color: #b0ccdf; }
.device-card-heading > span { margin-left: auto; font-size: 10px; color: #7aa4b8; }
.device-card-range { display: flex; justify-content: space-between; gap: 5px; font-size: 10px; color: #7495ae; }
.device-card-range > b { font-weight: 400; color: #9dbed3; }
.device-card-counts { display: flex; justify-content: space-between; gap: 4px; font-size: 9px; color: #7495ae; }
.device-card-counts > span { display: flex; align-items: center; gap: 3px; white-space: nowrap; }
.device-card-counts i { width: 4px; height: 4px; border-radius: 50%; }
.device-card-counts b { font-weight: 500; color: #b4ccdc; }
.device-tile.offline { background: #111f30; border-style: dashed; }
.device-tile.selected { border-color: var(--device-color); background: color-mix(in srgb, var(--device-color) 24%, #0b1c2f); color: #d5f1ff; box-shadow: inset 0 0 20px #28759b16; }
.device-tile:hover { border-color: #4c8caf; }
.subtle-footnote { color: #58778f; font-size: 10px; margin-top: 9px; flex-shrink: 0; }
.alert-toolbar { display: flex; justify-content: space-between; align-items: center; margin: 5px 0 8px; }
.segmented { display: inline-flex; background: #071525; border: 1px solid #1d3b52; border-radius: 4px; padding: 2px; gap: 2px; }
.segmented button { padding: 4px 8px; color: #6b91aa; font-size: 10px; background: transparent; border: 1px solid transparent; border-radius: 2px; white-space: nowrap; }
.segmented button.active { color: #91d9f2; background: #14344c; border-color: #28536e; }
.event-count { color: #647f96; font-size: 10px; }
.alert-list { flex: 1; min-height: 0; overflow: auto; scrollbar-width: thin; scrollbar-color: #274b64 transparent; }
.alert-row { display: flex; align-items: flex-start; gap: 9px; width: 100%; padding: 10px 1px; text-align: left; border: 0; border-bottom: 1px solid #23384a77; background: transparent; }
.alert-row:hover { background: #173b5044; }
.alert-mark { font-style: normal; display: grid; place-items: center; height: 20px; width: 20px; flex-shrink: 0; border: 1px solid #c2904055; background: #a3782517; color: #e2b16f; border-radius: 4px; font-size: 12px; }
.severity-critical .alert-mark { color: #ef987a; border-color: #dd745544; background: #de70541a; }
.severity-info .alert-mark { color: #8babc4; border-color: #577e9b55; background: #35546a33; }
.alert-row > div { flex: 1; min-width: 0; }
.alert-row strong { display: block; color: #bfd0df; font-size: 11px; font-weight: 400; line-height: 1.5; }
.alert-row > div > span { display: block; font-size: 9px; color: #5c819e; margin-top: 3px; }
.alert-time { float: right; font-variant-numeric: tabular-nums; }
.row-arrow { color: #536f87; margin-left: auto; line-height: 20px; }
.empty-alerts { color: #6c8ba2; font-size: 12px; text-align: center; padding: 30px 0; }
.map-panel { width: 100%; height: 100%; }
.map-panel :deep(.item_title) { height: 42px; line-height: 42px; font-size: 16px; }
.map-topbar { display: flex; justify-content: space-between; align-items: center; padding: 9px 5px 18px; }
.workshop-label { display: flex; align-items: center; gap: 9px; }
.workshop-icon { width: 31px; height: 33px; border: 1px solid #295876; border-radius: 4px; background: #0d2b40; color: #6bb8db; text-align: center; line-height: 31px; font-size: 22px; }
.workshop-label strong { color: #c4dfec; font-size: 14px; font-weight: 500; display: block; letter-spacing: 1px; }
.workshop-label div > span { color: #668da7; font-size: 10px; margin-top: 4px; display: block; }
.map-actions { display: flex; gap: 8px; }
.quiet-button { color: #84b5d2; background: #0e2539; border: 1px solid #294d67; border-radius: 4px; padding: 7px 12px; font-size: 11px; white-space: nowrap; }
.quiet-button:hover { border-color: #43a1ce; background: #153950; color: #b6edff; }
.map-controls { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 0 5px; }
.metric-tabs { display: flex; gap: 4px; flex-wrap: wrap; }
.metric-tabs button { padding: 7px 11px; border: 1px solid transparent; background: transparent; color: #6e94ae; font-size: 12px; border-radius: 4px; }
.metric-tabs button.active { color: #7ae3f3; border-color: #226987; background: #0f3549; }
.metric-tabs button:hover { color: #c0e7f5; }
.pool-search { display: flex; border: 1px solid #264961; border-radius: 4px; overflow: hidden; flex-shrink: 0; }
.pool-search input { background: #071828; width: 112px; min-width: 0; padding: 7px 8px; font-size: 10px; color: #ceeaf9; border: 0; outline-offset: -2px; }
.pool-search input::placeholder { color: #4e738e; }
.pool-search button { color: #79c6e3; background: #12314a; border: 0; border-left: 1px solid #264961; padding: 0 9px; font-size: 10px; }
.map-legend { display: flex; gap: 17px; align-items: center; padding: 17px 7px 7px; color: #7898ae; font-size: 10px; }
.map-legend > span { display: flex; align-items: center; gap: 5px; }
.map-legend .legend-selection { margin-left: auto; color: #a1bfce; }
.legend-selection i { border: 1px solid #d7f4ff; background: transparent; border-radius: 2px; width: 7px; height: 7px; }
.map-content { flex: 1; min-height: 0; }
.map-selection { display: flex; align-items: center; padding: 14px 16px; margin: 8px 6px 0; border: 1px solid #224961; background: linear-gradient(100deg, #10354c99, #0a1e32aa); border-radius: 5px; gap: 14px; flex-shrink: 0; }
.selection-icon { font-size: 30px; color: #57d1ed; }
.map-selection strong { font-weight: 500; color: #cae9f5; font-size: 17px; display: block; margin-top: 4px; letter-spacing: .5px; }
.map-selection strong small { color: #7fa2ba; font-size: 10px; margin-left: 8px; font-weight: 400; }
.selection-association { padding-left: 28px; border-left: 1px solid #2b4a61; margin-left: auto; }
.selection-association strong { font-size: 12px; }
.selection-status { border: 1px solid currentColor; padding: 5px 7px; font-size: 10px; border-radius: 4px; margin-left: 12px; white-space: nowrap; }
.status-normal { color: #43cdb4; }
.status-warning { color: #ffb565; }
.status-stale { color: #91a8bc; }
.status-empty { color: #6e8ca8; }
.map-bottom { display: flex; justify-content: space-between; gap: 10px; padding: 12px 8px 0; font-size: 10px; color: #52728b; flex-shrink: 0; }
.search-notice { color: #7c9fb9; }
.selection-panel { display: flex; flex-direction: column; min-height: 0; height: 100%; }
.pool-detail-heading { display: flex; align-items: center; justify-content: space-between; margin: 9px 0 13px; }
.pool-detail-number { font-size: 26px; color: #d1edfa; font-weight: 600; letter-spacing: .5px; }
.pool-detail-number small { font-size: 11px; color: #8aa7bd; font-weight: 400; margin-left: 4px; letter-spacing: 0; }
.pool-detail-location { display: block; font-size: 10px; color: #5f89a4; margin-top: 5px; }
.quality-badge { border: 1px solid currentColor; background: #16453820; padding: 5px 8px; border-radius: 3px; font-size: 10px; white-space: nowrap; }
.device-association { display: flex; align-items: center; justify-content: space-between; padding-bottom: 13px; border-bottom: 1px solid #223f56; color: #658ba5; font-size: 11px; }
.device-association b { font-weight: 500; color: #9ac5de; margin-left: 9px; letter-spacing: 1px; }
.device-association .offline-text { color: #96a6b5; }
.group-picker { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 12px 0; font-size: 10px; color: #6e91aa; }
.group-picker label { white-space: nowrap; }
.group-picker small { color: #557b96; margin-left: 4px; font-size: 9px; }
.group-picker select { color: #add5e9; background: #0d2337; border: 1px solid #2b536d; border-radius: 3px; padding: 6px 7px; font-size: 10px; min-width: 0; max-width: 65%; cursor: pointer; }
.group-picker select:focus-visible { outline: 2px solid #8be7ff; }
.metric-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
.metric-card { text-align: left; padding: 12px 12px 10px; border: 1px solid #243f56; border-radius: 4px; background: linear-gradient(135deg, #112c4099, #0a1c2c88); min-width: 0; }
.metric-card.active { border-color: #3b8eb8; background: linear-gradient(135deg, #153e5799, #0d253899); box-shadow: inset 0 2px 0 #399ac1; }
.metric-card:hover { border-color: #549cc1; }
.metric-card.wide { grid-column: 1 / -1; }
.metric-card-label { display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: #97b4c8; }
.metric-card-label > span { display: inline-flex; align-items: center; gap: 5px; }
.metric-card-label small { font-size: 9px; color: #618a9d; }
.metric-card-label small.exceeded { color: #ffb565; }
.metric-number { margin-top: 10px; display: flex; align-items: baseline; gap: 5px; }
.metric-number strong { font-size: 27px; font-weight: 500; color: #d4eaf6; line-height: 1.05; font-variant-numeric: tabular-nums; letter-spacing: .5px; }
.metric-number > span { color: #5d8da5; font-size: 11px; }
.trend-hint { margin-left: auto; font-size: 10px; color: #5997b8; }
.reading-old .metric-number strong { color: #8d9eb1; }
.sample-time { padding-top: 15px; display: flex; align-items: center; justify-content: space-between; font-size: 10px; color: #6489a3; gap: 8px; margin-top: auto; }
.sample-time b { display: block; margin-top: 5px; font-size: 11px; font-weight: 400; color: #9ebacc; font-variant-numeric: tabular-nums; }
.sample-time > strong { font-weight: 400; white-space: nowrap; }
.sample-time.outdated, .sample-time.outdated b { color: #b5a179; }
.details-note { font-size: 10px; color: #5d8099; margin-top: 7px; line-height: 1.5; }
.history-heading { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #a5c6d9; margin: 7px 0 5px; }
.history-heading b { font-size: 11px; font-weight: 400; margin-left: 10px; }
.history-content { flex: 1; min-height: 140px; }
.history-footnote { display: flex; justify-content: space-between; align-items: center; font-size: 9px; color: #6487a2; margin-top: 5px; }
.history-footnote > span:first-child { display: flex; align-items: center; gap: 5px; }
.threshold-notice { font-size: 9px; color: #796f5b; border-top: 1px solid #27425777; padding-top: 10px; margin-top: 10px; line-height: 1.6; }
@media (min-width: 1900px) { .dashboard { grid-template-columns: 320px minmax(0, 1fr) 360px; gap: 18px; } .left-column { grid-template-rows: 205px 430px minmax(190px, 1fr); } .metric-tabs button { padding: 8px 14px; } .device-tile, .alert-row strong { font-size: 12px; } }
@media (max-width: 1500px) and (min-width: 1151px) { .dashboard { grid-template-columns: 250px minmax(0, 1fr) 290px; gap: 10px; } .panel :deep(.dv-border-box-content) { padding-left: 11px; padding-right: 11px; } .left-column { grid-template-rows: 205px 395px minmax(190px, 1fr); gap: 10px; } .right-column { grid-template-rows: 540px minmax(300px, 1fr); gap: 10px; } .metric-card { padding: 10px 9px; } .metric-number strong { font-size: 23px; } .pool-detail-number { font-size: 21px; } .pool-detail-number small { font-size: 10px; } .metric-tabs { gap: 0; } .metric-tabs button { padding: 7px; font-size: 10px; } .pool-search input { width: 92px; font-size: 9px; } .map-actions { gap: 4px; } .quiet-button { padding: 6px 8px; font-size: 10px; } .map-legend { gap: 9px; font-size: 9px; } .stat-label { font-size: 8px; gap: 2px; } .section-caption { font-size: 10px; } .section-caption .muted { font-size: 9px; } .device-tile { padding: 9px 7px; } .device-card-counts { font-size: 8px; gap: 2px; } .segmented button { padding: 4px 6px; } .map-selection { padding: 10px; gap: 9px; } .selection-association { padding-left: 10px; } .map-selection strong small { display: block; margin: 4px 0 0; } .selection-status { margin-left: 0; } .map-bottom { font-size: 9px; } }
@media (max-width: 1150px) {
  .dashboard { grid-template-columns: 1fr 1fr; height: auto; }
  .center-column { grid-column: 1 / -1; grid-row: 1; height: 790px; }
  .left-column { grid-template-rows: 205px 430px 320px; }
  .right-column { grid-template-rows: 560px 421px; }
  .map-content { min-height: 0; }
}
@media (max-width: 650px) {
  .dashboard { grid-template-columns: 1fr; gap: 12px; }
  .center-column { grid-column: 1; height: 650px; }
  .left-column, .right-column { grid-column: 1; }
  .right-column { grid-row: 2; grid-template-rows: 560px 350px; gap: 12px; }
  .left-column { grid-template-rows: 205px 430px 330px; gap: 12px; }
  .map-topbar { padding-bottom: 12px; }
  .map-controls { flex-wrap: wrap; }
  .metric-tabs button { font-size: 10px; padding: 6px 8px; }
  .pool-search { width: 100%; }
  .pool-search input { width: auto; flex: 1; }
  .map-legend { gap: 9px; font-size: 8px; padding-left: 0; padding-right: 0; }
  .map-selection { margin: 6px 0 0; padding: 9px; gap: 8px; }
  .selection-icon { font-size: 24px; }
  .map-selection strong small { display: block; margin: 4px 0 0; }
  .selection-association { padding-left: 9px; }
  .selection-status { margin-left: 0; font-size: 9px; }
  .map-bottom { flex-direction: column; gap: 5px; font-size: 9px; }
  .quiet-button { font-size: 10px; padding: 6px 8px; }
}
</style>

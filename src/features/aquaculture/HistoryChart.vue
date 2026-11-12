<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { DATA_SOURCE, getPoolHistory } from "./api";
import { getMetric } from "./data";
import type { HistoryPoint, MetricKey, Pool } from "./data";

const props = defineProps<{
  pool: Pool;
  metricKey: MetricKey;
  hours: number;
  now: number;
  refreshKey?: number;
}>();

const metric = computed(() => getMetric(props.metricKey));
const points = ref<HistoryPoint[]>([]);
const loading = ref(false);
const error = ref("");
let requestId = 0;
let controller: AbortController | undefined;

async function loadHistory() {
  const currentRequest = ++requestId;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  loading.value = true;
  error.value = "";
  points.value = [];

  try {
    const result = await getPoolHistory(
      props.pool,
      props.metricKey,
      props.hours,
      props.now,
      signal,
    );
    if (currentRequest === requestId && !signal.aborted) points.value = result;
  } catch (cause) {
    if (currentRequest !== requestId || signal.aborted) return;
    error.value = cause instanceof Error ? cause.message : "请检查网络和后端服务后重试";
  } finally {
    if (currentRequest === requestId) loading.value = false;
  }
}

// The clock moves the chart's time axis; only selection or snapshot changes fetch data.
watch(
  [
    () => props.pool.id,
    () => props.metricKey,
    () => props.hours,
    () => props.refreshKey,
    () => props.pool.measuredAt,
  ],
  loadHistory,
  { immediate: true },
);

onBeforeUnmount(() => {
  requestId += 1;
  controller?.abort();
});

const hasMeasurements = computed(() =>
  points.value.some((point) => point.value !== null),
);
const chartLabel = computed(() =>
  `${props.pool.id}号池近${props.hours}小时${metric.value.label}历史曲线，单位${metric.value.unit || '无量纲'}，${DATA_SOURCE === 'demo' ? '模拟数据' : '接口数据'}`,
);

const timeFormat = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const dateTimeFormat = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

type TooltipPoint = {
  data?: [number, number | null];
  value?: [number, number | null];
};

const option = computed(() => {
  const definition = metric.value;
  const lastMeasuredIndex = points.value.findLastIndex((point) => point.value !== null);
  return {
    animationDuration: 300,
    animationDurationUpdate: 240,
    backgroundColor: "transparent",
    textStyle: { fontFamily: '"DIN Alternate", "PingFang SC", sans-serif' },
    grid: { top: 34, right: 16, bottom: 30, left: 49 },
    tooltip: {
      trigger: "axis",
      confine: true,
      backgroundColor: "rgba(7, 21, 39, .97)",
      borderColor: "rgba(84, 174, 224, .45)",
      padding: [10, 12],
      textStyle: { color: "#d9efff", fontSize: 12 },
      axisPointer: {
        type: "line",
        lineStyle: { color: "#7ab7d6", type: "dashed" },
      },
      formatter: (parameters: TooltipPoint | TooltipPoint[]) => {
        const point = Array.isArray(parameters) ? parameters[0] : parameters;
        const value = point?.data ?? point?.value;
        if (!value || typeof value[0] !== "number") return "暂无测量记录";
        const measurement =
          value[1] === null
            ? "暂无数据"
            : `${value[1].toFixed(definition.precision)}${definition.unit ? ` ${definition.unit}` : ""}`;
        return `${dateTimeFormat.format(new Date(value[0]))}<br/>${definition.label}：${measurement}`;
      },
    },
    xAxis: {
      type: "time",
      min: props.now - props.hours * 60 * 60 * 1000,
      max: props.now,
      splitNumber: 3,
      boundaryGap: [0, 0],
      axisLine: { lineStyle: { color: "#244357" } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: {
        color: "#7899b1",
        fontSize: 10,
        hideOverlap: true,
        margin: 12,
        formatter: (value: number) =>
          props.hours > 24
            ? dateTimeFormat.format(new Date(value))
            : timeFormat.format(new Date(value)),
      },
    },
    yAxis: {
      type: "value",
      name: definition.unit || definition.label,
      nameTextStyle: { color: "#7899b1", align: "left", fontSize: 11 },
      nameGap: 16,
      scale: true,
      splitNumber: 3,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: "#7899b1",
        fontSize: 10,
        formatter: (value: number) =>
          Number(value.toFixed(definition.precision)).toString(),
      },
      splitLine: { lineStyle: { color: "rgba(86, 135, 166, .16)", type: "dashed" } },
    },
    series: [
      {
        name: definition.label,
        type: "line",
        data: points.value.map((point) => [point.timestamp, point.value]),
        connectNulls: false,
        smooth: false,
        showSymbol: true,
        showAllSymbol: true,
        symbol: "circle",
        symbolSize: (value: [number, number | null], parameters: { dataIndex: number }) =>
          value[1] !== null && parameters.dataIndex === lastMeasuredIndex ? 6 : 0,
        lineStyle: { color: definition.color, width: 2.5 },
        itemStyle: { color: definition.color, borderColor: "#e1f4ff", borderWidth: 1 },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: `${definition.color}32` },
              { offset: 1, color: `${definition.color}00` },
            ],
          },
        },
        emphasis: { focus: "series" },
      },
    ],
  };
});
</script>

<template>
  <div
    class="history-chart"
    data-testid="history-chart"
    :data-metric="metricKey"
    :data-hours="hours"
    :data-pool="pool.id"
    :data-source="DATA_SOURCE"
    :aria-busy="loading"
    role="group"
    :aria-label="chartLabel"
  >
    <div v-if="loading" class="history-empty" data-testid="history-loading" role="status">
      <strong>正在加载历史数据…</strong>
    </div>
    <div v-else-if="error" class="history-empty" data-testid="history-error" role="alert">
      <strong>历史数据加载失败</strong>
      <span class="history-error-detail">{{ error }}</span>
      <button class="history-retry" type="button" @click="loadHistory">重新加载历史数据</button>
    </div>
    <v-chart v-else-if="hasMeasurements" class="history-canvas" :option="option" role="img" :aria-label="chartLabel" autoresize />
    <div v-else class="history-empty" data-testid="history-empty">
      <svg viewBox="0 0 48 36" aria-hidden="true">
        <path d="M3 3v29h42M8 25l9-8 8 4 8-11 9 4" />
        <circle cx="33" cy="10" r="2" />
      </svg>
      <strong>该时段暂无测量记录</strong>
      <span>选择其他时段或池位查看</span>
    </div>
  </div>
</template>

<style scoped lang="scss">
.history-chart {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 140px;
  overflow: hidden;
}

.history-canvas {
  width: 100%;
  height: 100%;
  min-height: 140px;
}

.history-empty {
  display: flex;
  min-height: 140px;
  height: 100%;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 9px;
  color: #6f8fa7;

  svg {
    width: 44px;
    height: 36px;
    margin-bottom: 3px;
    fill: none;
    stroke: #37617e;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  strong {
    font-size: 13px;
    font-weight: 500;
    color: #9cb6c9;
  }

  span {
    font-size: 11px;
  }
}

.history-error-detail {
  max-width: 88%;
  text-align: center;
  overflow-wrap: anywhere;
}

.history-retry {
  padding: 5px 10px;
  border: 1px solid #37617e;
  border-radius: 3px;
  background: rgba(24, 65, 91, .45);
  color: #b9deef;
  font: inherit;
  font-size: 11px;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    border-color: #62c9ed;
    background: rgba(36, 92, 124, .6);
  }
}
</style>

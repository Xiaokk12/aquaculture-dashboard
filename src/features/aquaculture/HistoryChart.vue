<script setup lang="ts">
import { computed } from "vue";
import { getHistory, getMetric } from "./data";
import type { MetricKey, Pool } from "./data";

const props = defineProps<{
  pool: Pool;
  metricKey: MetricKey;
  hours: number;
  now: number;
}>();

const metric = computed(() => getMetric(props.metricKey));
const points = computed(() =>
  getHistory(props.pool, props.metricKey, props.hours, props.now),
);
const hasMeasurements = computed(() =>
  points.value.some((point) => point.value !== null),
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
    role="img"
    :aria-label="`${pool.id}号池近${hours}小时${metric.label}历史曲线，单位${metric.unit || '无量纲'}，模拟数据`"
  >
    <v-chart v-if="hasMeasurements" class="history-canvas" :option="option" autoresize />
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
</style>

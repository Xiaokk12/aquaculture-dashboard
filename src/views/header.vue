<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { DATA_SOURCE } from "@/features/aquaculture/api";
const clock = ref(Date.now());
const isFullscreen = ref(false);
const fullScreenNotice = ref("");
let timer: ReturnType<typeof setInterval>;
const dateText = computed(() => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).format(clock.value));
const timeText = computed(() => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(clock.value));
function updateFullscreen() { isFullscreen.value = !!document.fullscreenElement; }
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
    fullScreenNotice.value = "";
  } catch { fullScreenNotice.value = "当前浏览器不支持全屏，请使用浏览器的全屏功能"; }
}
onMounted(() => { timer = setInterval(() => { clock.value = Date.now(); }, 1000); document.addEventListener("fullscreenchange", updateFullscreen); updateFullscreen(); });
onUnmounted(() => { clearInterval(timer); document.removeEventListener("fullscreenchange", updateFullscreen); });
</script>

<template>
  <header class="platform-header">
    <div class="header-context">
      <span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M16 3C12 10 5 16 5 22a11 11 0 0 0 22 0C27 16 20 10 16 3Z"/><path d="M10 23c3-4 9 4 13-1"/></svg></span>
      <div><span class="eyebrow">AQUACULTURE MONITORING</span><span class="context-label">养殖环境监测中心</span></div>
    </div>
    <div class="platform-title"><h1>养殖场水质监测平台</h1><span>WATER QUALITY MONITORING</span></div>
    <div class="header-tools">
      <span class="demo-badge" :class="{ 'api-badge': DATA_SOURCE === 'api' }" data-testid="data-source"><i></i>{{ DATA_SOURCE === 'demo' ? '模拟数据' : '后端接口' }}</span>
      <div class="clock"><strong>{{ timeText }}</strong><span>{{ dateText }} · 北京时间</span></div>
      <button class="fullscreen-button" type="button" @click="toggleFullscreen" :aria-label="isFullscreen ? '退出全屏' : '进入全屏'" :title="isFullscreen ? '退出全屏' : '进入全屏'">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg>
      </button>
    </div>
    <span class="fullscreen-notice" role="status">{{ fullScreenNotice }}</span>
  </header>
</template>

<style scoped>
.platform-header { height: 94px; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; position: relative; margin-bottom: 16px; border-bottom: 1px solid #234866; background: url("@/assets/img/top.png") center bottom / 100% 72px no-repeat; }
.header-context, .header-tools { display: flex; align-items: center; gap: 14px; z-index: 1; }
.brand-mark { width: 39px; height: 45px; padding: 7px; color: #41d6ed; border: 1px solid #277d9c; border-radius: 12px 3px 12px 3px; background: #0c293c; }
.brand-mark svg { width: 100%; height: 100%; fill: #26d5ed15; stroke: currentColor; stroke-width: 1.8; }
.eyebrow { display: block; font-size: 9px; letter-spacing: 1.7px; color: #6d98b2; }
.context-label { display: block; margin-top: 5px; font-size: 13px; color: #bad3e6; letter-spacing: 1.2px; }
.platform-title { position: absolute; inset: 16px 30% auto; text-align: center; }
.platform-title h1 { margin: 0; color: #74e5fa; font-size: clamp(22px, 1.9vw, 36px); font-weight: 700; letter-spacing: 5px; text-shadow: 0 0 28px #27b8fd50; white-space: nowrap; }
.platform-title > span { display: block; color: #4d92b4; font-size: 10px; letter-spacing: 4px; margin-top: 8px; }
.demo-badge { display: inline-flex; align-items: center; gap: 6px; padding: 5px 9px; border: 1px solid #ffb65d40; border-radius: 4px; color: #efbe76; font-size: 11px; background: #d79a2510; white-space: nowrap; }
.demo-badge i { width: 5px; height: 5px; border-radius: 50%; background: #efbe76; }
.api-badge { color: #69c3e5; border-color: #3a9ac260; background: #12344b; }
.api-badge i { background: #69c3e5; }
.clock { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
.clock strong { font-size: 21px; font-weight: 500; letter-spacing: 2px; color: #cce6f5; font-variant-numeric: tabular-nums; }
.clock span { font-size: 10px; color: #7294ae; }
.fullscreen-button { width: 32px; height: 32px; display: grid; place-items: center; border: 1px solid #27506d; border-radius: 4px; background: #102137; color: #78b9d8; cursor: pointer; }
.fullscreen-button:hover { border-color: #40c9ee; color: #a4eafa; }
.fullscreen-button svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.5; }
.fullscreen-notice { position: absolute; right: 0; bottom: -12px; font-size: 11px; color: #efbe76; }
@media (max-width: 1400px) { .eyebrow { display: none; } .brand-mark { width: 32px; height: 38px; } .header-context, .header-tools { gap: 9px; } .platform-title h1 { letter-spacing: 3px; } }
@media (max-width: 1150px) { .platform-title { position: static; } .header-context { display: none; } .platform-title h1 { font-size: 24px; } .platform-header { height: 85px; margin-bottom: 12px; } }
@media (max-width: 620px) { .clock { display: none; } .platform-title h1 { font-size: 19px; letter-spacing: 2px; } .platform-title > span { font-size: 8px; letter-spacing: 2px; } .header-tools { gap: 7px; } .demo-badge { font-size: 10px; padding: 4px 6px; } }
</style>

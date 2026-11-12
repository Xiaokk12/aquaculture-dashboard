<script setup lang="ts">
import { RouterView } from "vue-router";
import Headers from "./header.vue";
</script>

<template>
  <div class="aquaculture-app">
    <Headers />
    <main class="app-main"><RouterView /></main>
    <footer class="app-footer">
      <span>水质监测 · 池位定位 · 设备联动</span>
      <span>演示环境 · 未接入现场设备</span>
    </footer>
  </div>
</template>

<style scoped>
.aquaculture-app {
  --aqua-text: #dcecf7;
  --aqua-muted: #7d9ab5;
  --aqua-cyan: #36dcf2;
  --aqua-green: #43dcb4;
  --aqua-orange: #ffb65d;
  min-height: 1100px;
  height: max(100dvh, 1100px);
  display: flex;
  flex-direction: column;
  padding: 0 22px;
  color: var(--aqua-text);
  font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  background: radial-gradient(ellipse at 50% 5%, #10284377, transparent 55%), #050c17;
  background-image: radial-gradient(ellipse at 50% 5%, #10284399, transparent 60%), url("@/assets/img/pageBg.png");
  background-size: cover;
}
.app-main { flex: 1; min-height: 0; }
.app-footer { height: 30px; display: flex; align-items: center; justify-content: space-between; color: #657f98; font-size: 11px; letter-spacing: 1px; flex-shrink: 0; }
@media (max-width: 1150px) {
  .aquaculture-app { min-height: 100dvh; height: auto; padding: 0 14px; }
  .app-main { flex: initial; }
}
@media (max-width: 1500px) and (min-width: 1151px) {
  .aquaculture-app { min-height: 1100px; height: max(100dvh, 1100px); }
}
@media (prefers-reduced-motion: reduce) { .aquaculture-app :deep(*) { animation: none !important; transition: none !important; } }
</style>

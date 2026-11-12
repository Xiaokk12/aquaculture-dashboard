
import type { UserConfig, ConfigEnv } from 'vite';
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from "path";
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
//https://github.com/element-plus/unplugin-element-plus/blob/HEAD/README.zh-CN.md
import ElementPlus from 'unplugin-element-plus/vite'
export default defineConfig(({ mode }: ConfigEnv): UserConfig => {

  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [vue(),
    AutoImport({
      resolvers: [ElementPlusResolver()],
    }),
    Components({
      resolvers: [ElementPlusResolver()],
    }),
    ElementPlus({
      // useSource: true
    })
    ],
    // preview 只核对静态构建；生产环境由 Nginx 提供 /api 转发。
    preview: { proxy: {} },
    publicDir: "public",
    base: "./",
    server: {
      host: '0.0.0.0',
      port: 8112,
      open: false,
      strictPort: false,
      proxy: {
        '/api': {
          target: env.API_PROXY_TARGET || 'http://localhost:8080',
          changeOrigin: true,
        },
      },
    },
    resolve: {
      alias: {
        "@": resolve(__dirname, "./src"),
        "components": resolve(__dirname, "./src/components"),
        "api": resolve(__dirname, "./src/api"),
      },
    },
    css: {
      // css预处理器
      preprocessorOptions: {
        scss: {
          // charset: false,
          additionalData: `@use "@/assets/css/variable.scss" as *;\n`,
        },
      },
    },
    build: {
      outDir: 'dist',
    },
  }

})

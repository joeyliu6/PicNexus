import { defineConfig } from "vite";
import { resolve } from "path";
import { fileURLToPath, URL } from "node:url";
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  // 防止 vite 警告
  clearScreen: false,
   // Tauri 期望固定端口
   server: {
     port: 1420,
     // 必须固定 1420：tauri.conf.json 的 devUrl 硬编码了该端口。
     // 端口被占时宁可直接报错，也不要让 vite 换端口导致 tauri dev 白屏。
     strictPort: true,
     watch: {
       // 告诉 vite 忽略 `src-tauri` 目录的变化
       ignored: ["**/src-tauri/**"],
     },
   },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(fileURLToPath(new URL(".", import.meta.url)), "index.html"),
        'login-webview': resolve(fileURLToPath(new URL(".", import.meta.url)), "login-webview.html"),
        'login-titlebar': resolve(fileURLToPath(new URL(".", import.meta.url)), "login-titlebar.html"),
        'tray-menu': resolve(fileURLToPath(new URL(".", import.meta.url)), "tray-menu.html")
      },
      output: {
        manualChunks: {
          'vendor-vue': ['vue', '@vueuse/core'],
          'vendor-primevue': ['primevue', '@primeuix/themes'],
          'vendor-tauri': [
            '@tauri-apps/api',
            '@tauri-apps/plugin-clipboard-manager',
            '@tauri-apps/plugin-dialog',
            '@tauri-apps/plugin-fs',
            '@tauri-apps/plugin-http',
            '@tauri-apps/plugin-shell',
            '@tauri-apps/plugin-sql'
          ]
        }
      }
    }
  },
});


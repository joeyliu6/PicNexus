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
     strictPort: false,
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
        'login-webview': resolve(fileURLToPath(new URL(".", import.meta.url)), "login-webview.html")
      },
      output: {
        manualChunks: {
          'vendor-vue': ['vue', '@vueuse/core'],
          'vendor-primevue': ['primevue', '@primevue/themes'],
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


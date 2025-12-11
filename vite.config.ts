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
    strictPort: true,
    watch: {
      // 告诉 vite 忽略 `src-tauri` 目录的变化
      ignored: ["**/src-tauri/**"],
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // 修复 AWS SDK 在浏览器中使用 Node.js util 模块的问题
      // 使用自定义 polyfill 替代 Node.js 的 util 模块
      "util": fileURLToPath(new URL("./src/util-polyfill.ts", import.meta.url)),
    },
  },
  build: {
            rollupOptions: {
                input: {
                    main: resolve(fileURLToPath(new URL(".", import.meta.url)), "index.html"),
                    'login-webview': resolve(fileURLToPath(new URL(".", import.meta.url)), "login-webview.html")
                },
            },  },
});


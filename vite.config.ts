import { defineConfig } from "vite";
import { resolve } from "path";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
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
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(fileURLToPath(new URL(".", import.meta.url)), "index.html"),
        settings: resolve(fileURLToPath(new URL(".", import.meta.url)), "src/settings.html"),
        history: resolve(fileURLToPath(new URL(".", import.meta.url)), "src/history.html"),
      },
    },
  },
});


import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

const mock = (name: string) => fileURLToPath(new URL(`./mocks/${name}.ts`, import.meta.url));

export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../../src', import.meta.url)),
      '@tauri-apps/api/core': mock('core'),
      '@tauri-apps/api/event': mock('event'),
      '@tauri-apps/api/path': mock('path'),
      '@tauri-apps/api/window': mock('window'),
      '@tauri-apps/api/webview': mock('webview'),
      '@tauri-apps/api/app': mock('app'),
      '@tauri-apps/plugin-log': mock('log'),
      '@tauri-apps/plugin-fs': mock('fs'),
      '@tauri-apps/plugin-dialog': mock('dialog'),
      '@tauri-apps/plugin-clipboard-manager': mock('clipboard'),
      '@tauri-apps/plugin-shell': mock('shell'),
      '@tauri-apps/plugin-http': mock('http'),
      '@tauri-apps/plugin-global-shortcut': mock('globalShortcut'),
      '@tauri-apps/plugin-notification': mock('notification'),
      '@tauri-apps/plugin-updater': mock('updater'),
      '@tauri-apps/plugin-process': mock('process'),
      '@tauri-apps/plugin-sql': mock('sql'),
    },
  },
  server: {
    strictPort: true,
  },
});

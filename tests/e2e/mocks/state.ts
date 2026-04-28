type E2ECall =
  | { type: 'invoke'; command: string; args?: unknown }
  | { type: 'dialog.open'; options?: unknown }
  | { type: 'dialog.save'; options?: unknown }
  | { type: 'clipboard.readText' }
  | { type: 'clipboard.writeText'; text: string }
  | { type: 'fs.readTextFile'; path: string }
  | { type: 'fs.writeTextFile'; path: string; contents: string }
  | { type: 'event.emit'; event: string; payload?: unknown };

interface E2EState {
  calls: E2ECall[];
  files: Record<string, string>;
  clipboardText: string;
}

declare global {
  var __PICNEXUS_E2E__: E2EState | undefined;
}

export function getState(): E2EState {
  globalThis.__PICNEXUS_E2E__ ??= {
    calls: [],
    files: {
      '/mock/appdata/.settings.dat': JSON.stringify({
        config: {
          enabledServices: ['jd'],
          availableServices: ['jd', 'qiyu'],
          onboardingCompleted: true,
          appBehavior: {
            autoStart: false,
            minimizeToTrayOnStart: false,
            closeToTray: true,
          },
          analytics: { enabled: false },
          autoUpdate: { enabled: false },
          globalShortcut: {
            enabled: false,
            uploadClipboard: 'CommandOrControl+Shift+C',
            uploadFromFile: 'CommandOrControl+Shift+O',
          },
        },
      }),
    },
    clipboardText: '',
  };
  return globalThis.__PICNEXUS_E2E__;
}

export function record(call: E2ECall): void {
  getState().calls.push(call);
}

export function makeUnlisten(): () => void {
  return () => undefined;
}

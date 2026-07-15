import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Window } from 'happy-dom';
import { describe, expect, it, vi } from 'vitest';

interface AnalyticsApi {
  sendBatch: (
    batch: {
      clientId: string;
      events: Array<{
        name: 'first_run' | 'app_start';
        params: {
          appVersion: string;
          osInfo: 'Windows';
          appPlatform: 'tauri_desktop';
        };
      }>;
    },
    requestId: string,
    debugMode: boolean,
  ) => boolean;
}

interface AnalyticsWindow extends Window {
  __PICNEXUS_ANALYTICS__: AnalyticsApi;
  dataLayer: IArguments[];
}

const bootstrapSource = readFileSync(
  resolve(process.cwd(), 'src-tauri/src/analytics/bootstrap.js'),
  'utf8',
);

function createHarness(debugMode = false) {
  const browser = new Window({ url: 'http://127.0.0.1:43210/a/token/' }) as AnalyticsWindow;
  const fetchMock = vi.fn().mockResolvedValue({ ok: true });
  browser.fetch = fetchMock as typeof browser.fetch;
  browser.eval(bootstrapSource);

  const tagScript = browser.document.querySelector<HTMLScriptElement>(
    'script[src^="https://www.googletagmanager.com/"]',
  );
  if (!tagScript) throw new Error('Expected bootstrap to append the Google tag script');
  tagScript.dispatchEvent(new browser.Event('load'));

  const params = {
    appVersion: '1.2.3',
    osInfo: 'Windows' as const,
    appPlatform: 'tauri_desktop' as const,
  };
  const sent = browser.__PICNEXUS_ANALYTICS__.sendBatch({
    clientId: '123456789.1700000000',
    events: [
      { name: 'first_run', params },
      { name: 'app_start', params },
    ],
  }, '0123456789abcdef0123456789abcdef', debugMode);

  return { browser, fetchMock, sent };
}

function findTagCommand(browser: AnalyticsWindow, name: string): unknown[] {
  const command = browser.dataLayer
    .map(args => Array.from(args))
    .find(args => args[0] === name);
  if (!command) throw new Error(`Expected gtag command: ${name}`);
  return command;
}

describe('analytics bootstrap', () => {
  it('uses fixed privacy config and waits for each distinct callback before ack', () => {
    const { browser, fetchMock, sent } = createHarness();

    expect(sent).toBe(true);
    const config = findTagCommand(browser, 'config')[2] as Record<string, unknown>;
    expect(config).toMatchObject({
      client_id: '123456789.1700000000',
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      ignore_referrer: true,
      page_location: 'http://127.0.0.1/analytics',
    });
    expect(config).not.toHaveProperty('debug_mode');

    const events = browser.dataLayer
      .map(args => Array.from(args))
      .filter(args => args[0] === 'event');
    const firstCallback = (events[0][2] as { event_callback: () => void }).event_callback;
    const secondCallback = (events[1][2] as { event_callback: () => void }).event_callback;
    expect(events[0][2]).not.toHaveProperty('engagement_time_msec');
    fetchMock.mockClear();

    firstCallback();
    firstCallback();
    expect(fetchMock).not.toHaveBeenCalled();
    secondCallback();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0].toString()).toContain(
      '/ack/0123456789abcdef0123456789abcdef',
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ body: 'processed' });
  });

  it('adds debug_mode only when Rust enables the verification flag', () => {
    const { browser } = createHarness(true);
    const config = findTagCommand(browser, 'config')[2] as Record<string, unknown>;

    expect(config.debug_mode).toBe(true);
  });
});

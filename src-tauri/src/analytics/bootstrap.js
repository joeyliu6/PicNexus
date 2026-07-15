(() => {
  'use strict';

  const measurementId = 'G-E8LW7TS55J';
  const statusUrl = new URL('./status', window.location.href);
  let isReady = false;
  let hasSentBatch = false;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    window.dataLayer.push(arguments);
  };

  function post(path, body) {
    return fetch(new URL(path, window.location.href), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body,
      cache: 'no-store',
      credentials: 'omit',
      keepalive: true,
    }).catch(() => undefined);
  }

  function sendBatch(batch, requestId, debugMode) {
    if (!isReady || hasSentBatch) return false;
    hasSentBatch = true;

    window.gtag('js', new Date());
    const tagConfig = {
      client_id: batch.clientId,
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      ignore_referrer: true,
      page_location: 'http://127.0.0.1/analytics',
    };
    if (debugMode === true) tagConfig.debug_mode = true;
    window.gtag('config', measurementId, tagConfig);

    const processedEvents = new Set();
    let acknowledged = false;
    const onProcessed = (eventIndex) => {
      if (processedEvents.has(eventIndex) || acknowledged) return;
      processedEvents.add(eventIndex);
      if (processedEvents.size < batch.events.length) return;

      acknowledged = true;
      window[`ga-disable-${measurementId}`] = true;
      void post(`./ack/${encodeURIComponent(requestId)}`, 'processed');
    };

    batch.events.forEach((event, eventIndex) => {
      window.gtag('event', event.name, {
        app_version: event.params.appVersion,
        os_info: event.params.osInfo,
        app_platform: event.params.appPlatform,
        send_to: measurementId,
        event_callback: () => onProcessed(eventIndex),
        event_timeout: 5000,
      });
    });

    return true;
  }

  Object.defineProperty(window, '__PICNEXUS_ANALYTICS__', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({ sendBatch }),
  });

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  script.addEventListener('load', () => {
    isReady = true;
    void post(statusUrl.pathname, 'ready');
  }, { once: true });
  script.addEventListener('error', () => {
    void post(statusUrl.pathname, 'load_failed');
  }, { once: true });
  document.head.appendChild(script);
})();

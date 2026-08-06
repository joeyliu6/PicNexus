(() => {
  'use strict';

  const measurementId = 'G-E8LW7TS55J';
  const statusUrl = new URL('./status', window.location.href);
  let isReady = false;
  let hasSentBatch = false;

  // 用 URL 里的 client_id 种 GA cookie，让 gtag 识别为"老用户"：
  //  - _ga：client_id（区分用户）
  //  - _ga_<container>：会话状态，种一个"过去的会话"，让 gtag 认为有过历史、
  //    非首次来访，从而不再打 _fv=1，避免 GA 每次启动重复记 first_visit
  // 注意：gtag.js 内部的 GS1 格式解析器（反编译得到的函数名 Gq）要求前缀之后
  // 至少有 5 个用 "." 分隔的字段（s=会话开始时间, o=会话序号, g=是否活跃,
  // t=最后活跃时间, j=join 计时器），字段数不够会被判定为"格式不认识"从而
  // 当成没有会话历史，强制标记 is_first_visit，导致 _fv 每次都是 1。
  const cidFromUrl = new URLSearchParams(window.location.search).get('cid');
  if (cidFromUrl) {
    document.cookie = `_ga=GA1.1.${cidFromUrl}; path=/; max-age=63072000; samesite=lax`;
  }
  const pastSessionEpoch = Math.floor(Date.now() / 1000) - 86400;
  document.cookie = `_ga_E8LW7TS55J=GS1.1.${pastSessionEpoch}.1.0.${pastSessionEpoch}.0; path=/; max-age=63072000; samesite=lax`;

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

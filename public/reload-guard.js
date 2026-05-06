(function () {
  var KEY = 'pn_reload_guard';
  var LIMIT_MS = 10000;

  function showFallback() {
    var isDark = document.documentElement.classList.contains('dark-theme');
    var bg = isDark ? '#0f172a' : '#f1f5f9';
    var fg = isDark ? '#f8fafc' : '#0f172a';
    var muted = isDark ? '#94a3b8' : '#64748b';
    var btnBg = isDark ? '#1e293b' : '#ffffff';

    document.body.innerHTML =
      '<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
      'background:' + bg + ';color:' + fg + ';font-family:system-ui,-apple-system,sans-serif;">' +
      '<div style="text-align:center;max-width:420px;padding:24px;">' +
      '<div style="font-size:48px;margin-bottom:16px;">🌐</div>' +
      '<h2 style="margin:0 0 8px;font-size:18px;font-weight:600;">网络连接异常</h2>' +
      '<p style="margin:0 0 24px;font-size:14px;color:' + muted + ';line-height:1.6;">' +
      '无法加载应用资源，这通常发生在系统休眠刚恢复或网络切换时。<br>请检查网络后重试。</p>' +
      '<button id="pn-retry-btn" style="padding:8px 20px;border:1px solid ' + muted + ';' +
      'background:' + btnBg + ';color:' + fg + ';border-radius:6px;cursor:pointer;font-size:14px;">' +
      '重试</button></div></div>';

    document.getElementById('pn-retry-btn').addEventListener('click', function () {
      sessionStorage.removeItem(KEY);
      window.location.reload();
    });
  }

  window.addEventListener('error', function (e) {
    var t = e.target;
    if (!t || t === window) return;

    var isResource =
      (t.tagName === 'SCRIPT' && t.src) ||
      (t.tagName === 'LINK' && t.href);
    if (!isResource) return;

    var last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < LIMIT_MS) {
      showFallback();
      return;
    }

    sessionStorage.setItem(KEY, String(Date.now()));
    setTimeout(function () {
      window.location.reload();
    }, 1500);
  }, true);
})();

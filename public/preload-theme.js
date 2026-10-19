(function () {
  // 存值由 ThemeManager 写：light-theme / dark-theme / auto（跟随系统）
  var saved = localStorage.getItem('picnexus-theme');
  var theme;

  if (saved === 'light-theme') {
    theme = 'light';
  } else if (saved === 'dark-theme') {
    theme = 'dark';
  } else {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  document.documentElement.setAttribute('data-theme', theme);
})();

(function () {
  var saved = localStorage.getItem('picnexus-theme');
  var cls;

  if (saved === 'light-theme') {
    cls = 'light-theme';
  } else if (saved === 'dark-theme') {
    cls = 'dark-theme';
  } else {
    cls = window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark-theme'
      : 'light-theme';
  }

  document.documentElement.classList.add(cls);
})();

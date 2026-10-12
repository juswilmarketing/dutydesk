try {
  var t = JSON.parse(localStorage.getItem('dutydesk-theme')).state.theme;
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
} catch (e) {}

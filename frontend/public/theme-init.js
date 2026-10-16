// Same-origin, before-paint theme bootstrap. No credentials are read or stored.
(() => {
  let preference = 'system';
  try { const stored = localStorage.getItem('dataplatform-theme'); if (stored === 'light' || stored === 'dark' || stored === 'system') preference = stored; } catch { /* Browser storage may be unavailable. */ }
  const dark = preference === 'dark' || (preference === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#11120d' : '#f8f5f2');
})();

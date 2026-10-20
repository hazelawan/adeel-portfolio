/* Installation is always user initiated. This never changes auth, drafts,
 * site content, backend data, or the existing appearance preference. */
(function () {
  'use strict';
  var deferredPrompt = null;
  var buttons = Array.from(document.querySelectorAll('[data-install-admin]'));
  var help = document.getElementById('install-help');
  var status = document.getElementById('connection-status');
  var standalone = window.matchMedia('(display-mode: standalone)');
  function installed() { return standalone.matches || window.navigator.standalone === true; }
  function render() {
    buttons.forEach(function (button) {
      button.hidden = installed();
      button.textContent = deferredPrompt ? 'Install admin app' : 'Add to home screen';
    });
    if (installed() && help.open) help.close();
  }
  function connection() {
    status.hidden = navigator.onLine;
    status.textContent = navigator.onLine ? '' : 'You’re offline. Reconnect before loading or saving changes.';
  }
  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault(); deferredPrompt = event; render();
  });
  window.addEventListener('appinstalled', function () { deferredPrompt = null; render(); });
  if (standalone.addEventListener) standalone.addEventListener('change', render);
  buttons.forEach(function (button) {
    button.addEventListener('click', async function () {
      if (deferredPrompt) {
        var prompt = deferredPrompt; deferredPrompt = null;
        try { await prompt.prompt(); await prompt.userChoice; }
        catch (_) { help.showModal(); }
        render();
      } else help.showModal();
    });
  });
  document.getElementById('install-help-close').addEventListener('click', function () { help.close(); });
  help.addEventListener('click', function (event) { if (event.target === help) help.close(); });
  window.addEventListener('online', connection);
  window.addEventListener('offline', connection);
  var nav = document.getElementById('tab-nav');
  function syncNavigation() {
    var active = nav.querySelector('.nav-item.active');
    nav.querySelectorAll('.nav-item').forEach(function (button) {
      if (button === active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (active && nav.scrollWidth > nav.clientWidth) {
      nav.scrollTo({ left: active.offsetLeft - nav.clientWidth / 2 + active.offsetWidth / 2 });
    }
  }
  new MutationObserver(syncNavigation).observe(nav, { subtree: true, attributes: true, attributeFilter: ['class'] });
  syncNavigation();
  connection(); render();
  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', function () {
      // A URL-prefix scope limited to the admin document; not the portfolio.
      // Recovery links never trigger registration or get persisted anywhere.
      var params = new URLSearchParams(location.search);
      if (params.has('secret') || params.has('userId')) return;
      navigator.serviceWorker.register('./admin-sw.js', {
        scope: './admin.html', updateViaCache: 'none'
      }).catch(function () {
        // Installation help stays useful if browser policy blocks workers.
      });
    }, { once: true });
  }
}());

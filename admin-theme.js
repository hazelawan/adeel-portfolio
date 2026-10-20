(function () {
  'use strict';
  var KEY = 'wanhar-admin-theme';
  var root = document.documentElement;
  var controls = [];
  var meta;

  function valid(mode) { return mode === 'light' || mode === 'dark'; }
  function safeGet() { try { return window.localStorage.getItem(KEY); } catch (_) { return null; } }
  function safeSet(mode) { try { window.localStorage.setItem(KEY, mode); } catch (_) { /* storage may be disabled */ } }
  function preferred() {
    try {
      if (typeof window.matchMedia !== 'function') return 'dark';
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    catch (_) { return 'dark'; }
  }
  function paint(mode) {
    root.setAttribute('data-admin-theme', mode);
    root.style.colorScheme = mode;
    if (!meta) meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mode === 'light' ? '#f4f6f2' : '#0b0d0c');
    controls.forEach(function (button) {
      button.setAttribute('aria-checked', String(mode === 'dark'));
      button.setAttribute('aria-label', 'Admin dark mode');
      button.setAttribute('title', mode === 'dark' ? 'Admin dark mode on' : 'Admin dark mode off');
      button.textContent = mode === 'dark' ? 'Dark' : 'Light';
    });
  }
  var initial = safeGet();
  paint(valid(initial) ? initial : preferred());

  function attach() {
    controls = Array.prototype.slice.call(document.querySelectorAll('[data-admin-theme-toggle]'));
    controls.forEach(function (button) {
      button.setAttribute('role', 'switch');
      button.setAttribute('aria-label', 'Admin dark mode');
      button.setAttribute('aria-checked', String(root.getAttribute('data-admin-theme') === 'dark'));
      button.addEventListener('click', function () {
        var next = root.getAttribute('data-admin-theme') === 'dark' ? 'light' : 'dark';
        safeSet(next);
        paint(next);
      });
    });
    paint(root.getAttribute('data-admin-theme') === 'light' ? 'light' : 'dark');
    window.addEventListener('storage', function (event) {
      if (event.key !== KEY) return;
      if (valid(event.newValue)) paint(event.newValue);
      else if (event.newValue === null) paint(preferred());
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach, { once: true });
  else attach();
}());

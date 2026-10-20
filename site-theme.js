(function () {
  'use strict';
  var marker = document.querySelector('meta[name="cue-site-theme"]');
  if (!marker || marker.getAttribute('content') !== 'wanhar-portfolio-v1') return;
  var script = document.currentScript;
  if (!script || !script.src || typeof fetch !== 'function') return;
  var configURL = new URL('./site-theme.json', script.src).href;
  var validModes = ['dark', 'light', 'system'];
  var validAccents = ['gold', 'emerald', 'blue', 'rose'];
  var media = null;
  var config;
  function valid(value) {
    return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === 'accent,adapter,mode,version' &&
      value.version === 1 && value.adapter === 'wanhar-portfolio-v1' &&
      validModes.indexOf(value.mode) >= 0 && validAccents.indexOf(value.accent) >= 0;
  }
  function apply() {
    var dark = config.mode === 'system' ? !media || media.matches : config.mode === 'dark';
    var root = document.documentElement;
    root.setAttribute('data-site-adapter', 'wanhar-portfolio-v1');
    root.setAttribute('data-site-theme', dark ? 'dark' : 'light');
    root.setAttribute('data-site-accent', config.accent);
    root.setAttribute('data-site-theme-mode', config.mode);
    root.style.colorScheme = dark ? 'dark' : 'light';
  }
  fetch(configURL, { cache: 'no-store' }).then(function (response) {
    if (!response || !response.ok) return null;
    return response.json();
  }).then(function (value) {
    if (!valid(value)) return;
    config = value;
    if (config.mode === 'system' && typeof matchMedia === 'function') {
      media = matchMedia('(prefers-color-scheme: dark)');
      if (media.addEventListener) media.addEventListener('change', apply);
      else if (media.addListener) media.addListener(apply);
    }
    apply();
  }).catch(function () { /* Invalid or unavailable config leaves original styling untouched. */ });
}());

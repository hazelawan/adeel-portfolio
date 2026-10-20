import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../admin-theme.js', import.meta.url), 'utf8');
function harness({ saved = null, darkPreference = false, denyStorage = false, readyState = 'loading' } = {}) {
  const attributes = new Map();
  const root = { style: {}, setAttribute: (k,v) => attributes.set(k,v), getAttribute: k => attributes.get(k) ?? null };
  const metaAttrs = {};
  const meta = { setAttribute: (k,v) => { metaAttrs[k] = v; } };
  const handlers = {};
  const storage = { value: saved, getItem() { if (denyStorage) throw Error('blocked'); return this.value; }, setItem(k,v) { if (denyStorage) throw Error('blocked'); this.value = v; } };
  const buttons = [0,1].map(() => ({ attrs:{}, listeners:{}, setAttribute(k,v){this.attrs[k]=v;}, addEventListener(k,fn){this.listeners[k]=fn;} }));
  const document = { documentElement: root, readyState, addEventListener(k,fn){handlers[k]=fn;}, querySelector: () => meta, querySelectorAll: () => buttons };
  const window = { localStorage: storage, matchMedia: () => ({matches:darkPreference}), addEventListener(k,fn){handlers['window:'+k]=fn;} };
  vm.runInNewContext(source, { document, window });
  return { root, attributes, metaAttrs, handlers, storage, buttons };
}

test('saved theme is applied before DOM ready, including color scheme and meta', () => {
  const h = harness({saved:'light'});
  assert.equal(h.root.getAttribute('data-admin-theme'), 'light');
  assert.equal(h.root.style.colorScheme, 'light');
  assert.equal(h.metaAttrs.content, '#f4f6f2');
  h.handlers.DOMContentLoaded();
  assert.equal(h.buttons[0].attrs.role, 'switch');
  assert.equal(h.buttons[0].attrs['aria-label'], 'Admin dark mode');
  assert.equal(h.buttons[0].attrs['aria-checked'], 'false');
  assert.equal(h.buttons[1].attrs['aria-checked'], 'false');
});

test('system preference fallback and no-matchMedia fallback are dark by default', () => {
  assert.equal(harness({darkPreference:true}).root.getAttribute('data-admin-theme'), 'dark');
  const h = harness();
  assert.equal(h.root.getAttribute('data-admin-theme'), 'light');
  const attrs = new Map();
  const document = {documentElement:{style:{},setAttribute:(k,v)=>attrs.set(k,v),getAttribute:k=>attrs.get(k)},readyState:'complete',querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}};
  vm.runInNewContext(source,{document,window:{localStorage:{getItem(){return null},setItem(){}},addEventListener(){}}});
  assert.equal(document.documentElement.getAttribute('data-admin-theme'),'dark');
});

test('either control persists and updates both controls', () => {
  const h = harness({saved:'dark'}); h.handlers.DOMContentLoaded();
  h.buttons[1].listeners.click();
  assert.equal(h.storage.value,'light');
  assert.equal(h.root.getAttribute('data-admin-theme'),'light');
  assert.equal(h.buttons[0].attrs['aria-checked'],'false');
  assert.equal(h.buttons[1].attrs['aria-checked'],'false');
  assert.equal(h.metaAttrs.content,'#f4f6f2');
});

test('storage denial does not prevent theme initialization or toggling', () => {
  const h = harness({denyStorage:true});
  assert.equal(h.root.getAttribute('data-admin-theme'),'light');
  h.handlers.DOMContentLoaded(); h.buttons[0].listeners.click();
  assert.equal(h.root.getAttribute('data-admin-theme'),'dark');
});

test('same-origin storage events synchronize tabs and unrelated keys are ignored', () => {
  const h = harness({saved:'light'}); h.handlers.DOMContentLoaded();
  const storage = h.handlers['window:storage'];
  storage({key:'other',newValue:'dark'});
  assert.equal(h.root.getAttribute('data-admin-theme'),'light');
  storage({key:'wanhar-admin-theme',newValue:'dark'});
  assert.equal(h.root.getAttribute('data-admin-theme'),'dark');
  assert.equal(h.buttons[0].attrs['aria-checked'],'true');
  assert.equal(h.buttons[1].attrs['aria-checked'],'true');
});

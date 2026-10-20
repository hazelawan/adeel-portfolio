import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const support=require('../site-theme-support.js');
const runtime=fs.readFileSync(new URL('../site-theme.js',import.meta.url),'utf8');
const {DEFAULT_SITE_THEME,THEME_MODES,THEME_ACCENTS,parseSiteTheme,injectPortfolioTheme,isSupportedThemeHTML}=support;

test('default and strict config parser',()=>{
 assert.deepEqual(DEFAULT_SITE_THEME,{version:1,adapter:'wanhar-portfolio-v1',mode:'dark',accent:'gold'});
 assert.equal(THEME_MODES.length,3); assert.equal(THEME_ACCENTS.length,4);
 assert.deepEqual(parseSiteTheme('{"version":1,"adapter":"wanhar-portfolio-v1","mode":"light","accent":"rose"}'),{version:1,adapter:'wanhar-portfolio-v1',mode:'light',accent:'rose'});
 for(const x of [{...DEFAULT_SITE_THEME,extra:1},{...DEFAULT_SITE_THEME,version:2},{...DEFAULT_SITE_THEME,mode:'sepia'},'{bad',null]) assert.throws(()=>parseSiteTheme(x));
});
test('injects only same-folder assets before head close and is idempotent without CSS edits',()=>{
 const html='<!doctype html><html><head><link rel="stylesheet" href="style.css?v=1"></head><body></body></html>';
 const injected=injectPortfolioTheme(html);
 assert.ok(injected.includes('<meta name="cue-site-theme" content="wanhar-portfolio-v1">'));
 assert.ok(injected.includes('href="./site-theme.css"')); assert.ok(injected.includes('src="./site-theme.js" defer'));
 assert.equal(injectPortfolioTheme(injected),injected); assert.ok(isSupportedThemeHTML(injected));
 assert.ok(!isSupportedThemeHTML(html)); assert.throws(()=>injectPortfolioTheme('<html><body>no head</body></html>'));
});
function boot({optIn=true,config={...DEFAULT_SITE_THEME},ok=true,system=true}={}) {
 let applyCount=0, fetchInfo, change, currentSystem=system;
 const root={attrs:{},style:{colorScheme:''},setAttribute(k,v){this.attrs[k]=v;applyCount++;}};
 const marker=optIn?{getAttribute:()=> 'wanhar-portfolio-v1'}:null;
 const script={src:'https://example.test/site/site-theme.js'};
 const context={document:{querySelector:()=>marker,currentScript:script,documentElement:root},URL,fetch:(url,opts)=>{fetchInfo={url,opts};return Promise.resolve({ok,json:()=>Promise.resolve(config)});},matchMedia:()=>({get matches(){return currentSystem;},addEventListener:(n,fn)=>change=fn}),Promise};
 vm.runInNewContext(runtime,context); return new Promise(resolve=>setImmediate(()=>resolve({root,fetchInfo,applyCount,change:fn=>{currentSystem=fn;change({matches:fn});},getCount:()=>applyCount})));
}
test('runtime opt-in guard and arbitrary imports do nothing',async()=>{
 const b=await boot({optIn:false}); assert.equal(b.fetchInfo,undefined); assert.deepEqual(b.root.attrs,{}); assert.equal(b.applyCount,0);
});
test('valid config fetched relative to script with no-store and applies resolved mode/accent',async()=>{
 const b=await boot({config:{version:1,adapter:'wanhar-portfolio-v1',mode:'light',accent:'blue'}});
 assert.equal(b.fetchInfo.url,'https://example.test/site/site-theme.json'); assert.equal(b.fetchInfo.opts.cache,'no-store');
 assert.equal(b.root.attrs['data-site-theme'],'light'); assert.equal(b.root.attrs['data-site-accent'],'blue'); assert.equal(b.root.attrs['data-site-theme-mode'],'light'); assert.equal(b.root.style.colorScheme,'light');
});
test('invalid config, missing config and failed fetch leave styling untouched',async()=>{
 for(const config of [{...DEFAULT_SITE_THEME,extra:true},{...DEFAULT_SITE_THEME,accent:'purple'},null]) {
  const b=await boot({config}); assert.equal(b.applyCount,0); assert.deepEqual(b.root.attrs,{});
 }
});
test('system mode updates when system preference changes without persistence',async()=>{
 const b=await boot({config:{...DEFAULT_SITE_THEME,mode:'system'},system:true});
 assert.equal(b.root.attrs['data-site-theme'],'dark'); b.change(false); assert.equal(b.root.attrs['data-site-theme'],'light');
 assert.equal(b.root.attrs['data-site-theme-mode'],'system');
});

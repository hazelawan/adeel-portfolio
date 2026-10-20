import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const edge = await readFile(new URL('../supabase/functions/site-manager/index.ts', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/202610200001_sites.sql', import.meta.url), 'utf8');

test('catalog tables enforce unique slugs and restrict direct client access', () => {
  assert.match(migration, /slug text not null unique/i); assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on table public\.sites from (?:public, )?anon, authenticated/i);
});
test('publisher secrets are encrypted and atomically upserted', () => {
  assert.match(edge, /createCipheriv\("aes-256-gcm"/); assert.match(edge, /import \{ Buffer \} from "node:buffer"/);
  assert.match(edge, /on_conflict=id/); assert.doesNotMatch(edge, /site_manager_secrets\?.*DELETE/);
});
test('actual handler denies missing identity and non-admin before any database access', async () => {
  for (const { body, expected } of [{ body:{action:'list'}, expected:401 }, {body:{action:'list',jwt:'valid'},expected:403}]) {
    const calls=[]; const handler=await makeHandler(async (url)=>{calls.push(String(url)); return url.includes('/account') ? json({labels:[]}) : json({});});
    const r=await handler(new Request('https://edge.test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
    assert.equal(r.status,expected); assert.equal(calls.some(u=>u.includes('/rest/v1/')),false);
  }
});
test('malformed and oversized request bodies return client errors', async()=>{
 const handler=await makeHandler(async()=>{throw Error('must not call upstream')});
 assert.equal((await handler(new Request('https://edge.test',{method:'POST',body:'{'}))).status,400);
 assert.equal((await handler(new Request('https://edge.test',{method:'POST',body:'x'.repeat(3*1024*1024+1)}))).status,413);
});
test('portfolio clone emits local content renderer, defaults and standalone HTML without form or admin link', async()=>{
 const blobs={}; const put=(path,content)=>{const sha='sha-'+path;blobs[sha]=Buffer.from(content).toString('base64');return {path,sha,type:'blob',mode:'100644'};};
 const entries=[put('index.html','<html><head><link rel="stylesheet" href="style.css?v=x"><link rel="stylesheet" href="contact-form.css"><script src="app.js?v=x"></script><script type="module" src="content.js?v=x"></script></head><body><a href="../admin.html">Admin</a><form id="contact-form">x</form></body></html>'),put('app.js',''),put('style.css',''),put('contact-form.css',''),put('content-defaults.json','{}'),put('content.js',"import {isConfigured,getContent,sendMessage} from './appwrite-client.js';\nconst $=s=>document.querySelector(s);\nfunction render(content,defaults){}\nconst form=$('#contact-form'),status=$('#contact-form-status');\nif(isConfigured()){\n form.hidden=false;\n try{const defaults=await fetch('./content-defaults.json').then(r=>r.json());const content=await getContent();render(content,defaults);}catch(error){}\n form.addEventListener('submit',async e=>{});\n}\n"),{path:'assets',type:'tree',mode:'040000'},put('assets/a.svg','<svg/>')];
 const records=new Map(), uploaded=[]; let rev=0; const now=()=>`2026-01-01T00:00:0${rev++}.000Z`;
 const fetcher=async(url,init={})=>{url=String(url);
  if(url.endsWith('/account'))return json({labels:['portfolioAdmin']});
  if(url.includes('/rest/v1/sites?slug='))return json([]);
  if(url.endsWith('/rest/v1/sites')&&init.method==='POST'){const p=JSON.parse(init.body);const row={id:p.id,slug:p.slug,payload:p.payload,updated_at:now()};records.set(row.id,row);return json([row]);}
  if(url.includes('/rest/v1/sites?id=eq.')){const id=decodeURIComponent(url.split('id=eq.')[1].split('&')[0]),row=records.get(id);if(!row)return json([]);if(init.method==='PATCH'){const expected=decodeURIComponent(url.split('updated_at=eq.')[1]);if(row.updated_at!==expected)return json([]);const p=JSON.parse(init.body);Object.assign(row,p,{updated_at:now()});return json([row]);}return json([row]);}
  if(url.includes('/git/ref/heads/main'))return json({object:{sha:'head'}});
  if(url.endsWith('/git/commits/head'))return json({tree:{sha:'tree'}});
  if(url.includes('/git/trees/tree?recursive=1'))return json({tree:entries});
  const m=url.match(/\/git\/blobs\/(sha-.+)$/);if(m)return json({content:blobs[m[1]]});
  if(url.endsWith('/git/blobs')&&init.method==='POST'){uploaded.push(JSON.parse(init.body));return json({sha:'a'.repeat(40)});}
  throw Error('unexpected '+url+' '+init.method);
 };
 const handler=await makeHandler(fetcher); const response=await handler(new Request('https://edge.test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jwt:'valid',action:'portfolioTemplate',slug:'clone-one',name:'Clone',content:{owner:{title:'edited'}}})}));
 const responseText=await response.text(); assert.equal(response.status,200,responseText); const site=JSON.parse(responseText).site;
	 const paths=site.files.map(f=>f.path); assert.ok(paths.includes('content.js'));assert.ok(paths.includes('site-content.json'));assert.ok(paths.includes('content-defaults.json'));
 assert.equal(site.files.some(f=>f.path==='contact-form.css'),false);
 const uploadedFiles=uploaded.map(x=>Buffer.from(x.content,'base64').toString());
 const renderer=uploadedFiles.find(x=>x.includes('Local site content unavailable'));
 assert.ok(renderer); assert.match(renderer,/fetch\('\.\/site-content\.json'\)/); assert.doesNotMatch(renderer,/appwrite-client|sendMessage|contact-form-status/);
 const html=uploadedFiles.find(x=>x.includes('<html>')); assert.ok(html); assert.match(html,/content\.js/); assert.doesNotMatch(html,/admin\.html|contact-form|contact-form\.css/);
 const siteContent=uploadedFiles.find(x=>x.includes('edited')); assert.ok(siteContent);
	});

test('publishing permits the existing sites tree, creates an atomic non-force folder, and preserves root tree', async () => {
 const h=await siteHarness({tree:[{path:'sites',type:'tree',mode:'040000'},{path:'README.md',type:'blob',mode:'100644',sha:'root'}]});
 const site=await draft(h,'atomic-site'); await upload(h,site,'index.html','<h1>ok</h1>');
 const r=await h.call({action:'publish',siteId:site.$id}); assert.equal(r.status,200,await r.clone().text());
 assert.equal(h.calls.filter(c=>c.url.endsWith('/git/trees')&&c.method==='POST').length,1);
 const treeCall=h.calls.find(c=>c.url.endsWith('/git/trees')&&c.method==='POST'); assert.equal(JSON.parse(treeCall.body).base_tree,'tree-1');
 const patch=h.calls.find(c=>c.url.endsWith('/git/refs/heads/main')&&c.method==='PATCH'); assert.ok(patch);assert.equal(JSON.parse(patch.body).force,false);
 assert.equal(h.tree.some(e=>e.path==='README.md'),true);
});

test('publishing rejects existing target slug including case variants before Git ref writes', async()=>{
 for(const existing of ['sites/occupied/index.html','Sites/occupied/index.html']){
  const h=await siteHarness({tree:[{path:existing,type:'blob',mode:'100644',sha:'old'}]}); const site=await draft(h,'occupied');await upload(h,site,'index.html','x');
  const r=await h.call({action:'publish',siteId:site.$id});assert.equal(r.status,409);assert.equal(h.calls.some(c=>c.url.endsWith('/git/refs/heads/main')&&c.method==='PATCH'),false);
 }
});

test('retry with a valid published marker is recovered without writing another git ref',async()=>{
 const h=await siteHarness();const site=await draft(h,'retry-site');await upload(h,site,'index.html','hello');
 const marker={version:2,siteId:site.$id,publicationId:site.publicationId,filesFingerprint:''};
 // Obtain fingerprint from the handler-generated marker after one successful publication, then simulate a lost response.
 const first=await h.call({action:'publish',siteId:site.$id});assert.equal(first.status,200);
 const markerBlob=h.blobs.get(h.committedEntries.find(e=>e.path.endsWith('/cue-site.json')).sha);Object.assign(marker,JSON.parse(Buffer.from(markerBlob,'base64').toString()));
 h.setTree([{path:'sites',type:'tree',mode:'040000'},...h.committedEntries]); const before=h.calls.filter(c=>c.url.endsWith('/git/refs/heads/main')&&c.method==='PATCH').length;
 const retry=await h.call({action:'publish',siteId:site.$id});assert.equal(retry.status,200);assert.equal(h.calls.filter(c=>c.url.endsWith('/git/refs/heads/main')&&c.method==='PATCH').length,before);
});

test('refresh only marks publishing sites published after matching public marker',async()=>{
 const h=await siteHarness();const site=await draft(h,'refresh-site');await upload(h,site,'index.html','hello');await h.call({action:'publish',siteId:site.$id});
 h.publicMarker={ok:false};let r=await h.call({action:'refresh',siteId:site.$id});assert.equal((await r.json()).site.status,'publishing');
 h.publicMarker={ok:true,body:{version:2,siteId:site.$id,publicationId:site.publicationId,filesFingerprint:JSON.parse(Buffer.from(h.blobs.get(h.committedEntries.find(e=>e.path.endsWith('/cue-site.json')).sha),'base64').toString()).filesFingerprint}};
 r=await h.call({action:'refresh',siteId:site.$id});assert.equal((await r.json()).site.status,'published');
});

test('uploads update size, add files, and reject a concurrent aggregate/sha change',async()=>{
 const h=await siteHarness();const site=await draft(h,'upload-site');await upload(h,site,'index.html','a');
 let r=await h.call({action:'uploadFile',siteId:site.$id,path:'index.html',content:Buffer.from('longer').toString('base64')});assert.equal(r.status,200);assert.equal((await r.json()).site.files.find(f=>f.path==='index.html').size,6);
 r=await h.call({action:'uploadFile',siteId:site.$id,path:'new.txt',mime:'text/plain',content:Buffer.from('new').toString('base64')});assert.equal(r.status,200);assert.equal((await r.json()).site.files.some(f=>f.path==='new.txt'),true);
 h.concurrentBeforePatch=true;r=await h.call({action:'uploadFile',siteId:site.$id,path:'index.html',content:Buffer.from('raced').toString('base64')});assert.equal(r.status,409);
});

async function makeHandler(fetcher,env={}){
 const source=stripTypeScriptTypes(edge,{mode:'transform'});let handler;const priorDeno=globalThis.Deno;globalThis.Deno={serve(fn){handler=fn},env:{get(k){return ({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'service-key',GITHUB_TOKEN:'x'.repeat(30),...env})[k]||''}}};
 // Separate module evaluation captures handler and uses global fetch at invocation.
 const url='data:text/javascript;base64,'+Buffer.from(source).toString('base64')+'#'+Math.random();await import(url);
 globalThis.Deno=priorDeno;
 const wrapped=async req=>{const original=globalThis.fetch,originalDeno=globalThis.Deno;globalThis.fetch=fetcher;globalThis.Deno={serve(){},env:{get(k){return ({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'service-key',GITHUB_TOKEN:'x'.repeat(30),...env})[k]||''}}};try{return await handler(req)}finally{globalThis.fetch=original;globalThis.Deno=originalDeno}};return wrapped;
}
function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}})}

async function siteHarness({tree=[]}={}){
 const rows=new Map(),calls=[],blobs=new Map();let rev=0,head='head-1',treeSha='tree-1',committedEntries=[];
 const setTree=x=>{tree=[...x]}; const fetcher=async(url,init={})=>{url=String(url);init={...init};calls.push({url,method:init.method||'GET',body:init.body});
  if(url.endsWith('/account'))return json({labels:['portfolioAdmin']});
  if(url.includes('/rest/v1/site_manager_secrets'))return json([]);
  if(url.includes('/rest/v1/sites?slug=')){const slug=decodeURIComponent(url.split('slug=eq.')[1].split('&')[0]);return json([...rows.values()].filter(x=>x.slug===slug).map(x=>({id:x.id})));}
  if(url.endsWith('/rest/v1/sites')&&init.method==='POST'){const p=JSON.parse(init.body),row={id:p.id,slug:p.slug,payload:p.payload,updated_at:`r${++rev}`};rows.set(row.id,row);return json([row]);}
  if(url.includes('/rest/v1/sites?select=*&order='))return json([...rows.values()]);
  if(url.includes('/rest/v1/sites?id=eq.')){const id=decodeURIComponent(url.split('id=eq.')[1].split('&')[0]),row=rows.get(id);if(!row)return json([]);if(init.method==='PATCH'){
    if(h.concurrentBeforePatch){h.concurrentBeforePatch=false;row.updated_at=`r${++rev}`;}
    const expected=decodeURIComponent(url.split('updated_at=eq.')[1]||'');if(row.updated_at!==expected)return json([]);
    const p=JSON.parse(init.body);Object.assign(row,p,{updated_at:`r${++rev}`});return json([row]);}return json([row]);}
  if(url.includes('/git/ref/heads/main')){if(init.method==='PATCH'){head=JSON.parse(init.body).sha;return json({ref:'ok'});}return json({object:{sha:head}});}
  if(url.endsWith(`/git/commits/${head}`))return json({tree:{sha:treeSha}});
  if(url.includes(`/git/trees/${treeSha}?recursive=1`))return json({tree});
  const bm=url.match(/\/git\/blobs\/(.+)$/);if(bm)return json({content:blobs.get(bm[1])||''});
  if(url.endsWith('/git/blobs')&&init.method==='POST'){const p=JSON.parse(init.body),sha=(blobs.size+1).toString(16).padStart(40,'0');blobs.set(sha,p.encoding==='base64'?p.content:Buffer.from(p.content).toString('base64'));return json({sha});}
  if(url.endsWith('/git/trees')&&init.method==='POST'){const p=JSON.parse(init.body);committedEntries=p.tree;tree=[...tree,...p.tree];treeSha=`tree-${++rev}`;return json({sha:treeSha});}
  if(url.endsWith('/git/commits')&&init.method==='POST'){return json({sha:`commit-${rev+1}`});}
  if(url.includes('github.io/')&&url.endsWith('/cue-site.json'))return h.publicMarker?.ok?json(h.publicMarker.body):json({},404);
  throw Error(`unexpected ${url} ${init.method}`);
 };
 const h={calls,blobs,get tree(){return tree},get committedEntries(){return committedEntries},setTree,publicMarker:null,concurrentBeforePatch:false,call:async body=>{const handler=await makeHandler(fetcher);return handler(new Request('https://edge.test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jwt:'valid',...body})}));}};
 return h;
}
async function draft(h,slug){const r=await h.call({action:'createDraft',slug,name:slug,files:[{path:'index.html',size:0,mime:'text/html'}]});assert.equal(r.status,200,await r.clone().text());return (await r.json()).site;}
async function upload(h,site,path,content){const r=await h.call({action:'uploadFile',siteId:site.$id,path,mime:'text/html',content:Buffer.from(content).toString('base64')});assert.equal(r.status,200,await r.clone().text());return r.json();}

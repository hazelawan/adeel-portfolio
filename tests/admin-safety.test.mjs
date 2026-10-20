import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../sites-manager.js',import.meta.url),'utf8');
function sitesHarness(){
 const listeners={},prompts=[],calls=[];let accept=false,handler=async()=>({});
 const context=vm.createContext({TextEncoder,TextDecoder,Uint8Array,Map,Set,URL,console,btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),confirm:text=>{prompts.push(text);return accept;},window:{addEventListener:(type,fn)=>listeners[type]=fn},document:{querySelector:()=>({querySelector:()=>null})}});
 vm.runInContext(source.replace(/^import .*\n/gm,'').replace(/export /g,'').replaceAll('import.meta.url',JSON.stringify('https://example.test/sites-manager.js'))+`
 render=()=>{};refresh=async()=>{};inspectSiteTheme=async()=>{};
 backend=async(action,params)=>{calls.push({action,...params});return handler(action,params)};
 globalThis.api={edit,createImport,publish,hasPendingSiteChanges,leaveSiteEditor,resetSitesManager,isSitesBusy,
 setEditor(value){editor=value},getEditor(){return editor},getNotice(){return notice},getPending(){return pendingImport},getSites(){return sites},
 setTheme(){siteThemes.set('draft',{supported:true,config:{mode:'dark'},selected:{mode:'light'}})},
 setImport(files){importFiles=files;importName='Example';importSlug='example'},
 setSession(){sessionToken={userId:'owner',jwt:'sensitive',expires:Infinity}},getSession(){return sessionToken},
 setBusy(value){busy=value},getImportFiles(){return importFiles}};`,Object.assign(context,{calls,handler:(...args)=>handler(...args)}));
 return {api:context.api,listeners,prompts,calls,allow:()=>accept=true,respond:fn=>handler=fn};
}
test('unsaved file blocks editor replacement and publishing; leaving requires explicit discard',async()=>{
 const h=sitesHarness();h.api.setEditor({text:'new',savedText:'old',readOnly:false});
 assert.equal(h.api.hasPendingSiteChanges(),true);
 await h.api.edit({status:'draft'},{path:'other.html'});assert.equal(h.api.getEditor().text,'new');assert.equal(h.calls.length,0);
 await h.api.publish({name:'Draft',slug:'draft'});assert.match(h.api.getNotice(),/Save or discard/);assert.equal(h.calls.length,0);
 assert.equal(h.api.leaveSiteEditor(),false);h.allow();assert.equal(h.api.leaveSiteEditor(),true);assert.equal(h.api.hasPendingSiteChanges(),false);
});
test('theme choices and in-flight work warn before page exit; clean and read-only editors do not',()=>{
 const h=sitesHarness();let prevented=0;const event={preventDefault(){prevented++}};
 h.api.setEditor({text:'old',savedText:'old'});h.listeners.beforeunload(event);assert.equal(prevented,0);
 h.api.setEditor({text:'new',savedText:'old',readOnly:true});h.listeners.beforeunload(event);assert.equal(prevented,0);
 h.api.setTheme();h.listeners.beforeunload(event);assert.equal(prevented,1);
 h.allow();h.api.leaveSiteEditor();assert.equal(h.api.hasPendingSiteChanges(),false);
 h.api.setBusy(true);h.listeners.beforeunload(event);assert.equal(prevented,2);
});
test('sign-out reset clears token, editor, theme selection, import files and catalog',()=>{
 const h=sitesHarness();h.api.setSession();h.api.setTheme();h.api.setEditor({text:'private',savedText:''});h.api.setImport([{name:'private.html'}]);
 h.api.resetSitesManager();assert.equal(h.api.getSession().jwt,'');assert.equal(h.api.getEditor(),null);assert.equal(h.api.hasPendingSiteChanges(),false);assert.equal(h.api.getImportFiles().length,0);assert.equal(h.api.getSites().length,0);
});
test('interrupted import retries only unconfirmed files in the same draft, without publishing',async()=>{
 const h=sitesHarness();const file=name=>({name,size:4,type:'text/plain',arrayBuffer:async()=>new TextEncoder().encode('test').buffer});
 h.api.setImport([file('index.html'),file('style.css')]);let fail=true;
 h.respond(async(action,p)=>{if(action==='createDraft')return {site:{id:'draft-one',files:p.files}};if(action==='uploadFile'){if(p.path==='style.css'&&fail)throw Error('offline');return {site:{id:'draft-one',files:[]}};}throw Error('Unexpected '+action)});
 await h.api.createImport();assert.equal(h.api.getPending().index,1);assert.match(h.api.getNotice(),/Retry remaining uploads/);
 let prevented=false;h.listeners.beforeunload({preventDefault(){prevented=true}});assert.equal(prevented,true);
 fail=false;await h.api.createImport();assert.equal(h.api.getPending(),null);assert.equal(h.calls.filter(c=>c.action==='createDraft').length,1);
 assert.equal(h.calls.filter(c=>c.action==='uploadFile'&&c.path==='index.html').length,1);assert.equal(h.calls.filter(c=>c.action==='uploadFile'&&c.path==='style.css').length,2);assert.equal(h.calls.some(c=>c.action==='publish'),false);
});
const admin=await readFile(new URL('../admin.js',import.meta.url),'utf8');
test('edits made during a content save remain dirty and are not falsely marked saved',async()=>{
 const saveCode=admin.slice(admin.indexOf('async function saveAll()'),admin.indexOf("$$('.save-content').forEach(b=>b.addEventListener"));
 let resolve,dirty=true,saving=false,editRevision=1,content={title:'first'},saved;
 const state={textContent:''},button={disabled:false};
 const run=new Function('getState','saveContent','clone','$','$$','notify','clearDirty','renderStats',`let {content,saving,editRevision}=getState();${saveCode};return {saveAll,edit(){content.title='second';editRevision++}}`);
 const api=run(()=>({content,saving,editRevision}),snapshot=>{saved=snapshot;return new Promise(r=>resolve=r)},v=>JSON.parse(JSON.stringify(v)),()=>state,()=>[button],()=>{},()=>dirty=false,()=>{});
 const pending=api.saveAll();assert.equal(button.disabled,true);api.edit();resolve();await pending;
 assert.equal(saved.title,'first');assert.equal(dirty,true);assert.match(state.textContent,/Newer edits are still unsaved/);assert.equal(button.disabled,false);
});

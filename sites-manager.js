import { config, currentUser } from './appwrite-client.js';
import { Client, Account } from './vendor/appwrite.js';
import { createZip } from './sites-zip.js';
import { DEFAULT_SITE_THEME, THEME_MODES, THEME_ACCENTS, parseSiteTheme, injectPortfolioTheme, isSupportedThemeHTML } from './site-theme-support.js?v=themes-20261020';

const root=document.querySelector('#sites-manager');
const MAX_FILES=150, MAX_FILE=2*1024*1024, MAX_TOTAL=40*1024*1024, EDIT_LIMIT=512*1024;
const EDITABLE=new Set(['html','htm','css','js','json','txt','svg','md','xml','csv','map','mjs','cjs']);
const MIME={html:'text/html',htm:'text/html',css:'text/css',js:'text/javascript',json:'application/json',txt:'text/plain',svg:'image/svg+xml',md:'text/markdown',xml:'application/xml',csv:'text/csv',map:'application/json',mjs:'text/javascript',cjs:'text/javascript'};
let selectedSite='',workspace='',sites=[],busy=false,initialized=false,editor=null,notice='',noticeError=false,importFiles=[],importName='',importSlug='',templateName='Adeel Portfolio template',templateSlug='adeel-portfolio-template',duplicateName='',duplicateSlug='',duplicateSource='',importSlugTouched=false,templateSlugTouched=false,duplicateSlugTouched=false;
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;};
const fmt=n=>n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KB`:`${(n/1048576).toFixed(1)} MB`;
const slugify=s=>s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50).replace(/-$/,'');
const validSlug=s=>/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)&&s.length<=50;
function message(t,error=false){notice=t;noticeError=error;const n=root?.querySelector('#sites-state');if(n){n.textContent=t;n.classList.toggle('site-error',error);}}
function safePath(v){const p=String(v);if(!p||p.length>240||p.startsWith('/')||p.includes('\\')||p.includes(':')||/[\u0000-\u001f\u007f]/.test(p))throw Error(`Unsafe relative file path: ${p}`);const a=p.split('/');if(a.some(x=>!x||x==='.'||x==='..'||x.startsWith('.')||x.toLowerCase()==='node_modules'))throw Error(`Hidden, reserved, or invalid file path: ${p}`);if(p.toLowerCase()==='cue-site.json')throw Error('cue-site.json is reserved.');return a.join('/');}
function validatePaths(paths){const low=paths.map(p=>p.toLowerCase());if(new Set(low).size!==low.length)throw Error('File paths must be unique, including case-insensitive matches.');for(let i=0;i<low.length;i++)for(let j=0;j<low.length;j++)if(i!==j&&low[j].startsWith(low[i]+'/'))throw Error(`File/folder path conflict: ${paths[i]}`);}
function unpack(files){const raw=[...files].map(file=>({file,path:safePath(file.webkitRelativePath||file.name)}));const roots=raw.map(x=>x.path.split('/')[0]);const common=raw.length&&raw.every(x=>(x.file.webkitRelativePath||'').includes('/')&&x.path.split('/')[0]===roots[0])?roots[0]:'';return raw.map(x=>({file:x.file,path:safePath(common?x.path.slice(common.length+1):x.path)}));}
let pendingImport=null;
let sessionToken={userId:'',jwt:'',expires:0};
async function sessionJWT(userId,force=false){
  if(!force&&sessionToken.userId===userId&&sessionToken.expires>Date.now())return sessionToken.jwt;
  try{
    const {jwt}=await new Account(new Client().setEndpoint(config.endpoint).setProject(config.projectId)).createJWT();
    // Short-lived Appwrite session JWT only, retained in memory for five minutes.
    // This is never the GitHub publisher token, which remains on the server.
    sessionToken={userId,jwt,expires:Date.now()+5*60*1000};return jwt;
  }catch(e){sessionToken={userId:'',jwt:'',expires:0};throw Error(`Could not create an Appwrite session JWT (${e?.message||'session expired'}). Sign in again and retry.`);}
}
async function backend(action,params={}){
  const user=await currentUser();if(!user?.labels?.includes('portfolioAdmin'))throw Error('Administrator access is required. Sign in with a portfolioAdmin account.');
  const settings=await fetch('./sites-config.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Sites service configuration is unavailable. Ask the administrator to check sites-config.json.');return r.json();});
  if(settings.enabled!==true||!/^https:\/\//.test(settings.endpoint||''))throw Error('Sites service is disabled or its HTTPS endpoint is not configured.');
  if(!config.endpoint||!config.projectId)throw Error('Appwrite authentication is not configured.');
  for(let attempt=0;attempt<2;attempt++){
    const jwt=await sessionJWT(user.$id,attempt===1);let response;
    try{response=await fetch(settings.endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,jwt,...params})});}catch(e){throw Error(`Sites service request failed: ${e?.message||'network error'}`);}
    // A 401 is returned before any mutation; retry once with a fresh session JWT.
    if(response.status===401&&attempt===0){sessionToken={userId:'',jwt:'',expires:0};continue;}
    let result;try{result=await response.json();}catch{throw Error(`Sites service returned a non-JSON response (HTTP ${response.status}).`);}
    if(!response.ok||result.ok!==true)throw Error(result.error||`Sites service rejected the request (HTTP ${response.status}).`);return result;
  }
}
const lockable=s=>s.status==='draft';
function editorDirty(){return Boolean(editor&&!editor.readOnly&&editor.text!==editor.savedText);}
function themeDirty(){return [...siteThemes.values()].some(s=>s.supported&&JSON.stringify(s.selected)!==JSON.stringify(s.config));}
export function hasPendingSiteChanges(){return Boolean(pendingImport)||editorDirty()||themeDirty();}
export function isSitesBusy(){return busy;}
function discardSiteEdits(){editor=null;for(const state of siteThemes.values())if(state.supported)state.selected={...state.config};}
function leaveSiteEditor(){if((editorDirty()||themeDirty())&&!confirm('Discard unsaved file or website theme changes? Saved draft files will not be changed.'))return false;discardSiteEdits();return true;}
export function resetSitesManager(){discardSiteEdits();sessionToken={userId:'',jwt:'',expires:0};sites=[];siteThemes.clear();selectedSite='';workspace='';pendingImport=null;importFiles=[];importName='';importSlug='';duplicateSource='';duplicateName='';duplicateSlug='';notice='';noticeError=false;render();}
window.addEventListener('beforeunload',event=>{if(!busy&&!pendingImport&&!hasPendingSiteChanges())return;event.preventDefault();event.returnValue='';});
const siteThemes=new Map();
const themeKey=s=>(s.files||[]).filter(f=>['index.html','site-theme.json','site-theme.js','site-theme.css'].includes(f.path)).map(f=>f.path+':'+f.sha).join('|');
async function inspectSiteTheme(site){
  const id=site.id||site.$id,key=themeKey(site),cached=siteThemes.get(id);
  if(cached?.key===key)return cached;
  const supportedFiles=['site-theme.json','site-theme.js','site-theme.css','index.html'];
  if(site.kind==='original'||!supportedFiles.every(p=>site.files?.some(f=>f.path===p&&f.sha))){const state={key,supported:false};siteThemes.set(id,state);return state;}
  try{
    const conf=await getFile(site,site.files.find(f=>f.path==='site-theme.json'));
    const configValue=parseSiteTheme(new TextDecoder('utf-8',{fatal:true}).decode(conf.bytes));
    const index=await getFile(site,site.files.find(f=>f.path==='index.html'));
    if(!isSupportedThemeHTML(new TextDecoder('utf-8',{fatal:true}).decode(index.bytes)))throw Error('The website has not opted in to the supported theme runtime.');
    const state={key,supported:true,config:configValue,selected:{...configValue}};siteThemes.set(id,state);return state;
  }catch(e){const state={key,supported:false,error:e.message};siteThemes.set(id,state);return state;}
}
async function uploadThemeFile(site,path,text,mime){
  const r=await backend('uploadFile',{siteId:site.id||site.$id,path,content:bytesToBase64(new TextEncoder().encode(text)),mime});
  if(!r.site)throw Error('The saved draft was not returned.');return r.site;
}
async function installPortfolioThemeDraft(site){
  // This installer is called only immediately after our portfolioTemplate action,
  // never for imported websites or the original live portfolio.
  message('Preparing theme choices for the new portfolio copy…');
  const index=await getFile(site,site.files.find(f=>f.path==='index.html'));
  const html=injectPortfolioTheme(new TextDecoder('utf-8',{fatal:true}).decode(index.bytes));
  if(['site-theme.js','site-theme.css','site-theme.json'].some(p=>site.files.some(f=>f.path.toLowerCase()===p)))throw Error('Theme asset path collision; existing draft files were not replaced.');
  const assets=await Promise.all(['site-theme.js','site-theme.css'].map(async path=>{const r=await fetch(new URL('./'+path,import.meta.url),{cache:'no-store'});if(!r.ok)throw Error('Theme assets could not be loaded.');return {path,text:await r.text()};}));
  for(const a of assets)site=await uploadThemeFile(site,a.path,a.text,a.path.endsWith('.css')?'text/css':'text/javascript');
  site=await uploadThemeFile(site,'site-theme.json',JSON.stringify(DEFAULT_SITE_THEME,null,2),'application/json');
  // Update only this new draft's index after every supporting asset is present.
  return uploadThemeFile(site,'index.html',html,'text/html');
}
async function saveSiteTheme(site){
  if(busy||!lockable(site))return;
  const state=siteThemes.get(site.id||site.$id);if(!state?.supported)return;
  const next=parseSiteTheme(state.selected);busy=true;render();message('Saving website theme in this draft…');
  try{
    const saved=await uploadThemeFile(site,'site-theme.json',JSON.stringify(next,null,2),'application/json');
    sites=sites.map(s=>(s.id||s.$id)===(saved.id||saved.$id)?saved:s);
    siteThemes.delete(site.id||site.$id);await inspectSiteTheme(saved);
    message('Website theme saved in this draft. Publish a new website to make it live; other websites are unchanged.');
  }catch(e){message(e.message||'Could not save the website theme.',true);}finally{busy=false;render();}
}
function renderSiteTheme(parent,site){
  const box=el('section','site-theme-panel');box.append(el('h3','','Website theme'));
  if(site.kind==='original'){box.append(el('p','site-note','The original portfolio keeps its existing styling. Duplicate it to choose a theme for a separate website.'));parent.append(box);return;}
  const state=siteThemes.get(site.id||site.$id);
  if(!state?.supported){box.append(el('p','site-note','Existing website styling preserved. Theme choices are available only for sites with a supported, explicitly enabled theme configuration. Imported CSS is never rewritten automatically.'));if(state?.error)box.append(el('p','site-note',state.error));parent.append(box);return;}
  box.append(el('p','site-note','Applies only to this website’s supported portfolio theme, independently of admin light/dark mode.'));
  const fields=el('div','site-theme-fields');
  for(const [label,key,choices] of [['Website color mode','mode',THEME_MODES],['Website accent color','accent',THEME_ACCENTS]]){
    const wrap=el('label','site-theme-field',label),select=document.createElement('select');select.setAttribute('aria-label',label);select.disabled=busy||!lockable(site);
    for(const choice of choices){const o=el('option','',choice.label);o.value=choice.value;select.append(o);}select.value=state.selected[key];
    select.onchange=()=>{state.selected[key]=select.value;const status=box.querySelector('[data-theme-state]');if(status)status.textContent='Unsaved website theme — choose Save website theme before publishing.';};wrap.append(select);fields.append(wrap);
  }
  box.append(fields);const actions=el('div','site-actions');
  if(lockable(site))actionButton(actions,'Save website theme',()=>saveSiteTheme(site),false,'button primary');
  else box.append(el('p','site-note','This published website is protected. Duplicate it to change its theme in a new folder.'));
  const themeState=el('p','site-note',JSON.stringify(state.selected)!==JSON.stringify(state.config)?'Unsaved website theme — choose Save website theme before publishing.':'Website theme is saved.');themeState.dataset.themeState='';box.append(themeState);
  box.append(actions,el('p','site-note',`Saved theme: ${state.config.mode} · ${state.config.accent}. Saved in site-theme.json and included in ZIP exports. System follows each visitor’s device preference.`));parent.append(box);
}
const urlFor=s=>s.kind==='original'?'https://hazelawan.github.io/adeel-portfolio/':`https://hazelawan.github.io/adeel-portfolio/sites/${encodeURIComponent(s.slug)}/`;
async function refresh(silent=false,allowBusy=false){if(busy&&!allowBusy)return;const wasBusy=busy;busy=true;render();if(!silent)message('Loading site catalog…');try{const [r,original]=await Promise.all([backend('list'),backend('originalPortfolio')]);sites=[...(original.site?[original.site]:[]),...(Array.isArray(r.sites)?r.sites:[])];const selected=sites.find(s=>(s.id||s.$id)===selectedSite);if(selected)await inspectSiteTheme(selected);if(!silent)message(`Loaded ${sites.length} site${sites.length===1?'':'s'}.`);}catch(e){message(e.message||'Could not load the site catalog.',true);}finally{busy=wasBusy;render();}}
function bytesToBase64(bytes){let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s);}
async function createImport(){
 if(busy)return;
 try{
  if(!pendingImport){
   if(!importFiles.length)throw Error('Choose a website folder or files first.');
   if(importFiles.length>MAX_FILES)throw Error(`A site can contain at most ${MAX_FILES} files.`);
   const packed=unpack(importFiles),paths=packed.map(x=>x.path);validatePaths(paths);
   if(!paths.includes('index.html'))throw Error('Include a root index.html file.');
   if(importFiles.some(f=>f.size>MAX_FILE))throw Error('Each file must be 2 MiB or smaller.');
   if(importFiles.reduce((n,f)=>n+f.size,0)>MAX_TOTAL)throw Error('The site exceeds the 40 MiB total limit.');
   if(!importName.trim()||importName.trim().length>120)throw Error('Enter a site name of up to 120 characters.');
   if(!validSlug(importSlug.trim()))throw Error('Use a lowercase slug with letters, numbers, and single hyphens (max 50 characters).');
   busy=true;render();message('Creating a new draft…');
   const manifest=packed.map(({file,path})=>({path,size:file.size,mime:file.type||'application/octet-stream'}));
   const made=await backend('createDraft',{name:importName.trim(),slug:importSlug.trim(),files:manifest});
   sites=[made.site,...sites.filter(s=>(s.id||s.$id)!==(made.site.id||made.site.$id))];
   pendingImport={siteId:made.site.id||made.site.$id,packed,index:0};
  }
  busy=true;render();
  const job=pendingImport;selectedSite=job.siteId;
  for(;job.index<job.packed.length;job.index++){
   const {file,path}=job.packed[job.index];message(`Uploading ${job.index+1}/${job.packed.length}: ${path}`);
   const result=await backend('uploadFile',{siteId:job.siteId,path,content:bytesToBase64(new Uint8Array(await file.arrayBuffer()))});
   if(result.site)sites=sites.map(s=>(s.id||s.$id)===job.siteId?result.site:s);
  }
  pendingImport=null;importFiles=[];workspace='';await refresh(true,true);
  message('New website draft uploaded. Review its files below, then choose Publish new website to make it live.');
 }catch(e){
  if(pendingImport){selectedSite=pendingImport.siteId;workspace='import';message(`Upload interrupted after ${pendingImport.index}/${pendingImport.packed.length} confirmed files. Keep this page open and choose Retry remaining uploads; the same draft will be used. ${e.message||''}`,true);}
  else message(e.message||'Import failed.',true);
 }finally{busy=false;render();}
}
async function simpleAction(action,params,success){if(busy)return;busy=true;render();message('Working…');try{const r=await backend(action,params);if(action==='portfolioTemplate'&&r.site){const created=r.site;try{r.site=await installPortfolioThemeDraft(created);}catch(e){await refresh(true,true);selectedSite=created.id||created.$id;throw Error('The independent draft was created, but theme setup was incomplete. Its original styling was kept. '+e.message);}}if(r.site){selectedSite=r.site.id||r.site.$id;workspace='';sites=[r.site,...sites.filter(s=>(s.id||s.$id)!==selectedSite)];}await refresh(true,true);if(r.site)await inspectSiteTheme(r.site);message(success);}catch(e){message(e.message||'Request failed.',true);}finally{busy=false;render();}}
async function publish(site){if(busy)return;if(hasPendingSiteChanges())return message('Save or discard unsaved file and website theme changes before publishing.',true);if(!confirm(`Publish “${site.name}” publicly at ${urlFor(site)}? Publishing creates a new unique sites/${site.slug}/ folder and never updates an existing published folder. Only publish trusted static files; scripts run on the GitHub Pages origin.`))return;await simpleAction('publish',{siteId:site.id||site.$id},'Publish requested. GitHub Pages may take time to update.');}
async function getFile(site,file){const r=await backend(site.kind==='original'?'getOriginalFile':'getFile',{siteId:site.id||site.$id,path:file.path,sha:file.sha,commit:site.commit});if(typeof r.content!=='string')throw Error('Sites service did not return base64 file content.');return{bytes:Uint8Array.from(atob(r.content),c=>c.charCodeAt(0)),mime:r.mime||file.mime||'application/octet-stream'};}
async function download(site,file){if(busy)return;busy=true;render();message(`Downloading ${file.path}…`);try{const d=await getFile(site,file),a=document.createElement('a'),u=URL.createObjectURL(new Blob([d.bytes],{type:d.mime}));a.href=u;a.download=file.path.split('/').pop();a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);message('Download ready.');}catch(e){message(e.message||'Download failed.',true);}finally{busy=false;render();}}
async function downloadZip(site){if(busy)return;busy=true;render();message(`Preparing ZIP for ${site.name}…`);try{const entries=[];for(let i=0;i<(site.files||[]).length;i++){const f=site.files[i];message(`Adding ${i+1}/${site.files.length}: ${f.path}`);const d=await getFile(site,f);entries.push({name:f.path,data:d.bytes});}const blob=new Blob([createZip(entries)],{type:'application/zip'}),a=document.createElement('a'),u=URL.createObjectURL(blob);a.href=u;a.download=`${site.slug}.zip`;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);message(`ZIP ready (${entries.length} files; folder structure preserved).`);}catch(e){message(e.message||'ZIP export failed.',true);}finally{busy=false;render();}}
async function edit(site,file){if(busy||!leaveSiteEditor())return;busy=true;render();message(`Loading ${file.path}…`);try{if(!EDITABLE.has(file.path.split('.').pop().toLowerCase()))throw Error('This file type is not supported by the text editor.');if(file.size>EDIT_LIMIT)throw Error('Text editor is limited to 512 KiB per file.');const d=await getFile(site,file);editor={siteId:site.id||site.$id,path:file.path,readOnly:!lockable(site),text:new TextDecoder('utf-8',{fatal:true}).decode(d.bytes)};editor.savedText=editor.text;message(`${lockable(site)?'Editing':'Viewing read-only'} ${file.path}. ${lockable(site)?'Saving changes only this draft.':'Duplicate this website to edit a separate copy.'}`);}catch(e){message(e.message||'Could not load file.',true);}finally{busy=false;render();}}
async function saveEditor(){if(busy||!editor)return;if(themeDirty())return message('Save the website theme before saving this file, or discard the theme changes first.',true);const site=sites.find(s=>(s.id||s.$id)===editor.siteId);if(!site||!lockable(site))return message('Only drafts can be edited. Duplicate a published site first.',true);const bytes=new TextEncoder().encode(editor.text);if(bytes.length>EDIT_LIMIT)return message('Edited text files are limited to 512 KiB.',true);if(editor.path==='site-content.json'){try{const parsed=JSON.parse(editor.text);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error();}catch{return message('site-content.json must contain a valid JSON object before saving.',true);}}busy=true;render();try{const ext=editor.path.split('.').pop().toLowerCase(),r=await backend('uploadFile',{siteId:editor.siteId,path:safePath(editor.path),content:bytesToBase64(bytes),mime:MIME[ext]||'text/plain'});if(r.site)sites=sites.map(s=>(s.id||s.$id)===editor.siteId?r.site:s);editor=null;await refresh(true,true);const saved=sites.find(s=>(s.id||s.$id)===site.id||(s.id||s.$id)===site.$id);if(saved){siteThemes.delete(saved.id||saved.$id);await inspectSiteTheme(saved);}message('New immutable file version uploaded.');}catch(e){message(e.message||'Could not save file.',true);}finally{busy=false;render();}}
function setAt(obj,path,value){const keys=path.split('.');let o=obj;for(const k of keys.slice(0,-1))o=o[k];o[keys.at(-1)]=value;}
function syncWhatsApp(content){if(typeof content?.contact?.phone==='string'&&content.contact.phone.trim()){const digits=content.contact.phone.replace(/\D/g,'');if(digits)content.contact.whatsappUrl=`https://wa.me/${digits}`;}}
function guidedGroup(parent,value,path,label){
  if(value&&typeof value==='object'){
    const group=el('details','guided-group');group.append(el('summary','',label));
    for(const [key,child] of Object.entries(value))guidedGroup(group,child,path?`${path}.${key}`:key,Array.isArray(value)?`${label} ${Number(key)+1}`:key);
    parent.append(group);return;
  }
  if(!['string','number','boolean'].includes(typeof value))return;
  const wrap=el('label','content-field',label.replace(/([A-Z])/g,' $1'));
  const input=typeof value==='string'&&(value.includes('\n')||value.length>100)?document.createElement('textarea'):document.createElement('input');
  if(typeof value==='boolean'){input.type='checkbox';input.checked=value;}else{input.value=String(value);if(typeof value==='number')input.type='number';}
  input.setAttribute('aria-label',path.replace(/[.\[\]]/g,' '));input.disabled=busy;
  input.addEventListener('input',()=>{const next=typeof value==='number'?Number(input.value):typeof value==='boolean'?input.checked:input.value;setAt(editor.content,path,next);if(path==='contact.phone')syncWhatsApp(editor.content);editor.text=JSON.stringify(editor.content,null,2);updateEditorState();if(editor.jsonArea)editor.jsonArea.value=editor.text;});
  wrap.append(input);parent.append(wrap);
}
function updateEditorState(){const n=root?.querySelector('[data-editor-state]');if(n)n.textContent=editorDirty()?'Unsaved file changes — Save new version before leaving.':'No unsaved file changes.';}
function renderEditor(){if(!editor)return;const site=sites.find(s=>(s.id||s.$id)===editor.siteId);if(!site)return;const box=el('section','site-editor'),title=el('h2','',`${editor.readOnly?'View':'Edit'} ${editor.path}`);box.append(title,el('p','site-note',editor.readOnly?'Read-only source file. Duplicate the website to edit an independent copy.':'Changes apply only to this draft. Save before publishing.'));if(editor.content){const grid=el('div','content-fields');for(const [key,value] of Object.entries(editor.content))guidedGroup(grid,value,key,key);box.append(el('h3','','Guided content fields'),grid);}const area=document.createElement('textarea');area.value=editor.text;area.spellcheck=false;area.setAttribute('aria-label','Raw file contents (advanced)');area.disabled=busy;area.readOnly=Boolean(editor.readOnly);area.addEventListener('input',()=>{editor.text=area.value;updateEditorState();});area.addEventListener('blur',()=>{if(editor.path==='site-content.json'){try{const parsed=JSON.parse(area.value);editor.content=parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:null;}catch{editor.content=null;}}});editor.jsonArea=area;const editState=el('p','site-note',editorDirty()?'Unsaved file changes — Save new version before leaving.':'No unsaved file changes.');editState.dataset.editorState='';editState.setAttribute('role','status');if(!editor.readOnly)box.append(editState);box.append(el('details','',undefined));const details=box.lastChild;details.open=!editor.content;const summary=el('summary','',editor.readOnly?'Read-only file contents':editor.content?'Advanced: edit raw JSON/text':'Edit file contents');details.append(summary,area);const actions=el('div','site-actions'),save=el('button','button primary','Save new version');save.type='button';save.disabled=busy;save.onclick=saveEditor;const close=el('button','button ghost','Close editor');close.type='button';close.disabled=busy;close.onclick=()=>{if(editorDirty()&&!confirm('Discard unsaved changes to this file?'))return;editor=null;render();};if(!editor.readOnly)actions.append(save);actions.append(close);box.append(actions);root.append(box);box.scrollIntoView({behavior:'smooth',block:'start'});}
function field(parent,label,value,onchange,placeholder=''){const i=document.createElement('input');i.value=value;i.placeholder=placeholder;i.setAttribute('aria-label',label);i.disabled=busy;i.addEventListener('input',()=>onchange(i.value));parent.append(i);return i;}
function actionButton(parent,text,fn,disabled=false,cls='button ghost'){const b=el('button',cls,text);b.type='button';b.disabled=busy||disabled;b.onclick=fn;parent.append(b);return b;}
async function openSite(s){if(busy||!leaveSiteEditor())return;selectedSite=s.$id||s.id;workspace='';editor=null;busy=true;render();try{await inspectSiteTheme(s);}finally{busy=false;render();root.scrollIntoView({behavior:'smooth',block:'start'});}}
function startDuplicate(s){if(busy||!leaveSiteEditor())return;duplicateSource=s.$id||s.id;duplicateName=`${s.name} copy`;duplicateSlug=slugify(s.kind==='original'?'adeel-portfolio-copy':`${s.slug}-copy`);duplicateSlugTouched=false;workspace='duplicate';editor=null;render();root.querySelector('[aria-label="Duplicate name"]')?.focus();}
function renderImport(parent){
 const box=el('section','site-box');box.append(el('h2','','Upload a new website'),el('p','','Upload your own or AI-generated, already-built index.html, CSS, JavaScript, images and other static files. This creates a separate draft, not a replacement for another website.'));
 const fields=el('div','site-name-fields');const ni=field(fields,'New site name',importName,v=>{importName=v;if(!importSlugTouched){importSlug=slugify(v);si.value=importSlug;}});ni.placeholder='Website name';const si=field(fields,'New site address slug',importSlug,v=>{importSlug=v;importSlugTouched=true;},'my-new-website');if(pendingImport){ni.disabled=true;si.disabled=true;box.append(el('p','site-note',`Interrupted import: ${pendingImport.index}/${pendingImport.packed.length} files confirmed. Retry uses this same draft and resumes at the unconfirmed file. Keep this page open until finished.`));}box.append(fields,el('p','site-note','New address: /adeel-portfolio/sites/<your-slug>/ — use a new, unused slug.'));
 const folder=document.createElement('input');folder.type='file';folder.multiple=true;folder.setAttribute('webkitdirectory','');folder.setAttribute('directory','');folder.setAttribute('aria-label','Choose website folder');folder.disabled=busy||Boolean(pendingImport);folder.onchange=()=>{importFiles=[...folder.files];render();};const picker=el('label','site-drop');picker.append(el('span','','Choose a complete website folder (keeps CSS, JS and image subfolders)'),folder);box.append(picker);
 const files=document.createElement('input');files.type='file';files.multiple=true;files.setAttribute('aria-label','Choose multiple website files');files.disabled=busy||Boolean(pendingImport);files.onchange=()=>{importFiles=[...files.files];render();};const flat=el('label','site-drop');flat.append(el('span','','Or choose individual files (include index.html)'),files);box.append(flat);
 if(importFiles.length){try{const packed=unpack(importFiles);box.append(el('p','',`${packed.length} files selected · ${fmt(importFiles.reduce((n,f)=>n+f.size,0))}`));const preview=el('div','site-files');packed.forEach(f=>preview.append(el('p','site-meta',f.path)));box.append(preview);}catch(e){box.append(el('p','site-error',`${e.message} Choose only public, built website files and try again.`));}}
 const actions=el('div','site-actions');actionButton(actions,pendingImport?'Retry remaining uploads':'Upload as new draft',createImport,!importFiles.length,'button primary');actionButton(actions,pendingImport?'Stop retrying (keep draft)':'Cancel',()=>{if(pendingImport&&!confirm('Stop retrying this upload? The incomplete draft and its saved files will be kept.'))return;pendingImport=null;importFiles=[];workspace='';render();});box.append(actions,el('p','site-note','Next: open the draft, check/edit its files, then choose Publish new website. Uploading alone does not make a site live. Limits: 150 files, 2 MiB each, 40 MiB total. Folder upload works best on desktop; individual files can be selected on mobile.'));parent.append(box);
}
function renderDuplicate(parent){
 const box=el('section','site-box');box.append(el('h2','','Duplicate into a separate website'),el('p','','The source is never changed. Give the copy a new name and unused address, edit its draft, then publish it as a separate folder.'));
 const select=document.createElement('select');select.setAttribute('aria-label','Site to duplicate');select.disabled=busy;for(const s of sites){const o=el('option','',`${s.name} · ${s.kind==='original'?'original portfolio':s.status}`);o.value=s.$id||s.id;select.append(o);}select.value=duplicateSource;select.onchange=()=>duplicateSource=select.value;box.append(select);
 const fields=el('div','site-name-fields');field(fields,'Duplicate name',duplicateName,v=>{duplicateName=v;if(!duplicateSlugTouched){duplicateSlug=slugify(v);slugInput.value=duplicateSlug;}},'Name for the copy');const slugInput=field(fields,'Duplicate slug',duplicateSlug,v=>{duplicateSlug=v;duplicateSlugTouched=true;},'adeel-portfolio-copy');box.append(fields);
 const actions=el('div','site-actions');actionButton(actions,'Create independent copy',async()=>{if(!duplicateName.trim()||!validSlug(duplicateSlug.trim()))return message('Enter a name and a lowercase, hyphenated unique slug.',true);const source=sites.find(s=>(s.$id||s.id)===duplicateSource);if(!source)return message('Choose a source website.',true);await simpleAction(source.kind==='original'?'portfolioTemplate':'duplicate',{...(source.kind==='original'?{}:{sourceId:duplicateSource}),name:duplicateName.trim(),slug:duplicateSlug.trim()},'Independent draft created. Edit this copy, then publish it. The original has not changed.');},!duplicateSource,'button primary');actionButton(actions,'Cancel',()=>{workspace='';render();});box.append(actions);parent.append(box);
}
function renderDraftTools(card,s){
 const id=s.id||s.$id,details=el('details','site-file-tools-wrap');details.append(el('summary','','Add or replace a draft file'));const add=el('div','site-file-tools'),pathField=document.createElement('input');pathField.placeholder='relative/path.txt';pathField.setAttribute('aria-label',`New file path for ${s.name}`);pathField.disabled=busy;const textArea=document.createElement('textarea');textArea.placeholder='New text file contents';textArea.setAttribute('aria-label',`New text file contents for ${s.name}`);textArea.disabled=busy;
 const update=async(file)=>{if(busy)return;try{const p=safePath(pathField.value||file?.name||'');if(file){validatePaths([...(s.files||[]).filter(f=>f.path.toLowerCase()!==p.toLowerCase()).map(f=>f.path),p]);if(s.files?.some(f=>f.path.toLowerCase()===p.toLowerCase())&&!confirm(`Replace ${p} in this draft only?`))return;}else validatePaths([...(s.files||[]).map(f=>f.path),p]);const bytes=file?new Uint8Array(await file.arrayBuffer()):new TextEncoder().encode(textArea.value);if(bytes.length>(file?MAX_FILE:EDIT_LIMIT))throw Error(file?'File must be 2 MiB or smaller.':'Text files must be 512 KiB or smaller.');busy=true;render();message(`Uploading ${p}…`);await backend('uploadFile',{siteId:id,path:p,content:bytesToBase64(bytes),mime:file?.type||MIME[p.split('.').pop().toLowerCase()]||'application/octet-stream'});await refresh(true,true);message('Draft file saved. Other websites are unchanged.');}catch(e){message(e.message||'Could not save file.',true);}finally{busy=false;render();}};
 const b=el('button','mini','Add text file');b.type='button';b.disabled=busy;b.onclick=()=>update();const upload=document.createElement('input');upload.type='file';upload.disabled=busy;upload.setAttribute('aria-label',`Upload or replace file for ${s.name}`);upload.onchange=()=>{if(upload.files?.[0])update(upload.files[0]);};add.append(pathField,textArea,b,upload);details.append(el('p','site-note','Enter a relative path to keep subfolders, for example assets/logo.png. Replacements affect only this unpublished draft.'),add);card.append(details);
}
function renderSiteDetails(parent,s){
 const card=el('article','site-card site-detail');card.append(el('h2','',s.name),el('p','site-meta',`${s.kind==='original'?'Repository root (original portfolio)':s.repoPath||`sites/${s.slug}`} · ${s.files?.length||0} files · ${fmt((s.files||[]).reduce((n,f)=>n+(f.size||0),0))}`));
 const actions=el('div','site-actions');actionButton(actions,'← All websites',()=>{if(!leaveSiteEditor())return;selectedSite='';render();});actionButton(actions,s.kind==='original'?'Duplicate Adeel portfolio':'Duplicate as new website',()=>startDuplicate(s));
 if(s.publishedUrl){const a=el('a','button ghost','Open live website ↗');a.href=s.publishedUrl;a.target='_blank';a.rel='noopener noreferrer';actions.append(a);}
 actionButton(actions,'Download ZIP',()=>downloadZip(s),!s.files?.length);
 if(lockable(s)){if(s.files?.some(f=>f.path==='site-content.json'))actionButton(actions,'Edit site details',()=>openInfo(s));actionButton(actions,'Publish new website',()=>publish(s),!s.files?.some(f=>f.path==='index.html'),'button primary');}
 if(s.kind!=='original'&&['published','publishing'].includes(s.status))actionButton(actions,'Check live status',()=>simpleAction('refresh',{siteId:s.id||s.$id},'Live status checked.'));
 card.append(actions);
 if(s.kind==='original'){card.append(el('p','site-note','This is your existing Adeel portfolio, not a template or a new copy. Its repository files are read-only here. Duplicate it to create a separately editable website without changing this original.'));const links=el('div','site-actions');for(const [label,tab] of [['Original website details','content'],['Original projects','projects'],['Original services','services'],['Original media','media'],['Original inbox','messages']]){const b=el('button','button ghost',label);b.type='button';b.disabled=busy;b.dataset.go=tab;links.append(b);}card.append(links,el('p','site-note','These original-only sections open the existing portfolio editor. Saving there changes only the original portfolio. Duplicate sites have their own files and local content.'));}
 else if(lockable(s)){card.append(el('p','site-note','Draft: edit HTML/CSS/JS below, add files, or edit site details for a portfolio copy. When ready, Publish creates a new folder in the same GitHub repository.'));renderDraftTools(card,s);}
 else card.append(el('p','site-note','Published folders are protected from overwrite. To make changes, duplicate this website with a new slug, edit the copy, and publish the new version.'));
 renderSiteTheme(card,s);if(s.error)card.append(el('p','site-error',s.error));card.append(el('h3','','Website files'));const files=el('div','site-files');for(const f of s.files||[]){const row=el('div','site-file');row.append(el('span','',`${f.path} · ${fmt(f.size||0)}`));const text=EDITABLE.has(f.path.split('.').pop().toLowerCase())&&f.size<=EDIT_LIMIT;if(text)actionButton(row,lockable(s)?'Edit':'View',()=>edit(s,f),false,'mini');actionButton(row,'Download',()=>download(s,f),false,'mini');files.append(row);}card.append(files);parent.append(card);
}
function render(){
 if(!root)return;root.replaceChildren();const status=el('p','inline-state',notice);status.id='sites-state';status.classList.toggle('site-error',noticeError);status.setAttribute('role',noticeError?'alert':'status');root.append(status);
 const toolbar=el('div','site-actions site-toolbar');actionButton(toolbar,'+ Upload new website',()=>{if(!leaveSiteEditor())return;workspace='import';render();root.querySelector('[aria-label="New site name"]')?.focus();},false,'button primary');const count=sites.filter(s=>s.kind==='original'||s.status==='published').length;toolbar.append(el('span','site-meta',`${count} published website${count===1?'':'s'} · ${sites.filter(s=>s.status==='draft').length} drafts`));root.append(toolbar);
 if(workspace==='import')renderImport(root);else if(workspace==='duplicate')renderDuplicate(root);
 else if(selectedSite){const s=sites.find(s=>(s.$id||s.id)===selectedSite);if(s)renderSiteDetails(root,s);else{selectedSite='';render();return;}}
 else{root.append(el('p','site-note','Each card is one website. Open it to see its files and details. Upload or duplicate to add another website; publishing gives it a separate folder in this same repository.'));const list=el('div','site-list');root.append(list);if(!sites.length)list.append(el('p','empty',busy?'Loading websites…':'No websites loaded. Choose Refresh websites to retry.'));for(const s of sites){const card=el('article','site-card site-folder'),head=el('div','site-card-head'),title=el('div');title.append(el('h2','',s.name),el('p','site-meta',s.kind==='original'?'Original portfolio · repository root':`/sites/${s.slug}/ · ${s.files?.length||0} files`));head.append(title,el('span',`site-badge ${s.status}`,s.kind==='original'?'original · live':s.status));card.append(head);const actions=el('div','site-actions');actionButton(actions,'Open files & details',()=>openSite(s),false,'button primary');actionButton(actions,'Duplicate',()=>startDuplicate(s));if(s.publishedUrl){const a=el('a','button ghost','Open live ↗');a.href=s.publishedUrl;a.target='_blank';a.rel='noopener noreferrer';actions.append(a);}card.append(actions);list.append(card);}}
 const safety=el('p','site-note','Trusted static websites only. No server-side builds or PHP/Node hosting. Never upload passwords, API keys, .env, .git or node_modules. Uploaded JavaScript shares the GitHub Pages origin, so publish only code you trust. Existing folders are never overwritten.');root.append(safety);renderEditor();
}
async function openInfo(site){const f=site.files?.find(x=>x.path==='site-content.json');if(!f)return message('This site has no site-content.json. Edit its HTML/CSS/JS files instead.',true);await edit(site,f);if(editor){try{const parsed=JSON.parse(editor.text);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)){editor.content=parsed;message('Edit this copy’s details below. The original portfolio is unchanged.');render();}}catch{message('Invalid JSON. Use the raw text editor to repair it.',true);}}}
export async function initSitesManager(){if(!root)return;if(!initialized){initialized=true;document.querySelector('#site-refresh')?.addEventListener('click',()=>refresh());render();}await refresh();}
export {safePath,validatePaths,slugify,validSlug};

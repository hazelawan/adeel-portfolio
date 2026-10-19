'use strict';
const $=s=>document.querySelector(s);
const menu=$('.menu'),nav=$('#main-nav');
function closeMenu(restoreFocus=false){nav.classList.remove('open');menu.setAttribute('aria-expanded','false');menu.setAttribute('aria-label','Open menu');if(restoreFocus)menu.focus();}
menu.addEventListener('click',()=>{const open=nav.classList.toggle('open');menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',open?'Close menu':'Open menu');});
nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>closeMenu()));
document.addEventListener('click',e=>{if(!e.target.closest('.header'))closeMenu();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&nav.classList.contains('open'))closeMenu(true);});
matchMedia('(min-width:701px)').addEventListener('change',e=>{if(e.matches)closeMenu();});
const words=['websites.','web apps.','online stores.','AI videos.'],word=$('#word'),reduce=matchMedia('(prefers-reduced-motion: reduce)');
let wi=0,index=words[0].length,deleting=true;
function type(){if(reduce.matches){word.textContent='websites.';return;}const text=words[wi];if(deleting){index--;word.textContent=text.slice(0,index);if(index===0){deleting=false;wi=(wi+1)%words.length;setTimeout(type,280);return;}}else{index++;word.textContent=text.slice(0,index);if(index===words[wi].length){deleting=true;setTimeout(type,2500);return;}}setTimeout(type,deleting?45:90);}
if(!reduce.matches)setTimeout(type,3000);
function clock(){$('#clock').textContent=new Date().toLocaleTimeString('en-GB',{timeZone:'Asia/Karachi',hour:'2-digit',minute:'2-digit'});}clock();setInterval(clock,30000);$('#year').textContent=new Date().getFullYear();
const serviceRows=[...document.querySelectorAll('.service')];
function selectService(row){serviceRows.forEach(r=>{const on=r===row;r.classList.toggle('selected',on);r.setAttribute('aria-expanded',String(on));});}
if(matchMedia('(max-width:700px)').matches)selectService(null);
serviceRows.forEach(row=>{
 row.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'&&matchMedia('(min-width:701px)').matches)selectService(row);});
 row.addEventListener('focus',()=>{if(row.matches(':focus-visible'))selectService(row);});
 row.addEventListener('click',()=>{const mobile=matchMedia('(max-width:700px)').matches;selectService(mobile&&row.classList.contains('selected')?null:row);});
});
const dialog=$('#preview'),video=$('#preview-video');let returnFocus=null;
function showPreview(src,title,intro=false){returnFocus=document.activeElement;$('#preview-title').textContent=title;$('#preview-note').textContent=intro?'Adeel Younas · Original animated introduction':'Project showcase · Adeel Younas / Wanhar Tech';dialog.classList.toggle('intro-dialog',intro);video.src=src;video.muted=false;video.loop=false;dialog.showModal();document.body.classList.add('modal-open');video.play().catch(()=>{});}
document.querySelectorAll('[data-video]').forEach(button=>button.addEventListener('click',()=>showPreview(button.dataset.video,button.dataset.title)));
const avatar=$('#avatar'),sound=$('#sound'),introduce=$('#introduce');
function setSound(on,restart=false){if(restart)avatar.currentTime=0;avatar.muted=!on;avatar.loop=!on;sound.innerHTML=on?'Sound on <span aria-hidden="true">◉</span>':'Sound off <span aria-hidden="true">◌</span>';sound.setAttribute('aria-label',on?'Mute introduction':'Turn introduction sound on');introduce.querySelector('span:last-child').textContent=on?'Introducing…':'Introduce';avatar.play().catch(()=>{});}
introduce.addEventListener('click',()=>setSound(true,true));sound.addEventListener('click',()=>setSound(avatar.muted));avatar.addEventListener('ended',()=>setSound(false,true));
if(reduce.matches){avatar.pause();avatar.autoplay=false;}
const avatarObserver=new IntersectionObserver(entries=>entries.forEach(e=>{if(!e.isIntersecting)avatar.pause();else if(!reduce.matches)avatar.play().catch(()=>{});}),{threshold:.1});avatarObserver.observe(avatar);
$('#close-preview').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
dialog.addEventListener('close',()=>{video.pause();video.removeAttribute('src');video.load();document.body.classList.remove('modal-open');if(returnFocus&&returnFocus.isConnected)returnFocus.focus({preventScroll:true});});
const sections=new IntersectionObserver(entries=>{entries.forEach(e=>{if(e.isIntersecting)nav.querySelectorAll('a').forEach(a=>a.classList.toggle('active',a.getAttribute('href')==='#'+e.target.id));});},{rootMargin:'-10% 0px -70% 0px'});
document.querySelectorAll('main section[id]').forEach(s=>sections.observe(s));

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../sites-manager.js',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('let sessionToken='),source.indexOf('const lockable='));
function harness({responses=[],admin=true}={}){
  let issued=0,requests=0;
  class Client {setEndpoint(){return this;} setProject(){return this;}}
  class Account {async createJWT(){return {jwt:`session-${++issued}`};}}
  const api=new Function('Account','Client','config','currentUser','fetch',helpers+'\nreturn {backend,sessionJWT};')(Account,Client,{endpoint:'https://identity.test',projectId:'project'},async()=>({$id:'owner',labels:admin?['portfolioAdmin']:[]}),async(url,init)=>{
    if(url==='./sites-config.json')return new Response(JSON.stringify({enabled:true,endpoint:'https://edge.test'}));
    requests++;const status=responses.shift()||200;
    return new Response(JSON.stringify(status===200?{ok:true,jwtSeen:JSON.parse(init.body).jwt}:{ok:false,error:'denied'}),{status});
  });
  return {...api,get issued(){return issued;},get requests(){return requests;}};
}
test('multi-file requests reuse short-lived in-memory session JWT',async()=>{
  const h=harness();for(let n=0;n<33;n++)await h.backend('getFile',{path:`asset-${n}.png`});
  assert.equal(h.issued,1);assert.equal(h.requests,33);
});
test('authentication rejection refreshes JWT once before retry',async()=>{
  const h=harness({responses:[401,200]});const r=await h.backend('list');
  assert.equal(h.issued,2);assert.equal(h.requests,2);assert.equal(r.jwtSeen,'session-2');
});
test('upstream errors and non-admin requests never replay mutations',async()=>{
  const h=harness({responses:[502]});await assert.rejects(()=>h.backend('publish'),/denied/);assert.equal(h.requests,1);
  const blocked=harness({admin:false});await assert.rejects(()=>blocked.backend('publish'),/Administrator/);assert.equal(blocked.issued,0);assert.equal(blocked.requests,0);
});

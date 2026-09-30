import { execFileSync } from 'node:child_process';
import { connect } from './t33-cdp.mjs';
import fs from 'node:fs';
const mode=process.argv[2]||'hosted', id=mode==='hosted'?'com.stremio.webos.hello.hosted':'com.stremio.webos.t34.fixture';
const cli=process.env.APPDATA+'/npm/node_modules/@webos-tools/cli/bin/ares-launch.js';
const launch=(app,params)=>execFileSync(process.execPath,[cli,'--device','emulator',app,...(params===undefined?[]:['--params',JSON.stringify(params)])],{encoding:'utf8'});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const c=await connect(mode==='hosted'?'http:':'t34.fixture','http://localhost:51760');
const results=[];
const state=()=>c.evaluate(`({hash:location.hash,boot:window.__t34boot||window.__t34?.boot,hidden:document.hidden,history:history.length,events:window.__t34events,fixture:window.__t34,video:document.querySelector('video')?{paused:document.querySelector('video').paused,time:document.querySelector('video').currentTime}:null})`.replace('window.__t34?.boot','(window.__t34&&window.__t34.boot)'));
try{
 await c.evaluate(`window.__t34boot=Date.now();window.__t34events=[];['webOSLaunch','webOSRelaunch','visibilitychange'].forEach(function(type){document.addEventListener(type,function(e){window.__t34events.push({type:type,detail:e.detail,hidden:document.hidden})})})`);
 const version=await c.send('Browser.getVersion');
 for(const [label,params] of [['route',{url:'stremio:///settings'}],['relaunch',{url:'stremio:///addons?addon=https%3A%2F%2Faddon.example%2Fmanifest.json'}],['empty',{}],['invalid',{url:'https://example.org'}]]){
  const output=launch(id,params);await delay(1200);results.push({label,output,state:await state()});
 }
 if(mode==='packaged'){
  for(const enabled of [true,false]){
   launch(id,{});await delay(600);
   await c.evaluate(`window.__t34.setEnabled(${enabled});document.querySelector('video').play().catch(function(){})`);await delay(700);
   results.push({label:'before-hide-'+enabled,state:await state()});
   launch('com.stremio.webos.hello.packaged');await delay(800);results.push({label:'hidden-'+enabled,state:await state()});
   launch(id,{});await delay(800);results.push({label:'return-'+enabled,state:await state()});
  }
 }
 const report={date:new Date().toISOString(),mode,version,results};fs.writeFileSync('tests/webos/t34-runtime-'+mode+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{c.close();setTimeout(()=>process.exit(),100);}

import {connect} from './t33-cdp.mjs';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
const c=await connect('http:','http://localhost:51760');
const launch=app=>execFileSync(process.execPath,[process.env.APPDATA+'/npm/node_modules/@webos-tools/cli/bin/ares-launch.js','-d','emulator',app],{encoding:'utf8'});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const state=()=>c.evaluate(`({hidden:document.hidden,playerRoute:location.hash.indexOf('#/player/')===0,video:document.querySelector('video')?{paused:document.querySelector('video').paused,time:document.querySelector('video').currentTime,ready:document.querySelector('video').readyState}:null})`);
const results=[];
try{
 await c.evaluate(`window.core.getState('ctx').then(function(s){window.__t34Settings=s.profile.settings;return true})`);
 for(const enabled of [true,false]){
  await c.evaluate(`window.core.dispatch({action:'Ctx',args:{action:'UpdateSettings',args:Object.assign({},window.__t34Settings,{pauseOnMinimize:${enabled}})}});true`);
  if(enabled)await c.evaluate(`window.core.encodeStream({name:'T3.4 synthetic test',url:'http://10.0.2.2:8096/t33-test.mp4'}).then(function(s){location.hash='#/player/'+encodeURIComponent(s);return true})`);
  await delay(2000);
  await c.evaluate(`document.querySelector('video').play().catch(function(){});true`);await delay(1000);
  results.push({label:'playing-'+enabled,state:await state()});
  launch('com.stremio.webos.hello.packaged');await delay(1500);results.push({label:'hidden-'+enabled,state:await state()});
  launch('com.stremio.webos.hello.hosted');await delay(1500);results.push({label:'return-'+enabled,state:await state()});
 }
 fs.writeFileSync('tests/webos/t34-player-hosted.json',JSON.stringify({date:new Date().toISOString(),results},null,2));console.log(results);
}finally{await c.evaluate(`window.core.dispatch({action:'Ctx',args:{action:'UpdateSettings',args:window.__t34Settings}});if(document.querySelector('video'))document.querySelector('video').pause();true`);c.close();setTimeout(()=>process.exit(),100);}


import {execFileSync} from 'node:child_process';import {connect} from './t33-cdp.mjs';import fs from 'node:fs';
const cli=process.env.APPDATA+'/npm/node_modules/@webos-tools/cli/bin/ares-launch.js',id='com.stremio.webos.t34.fixture';
execFileSync(process.execPath,[cli,'-d','emulator','--close',id]);
execFileSync(process.execPath,[cli,'-d','emulator',id,'--params',JSON.stringify({url:'stremio:///metadetails/movie/tt123'})]);
await new Promise(r=>setTimeout(r,1800));const c=await connect('t34.fixture','http://localhost:51760');
try{let state;for(let i=0;i<30;i++){state=await c.evaluate(`({hash:location.hash,events:window.__t34&&window.__t34.events,history:history.length})`);if(state.hash==='#/metadetails/movie/tt123')break;await new Promise(r=>setTimeout(r,500));}const report={date:new Date().toISOString(),state,passed:state.hash==='#/metadetails/movie/tt123'};fs.writeFileSync('tests/webos/t34-cold-launch.json',JSON.stringify(report,null,2));console.log(report);process.exitCode=report.passed?0:1;}finally{c.close();setTimeout(()=>process.exit(process.exitCode||0),100);}

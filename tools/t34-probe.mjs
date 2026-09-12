import {connect} from './t33-cdp.mjs';
import fs from 'node:fs';
const c=await connect(process.argv[2] || 'http:','http://localhost:51760');
try {console.log(JSON.stringify(await c.evaluate(process.argv[3] || `({hash:location.hash,hidden:document.hidden,state:window.__t34,video:document.querySelector('video')?{paused:document.querySelector('video').paused,time:document.querySelector('video').currentTime}:null})`),null,2));}finally{c.close();setTimeout(()=>process.exit(),100);}

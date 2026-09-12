import {connect} from './t33-cdp.mjs';
const c=await connect('http:','http://localhost:51760');
try{await c.send('Network.enable');await c.send('Network.setBypassServiceWorker',{bypass:true});await c.send('Network.setCacheDisabled',{cacheDisabled:true});await c.send('Page.reload',{ignoreCache:true});}finally{c.close();setTimeout(()=>process.exit(),100);}

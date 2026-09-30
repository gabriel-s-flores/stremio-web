import {connect} from './t33-cdp.mjs';
const c=await connect('loaderror','http://localhost:51760');
try{console.log(await c.send('Page.navigate',{url:'http://10.0.2.2:8094/?t34=final#/settings'})); await new Promise(r=>setTimeout(r,3000));console.log(await c.evaluate('({url:location.href,ready:!!window.core})'));}finally{c.close();setTimeout(()=>process.exit(),100);}

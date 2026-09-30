import fs from 'node:fs';
import { connect } from './t33-cdp.mjs';
const [hint, endpoint, origin] = process.argv.slice(2);
if (!origin || !/^https:\/\/(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(origin)) throw Error('Usage: targetHint CDP_URL localHTTPSOrigin');
const report = { origin, certificateErrors: [], passed: false };
const c = await connect(hint, endpoint, e => {
    if (e.method === 'Security.certificateError') report.certificateErrors.push(e.params.errorType);
    if (e.method === 'Network.loadingFailed' && /CERT|SSL/.test(e.params.errorText)) report.certificateErrors.push(e.params.errorText);
});
try {
    await c.send('Security.enable'); await c.send('Network.enable'); await c.send('Page.enable');
    const result = await c.send('Page.navigate', { url: origin });
    report.navigationError = result.errorText || null;
    await new Promise(r => setTimeout(r, 15000));
    report.state = await c.evaluate(`({atOrigin:location.origin===${JSON.stringify(origin)},secure:isSecureContext,chromium68:/Chrome\\/68\\./.test(navigator.userAgent),controller:!!(navigator.serviceWorker&&navigator.serviceWorker.controller),loadErrorCode:location.pathname.indexOf('loaderror.html')>=0?new URLSearchParams(location.search).get('errorCode'):null})`);
    report.passed = report.state.atOrigin && report.state.secure && report.state.controller && !report.navigationError && report.certificateErrors.length === 0;
} catch { report.infrastructureError = true; }
finally { c.close(); fs.writeFileSync('tests/webos/t36-https-preflight.json', JSON.stringify(report, null, 2)); }
console.log(JSON.stringify(report));
process.exitCode = report.passed ? 0 : 1;

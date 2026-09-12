import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { connect } from './t33-cdp.mjs';

const [mode, endpoint, hint] = process.argv.slice(2);
if (!['hosted', 'packaged'].includes(mode) || !endpoint || !hint) throw Error('Usage: node tools/t38-runtime.mjs hosted|packaged CDP_ENDPOINT EXACT_URL_HINT');
const report = { mode, date: new Date().toISOString(), checks: {}, browserLaunch: 'not-run' };
const c = await connect(hint, endpoint);
const wait = () => new Promise(resolve => setTimeout(resolve, 700));
const key = async (key, code, number) => {
    for (const type of ['keyDown', 'keyUp']) await c.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: number });
    await wait();
};
const launch = id => execFileSync(process.execPath, [path.join(process.env.APPDATA, 'npm/node_modules/@webos-tools/cli/bin/ares-launch.js'), '-d', 'emulator', id], { timeout: 30000, stdio: 'pipe' });
try {
    await c.evaluate(`window.__t38Calls=[];window.__t38OriginalRequest=webOS.service.request;
        webOS.service.request=function(uri,options){
            var call={uri:uri,method:options.method,parameters:options.parameters};
            window.__t38Calls.push(call);
            var failure=options.onFailure,success=options.onSuccess;
            return window.__t38OriginalRequest.call(this,uri,Object.assign({},options,{
                onFailure:function(error){call.failure={errorCode:error.errorCode,returnValue:error.returnValue,errorText:error.errorText};if(failure)failure(error)},
                onSuccess:function(result){call.success=!!result.returnValue;if(success)success(result)}
            }));
        };window.__t38InitialHash=location.hash`);
    for (const test of ['allowed', 'warning', 'failure']) {
        await c.evaluate(`document.querySelector('[data-test="${test}"]').focus()`);
        await key('Enter', 'Enter', 13);
        const sample = await c.evaluate(`({calls:window.__t38Calls.slice(),modal:!!document.querySelector('.modal-container'),url:(document.querySelector('input')||{}).value,hash:location.hash})`);
        report[test] = sample;
        const expected = test === 'warning' ? 'https://www.stremio.com/warning#' + encodeURIComponent('https://example.org/t38?test=1') : 'https://www.stremio.com/tos';
        const last = sample.calls[sample.calls.length - 1];
        report.checks[test + 'Payload'] = last.uri === 'luna://com.webos.applicationManager' && last.method === 'launch' && last.parameters.params.target === expected;
        report.checks[test + 'SingleEnter'] = sample.calls.length === ['allowed', 'warning', 'failure'].indexOf(test) + 1;
        if (sample.modal) {
            report.checks[test + 'SafeFallback'] = sample.url === expected;
            report.checks[test + 'Selection'] = await c.evaluate(`(function(){var input=document.querySelector('input');input.focus();input.click();return input.readOnly&&input.selectionStart===0&&input.selectionEnd===input.value.length})()`);
            if (test === 'warning') {
                await c.evaluate(`Array.from(document.querySelectorAll('.modal-container [tabindex]')).find(function(e){return e.textContent==='Copy link'}).click()`);
                await wait();
                report.copyStatus = await c.evaluate(`document.querySelector('[role="status"]').textContent`);
                report.checks.copyFeedback = !!report.copyStatus;
                const shot = await c.send('Page.captureScreenshot', { format: 'png' });
                fs.writeFileSync(`tests/webos/t38-modal-${mode}.png`, Buffer.from(shot.data, 'base64'));
            }
            await key('Escape', 'Escape', 27);
            report.checks[test + 'DismissAndFocus'] = await c.evaluate(`!document.querySelector('.modal-container')&&location.hash===window.__t38InitialHash&&document.activeElement.dataset.test==='${test}'`);
        }
        if (test === 'allowed') report.browserLaunch = last.success ? 'passed' : last.failure?.errorCode === -101 ? 'blocked-browser-not-installed' : 'failed';
    }
    // Real platform visibility/relaunch, using the other isolated fixture because this emulator lacks the browser.
    launch('com.stremio.webos.t38.' + (mode === 'hosted' ? 'packaged' : 'hosted'));
    await wait();
    launch('com.stremio.webos.t38.' + mode);
    await wait();
    report.visibility = await c.evaluate(`document.querySelector('[data-test="visibility"]').textContent`);
    report.checks.lifecycleWithSiblingApp = report.visibility.includes('hidden') && report.visibility.endsWith('visible');
    report.checks.routePreserved = await c.evaluate(`location.hash===window.__t38InitialHash`);
    await c.evaluate(`document.querySelector('[data-test="internal"]').click()`);
    report.checks.internalRoute = await c.evaluate(`location.hash==='#/debug'&&window.__t38Calls.length===3`);
    report.seamPassed = Object.values(report.checks).every(Boolean);
    report.acceptance = report.seamPassed && report.browserLaunch === 'passed' ? 'passed' : 'incomplete';
} finally {
    await c.evaluate(`if(window.__t38OriginalRequest)webOS.service.request=window.__t38OriginalRequest`).catch(() => {});
    c.close();
    fs.writeFileSync(`tests/webos/t38-runtime-${mode}.json`, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
}

import fs from 'node:fs';
import { bundleSize, assess } from './webos-quality.mjs';
import { connect } from './t33-cdp.mjs';
const [mode, ...args] = process.argv.slice(2);
if (mode === 'bundle') {
    console.log(JSON.stringify(bundleSize(args[0] || 'build'), null, 2));
} else if (mode === 'assess') {
    const metrics = JSON.parse(fs.readFileSync(args[0], 'utf8'));
    const result = assess(metrics);
    console.log(JSON.stringify(result, null, 2));
    if (Object.values(result).some(value => value !== 'pass')) process.exitCode = 1;
} else if (mode === 'collect') {
    const [endpoint, target, output, minutes = '0', action = 'observe'] = args;
    const duration = Number(minutes) * 60000;
    if (!endpoint || !target || !output || !Number.isFinite(duration) || duration < 0 ||
        !['observe', 'navigate'].includes(action)) throw Error('Invalid collection arguments; use --help');
    const report = { status: 'incomplete', startedAt: new Date().toISOString(), durationMs: duration,
        action, samples: [], exceptionCount: 0, crashCount: 0,
        limits: 'Page heap excludes worker/WASM, native and GPU memory. Synthetic arrows are not native RCU. No automatic E2E pass.' };
    const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    // Require a unique exact target, avoiding accidental attachment to another app.
    let c;
    try {
        const targets = await (await fetch(endpoint + '/json', { signal: AbortSignal.timeout(5000) })).json();
        const matches = targets.filter(t => t.type === 'page' && (t.id === target || t.url === target));
        if (matches.length !== 1) throw Error('Expected exactly one page target');
        if (targets.filter(t => t.type === 'page' && t.url.includes(matches[0].url)).length !== 1) {
            throw Error('Ambiguous page URL');
        }
        c = await connect(matches[0].url, endpoint, event => {
            if (event.method === 'Runtime.exceptionThrown') report.exceptionCount++;
            if (event.method === 'Inspector.targetCrashed') report.crashCount++;
        });
        await c.send('Runtime.enable');
        await c.send('Inspector.enable');
        const end = Date.now() + duration;
        let nextSample = 0, step = 0;
        const keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'];
        do {
            if (Date.now() >= nextSample) {
                const metrics = await c.send('Runtime.getHeapUsage');
                const page = await c.evaluate(`(function () {
                    var p = performance; var paint = p.getEntriesByType ? p.getEntriesByType('paint') : [];
                    return { userAgent: navigator.userAgent, hidden: document.hidden,
                        paint: paint.map(function(e) { return { name: e.name, startTime: e.startTime }; }),
                        videoCount: document.querySelectorAll('video').length,
                        diagnostics: (function () {
                            var api = window.__stremioWebosDebug; if (!api) return null;
                            var s = api.refresh();
                            return { marks: s.marks, fps: s.fps, memory: s.memory };
                        }()) };
                }())`);
                const d = page.diagnostics;
                const values = { firstPaintMs: page.paint.find(e => e.name === 'first-paint')?.startTime,
                    bootInteractiveMs: d?.marks['board-interactive'],
                    scrollFps: d?.fps.averageFps, frameP95Ms: d?.fps.p95FrameMs };
                report.samples.push({ at: new Date().toISOString(), heap: metrics, page,
                    budgets: assess(values) });
                save(); nextSample = Date.now() + 30 * 60000;
            }
            if (action === 'navigate') {
                const key = keys[step++ % keys.length];
                const code = { ArrowDown: 40, ArrowRight: 39, ArrowUp: 38, ArrowLeft: 37 }[key];
                await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
                await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
            }
            if (Date.now() >= end) break;
            await new Promise(resolve => setTimeout(resolve, Math.min(action === 'navigate' ? 1000 : 10000, end - Date.now())));
        } while (true);
        report.samples.push({ at: new Date().toISOString(), heap: await c.send('Runtime.getHeapUsage') });
        report.status = report.exceptionCount || report.crashCount ? 'errors-observed' : 'collection-complete';
    } catch (error) {
        report.status = 'blocked'; report.error = error.message;
        process.exitCode = 1;
    } finally { if (c) c.close(); save(); }
} else {
    console.log('bundle [BUILD_DIR]\nassess METRICS_JSON (numeric T0.6 keys; exit 1 if missing/failing)\ncollect CDP_ENDPOINT EXACT_TARGET_ID_OR_URL OUTPUT_JSON [MINUTES=0] [observe|navigate]\nNode 22 required. Observe playback for 240 minutes; navigate for 480. Samples every 30 minutes. Stop with Ctrl-C; partial report is preserved.');
    if (mode !== '--help') process.exitCode = 1;
}

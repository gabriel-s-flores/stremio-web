// node tools/t41-navigation-runner.mjs <private-config.json>
// Same existing-target CDP transport as T2.5; never launches a UA-spoofed browser.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import validateRuntime from './t41-runtime.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'tests/webos');
fs.mkdirSync(out, { recursive: true });
const summary = { date: new Date().toISOString(), accepted: false, failures: [], reports: [] };
const required = ['board', 'discover', 'library', 'continuewatching', 'calendar', 'detail', 'search', 'settings', 'addons', 'intro', 'player',
    'episodes', 'streams', 'library-authenticated', 'continuewatching-authenticated', 'settings-urls', 'settings-add-form',
    'addons-cards', 'addons-filters', 'addons-details', 'addons-share', 'addons-remove-confirm', 'player-controlbar',
    'player-options', 'player-speed', 'player-subtitles', 'player-audio', 'player-statistics', 'player-cast', 'player-sidedrawer', 'player-nextvideo',
    'horizontal-scroll', 'grid-scroll', 'lazy-load'];
const optional = ['shortcuts-modal', 'gamepad-modal', 'toast', 'update-banner'];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
const write = (name, value) => fs.writeFileSync(path.join(out, `t41-${name}.json`), JSON.stringify(value, null, 2) + '\n');
try {
    if (!process.argv[2]) throw Error('A private JSON configuration path is required');
    const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
    if (config.diagnostic) summary.failures.push('diagnostic-only: acceptance disabled');
    if (!config.endpoint || !config.targetHint || !Array.isArray(config.states)) throw Error('Config requires endpoint, targetHint and states');
    const response = await fetch(config.endpoint + '/json', { signal: AbortSignal.timeout(10000) });
    const targets = await response.json();
    const matches = targets.filter(t => t.type === 'page' && [t.id, t.url, t.title].some(v => v?.includes(config.targetHint)));
    if (matches.length !== 1) throw Error('Target hint must match exactly one page');
    ws = new WebSocket(matches[0].webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(Error('CDP connection failed')); });
    let id = 0;
    const pending = new Map();
    const onMessage = ({ data }) => {
        const message = JSON.parse(data), job = pending.get(message.id);
        if (job) {
            pending.delete(message.id); clearTimeout(job.timer);
            message.error ? job.reject(Error('CDP command failed: ' + job.method)) : job.resolve(message.result);
        }
    };
    ws.onmessage = onMessage;
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const n = ++id;
        const timer = setTimeout(() => { pending.delete(n); reject(Error('CDP timeout: ' + method)); }, 15000);
        pending.set(n, { resolve, reject, timer, method }); ws.send(JSON.stringify({ id: n, method, params }));
    });
    const evaluate = async expression => {
        const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        // Never serialize exceptionDetails: evaluated private setup can contain credentials/URLs.
        if (r.exceptionDetails) throw Error('Page evaluation failed (private expression omitted)');
        return r.result.value;
    };
    const reconnectOnce = async () => {
        const pages = await (await fetch(config.endpoint + '/json', { signal: AbortSignal.timeout(10000) })).json();
        const candidates = pages.filter(t => t.type === 'page' && [t.id, t.url, t.title].some(v => v?.includes(config.targetHint)));
        if (candidates.length !== 1) throw Error('Target unavailable after navigation');
        ws.close();
        ws = new WebSocket(candidates[0].webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(Error('CDP reconnection failed')); });
        ws.onmessage = onMessage;
        await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
        await send('Network.setCacheDisabled', { cacheDisabled: true });
        await send('Network.setBypassServiceWorker', { bypass: true });
    };
    const reconnect = async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
            try { await reconnectOnce(); return; }
            catch (error) {
                if (attempt === 2) throw error;
                // Retry only transport setup, never an Enter or an application action.
                if (ws) ws.close();
                await delay(250);
            }
        }
    };
    const key = async name => {
        const code = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Enter: 13, Escape: 27 }[name];
        if (!code) throw Error('Unsupported runner key');
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code,
            ...(name === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
        await delay(config.keyDelayMs || 120);
    };
    await send('Page.enable'); await send('Runtime.enable');
    for (let attempt = 0; attempt < 100 && !await evaluate('!!window.__stremioWebosDebug'); attempt++) await delay(200);
    if (!await evaluate('!!window.__stremioWebosDebug')) throw Error('A webOS debug build is required');
    const version = await send('Browser.getVersion');
    const metrics = await send('Page.getLayoutMetrics');
    const identity = await evaluate('({ua:navigator.userAgent,width:innerWidth,height:innerHeight,scale:window.visualViewport ? visualViewport.scale : null,devicePixelRatio:devicePixelRatio})');
    const runtimeCheck = validateRuntime(version, metrics, identity, config.browserCommandLine);
    summary.runtime = runtimeCheck.runtime;
    summary.runtimeGatePassed = runtimeCheck.failures.length === 0;
    summary.failures.push(...runtimeCheck.failures);
    if (runtimeCheck.failures.length && !config.diagnostic) throw Error('Runtime gate failed');
    await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Network.setBypassServiceWorker', { bypass: true });
    const probe = fs.readFileSync(path.join(root, 'tools/t41-navigation-probe.js'), 'utf8');
    const covered = new Set();
    for (const state of config.states) {
        if (!/^[a-z0-9-]+$/.test(state.name) || !state.route || !state.ready || !Array.isArray(state.rules)) throw Error('Invalid state: name, route, ready and rules required');
        for (const tag of state.tags || []) {
            const route = tag.startsWith('player') ? /^\/player\/.+/ :
                tag.startsWith('addons') ? /^\/addons(?:[/?]|$)/ :
                    tag.startsWith('settings') ? /^\/settings(?:[/?]|$)/ :
                        tag.startsWith('library') ? /^\/library(?:[/?]|$)/ :
                            tag.startsWith('continuewatching') ? /^\/continuewatching(?:[/?]|$)/ :
                                ['detail', 'episodes', 'streams'].includes(tag) ? /^\/detail\/.+/ : null;
            if (route && !route.test(state.route)) throw Error('Coverage tag requires its real route: ' + tag);
            if (['horizontal-scroll', 'grid-scroll', 'lazy-load'].includes(tag) && !state.after?.assert) throw Error('Scroll coverage requires an after assertion: ' + tag);
        }
        for (const rule of state.rules) {
            if (!rule.selector || !['safe', 'unsafe', 'deferred', 'structure'].includes(rule.kind) || (rule.kind !== 'safe' && !rule.reason)) throw Error('Every classification requires a selector, kind and exclusion reason');
            if (rule.kind === 'safe' && !rule.expect) throw Error('Safe Enter actions require explicit expected click/submit counts and effect assertion');
        }
        const report = { name: state.name, date: new Date().toISOString(), tags: state.tags || [], failures: [], controls: [], edges: [], enter: [] };
        const seen = new Map(), visited = new Set(), queue = [], explored = new Set();
        const setup = async () => {
            report.stage = 'connect';
            await reconnect();
            // Full reload isolates menu state, event listeners and previous Enter effects.
            report.stage = 'navigate';
            await evaluate(`location.hash = ${JSON.stringify('#' + state.route)}`);
            await delay(350);
            await send('Page.reload', { ignoreCache: true });
            await delay(state.waitMs || 2000);
            await reconnect();
            report.stage = 'base-ready';
            if (state.baseReady) {
                for (let attempt = 0; attempt < 100 && !await evaluate(`!!(${state.baseReady})`); attempt++) await delay(200);
                if (!await evaluate(`!!(${state.baseReady})`)) throw Error('Base state readiness assertion failed');
            }
            report.stage = 'setup';
            if (state.setup) await evaluate(state.setup);
            report.stage = 'ready';
            for (let attempt = 0; attempt < 50 && !await evaluate(`!!(${state.ready})`); attempt++) await delay(200);
            if (!await evaluate(`!!(${state.ready})`)) throw Error('State readiness assertion failed');
            if (!await evaluate(`location.hash === ${JSON.stringify('#' + state.route)}`)) throw Error('Unexpected route redirect');
            await delay(state.settleMs || 400);
            report.stage = 'probe';
            await reconnect();
            await evaluate(probe);
            await evaluate(`window.__t41Rules = ${JSON.stringify(state.rules.map(({ selector, kind, reason }) => ({ selector, kind, reason })))}`);
            if (state.overlay && !await evaluate(`!!document.querySelector(${JSON.stringify(state.overlay)})`)) throw Error('Expected overlay missing');
            if (!await evaluate('window.__t41.seed()')) {
                report.initialSnapshot = await evaluate('window.__t41.snapshot()');
                throw Error('No initial control');
            }
            await delay(100);
        };
        const snapshot = () => evaluate('window.__t41.snapshot()');
        const stateKey = s => JSON.stringify([s.focus.id, s.selection, s.scrolls.filter(p => p.x || p.y), s.inventory.filter(c => c.classification === 'control').map(c => c.id)]);
        const record = (s, routeKeys) => {
            for (const c of s.inventory) {
                if (c.classification === 'control') seen.set(c.id, c);
            }
            report.failures.push(...s.focus.failures.map(f => `${f}:${s.focus.id}`));
            if (s.focus.failures.length && !(report.focusFailures || []).some(f => f.id === s.focus.id)) {
                (report.focusFailures || (report.focusFailures = [])).push({ ...s.focus, routeKeys });
            }
            if (s.focus.id) visited.add(s.focus.id);
            const k = stateKey(s);
            if (!explored.has(k)) { explored.add(k); queue.push({ state: s, routeKeys }); }
        };
        const audit = async (phase, prefix = []) => {
            report.stage = 'graph-' + phase;
            seen.clear(); visited.clear(); queue.length = 0; explored.clear();
            record(await snapshot(), prefix);
            let index = 0;
            while (index < queue.length && index < (config.maxStates || 1500)) {
                const origin = queue[index++];
                if (index % 50 === 0) console.log(`${state.name} (${phase}): ${index} states explored, ${visited.size}/${seen.size} controls reached`);
                for (const direction of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
                    // Restore ONLY an already arrow-reached state, including its scroll position.
                    const restore = { focus: { id: origin.state.focus.id }, selection: origin.state.selection, scrolls: origin.state.scrolls };
                    if (!await evaluate(`(() => { const restored = window.__t41.restore(${JSON.stringify(restore)}); window.__t41.arm(); return restored; })()`)) { report.failures.push('unrestorable-reached-state'); continue; }
                    await key(direction);
                    const observation = await evaluate(`({ events: window.__t41.disarm(), state: window.__t41.snapshot(), routeMatches: location.hash === ${JSON.stringify('#' + state.route)}, overlayContains: ${state.overlay ? `!!document.querySelector(${JSON.stringify(state.overlay)}) && document.querySelector(${JSON.stringify(state.overlay)}).contains(document.activeElement)` : 'true'} })`);
                    const events = observation.events;
                    if (events.some(e => e.type === 'focusin' && (!e.visible || !e.inScope))) report.failures.push('transient-focus-escape');
                    const after = observation.state;
                    report.edges.push({ phase, from: origin.state.focus.id, key: direction, to: after.focus.id, scrollChanged: JSON.stringify(origin.state.scrolls) !== JSON.stringify(after.scrolls) });
                    record(after, [...origin.routeKeys, direction]);
                    if (!observation.routeMatches) throw Error('Arrow unexpectedly changed route');
                    if (!observation.overlayContains) report.failures.push('overlay-background-focus');
                }
            }
            if (index < queue.length) report.failures.push('graph-did-not-stabilize');
            (report.graphs || (report.graphs = [])).push({ phase, explored: index, discovered: queue.length,
                limit: config.maxStates || 1500, stabilized: index >= queue.length });
            const controls = Array.from(seen.values()).map(c => ({ ...c, phase, reached: visited.has(c.id) }));
            report.controls.push(...controls);
            for (const c of controls) {
                if (!c.reached) report.failures.push((index < queue.length ? 'not-visited-before-limit:' : 'unreachable:') + c.id);
                if (c.enter === 'unclassified') report.failures.push('unclassified:' + c.id);
                if (c.tabIndex < 0 && !c.roving) report.failures.push('negative-stop:' + c.id);
            }
            if (!controls.length) report.failures.push('empty-inventory');
            for (const c of controls.filter(c => c.reached && c.enter === 'safe')) {
                const targetState = queue.find(q => q.state.focus.id === c.id);
                await setup();
                report.stage = 'enter-' + phase;
                for (const direction of targetState.routeKeys) await key(direction);
                if (!await evaluate(`document.activeElement.matches(${JSON.stringify(c.selector)})`)) {
                    report.failures.push('enter-path-replay-mismatch:' + c.id);
                    const actual = await snapshot();
                    (report.replayFailures || (report.replayFailures = [])).push({ expected: c.selector,
                        actual: actual.inventory.find(item => item.id === actual.focus.id)?.selector, routeKeys: targetState.routeKeys });
                    continue;
                }
                const rule = await (async () => {
                        for (const r of state.rules) if (await evaluate(`document.activeElement.matches(${JSON.stringify(r.selector)})`)) return r;
                    })();
                if (!rule?.expect || !Number.isInteger(rule.expect.clicks) || !Number.isInteger(rule.expect.submits) || !rule.expect.effect) throw Error('Enter expectation must specify clicks, submits and effect');
                if (rule.before) await evaluate(rule.before);
                await evaluate('window.__t41.arm()');
                await key('Enter'); await delay(rule.waitMs || 250);
                const events = await evaluate('window.__t41.disarm()');
                const result = { phase, id: c.id, clicks: events.filter(e => e.type === 'click').length, submits: events.filter(e => e.type === 'submit').length, effect: !!await evaluate(`!!(${rule.expect.effect})`) };
                result.passed = result.clicks === rule.expect.clicks && result.submits === rule.expect.submits && result.effect;
                report.enter.push(result);
                if (report.enter.length % 10 === 0) console.log(`${state.name}: ${report.enter.length} safe Enter actions tested`);
                if (!result.passed) report.failures.push('enter:' + c.id);
            }
        };
        try {
            await setup();
            await audit('initial');
            if (state.after) {
                await setup();
                for (const direction of state.after.keys || []) await key(direction);
                await delay(state.after.waitMs || 500);
                if (!await evaluate(`!!(${state.after.assert})`)) report.failures.push('scroll-or-lazy-load-assertion');
                const after = await snapshot();
                report.after = after;
                report.failures.push(...after.focus.failures);
                await audit('after-scroll', state.after.keys || []);
            }
            if (!report.failures.length) report.tags.forEach(tag => covered.add(tag));
        } catch (error) { report.failures.push(error.message); }
        report.failures = [...new Set(report.failures)];
        if (config.allowScreenshots && (state.screenshot || report.failures.length)) {
            try {
                // A successful Enter may have closed the overlay or changed route.
                // Reopen the representative state before photographing it.
                if (state.screenshot && !report.failures.length) await setup();
                report.stage = 'screenshot';
                const shot = await send('Page.captureScreenshot', { format: 'png' });
                fs.writeFileSync(path.join(out, `t41-${state.name}.png`), Buffer.from(shot.data, 'base64'));
            } catch (_) { report.failures.push('screenshot-unavailable'); }
        }
        write(state.name, report);
        summary.reports.push({ name: state.name, controls: report.controls.length, reached: report.controls.filter(c => c.reached).length, enter: report.enter.length, failures: report.failures });
        console.log(`${state.name}: ${report.controls.length} controls, ${report.failures.length} failures`);
    }
    summary.missing = required.filter(tag => !covered.has(tag));
    summary.optional = [];
    for (const tag of optional) {
        if (covered.has(tag)) summary.optional.push({ tag, tested: true });
        else {
            const unavailable = config.unavailable?.find(item => item.tag === tag);
            const verified = !!unavailable?.assert && !!await evaluate(`!!(${unavailable.assert})`);
            summary.optional.push({ tag, tested: false, unavailableVerified: verified });
            if (!verified) summary.missing.push(tag);
        }
    }
    if (summary.missing.length) summary.failures.push('required-coverage-missing');
    if (summary.reports.some(r => r.failures.length)) summary.failures.push('state-failures');
    summary.accepted = !summary.failures.length;
} catch (error) {
    // Network errors can embed the private endpoint; keep only controlled messages.
    summary.failures.push(error instanceof SyntaxError ? 'Invalid private JSON configuration' : error instanceof TypeError ? 'CDP endpoint unavailable' : error.code ? 'Configuration or filesystem unavailable' : error.message);
} finally {
    if (ws) ws.close();
    write('summary', summary);
}
if (!summary.accepted) process.exitCode = 1;
// WAM C68 may never acknowledge the WebSocket close handshake.
setTimeout(() => process.exit(summary.accepted ? 0 : 1), 100);

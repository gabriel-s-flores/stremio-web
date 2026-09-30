// Run against an existing CDP target serving the corresponding build at 1920x1080.
// node tools/t24-safe-areas-runner.mjs webos 10.0.2.2:8090
// For desktop, set CDP_HTTP to its endpoint and pass desktop <target>.
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const [mode, target] = process.argv.slice(2);
if (!['webos', 'desktop'].includes(mode) || !target) throw new Error('Usage: t24-safe-areas-runner.mjs <webos|desktop> <CDP target hint>');
const cdpHttp = process.env.CDP_HTTP || 'http://127.0.0.1:9998';
const cdp = async (...args) => (await execute(process.execPath, ['webos/hello/tools/cdp.mjs', ...args], { timeout: 60000, maxBuffer: 8 * 1024 * 1024 })).stdout;
const evaluate = async (expression) => JSON.parse(await cdp('eval', target, expression));
const routes = [
    ['board', '#/'], ['settings', '#/settings'], ['library', '#/library'],
    ['discover', '#/discover'], ['calendar', '#/calendar'], ['search', '#/search'],
    ['addons', '#/addons'], ['metadetails', '#/detail/movie/tt11561116/tt11561116'],
];
const summary = [];
for (const [name, route] of routes) {
    if (mode === 'webos') {
        await execute(process.execPath, ['scripts/verify-webos-ui.mjs', 'build', '--cdp', target, '--cdp-http', cdpHttp,
            '--route', route, '--output', `tests/webos/t24-${name}-smoke.json`], { timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
    } else {
        await evaluate(`if (window.__t24SafeAreasProbe) window.__t24SafeAreasProbe.cleanup(); location.hash = ${JSON.stringify(route)}; true`);
    }
    // Allow route effects, catalog responses and font loading to settle before measuring.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await evaluate(`window.__t24SafeAreasExpectedBuild = ${JSON.stringify(mode)}; true`);
    const report = JSON.parse(await cdp('eval-file', target, 'tools/t24-safe-areas-probe.js'));
    if (!Array.isArray(report.failures)) throw new Error(`Probe did not return a report: ${JSON.stringify(report)}`);
    fs.writeFileSync(`tests/webos/t24-${name}-probe.${mode}.json`, JSON.stringify(report, null, 2) + '\n');
    if (name === 'board') await cdp('screenshot', target, `tests/webos/t24-fixtures.${mode}.png`);
    await evaluate('window.__t24SafeAreasProbe.hideFixtures(); true');
    await cdp('screenshot', target, `tests/webos/t24-${name}.${mode}.png`);
    summary.push({ name, route, viewport: report.viewport, insets: report.insets, functionCount: report.functionCount, surfaces: report.routeSurfaces, failures: report.failures });
    console.log(`${mode} ${name}: ${report.failures.length ? JSON.stringify(report.failures) : 'PASS'}`);
}
fs.writeFileSync(`tests/webos/t24-summary.${mode}.json`, JSON.stringify({ date: new Date().toISOString(), mode, results: summary }, null, 2) + '\n');
if (summary.some((result) => result.failures.length)) process.exitCode = 1;

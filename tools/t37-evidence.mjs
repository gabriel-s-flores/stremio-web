import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const cases = Object.fromEntries(['hosted-on', 'hosted-off', 'hosted-rejected', 'packaged-on', 'packaged-off'].map(name => [name, read(`tests/webos/t37-runtime-${name}.json`)]));
const checks = read('tests/webos/t37-checks.json').checks;
const files = ['src/index.js', 'src/webos/diagnostics/observability.js', 'src/webos/diagnostics/runtime.js', 'src/webos/diagnostics/global.d.ts', 'tests/webosObservability.spec.js', ...fs.readdirSync('tools').filter(f => /^t37-.*\.(mjs|cjs|js)$/.test(f)).map(f => 'tools/' + f)];
const fixtures = {};
for (const [name, root] of [['on', process.argv[2]], ['off', process.argv[3]]]) {
    if (!root) throw Error('Pass fixture-on and fixture-off directories');
    const build = fs.readdirSync(root).find(f => /^[a-f0-9]{40}$/.test(f));
    const bytes = fs.readFileSync(`tests/webos/t37-compat-fixture-${name}.log`);
    const compatLog = bytes.toString(bytes[0] === 255 && bytes[1] === 254 ? 'utf16le' : 'utf8');
    const match = compatLog.match(/ES2018 compatibility: (\d+)\/(\d+) files passed/);
    const sourceMap = read(path.join(root, build, 'scripts/main.js.map'));
    const index = sourceMap.sources.findIndex(source => source.includes('diagnostics/observability.js'));
    const normalize = source => source.replace(/\r\n/g, '\n').trim();
    fixtures[name] = {
        mainSha256: hash(path.join(root, build, 'scripts/main.js')),
        adapterSourceMatches: index >= 0 && normalize(sourceMap.sourcesContent[index]) === normalize(fs.readFileSync('src/webos/diagnostics/observability.js', 'utf8')),
        es2018Passed: !!match && Number(match[1]) > 0 && match[1] === match[2],
    };
}
const checksPassed = checks.length === 8 && checks.every(c => c.exitCode === 0);
const runtimePassed = Object.values(cases).every(c => c.passed === true);
const packagedBaselineEquivalent = ['on', 'off'].every(mode => cases['packaged-' + mode].samples.length === 2)
    && cases['packaged-on'].samples.every((sample, index) => ['reactRootCreated', 'mounted', 'coreReady'].every(key => sample[key] === cases['packaged-off'].samples[index][key]));
const summary = {
    date: new Date().toISOString(),
    status: checksPassed && runtimePassed && packagedBaselineEquivalent && Object.values(fixtures).every(f => f.es2018Passed && f.adapterSourceMatches) ? 'passed' : 'incomplete',
    checksPassed, runtimePassed, packagedBaselineEquivalent,
    cases: Object.fromEntries(Object.entries(cases).map(([name, result]) => [name, { status: result.status, passed: result.passed, events: result.sink?.events, wasmBlocked: result.wasmBlocked, reactMountPassed: result.reactMountPassed ?? result.samples.every(s => s.mounted) }])),
    limitations: { packagedFullAppBoot: false, physicalTVValidated: false, productionEndpointValidated: false, t84Complete: false },
    fixtures, hashes: Object.fromEntries(files.map(file => [file, hash(file)])),
};
fs.writeFileSync('tests/webos/t37-summary.json', JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ status: summary.status, checksPassed, runtimePassed, packagedBaselineEquivalent }));
process.exitCode = summary.status === 'passed' ? 0 : 1;

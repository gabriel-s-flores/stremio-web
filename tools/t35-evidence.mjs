import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
if (process.argv.includes('--checks')) {
    const checks = [];
    for (const [label, args] of [['test', 'test --runInBand'], ['lint', 'lint'], ['build', 'build'], ['build-webos', 'build:webos'], ['compat', 'check:webos-compat']]) {
        const command = 'corepack pnpm ' + args;
        const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
        fs.writeFileSync(`tests/webos/t35-${label}.log`, (result.stdout || '') + (result.stderr || ''));
        checks.push({ label, command, exitCode: result.status });
        fs.writeFileSync('tests/webos/t35-checks.json', JSON.stringify({ date: new Date().toISOString(), checks }, null, 2) + '\n');
        console.log(label, result.status);
    }
    process.exitCode = checks.some(check => check.exitCode !== 0) ? 1 : 0;
} else {
    const checks = read('tests/webos/t35-checks.json').checks;
    const hosted = read('tests/webos/t35-storage-hosted.json');
    const packaged = read('tests/webos/t35-storage-packaged.json');
    const files = ['tests/webosStorage.spec.js', 'tools/t35-storage.mjs', 'tools/t35-prepare.mjs', 'tools/t35-evidence.mjs', 'src/core/Error/Error.tsx', 'src/core/createTransport.ts', 'src/index.js', 'node_modules/@stremio/stremio-core-web/worker.js', 'build/index.html'];
    const hashes = Object.fromEntries(files.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
    const storagePassed = report => report.passed && report.immediate && report.closed && report.reopened && report.persisted && report.cleaned && report.before.origin === report.after.origin;
    const passed = checks.map(check => check.label).join(',') === 'test,lint,build,build-webos,compat' && checks.every(check => check.exitCode === 0) && storagePassed(hosted) && hosted.after.coreReady && !hosted.errors.storage && storagePassed(packaged);
    fs.writeFileSync('tests/webos/t35-summary.json', JSON.stringify({ date: new Date().toISOString(), passed, hostedStoragePassed: storagePassed(hosted), packagedStoragePassed: storagePassed(packaged), hostedCoreReady: hosted.after?.coreReady === true, packagedCoreReady: packaged.after?.coreReady === true, cookies: { productionDependency: false, packagedAbsenceExpected: true, historicalEvidence: 'webos/hello/t04-results.md', liveCookieWrites: false }, physicalTVValidated: false, hashes }, null, 2) + '\n');
    console.log(passed ? 'PASS T3.5' : 'FAIL T3.5: inspect reports');
    process.exitCode = passed ? 0 : 1;
}

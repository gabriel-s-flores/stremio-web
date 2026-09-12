import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { audit } from './t310-artifacts.mjs';

process.env.SENTRY_DSN = '';
const checks = [];
for (const [label, args, mode] of [
    ['test', 'test --runInBand'], ['lint', 'lint'], ['build', 'build', 'desktop'],
    ['build-webos', 'build:webos', 'hosted'], ['compat', 'check:webos-compat'],
    ['build-packaged', 'build:webos:packaged', 'packaged'], ['compat-packaged', 'check:webos-compat'],
]) {
    const command = 'corepack pnpm ' + args;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', maxBuffer: 48 * 1024 * 1024 });
    fs.writeFileSync(`tests/webos/t310-${label}.log`, (result.stdout || '') + (result.stderr || ''));
    checks.push({ label, command, exitCode: result.status });
    if (mode && result.status === 0) {
        try {
            fs.writeFileSync(`tests/webos/t310-artifact-${mode}.json`, JSON.stringify(audit(mode), null, 2) + '\n');
            checks.push({ label: 'artifact-' + mode, exitCode: 0 });
        } catch (error) {
            checks.push({ label: 'artifact-' + mode, exitCode: 1, error: error.message });
        }
    }
    fs.writeFileSync('tests/webos/t310-checks.json', JSON.stringify({ date: new Date().toISOString(), checks }, null, 2) + '\n');
    console.log(label, result.status);
}
process.exitCode = checks.some(check => check.exitCode !== 0) ? 1 : 0;

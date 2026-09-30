import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

process.env.SENTRY_DSN = '';
const checks = [];
for (const [label, args] of [
    ['test', 'test --runInBand'], ['lint', 'lint'], ['build', 'build'],
    ['build-webos', 'build:webos'], ['compat', 'check:webos-compat'],
    ['build-packaged', 'build:webos:packaged'], ['compat-packaged', 'check:webos-compat'],
]) {
    const command = 'corepack pnpm ' + args;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', maxBuffer: 48 * 1024 * 1024, windowsHide: true });
    fs.writeFileSync(`tests/webos/t311-${label}.log`, (result.stdout || '') + (result.stderr || ''));
    checks.push({ label, command, exitCode: result.status });
    fs.writeFileSync('tests/webos/t311-checks.json', JSON.stringify({ date: new Date().toISOString(), checks }, null, 2) + '\n');
    console.log(label, result.status);
}
process.exitCode = checks.some(check => check.exitCode !== 0) ? 1 : 0;

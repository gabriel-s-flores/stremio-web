import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
if (process.argv.includes('--checks')) {
    process.env.SENTRY_DSN = '';
    const checks = [];
    for (const [label, args] of [['test', 'test --runInBand'], ['lint', 'lint'], ['build', 'build'], ['build-webos', 'build:webos'], ['hosted-artifacts', 'verify:hosted-build'], ['compat', 'check:webos-compat'], ['build-packaged', 'build:webos:packaged'], ['compat-packaged', 'check:webos-compat']]) {
        const command = 'corepack pnpm ' + args;
        const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
        fs.writeFileSync(`tests/webos/t37-${label}.log`, (result.stdout || '') + (result.stderr || ''));
        checks.push({ label, command, exitCode: result.status });
        fs.writeFileSync('tests/webos/t37-checks.json', JSON.stringify({ date: new Date().toISOString(), checks }, null, 2) + '\n');
        if (label === 'hosted-artifacts' && result.status === 0) {
            const snapshot = fs.mkdtempSync(path.join(os.tmpdir(), 'stremio-t37-hosted-'));
            fs.cpSync('build', snapshot, { recursive: true });
            fs.writeFileSync('tests/webos/t37-hosted-snapshot.json', JSON.stringify({ snapshot, mainSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(snapshot, fs.readdirSync(snapshot).find(f => /^[a-f0-9]{40}$/.test(f)), 'scripts/main.js'))).digest('hex') }, null, 2));
        }
        console.log(label, result.status);
    }
    process.exitCode = checks.some(check => check.exitCode !== 0) ? 1 : 0;
}


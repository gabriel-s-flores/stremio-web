import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
const checks = [];
for (const [label, command] of [['test', 'corepack pnpm test --runInBand'], ['lint', 'corepack pnpm lint'], ['build-webos', 'corepack pnpm build:webos'], ['compat', 'corepack pnpm check:webos-compat']]) {
 const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
 fs.writeFileSync(`tests/webos/t34-${label}.log`, (r.stdout || '') + (r.stderr || ''));
 checks.push({ label, command, exitCode: r.status });
 fs.writeFileSync('tests/webos/t34-checks.json', JSON.stringify({ date: new Date().toISOString(), checks }, null, 2));
 console.log(label, r.status);
}
process.exitCode = checks.some(c => c.exitCode !== 0) ? 1 : 0;

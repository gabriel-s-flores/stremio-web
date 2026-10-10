#!/usr/bin/env node
// Bateria de testes de mídia no emulador webOS TV 4.0.
//
//   node run.mjs [--scenarios scenarios.json] [--only id,id] [--jobs N] [--retries N]
//                [--media-dir pasta] [--out pasta] [--timeout-min N] [--list]
//
// Para cada cenário: um `emu-run` (boot limpo e uma instância do pool), onde `run-one.sh` instala
// a sonda e roda o `play-test.sh` sobre a URL servida pelo `media-server.mjs`. Os cenários
// rodam em paralelo; o limite real é o pool (EMU_POOL_SIZE, padrão 4), porque o emu-run espera
// uma instância livre. Gera `relatorio.md` e `resultados.json` na pasta de saída.
// Só repete (nova instância) quando a falha é de infraestrutura (sem resultado), nunca por
// expectativa não cumprida.
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deriveExpectations, evaluate, parseServerLog, summarizeRequests } from './evaluate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = path.dirname(HERE);
const HOME = os.homedir();
const APP_ID = 'io.github.gabrielsflores.webosprobe';

const args = { scenarios: path.join(HERE, 'scenarios.json'), only: null, jobs: 0, retries: 1, mediaDir: path.join(HOME, 'webos-tv-sdk/media-tests/suite'), out: null, timeoutMin: 6, list: false };
for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--scenarios') args.scenarios = path.resolve(process.argv[++i]);
    else if (a === '--only') args.only = process.argv[++i].split(',');
    else if (a === '--jobs') args.jobs = Number(process.argv[++i]);
    else if (a === '--retries') args.retries = Number(process.argv[++i]);
    else if (a === '--media-dir') args.mediaDir = path.resolve(process.argv[++i]);
    else if (a === '--out') args.out = path.resolve(process.argv[++i]);
    else if (a === '--timeout-min') args.timeoutMin = Number(process.argv[++i]);
    else if (a === '--list') args.list = true;
    else { console.error(`opção desconhecida: ${a}`); process.exit(2); }
}

const config = JSON.parse(fs.readFileSync(args.scenarios, 'utf8'));
const defaults = config.defaults || {};
let scenarios = config.scenarios.map((s) => ({ ...defaults, ...s, expect: { ...(defaults.expect || {}), ...(s.expect || {}) } }));
if (args.only) scenarios = scenarios.filter((s) => args.only.includes(s.id));
if (scenarios.length === 0) { console.error('nenhum cenário selecionado'); process.exit(2); }
if (args.list) { for (const s of scenarios) console.log(`${s.id}\t${s.title}`); process.exit(0); }

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = args.out || path.join(HOME, 'webos-tv-sdk/run/media-suite', stamp);
fs.mkdirSync(outDir, { recursive: true });
const log = (msg) => console.error(`[media-suite ${new Date().toISOString().slice(11, 19)}] ${msg}`);
const run = (cmd, cmdArgs, opts = {}) => spawnSync(cmd, cmdArgs, { encoding: 'utf8', ...opts });

// 1. Mídias: gera as que faltam, com keyframe a cada 1 s (o seek do pipeline cai no keyframe anterior).
const missing = scenarios.filter((s) => s.file && !fs.existsSync(path.join(args.mediaDir, s.file)));
if (missing.length > 0) {
    log(`gerando mídias sintéticas em ${args.mediaDir} (faltam: ${missing.map((s) => s.file).join(', ')})`);
    const gen = run(path.join(TOOLS, 'gen-media.sh'), [args.mediaDir], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, GOP: '24' } });
    if (gen.status !== 0) { console.error('gen-media.sh falhou'); process.exit(2); }
}

// 2. Expectativas: valores derivados do arquivo (ffprobe) + o que o cenário declara.
for (const s of scenarios) {
    s.derived = {};
    if (s.file && s.derive !== false) {
        const p = run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-print_format', 'json', path.join(args.mediaDir, s.file)]);
        if (p.status !== 0) { console.error(`ffprobe falhou em ${s.file}: ${p.stderr}`); process.exit(2); }
        s.derived = deriveExpectations(JSON.parse(p.stdout));
    }
    s.finalExpect = { ...s.derived, ...s.expect };
}

// 3. Servidor de mídia numa porta livre (outras tarefas usam a 8099) e a sonda empacotada uma vez.
const freePort = () => new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});
const port = await freePort();
const serverLogPath = path.join(outDir, 'media-server.log');
const serverLogFd = fs.openSync(serverLogPath, 'w');
const server = spawn('node', [path.join(TOOLS, 'media-server.mjs'), args.mediaDir, String(port)], { stdio: ['ignore', serverLogFd, serverLogFd] });
const cleanup = () => { try { server.kill(); } catch { /* já encerrado */ } fs.rmSync(pkgDir, { recursive: true, force: true }); };
const pkgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-suite-ipk-'));
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
for (let i = 0; i < 50 && !fs.readFileSync(serverLogPath, 'utf8').includes('servindo'); i++) await new Promise((r) => setTimeout(r, 100));
if (!fs.readFileSync(serverLogPath, 'utf8').includes('servindo')) { console.error('media-server não subiu'); process.exit(2); }
log(`media-server em 127.0.0.1:${port} (emulador: http://10.0.2.2:${port})`);

const pack = run('ares-package', [path.join(TOOLS, 'probe/app'), '-o', pkgDir]);
if (pack.status !== 0) { console.error(`ares-package falhou: ${pack.stderr}`); process.exit(2); }
const ipk = fs.readdirSync(pkgDir).find((f) => f.endsWith('.ipk'));
if (!ipk) { console.error('ares-package não gerou o ipk'); process.exit(2); }
const ipkPath = path.join(pkgDir, ipk);

const baseUrl = `http://10.0.2.2:${port}`;
const urlFor = (s) => (s.url ? s.url.replace('{base}', baseUrl) : `${baseUrl}${s.redirect ? '/redirect' : ''}/${s.file}`);

// 4. Execução: cada tentativa é um emu-run.
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const queuedAt = Date.now();

async function attempt(s, n) {
    const dir = path.join(outDir, s.id, `tentativa-${n}`);
    fs.mkdirSync(dir, { recursive: true });
    const logFd = fs.openSync(path.join(dir, 'emu-run.log'), 'w');
    const cmd = [path.join(TOOLS, 'emu-run'), '--timeout', String(args.timeoutMin), '--', 'bash', path.join(HERE, 'run-one.sh'),
        dir, ipkPath, urlFor(s), String(s.seconds || 8), s.seek === undefined ? '' : String(s.seek), s.luna ? '1' : '0'];
    log(`${s.id}: tentativa ${n} na fila do pool`);
    const code = await new Promise((resolve) => {
        const child = spawn(cmd[0], cmd.slice(1), { stdio: ['ignore', logFd, logFd] });
        child.on('exit', (c, sig) => resolve(c === null ? `sinal ${sig}` : c));
    });
    fs.closeSync(logFd);
    const meta = readJson(path.join(dir, 'meta.json'));
    const result = readJson(path.join(dir, 'play.json'));
    if (meta) log(`${s.id}: tentativa ${n} terminou (instância ${meta.instance}, saída ${code})`);
    else log(`${s.id}: tentativa ${n} falhou antes de rodar (saída ${code})`);
    return { n, dir, code, meta, result, infra: !result };
}

async function runScenario(s) {
    const attempts = [];
    for (let n = 1; n <= args.retries + 1; n++) {
        const a = await attempt(s, n);
        attempts.push(a);
        if (!a.infra) break;
    }
    const last = attempts[attempts.length - 1];
    const serverEntries = parseServerLog(fs.readFileSync(serverLogPath, 'utf8'));
    const requests = s.file ? summarizeRequests(serverEntries, s.file) : { redirects: 0, requests: 0, rangeRequests: 0, rangeOffsets: [] };
    const checks = last.result ? evaluate(s, s.finalExpect, last.result, requests) : [{ name: 'resultado do play-test', ok: false, expected: 'JSON', actual: `sem resultado (saída ${last.code})` }];
    return { scenario: s, attempts, last, requests, checks, pass: checks.every((c) => c.ok) };
}

const jobs = args.jobs > 0 ? args.jobs : scenarios.length;
const results = [];
let next = 0;
await Promise.all(Array.from({ length: Math.min(jobs, scenarios.length) }, async () => {
    while (next < scenarios.length) {
        const s = scenarios[next++];
        const r = await runScenario(s);
        results[scenarios.indexOf(s)] = r;
        log(`${s.id}: ${r.pass ? 'OK' : 'FALHOU'}`);
    }
}));

// 5. Relatório.
const git = run('git', ['-C', TOOLS, 'rev-parse', '--short', 'HEAD']).stdout.trim();
const secs = (ms) => (ms / 1000).toFixed(1);
const t0 = Math.min(queuedAt, ...results.filter((r) => r.last.meta).map((r) => r.last.meta.startedAt));
const intervals = results.filter((r) => r.last.meta).map((r) => [r.last.meta.startedAt, r.last.meta.endedAt]);
const maxParallel = Math.max(0, ...intervals.map(([start]) => intervals.filter(([a, b]) => a <= start && start < b).length));
const cell = (v) => String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const mark = (ok) => (ok ? '✅' : '❌');

const lines = [];
lines.push('# Bateria de testes de mídia (emulador webOS TV 4.0)', '');
lines.push(`- **Data:** ${new Date().toISOString()}`);
lines.push(`- **Commit:** \`${git}\``);
lines.push(`- **Cenários:** ${results.length} (arquivo \`${path.relative(TOOLS, args.scenarios)}\`), mídias em \`${args.mediaDir}\``);
lines.push(`- **Pool:** EMU_POOL_SIZE=${process.env.EMU_POOL_SIZE || 4}; cenários lançados ao mesmo tempo: ${Math.min(jobs, scenarios.length)}; **máximo realmente em paralelo: ${maxParallel}**`);
lines.push(`- **Servidor de mídia:** \`127.0.0.1:${port}\` (emulador: \`${baseUrl}\`), log em \`media-server.log\``);
lines.push(`- **Resultado:** ${results.filter((r) => r.pass).length}/${results.length} cenários passaram`, '');
lines.push('## Resumo', '');
lines.push('| Cenário | Resultado | Instância | Início (s) | Fim (s) | Tentativas | Falhas |');
lines.push('|---|---|---|---|---|---|---|');
for (const r of results) {
    const m = r.last.meta;
    const failed = r.checks.filter((c) => !c.ok).map((c) => `${c.name} (esperado ${c.expected}, obtido ${c.actual})`).join('; ');
    lines.push(`| \`${r.scenario.id}\` | ${mark(r.pass)} | ${m ? m.instance : '-'} | ${m ? secs(m.startedAt - t0) : '-'} | ${m ? secs(m.endedAt - t0) : '-'} | ${r.attempts.length} | ${cell(failed || '-')} |`);
}
lines.push('', 'Início e fim contam a partir do primeiro boot; a espera por uma instância livre do pool fica antes do início.', '');
for (const r of results) {
    const s = r.scenario;
    const res = r.last.result;
    lines.push(`## ${mark(r.pass)} ${s.id}: ${s.title}`, '');
    lines.push(`- URL no emulador: \`${urlFor(s)}\`; reprodução ${s.seconds || 8} s${s.seek !== undefined ? `, seek para ${s.seek} s` : ''}`);
    if (r.last.meta) lines.push(`- Instância ${r.last.meta.instance} (\`${r.last.meta.device}\`); sonda ${r.last.meta.probeComplete ? 'completa' : 'incompleta ao iniciar o teste'}`);
    if (r.attempts.length > 1) lines.push(`- Tentativas: ${r.attempts.map((a) => `#${a.n} ${a.infra ? `falha de infraestrutura (saída ${a.code})` : 'ok'}`).join(', ')}`);
    lines.push(`- Servidor: ${r.requests.redirects} redirect(s) 302; ${r.requests.requests} requisição(ões) ao arquivo, ${r.requests.rangeRequests} com Range (offsets > 0: ${r.requests.rangeOffsets.join(', ') || 'nenhum'})`, '');
    lines.push('| Verificação | Esperado | Obtido | |', '|---|---|---|---|');
    for (const c of r.checks) lines.push(`| ${cell(c.name)} | ${cell(c.expected)} | ${cell(c.actual)} | ${mark(c.ok)} |`);
    if (res) {
        lines.push('', `- Eventos: ${(res.events || []).map((e) => `\`${e}\``).join(' ')}`);
        lines.push(`- Medido: ${res.size}, duração ${res.duration} s, currentTime ${Number(res.currentTime).toFixed(2)} s, ${res.timeupdates} timeupdate(s), paused=${res.paused}, erro=${res.error || 'nenhum'}`);
        lines.push(`- audioTracks: ${(res.audioTracks || []).map((t) => `${t.language || '?'}${t.enabled ? '*' : ''}${t.label ? ` “${t.label}”` : ''}`).join(', ') || '(vazio)'}`);
        lines.push(`- textTracks: ${(res.textTracks || []).length}`);
    }
    lines.push(`- Artefatos: \`${path.relative(outDir, r.last.dir)}/\` (play.json, tela-app.png, tela-vm.png, emu-run.log)`, '');
}
fs.writeFileSync(path.join(outDir, 'relatorio.md'), lines.join('\n'));
fs.writeFileSync(path.join(outDir, 'resultados.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), commit: git, port, maxParallel,
    scenarios: results.map((r) => ({ id: r.scenario.id, pass: r.pass, instance: r.last.meta && r.last.meta.instance, attempts: r.attempts.length, checks: r.checks, requests: r.requests, result: r.last.result })),
}, null, 2));
log(`relatório: ${path.join(outDir, 'relatorio.md')}`);
console.log(path.join(outDir, 'relatorio.md'));
process.exit(results.every((r) => r.pass) ? 0 : 1);

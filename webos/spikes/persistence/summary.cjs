#!/usr/bin/env node
// Resume o JSON de um passo da sonda. Uso: summary.cjs <arquivo.json> [--counters]
// SIM(v)  = achou o dado e ele foi gravado ANTES de esta sessão do app começar (sobreviveu)
// nova(v) = achou, mas gravado nesta mesma sessão (recarga da página): NÃO conta como sobrevivência
// nao     = não achou · semAPI = a API não existe
const r = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
const out = Object.keys(r.stores).map((k) => {
    const s = r.stores[k];
    if (!s.supported) return `${k}:semAPI`;
    if (s.error && !s.found) return `${k}:erro`;
    if (!s.found) return `${k}:nao`;
    return `${k}:${s.survived ? 'SIM' : 'nova'}(${s.writer})`;
});
const extra = process.argv.includes('--counters') ? ` contadores=${JSON.stringify(r.counters)}` : '';
console.log(`${r.version} carga=${r.session && r.session.loadIndex} ${out.join(' ')}${extra}`);

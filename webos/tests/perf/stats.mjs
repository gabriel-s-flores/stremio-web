#!/usr/bin/env node
// Small exact tests for the F7.1 comparisons (no dependencies).
//   node stats.mjs fisher <a_hit> <a_n> <b_hit> <b_n>      two-sided Fisher exact test on 2x2 counts (e.g. OOM runs)
//   node stats.mjs mwu <a1,a2,...> <b1,b2,...>             two-sided Mann-Whitney U, exact (n <= 12 each) with ties as mid-ranks
// Prints the p-value and the medians; the wasm2js x WASM comparisons in BASELINE-C8.md quote these.
const logFact = (n) => { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; };
const logChoose = (n, k) => logFact(n) - logFact(k) - logFact(n - k);

export function fisherTwoSided(aHit, aN, bHit, bN) {
    const hits = aHit + bHit;
    const total = aN + bN;
    const p = (x) => Math.exp(logChoose(aN, x) + logChoose(bN, hits - x) - logChoose(total, hits));
    const observed = p(aHit);
    let sum = 0;
    for (let x = Math.max(0, hits - bN); x <= Math.min(aN, hits); x++) if (p(x) <= observed * (1 + 1e-9)) sum += p(x);
    return Math.min(1, sum);
}

export function mannWhitneyExact(a, b) {
    const all = [...a.map((v) => ({ v, g: 0 })), ...b.map((v) => ({ v, g: 1 }))].sort((x, y) => x.v - y.v);
    const rank = new Array(all.length);
    for (let i = 0; i < all.length;) {
        let j = i;
        while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
        for (let k = i; k <= j; k++) rank[k] = (i + j) / 2 + 1;
        i = j + 1;
    }
    const rankSum = all.reduce((s, x, i) => s + (x.g === 0 ? rank[i] : 0), 0);
    const n = a.length;
    const m = b.length;
    const observed = Math.abs(rankSum - (n * (n + m + 1)) / 2);
    // Enumerate which n of the n+m ranks belong to group a (exact; fine for n, m <= 12).
    let count = 0;
    let extreme = 0;
    const walk = (start, left, sum) => {
        if (left === 0) {
            count++;
            if (Math.abs(sum - (n * (n + m + 1)) / 2) >= observed - 1e-9) extreme++;
            return;
        }
        for (let i = start; i <= rank.length - left; i++) walk(i + 1, left - 1, sum + rank[i]);
    };
    walk(0, n, 0);
    return extreme / count;
}

const median = (xs) => { const s = [...xs].sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };

if (process.argv[1] && process.argv[1].endsWith('stats.mjs')) {
    const [cmd, ...rest] = process.argv.slice(2);
    if (cmd === 'fisher' && rest.length === 4) {
        const [aHit, aN, bHit, bN] = rest.map(Number);
        console.log(`Fisher exact, two-sided: ${aHit}/${aN} vs ${bHit}/${bN}: p = ${fisherTwoSided(aHit, aN, bHit, bN).toFixed(4)}`);
    } else if (cmd === 'mwu' && rest.length === 2) {
        const [a, b] = rest.map((s) => s.split(',').map(Number));
        console.log(`Mann-Whitney exact, two-sided: n = ${a.length} and ${b.length}, medians ${median(a)} and ${median(b)}: p = ${mannWhitneyExact(a, b).toFixed(4)}`);
    } else {
        console.error('usage: stats.mjs fisher <a_hit> <a_n> <b_hit> <b_n> | stats.mjs mwu <a,...> <b,...>');
        process.exit(2);
    }
}

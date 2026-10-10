#!/usr/bin/env node
// Summary of the mem.log of run.sh: RSS of the tlsproxy service (svc) and of WebAppMgr (wam) in MB,
// and the lowest MemAvailable of the emulator.
import fs from 'node:fs';

const rows = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').filter(Boolean).map((line) => {
    const [time, available, ...procs] = line.trim().split(/\s+/);
    const by = {};
    procs.forEach((p) => {
        const [type, pid, kb] = p.split(':');
        by[type] = by[type] || {};
        by[type][pid] = Number(kb);
    });
    return { time: Number(time), available: Number(available), by };
});
const mb = (kb) => Math.round(kb / 102.4) / 10;
const summary = (type) => {
    const values = rows.flatMap((r) => Object.values(r.by[type] || {}));
    const pids = new Set(rows.flatMap((r) => Object.keys(r.by[type] || {})));
    if (!values.length) return `${type}: not seen`;
    const last = rows.filter((r) => r.by[type]).pop();
    return `${type}: ${pids.size} pid(s) ${[...pids].join(',')} · RSS min ${mb(Math.min(...values))} MB · max ${mb(Math.max(...values))} MB · last ${mb(Object.values(last.by[type]).reduce((a, b) => a + b, 0))} MB`;
};
console.log(`samples: ${rows.length} over ${rows.length ? rows[rows.length - 1].time - rows[0].time : 0} s`);
console.log(summary('svc'));
console.log(summary('wam'));
console.log(`MemAvailable min ${mb(Math.min(...rows.map((r) => r.available)))} MB`);

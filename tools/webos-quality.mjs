import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

export const budgets = { firstPaintMs: 1500, bootInteractiveMs: 5000, bootHeapBytes: 256 * 1024 ** 2,
    scrollHeapBytes: 384 * 1024 ** 2, scrollFps: 45, frameP95Ms: 22.2 };
export function assess(metrics) {
    return Object.fromEntries(Object.entries(budgets).map(([key, limit]) => [key,
        !Number.isFinite(metrics[key]) || metrics[key] < 0 ? 'unmeasured' :
            (key === 'scrollFps' ? metrics[key] >= limit : metrics[key] <= limit) ? 'pass' : 'fail']));
}
export function bundleSize(root) {
    const files = [];
    const walk = dir => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(file);
            else if (entry.isFile() && /\.(js|css|wasm)$/.test(entry.name)) {
                const data = fs.readFileSync(file);
                files.push({ file: path.relative(root, file), bytes: data.length, gzipBytes: gzipSync(data).length });
            }
        }
    };
    walk(root);
    files.sort((a, b) => a.file.localeCompare(b.file));
    return { files, bytes: files.reduce((n, f) => n + f.bytes, 0), gzipBytes: files.reduce((n, f) => n + f.gzipBytes, 0) };
}

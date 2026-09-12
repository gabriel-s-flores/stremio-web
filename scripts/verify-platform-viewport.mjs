import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const [directory = 'build', target] = process.argv.slice(2);
assert(['desktop', 'webos'].includes(target), 'usage: node scripts/verify-platform-viewport.mjs <build> <desktop|webos>');
const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
const metas = html.match(/<meta\b[^>]*name=["']viewport["'][^>]*>/gi) || [];
assert.equal(metas.length, 1);
const content = metas[0].match(/content=["']([^"']*)["']/)[1];
if (target === 'webos') {
    assert.match(content, /(?:^|,)\s*width=1920(?:,|$)/);
    assert.match(content, /(?:^|,)\s*height=1080(?:,|$)/);
} else {
    assert.match(content, /(?:^|,)\s*width=device-width(?:,|$)/);
    assert.doesNotMatch(content, /1920|1080/);
}
console.log(JSON.stringify({ target, content, sha256: crypto.createHash('sha256').update(html).digest('hex') }, null, 2));

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mode = process.argv[2];
if (!['desktop', 'webos', 'debug'].includes(mode)) throw Error('Usage: node tools/t29-artifact-audit.cjs desktop|webos|debug');
const root = path.resolve('build');
const files = fs.readdirSync(root, { recursive: true });
const cssFile = files.find(f => /styles[\\/]main.css$/.test(f));
const css = fs.readFileSync(path.join(root, cssFile), 'utf8');
const js = files.filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
const failures = [];
const fonts = ['PlusJakartaSans.ttf', 'TwemojiFlags.woff2'].map(name => {
    const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map(m => m[1].replace(/["']/g, '')).filter(url => url.endsWith(name));
    const expected = path.join(root, 'fonts', name);
    const valid = urls.length > 0 && fs.existsSync(expected) && fs.statSync(expected).size > 0 && urls.every(url => !/^(\/|[a-z]+:)/i.test(url) && path.resolve(root, path.dirname(cssFile), url) === expected);
    if (!valid) failures.push('invalid font artifact: ' + name);
    return { name, urls, valid, bytes: fs.existsSync(expected) ? fs.statSync(expected).size : 0 };
});
if (css.includes('/assets/fonts')) failures.push('unresolved /assets/fonts');
const markers = ['/debug/fonts-icons', 'data-webos-fonts-icons-fixture'];
if (!markers.every(marker => js.includes(marker) === (mode === 'debug'))) failures.push('fixture build isolation');
const hash = crypto.createHash('sha256').update(css).digest('hex');
const report = { mode, cssFile, cssSha256: hash, fonts, fixturePresent: markers.every(m => js.includes(m)), failures };
if (mode === 'desktop' && fs.existsSync('tests/webos/t28-desktop-before.css')) {
    report.desktopCssUnchanged = css === fs.readFileSync('tests/webos/t28-desktop-before.css', 'utf8');
    if (!report.desktopCssUnchanged) failures.push('desktop CSS differs from T2.8 baseline');
}
fs.writeFileSync(`tests/webos/t29-artifact-${mode}.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;

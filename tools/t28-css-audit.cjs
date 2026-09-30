const fs = require('fs');
const crypto = require('crypto');
const { compile } = require('../tests/helpers/compileFocusLess');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
    const mode = process.argv[2];
    let report;
    if (mode === 'sources') {
        const baseline = JSON.parse(fs.readFileSync('tests/webos/t28-source-baseline.json'));
        const files = Object.keys(baseline).filter(file => fs.readFileSync(`src/${file}`, 'utf8').replaceAll('\r', '') !== baseline[file].replaceAll('\r', ''));
        report = [];
        for (const file of files) {
            const before = await compile(file, false, baseline[file]);
            const after = await compile(file, false);
            report.push({ file, identical: before === after, beforeHash: hash(before), afterHash: hash(after) });
        }
        fs.writeFileSync('tests/webos/t28-source-css-comparison.json', JSON.stringify(report, null, 2) + '\n');
        if (report.some(r => !r.identical)) process.exitCode = 1;
    } else {
        const filename = fs.readdirSync('build', { recursive: true }).find(f => f.endsWith('main.css'));
        const css = fs.readFileSync(`build/${filename}`);
        const html = fs.readFileSync('build/index.html', 'utf8');
        if (mode === 'desktop') {
            const before = fs.readFileSync('tests/webos/t28-desktop-before.css');
            report = { identical: before.equals(css), beforeBytes: before.length, afterBytes: css.length, beforeHash: hash(before), afterHash: hash(css), viewport: html.match(/<meta name="viewport"[^>]*>/)?.[0] };
            if (!report.identical || !report.viewport.includes('width=device-width')) process.exitCode = 1;
        } else if (mode === 'webos') {
            const text = css.toString();
            report = { bytes: css.length, hash: hash(css), unsupportedFunctions: text.match(/\b(?:env|min|max|clamp)\s*\(/g) || [],
                insets: Object.fromEntries(['top', 'right', 'bottom', 'left'].map(side => [side, [...text.matchAll(new RegExp(`--safe-area-inset-${side}:([^;}]+)`, 'g'))].map(m => m[1])])),
                viewport: html.match(/<meta name="viewport"[^>]*>/)?.[0] };
            if (report.unsupportedFunctions.length || !report.viewport.includes('width=1920') || !report.viewport.includes('height=1080')) process.exitCode = 1;
            for (const [side, values] of Object.entries(report.insets)) {
                if (!values.length || values.some(v => v !== (['left', 'right'].includes(side) ? '48px' : '27px'))) process.exitCode = 1;
            }
        } else throw Error('Usage: node tools/t28-css-audit.cjs <desktop|webos|sources>');
        fs.writeFileSync(`tests/webos/t28-${mode}-css.json`, JSON.stringify(report, null, 2) + '\n');
    }
    console.log(JSON.stringify(Array.isArray(report) ? { files: report.length, failures: report.filter(r => !r.identical) } : report, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });

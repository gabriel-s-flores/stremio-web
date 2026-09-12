import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import ts from 'typescript';

export function audit(mode, directory = 'build') {
    const configPath = mode === 'desktop' ? 'tsconfig.json' : 'tsconfig.webos.json';
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
    const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match => match[1]);
    const appleScripts = scripts.filter(src => src.includes('appleid.auth.js'));
    assert.equal(appleScripts.length, mode === 'desktop' ? 1 : 0);
    const main = scripts.find(src => /\/main\.js$/.test(src));
    assert.ok(main, 'Main bundle referenced by HTML');
    const mainPath = path.join(directory, main);
    const map = JSON.parse(fs.readFileSync(mainPath + '.map', 'utf8'));
    const sources = [
        'src/common/FileDrop/FileDrop.tsx', 'src/common/Discord/Discord.tsx',
        'src/App/UpdaterBanner/UpdaterBanner.tsx', 'src/routes/Settings/Settings.tsx',
        'src/routes/Settings/Menu/Menu.tsx', 'src/routes/Settings/Interface/Interface.tsx',
        'src/routes/Settings/Player/Player.tsx',
    ].map(file => {
        const index = map.sources.findIndex(source => source.endsWith('/' + file));
        assert.ok(index >= 0, 'Bundled source: ' + file);
        // ts-loader emits transformed JS into these source maps (sourceMap is off in tsconfig).
        const expected = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file, compilerOptions: options }).outputText;
        assert.ok(map.sourcesContent[index].replace(/\r\n/g, '\n').trim() === expected.replace(/\r\n/g, '\n').trim(), file + ' matches checkout compilation');
        return file;
    });
    return { mode, date: new Date().toISOString(), appleScripts, sources, mainSha256: crypto.createHash('sha256').update(fs.readFileSync(mainPath)).digest('hex'), passed: true };
}
if (process.argv[1]?.endsWith('t310-artifacts.mjs')) {
    const mode = process.argv[2];
    assert.ok(['desktop', 'hosted', 'packaged'].includes(mode));
    console.log(JSON.stringify(audit(mode, process.argv[3]), null, 2));
}

import fs from 'node:fs';
import path from 'node:path';

const buildDirectory = path.resolve(process.argv[2] || 'build');
const expectedMode = process.argv[3] || 'debug';

const fail = (message) => {
    throw new Error(`webOS diagnostics verification failed: ${message}`);
};

const assert = (condition, message) => {
    if (!condition) fail(message);
};

const isFile = (filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile();

try {
    assert(expectedMode === 'debug' || expectedMode === 'standard', 'mode must be debug or standard');
    assert(fs.existsSync(buildDirectory), `missing directory ${buildDirectory}`);

    const commitDirectories = fs.readdirSync(buildDirectory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^[a-f0-9]{40}$/i.test(entry.name));
    assert(commitDirectories.length === 1, `expected one commit directory, found ${commitDirectories.length}`);

    const commitHash = commitDirectories[0].name;
    const mainPath = path.join(buildDirectory, commitHash, 'scripts', 'main.js');
    const cssPath = path.join(buildDirectory, commitHash, 'styles', 'main.css');
    assert(isFile(mainPath), `missing ${path.relative(buildDirectory, mainPath)}`);
    assert(isFile(cssPath), `missing ${path.relative(buildDirectory, cssPath)}`);

    const main = fs.readFileSync(mainPath, 'utf8');
    const css = fs.readFileSync(cssPath, 'utf8');
    const debugPresent = main.includes('__stremioWebosDebug') && main.includes('webOS diagnostics') && main.includes('/debug') && css.includes('debug-container');
    const focusFixturePresent = main.includes('data-webos-focus-fixture') && main.includes('/debug/focus');
    const fontsIconsFixturePresent = main.includes('data-webos-fonts-icons-fixture') && main.includes('/debug/fonts-icons');

    if (expectedMode === 'debug') {
        assert(debugPresent, 'debug runtime, route, or styles are missing');
        assert(focusFixturePresent, 'T2.5 real-control fixture is missing');
        assert(fontsIconsFixturePresent, 'T2.9 fonts/icons fixture is missing');
    } else {
        assert(!debugPresent, 'debug diagnostics leaked into the standard build');
        assert(!main.includes('data-webos-focus-fixture') && !main.includes('/debug/focus'), 'T2.5 fixture leaked into the standard build');
        assert(!main.includes('data-webos-fonts-icons-fixture') && !main.includes('/debug/fonts-icons'), 'T2.9 fixture leaked into the standard build');
    }

    console.log(JSON.stringify({
        buildDirectory,
        commitHash,
        mode: expectedMode,
        debugPresent,
        focusFixturePresent,
        fontsIconsFixturePresent,
    }, null, 2));
} catch (error) {
    console.error(error.message);
    process.exit(1);
}

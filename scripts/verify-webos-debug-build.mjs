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

    if (expectedMode === 'debug') {
        assert(debugPresent, 'debug runtime, route, or styles are missing');
    } else {
        assert(!debugPresent, 'debug diagnostics leaked into the standard build');
    }

    console.log(JSON.stringify({
        buildDirectory,
        commitHash,
        mode: expectedMode,
        debugPresent,
    }, null, 2));
} catch (error) {
    console.error(error.message);
    process.exit(1);
}

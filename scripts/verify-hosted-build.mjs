import fs from 'node:fs';
import path from 'node:path';

const buildDirectory = path.resolve(process.argv[2] || 'build');

const fail = (message) => {
    throw new Error(`Hosted build verification failed: ${message}`);
};

const assert = (condition, message) => {
    if (!condition) fail(message);
};

const isFile = (filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile();

try {
    assert(fs.existsSync(buildDirectory), `missing directory ${buildDirectory}`);

    const indexPath = path.join(buildDirectory, 'index.html');
    assert(isFile(indexPath), 'missing index.html');

    const index = fs.readFileSync(indexPath, 'utf8');
    assert(!/<%=?/.test(index), 'index.html contains unresolved template markers');

    const commitDirectories = fs.readdirSync(buildDirectory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^[a-f0-9]{40}$/i.test(entry.name));
    assert(commitDirectories.length === 1, `expected one commit directory, found ${commitDirectories.length}`);

    const commitHash = commitDirectories[0].name;
    const requiredFiles = [
        'index.html',
        'manifest.json',
        'service-worker.js',
        `${commitHash}/scripts/main.js`,
        `${commitHash}/scripts/worker.js`
    ];

    for (const relativePath of requiredFiles) {
        assert(isFile(path.join(buildDirectory, relativePath)), `missing ${relativePath}`);
    }

    const binariesDirectory = path.join(buildDirectory, commitHash, 'binaries');
    const wasmFiles = fs.existsSync(binariesDirectory)
        ? fs.readdirSync(binariesDirectory).filter((fileName) => fileName.endsWith('.wasm'))
        : [];
    assert(wasmFiles.length > 0, `missing WASM binary under ${commitHash}/binaries`);
    assert(index.includes(`${commitHash}/scripts/main.js`), 'index.html does not reference the commit-scoped main script');

    const localReferences = [...index.matchAll(/(?:src|href)=["']([^"']+)["']/gi)]
        .map((match) => match[1])
        .filter((reference) => reference && !/^(?:[a-z]+:|\/\/|#|data:|javascript:)/i.test(reference));

    for (const reference of localReferences) {
        const relativeReference = reference.split(/[?#]/, 1)[0];
        if (!relativeReference) continue;
        assert(!relativeReference.startsWith('/'), `absolute asset reference is not supported: ${reference}`);

        const resolvedReference = path.resolve(buildDirectory, relativeReference);
        assert(
            resolvedReference === buildDirectory || resolvedReference.startsWith(`${buildDirectory}${path.sep}`),
            `asset reference escapes build directory: ${reference}`
        );
        assert(isFile(resolvedReference), `missing asset referenced by index.html: ${reference}`);
    }

    console.log(JSON.stringify({
        buildDirectory,
        commitHash,
        wasmFiles,
        checkedReferences: localReferences.length
    }, null, 2));
} catch (error) {
    console.error(error.message);
    process.exit(1);
}

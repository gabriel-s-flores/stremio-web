import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const argumentsList = process.argv.slice(2).filter((argument) => argument !== '--');
const normalizeWorkboxSourceMap = argumentsList.includes('--normalize-workbox-sourcemap');
const positionalArguments = argumentsList.filter((argument) => argument !== '--normalize-workbox-sourcemap');
const [baselineArgument, candidateArgument] = positionalArguments;

const fail = (message) => {
    throw new Error(`Build equivalence verification failed: ${message}`);
};

const resolveDirectory = (argument, label) => {
    if (!argument) {
        fail(`usage: pnpm verify:build-equivalence -- <baseline> <candidate>`);
    }

    const directory = path.resolve(argument);
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
        fail(`${label} directory does not exist: ${directory}`);
    }

    return directory;
};

const listFiles = (rootDirectory, currentDirectory = rootDirectory, files = []) => {
    for (const entry of fs.readdirSync(currentDirectory, { withFileTypes: true })) {
        const filePath = path.join(currentDirectory, entry.name);

        if (entry.isDirectory()) {
            listFiles(rootDirectory, filePath, files);
        } else if (entry.isFile()) {
            files.push(path.relative(rootDirectory, filePath).split(path.sep).join('/'));
        } else {
            fail(`unsupported filesystem entry: ${filePath}`);
        }
    }

    return files.sort();
};

const sha256 = (contents) => crypto.createHash('sha256').update(contents).digest('hex');

const getComparableContents = (fileName, contents) => {
    if (!normalizeWorkboxSourceMap || fileName !== 'service-worker.js.map') {
        return { contents, normalized: false };
    }

    let sourceMap;
    try {
        sourceMap = JSON.parse(contents.toString('utf8'));
    } catch (_error) {
        return { contents, normalized: false };
    }

    if (!Array.isArray(sourceMap.sources)) {
        return { contents, normalized: false };
    }

    const normalizedSources = sourceMap.sources.map((source) => {
        if (typeof source !== 'string') return source;

        return source.replace(
            /[a-f0-9]{32}\/service-worker\.js$/i,
            '<workbox-temp>/service-worker.js'
        );
    });
    const normalized = normalizedSources.some((source, index) => source !== sourceMap.sources[index]);

    if (!normalized) {
        return { contents, normalized: false };
    }

    sourceMap.sources = normalizedSources;
    return {
        contents: Buffer.from(JSON.stringify(sourceMap)),
        normalized: true,
    };
};

try {
    const baselineDirectory = resolveDirectory(baselineArgument, 'baseline');
    const candidateDirectory = resolveDirectory(candidateArgument, 'candidate');
    const baselineFiles = listFiles(baselineDirectory);
    const candidateFiles = listFiles(candidateDirectory);
    const fileNames = [...new Set([...baselineFiles, ...candidateFiles])].sort();
    const differences = [];
    const normalizedFiles = [];
    let totalBytes = 0;

    for (const fileName of fileNames) {
        const baselinePath = path.join(baselineDirectory, fileName);
        const candidatePath = path.join(candidateDirectory, fileName);
        const baselineExists = fs.existsSync(baselinePath);
        const candidateExists = fs.existsSync(candidatePath);

        if (!baselineExists || !candidateExists) {
            differences.push({
                file: fileName,
                status: baselineExists ? 'missing-in-candidate' : 'missing-in-baseline',
            });
            continue;
        }

        const baselineContents = fs.readFileSync(baselinePath);
        const candidateContents = fs.readFileSync(candidatePath);
        const comparableBaseline = getComparableContents(fileName, baselineContents);
        const comparableCandidate = getComparableContents(fileName, candidateContents);
        totalBytes += baselineContents.length;

        if (comparableBaseline.normalized || comparableCandidate.normalized) {
            normalizedFiles.push(fileName);
        }

        if (!comparableBaseline.contents.equals(comparableCandidate.contents)) {
            differences.push({
                file: fileName,
                status: 'content-differs',
                baselineBytes: comparableBaseline.contents.length,
                candidateBytes: comparableCandidate.contents.length,
                baselineSha256: sha256(comparableBaseline.contents),
                candidateSha256: sha256(comparableCandidate.contents),
            });
        }
    }

    const result = {
        equal: differences.length === 0,
        baselineDirectory,
        candidateDirectory,
        baselineFileCount: baselineFiles.length,
        candidateFileCount: candidateFiles.length,
        totalBaselineBytes: totalBytes,
        normalizedFiles,
        differences,
    };

    if (!result.equal) {
        console.error(JSON.stringify(result, null, 2));
        process.exit(1);
    }

    console.log(JSON.stringify(result, null, 2));
} catch (error) {
    console.error(error.message);
    process.exit(1);
}

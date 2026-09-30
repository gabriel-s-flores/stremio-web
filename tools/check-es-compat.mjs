import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { runChecks } = require('es-check');

const buildDirectory = path.resolve(process.argv[2] || 'build');

const listJavaScriptFiles = (directory, files = []) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const filePath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            listJavaScriptFiles(filePath, files);
        } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.js') {
            files.push(filePath);
        }
    }

    return files.sort();
};

const formatPath = (filePath) => filePath.split(path.sep).join('/');
const writeOutput = (message) => process.stdout.write(`${message}\n`);

if (!fs.existsSync(buildDirectory) || !fs.statSync(buildDirectory).isDirectory()) {
    console.error(`Build directory does not exist: ${buildDirectory}`);
    process.exit(1);
}

const files = listJavaScriptFiles(buildDirectory);
const relativeFiles = files.map((filePath) => formatPath(path.relative(process.cwd(), filePath)));
const workerFile = relativeFiles.find((filePath) => /(?:^|\/)scripts\/worker\.js$/.test(filePath));

if (files.length === 0) {
    console.error(`No JavaScript files found under ${buildDirectory}`);
    process.exit(1);
}

if (!workerFile) {
    console.error(`Generated worker.js was not found under ${buildDirectory}`);
    process.exit(1);
}

const results = files.map((filePath, index) => {
    const file = formatPath(filePath);
    const result = runChecks([{ ecmaVersion: 'es2018', files: [file] }]);
    const errors = result.errors.map(({ err, line, column }) => ({
        message: err.message,
        line,
        column,
    }));

    return {
        file: relativeFiles[index],
        success: result.success,
        errors,
    };
});

const failures = results.filter(({ success }) => !success);

for (const result of results) {
    if (result.success) {
        writeOutput(`PASS ${result.file}`);
        continue;
    }

    console.error(`FAIL ${result.file}`);
    for (const error of result.errors) {
        const location = error.line === undefined ? '' : `:${error.line}:${error.column ?? 0}`;
        console.error(`  ${error.message}${location}`);
    }
}

writeOutput(`ES2018 compatibility: ${results.length - failures.length}/${results.length} files passed`);
process.exitCode = failures.length === 0 ? 0 : 1;

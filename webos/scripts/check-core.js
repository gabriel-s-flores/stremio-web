#!/usr/bin/env node
// Guard of the core files in the webOS build (part of pnpm webos:check-syntax):
//   node webos/scripts/check-core.js [build-webos]
// - stremio_core_web_bg.wasm and stremio_core_web_bg.wasm2js.js are in the folder of worker.js
//   (the loader resolves them relative to the worker) and are byte for byte the vendored ones;
// - the .wasm2js.js keeps the eager factory: the factory and asmFunc wrapped in parentheses
//   (webos/core/wasm2js-finish.js). Babel, Terser or a re-minifying packager drop them and the
//   init on the C8 profile goes from ~9 s back to ~14 s or more, with nothing else failing.
// Exits with 1 and lists the problems otherwise.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const VENDOR_DIR = path.join(ROOT, 'webos', 'vendor', 'stremio-core-web');
const WASM2JS_FILE = 'stremio_core_web_bg.wasm2js.js';
const CORE_FILES = ['stremio_core_web_bg.wasm', WASM2JS_FILE];

const vendorBytes = {};
const readVendor = (file) => {
    vendorBytes[file] = vendorBytes[file] || fs.readFileSync(path.join(VENDOR_DIR, file));
    return vendorBytes[file];
};

const sameAsVendor = (file, buffer) => Buffer.compare(readVendor(file), buffer) === 0;

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

// The acorn webpack uses (the one wasm2js-finish.js also uses).
const loadAcorn = () => {
    const webpackDir = path.dirname(require.resolve('webpack', { paths: [ROOT] }));
    return require(require.resolve('acorn', { paths: [webpackDir] }));
};

const isParenthesizedFunction = (node) => {
    return Boolean(node) && node.type === 'ParenthesizedExpression' && node.expression.type === 'FunctionExpression';
};

// Problems with the eager factory of a wasm2js file ([] if it is there). The shape is the one
// wasm2js-finish.js writes: one top-level `!function(root, factory){...}(this, (function(){
// ... return (function asmFunc(imports){...}) }))`, or `var asmFunc = (function asmFunc...)`
// returned by name.
const eagerProblems = (text) => {
    const ast = loadAcorn().parse(text, { ecmaVersion: 5, sourceType: 'script', preserveParens: true });
    const statements = ast.body.filter((node) => node.type === 'ExpressionStatement');
    if (statements.length !== 1) {
        return [`expected one top-level statement, found ${statements.length}`];
    }
    let call = statements[0].expression;
    if (call.type === 'UnaryExpression') {
        call = call.argument;
    }
    if (call.type !== 'CallExpression' || call.arguments.length !== 2) {
        return ['the top-level statement is not the UMD call (root, factory)'];
    }
    const factory = call.arguments[1];
    if (!isParenthesizedFunction(factory)) {
        return ['the factory is not wrapped in parentheses'];
    }
    const body = factory.expression.body.body;
    const ret = body[body.length - 1];
    if (!ret || ret.type !== 'ReturnStatement' || !ret.argument) {
        return ['the factory does not end with a return'];
    }
    if (isParenthesizedFunction(ret.argument)) {
        return [];
    }
    if (ret.argument.type === 'Identifier') {
        const declarators = body
            .filter((node) => node.type === 'VariableDeclaration')
            .flatMap((node) => node.declarations)
            .filter((declarator) => declarator.id.name === ret.argument.name);
        if (declarators.length === 1 && isParenthesizedFunction(declarators[0].init)) {
            return [];
        }
    }
    return ['asmFunc (returned by the factory) is not wrapped in parentheses'];
};

const findFiles = (dir, name) => {
    return fs.readdirSync(dir, { recursive: true })
        .filter((file) => path.basename(file) === name)
        .map((file) => path.join(dir, file));
};

// Checks a build folder; returns { problems, lines } (lines: what was checked, for the log).
const checkBuild = (buildDir) => {
    const problems = [];
    const lines = [];
    const workers = findFiles(buildDir, 'worker.js');
    if (workers.length !== 1) {
        problems.push(`expected one worker.js in ${buildDir}, found ${workers.length}`);
        return { problems, lines };
    }
    const workerDir = path.dirname(workers[0]);
    CORE_FILES.forEach((file) => {
        const found = findFiles(buildDir, file);
        const expected = path.join(workerDir, file);
        if (found.length !== 1 || found[0] !== expected) {
            problems.push(`expected ${file} only next to worker.js (${path.relative(buildDir, expected)}), found: ${found.map((f) => path.relative(buildDir, f)).join(', ') || 'none'}`);
            return;
        }
        const bytes = fs.readFileSync(expected);
        const same = sameAsVendor(file, bytes);
        lines.push(`${path.relative(buildDir, expected)}: ${bytes.length} bytes, sha256 ${sha256(bytes)} ${same ? '== vendor' : `!= vendor (${sha256(readVendor(file))})`}`);
        if (!same) {
            problems.push(`${file} differs from webos/vendor/stremio-core-web/${file}`);
        }
        if (file === WASM2JS_FILE) {
            const eager = eagerProblems(bytes.toString('utf8'));
            lines.push(`${file}: eager factory ${eager.length === 0 ? 'ok (factory and asmFunc in parentheses)' : 'MISSING'}`);
            problems.push(...eager.map((problem) => `${file}: ${problem}`));
        }
    });
    return { problems, lines };
};

if (require.main === module) {
    const buildDir = path.resolve(process.argv[2] || path.join(ROOT, 'build-webos'));
    if (!fs.existsSync(buildDir)) {
        console.error(`check-core: ${buildDir} not found, run pnpm webos:build`);
        process.exit(1);
    }
    const { problems, lines } = checkBuild(buildDir);
    lines.forEach((line) => process.stdout.write(`check-core: ${line}\n`));
    problems.forEach((problem) => console.error(`check-core: error: ${problem}`));
    if (problems.length > 0) {
        process.exit(1);
    }
    process.stdout.write('check-core: ok\n');
}

module.exports = {
    VENDOR_DIR,
    CORE_FILES,
    sameAsVendor,
    eagerProblems,
    checkBuild,
};

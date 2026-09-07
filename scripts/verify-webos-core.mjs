import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_CDP_HTTP = 'http://127.0.0.1:9998';
let cdpMessageId = 0;

const fail = (message) => {
    throw new Error(`webOS core verification failed: ${message}`);
};

const readUnsignedLeb128 = (bytes, offset) => {
    let value = 0;
    let shift = 0;
    let cursor = offset;

    while (cursor < bytes.length) {
        const byte = bytes[cursor];
        value |= (byte & 0x7f) << shift;
        cursor += 1;
        if ((byte & 0x80) === 0) return { value, offset: cursor };
        shift += 7;
        if (shift > 35) fail(`invalid WASM LEB128 at byte ${offset}`);
    }

    fail(`truncated WASM LEB128 at byte ${offset}`);
};

const parseReferenceTypes = (bytes) => {
    if (bytes.length < 8 || bytes.readUInt32LE(0) !== 0x6d736100) {
        fail('WASM has an invalid header');
    }

    let offset = 8;
    while (offset < bytes.length) {
        const sectionOffset = offset;
        const sectionId = bytes[offset];
        offset += 1;
        const sectionSize = readUnsignedLeb128(bytes, offset);
        offset = sectionSize.offset;
        const sectionEnd = offset + sectionSize.value;

        if (sectionEnd > bytes.length) fail(`WASM section at byte ${sectionOffset} is truncated`);
        if (sectionId !== 1) {
            offset = sectionEnd;
            continue;
        }

        const types = readUnsignedLeb128(bytes, offset);
        offset = types.offset;
        const references = [];

        const readValueType = () => {
            if (offset >= sectionEnd) fail('WASM type section is truncated');
            const typeOffset = offset;
            const type = bytes[offset];
            offset += 1;
            if (type === 0x6f || type === 0x70) {
                references.push({
                    byte: type,
                    offset: typeOffset,
                    name: type === 0x6f ? 'externref' : 'funcref',
                });
            }
        };

        for (let index = 0; index < types.value; index += 1) {
            if (offset >= sectionEnd || bytes[offset] !== 0x60) {
                fail(`unsupported WASM type form at byte ${offset}`);
            }
            offset += 1;
            const params = readUnsignedLeb128(bytes, offset);
            offset = params.offset;
            for (let param = 0; param < params.value; param += 1) readValueType();
            const results = readUnsignedLeb128(bytes, offset);
            offset = results.offset;
            for (let result = 0; result < results.value; result += 1) readValueType();
        }

        return references;
    }

    return [];
};

const parseArguments = () => {
    const args = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === '--'));
    const result = {
        buildDirectory: path.resolve('build'),
        cdpHint: null,
        cdpHttp: process.env.CDP_HTTP || DEFAULT_CDP_HTTP,
    };

    if (args[0] && !args[0].startsWith('--')) result.buildDirectory = path.resolve(args.shift());

    while (args.length > 0) {
        const option = args.shift();
        if (option === '--cdp') {
            result.cdpHint = args.shift();
        } else if (option === '--cdp-http') {
            result.cdpHttp = args.shift();
        } else {
            fail(`unknown option ${option}`);
        }
    }

    if (!result.cdpHint && process.env.CDP_TARGET) result.cdpHint = process.env.CDP_TARGET;
    return result;
};

const findBuildArtifacts = (buildDirectory) => {
    if (!fs.existsSync(buildDirectory) || !fs.statSync(buildDirectory).isDirectory()) {
        fail(`missing build directory ${buildDirectory}`);
    }

    const commitDirectories = fs.readdirSync(buildDirectory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^[a-f0-9]{40}$/i.test(entry.name));
    if (commitDirectories.length !== 1) {
        fail(`expected one commit directory, found ${commitDirectories.length}`);
    }

    const commitHash = commitDirectories[0].name;
    const workerPath = path.join(buildDirectory, commitHash, 'scripts', 'worker.js');
    const wasmPath = path.join(buildDirectory, commitHash, 'binaries', 'stremio_core_web_bg.wasm');
    if (!fs.existsSync(workerPath)) fail(`missing ${path.relative(buildDirectory, workerPath)}`);
    if (!fs.existsSync(wasmPath)) fail(`missing ${path.relative(buildDirectory, wasmPath)}`);

    return { commitHash, workerPath, wasmPath };
};

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

const connect = (url) => new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.onopen = () => resolve(socket);
    socket.onerror = () => reject(new Error(`cannot connect to CDP ${url}`));
});

const sendCdp = (socket, method, params = {}) => new Promise((resolve, reject) => {
    const id = ++cdpMessageId;
    const onMessage = (event) => {
        let message;
        try {
            message = JSON.parse(event.data);
        } catch (_error) {
            return;
        }
        if (message.id !== id) return;
        socket.removeEventListener('message', onMessage);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
    };

    socket.addEventListener('message', onMessage);
    socket.send(JSON.stringify({ id, method, params }));
});

const runRuntimeProbe = async ({ cdpHttp, cdpHint, commitHash }) => {
    const response = await fetch(`${cdpHttp}/json`);
    if (!response.ok) fail(`CDP /json returned HTTP ${response.status}`);
    const targets = await response.json();
    const target = targets.find((candidate) => (
        (candidate.id && candidate.id.includes(cdpHint))
        || (candidate.url && candidate.url.includes(cdpHint))
        || (candidate.title && candidate.title.includes(cdpHint))
    ));
    if (!target || !target.webSocketDebuggerUrl) fail(`CDP target not found: ${cdpHint}`);

    const socket = await connect(target.webSocketDebuggerUrl);
    const expression = `(async function () {
        var result = {
            href: location.href,
            userAgent: navigator.userAgent,
            appChildren: document.getElementById('app') ? document.getElementById('app').childNodes.length : -1,
            hasCore: !!window.core
        };
        var wasmUrl = new URL('${commitHash}/binaries/stremio_core_web_bg.wasm', location.href).href;
        var wasmResponse = await fetch(wasmUrl);
        var wasmBytes = await wasmResponse.arrayBuffer();
        result.wasm = {
            status: wasmResponse.status,
            bytes: wasmBytes.byteLength,
            valid: WebAssembly.validate(wasmBytes)
        };
        try {
            await WebAssembly.compile(wasmBytes);
            result.wasm.compiled = true;
        } catch (error) {
            result.wasm.compiled = false;
            result.wasm.error = String(error);
        }
        if (window.core) {
            try {
                var ctx = await window.core.getState('ctx');
                result.ctx = {
                    type: typeof ctx,
                    keys: ctx && typeof ctx === 'object' ? Object.keys(ctx).sort() : []
                };
            } catch (error) {
                result.ctxError = String(error);
            }
        }
        if (window.__stremioWebosDebug) {
            var snapshot = window.__stremioWebosDebug.refresh();
            result.marks = snapshot.marks;
            result.memory = snapshot.memory;
            if (typeof snapshot.marks.entry === 'number' && typeof snapshot.marks['core-ready'] === 'number') {
                result.coreReadyAfterEntryMs = snapshot.marks['core-ready'] - snapshot.marks.entry;
            }
        }
        return result;
    })()`;

    try {
        const evaluation = await sendCdp(socket, 'Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
        });
        if (evaluation.exceptionDetails) {
            fail(evaluation.exceptionDetails.text || 'runtime probe threw an exception');
        }
        return evaluation.result && evaluation.result.value;
    } finally {
        socket.close();
    }
};

const main = async () => {
    const options = parseArguments();
    const artifacts = findBuildArtifacts(options.buildDirectory);
    const wasm = fs.readFileSync(artifacts.wasmPath);
    const referenceTypes = parseReferenceTypes(wasm);
    const report = {
        buildDirectory: options.buildDirectory,
        commitHash: artifacts.commitHash,
        worker: path.relative(process.cwd(), artifacts.workerPath).split(path.sep).join('/'),
        wasm: {
            file: path.relative(process.cwd(), artifacts.wasmPath).split(path.sep).join('/'),
            bytes: wasm.length,
            sha256: sha256(wasm),
            nodeValid: WebAssembly.validate(wasm),
            referenceTypes,
        },
    };

    if (!report.wasm.nodeValid) fail('WASM is invalid in the current Node runtime');
    if (referenceTypes.length > 0) {
        fail(`WASM uses unsupported reference types: ${referenceTypes.map(({ name }) => name).join(', ')}`);
    }

    if (options.cdpHint) {
        report.runtime = await runRuntimeProbe({ ...options, commitHash: artifacts.commitHash });
        if (!report.runtime.wasm || report.runtime.wasm.status !== 200 || !report.runtime.wasm.compiled) {
            fail(`Chromium 68 could not compile the WASM: ${JSON.stringify(report.runtime.wasm)}`);
        }
        if (!report.runtime.hasCore || !report.runtime.ctx || report.runtime.ctx.type !== 'object') {
            fail(`core state probe did not resolve: ${JSON.stringify(report.runtime.ctx || report.runtime.ctxError)}`);
        }
    }

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
};

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});

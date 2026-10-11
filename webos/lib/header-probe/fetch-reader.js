// `readRange` implementation over fetch() with an HTTP Range header, for the app runtime
// (Chromium 53: fetch and ReadableStream exist, AbortController does not).

const { ProbeError } = require('./source');

const CONTENT_RANGE = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/i;

const parseTotal = (response) => {
    const contentRange = response.headers.get('Content-Range');
    const match = contentRange ? CONTENT_RANGE.exec(contentRange) : null;
    if (match && match[3] !== '*') return parseInt(match[3], 10);
    const unsatisfied = contentRange ? /\/(\d+)/.exec(contentRange) : null;
    return unsatisfied ? parseInt(unsatisfied[1], 10) : null;
};

const parseRangeStart = (response) => {
    const contentRange = response.headers.get('Content-Range');
    const match = contentRange ? CONTENT_RANGE.exec(contentRange) : null;
    return match ? parseInt(match[1], 10) : null;
};

// Reads the body until `skip + length` bytes and cancels the rest of the transfer.
const readBody = (response, skip, length) => {
    if (!response.body || typeof response.body.getReader !== 'function') {
        return response.arrayBuffer().then((buffer) => new Uint8Array(buffer).subarray(skip, skip + length));
    }
    const reader = response.body.getReader();
    const out = new Uint8Array(length);
    let received = 0;
    let filled = 0;
    const pump = () => reader.read().then((step) => {
        if (step.done) return out.subarray(0, filled);
        const chunk = step.value;
        let from = 0;
        if (received < skip) from = Math.min(chunk.length, skip - received);
        received += chunk.length;
        const take = Math.min(chunk.length - from, length - filled);
        if (take > 0) {
            out.set(chunk.subarray(from, from + take), filled);
            filled += take;
        }
        if (filled >= length) {
            reader.cancel().catch(() => null);
            return out;
        }
        return pump();
    });
    return pump();
};

const withTimeout = (promise, timeout, url) => {
    if (!timeout) return promise;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new ProbeError('TIMEOUT', 'request timed out after ' + timeout + ' ms: ' + url)), timeout);
        promise.then((value) => {
            clearTimeout(timer);
            resolve(value);
        }, (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
};

// options.fetch (default: global fetch), options.headers, options.timeout (ms, default 15000),
// options.maxSkipBytes: bytes a server without Range support may send before the wanted offset.
const createFetchReadRange = (url, options) => {
    const opts = options || {};
    const fetchImpl = opts.fetch || (typeof fetch === 'function' ? fetch : null);
    const timeout = opts.timeout === undefined ? 15000 : opts.timeout;
    const maxSkipBytes = opts.maxSkipBytes === undefined ? 1024 * 1024 : opts.maxSkipBytes;
    if (fetchImpl === null) throw new ProbeError('NETWORK', 'fetch is not available');
    let currentUrl = url;

    return (offset, length) => {
        const headers = Object.assign({}, opts.headers, { Range: 'bytes=' + offset + '-' + (offset + length - 1) });
        const request = fetchImpl(currentUrl, { headers, credentials: 'omit' }).then((response) => {
            if (response.status === 416) {
                return { data: new Uint8Array(0), size: parseTotal(response) };
            }
            if (response.status !== 206 && response.status !== 200) {
                const failure = new ProbeError('HTTP', 'HTTP ' + response.status + ' for ' + currentUrl);
                // The status lets the app explain a dead debrid link (webos/lib/debrid-link).
                failure.httpStatus = response.status;
                throw failure;
            }
            // Later reads go straight to the final URL instead of repeating the debrid redirect.
            if (response.url && response.redirected !== false) currentUrl = response.url;
            if (response.status === 206) {
                const start = parseRangeStart(response);
                if (start !== null && start > offset) {
                    throw new ProbeError('HTTP', 'partial response starts at ' + start + ', after the requested ' + offset);
                }
                // Content-Range may be hidden by CORS (not exposed): then only a body no longer than
                // the requested range can be trusted to start at the requested offset.
                const contentLength = parseInt(response.headers.get('Content-Length'), 10);
                if (start === null && offset > 0 && isFinite(contentLength) && contentLength > length) {
                    throw new ProbeError('HTTP', 'partial response without Content-Range is larger than the requested range');
                }
                const skip = start !== null && start < offset ? offset - start : 0;
                return readBody(response, skip, length).then((data) => ({ data, size: parseTotal(response) }));
            }
            if (offset > maxSkipBytes) {
                throw new ProbeError('RANGE_NOT_SUPPORTED', 'server ignored the Range header');
            }
            const contentLength = parseInt(response.headers.get('Content-Length'), 10);
            return readBody(response, offset, length).then((data) => ({
                data,
                size: isFinite(contentLength) ? contentLength : null,
            }));
        }, (error) => {
            throw new ProbeError('NETWORK', (error && error.message) || String(error));
        });
        return withTimeout(request, timeout, currentUrl);
    };
};

module.exports = {
    createFetchReadRange,
};

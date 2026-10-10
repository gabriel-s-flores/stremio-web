// Random-access byte source over an injectable `readRange(offset, length)` function, with a
// block cache and hard limits on requests and downloaded bytes.
//
// readRange(offset, length) -> Promise<{ data: Uint8Array, size: number | null }>
//   `data` holds the bytes starting at `offset`; it may be shorter than `length` only at the end
//   of the file. `size` is the total file size when known (Content-Range), otherwise null.

class ProbeError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'ProbeError';
        this.code = code;
    }
}

const DEFAULTS = {
    blockSize: 256 * 1024,
    maxBytes: 8 * 1024 * 1024,
    maxRequests: 24,
};

const createSource = (readRange, options) => {
    const blockSize = (options && options.blockSize) || DEFAULTS.blockSize;
    const maxBytes = (options && options.maxBytes) || DEFAULTS.maxBytes;
    const maxRequests = (options && options.maxRequests) || DEFAULTS.maxRequests;
    const chunks = [];
    const stats = { requests: 0, bytesRead: 0 };
    let size = null;
    let eof = null;

    const knownEnd = () => {
        if (size !== null) return size;
        if (eof !== null) return eof;
        return Infinity;
    };

    const coveringChunk = (offset) => {
        let best = null;
        chunks.forEach((chunk) => {
            const end = chunk.start + chunk.data.length;
            if (chunk.start <= offset && end > offset && (best === null || end > best.start + best.data.length)) {
                best = chunk;
            }
        });
        return best;
    };

    const fetchRange = (start, length) => {
        if (stats.requests >= maxRequests) {
            return Promise.reject(new ProbeError('LIMIT', 'maxRequests (' + maxRequests + ') reached'));
        }
        const budget = maxBytes - stats.bytesRead;
        if (budget <= 0) {
            return Promise.reject(new ProbeError('LIMIT', 'maxBytes (' + maxBytes + ') reached'));
        }
        const fetchLength = Math.min(Math.max(length, blockSize), budget, knownEnd() - start);
        if (fetchLength < length && start + length <= knownEnd()) {
            return Promise.reject(new ProbeError('LIMIT', 'maxBytes (' + maxBytes + ') reached'));
        }
        stats.requests++;
        return Promise.resolve(readRange(start, fetchLength)).then((result) => {
            const data = result && result.data ? result.data : new Uint8Array(0);
            if (result && typeof result.size === 'number' && isFinite(result.size)) {
                size = result.size;
            }
            if (data.length < fetchLength) {
                eof = start + data.length;
            }
            stats.bytesRead += data.length;
            if (data.length > 0) {
                chunks.push({ start, data });
            }
            return data;
        });
    };

    // Resolves with the bytes in [offset, offset + length), shorter only at the end of the file.
    const read = (offset, length) => {
        const end = Math.min(offset + length, knownEnd());
        if (end <= offset) return Promise.resolve(new Uint8Array(0));
        const chunk = coveringChunk(offset);
        if (chunk !== null && chunk.start + chunk.data.length >= end) {
            return Promise.resolve(chunk.data.subarray(offset - chunk.start, end - chunk.start));
        }
        const head = chunk !== null ? chunk.data.subarray(offset - chunk.start) : new Uint8Array(0);
        const fetchStart = offset + head.length;
        return fetchRange(fetchStart, end - fetchStart).then((tail) => {
            const available = Math.min(end - fetchStart, tail.length);
            if (head.length === 0) return tail.subarray(0, available);
            const joined = new Uint8Array(head.length + available);
            joined.set(head, 0);
            joined.set(tail.subarray(0, available), head.length);
            return joined;
        });
    };

    // Like `read`, but rejects when the file ends before `length` bytes.
    const readExact = (offset, length) => read(offset, length).then((data) => {
        if (data.length < length) {
            throw new ProbeError('TRUNCATED', 'unexpected end of file at ' + (offset + data.length));
        }
        return data;
    });

    return {
        read,
        readExact,
        stats,
        size: () => size,
        end: knownEnd,
    };
};

module.exports = {
    createSource,
    ProbeError,
    DEFAULTS,
};

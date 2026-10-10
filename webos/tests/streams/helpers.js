// F6.2 test helpers: the test addon streams (webos/tests/addon) with their media prepared in a
// temporary folder, and the header probe over those files (same bytes the emulator reads over HTTP).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { STREAMS, toStreams } = require('../addon/catalog');
const { prepareMedia } = require('../addon/media');
const { probe } = require('../../lib/header-probe');
const { LIST_PROBE_OPTIONS } = require('../../lib/stream-ranking');

const MEDIA_URL = 'http://media.test';

const fileReadRange = (file) => {
    const fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    return (offset, length) => {
        const end = Math.min(offset + length, size);
        const data = Buffer.alloc(Math.max(0, end - offset));
        if (data.length > 0) fs.readSync(fd, data, 0, data.length, offset);
        return Promise.resolve({ data: new Uint8Array(data.buffer, data.byteOffset, data.length), size });
    };
};

// The addon streams, the media folder and probeUrl(url) over it (null for files that are missing:
// kit media not generated).
const setup = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f62-media-'));
    const missing = prepareMedia(dir, STREAMS.filter((entry) => entry.media).map((entry) => entry.media));
    const streams = toStreams(MEDIA_URL).filter((stream) => !stream.infoHash);
    const fileOf = (url) => path.join(dir, url.slice(`${MEDIA_URL}/redirect/`.length));
    const probeUrl = (url) => {
        const file = fileOf(url);
        if (!fs.existsSync(file)) return Promise.resolve(null);
        return probe(fileReadRange(file), { maxBytes: LIST_PROBE_OPTIONS.maxBytes, maxRequests: LIST_PROBE_OPTIONS.maxRequests });
    };
    const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
    return { dir, missing, streams, probeUrl, cleanup };
};

const entryOf = (stream) => STREAMS.filter((entry) => entry.description === stream.description)[0];

module.exports = { MEDIA_URL, setup, entryOf };

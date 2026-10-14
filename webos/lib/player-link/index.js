// The player link of a stream of Details, built by the page (F8.7).
//
// The core built `deepLinks.player` for every stream of the list on every get_state('meta_details'): 224
// streams from Torrentio + a debrid, a third of the bytes of each answer and of the time of a get_state in
// wasm2js. With webos/core/list-links.patch the core leaves it out of the list, and this module builds the
// same link, byte for byte, only for the streams the page renders (StreamsList shows 24 at a time):
//
//   #/player/<encoded stream>/<stream addon url>/<meta addon url>/<type>/<meta id>/<video id>
//   #/player/<encoded stream>                       (no meta item at all)
//
// as StreamDeepLinks::from in stremio-core src/deep_links/mod.rs, each part URI-component encoded (the core's
// URI_COMPONENT_ENCODE_SET is encodeURIComponent's), "stremio://" turned into "#" (into_web_deep_links).
// The encoded stream is Stream::encode: base64 of the zlib of the stream's JSON with no compression (the
// zlib_stored of webos/core/stream-links.patch: header 78 01, stored blocks of 31745 bytes, a last one with
// the rest, even empty, Adler-32). The JSON is the stream object the page got from the core without the
// keys the serializer adds around it (progress, deepLinks, lastUsed): its keys come in the core's order.
//
// withPlayerLinks(streams, context) returns MetaDetails#streams with a lazy `deepLinks.player` on the
// streams that have none, computed when something reads it (the Stream item, for its href) and kept; the
// stream objects are wrapped once per stream and context (useC8Ranking keys the streams by `deepLinks`).

const PAGE_KEYS = ['progress', 'deepLinks', 'lastUsed'];
const BLOCK = 31745;

const utf8 = (text) => {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text);
    const binary = unescape(encodeURIComponent(text));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
};

export const zlibStored = (data) => {
    const blocks = Math.floor(data.length / BLOCK) + 1;
    const out = new Uint8Array(2 + blocks * 5 + data.length + 4);
    let o = 0;
    out[o++] = 0x78;
    out[o++] = 0x01;
    let offset = 0;
    for (;;) {
        const last = data.length - offset < BLOCK;
        const len = last ? data.length - offset : BLOCK;
        out[o++] = last ? 1 : 0;
        out[o++] = len & 0xff;
        out[o++] = len >>> 8;
        out[o++] = ~len & 0xff;
        out[o++] = (~len >>> 8) & 0xff;
        out.set(data.subarray(offset, offset + len), o);
        o += len;
        offset += len;
        if (last) break;
    }
    let a = 1;
    let b = 0;
    for (let i = 0; i < data.length; i += 5552) {
        const end = Math.min(i + 5552, data.length);
        for (let j = i; j < end; j++) {
            a += data[j];
            b += a;
        }
        a %= 65521;
        b %= 65521;
    }
    out[o++] = b >>> 8;
    out[o++] = b & 0xff;
    out[o++] = a >>> 8;
    out[o++] = a & 0xff;
    return out;
};

const base64 = (bytes) => {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    return btoa(binary);
};

// Stream::encode of the core, from the stream object of a get_state.
export const encodeStream = (stream) => {
    const core = {};
    Object.keys(stream).forEach((key) => {
        if (PAGE_KEYS.indexOf(key) === -1) core[key] = stream[key];
    });
    return base64(zlibStored(utf8(JSON.stringify(core))));
};

// context: { streamTransportUrl, metaTransportUrl, type, id, videoId }, or null without a meta.
export const playerLink = (stream, context) => {
    const encoded = encodeURIComponent(encodeStream(stream));
    if (!context) return `#/player/${encoded}`;
    return `#/player/${encoded}/${[context.streamTransportUrl, context.metaTransportUrl, context.type, context.id, context.videoId].map((part) => encodeURIComponent(part)).join('/')}`;
};

// The parts of the link MetaDetails gives: the meta addon of the meta item the core serialized (the rule of
// serialize_meta_details: the first Ready one, else the first if all failed, else the first loading; whatever
// its state, the core built the whole link with it), the meta path and the video of the streams. null without
// that meta item: the short link, as the core. Edge left: a meta addon that is not in the profile any more
// leaves the serialized meta item null while the core still built the whole link with its request.
export const linkContext = (metaDetails) => {
    const selected = metaDetails && metaDetails.selected;
    const metaItem = metaDetails && metaDetails.metaItem;
    if (!selected || !selected.metaPath || !selected.streamPath || !metaItem || !metaItem.addon) return null;
    return {
        metaTransportUrl: metaItem.addon.transportUrl,
        type: selected.metaPath.type,
        id: selected.metaPath.id,
        videoId: selected.streamPath.id,
    };
};

const wrapped = new WeakMap();

const withLink = (stream, context) => {
    const key = context ? [context.streamTransportUrl, context.metaTransportUrl, context.type, context.id, context.videoId].join('\n') : '';
    const known = wrapped.get(stream);
    if (known && known.key === key) return known.stream;
    const deepLinks = Object.assign({}, stream.deepLinks);
    let player = null;
    Object.defineProperty(deepLinks, 'player', {
        enumerable: true,
        configurable: true,
        get: () => {
            if (player === null) player = playerLink(stream, context);
            return player;
        },
    });
    const result = Object.assign({}, stream, { deepLinks });
    wrapped.set(stream, { key, stream: result });
    return result;
};

export const withPlayerLinks = (streams, context) => {
    if (!Array.isArray(streams)) return streams;
    let changed = false;
    const result = streams.map((entry) => {
        if (!entry || !entry.content || entry.content.type !== 'Ready' || !Array.isArray(entry.content.content)) return entry;
        const groupContext = context && entry.addon ? Object.assign({ streamTransportUrl: entry.addon.transportUrl }, context) : null;
        let groupChanged = false;
        const content = entry.content.content.map((stream) => {
            if (!stream || typeof stream !== 'object' || !stream.deepLinks || typeof stream.deepLinks.player === 'string') return stream;
            groupChanged = true;
            return withLink(stream, groupContext);
        });
        if (!groupChanged) return entry;
        changed = true;
        return Object.assign({}, entry, { content: Object.assign({}, entry.content, { content }) });
    });
    return changed ? result : streams;
};

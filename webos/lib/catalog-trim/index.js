// Addon answers without what the core throws away, for the core worker (F7.2, extended in F8.7).
//
// The core (0.65) reads the response text, builds the whole JSON as a serde_json::Value inside the wasm
// (every key of every item) and only then keeps, per item, the fields of its structs; items pass through a
// `Content` buffer once more (VecSkipError, and `#[serde(flatten)]` in MetaItem and Video). With the TV's
// "--no-crankshaft" (webos/app/appinfo.json) none of that wasm2js code is optimized, and that throwaway work
// keeps the core busy for seconds: on the TV, a title opened while the boot's answers were still being read
// waited for them.
//
// F7.2: addon catalogs may carry, in each item of `metas`, the full `videos` list of a series (412 of the 522
// KB of Cinemeta's top series catalog), and MetaItemPreview has no `videos` (stremio-core
// src/types/addon/response.rs: "metas" is a "MetaItemPreview response without the videos key of an item").
// F8.7: each item also keeps only the keys the core's structs read (stremio-core src/types/resource/meta_item.rs):
// - `metas` (catalogs): MetaItemPreviewLegacy, the keys of PREVIEW_KEYS. Cinemeta sends cast, director,
//   writer, popularities, slug, ids of other databases... that no struct reads;
// - `meta` (the meta of Details) and `metasDetailed` (catalogs with full metas: the Calendar's and the
//   lastVideosIds catalog of Ctx PullNotifications, ~1.2 MB from Cinemeta for 100 series): MetaItem (the preview
//   keys and `videos`), and in each video the keys of Video, SeriesInfo and VideoEpgInfo.
// Only keys no struct reads go: a key a struct reads stays even where its value is not used (the notifications
// read only ids and dates, but an invalid poster or a video with both title and name makes the core drop the
// whole meta, and the trimmed answer must be dropped the same way).
// Objects whose keys the core keeps as they come (behaviorHints, links, trailers, streams) are not touched,
// the top-level keys of the answer stay (the core checks there is exactly one of metas/metasDetailed/meta...),
// and items that are not objects stay where they were (the core skips them itself). The core ends up with the
// same state: webos/tests/catalog-trim/core-equivalence.test.js runs the vendored core with and without this.
// More permissive, never less: the JSON goes through JSON.parse and JSON.stringify, so a value the core refuses
// in a key it does not read (a number out of range like 1e999, a lone surrogate escape) is gone, and such a
// number in a key it reads becomes null (which the core reads as "none"). A repeated key keeps its last value,
// as the core's serde_json::Value does.
//
// install(scope) wraps scope.fetch in the core worker: the 200/201 answer to a GET of an addon catalog
// (…/catalog/<type>/<id>[/<extra>].json) or meta (…/meta/<type>/<id>.json) with something to take out reaches
// the core trimmed; any other request, status or body (not JSON, nothing to take out) is handed over as it came,
// text untouched. The core only reads the status and the text of the response (stremio-core-web src/env.rs fetch).

const CATALOG_PATH = /\/catalog\/[^/?#]+\/[^/?#]+(?:\/[^?#]*)?\.json(?:[?#]|$)/;
const META_PATH = /\/meta\/[^/?#]+\/[^/?#]+\.json(?:[?#]|$)/;
const READ_STATUSES = [200, 201];

// MetaItemPreviewLegacy (camelCase).
const PREVIEW_KEYS = ['id', 'type', 'name', 'poster', 'background', 'logo', 'description', 'releaseInfo', 'runtime',
    'released', 'posterShape', 'imdbRating', 'genres', 'links', 'trailers', 'trailerStreams', 'behaviorHints'];
// MetaItem: the preview (flattened) and the videos.
const META_KEYS = PREVIEW_KEYS.concat(['videos']);
// Video ("name" is an alias of title), SeriesInfo and VideoEpgInfo (both flattened into the video).
const VIDEO_KEYS = ['id', 'title', 'name', 'released', 'overview', 'thumbnail', 'streams', 'stream', 'trailerStreams',
    'season', 'episode', 'startTime', 'endTime', 'runtime', 'releaseInfo', 'genres', 'cast', 'directors', 'links', 'ratings'];

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Trims in place; returns whether something was taken out.
const pick = (object, keys) => {
    let removed = false;
    Object.keys(object).forEach((key) => {
        if (keys.indexOf(key) === -1) {
            delete object[key];
            removed = true;
        }
    });
    return removed;
};
const trimItems = (items, keys, videoKeys) => {
    let removed = false;
    items.forEach((item) => {
        if (!isPlainObject(item)) return;
        removed = pick(item, keys) || removed;
        if (videoKeys && Array.isArray(item.videos)) {
            item.videos.forEach((video) => {
                if (isPlainObject(video)) removed = pick(video, videoKeys) || removed;
            });
        }
    });
    return removed;
};

// The text with only what the core reads, or null when there is nothing to take out.
export const trimCatalogText = (text) => {
    if (typeof text !== 'string') return null;
    let value;
    try {
        value = JSON.parse(text);
    } catch {
        return null;
    }
    if (!isPlainObject(value)) return null;
    let removed = false;
    if (Array.isArray(value.metas)) {
        removed = trimItems(value.metas, PREVIEW_KEYS, null);
    } else if (Array.isArray(value.metasDetailed)) {
        removed = trimItems(value.metasDetailed, META_KEYS, VIDEO_KEYS);
    } else if (isPlainObject(value.meta)) {
        removed = trimItems([value.meta], META_KEYS, VIDEO_KEYS);
    }
    return removed ? JSON.stringify(value) : null;
};

const requestUrl = (input) => (typeof input === 'string' ? input : input && input.url);

export const isCatalogRequest = (input, init) => {
    const url = requestUrl(input);
    const method = (init && init.method) || (input && typeof input === 'object' && input.method) || 'GET';
    return typeof url === 'string' && String(method).toUpperCase() === 'GET' && (CATALOG_PATH.test(url) || META_PATH.test(url));
};

export const install = (scope) => {
    const inner = scope.fetch;
    const ResponseCtor = scope.Response;
    if (typeof inner !== 'function' || typeof ResponseCtor !== 'function' || scope.__webosCatalogTrimInstalled) return;
    scope.__webosCatalogTrimInstalled = true;
    scope.fetch = function fetch(input, init) {
        const answer = inner.call(scope, input, init);
        if (!isCatalogRequest(input, init)) return answer;
        return answer.then((response) => {
            if (READ_STATUSES.indexOf(response.status) === -1) return response;
            return response.text().then((text) => {
                const trimmed = trimCatalogText(text);
                return new ResponseCtor(trimmed === null ? text : trimmed, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers,
                });
            });
        });
    };
};

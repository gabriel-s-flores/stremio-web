// Catalog responses without the episode lists, for the core worker (F7.2).
//
// Addon catalogs may carry, in each item of `metas`, the full `videos` list of a series: 412 of the
// 522 KB of Cinemeta's top series catalog. The core (0.65) reads the response text, builds the whole
// JSON as a serde_json::Value inside the wasm (every episode included) and then keeps, per item, the
// fields of MetaItemPreview, which has no `videos` (stremio-core src/types/addon/response.rs: "metas"
// is a "MetaItemPreview response without the videos key of an item"). On the C8 profile that
// throwaway work keeps the wasm2js core busy for seconds while the Board waits for its first row.
//
// install(scope) wraps scope.fetch in the core worker: the 200/201 answer to a GET of an addon
// catalog (…/catalog/<type>/<id>[/<extra>].json) whose `metas` has items with `videos` reaches the
// core without that key; everything else in the JSON stays as it was. Any other request, status or
// body (not JSON, no `metas` array, no `videos`) is handed over as it came, text untouched. The core
// only reads the status and the text of the response (stremio-core-web src/env.rs fetch).

const CATALOG_PATH = /\/catalog\/[^/?#]+\/[^/?#]+(?:\/[^?#]*)?\.json(?:[?#]|$)/;
const READ_STATUSES = [200, 201];

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

// The text without the `videos` key of the items of `metas`, or null when there is nothing to take out.
export const trimCatalogText = (text) => {
    if (typeof text !== 'string' || text.indexOf('"videos"') === -1) return null;
    let value;
    try {
        value = JSON.parse(text);
    } catch {
        return null;
    }
    if (!isPlainObject(value) || !Array.isArray(value.metas)) return null;
    let removed = 0;
    value.metas.forEach((item) => {
        if (isPlainObject(item) && has(item, 'videos')) {
            delete item.videos;
            removed += 1;
        }
    });
    return removed ? JSON.stringify(value) : null;
};

export const isCatalogRequest = (input, init) => {
    const url = typeof input === 'string' ? input : input && input.url;
    const method = (init && init.method) || (input && typeof input === 'object' && input.method) || 'GET';
    return typeof url === 'string' && String(method).toUpperCase() === 'GET' && CATALOG_PATH.test(url);
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

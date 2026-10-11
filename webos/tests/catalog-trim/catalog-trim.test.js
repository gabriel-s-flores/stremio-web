// webos/lib/catalog-trim: catalog responses reach the core without the `videos` of their items (F7.2).
import { install, trimCatalogText, isCatalogRequest } from '../../lib/catalog-trim';

const series = (id, extra = {}) => ({
    id,
    type: 'series',
    name: `Series ${id}`,
    poster: `https://images.example/${id}.jpg`,
    description: 'Text "quoted" with é and   inside',
    releaseInfo: 2019,
    links: [{ name: 'Drama', category: 'Genres', url: 'stremio:///discover/x' }],
    behaviorHints: { defaultVideoId: null, hasScheduledVideos: true, custom: { a: 1 } },
    videos: [{ id: `${id}:1:1`, title: 'Pilot', season: 1, episode: 1, released: '2019-01-01T00:00:00.000Z' }],
    ...extra,
});

const without = (item, key) => {
    const copy = { ...item };
    delete copy[key];
    return copy;
};

describe('trimCatalogText', () => {
    test('removes only the videos of the items of metas; everything else stays the same', () => {
        const body = { metas: [series('tt1'), { id: 'tt2', type: 'movie', name: 'Movie' }, series('tt3')], cacheMaxAge: 3600 };
        const trimmed = JSON.parse(trimCatalogText(JSON.stringify(body)));
        expect(trimmed).toEqual({
            metas: [without(series('tt1'), 'videos'), { id: 'tt2', type: 'movie', name: 'Movie' }, without(series('tt3'), 'videos')],
            cacheMaxAge: 3600,
        });
    });

    test('nothing to take out: null (the original text is used as it is)', () => {
        expect(trimCatalogText(JSON.stringify({ metas: [{ id: 'tt2', type: 'movie', name: 'Movie' }] }))).toBeNull();
        expect(trimCatalogText(JSON.stringify({ metas: [{ id: 'tt2', name: 'about "videos"' }] }))).toBeNull();
        expect(trimCatalogText(JSON.stringify({ meta: series('tt1') }))).toBeNull();
        expect(trimCatalogText(JSON.stringify({ metasDetailed: [series('tt1')] }))).toBeNull();
        expect(trimCatalogText(JSON.stringify({ metas: null, videos: [] }))).toBeNull();
        expect(trimCatalogText(JSON.stringify([{ videos: [] }]))).toBeNull();
        expect(trimCatalogText('{"metas": [{"videos": [}')).toBeNull();
        expect(trimCatalogText('')).toBeNull();
    });

    test('keeps items that are not objects and own keys such as __proto__', () => {
        const text = '{"metas":[1,null,"x",[{"videos":1}],{"id":"tt1","__proto__":{"p":1},"videos":[1,2]}]}';
        const trimmed = trimCatalogText(text);
        expect(trimmed).toBe('{"metas":[1,null,"x",[{"videos":1}],{"id":"tt1","__proto__":{"p":1}}]}');
    });
});

describe('isCatalogRequest', () => {
    test('GET of an addon catalog, with or without extra, as a string or a Request-like object', () => {
        expect(isCatalogRequest('https://v3-cinemeta.strem.io/catalog/series/top.json')).toBe(true);
        expect(isCatalogRequest('https://addon.example/x/catalog/movie/top/genre=Drama&skip=50.json')).toBe(true);
        expect(isCatalogRequest('https://addon.example/catalog/movie/top/search=a%2Fb.json?x=1')).toBe(true);
        expect(isCatalogRequest({ url: 'https://a.example/catalog/movie/top.json', method: 'GET' })).toBe(true);
    });

    test('not a catalog GET', () => {
        expect(isCatalogRequest('https://v3-cinemeta.strem.io/meta/series/tt1.json')).toBe(false);
        expect(isCatalogRequest('https://addon.example/stream/movie/tt1.json')).toBe(false);
        expect(isCatalogRequest('https://addon.example/catalog/movie/top.json', { method: 'POST' })).toBe(false);
        expect(isCatalogRequest({ url: 'https://api.strem.io/api/datastoreGet', method: 'POST' })).toBe(false);
        expect(isCatalogRequest('https://addon.example/manifest.json')).toBe(false);
        expect(isCatalogRequest(undefined)).toBe(false);
    });
});

describe('install', () => {
    class FakeResponse {
        constructor(body, init = {}) {
            this.body = body;
            this.status = init.status === undefined ? 200 : init.status;
            this.statusText = init.statusText || '';
            this.headers = init.headers || {};
            this.read = false;
        }

        text() {
            this.read = true;
            return Promise.resolve(this.body);
        }
    }

    const scopeWith = (respond) => {
        const calls = [];
        const scope = {
            Response: FakeResponse,
            fetch(input, init) {
                calls.push([input, init, this]);
                return Promise.resolve(respond(input, init));
            },
        };
        install(scope);
        return { scope, calls };
    };

    const catalog = JSON.stringify({ metas: [series('tt1')] });

    test('a catalog answer reaches the caller without the videos, with the same status and headers', async () => {
        const headers = { 'content-type': 'application/json' };
        const { scope, calls } = scopeWith(() => new FakeResponse(catalog, { status: 200, statusText: 'OK', headers }));
        const response = await scope.fetch('https://v3-cinemeta.strem.io/catalog/series/top.json');
        expect(calls).toHaveLength(1);
        expect(calls[0][2]).toBe(scope);
        expect(response).toBeInstanceOf(FakeResponse);
        expect(response.status).toBe(200);
        expect(response.statusText).toBe('OK');
        expect(response.headers).toBe(headers);
        expect(JSON.parse(await response.text())).toEqual({ metas: [without(series('tt1'), 'videos')] });
    });

    test('a catalog answer with nothing to take out keeps its text byte for byte', async () => {
        const text = '{ "metas" : [ {"id":"tt2","name":"M"} ] }';
        const { scope } = scopeWith(() => new FakeResponse(text));
        const response = await scope.fetch('https://addon.example/catalog/movie/top.json');
        expect(await response.text()).toBe(text);
    });

    test('other requests and other statuses are handed over untouched (body not read)', async () => {
        const original = new FakeResponse(catalog);
        const { scope } = scopeWith(() => original);
        expect(await scope.fetch('https://addon.example/meta/series/tt1.json')).toBe(original);
        expect(await scope.fetch('https://addon.example/catalog/movie/top.json', { method: 'POST' })).toBe(original);
        expect(original.read).toBe(false);
        const notFound = new FakeResponse('{"metas":[{"videos":[]}]}', { status: 404 });
        const second = scopeWith(() => notFound);
        expect(await second.scope.fetch('https://addon.example/catalog/movie/top.json')).toBe(notFound);
        expect(notFound.read).toBe(false);
    });

    test('a failed request fails as it did; installing twice wraps once', async () => {
        const scope = { Response: FakeResponse, fetch: () => Promise.reject(new TypeError('Failed to fetch')) };
        install(scope);
        const wrapped = scope.fetch;
        install(scope);
        expect(scope.fetch).toBe(wrapped);
        await expect(scope.fetch('https://addon.example/catalog/movie/top.json')).rejects.toThrow('Failed to fetch');
    });

    test('without fetch or Response it does nothing', () => {
        const noResponse = { fetch: () => null };
        const fetch = noResponse.fetch;
        install(noResponse);
        expect(noResponse.fetch).toBe(fetch);
        expect(() => install({})).not.toThrow();
    });
});

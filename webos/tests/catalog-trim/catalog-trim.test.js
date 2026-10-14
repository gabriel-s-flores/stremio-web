// webos/lib/catalog-trim: catalog responses reach the core without the `videos` of their items (F7.2), and
// catalog and meta answers with only the keys the core reads (F8.7; core-equivalence.test.js runs the core).
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

    test('keeps items that are not objects; an own __proto__ key is not one the core reads', () => {
        const text = '{"metas":[1,null,"x",[{"videos":1}],{"id":"tt1","__proto__":{"p":1},"videos":[1,2]}]}';
        const trimmed = trimCatalogText(text);
        expect(trimmed).toBe('{"metas":[1,null,"x",[{"videos":1}],{"id":"tt1"}]}');
    });
});

// What Cinemeta sends and no struct of the core reads (F8.7).
const extras = { cast: ['A'], director: ['D'], writer: ['W'], popularities: { trakt: 1 }, popularity: 0.5, slug: 'x', imdb_id: 'tt1', moviedb_id: 2, tvdb_id: 3, year: '2019', country: 'US', genre: ['Drama'], awards: 'x', status: 'Ended' };
const cinemetaVideo = (id) => ({ id, name: 'Pilot', title: 'Pilot', season: 1, episode: 1, number: 1, released: '2019-01-01T00:00:00.000Z', firstAired: '2019-01-01T00:00:00.000Z', tvdb_id: 9, rating: '7', overview: 'O', description: 'O', thumbnail: 'https://t/1.jpg' });

describe('trimCatalogText: only what the core reads (F8.7)', () => {
    const preview = { id: 'tt1', type: 'series', name: 'S', poster: 'p', background: 'b', logo: 'l', description: 'd', releaseInfo: '2019', runtime: '45 min', released: '2019-01-01T00:00:00.000Z', posterShape: 'poster', imdbRating: '7.1', genres: ['Drama'], links: [{ name: 'Drama', category: 'Genres', url: 'stremio:///x', extra: 1 }], trailers: [{ source: 'yt', type: 'Trailer', other: 1 }], trailerStreams: [{ ytId: 'yt', title: 'T', x: 1 }], behaviorHints: { defaultVideoId: null, unknown: { kept: true } } };

    test('catalog items: the keys of MetaItemPreview; links, trailers and behaviorHints untouched', () => {
        const body = { metas: [{ ...preview, ...extras, videos: [cinemetaVideo('tt1:1:1')] }], cacheMaxAge: 60 };
        expect(JSON.parse(trimCatalogText(JSON.stringify(body)))).toEqual({ metas: [preview], cacheMaxAge: 60 });
    });

    test('the meta of Details and other metasDetailed: MetaItem and Video keys', () => {
        const video = cinemetaVideo('tt1:1:1');
        const kept = { id: 'tt1:1:1', name: 'Pilot', title: 'Pilot', season: 1, episode: 1, released: video.released, overview: 'O', thumbnail: 'https://t/1.jpg' };
        const epg = { id: 'tv:1', startTime: 's', endTime: 'e', runtime: '1h', releaseInfo: 'r', genres: ['g'], cast: ['c'], directors: ['d'], links: [], ratings: [{ value: '1' }], streams: [{ url: 'u' }], stream: { url: 'u' }, trailerStreams: [], extra: 1 };
        const meta = { ...preview, ...extras, videos: [video, epg, 7] };
        const expected = { ...preview, videos: [kept, { ...epg, extra: undefined }, 7] };
        delete expected.videos[1].extra;
        expect(JSON.parse(trimCatalogText(JSON.stringify({ meta })))).toEqual({ meta: expected });
        expect(JSON.parse(trimCatalogText(JSON.stringify({ metasDetailed: [meta] })))).toEqual({ metasDetailed: [expected] });
    });

    test('the lastVideosIds catalog (notifications): the same keys as any other metasDetailed, invalid values included', () => {
        // An invalid poster, an empty link url and a video with both title and name make the core drop the meta:
        // the trimmed answer keeps them, so the core drops it the same way.
        const bad = { ...preview, ...extras, poster: '/relative.jpg', links: [{ name: 'x', category: 'Genres', url: '' }], videos: [cinemetaVideo('tt1:1:1'), 'x'] };
        const trimmed = JSON.parse(trimCatalogText(JSON.stringify({ metasDetailed: [bad, null] })));
        const expected = { ...preview, poster: '/relative.jpg', links: bad.links, videos: [{ id: 'tt1:1:1', name: 'Pilot', title: 'Pilot', season: 1, episode: 1, released: '2019-01-01T00:00:00.000Z', overview: 'O', thumbnail: 'https://t/1.jpg' }, 'x'] };
        expect(trimmed).toEqual({ metasDetailed: [expected, null] });
    });

    test('the top level stays: two kinds of items still reach the core as two (it refuses that answer)', () => {
        const body = { metas: [{ ...preview, ...extras }], meta: { ...preview, ...extras }, cacheMaxAge: 1 };
        const trimmed = JSON.parse(trimCatalogText(JSON.stringify(body)));
        expect(Object.keys(trimmed)).toEqual(['metas', 'meta', 'cacheMaxAge']);
        expect(trimmed.metas).toEqual([preview]);
    });
});

describe('isCatalogRequest', () => {
    test('GET of an addon catalog, with or without extra, as a string or a Request-like object', () => {
        expect(isCatalogRequest('https://v3-cinemeta.strem.io/catalog/series/top.json')).toBe(true);
        expect(isCatalogRequest('https://addon.example/x/catalog/movie/top/genre=Drama&skip=50.json')).toBe(true);
        expect(isCatalogRequest('https://addon.example/catalog/movie/top/search=a%2Fb.json?x=1')).toBe(true);
        expect(isCatalogRequest({ url: 'https://a.example/catalog/movie/top.json', method: 'GET' })).toBe(true);
    });

    test('a meta GET too (F8.7)', () => {
        expect(isCatalogRequest('https://v3-cinemeta.strem.io/meta/series/tt1.json')).toBe(true);
        expect(isCatalogRequest({ url: 'https://a.example/x/meta/movie/tt1.json?y=1' })).toBe(true);
    });

    test('not a catalog or meta GET', () => {
        expect(isCatalogRequest('https://v3-cinemeta.strem.io/meta/series/tt1.json', { method: 'POST' })).toBe(false);
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
        expect(await scope.fetch('https://addon.example/stream/series/tt1.json')).toBe(original);
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

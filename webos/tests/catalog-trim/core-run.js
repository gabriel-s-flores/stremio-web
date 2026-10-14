#!/usr/bin/env node
// The vendored core in Node with Cinemeta-like answers, with or without webos/lib/catalog-trim in front of
// fetch (F8.7): prints, as JSON, the states the page reads after each step. core-equivalence.test.js runs it
// both ways and compares.
//
//   node webos/tests/catalog-trim/core-run.js [--trim] [--variant wasm|wasm2js]
//
// Steps: the notifications pull (the lastVideosIds catalog of the library's series), the Board (catalogs of
// every addon), Discover, the Calendar (the calendarVideosIds catalog), Details of a series episode and of a
// movie (meta and streams). The answers carry what Cinemeta sends and the core does not read (cast, director,
// writer, popularities, ids of other databases, slug, trailers, episodes with number/firstAired/tvdb_id/
// rating/description), with and without `links` (without them the core builds the IMDb and genre links from
// imdbRating and genres), every key the structs read (posterShape, episodes with title or name, stream(s),
// trailerStreams and the EPG keys), values the core refuses (a relative poster, a link with an empty url, an
// episode with both title and name: the core drops that meta) and repeated keys (the last value counts).
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const TRIM = args.includes('--trim');
const VARIANT = args.includes('--variant') ? args[args.indexOf('--variant') + 1] : 'wasm';
const VENDOR = path.join(__dirname, '..', '..', 'vendor', 'stremio-core-web');
const BASE = 'file:///app/';
const DAY = 86400000;
// Fixed (the two runs must build the same answers), in the past (notifications are of released episodes).
const NOW = Date.UTC(2026, 8, 1);

const iso = (ms) => new Date(ms).toISOString();
const series = (n) => `tt${7000000 + n}`;
const movie = (n) => `tt${8000000 + n}`;

const video = (id, season, episode, released) => {
    const k = season * 10 + episode;
    const v = {
        name: `Episode ${episode}`,
        season,
        number: episode,
        firstAired: iso(released),
        tvdb_id: 900000 + season * 100 + episode,
        rating: '7.4',
        overview: `What happens in ${season}x${episode}.`,
        thumbnail: `https://episodes.metahub.space/${id}/${season}/${episode}/w780.jpg`,
        id: `${id}:${season}:${episode}`,
        released: iso(released),
        episode,
        description: `What happens in ${season}x${episode}.`,
    };
    if (k % 4 === 0) {
        delete v.name;
        v.title = `Titled ${episode}`;
    }
    if (k % 5 === 1) v.streams = [{ url: `https://example.com/${id}/${k}.mp4`, name: 'S' }];
    if (k % 5 === 2) v.stream = { ytId: `yt${k}` };
    if (k % 5 === 3) v.trailerStreams = [{ ytId: `tr${k}`, title: 'Trailer' }];
    if (k % 6 === 4) {
        Object.assign(v, {
            startTime: iso(released), endTime: iso(released + 3600000), runtime: '1h', releaseInfo: '2026',
            genres: ['News'], cast: ['Anchor'], directors: ['Director'],
            links: [{ name: 'Channel', category: 'Genres', url: 'https://example.com/channel' }],
            ratings: [{ value: 'TV-14', system: 'US' }],
        });
    }
    return v;
};
const item = (id, type, n, full) => {
    const base = {
        imdb_id: id,
        name: `${type === 'series' ? 'Show' : 'Film'} ${n} & "friends"`,
        popularities: { moviedb: 12.5 + n, trakt: 3, stremio: 0.4 },
        type,
        cast: ['Actor One', 'Actor Two'],
        country: 'United States',
        description: `About ${id}: é, ü, <b>tags</b> & entities &amp; more.`,
        genre: ['Drama', 'Comedy'],
        imdbRating: n % 3 === 0 ? 7.1 : '6.4',
        released: iso(NOW - (400 + n) * DAY),
        slug: `${type}/${id}`,
        writer: ['Writer'],
        year: n % 2 ? '2019–' : 2021,
        runtime: n % 2 ? '45 min' : 112,
        status: 'Continuing',
        tvdb_id: 300000 + n,
        moviedb_id: 400000 + n,
        poster: `https://images.metahub.space/poster/medium/${id}/img`,
        trailers: [{ source: `yt${n}`, type: 'Trailer' }, { source: `cl${n}`, type: 'Clip' }],
        director: ['Director'],
        popularity: 0.1 * n,
        logo: `https://images.metahub.space/logo/medium/${id}/img`,
        background: `https://images.metahub.space/background/medium/${id}/img`,
        id,
        genres: ['Drama', 'Comedy'],
        releaseInfo: n % 2 ? '2019–' : '2021',
        trailerStreams: n % 4 === 0 ? undefined : [{ title: `Trailer ${n}`, ytId: `yt${n}` }],
        behaviorHints: { defaultVideoId: type === 'movie' ? id : null, hasScheduledVideos: n % 2 === 0, custom: { kept: n } },
        __proto__x: 1,
        awards: 'Some awards',
        dvdRelease: null,
    };
    if (n % 3 === 1) base.posterShape = 'landscape';
    if (n % 3 === 2) base.posterShape = 'square';
    // Values the core refuses: it drops the whole meta (with or without the trim).
    if (n % 7 === 3) base.poster = '/relative.jpg';
    if (n % 7 === 5) base.links = [{ name: 'x', category: 'Genres', url: '' }];
    if (n % 2 === 0 && n % 7 !== 5) {
        base.links = [
            { name: '7.1', category: 'imdb', url: `https://imdb.com/title/${id}` },
            { name: 'Drama', category: 'Genres', url: 'stremio:///discover/https%3A%2F%2Fv3-cinemeta.strem.io%2Fmanifest.json/movie/top?genre=Drama' },
        ];
    }
    if (full && type === 'series') {
        base.videos = [];
        for (let s = 0; s <= 2; s++) {
            for (let e = 1; e <= 6; e++) base.videos.push(video(id, s, e, NOW - (300 - s * 100 - e * 7) * DAY));
        }
        if (n % 7 === 6) base.videos[1].title = 'Both title and name';
    }
    return JSON.parse(JSON.stringify(base));
};

// The library: 12 series (pull notifications: watched before the last episodes) and 6 movies.
const libraryItems = [];
for (let n = 0; n < 12; n++) {
    const id = series(n);
    libraryItems.push({
        _id: id,
        name: `Show ${n}`,
        type: 'series',
        poster: `https://images.metahub.space/poster/small/${id}/img`,
        posterShape: 'poster',
        removed: false,
        temp: false,
        _ctime: iso(NOW - 500 * DAY),
        _mtime: iso(NOW - n * DAY),
        state: { lastWatched: iso(NOW - 250 * DAY), timeWatched: 0, timeOffset: 0, overallTimeWatched: 0, timesWatched: 1, flaggedWatched: 0, duration: 0, video_id: `${id}:1:1`, watched: null, noNotif: false },
        behaviorHints: { defaultVideoId: null, featuredVideoId: null, hasScheduledVideos: false },
    });
}
for (let n = 0; n < 6; n++) {
    const id = movie(n);
    libraryItems.push({
        _id: id,
        name: `Film ${n}`,
        type: 'movie',
        poster: null,
        posterShape: 'poster',
        removed: false,
        temp: false,
        _ctime: iso(NOW - 500 * DAY),
        _mtime: iso(NOW - (20 + n) * DAY),
        state: { lastWatched: iso(NOW - 3 * DAY), timeWatched: 1000, timeOffset: 600000, overallTimeWatched: 1000, timesWatched: 0, flaggedWatched: 0, duration: 7200000, video_id: id, watched: null, noNotif: false },
        behaviorHints: { defaultVideoId: id, featuredVideoId: null, hasScheduledVideos: false },
    });
}
const storage = {
    schema_version: '25',
    library_recent: JSON.stringify({ uid: null, items: Object.fromEntries(libraryItems.map((i) => [i._id, i])) }),
};
if (VARIANT === 'wasm') storage['webos.coreVariant'] = 'wasm';

// A repeated key in the text (an object can not have one): the first `"id":"<id>"` gets a `"name"` before it.
const repeated = (text, id) => text.replace(`"id":"${id}"`, `"name":"Repeated, the later one counts","id":"${id}"`);
const json = (body, status = 200, id = null) => {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(id ? repeated(text, id) : text, { status, headers: { 'content-type': 'application/json' } });
};
const answer = (url) => {
    const u = decodeURIComponent(url);
    const last = /\/catalog\/series\/last-videos\/lastVideosIds=([^/]+)\.json$/.exec(u);
    if (last) return json({ metasDetailed: last[1].split(',').filter((id, i) => i % 5 !== 4).map((id) => item(id, 'series', Number(id.slice(2)) % 100, true)) }, 200, series(1));
    const calendar = /\/catalog\/series\/calendar-videos\/calendarVideosIds=([^/]+)\.json$/.exec(u);
    if (calendar) return json({ metasDetailed: calendar[1].split(',').map((id) => item(id, id.startsWith('tt7') ? 'series' : 'movie', Number(id.slice(2)) % 100, true)) }, 200, series(4));
    const catalog = /v3-cinemeta\.strem\.io\/catalog\/(movie|series)\/([^/.]+)/.exec(u);
    if (catalog) {
        const type = catalog[1];
        const metas = Array.from({ length: 30 }, (_, n) => item(type === 'movie' ? movie(n) : series(n), type, n, type === 'series'));
        // Items the core skips (not objects, no id) stay where they are.
        metas.splice(3, 0, 42, null, { name: 'no id' });
        return json({ metas, cacheMaxAge: 3600 }, 200, type === 'movie' ? movie(7) : series(8));
    }
    const meta = /v3-cinemeta\.strem\.io\/meta\/(movie|series)\/(tt\d+)\.json$/.exec(u);
    if (meta) return json({ meta: item(meta[2], meta[1], Number(meta[2].slice(2)) % 100, true) });
    if (/\/stream\//.test(u)) {
        const text = JSON.stringify({ streams: [{ name: 'S', title: 'stream 1', url: 'https://example.com/a.mp4', behaviorHints: { bingeGroup: 'g', filename: 'a.mp4' } }, { ytId: 'abc', name: 'Y' }] });
        return json(text.replace('"bingeGroup":"g"', '"bingeGroup":"first","bingeGroup":"g"'));
    }
    return json({ err: 'not found' }, 404);
};

class XMLHttpRequest {
    open(_method, url) {
        this.url = url;
    }

    send() {
        setTimeout(() => {
            const bytes = fs.readFileSync(path.join(VENDOR, this.url.slice(BASE.length)));
            this.status = 0;
            this.response = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            this.onload();
        }, 0);
    }
}
global.self = global;
global.WorkerGlobalScope = Object;
global.location = { href: `${BASE}worker.js` };
global.document = { baseURI: `${BASE}worker.js` };
global.XMLHttpRequest = XMLHttpRequest;
global.importScripts = (url) => new Function('module', fs.readFileSync(path.join(VENDOR, url.slice(BASE.length))).toString('utf8'))(undefined);
global.fetch = async (request) => {
    const url = typeof request === 'string' ? request : request.url;
    if (process.env.CORE_RUN_TRACE) process.stderr.write(`fetch ${url.slice(0, 120)}\n`);
    if (url.startsWith('http://127.0.0.1')) throw new TypeError('Failed to fetch');
    return answer(url);
};
global.app_version = 'core-run';
global.shell_version = null;
global.get_location_hash = async () => '#/';
global.local_storage_get_item = async (key) => (key in storage ? storage[key] : null);
global.local_storage_set_item = async (key, value) => {
    storage[key] = value;
};
global.local_storage_remove_item = async (key) => {
    delete storage[key];
};
console.log = () => {};
console.info = () => {};
console.warn = () => {};
console.error = () => {};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
    if (TRIM) require('../../lib/catalog-trim/index.js').install(global);
    const loader = require('../../core/loader');
    const glue = require(path.join(VENDOR, 'stremio_core_web.js'));
    await glue.default(loader.loadConfigured());
    await glue.initialize_runtime(() => {});
    const out = {};
    const settle = () => sleep(300);
    const read = (step, models) => {
        out[step] = Object.fromEntries(models.map((m) => [m, glue.get_state(m)]));
    };

    glue.dispatch({ action: 'Ctx', args: { action: 'PullNotifications' } }, null, '#/');
    await settle();
    const ctx = glue.get_state('ctx');
    // The notifications of a series are a HashMap in the core, serialized in its (per process) random order.
    const items = Object.fromEntries(Object.entries(ctx.notifications.items).map(([id, list]) => [id, [...list].sort((a, b) => (a.videoId < b.videoId ? -1 : 1))]));
    out.notifications = { items, lastUpdated: typeof ctx.notifications.lastUpdated, cw: glue.get_state('continue_watching_preview') };

    glue.dispatch({ action: 'Load', args: { model: 'CatalogsWithExtra', args: { extra: [] } } }, 'board', '#/');
    glue.dispatch({ action: 'CatalogsWithExtra', args: { action: 'LoadRange', args: { start: 0, end: 10 } } }, 'board', '#/');
    await settle();
    read('board', ['board']);

    const open = (type, id, videoId) => glue.dispatch({
        action: 'Load',
        args: {
            model: 'MetaDetails',
            args: {
                metaPath: { resource: 'meta', type, id, extra: [] },
                streamPath: { resource: 'stream', type, id: videoId, extra: [] },
                guessStream: true,
            },
        },
    }, 'meta_details', `#/detail/${type}/${id}/${videoId}`);
    glue.dispatch({ action: 'Load', args: { model: 'CatalogWithFilters', args: null } }, 'discover', '#/discover');
    await settle();
    read('discover', ['discover']);

    glue.dispatch({ action: 'Load', args: { model: 'Calendar', args: { year: 2026, month: 6 } } }, 'calendar', '#/calendar');
    await settle();
    read('calendar', ['calendar']);

    open('series', series(2), `${series(2)}:1:3`);
    await settle();
    read('series', ['meta_details']);
    open('movie', movie(4), movie(4));
    await settle();
    read('movie', ['meta_details']);
    // Exit once the pipe took it all (an exit right after the write cuts a long answer).
    process.stdout.write(JSON.stringify(out), () => process.exit(0));
})().catch((error) => {
    process.stderr.write(`${error && error.stack ? error.stack : JSON.stringify(error)}\n`);
    process.exit(1);
});

// Content of the fixture addon of the visual regression (F2.7): catalogs, metas, streams and images
// that never change, so a capture only differs from the reference when the app does. Every answer is
// derived from the ids, with no clock, no random numbers and no network (the images are SVGs made here).
// CommonJS, no dependencies: the server (server.mjs) and the tests use it.
'use strict';

const ID = 'org.stremio.webos.visual-fixture';
const GENRES = ['Action', 'Comedy', 'Drama', 'Sci-Fi', 'Thriller'];
const PAGE_SIZE = 50;
// Ids of the catalogs: tt01xxxxx movies, tt11xxxxx series. Any other "tt…" id (the scenes open tt0068646 and
// tt0903747) gets a title and a cover from its hash.
const MOVIE_TITLES = [
    'The Last Lighthouse', 'Midnight in Lisbon', 'Paper Cranes', 'Orbit of Ash', 'A Quiet Revolution', 'Salt and Thunder',
    'The Glass Orchard', 'Harbor Lights', 'Neon Meridian', 'Wolves of Winter', 'The Cartographer', 'Silver Tide',
    'Letters from Mars', 'The Long Detour', 'Echoes of Amber', 'Copper Sky', 'Under the Tin Roof', 'The Velvet Hour',
    'Iron Lullaby', 'Seven Doors West', 'The Borrowed Summer', 'Static Bloom', 'Night Train to Oslo', 'The Weight of Snow',
];
const SERIES_TITLES = [
    'Northern Signal', 'The Brass Detectives', 'Cold Harbor', 'Lanterns', 'Backwater Kings', 'The Understudies',
    'Glasshouse', 'Red Meridian', 'Small Hours', 'The Archivists', 'Tidewater', 'Ghost Orchard',
    'Paper Kingdoms', 'The Night Shift', 'Saltmarsh', 'Hollow Crown', 'Quiet Streets', 'The Ferrymen',
    'Ember Valley', 'Wire and Wool', 'The Long Tide', 'Dust Choir', 'Foxglove', 'The Last Broadcast',
];
const DESCRIPTION = 'A fixture story with just enough text to fill the description area of the details page on two or three '
    + 'lines, written once so the screens never change from one capture to the next.';

const hash = (text) => {
    let value = 2166136261;
    for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619) >>> 0;
    return value;
};
const pick = (list, key) => list[hash(key) % list.length];
const hue = (key) => hash(`hue:${key}`) % 360;
const pad = (n, size) => String(n).padStart(size, '0');

// 24 movies tt0100001…tt0100024 and 24 series tt1100001…tt1100024.
const catalogIds = (type) => Array.from({ length: 24 }, (_, i) => (type === 'series' ? `tt11${pad(i + 1, 5)}` : `tt01${pad(i + 1, 5)}`));
const titleOf = (id, type) => {
    const list = type === 'series' ? SERIES_TITLES : MOVIE_TITLES;
    const match = /^tt(?:01|11)(\d{5})$/.exec(id);
    return match && Number(match[1]) >= 1 && Number(match[1]) <= list.length ? list[Number(match[1]) - 1] : pick(list, id);
};

// Images: SVG gradients with a few shapes, from the id. Chromium 53 draws SVG in <img>.
const svg = (width, height, key, extra = '') => {
    const h = hue(key);
    const shift = 40 + (hash(`s:${key}`) % 60);
    const cx = hash(`x:${key}`) % width;
    const cy = hash(`y:${key}`) % height;
    const radius = Math.round(Math.min(width, height) * (0.25 + (hash(`r:${key}`) % 30) / 100));
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
        + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},55%,34%)"/>`
        + `<stop offset="1" stop-color="hsl(${(h + shift) % 360},60%,16%)"/></linearGradient></defs>`
        + `<rect width="${width}" height="${height}" fill="url(#g)"/>`
        + `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="hsl(${(h + 180) % 360},50%,60%)" fill-opacity="0.22"/>`
        + `<rect x="${Math.round(width * 0.12)}" y="${Math.round(height * 0.62)}" width="${Math.round(width * 0.76)}" height="${Math.round(height * 0.06)}" fill="#fff" fill-opacity="0.18"/>`
        + `${extra}</svg>`;
};
const IMAGE_SIZES = { poster: [300, 450], background: [1280, 720], thumb: [320, 180] };
const image = (kind, key) => svg(IMAGE_SIZES[kind][0], IMAGE_SIZES[kind][1], `${kind}:${key}`);

// base: how the client reaches the server (http://10.0.2.2:<port> from the emulator).
const imageUrl = (base, kind, key) => `${base}/image/${kind}/${encodeURIComponent(key)}.svg`;

const itemOf = (base, id, type) => ({
    id,
    type,
    name: titleOf(id, type),
    poster: imageUrl(base, 'poster', id),
    posterShape: 'poster',
    background: imageUrl(base, 'background', id),
    releaseInfo: String(2000 + (hash(id) % 25)),
    imdbRating: (5 + (hash(`rating:${id}`) % 40) / 10).toFixed(1),
    genres: [GENRES[hash(id) % GENRES.length], GENRES[(hash(id) + 2) % GENRES.length]],
});

const manifest = (base) => ({
    id: ID,
    version: '1.0.0',
    name: 'Visual Fixture',
    description: 'Fixed catalogs, details and streams for the visual regression of the webOS port (F2.7).',
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    resources: ['catalog', 'meta', 'stream'],
    catalogs: ['movie', 'series'].map((type) => ({
        type,
        id: 'top',
        name: 'Popular',
        genres: GENRES,
        extra: [{ name: 'genre', options: GENRES }, { name: 'search' }, { name: 'skip' }],
        extraSupported: ['genre', 'search', 'skip'],
    })),
    logo: imageUrl(base, 'poster', 'logo'),
});

const parseExtra = (text) => {
    const extra = {};
    if (!text) return extra;
    text.split('&').forEach((pair) => {
        const index = pair.indexOf('=');
        if (index > 0) extra[decodeURIComponent(pair.slice(0, index))] = decodeURIComponent(pair.slice(index + 1));
    });
    return extra;
};

// catalog/<type>/<id>[/<extra>].json. A search answers the same twelve items whatever the query is.
const catalog = (base, type, id, extra) => {
    const ids = catalogIds(type);
    let metas;
    if (id !== 'top') metas = [];
    else if (extra.search !== undefined) metas = ids.slice(0, 12).map((itemId) => itemOf(base, itemId, type));
    else {
        metas = ids.map((itemId) => itemOf(base, itemId, type));
        if (extra.genre) metas = metas.filter((item) => item.genres.indexOf(extra.genre) !== -1);
        const skip = Number(extra.skip) || 0;
        metas = metas.slice(skip, skip + PAGE_SIZE);
    }
    return { metas };
};

const episodes = (base, id, seasons = 3, perSeason = 6) => {
    const videos = [];
    for (let season = 1; season <= seasons; season++) {
        for (let episode = 1; episode <= perSeason; episode++) {
            const day = (season - 1) * 120 + (episode - 1) * 7;
            videos.push({
                id: `${id}:${season}:${episode}`,
                title: `Episode ${season}x${episode}`,
                season,
                episode,
                released: new Date(Date.UTC(2020, 0, 1) + day * 86400000).toISOString(),
                thumbnail: imageUrl(base, 'thumb', `${id}:${season}:${episode}`),
                overview: DESCRIPTION,
            });
        }
    }
    return videos;
};

// The cast and crew, as Cinemeta sends them: one name escaped ("Josh O&apos;Connor" in tt15047880, F8.3).
const CAST = ['Ana Moreira', 'Sean O&apos;Neill', 'Mei Tanaka'];
const DIRECTOR = 'Lena Voss';

// The links of the details column as Cinemeta has them (F8.3): IMDb rating, three genres (Discover of
// this addon), the cast (Search), a writer (not shown) and the director. Before F8.3 the fixture had none,
// and the regression never saw the column with them (on the TV it cut the directors in half).
const links = (base, type, id) => {
    const manifestUrl = encodeURIComponent(`${base}/manifest.json`);
    const search = (name) => `stremio:///search?search=${encodeURIComponent(name)}`;
    const genres = [0, 2, 4].map((offset) => GENRES[(hash(id) + offset) % GENRES.length]);
    return [{ name: itemOf(base, id, type).imdbRating, category: 'imdb', url: `https://imdb.com/title/${id}` }]
        .concat(genres.map((genre) => ({ name: genre, category: 'Genres', url: `stremio:///discover/${manifestUrl}/${type}/top?genre=${encodeURIComponent(genre)}` })))
        .concat(CAST.map((name) => ({ name, category: 'Cast', url: search(name) })))
        .concat([{ name: DIRECTOR, category: 'Writers', url: search(DIRECTOR) }, { name: DIRECTOR, category: 'Directors', url: search(DIRECTOR) }]);
};

const meta = (base, type, id) => {
    const item = itemOf(base, id, type);
    const result = Object.assign({}, item, {
        description: DESCRIPTION,
        runtime: type === 'series' ? '45 min' : `${100 + (hash(id) % 50)} min`,
        year: item.releaseInfo,
        released: `${item.releaseInfo}-01-01T00:00:00.000Z`,
        cast: CAST,
        director: [DIRECTOR],
        country: 'Portugal',
        links: links(base, type, id),
    });
    if (type === 'series') result.videos = episodes(base, id);
    return { meta: result };
};

// Names and descriptions like the ones of a debrid addon (Torrentio: file name, seeders, size, source and
// the audio languages as flags, F8.3); the URLs answer 404 (the Player scene of the error screen opens
// "/status/404/…" itself). Nothing here is ever played.
const streams = (base) => ({
    streams: [
        { name: '[RD+] Fixture\n4k DV | HDR', description: 'Fixture.Movie.2026.2160p.WEB-DL.DV.HDR.DDP5.1.Atmos-FIXTURE.mkv\n👤 30 💾 37.41 GB ⚙️ FixtureTracker\nMulti Audio / 🇬🇧 / 🇷🇺 / 🇧🇷', url: `${base}/status/404/fixture-2160p.mkv` },
        { name: '[RD+] Fixture\n1080p', description: 'Fixture.Movie.2026.1080p.BluRay.x264.DTS-FIXTURE.mkv\n👤 1283 💾 12.8 GB ⚙️ FixtureTracker', url: `${base}/status/404/fixture-1080p.mkv` },
        { name: '[RD+] Fixture\n720p', description: 'Fixture.Movie.720p.WEB.h264.AAC.mp4\n👤 6 💾 1.9 GB ⚙️ FixtureTracker', url: `${base}/status/404/fixture-720p.mp4` },
        { name: '[RD download] Fixture\n1080p', description: 'Fixture.Movie.1080p.REMUX.mkv\n👤 3 💾 25.5 GB ⚙️ FixtureTracker\n🇬🇧 / 🇵🇹', url: `${base}/status/404/fixture-remux.mkv` },
        { name: '[RD+] Fixture\n4k HDR', description: 'Fixture.Movie.2026.2160p.UHD.BluRay.REMUX.HDR10.HEVC.TrueHD.7.1.Atmos-FIXTURE.mkv\n👤 12 💾 58.4 GB ⚙️ FixtureTracker', url: `${base}/status/404/fixture-remux-4k.mkv` },
        { name: '[RD+] Fixture\n4k', description: 'Fixture.Movie.2026.2160p.WEB-DL.HEVC-FIXTURE.mkv\n👤 42 💾 15.0 GB ⚙️ FixtureTracker', url: `${base}/status/404/fixture-web-4k.mkv` },
    ],
});

// Answer for a path of the addon: { type, body } or null.
const route = (base, pathname) => {
    let match;
    if (pathname === '/manifest.json') return { type: 'json', body: manifest(base) };
    if ((match = /^\/catalog\/(movie|series)\/([^/]+?)(?:\/(.*))?\.json$/.exec(pathname))) {
        return { type: 'json', body: catalog(base, match[1], decodeURIComponent(match[2]), parseExtra(match[3])) };
    }
    if ((match = /^\/meta\/(movie|series)\/([^/]+)\.json$/.exec(pathname))) {
        const id = decodeURIComponent(match[2]);
        return { type: 'json', body: meta(base, match[1], id) };
    }
    if ((match = /^\/stream\/(movie|series)\/([^/]+)\.json$/.exec(pathname))) return { type: 'json', body: streams(base) };
    if ((match = /^\/image\/(poster|background|thumb)\/(.+)\.svg$/.exec(pathname))) {
        return { type: 'svg', body: image(match[1], decodeURIComponent(match[2])) };
    }
    return null;
};

module.exports = { ID, GENRES, PAGE_SIZE, MOVIE_TITLES, SERIES_TITLES, catalogIds, titleOf, itemOf, manifest, catalog, meta, streams, route, hash };

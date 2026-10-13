// A large guest library in the core's storage format (F8.6): the TV that opened Details slowly had
// `library` with 198 KB and `library_recent` with 118 KB in localStorage. The core keeps the 200 most
// recently modified items in `library_recent` (LIBRARY_RECENT_COUNT) and the rest in `library`, both as
// a LibraryBucket ({ uid, items: { [id]: LibraryItem } }, uid null for a guest).
//
// libraryFixture({ items, now }) -> { library, library_recent } (JSON strings, ready for localStorage).
// About 40 % series (with a watched bitfield, the biggest field), the rest movies; some removed, some
// in progress (Continue Watching). Deterministic for the same arguments.

const zlib = require('zlib');

const RECENT = 200;
const DAY = 86400000;

// The watched bitfield as the core stores it: base64 of the zlib of the bits, one per episode.
const bitfield = (index) => zlib.deflateSync(Buffer.from(Array.from({ length: 8 + (index % 40) }, (_, i) => (i * 37 + index) & 0xff))).toString('base64');

const libraryItem = (index, now) => {
    const id = `tt${String(9100000 + index * 7)}`;
    const series = index % 5 < 2;
    const mtime = new Date(now - index * DAY / 3).toISOString();
    const progress = index % 4 === 0;
    const duration = series ? 2700000 : 7200000;
    const state = {
        lastWatched: mtime,
        timeWatched: progress ? 1800000 : 0,
        timeOffset: progress ? 1500000 + (index % 7) * 60000 : 0,
        overallTimeWatched: (index % 9) * 3600000,
        timesWatched: index % 3,
        flaggedWatched: index % 11 === 0 ? 1 : 0,
        duration,
        video_id: series ? `${id}:${1 + (index % 4)}:${1 + (index % 10)}` : id,
        // A series' watched episodes: "<last video>:<count>:<base64 of the zlib bitfield>".
        watched: series ? `${id}:${1 + (index % 4)}:${1 + (index % 10)}:${40 + (index % 30)}:${bitfield(index)}` : null,
        noNotif: false,
    };
    return {
        _id: id,
        name: `${series ? 'Série' : 'Filme'} de teste ${index} — ${['The Long Night', 'Ocean Drive', 'Northern Lights', 'A Quiet Place to Stay'][index % 4]}`,
        type: series ? 'series' : 'movie',
        poster: `https://images.metahub.space/poster/small/${id}/img`,
        posterShape: 'poster',
        removed: index % 13 === 0,
        temp: false,
        _ctime: new Date(now - (index + 400) * DAY).toISOString(),
        _mtime: mtime,
        state,
        behaviorHints: { defaultVideoId: series ? null : id, featuredVideoId: null, hasScheduledVideos: false },
    };
};

const libraryFixture = ({ items = 520, now = Date.UTC(2026, 9, 12) } = {}) => {
    const all = Array.from({ length: items }, (_, index) => libraryItem(index, now));
    // Most recent first: the first RECENT go to library_recent, like the core does.
    const bucket = (list) => JSON.stringify({ uid: null, items: Object.fromEntries(list.map((item) => [item._id, item])) });
    return { library: bucket(all.slice(RECENT)), library_recent: bucket(all.slice(0, RECENT)) };
};

module.exports = { libraryFixture };

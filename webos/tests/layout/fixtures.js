// Fixed data of the layout page. Posters and thumbnails are inline SVG: no network.

const svg = (width, height, hue, label) => {
    const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
        `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},60%,45%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360},60%,25%)"/></linearGradient></defs>` +
        `<rect width="100%" height="100%" fill="url(#g)"/>` +
        `<text x="50%" y="52%" fill="#fff" font-family="sans-serif" font-size="${Math.round(width / 5)}" text-anchor="middle">${label}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(markup)}`;
};

// Calendar: `days` days from weekday `first` (0 = Monday), `today` highlighted; a few days with
// 1 to 5 releases (the cells scroll sideways when they do not fit).
const calendar = ({ first = 3, days = 31, today = 12 } = {}) => {
    const items = Array.from({ length: days }, (_, index) => {
        const day = index + 1;
        const count = day % 7 === 3 ? 5 : day % 4 === 0 ? 2 : day % 5 === 0 ? 1 : 0;
        return {
            date: { year: 2026, month: 10, day },
            items: Array.from({ length: count }, (__, item) => ({
                id: `tt${day}${item}`,
                name: `Title ${day}.${item}`,
                title: `Title ${day}.${item}`,
                poster: svg(200, 300, (day * 37 + item * 71) % 360, `${day}.${item}`),
                deepLinks: { metaDetailsStreams: `#/detail/series/tt${day}${item}` },
            })),
        };
    });
    return { items, monthInfo: { today, days, firstWeekday: first }, selected: { year: 2026, month: 10, day: 8 } };
};

const HOUR = 3600 * 1000;

// Live TV: a channel with a day of programs around `now`, two sources.
const liveTv = (now = Date.now()) => {
    const titles = [
        'Morning news', 'Documentary: the deep sea', 'Cooking with friends', 'Football: the league', 'Evening news',
        'The long film that has a title long enough to wrap onto a second line in the schedule', 'Late talk show', 'Weather', 'Music videos', 'Night film',
    ];
    const start = Math.floor(now / HOUR) * HOUR - 3 * HOUR;
    const videos = titles.map((title, index) => ({
        id: `program-${index}`,
        title,
        overview: index === 3 ? 'Round 12 of the league, live from the stadium, with the pre-match and the post-match analysis. '.repeat(3) : `About ${title.toLowerCase()}.`,
        thumbnail: svg(320, 180, index * 40, `${index + 1}`),
        startTime: new Date(start + index * HOUR).toISOString(),
        endTime: new Date(start + (index + 1) * HOUR).toISOString(),
        genres: ['News', 'Sport'],
        links: [],
        ratings: [],
        deepLinks: {},
    }));
    const meta = {
        id: 'tv-channel-1',
        type: 'tv',
        name: 'Channel One HD',
        logo: svg(200, 200, 260, 'TV1'),
        poster: null,
        background: null,
        description: 'The first channel.',
        inLibrary: false,
        deepLinks: {},
        videos,
    };
    const stream = (name, description) => ({ name, description, deepLinks: { player: '#/player/fake' } });
    const streams = [{
        addon: { manifest: { name: 'Live addon' } },
        content: {
            type: 'Ready',
            content: [
                stream('Channel One 1080p', 'Primary feed, 1080p50, AAC stereo.\nFrom the provider.'),
                stream('Channel One 720p', 'Backup feed, 720p.'),
                stream('Channel One SD', ''),
            ],
        },
    }];
    return { meta, streams, addonName: 'Live addon' };
};

const statistics = {
    peers: 128,
    speed: 14.6,
    completed: 63,
    infoHash: '0123456789abcdef0123456789abcdef01234567',
};

module.exports = { calendar, liveTv, statistics };

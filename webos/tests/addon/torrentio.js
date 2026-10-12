// A Torrentio-like answer for the `torrentio` set (F8.6): 224 streams shaped like the Torrentio +
// AllDebrid answer that made Details slow on the TV (121 KB for one film): `name` with the debrid tag
// and the resolution, `title` (not `description`, as Torrentio sends it) with the file name, seeders,
// size, source and language flags, a resolve URL with a 40-hex hash and the file name, and
// behaviorHints with bingeGroup, filename and videoSize. Deterministic (no Math.random).
//
// The URLs go to `${mediaUrl}/redirect/torrentio/...`, which the media server answers with a 302 to
// a file that does not exist: nothing here is meant to play, only to be listed.

const QUALITIES = [
    { res: '4k', tag: '2160p', tags: ['DV', 'HDR'], src: 'WEB-DL', codec: 'H.265', audio: 'DDP5.1.Atmos', gb: 18 },
    { res: '4k', tag: '2160p', tags: ['HDR10+'], src: 'BluRay.REMUX', codec: 'HEVC', audio: 'TrueHD.7.1.Atmos', gb: 62 },
    { res: '4k', tag: '2160p', tags: ['HDR'], src: 'WEBRip', codec: 'x265.10bit', audio: 'AAC5.1', gb: 9 },
    { res: '1080p', tag: '1080p', tags: [], src: 'WEB-DL', codec: 'H.264', audio: 'DDP5.1', gb: 6 },
    { res: '1080p', tag: '1080p', tags: [], src: 'BluRay', codec: 'x264', audio: 'DTS-HD.MA.5.1', gb: 14 },
    { res: '1080p', tag: '1080p', tags: [], src: 'WEBRip', codec: 'x265', audio: 'AAC2.0', gb: 2 },
    { res: '720p', tag: '720p', tags: [], src: 'WEB-DL', codec: 'H.264', audio: 'DDP5.1', gb: 3 },
    { res: '480p', tag: '480p', tags: [], src: 'HDTV', codec: 'XviD', audio: 'MP3', gb: 1 },
];
const GROUPS = ['FLUX', 'NTb', 'TEPES', 'SWTYBLZ', 'YIFY', 'RARBG', 'playWEB', 'BYNDR', 'EDITH', 'GalaxyRG'];
const SOURCES = ['TorrentGalaxy', 'ThePirateBay', '1337x', 'RARBG', 'YTS', 'MagnetDL', 'Comando', 'BluDV'];
const FLAGS = ['🇬🇧', '🇬🇧 / 🇫🇷 / 🇪🇸', 'Multi Audio / 🇬🇧 / 🇮🇹', '🇧🇷 / 🇵🇹', 'Multi Subs / 🇬🇧', '🇷🇺 / 🇺🇦 / 🇬🇧'];

// A 40-hex "info hash" from the index (a small LCG, so the list is the same on every run).
const hashOf = (index) => {
    let x = (index + 1) * 2654435761 >>> 0;
    let out = '';
    while (out.length < 40) {
        x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
        out += x.toString(16).padStart(8, '0');
    }
    return out.slice(0, 40);
};

const torrentioStreams = (mediaUrl, { count = 224, title = 'Disclosure.Day.2026' } = {}) => {
    const streams = [];
    for (let i = 0; i < count; i++) {
        const q = QUALITIES[i % QUALITIES.length];
        const group = GROUPS[i % GROUPS.length];
        const file = [title, q.tag, q.src, q.audio, ...q.tags, q.codec].join('.') + `-${group}.mkv`;
        const sizeGb = q.gb + ((i * 37) % 100) / 10;
        const cached = i % 9 !== 8;
        const hash = hashOf(i);
        streams.push({
            name: `[AD${cached ? '+' : ' download'}] Torrentio\n${q.res}${q.tags.length ? ' ' + q.tags.join(' | ') : ''}`,
            title: `${file}\n👤 ${(i * 53) % 400 + 1} 💾 ${sizeGb.toFixed(2)} GB ⚙️ ${SOURCES[i % SOURCES.length]}\n${FLAGS[i % FLAGS.length]}`,
            url: `${mediaUrl}/redirect/torrentio/resolve/alldebrid/FIXTUREKEY/${hash}/null/${i % 3}/${encodeURIComponent(file)}`,
            behaviorHints: {
                bingeGroup: `torrentio|${q.res}|${q.src}|${q.tags.join('|')}|${q.audio}|${group}`,
                filename: file,
                videoSize: Math.round(sizeGb * 1073741824),
            },
        });
    }
    return streams;
};

module.exports = { torrentioStreams };

// F6.1: no torrents and no streaming server on webOS (plan D4/P3).
const fs = require('fs');
const path = require('path');
const { ROOT, OVERRIDES, apply } = require('./overrides');

const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const { needsStreamingServer, hideTorrentStreams } = require(path.join(ROOT, 'src/routes/MetaDetails/hideTorrentStreams'));

const addon = (name) => ({ transportUrl: `https://${name}/manifest.json`, manifest: { name } });
const ready = (name, streams) => ({ addon: addon(name), content: { type: 'Ready', content: streams } });
const debrid = { name: 'RD', description: '4K', url: 'https://rd.example/file.mkv' };
const torrent = { name: 'Torrent', description: '1080p', infoHash: '0123456789abcdef0123456789abcdef01234567', fileIdx: 1 };

describe('needsStreamingServer', () => {
    test('torrents and server-side archives need it', () => {
        expect(needsStreamingServer(torrent)).toBe(true);
        expect(needsStreamingServer({ ...torrent, url: 'https://x/y.mkv' })).toBe(true);
        expect(needsStreamingServer({ nzbUrl: 'https://x/y.nzb', servers: ['nntp://s'] })).toBe(true);
        ['rarUrls', 'zipUrls', '7zipUrls', 'tgzUrls', 'tarUrls'].forEach((field) => {
            expect(needsStreamingServer({ [field]: [{ url: 'https://x/a' }] })).toBe(true);
        });
    });

    test('direct, external and YouTube streams do not', () => {
        expect(needsStreamingServer(debrid)).toBe(false);
        expect(needsStreamingServer({ externalUrl: 'https://x' })).toBe(false);
        expect(needsStreamingServer({ ytId: 'abc' })).toBe(false);
        expect(needsStreamingServer({ infoHash: '', rarUrls: [] })).toBe(false);
        expect(needsStreamingServer(null)).toBe(false);
        expect(needsStreamingServer(undefined)).toBe(false);
    });
});

describe('hideTorrentStreams', () => {
    test('drops torrents and keeps the order of the rest', () => {
        const second = { ...debrid, name: 'AD' };
        const [entry] = hideTorrentStreams([ready('a', [torrent, debrid, torrent, second])]);
        expect(entry.content).toEqual({ type: 'Ready', content: [debrid, second] });
        expect(entry.addon.manifest.name).toBe('a');
    });

    test('an addon with only torrents becomes an error, so the list can say "no streams"', () => {
        const result = hideTorrentStreams([ready('a', [torrent]), ready('b', [debrid])]);
        expect(result[0].content.type).toBe('Err');
        expect(result[0].addon.manifest.name).toBe('a');
        expect(result[1].content.content).toEqual([debrid]);
        const onlyTorrents = hideTorrentStreams([ready('a', [torrent]), ready('b', [torrent, torrent])]);
        expect(onlyTorrents.every((entry) => entry.content.type === 'Err')).toBe(true);
    });

    test('leaves Loading, Err and empty Ready entries as they are', () => {
        const streams = [
            { addon: addon('a'), content: { type: 'Loading' } },
            { addon: addon('b'), content: { type: 'Err', content: 'x' } },
            ready('c', []),
        ];
        expect(hideTorrentStreams(streams)).toBe(streams);
        expect(hideTorrentStreams(streams)[0]).toBe(streams[0]);
    });

    test('returns the same array when nothing was hidden, and does not mutate the input', () => {
        const streams = [ready('a', [debrid])];
        expect(hideTorrentStreams(streams)).toBe(streams);
        const mixed = [ready('a', [torrent, debrid])];
        const copy = JSON.parse(JSON.stringify(mixed));
        expect(hideTorrentStreams(mixed)).not.toBe(mixed);
        expect(mixed).toEqual(copy);
    });

    test('passes through what is not a list (no selected stream path yet)', () => {
        expect(hideTorrentStreams([])).toEqual([]);
        expect(hideTorrentStreams(null)).toBeNull();
        expect(hideTorrentStreams(undefined)).toBeUndefined();
    });
});

describe('useMetaDetails.webos', () => {
    test('wraps the upstream hook by explicit path and filters only streams', () => {
        const source = read('src/routes/MetaDetails/useMetaDetails.webos.js');
        expect(source).toContain("require('./useMetaDetails.js')");
        expect(source).toContain('hideTorrentStreams(metaDetails.streams)');
        // MetaDetails.js and LiveTvDetails read these from the hook result.
        const upstream = read('src/routes/MetaDetails/MetaDetails.js');
        expect(upstream).toContain('const metaDetails = useMetaDetails(urlParams);');
        expect(upstream.match(/streams=\{metaDetails\.streams\}/g)).toHaveLength(2);
    });
});

describe('useStreamingServer.webos', () => {
    const useStreamingServer = require(path.join(ROOT, 'src/common/useStreamingServer.webos'));

    test('is an empty model, always the same object', () => {
        const state = useStreamingServer();
        expect(useStreamingServer()).toBe(state);
        expect(state.baseUrl).toBeNull();
        expect(state.settings).toBeNull();
        expect(state.torrent).toBeNull();
        expect(state.statistics).toBeNull();
        expect(state.playbackDevices).toBeNull();
        expect(state.casting).toBeNull();
        expect(Object.isFrozen(state)).toBe(true);
    });

    test('has the keys of the StreamingServer model type', () => {
        const type = read('src/core/types/models/StremingServer.d.ts');
        const block = type.slice(type.indexOf('type StreamingServer = {'));
        const keys = [...block.slice(0, block.indexOf('\n};')).matchAll(/^ {4}(\w+):/gm)].map((match) => match[1]);
        expect(keys.length).toBeGreaterThan(8);
        expect(Object.keys(useStreamingServer()).sort()).toEqual(keys.sort());
    });

    test('the Board warning and the Player see no server', () => {
        const { settings } = useStreamingServer();
        // Board.js: warning only for settings.type === 'Err'; Player.js: waits only for 'Loading'.
        expect(settings !== null && settings.type === 'Err').toBe(false);
        expect(settings?.type !== 'Loading').toBe(true);
        const board = read('src/routes/Board/Board.js');
        expect(board).toContain("streamingServer.settings !== null && streamingServer.settings.type === 'Err'");
    });
});

describe('Settings streaming section', () => {
    test('renders nothing', () => {
        const source = read('src/routes/Settings/Streaming/index.webos.ts');
        expect(source).toContain('forwardRef<HTMLDivElement>(() => null)');
        expect(source).not.toMatch(/URLsManager|useStreamingOptions/);
    });

    test('Settings.tsx still skips sections without an element', () => {
        const settings = read('src/routes/Settings/Settings.tsx');
        expect(settings).toContain('sections.filter((section) => section.ref.current)');
        expect(settings).toContain("import Streaming from './Streaming';");
    });
});

describe.each(OVERRIDES)('$override', (entry) => {
    test('is the upstream file with only the planned edits', () => {
        expect(read(entry.override)).toBe(apply(entry));
    });

    test('has no streaming server code left', () => {
        const source = read(entry.override).replace(/^\/\/.*$/gm, '');
        expect(source).not.toMatch(/useStreamingServer|streamingServerWarning|usePlayUrl|magnet/i);
        expect(source).not.toMatch(/SECTIONS\.STREAMING|SETTINGS_SERVER_VERSION/);
    });
});

/* global describe, it, expect */
// Drift guard: the F5.4 overrides rely on upstream details (useAudio.ts, Player.js, stremio-video's
// WebOsVideo and selectVideoImplementation). If one changes, this fails before the override goes
// silently stale. Also checks the webpack step that wires the decorator in.

const fs = require('fs');
const path = require('path');
const webpack = require('webpack');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const PLAYER_DIR = path.join(ROOT, 'src', 'routes', 'Player');
const VIDEO_SRC = path.join(path.dirname(require.resolve('@stremio/stremio-video/package.json', { paths: [ROOT] })), 'src');
const readPlayer = (file) => fs.readFileSync(path.join(PLAYER_DIR, file), 'utf8');
const readVideo = (file) => fs.readFileSync(path.join(VIDEO_SRC, file), 'utf8');

describe('upstream details the F5.4 overrides depend on', () => {
    it('Player.js takes the default export of ./useAudio with the same arguments', () => {
        const source = readPlayer('Player.js');
        expect(source).toMatch(/const \{ default: useAudio \} = require\('\.\/useAudio'\);/);
        expect(source).toMatch(/useAudio\(\{\s*player,\s*video,\s*settings,\s*streamStateChanged,\s*audioPreferenceChanged,\s*\}\)/);
    });

    it('useAudio.ts: the hook the override mirrors (same arguments, saved track first, the same calls)', () => {
        const source = readPlayer('useAudio.ts');
        expect(source).toMatch(/const useAudio = \(\{ player, video, settings, streamStateChanged, audioPreferenceChanged \}: Args\)/);
        expect(source).toMatch(/player\.streamState\?\.audioTrack,\s*player\.audioPreference,\s*settings\.audioLanguage,/);
        expect(source).toMatch(/streamStateChanged\(\{ audioTrack: \{ id, \.\.\.\(language \? \{ language \} : \{\}\) \} \}\);/);
        expect(source).toMatch(/audioPreferenceChanged\(language \? \{ language \} : \{\}\);/);
        expect(source).toMatch(/export default useAudio;/);
    });

    it('stremio-video: WebOsVideo is picked through ../WebOsVideo and asks ../tracksData for the tracks', () => {
        expect(readVideo(path.join('StremioVideo', 'selectVideoImplementation.js'))).toMatch(/require\('\.\.\/WebOsVideo'\)/);
        const webOsVideo = readVideo(path.join('WebOsVideo', 'WebOsVideo.js'));
        expect(webOsVideo).toMatch(/require\('\.\.\/tracksData'\)/);
        expect(readVideo('tracksData.js')).toMatch(/127\.0\.0\.1:11470\/tracks/);
        // The props and event the decorator takes over.
        const { manifest } = require(path.join(VIDEO_SRC, 'WebOsVideo', 'WebOsVideo.js'));
        expect(manifest.name).toBe('WebOsVideo');
        ['audioTracks', 'selectedAudioTrackId', 'subtitlesTracks'].forEach((prop) => expect(manifest.props).toContain(prop));
        expect(manifest.events).toContain('audioTrackLoaded');
        // The embedded subtitle ids the listing keeps (EMBEDDED_<n> -> Luna selectTrack index n).
        expect(webOsVideo).toMatch(/var trackIndex = parseInt\(propValue\.replace\('EMBEDDED_', ''\)\);/);
    });
});

describe('webos/webpack/player.js', () => {
    const plugins = require(path.join(ROOT, 'webos', 'webpack', 'player.js'))({ plugins: [] }).plugins;
    const replace = (request, context) => {
        const resource = { request, context };
        plugins.forEach((plugin) => {
            expect(plugin).toBeInstanceOf(webpack.NormalModuleReplacementPlugin);
            if (plugin.resourceRegExp.test(resource.request)) plugin.newResource(resource);
        });
        return resource.request;
    };
    const TRACKS_DIR = path.join(ROOT, 'webos', 'lib', 'tracks');

    it('replaces WebOsVideo and tracksData inside stremio-video only', () => {
        expect(replace('../WebOsVideo', path.join(VIDEO_SRC, 'StremioVideo'))).toBe(path.join(TRACKS_DIR, 'WebOsVideo.js'));
        expect(replace('../tracksData', path.join(VIDEO_SRC, 'WebOsVideo'))).toBe(path.join(TRACKS_DIR, 'tracksData.js'));
        expect(replace('../WebOsVideo', path.join(ROOT, 'src', 'somewhere'))).toBe('../WebOsVideo');
        expect(replace('../tracksData', path.join(VIDEO_SRC, 'TizenVideo'))).toBe('../tracksData');
        // the decorator's own require of the upstream WebOsVideo is left alone (no loop)
        expect(replace('@stremio/stremio-video/src/WebOsVideo/WebOsVideo', TRACKS_DIR)).toBe('@stremio/stremio-video/src/WebOsVideo/WebOsVideo');
    });

    it('the tracksData stand-in makes no request', () => {
        const calls = [];
        require(path.join(TRACKS_DIR, 'tracksData.js'))('http://x/a.mkv', (value) => calls.push(value));
        expect(calls).toEqual([false]);
    });
});

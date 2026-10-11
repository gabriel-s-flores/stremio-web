// Drift guard: the webOS overrides of the Player (useVideo.webos.js, ControlBar.webos.js) rely on a
// few upstream details. When one of them changes, the override would silently stop working (the
// speed button would come back, for instance), so this test fails first.

const fs = require('fs');
const path = require('path');

const PLAYER_DIR = path.join(__dirname, '..', '..', '..', '..', 'src', 'routes', 'Player');
const read = (file) => fs.readFileSync(path.join(PLAYER_DIR, file), 'utf8');
const count = (text, pattern) => text.split(pattern).length - 1;

describe('upstream Player details the webOS overrides depend on', () => {
    it('ControlBar: the speed menu is opened by exactly one element, through onClick', () => {
        const source = read(path.join('ControlBar', 'ControlBar.js'));
        expect(count(source, 'onToggleSpeedMenu}')).toBe(1);
        expect(count(source, 'onClick={onToggleSpeedMenu}')).toBe(1);
        expect(source).toMatch(/const ControlBar = React\.forwardRef\(/);
    });

    it('useVideo: returns load, state and setPlaybackSpeed', () => {
        const source = read('useVideo.js');
        const returned = source.slice(source.lastIndexOf('return {'));
        expect(returned).toMatch(/\n\s+state,\n/);
        expect(returned).toMatch(/\n\s+load,\n/);
        expect(returned).toMatch(/\n\s+setPlaybackSpeed,\n/);
    });

    it('playbackSpeed: the known consumers, each safe with the webOS values', () => {
        // useVideo.webos.js gives the Player state null and ControlBar.webos.js gives the bar 1. A new
        // consumer (or a changed one) has to be checked against those two values before updating this list.
        //   ControlBar.js, SeekBar.js: get 1 (SeekBar divides the remaining time by it)
        //   Indicator.tsx: skips null; SpeedMenu.js: never opened (gated on !== null)
        //   usePlaybackSpeedHold.ts: null -> 1, and setPlaybackSpeed is a no-op
        //   useVideo.js: the state and setter the override wraps; Player.js: gates and props
        const consumers = [];
        const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) return walk(file);
            if (/\.webos\.|\.d\.ts$/.test(entry.name) || !/\.(js|ts|tsx)$/.test(entry.name)) return;
            if (fs.readFileSync(file, 'utf8').includes('playbackSpeed')) consumers.push(path.relative(PLAYER_DIR, file));
        });
        walk(PLAYER_DIR);
        expect(consumers.sort()).toEqual([
            path.join('ControlBar', 'ControlBar.js'),
            path.join('ControlBar', 'SeekBar', 'SeekBar.js'),
            path.join('Indicator', 'Indicator.tsx'),
            'Player.js',
            path.join('SpeedMenu', 'SpeedMenu.js'),
            'usePlaybackSpeedHold.ts',
            'useVideo.js',
        ].sort());
        expect(read(path.join('ControlBar', 'SeekBar', 'SeekBar.js'))).toMatch(/\/playbackSpeed/);
        expect(read(path.join('Indicator', 'Indicator.tsx'))).toMatch(/if \(next && next !== prev\)/);
        expect(read('usePlaybackSpeedHold.ts')).toMatch(/speedRef\.current \?\? 1/);
    });

    it('Player: speed controls are gated on playbackSpeed !== null and the load gets the surround setting', () => {
        const source = read('Player.js');
        expect(source).toMatch(/useShortcut\('speedMenu'[\s\S]*?video\.state\.playbackSpeed !== null/);
        expect(source).toMatch(/useShortcut\('speed'[\s\S]*?video\.state\.playbackSpeed !== null/);
        expect(source).toMatch(/maxAudioChannels: settings\.surroundSound \? 32 : 2/);
        expect(source).toMatch(/platform: platform\.name/);
    });
});

// The pipeline guard (withPipelineGuard.js, F5.6) relies on how stremio-video's WebOsVideo and the
// Player drive the <video> element.
describe('upstream details the F5.6 pipeline guard depends on', () => {
    const ROOT = path.join(__dirname, '..', '..', '..', '..');
    const VIDEO_SRC = path.join(path.dirname(require.resolve('@stremio/stremio-video/package.json', { paths: [ROOT] })), 'src');
    const webOsVideo = fs.readFileSync(path.join(VIDEO_SRC, 'WebOsVideo', 'WebOsVideo.js'), 'utf8');
    const section = (from, to) => webOsVideo.slice(webOsVideo.indexOf(from), webOsVideo.indexOf(to, webOsVideo.indexOf(from)));

    it('WebOsVideo load: sets src, then calls load() and play() once the mediaId shows up (the load() the guard drops)', () => {
        const load = section('case \'load\': {', 'case \'unload\': {');
        expect(load).toMatch(/videoElement\.src = stream\.url;\s*initMediaId\(startVideo\);/);
        expect(load).toMatch(/var startVideo = function \(\) \{[\s\S]*videoElement\.load\(\);[\s\S]*videoElement\.play\(\);/);
        expect(load).not.toMatch(/removeAttribute/);
    });

    it('WebOsVideo unload releases the pipeline with removeAttribute(\'src\') + load(), and destroy goes through unload', () => {
        expect(section('case \'unload\': {', 'case \'destroy\': {')).toMatch(/videoElement\.removeAttribute\('src'\);\s*videoElement\.load\(\);/);
        expect(section('case \'destroy\': {', 'this.on = function')).toMatch(/command\('unload'\);[\s\S]*containerElement\.removeChild\(videoElement\);/);
    });

    it('WebOsVideo applies the start time on every loadedmetadata (kept across the watchdog reload)', () => {
        expect(webOsVideo).toMatch(/videoElement\.onloadedmetadata = function\(\) \{[^}]*setProp\('time', startTime\);/);
        expect(section('case \'load\': {', 'case \'unload\': {')).toMatch(/startTime = commandArgs\.time;/);
    });

    it('WebOsVideo selects an embedded subtitle through Luna 500 ms later, with the mediaId of that moment', () => {
        const setProp = webOsVideo.slice(webOsVideo.indexOf('function setProp('));
        const select = setProp.slice(setProp.indexOf('case \'selectedSubtitlesTrackId\': {'), setProp.indexOf('case \'subtitlesOffset\': {'));
        expect(select).toMatch(/setTimeout\(function\(\) \{[\s\S]*method: 'selectTrack',[\s\S]*'mediaId': videoElement\.mediaId,[\s\S]*\}, 500\);/);
    });

    it('stremio-video has STREAM_FAILED_TO_LOAD (code 3), the error of a stream that never starts', () => {
        expect(require(path.join(VIDEO_SRC, 'error.js')).STREAM_FAILED_TO_LOAD).toEqual({ code: 3, message: 'Stream failed to load' });
    });

    it('Player.js unloads and loads in the same effect (a stream switch reaches the guard as unload + load)', () => {
        expect(read('Player.js')).toMatch(/video\.unload\(\);\s*if \(player\.selected && player\.stream\?\.type === 'Ready'[^\n]*\{\s*video\.load\(\{/);
    });

    it('useVideo destroys the video in a passive effect cleanup and returns containerRef (holdVideosInPlace runs before, in a layout cleanup)', () => {
        const source = read('useVideo.js');
        expect(source).toMatch(/React\.useEffect\(\(\) => \{\s*video\.current = new Video\(\);[\s\S]*?return \(\) => \{[\s\S]*?video\.current\.destroy\(\);/);
        expect(source.slice(source.lastIndexOf('return {'))).toMatch(/\n\s+containerRef,\n/);
        expect(fs.readFileSync(path.join(PLAYER_DIR, 'useVideo.webos.js'), 'utf8')).toMatch(/React\.useLayoutEffect\([\s\S]*holdVideosInPlace\(containerElement\)/);
    });

    it('the webOS WebOsVideo is the guarded one, under the tracks decorator', () => {
        const composed = fs.readFileSync(path.join(ROOT, 'webos', 'lib', 'tracks', 'WebOsVideo.js'), 'utf8');
        expect(composed).toMatch(/pipelineGuardEnabled\(storage\) \? withPipelineGuard\(WebOsVideo, /);
        expect(composed).toMatch(/withC8Tracks\(Video, /);
    });
});

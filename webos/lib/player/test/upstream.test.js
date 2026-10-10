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

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

    it('Player: speed controls are gated on playbackSpeed !== null and the load gets the surround setting', () => {
        const source = read('Player.js');
        expect(source).toMatch(/useShortcut\('speedMenu'[\s\S]*?video\.state\.playbackSpeed !== null/);
        expect(source).toMatch(/useShortcut\('speed'[\s\S]*?video\.state\.playbackSpeed !== null/);
        expect(source).toMatch(/maxAudioChannels: settings\.surroundSound \? 32 : 2/);
        expect(source).toMatch(/platform: platform\.name/);
    });
});

// Drift guard: the Player remote (webos/lib/player-remote) works on the upstream Player as it is, so it
// relies on a few upstream details. When one of them changes, a key would silently stop working, so
// this test fails first.

const fs = require('fs');
const path = require('path');
const React = require('react');
const { makeFocusable } = require('..');

const PLAYER_DIR = path.join(__dirname, '..', '..', '..', '..', 'src', 'routes', 'Player');
const read = (file) => fs.readFileSync(path.join(PLAYER_DIR, file), 'utf8');

describe('upstream Player details the remote depends on', () => {
    const player = read('Player.js');

    it('the bar is hidden through the overlayHidden class of the container', () => {
        expect(player).toMatch(/\[styles\['overlayHidden'\]\]: overlayHidden/);
    });

    it('a mouse move over the container shows the bar for a while (the remote reveals it that way)', () => {
        expect(player).toMatch(/onMouseMove=\{onContainerMouseMove\}/);
        expect(player).toMatch(/const onContainerMouseMove = React\.useCallback\(\(event\) => \{\n\s+setImmersed\(false\);\n\s+if \(!event\.nativeEvent\.immersePrevented\) \{\n\s+setImmersedDebounced\(true\);/);
    });

    it('the bar gets the mouse leave handler as onTouchEnd, and it hides the bar (Back)', () => {
        expect(player).toMatch(/onTouchEnd=\{onContainerMouseLeave\}/);
        expect(player).toMatch(/const onContainerMouseLeave = React\.useCallback\(\(\) => \{\n\s+setImmersedDebounced\.cancel\(\);\n\s+setImmersed\(true\);/);
    });

    it('the bar gets play, pause and next video, and the paused state', () => {
        ['paused={video.state.paused}', 'onPlayRequested={onPlayRequested}', 'onPauseRequested={onPauseRequested}', 'onNextVideoRequested={onNextVideoRequested}', 'nextVideo={isEpg ? null : player.nextVideo}']
            .forEach((prop) => expect(player).toContain(prop));
    });

    it('ArrowLeft/ArrowRight seek through useKeyboardSeek, shown on the bar, committed on keyup', () => {
        const shortcuts = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'src', 'common', 'Shortcuts', 'shortcuts.json'), 'utf8'));
        const combos = {};
        shortcuts.forEach((group) => group.shortcuts.forEach((shortcut) => {
            combos[shortcut.name] = shortcut.combos;
        }));
        expect(combos.seekForward[0]).toEqual(['ArrowRight']);
        expect(combos.seekBackward[0]).toEqual(['ArrowLeft']);
        expect(combos.volume).toEqual([['ArrowUp'], ['ArrowDown']]);
        expect(player).toMatch(/useShortcut\('seekForward'/);
        expect(player).toMatch(/time=\{keyboardSeekTime \?\? video\.state\.time\}/);
        expect(player).toMatch(/keyboardKeys\.includes\('ArrowRight'\) \|\| keyboardKeys\.includes\('ArrowLeft'\)\) \{\n\s+releaseKeyboardSeek\(\);/);
    });

    it('class names the controller looks for', () => {
        const controlBar = read(path.join('ControlBar', 'ControlBar.js'));
        expect(controlBar).toContain("styles['control-bar-buttons-container']");
        expect(controlBar).toContain('tabIndex={-1}');
        expect(read(path.join('ControlBar', 'SeekBar', 'SeekBar.js'))).toContain("styles['seek-bar-container']");
        const popup = read(path.join('NextVideoPopup', 'NextVideoPopup.js'));
        expect(popup).toContain("styles['next-video-popup-container']");
        expect(popup).toContain("styles['play-button']");
    });
});

describe('makeFocusable', () => {
    const h = React.createElement;

    it('turns tabIndex -1 into 0 and keeps the untouched elements as they are', () => {
        const untouched = h('span', { id: 'label' }, 'x');
        const tree = h('div', { id: 'bar' },
            untouched,
            h('div', { id: 'row' }, h('div', { id: 'play', tabIndex: -1 }), null, h('div', { id: 'menu', tabIndex: 0 })),
        );
        const result = makeFocusable(React, tree);
        const row = React.Children.toArray(result.props.children)[1];
        const [play, menu] = React.Children.toArray(row.props.children);
        expect(play.props.tabIndex).toBe(0);
        expect(menu.props.tabIndex).toBe(0);
        expect(React.Children.toArray(result.props.children)[0].props).toBe(untouched.props);
    });

    it('returns the same element when nothing changes', () => {
        const tree = h('div', null, h('span', null, 'a'));
        expect(makeFocusable(React, tree)).toBe(tree);
    });
});

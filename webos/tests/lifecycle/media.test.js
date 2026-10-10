const { pauseMedia, listMedia, createPlayGuard } = require('../../lifecycle/media');
const { createWindow } = require('./helpers');

describe('pauseMedia', () => {
    test('pauses what is playing and leaves the rest alone', () => {
        const { document: doc } = createWindow();
        const playing = doc.create('video');
        playing.paused = false;
        const idle = doc.create('video');
        const ended = doc.create('audio');
        ended.paused = false;
        ended.ended = true;
        const idlePause = jest.spyOn(idle, 'pause');
        const endedPause = jest.spyOn(ended, 'pause');

        const paused = pauseMedia(doc);

        expect(paused).toEqual([playing]);
        expect(playing.paused).toBe(true);
        expect(idlePause).not.toHaveBeenCalled();
        expect(endedPause).not.toHaveBeenCalled();
    });

    test('a media element that throws on pause does not stop the others', () => {
        const { document: doc } = createWindow();
        const stuck = doc.create('video');
        stuck.paused = false;
        stuck.pause = () => {
            throw new Error('refused');
        };
        const playing = doc.create('audio');
        playing.paused = false;

        expect(pauseMedia(doc)).toEqual([playing]);
    });

    test('no media, no work', () => {
        expect(pauseMedia(createWindow().document)).toEqual([]);
    });
});

describe('createPlayGuard', () => {
    const setup = () => {
        const win = createWindow();
        const video = win.document.create('video');
        const guard = createPlayGuard(win);
        return { win, video, guard };
    };

    test('while armed, a play of the guarded elements nobody asked for is paused again', () => {
        const { win, video, guard } = setup();

        guard.arm(listMedia(win.document));
        video.play();
        expect(video.paused).toBe(true);

        guard.disarm();
        video.play();
        expect(video.paused).toBe(false);
        expect(win.document.listenerCount('play')).toBe(0);
    });

    test('once per element: the system resumes once, a later play is the app\'s', () => {
        const { win, video, guard } = setup();
        guard.arm(listMedia(win.document), 5000);

        video.play();
        expect(video.paused).toBe(true);
        video.play();
        expect(video.paused).toBe(false);
    });

    test('an element created after the guard was armed is never touched', () => {
        const { win, guard } = setup();
        guard.arm(listMedia(win.document), 5000);
        const next = win.document.create('video');

        next.play();
        expect(next.paused).toBe(false);
    });

    test('a timed guard expires', () => {
        const { win, video, guard } = setup();

        guard.arm([video], 5000);
        win.advance(4999);
        expect(guard.isArmed()).toBe(true);

        win.advance(1);
        expect(guard.isArmed()).toBe(false);
        video.play();
        expect(video.paused).toBe(false);
        expect(win.pendingTimers()).toBe(0);
    });

    test.each(['keydown', 'mousedown', 'click', 'touchstart'])('the first %s hands play back to the user', (type) => {
        const { win, video, guard } = setup();

        guard.arm([video], 5000);
        win.document.dispatch(type);
        expect(guard.isArmed()).toBe(false);
        video.play();
        expect(video.paused).toBe(false);
        expect(win.pendingTimers()).toBe(0);
    });

    test('arming again starts over, without stacking listeners', () => {
        const { win, video, guard } = setup();
        guard.arm([video]);
        guard.arm([video], 5000);
        guard.arm([video], 5000);
        expect(win.document.listenerCount('play')).toBe(1);
        expect(win.document.listenerCount('keydown')).toBe(1);
        expect(win.pendingTimers()).toBe(1);
    });

    test('ignores play events of other elements', () => {
        const { win, guard } = setup();
        const other = win.document.create('div');
        other.pause = jest.fn();
        guard.arm(listMedia(win.document));
        win.document.listeners.play.forEach(({ listener }) => listener({ type: 'play', target: other }));
        expect(other.pause).not.toHaveBeenCalled();
    });
});

// Media elements while the app is in the background (F3.3).
//
// pauseMedia() pauses what is playing and nothing ever resumes it: coming back to the app leaves
// the player paused for the user to continue. stremio-video listens to the elements' own `pause`
// event, so the Player UI follows without any call into React.

const MEDIA_SELECTOR = 'video, audio';

const isPlaying = (element) => !element.paused && !element.ended;

const pauseMedia = (doc) => {
    const paused = [];
    Array.prototype.forEach.call(doc.querySelectorAll(MEDIA_SELECTOR), (element) => {
        if (!isPlaying(element)) {
            return;
        }
        try {
            element.pause();
            paused.push(element);
        } catch (_) {
            // a media element that refuses to pause is left as is
        }
    });
    return paused;
};

// Media that starts by itself around a trip to the background. Measured on the emulator: when the
// page is hidden the system pauses the playing <video> on its own (before visibilitychange runs),
// and resumes it ~0.2 s after the app comes back, with no JS involved. A load that was still
// buffering would do the same. Neither is what the user asked for, so while the guard is armed a
// `play` that no key or click caused is paused again (`play` does not bubble: it is caught in the
// capture phase of the document). The first key or click disarms it: from then on, play is the
// user's.
const INPUT_EVENTS = ['keydown', 'mousedown', 'click', 'touchstart'];

const createPlayGuard = (win) => {
    const doc = win.document;
    let armed = false;
    let timer = null;

    const onPlay = (event) => {
        const element = event.target;
        if (armed && element && typeof element.pause === 'function' && /^(video|audio)$/i.test(element.tagName || '')) {
            element.pause();
        }
    };

    const disarm = () => {
        if (timer !== null) {
            win.clearTimeout(timer);
            timer = null;
        }
        if (!armed) {
            return;
        }
        armed = false;
        doc.removeEventListener('play', onPlay, true);
        INPUT_EVENTS.forEach((type) => doc.removeEventListener(type, disarm, true));
    };

    // durationMs 0: until disarm() (the app is in the background and nobody can press anything).
    const arm = (durationMs = 0) => {
        disarm();
        armed = true;
        doc.addEventListener('play', onPlay, true);
        INPUT_EVENTS.forEach((type) => doc.addEventListener(type, disarm, true));
        if (durationMs > 0) {
            timer = win.setTimeout(disarm, durationMs);
        }
    };

    return { arm, disarm, isArmed: () => armed };
};

module.exports = {
    pauseMedia,
    createPlayGuard,
};

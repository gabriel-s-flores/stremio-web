// A way to open the context menus with the remote (F4.3).
//
// The upstream menus open with a right click (episode and stream menus: mouseup with button 2;
// ContextMenu of the Player and of the subtitle variants: a `contextmenu` event). Neither remote has
// a right button, and the upstream long press ignores mouse pointers (Popup: `pointerType !== 'mouse'`),
// which is what the Magic Remote is. Two triggers send the same events a right click does, so every
// existing menu opens through its own code path:
//   - YELLOW (405), with the focus on the item: the 5-way remote. A colour key, not a long press
//     of OK: Button clicks on the OK keydown, so a long press would activate the item (open the
//     stream, start the video) before the menu came up, and the emulator remote cannot hold a key.
//     RED GREEN YELLOW BLUE (diagnostics, F3.6) is a sequence: a YELLOW right after GREEN is part of it;
//   - holding the pointer button (left, ~0.6 s, without moving) on an item: the Magic Remote.
//     The release that follows does not click (only when a menu handled the press).
// Never over a slider (seek bar, volume): the upstream Slider ends its drag on any `mouseup` on window,
// whatever the button, so the synthetic right click would drop the thumb of a held press (measured:
// a seek bar held 0.9 s and then dragged stayed at the press point). A press that starts on a slider,
// or lands while a slider is being dragged (`active-slider-within` on <html>), is left alone.
// "Handled" is the `contextmenu` event coming back with defaultPrevented, which all the upstream
// handlers do when they open a menu. In the Player, with nothing under the trigger that handles it,
// the event goes to the video: its ContextMenu (stream options) opens.

const { PRIORITY, getInputHub } = require('./core/input');

const YELLOW_KEY = 405;
const GREEN_KEY = 404;
const DIAGNOSTICS_GAP_MS = 2500;
const LONG_PRESS_MS = 600;
// Device pixels the pointer may drift while held (the pointer of the Magic Remote shakes a little).
const MOVE_TOLERANCE_PX = 16;
// CSS modules: `<local>-<hash>`, matched by prefix like webos/back/overlays.js does.
const SLIDER = '[class^="slider-container-"], [class*=" slider-container-"]';
const SLIDER_DRAGGED = /(^|\s)active-slider-within-/;

const mouseInit = (win, button, x, y) => ({
    bubbles: true,
    cancelable: true,
    view: win,
    button,
    buttons: button === 2 ? 2 : 0,
    clientX: x,
    clientY: y,
});

// mousedown, mouseup and contextmenu of a right click at (x, y) on the target. Returns true when
// something handled the contextmenu (preventDefault).
const sendRightClick = (win, target, x, y) => {
    const send = (type, button) => target.dispatchEvent(new win.MouseEvent(type, mouseInit(win, button, x, y)));
    send('mousedown', 2);
    send('mouseup', 2);
    return send('contextmenu', 2) === false;
};

const centerOf = (element) => {
    const rect = element.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
};

// The video of the open Player, if any: the target when nothing else handles the trigger there.
const findPlayerVideo = (doc) => {
    const player = doc.querySelector('[class^="player-container-"], [class*=" player-container-"]');
    return player && doc.querySelector('.routes-container > .route-container:last-child video');
};

const openContextMenu = (win, target) => {
    const doc = win.document;
    const origin = target && target !== doc.body ? target : null;
    if (origin !== null) {
        const { x, y } = centerOf(origin);
        if (sendRightClick(win, origin, x, y)) {
            return true;
        }
    }
    const video = findPlayerVideo(doc);
    if (video) {
        const { x, y } = centerOf(video);
        return sendRightClick(win, video, x, y);
    }
    return false;
};

// `isTrusted` is a parameter for the tests: jsdom cannot make a trusted event. The keys come from the
// input hub of the navigation (./core/input.js); the long press listens to the pointer itself.
const installContextMenuTrigger = (win, { longPressMs = LONG_PRESS_MS, now = Date.now, isTrusted = (event) => event.isTrusted, hub = getInputHub(win), setTimeout: timeout = win.setTimeout.bind(win), clearTimeout: clear = win.clearTimeout.bind(win) } = {}) => {
    const doc = win.document;
    let lastGreen = -Infinity;
    let press = null;
    let timer = null;
    let swallowClick = false;

    const onKeyDown = (event) => {
        if (event.keyCode === GREEN_KEY) {
            lastGreen = now();
            return;
        }
        if (event.keyCode !== YELLOW_KEY || event.repeat || now() - lastGreen < DIAGNOSTICS_GAP_MS) {
            return;
        }
        openContextMenu(win, doc.activeElement);
    };

    const cancel = () => {
        clear(timer);
        timer = null;
        press = null;
    };

    const onMouseDown = (event) => {
        swallowClick = false;
        cancel();
        if (!isTrusted(event) || event.button !== 0) {
            return;
        }
        if (event.target && typeof event.target.closest === 'function' && event.target.closest(SLIDER)) {
            return;
        }
        press = { x: event.clientX, y: event.clientY };
        timer = timeout(() => {
            const { x, y } = press;
            cancel();
            if (SLIDER_DRAGGED.test(String(doc.documentElement.className))) {
                return;
            }
            const target = doc.elementFromPoint(x, y);
            if (target && !(typeof target.closest === 'function' && target.closest(SLIDER)) && sendRightClick(win, target, x, y)) {
                swallowClick = true;
            }
        }, longPressMs);
    };

    const onMouseMove = (event) => {
        if (press && isTrusted(event) && Math.hypot(event.clientX - press.x, event.clientY - press.y) > MOVE_TOLERANCE_PX) {
            cancel();
        }
    };

    const onClick = (event) => {
        if (swallowClick && isTrusted(event)) {
            swallowClick = false;
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    };

    const removeKey = hub.onKey(onKeyDown, PRIORITY.colorKeys);
    win.addEventListener('mousedown', onMouseDown, true);
    win.addEventListener('mousemove', onMouseMove, true);
    win.addEventListener('mouseup', cancel, true);
    win.addEventListener('blur', cancel);
    doc.addEventListener('cursorStateChange', cancel);
    win.addEventListener('click', onClick, true);

    return () => {
        cancel();
        removeKey();
        win.removeEventListener('mousedown', onMouseDown, true);
        win.removeEventListener('mousemove', onMouseMove, true);
        win.removeEventListener('mouseup', cancel, true);
        win.removeEventListener('blur', cancel);
        doc.removeEventListener('cursorStateChange', cancel);
        win.removeEventListener('click', onClick, true);
    };
};

module.exports = {
    YELLOW_KEY,
    LONG_PRESS_MS,
    sendRightClick,
    openContextMenu,
    installContextMenuTrigger,
};

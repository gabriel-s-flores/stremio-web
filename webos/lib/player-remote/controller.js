// The remote in the Player on webOS TV 4.x (F5.7): control bar reachable with the arrows, seek with
// the arrows and the fast forward/rewind keys, play/pause with OK and the media keys, Stop leaves the
// Player, and Back hides the bar before it leaves. Rules and reasons: webos/lib/player-remote/README.md.
//
// It works on the upstream Player as it is (src/routes/Player/Player.js is not overridden):
// - the seek is the upstream one (useKeyboardSeek through the ArrowLeft/ArrowRight shortcuts): step of
//   settings.seekTimeDuration, acceleration while the key is held, the target shown on the seek bar
//   before it is committed on keyup. Fast forward and rewind are sent to it as those arrows;
// - play/pause, next video and "hide the bar" are the Player's own callbacks, which it hands to the
//   control bar (src/routes/Player/ControlBar/ControlBar.webos.js gives them to this controller);
// - the bar is shown the way the pointer shows it: a mouse move over the Player container.
//
// Listeners are on window in the capture phase. A key handled here is consumed (preventDefault and
// stopImmediatePropagation: no upstream shortcut, no spatial navigation, no React handler sees it),
// except the arrows that seek, which only get preventDefault (the upstream shortcuts on document
// still see them, the spatial-navigation-polyfill skips them), and OK on a focused button, which the
// upstream Button turns into a click. Menus, the side drawer and other overlays are left to the
// focus layer (F4.3) and the Back bridge (webos/back/overlays.js); only the media keys still act.

const { ACTIONS, getAction, isMediaAction, isModified } = require('./keys');

// Marks the arrow events this controller sends for fast forward and rewind.
const SYNTHETIC = '__webosPlayerRemote';
// Without the keyup of a held fast forward/rewind (focus lost, a key event missed), the upstream
// seek would keep its target on screen and never commit it: release it after this long.
const SEEK_RELEASE_FALLBACK_MS = 1000;

const ARROW_KEYS = {
    left: { key: 'ArrowLeft', keyCode: 37 },
    right: { key: 'ArrowRight', keyCode: 39 },
};

// CSS module class names are `<local>-<hash>` (5 characters).
const hasLocalClass = (element, name) => {
    const className = element && typeof element.className === 'string' ? element.className : '';
    if (className.indexOf(name + '-') === -1) return false;
    const pattern = new RegExp('^' + name + '-[\\w-]{5}$');
    return className.split(/\s+/).some((token) => pattern.test(token));
};

const queryLocal = (root, name) => {
    if (!root) return null;
    const candidates = root.querySelectorAll('[class*="' + name + '-"]');
    for (let i = 0; i < candidates.length; i++) {
        if (hasLocalClass(candidates[i], name)) return candidates[i];
    }
    return null;
};

const isShown = (element) => {
    if (!element || !element.getClientRects || element.getClientRects().length === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
};

const isFocusable = (element) => element.tabIndex >= 0 && !element.disabled && !element.hasAttribute('disabled');

const hasClassToken = (element, token) => (
    typeof element.className === 'string' && element.className.split(/\s+/).indexOf(token) !== -1
);

const focusablesIn = (root) => (root ?
    Array.prototype.filter.call(root.querySelectorAll('[tabindex]'), (element) => isFocusable(element) && isShown(element)) :
    []);

const createPlayerRemote = ({ window, getBar, getProps, isOverlayOpen = () => false, stop = () => {} }) => {
    const document = window.document;
    let lastButton = null;
    let heldSeek = null;
    let releaseTimer = null;
    // The last key seen and what was done with it (emulator tests, diagnostics).
    const status = { action: null, zone: null, result: null, count: 0, key: null };

    const bar = () => getBar() || null;
    const container = () => {
        const element = bar();
        return element ? element.parentNode : null;
    };

    // The bar is mounted and its Player is the visible route (the routes below stay mounted).
    const isActive = () => {
        const element = bar();
        if (!element || !document.body.contains(element)) return false;
        const route = element.closest('.route-container');
        return route === null || route === document.querySelector('.routes-container > .route-container:last-child');
    };

    // The upstream Player fades the bar out with the class overlayHidden on its container.
    const isHidden = () => {
        const element = container();
        return !!element && typeof element.className === 'string' &&
            element.className.split(/\s+/).some((token) => /^overlayHidden-/.test(token));
    };

    const seekBar = () => queryLocal(bar(), 'seek-bar-container');
    // The buttons of the bar the remote can stop on: shown (the "more" menu button is hidden at TV
    // width) and not greyed out (no subtitles, no cast on the TV).
    const buttons = () => focusablesIn(queryLocal(bar(), 'control-bar-buttons-container'))
        .filter((element) => !hasClassToken(element, 'disabled'));
    const popup = () => {
        const element = queryLocal(container(), 'next-video-popup-container');
        return element && isShown(element) ? element : null;
    };
    const popupButtons = () => focusablesIn(popup());
    const popupDefault = () => {
        const list = popupButtons();
        return list.filter((element) => hasLocalClass(element, 'play-button'))[0] || list[list.length - 1] || null;
    };

    const zoneOf = (element) => {
        if (!element || element === document.body) return 'outside';
        const seek = seekBar();
        if (seek && seek.contains(element)) return 'seek';
        const row = queryLocal(bar(), 'control-bar-buttons-container');
        if (row && row.contains(element)) return 'buttons';
        const next = popup();
        if (next && next.contains(element)) return 'popup';
        return 'outside';
    };

    // Focus moved by the remote is keyboard focus: the ring of webos/styles/app.less must show it
    // even when the last input was the pointer (the focus-visible polyfill only learns about this
    // key in its document listener, after this one).
    const focus = (element) => {
        if (!element) return false;
        if (element.tabIndex < 0 && !element.hasAttribute('tabindex')) element.tabIndex = 0;
        element.focus();
        if (document.activeElement !== element) return false;
        if (!element.hasAttribute('data-focus-visible-added')) {
            element.classList.add('focus-visible');
            element.setAttribute('data-focus-visible-added', '');
        }
        return true;
    };

    const validButton = (element) => !!element && buttons().indexOf(element) !== -1;
    const playTarget = () => buttons()[0] || seekBar();
    const focusRow = () => focus(validButton(lastButton) ? lastButton : playTarget());

    // Shows the bar (and restarts its 3 s timer) through the Player's mouse move handler.
    const reveal = () => {
        const element = container();
        if (!element) return;
        element.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window }));
    };

    const consume = (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    };

    const togglePaused = () => {
        const props = getProps();
        if (props.paused === true && typeof props.onPlayRequested === 'function') {
            props.onPlayRequested();
            return 'play';
        }
        if (props.paused === false && typeof props.onPauseRequested === 'function') {
            props.onPauseRequested();
            return 'pause';
        }
        return 'none';
    };

    const sendArrow = (type, direction, repeat) => {
        const arrow = ARROW_KEYS[direction];
        const event = new window.KeyboardEvent(type, { key: arrow.key, code: arrow.key, repeat: !!repeat, bubbles: true, cancelable: true });
        // keyCode and which cannot be set through the constructor (listeners that read them).
        ['keyCode', 'which'].forEach((property) => {
            if (event[property] !== arrow.keyCode) {
                Object.defineProperty(event, property, { get: () => arrow.keyCode });
            }
        });
        event[SYNTHETIC] = true;
        document.body.dispatchEvent(event);
    };

    const clearReleaseTimer = () => {
        if (releaseTimer !== null) {
            window.clearTimeout(releaseTimer);
            releaseTimer = null;
        }
    };

    const releaseSeek = () => {
        clearReleaseTimer();
        if (heldSeek === null) return;
        const direction = heldSeek;
        heldSeek = null;
        sendArrow('keyup', direction, false);
    };

    const seekByKey = (direction, repeat) => {
        if (heldSeek !== null && heldSeek !== direction) releaseSeek();
        const seek = seekBar();
        if (seek && isShown(seek)) focus(seek);
        heldSeek = direction;
        sendArrow('keydown', direction, repeat);
        clearReleaseTimer();
        releaseTimer = window.setTimeout(releaseSeek, SEEK_RELEASE_FALLBACK_MS);
    };

    const onMediaKey = (action, event, overlayOpen) => {
        const props = getProps();
        // Holding a key repeats only the seek.
        if (event.repeat && action !== ACTIONS.FAST_FORWARD && action !== ACTIONS.REWIND) return 'repeat';
        switch (action) {
            case ACTIONS.PLAY:
                return props.paused === true ? togglePaused() : 'none';
            case ACTIONS.PAUSE:
                return props.paused === false ? togglePaused() : 'none';
            case ACTIONS.PLAY_PAUSE:
                return togglePaused();
            case ACTIONS.FAST_FORWARD:
            case ACTIONS.REWIND: {
                // An open menu has the arrows (F4.3): the seek waits until it closes. With the next
                // video popup up, the upstream Player turns its keyboard seek off (menusOpen): the
                // seek comes back once the popup is dismissed (Back).
                if (overlayOpen || popup() !== null) return 'none';
                seekByKey(action === ACTIONS.FAST_FORWARD ? 'right' : 'left', event.repeat);
                return 'seek';
            }
            case ACTIONS.STOP:
                stop();
                return 'stop';
            case ACTIONS.NEXT:
                if (props.nextVideo && typeof props.onNextVideoRequested === 'function') {
                    props.onNextVideoRequested();
                    return 'next';
                }
                return 'none';
            default:
                return 'none';
        }
    };

    const moveIn = (list, active, step) => {
        const index = list.indexOf(active);
        const target = list[Math.max(0, Math.min(list.length - 1, (index === -1 ? 0 : index + step)))];
        return target && target !== active ? focus(target) : false;
    };

    const isSeekArrow = (action) => action === ACTIONS.LEFT || action === ACTIONS.RIGHT;
    const isArrow = (action) => isSeekArrow(action) || action === ACTIONS.UP || action === ACTIONS.DOWN;

    // Arrows and OK with no overlay open. Returns what it did; `event` is consumed unless the key
    // goes on to the upstream seek or to the focused button.
    const onNavigationKey = (action, event) => {
        const active = document.activeElement;
        let zone = isHidden() ? 'outside' : zoneOf(active);
        status.zone = zone;
        const next = popup();
        if (zone === 'outside' && next !== null) zone = 'enter-popup';

        switch (zone) {
            case 'enter-popup':
                consume(event);
                focus(popupDefault());
                return 'popup-focus';
            case 'outside':
            case 'seek':
                if (isSeekArrow(action) && next !== null) {
                    // The upstream keyboard seek is off while the next video popup is up (menusOpen).
                    consume(event);
                    return 'none';
                }
                if (isSeekArrow(action)) {
                    // The upstream shortcut seeks; the polyfill must not also move the focus.
                    event.preventDefault();
                    if (zone === 'outside') {
                        const seek = seekBar();
                        if (seek && isShown(seek)) focus(seek);
                    }
                    return 'seek';
                }
                consume(event);
                if (action === ACTIONS.OK) {
                    const result = togglePaused();
                    if (zone === 'outside') focus(playTarget());
                    return result;
                }
                if (zone === 'outside' || action === ACTIONS.DOWN) {
                    focusRow();
                    return 'focus-row';
                }
                // UP from the seek bar: the next video popup when it is up.
                return next !== null && focus(popupDefault()) ? 'popup-focus' : 'stay';
            case 'buttons':
                lastButton = active;
                if (action === ACTIONS.OK) return 'click';
                consume(event);
                if (isSeekArrow(action)) {
                    const moved = moveIn(buttons(), active, action === ACTIONS.LEFT ? -1 : 1);
                    if (moved) lastButton = document.activeElement;
                    return moved ? 'move' : 'stay';
                }
                if (action === ACTIONS.UP) return focus(seekBar()) ? 'focus-seek' : 'stay';
                return 'stay';
            case 'popup':
                if (action === ACTIONS.OK) return 'click';
                consume(event);
                if (isSeekArrow(action)) return moveIn(popupButtons(), active, action === ACTIONS.LEFT ? -1 : 1) ? 'move' : 'stay';
                if (action === ACTIONS.DOWN) return focus(seekBar()) || focusRow() ? 'focus-bar' : 'stay';
                return 'stay';
            default:
                return 'none';
        }
    };

    const onKeyDown = (event) => {
        if (event[SYNTHETIC]) {
            // Fast forward/rewind as arrows: for the upstream shortcuts only.
            event.preventDefault();
            return;
        }
        if (!isActive()) return;
        const action = getAction(event);
        status.key = { key: event.key, code: event.code, keyCode: event.keyCode, repeat: event.repeat, action };
        const overlayOpen = isOverlayOpen();
        if (action === null || isModified(event)) {
            // Any other key shows the bar too (a keyboard's Shift+arrow seeks the upstream way).
            if (!overlayOpen) reveal();
            return;
        }
        status.action = action;
        status.zone = null;
        status.count++;
        if (isMediaAction(action)) {
            consume(event);
            status.result = onMediaKey(action, event, overlayOpen);
        } else if (overlayOpen) {
            // The focus layer of F4.3 (a capture listener registered before this one) prevents the
            // arrows it moves the focus with. The upstream shortcuts on document do not look at that
            // (volume, seek: the Player's menusOpen does not know the context menu), nor would the
            // video behind the menu: those arrows stop here. Arrows F4.3 leaves to the overlay itself
            // (not prevented) go on.
            if (isArrow(action) && event.defaultPrevented) {
                event.stopPropagation();
                event.stopImmediatePropagation();
                status.result = 'overlay-arrow';
                return;
            }
            status.result = 'overlay';
            return;
        } else {
            status.result = onNavigationKey(action, event);
        }
        if (!overlayOpen && status.result !== 'stop') reveal();
    };

    const onKeyUp = (event) => {
        if (event[SYNTHETIC] || !isActive()) return;
        const action = getAction(event);
        if (action === null || isModified(event) || !isMediaAction(action)) return;
        consume(event);
        if (action === ACTIONS.FAST_FORWARD || action === ACTIONS.REWIND) releaseSeek();
    };

    // Back with the bar on screen and the video playing: hide the bar, stay in the Player. Paused,
    // the upstream Player always shows the bar, so Back leaves. Overlays (menus, the next video
    // popup) are closed by the bridge of webos/back, after this handler; Stop goes straight on.
    const onBack = (context) => {
        if (!isActive() || (context && context.source === 'stop')) return false;
        if (isOverlayOpen() || popup() !== null || isHidden()) return false;
        const props = getProps();
        if (props.paused !== false || typeof props.onHideRequested !== 'function') return false;
        releaseSeek();
        props.onHideRequested();
        if (context) context.detail = 'player-controls-hidden';
        return true;
    };

    // The seek bar is a plain div upstream: it needs a tabindex to take the focus.
    const prepare = () => {
        const seek = seekBar();
        if (seek && !seek.hasAttribute('tabindex')) seek.tabIndex = 0;
    };

    // Upstream, the Player never takes the focus: it stays on the element that opened it (the stream
    // of the details page, a poster of the Board) in the route below, and the pages restore from there
    // when the Player closes (F4.1a, F4.1c). The remote moves the focus into the Player, which would
    // leave it on <body> once the Player is gone: on the way out it goes back to that element.
    const restoreEntryFocus = (entry, playerRoot) => {
        if (!entry || !document.body.contains(entry)) return;
        const active = document.activeElement;
        const lost = !active || active === document.body || !document.body.contains(active) ||
            (playerRoot !== null && playerRoot.contains(active));
        if (!lost) return;
        entry.focus();
        // The ring of a remote focus, unless the Magic Remote pointer is in use (webos/magic-remote).
        if (document.activeElement === entry && document.documentElement.getAttribute('data-webos-pointer') !== 'visible' &&
            !entry.hasAttribute('data-focus-visible-added')) {
            entry.classList.add('focus-visible');
            entry.setAttribute('data-focus-visible-added', '');
        }
    };

    const install = () => {
        const playerRoot = container();
        const active = document.activeElement;
        const entry = active && active !== document.body && (playerRoot === null || !playerRoot.contains(active)) ? active : null;
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('keyup', onKeyUp, true);
        return () => {
            releaseSeek();
            window.removeEventListener('keydown', onKeyDown, true);
            window.removeEventListener('keyup', onKeyUp, true);
            restoreEntryFocus(entry, playerRoot);
        };
    };

    return {
        install,
        prepare,
        onKeyDown,
        onKeyUp,
        onBack,
        isHidden,
        status,
    };
};

module.exports = {
    SYNTHETIC,
    SEEK_RELEASE_FALLBACK_MS,
    createPlayerRemote,
    hasLocalClass,
};

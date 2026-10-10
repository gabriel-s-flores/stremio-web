// Magic Remote on webOS TV: pointer mode and 5-way (arrow) mode, switched by webOS through the
// `cursorStateChange` event (event.detail.visibility). Measured in the emulator: the first arrow
// while the pointer shows fires cursorStateChange {visibility: false}, then keydown 1537 and the
// arrow keydown itself (it navigates); moving the remote again fires {visibility: true}, keydown 1536
// and only then the mouseout/mouseover. No mouse event comes while the pointer is hidden.
//
// When the pointer hides:
//   - the hover highlight of the posters goes away: a pointerout leaving the page ends react-aria's
//     useHover (.hovered). The CSS :hover rules are left alone: Chromium keeps :hover frozen on the
//     last element while webOS hides the cursor (no fake mouse move, no re-hit-test), and every way
//     to switch the rules off cost too much or changed the upstream cascade (F4.2 report: CSSOM
//     restyles the page for 0.15-1.5 s per switch in the C8 profile; an attribute gate in the build
//     raises their specificity over :focus/.active rules);
//   - the focus goes to the focusable element under the last pointer position, so the arrow that
//     hid the pointer moves on from the item the user was pointing at (the spatial navigation
//     starts from document.activeElement).
// When it shows, the first mouse move enters the element under the pointer again (Chromium sends no
// mouseover when the pointer comes back over the same element).
// <html data-webos-pointer="hidden|visible"> tells the current mode (diagnostics and tests).
// Installed by webos/polyfills/index.js, after the Pointer Events polyfill.

import { MOUSE_POINTER_ID } from '../polyfills/pointer-events';

export const MODE_ATTRIBUTE = 'data-webos-pointer';

const isFocusable = (element) => element.tabIndex >= 0 && !element.disabled && !element.hasAttribute('disabled');

export const closestFocusable = (element, root) => {
    for (let node = element; node && node !== root && node.nodeType === 1; node = node.parentNode) {
        if (isFocusable(node)) return node;
    }
    return null;
};

const pointerInit = (position, relatedTarget) => ({
    bubbles: true,
    cancelable: true,
    clientX: position.x,
    clientY: position.y,
    button: -1,
    buttons: 0,
    relatedTarget,
    pointerId: MOUSE_POINTER_ID,
    pointerType: 'mouse',
    isPrimary: true,
});

export const install = (window, document = window.document) => {
    const root = document.documentElement;
    let visible = true;
    let reenter = false;
    let last = null;

    const show = () => {
        visible = true;
        reenter = true;
        root.setAttribute(MODE_ATTRIBUTE, 'visible');
    };

    const onMouseEvent = (event) => {
        if (!event.isTrusted) return;
        // A mouse move while hidden (none was seen in the emulator): the pointer is back.
        if (!visible && event.type === 'mousemove') show();
        last = { x: event.clientX, y: event.clientY, target: event.target };
        if (!reenter) return;
        reenter = false;
        // A mouseover after the pointer came back already entered the new element.
        if (event.type === 'mousemove' && typeof event.target.dispatchEvent === 'function') {
            event.target.dispatchEvent(new window.PointerEvent('pointerover', pointerInit(last, null)));
        }
    };

    const hide = () => {
        visible = false;
        reenter = false;
        root.setAttribute(MODE_ATTRIBUTE, 'hidden');
        if (last === null) return;
        if (last.target && typeof last.target.dispatchEvent === 'function') {
            last.target.dispatchEvent(new window.PointerEvent('pointerout', pointerInit(last, null)));
        }
        const under = document.elementFromPoint(last.x, last.y) || last.target;
        const focusable = under ? closestFocusable(under, document.body) : null;
        if (focusable && !focusable.contains(document.activeElement)) {
            focusable.focus();
        }
    };

    document.addEventListener('cursorStateChange', (event) => {
        const visibility = event.detail && event.detail.visibility;
        if (visibility === false && visible) hide();
        else if (visibility === true && !visible) show();
    });
    window.addEventListener('mousemove', onMouseEvent, true);
    window.addEventListener('mouseover', onMouseEvent, true);
    window.addEventListener('mousedown', onMouseEvent, true);

    return {
        get visible() {
            return visible;
        },
    };
};

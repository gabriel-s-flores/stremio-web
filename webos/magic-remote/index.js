// Magic Remote on webOS TV: pointer mode and 5-way (arrow) mode, switched by webOS through the
// `cursorStateChange` event (event.detail.visibility). Measured in the emulator: the first arrow
// while the pointer shows fires cursorStateChange {visibility: false}, then keydown 1537 and the
// arrow keydown itself (it navigates); moving the remote again fires {visibility: true}, keydown 1536
// and only then the mouseout/mouseover. No mouse event comes while the pointer is hidden.
//
// When the pointer hides:
//   - the hover highlight goes away. A pointerout leaving the page ends react-aria's useHover
//     (.hovered on the posters) at once. Chromium 53 keeps :hover on the last element under the
//     pointer and only moves it on a mouse move, real or "fake" (it sends one after a scroll), so a
//     4x4 px transparent element (the sink) goes under the last pointer position and scrolls itself
//     a frame later: Chromium hit-tests again, moves :hover to the sink and sends a trusted
//     mouseout/mouseover. Only the hovered chain is restyled (switching the CSS rules off instead
//     made Chromium restyle the whole page: 0.4-1.5 s per switch in the C8 profile). The spatial
//     navigation counts a candidate as visible when any of three points hits it, so 4 px never
//     hides one;
//   - the focus goes to the focusable element under the last pointer position, so the arrow that
//     hid the pointer moves on from the item the user was pointing at (the spatial navigation
//     starts from document.activeElement).
// When it shows, the sink goes away (Chromium puts :hover back on the element under the pointer,
// without events) and the first mouse move enters that element again for react-aria.
// <html data-webos-pointer="hidden|visible"> tells the current mode (diagnostics and tests).
// Installed by webos/polyfills/index.js, after the Pointer Events polyfill.

import { MOUSE_POINTER_ID } from '../polyfills/pointer-events';

export const MODE_ATTRIBUTE = 'data-webos-pointer';

const SINK_SIZE = 4;

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

// Positioned UI uses CSS pixels; pointer coordinates include the interface zoom (on <html>).
const interfaceScale = (window, document) => {
    const scale = parseFloat(window.getComputedStyle(document.documentElement).getPropertyValue('--interface-scale'));
    return scale > 0 ? scale : 1;
};

export const createSink = (document) => {
    const sink = document.createElement('div');
    sink.setAttribute('aria-hidden', 'true');
    sink.style.cssText = `position:fixed;width:${SINK_SIZE}px;height:${SINK_SIZE}px;overflow:hidden;opacity:0;z-index:2147483647`;
    const content = document.createElement('div');
    content.style.cssText = `height:${SINK_SIZE * 2}px`;
    sink.appendChild(content);
    return sink;
};

export const install = (window, document = window.document, requestFrame = window.requestAnimationFrame.bind(window)) => {
    const root = document.documentElement;
    const sink = createSink(document);
    let visible = true;
    let reenter = false;
    let last = null;

    const removeSink = () => {
        if (sink.parentNode) sink.parentNode.removeChild(sink);
    };

    const show = () => {
        visible = true;
        reenter = true;
        root.setAttribute(MODE_ATTRIBUTE, 'visible');
        removeSink();
    };

    const onMouseEvent = (event) => {
        if (!event.isTrusted || event.target === sink) return;
        // A real move while hidden (the fake one repeats the last position): the pointer is back.
        if (!visible && event.type === 'mousemove' && last && (event.clientX !== last.x || event.clientY !== last.y)) show();
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
        const scale = interfaceScale(window, document);
        sink.style.left = `${last.x / scale - SINK_SIZE / 2}px`;
        sink.style.top = `${last.y / scale - SINK_SIZE / 2}px`;
        document.body.appendChild(sink);
        // A scroll in the same task as the insertion moves nothing (measured): wait for the sink to be laid out.
        requestFrame(() => requestFrame(() => {
            if (!visible && sink.parentNode) sink.scrollTop = sink.scrollTop > 0 ? 0 : 1;
        }));
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
        sink,
    };
};

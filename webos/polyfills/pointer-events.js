// Pointer Events for webOS TV 4.x (Chromium 53; native since 55). The Magic Remote pointer reaches
// the page as a mouse, but the upstream code listens to pointer events: react-aria's useHover (the
// poster highlight) only hooks up when PointerEvent exists, and the Popup, Scale, Button
// (use-long-press), the Video and Stream menus and the LiveTV schedule listen to pointerdown/up/move.
// Each trusted mouse event gets its pointer twin, dispatched on the same target just before it (a
// window capture listener), with pointerType 'mouse', pointerId 1 and isPrimary, as a browser with
// Pointer Events does for a mouse. Not emulated: touch (the TV has none), pointer capture and
// cancelling pointerdown to suppress the mouse events (the bundle uses neither). Page only.

const MOUSE_TO_POINTER = {
    mousedown: 'pointerdown',
    mouseup: 'pointerup',
    mousemove: 'pointermove',
    mouseover: 'pointerover',
    mouseout: 'pointerout',
    mouseenter: 'pointerenter',
    mouseleave: 'pointerleave',
};

const BOUNDARY = { pointerenter: true, pointerleave: true };

// pointerdown/up report the button that changed; the other pointer events report none (-1).
const BUTTON_EVENTS = { pointerdown: true, pointerup: true };

export const MOUSE_POINTER_ID = 1;

const pointerDefaults = (init) => ({
    pointerId: MOUSE_POINTER_ID,
    width: 1,
    height: 1,
    pressure: init.buttons ? 0.5 : 0,
    tangentialPressure: 0,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerType: 'mouse',
    isPrimary: true,
});

// A MouseEvent with the PointerEvent fields and prototype: the MouseEvent getters keep working
// (they check the native event, not the prototype) and `instanceof MouseEvent` still holds.
const createPointerEventClass = (global) => {
    function PointerEvent(type, init = {}) {
        const event = new global.MouseEvent(type, init);
        Object.setPrototypeOf(event, PointerEvent.prototype);
        const defaults = pointerDefaults(init);
        Object.keys(defaults).forEach((key) => {
            Object.defineProperty(event, key, {
                value: init[key] === undefined ? defaults[key] : init[key],
                enumerable: true,
                configurable: true,
            });
        });
        return event;
    }
    PointerEvent.prototype = Object.create(global.MouseEvent.prototype, {
        constructor: { value: PointerEvent, writable: true, configurable: true },
    });
    return PointerEvent;
};

export const toPointerInit = (type, event) => ({
    bubbles: !BOUNDARY[type],
    cancelable: !BOUNDARY[type],
    view: event.view,
    screenX: event.screenX,
    screenY: event.screenY,
    clientX: event.clientX,
    clientY: event.clientY,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
    button: BUTTON_EVENTS[type] ? event.button : -1,
    buttons: event.buttons,
    relatedTarget: event.relatedTarget || null,
});

export const install = (global) => {
    if (typeof global.PointerEvent === 'function' || typeof global.MouseEvent !== 'function') {
        return false;
    }
    Object.defineProperty(global, 'PointerEvent', {
        value: createPointerEventClass(global),
        writable: true,
        configurable: true,
        enumerable: false,
    });
    const onMouseEvent = (event) => {
        // Synthetic mouse events (element.click(), dispatchEvent) get no pointer events, as natively.
        if (!event.isTrusted || !event.target || typeof event.target.dispatchEvent !== 'function') {
            return;
        }
        const type = MOUSE_TO_POINTER[event.type];
        event.target.dispatchEvent(new global.PointerEvent(type, toPointerInit(type, event)));
    };
    Object.keys(MOUSE_TO_POINTER).forEach((type) => {
        global.addEventListener(type, onMouseEvent, true);
    });
    return true;
};

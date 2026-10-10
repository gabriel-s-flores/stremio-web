const fs = require('fs');
const path = require('path');
const { install, MOUSE_POINTER_ID } = require('../../polyfills/pointer-events');

// Minimal MouseEvent over Node's Event: what the polyfill reads and builds. Real behaviour is
// checked in the emulator (Chromium 53) by the F4.2 probe.
class FakeMouseEvent extends Event {
    constructor(type, init = {}) {
        super(type, init);
        ['view', 'screenX', 'screenY', 'clientX', 'clientY', 'ctrlKey', 'shiftKey', 'altKey', 'metaKey', 'button', 'buttons', 'relatedTarget']
            .forEach((key) => {
                Object.defineProperty(this, key, { value: init[key] === undefined ? null : init[key], enumerable: true });
            });
    }
}

const createGlobal = () => {
    const listeners = {};
    return {
        MouseEvent: FakeMouseEvent,
        listeners,
        addEventListener(type, listener, capture) {
            listeners[type] = { listener, capture };
        },
    };
};

class Target extends EventTarget {
    constructor() {
        super();
        this.dispatched = [];
    }
    dispatchEvent(event) {
        this.dispatched.push(event);
        return super.dispatchEvent(event);
    }
}

const mouse = (type, target, extra = {}) => ({
    type,
    target,
    isTrusted: true,
    view: null,
    screenX: 110,
    screenY: 220,
    clientX: 10,
    clientY: 20,
    ctrlKey: false,
    shiftKey: true,
    altKey: false,
    metaKey: false,
    button: 0,
    buttons: 0,
    relatedTarget: null,
    ...extra,
});

describe('Pointer Events polyfill', () => {
    test('installs PointerEvent only where it is missing', () => {
        const global = createGlobal();
        expect(install(global)).toBe(true);
        expect(typeof global.PointerEvent).toBe('function');

        const native = function PointerEvent() {};
        const withNative = { ...createGlobal(), PointerEvent: native };
        expect(install(withNative)).toBe(false);
        expect(withNative.PointerEvent).toBe(native);
        expect(Object.keys(withNative.listeners)).toEqual([]);

        expect(install({ addEventListener() {} })).toBe(false);
    });

    test('PointerEvent is a MouseEvent with the mouse pointer fields', () => {
        const global = createGlobal();
        install(global);
        const event = new global.PointerEvent('pointerdown', { bubbles: true, clientX: 5, buttons: 1 });
        expect(event).toBeInstanceOf(global.PointerEvent);
        expect(event).toBeInstanceOf(FakeMouseEvent);
        expect(event).toMatchObject({
            type: 'pointerdown',
            bubbles: true,
            clientX: 5,
            pointerId: MOUSE_POINTER_ID,
            pointerType: 'mouse',
            isPrimary: true,
            width: 1,
            height: 1,
            pressure: 0.5,
            tiltX: 0,
            tiltY: 0,
            twist: 0,
        });
        expect(new global.PointerEvent('pointermove').pressure).toBe(0);
        expect(new global.PointerEvent('pointerdown', { pointerType: 'pen', pointerId: 7 })).toMatchObject({ pointerType: 'pen', pointerId: 7 });
        expect(() => {
            'use strict';
            event.pointerType = 'touch';
        }).toThrow(TypeError);
    });

    test('toElement and fromElement follow the mouse event of the same kind (React reads them)', () => {
        const global = createGlobal();
        install(global);
        const target = new Target();
        const related = new Target();
        // React's EnterLeaveEventPlugin: `to` of an out event, `related` of an over event.
        const reactTo = (event) => event.relatedTarget || event.toElement;
        const reactFrom = (event) => event.relatedTarget || event.fromElement;

        const leaving = new global.PointerEvent('pointerout', { bubbles: true, relatedTarget: null });
        target.dispatchEvent(leaving);
        expect(reactTo(leaving)).toBe(null);
        expect(leaving.fromElement).toBe(target);

        const entering = new global.PointerEvent('pointerover', { bubbles: true, relatedTarget: null });
        target.dispatchEvent(entering);
        expect(reactFrom(entering)).toBe(null);
        expect(entering.toElement).toBe(target);

        const moving = new global.PointerEvent('pointerout', { relatedTarget: related });
        target.dispatchEvent(moving);
        expect(reactTo(moving)).toBe(related);
        expect(new global.PointerEvent('pointerleave').toElement).toBe(null);
        const down = new global.PointerEvent('pointerdown');
        target.dispatchEvent(down);
        expect([down.toElement, down.fromElement]).toEqual([target, target]);
    });

    test('listens to every mouse event in the capture phase of the window', () => {
        const global = createGlobal();
        install(global);
        expect(Object.keys(global.listeners).sort()).toEqual(['mousedown', 'mouseenter', 'mouseleave', 'mousemove', 'mouseout', 'mouseover', 'mouseup']);
        Object.values(global.listeners).forEach(({ capture }) => expect(capture).toBe(true));
    });

    test.each([
        ['mousedown', 'pointerdown', true, 0],
        ['mouseup', 'pointerup', true, 0],
        ['mousemove', 'pointermove', true, -1],
        ['mouseover', 'pointerover', true, -1],
        ['mouseout', 'pointerout', true, -1],
        ['mouseenter', 'pointerenter', false, -1],
        ['mouseleave', 'pointerleave', false, -1],
    ])('%s dispatches %s on the same target', (mouseType, pointerType, bubbles, button) => {
        const global = createGlobal();
        install(global);
        const target = new Target();
        const related = new Target();
        global.listeners[mouseType].listener(mouse(mouseType, target, { relatedTarget: related }));
        expect(target.dispatched).toHaveLength(1);
        const [event] = target.dispatched;
        expect(event).toBeInstanceOf(global.PointerEvent);
        expect(event).toMatchObject({
            type: pointerType,
            bubbles,
            cancelable: bubbles,
            clientX: 10,
            clientY: 20,
            screenX: 110,
            screenY: 220,
            shiftKey: true,
            button,
            relatedTarget: related,
            pointerType: 'mouse',
            pointerId: MOUSE_POINTER_ID,
            isPrimary: true,
        });
    });

    test('a pressed button is reported by pointerdown, buttons and pressure', () => {
        const global = createGlobal();
        install(global);
        const target = new Target();
        global.listeners.mousedown.listener(mouse('mousedown', target, { button: 2, buttons: 2 }));
        expect(target.dispatched[0]).toMatchObject({ button: 2, buttons: 2, pressure: 0.5 });
    });

    test('synthetic mouse events and targets without dispatchEvent get no pointer event', () => {
        const global = createGlobal();
        install(global);
        const target = new Target();
        global.listeners.mousedown.listener(mouse('mousedown', target, { isTrusted: false }));
        expect(target.dispatched).toHaveLength(0);
        expect(() => global.listeners.mousemove.listener(mouse('mousemove', null))).not.toThrow();
        expect(() => global.listeners.mousemove.listener(mouse('mousemove', {}))).not.toThrow();
    });

    test('listeners on the target receive the pointer event', () => {
        const global = createGlobal();
        install(global);
        const target = new Target();
        const received = [];
        target.addEventListener('pointerover', (event) => received.push([event.type, event.pointerType]));
        global.listeners.mouseover.listener(mouse('mouseover', target));
        expect(received).toEqual([['pointerover', 'mouse']]);
    });

    test('is installed by the page polyfills, before the Magic Remote module', () => {
        const index = fs.readFileSync(path.join(__dirname, '..', '..', 'polyfills', 'index.js'), 'utf8');
        expect(index).toContain("from './pointer-events'");
        expect(index).toContain("from '../magic-remote'");
        expect(index.indexOf('installPointerEvents(self);')).toBeGreaterThan(-1);
        expect(index.indexOf('installPointerEvents(self);')).toBeLessThan(index.indexOf('installMagicRemote(self);'));
    });
});

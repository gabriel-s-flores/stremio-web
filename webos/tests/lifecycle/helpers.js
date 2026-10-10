// Minimal DOM stand-ins for the lifecycle tests (jest runs in node: no jsdom).

class FakeTarget {
    constructor() {
        this.listeners = {};
    }

    addEventListener(type, listener, capture) {
        (this.listeners[type] = this.listeners[type] || []).push({ listener, capture: !!capture });
    }

    removeEventListener(type, listener, capture) {
        this.listeners[type] = (this.listeners[type] || []).filter((entry) => !(entry.listener === listener && entry.capture === !!capture));
    }

    listenerCount(type) {
        return (this.listeners[type] || []).length;
    }

    dispatch(type, event = {}) {
        (this.listeners[type] || []).slice().forEach(({ listener }) => listener({ type, target: this, ...event }));
    }
}

class FakeElement extends FakeTarget {
    constructor(tagName = 'div', parent = null) {
        super();
        this.tagName = tagName.toUpperCase();
        this.parentElement = parent;
        this.className = '';
        this.id = '';
        this.scrollTop = 0;
        this.scrollLeft = 0;
        this.paused = true;
        this.ended = false;
        this.focusCalls = 0;
        this.document = null;
    }

    focus() {
        this.focusCalls += 1;
        if (this.document) {
            this.document.activeElement = this;
        }
    }

    pause() {
        this.paused = true;
        this.dispatch('pause');
    }

    play() {
        this.paused = false;
        // media events do not bubble: the document sees them in the capture phase
        if (this.document) {
            this.document.listeners.play && this.document.listeners.play.filter((entry) => entry.capture).forEach(({ listener }) => listener({ type: 'play', target: this }));
        }
    }
}

const createWindow = ({ hash = '#/', hidden = false } = {}) => {
    const win = new FakeTarget();
    const doc = new FakeTarget();
    const attached = new Set();
    const body = new FakeElement('body');
    const root = new FakeElement('html');
    root.contains = (element) => element === root || element === body || attached.has(element);
    doc.documentElement = root;
    doc.body = body;
    doc.activeElement = body;
    doc.hidden = hidden;
    doc.media = [];
    doc.hasFocusValue = true;
    doc.hasFocus = () => doc.hasFocusValue;
    doc.querySelectorAll = (selector) => (selector === 'video, audio' ? doc.media.slice() : []);
    doc.create = (tagName, parent = null) => {
        const element = new FakeElement(tagName, parent);
        element.document = doc;
        attached.add(element);
        if (/^(video|audio)$/i.test(tagName)) {
            doc.media.push(element);
        }
        return element;
    };
    doc.detach = (element) => attached.delete(element);
    win.document = doc;
    win.location = { hash };
    win.focusCalls = 0;
    win.focus = () => {
        win.focusCalls += 1;
        doc.hasFocusValue = true;
        win.dispatch('focus');
    };
    // Manual clock: win.advance(ms) runs the timers that are due.
    let clock = 0;
    let timerId = 0;
    const timers = new Map();
    win.setTimeout = (callback, delay) => {
        timerId += 1;
        timers.set(timerId, { callback, at: clock + delay });
        return timerId;
    };
    win.clearTimeout = (id) => timers.delete(id);
    win.advance = (ms) => {
        clock += ms;
        Array.from(timers.entries()).filter(([, timer]) => timer.at <= clock).forEach(([id, timer]) => {
            timers.delete(id);
            timer.callback();
        });
    };
    win.pendingTimers = () => timers.size;
    win.PalmSystem = { activateCalls: 0, launchParams: '{}', activate() { this.activateCalls += 1; } };
    return win;
};

module.exports = { FakeTarget, FakeElement, createWindow };

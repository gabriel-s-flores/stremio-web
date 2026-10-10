// Diagnostics registry (F3.6): the only part of the diagnostics screen that is loaded at boot.
// Everything else (collector, formatting, the screen) is a lazy chunk opened by the route, so this
// file stays small and does no work besides storing a few timestamps and holding the section list.

const defaultNow = () => (
    typeof performance === 'object' && performance && typeof performance.now === 'function' ? performance.now() : Date.now()
);
const round = (ms) => Math.round(ms * 10) / 10;

// Boot marks: milliseconds on the page's performance timeline (the clock of the F1.4 "core
// pronto" definition). The first call of a name wins.
let marks = {};
let observerStats = { callbacks: 0, ms: 0 };
// Extra sections, for modules that own their own state (the certificate proxy of F3.7 registers
// here). `collect()` returns a JSON-friendly object or a promise of one; it runs only when the
// screen collects a report.
let sections = [];

const mark = (name, at) => {
    if (!Object.prototype.hasOwnProperty.call(marks, name)) marks[name] = typeof at === 'number' ? at : defaultNow();
    return marks[name];
};

const getMarks = () => Object.keys(marks).reduce((copy, name) => {
    copy[name] = round(marks[name]);
    return copy;
}, {});

// The cost of the measuring itself, shown on the screen next to the marks.
const getObserverStats = () => ({ callbacks: observerStats.callbacks, ms: round(observerStats.ms) });

// Marks `name` the first time `selector` matches inside `root`, then stops looking. It is one
// MutationObserver on the Board's route container: each callback is one querySelector, and the
// observer disconnects at the first hit. Returns a function that stops it earlier.
const markWhenFound = (root, selector, name, options) => {
    const settings = options || {};
    const Observer = settings.MutationObserver || (typeof MutationObserver === 'function' ? MutationObserver : null);
    const now = settings.now || defaultNow;
    if (!root || !Observer || Object.prototype.hasOwnProperty.call(marks, name)) return () => {};
    let observer = null;
    const stop = () => {
        if (observer) observer.disconnect();
        observer = null;
    };
    const check = () => {
        const start = now();
        const found = !!root.querySelector(selector);
        if (found) {
            mark(name, now());
            stop();
        }
        observerStats.callbacks += 1;
        observerStats.ms += now() - start;
        return found;
    };
    if (check()) return stop;
    observer = new Observer(check);
    observer.observe(root, { childList: true, subtree: true });
    return stop;
};

const registerSection = (id, title, collect) => {
    sections = sections.filter((section) => section.id !== id);
    sections.push({ id, title, collect });
};

const getSections = () => sections.slice();

const reset = () => {
    marks = {};
    observerStats = { callbacks: 0, ms: 0 };
    sections = [];
};

module.exports = {
    mark,
    getMarks,
    getObserverStats,
    markWhenFound,
    registerSection,
    getSections,
    reset,
};

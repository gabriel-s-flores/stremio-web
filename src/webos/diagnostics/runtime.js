// Copyright (C) 2017-2026 Smart code 203358507

const GLOBAL_KEY = '__stremioWebosDebug';
const FPS_DURATION = 10000;

const state = {
    started: false,
    marks: {},
    memory: {
        current: null,
        peak: null,
    },
    fps: {
        running: false,
        durationMs: 0,
        frames: 0,
        averageFps: null,
        p95FrameMs: null,
        scrollEvents: 0,
    },
    player: {
        implementation: null,
        history: [],
    },
};

const subscribers = [];
let fpsFrameId = null;
let fpsScrollElement = null;
let fpsScrollListener = null;

const notify = () => {
    subscribers.slice().forEach((listener) => listener());
};

const getPerformance = () => {
    return typeof performance === 'undefined' ? null : performance;
};

const getDocument = () => {
    return typeof document === 'undefined' ? null : document;
};

const getWindow = () => {
    return typeof window === 'undefined' ? null : window;
};

const timestamp = () => {
    const currentPerformance = getPerformance();
    return currentPerformance && typeof currentPerformance.now === 'function' ?
        currentPerformance.now() :
        Date.now();
};

const mark = (name) => {
    if (typeof state.marks[name] !== 'number') {
        state.marks[name] = timestamp();
    }

    const currentPerformance = getPerformance();
    if (currentPerformance && typeof currentPerformance.mark === 'function') {
        try {
            currentPerformance.mark(`stremio:webos:${name}`);
        } catch (_error) {
            // Older WebKit builds can reject mark names; the local snapshot remains usable.
        }
    }
};

const recordMark = (name) => {
    if (typeof name !== 'string' || name.length === 0) {
        return;
    }

    mark(name);
    notify();
};

const recordPlayerImplementation = (name) => {
    if (typeof name !== 'string' || name.length === 0) {
        return;
    }

    state.player.implementation = name;
    if (state.player.history[state.player.history.length - 1] !== name) {
        state.player.history.push(name);
    }
    notify();
};

const getMemory = () => {
    const currentPerformance = getPerformance();
    if (!currentPerformance) {
        return null;
    }

    try {
        return currentPerformance.memory || null;
    } catch (_error) {
        return null;
    }
};

const readMemory = () => {
    const memory = getMemory();

    try {
        if (!memory || typeof memory.usedJSHeapSize !== 'number') {
            return null;
        }

        return {
            usedJSHeapSize: memory.usedJSHeapSize,
            totalJSHeapSize: memory.totalJSHeapSize,
            jsHeapSizeLimit: memory.jsHeapSizeLimit,
            sampledAt: timestamp(),
        };
    } catch (_error) {
        return null;
    }
};

const sampleMemory = () => {
    const current = readMemory();
    state.memory.current = current;
    if (current && (!state.memory.peak || current.usedJSHeapSize > state.memory.peak.usedJSHeapSize)) {
        state.memory.peak = current;
    }
};

const readPaints = () => {
    const currentPerformance = getPerformance();
    if (!currentPerformance || typeof currentPerformance.getEntriesByType !== 'function') {
        return {};
    }

    return currentPerformance.getEntriesByType('paint').reduce((result, entry) => {
        result[entry.name] = entry.startTime;
        return result;
    }, {});
};

const readNavigation = () => {
    const currentPerformance = getPerformance();
    const timing = currentPerformance && currentPerformance.timing;
    if (!timing || typeof timing.navigationStart !== 'number') {
        return null;
    }

    return {
        navigationStart: timing.navigationStart,
        domInteractive: timing.domInteractive - timing.navigationStart,
        domContentLoaded: timing.domContentLoadedEventEnd - timing.navigationStart,
        load: timing.loadEventEnd - timing.navigationStart,
    };
};

const findBoard = () => {
    const currentDocument = getDocument();
    return currentDocument ? currentDocument.querySelector('[class*="board-container"]') : null;
};

const hasFocusableElement = (container) => {
    if (!container) {
        return false;
    }

    return !!container.querySelector('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
};

const findBoardScrollElement = () => {
    const board = findBoard();
    if (!board) {
        return null;
    }

    const elements = board.querySelectorAll('div');
    for (const element of Array.from(elements)) {
        if (element.scrollHeight > element.clientHeight && element.clientHeight > 0) {
            return element;
        }
    }

    return null;
};

const inspect = () => {
    const currentDocument = getDocument();
    const currentWindow = getWindow();
    const app = currentDocument && currentDocument.getElementById('app');

    if (app && app.childNodes.length > 0) {
        mark('app-render');
    }

    if (currentWindow && currentWindow.core) {
        mark('core-ready');
    }

    const board = findBoard();
    if (board) {
        mark('board-visible');
        if (hasFocusableElement(board)) {
            mark('board-interactive');
        }
    }

    sampleMemory();
};

const percentile = (values, percentage) => {
    if (values.length === 0) {
        return null;
    }

    const sorted = values.slice().sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percentage) - 1);
    return sorted[index];
};

const cleanupFps = () => {
    if (fpsFrameId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(fpsFrameId);
    }
    fpsFrameId = null;

    if (fpsScrollElement && fpsScrollListener) {
        fpsScrollElement.removeEventListener('scroll', fpsScrollListener);
    }
    fpsScrollElement = null;
    fpsScrollListener = null;
};

const stopFps = () => {
    if (!state.fps.running) {
        return;
    }

    cleanupFps();
    state.fps.running = false;
    notify();
};

const startFps = (durationMs = FPS_DURATION) => {
    if (state.fps.running || typeof requestAnimationFrame !== 'function') {
        return false;
    }

    const scrollElement = findBoardScrollElement();
    if (!scrollElement) {
        return false;
    }

    const frameDurations = [];
    const startedAt = timestamp();
    let previousFrame = null;

    state.fps = {
        running: true,
        durationMs,
        frames: 0,
        averageFps: null,
        p95FrameMs: null,
        scrollEvents: 0,
    };
    fpsScrollElement = scrollElement;
    fpsScrollListener = () => {
        state.fps.scrollEvents += 1;
    };
    scrollElement.addEventListener('scroll', fpsScrollListener);

    const finish = () => {
        const elapsed = Math.max(1, timestamp() - startedAt);
        const scrollEvents = state.fps.scrollEvents;
        state.fps = {
            running: false,
            durationMs: elapsed,
            frames: frameDurations.length,
            averageFps: frameDurations.length * 1000 / elapsed,
            p95FrameMs: percentile(frameDurations, 0.95),
            scrollEvents,
        };
        cleanupFps();
        notify();
    };

    const onFrame = (frameTime) => {
        if (previousFrame !== null) {
            frameDurations.push(frameTime - previousFrame);
        }
        previousFrame = frameTime;
        state.fps.frames = frameDurations.length;
        sampleMemory();

        if (timestamp() - startedAt >= durationMs) {
            finish();
        } else {
            fpsFrameId = requestAnimationFrame(onFrame);
        }
    };

    fpsFrameId = requestAnimationFrame(onFrame);
    notify();
    return true;
};

const getSnapshot = () => {
    const currentWindow = getWindow();
    const currentDocument = getDocument();
    const memory = readMemory();

    return {
        environment: {
            userAgent: currentWindow && currentWindow.navigator ? currentWindow.navigator.userAgent : null,
            origin: currentWindow && currentWindow.location ? currentWindow.location.origin : null,
            protocol: currentWindow && currentWindow.location ? currentWindow.location.protocol : null,
            href: currentWindow && currentWindow.location ? currentWindow.location.href : null,
            viewport: currentWindow ? {
                width: currentWindow.innerWidth,
                height: currentWindow.innerHeight,
                devicePixelRatio: currentWindow.devicePixelRatio,
            } : null,
            documentVisibility: currentDocument ? currentDocument.visibilityState : null,
            version: process.env.VERSION || null,
            commit: process.env.COMMIT_HASH || null,
            performanceMemoryAvailable: memory !== null,
        },
        marks: { ...state.marks },
        paints: readPaints(),
        navigation: readNavigation(),
        memory: {
            current: state.memory.current,
            peak: state.memory.peak,
        },
        fps: { ...state.fps },
        player: {
            implementation: state.player.implementation,
            history: state.player.history.slice(),
        },
        capturedAt: new Date().toISOString(),
    };
};

const subscribe = (listener) => {
    subscribers.push(listener);
    return () => {
        const index = subscribers.indexOf(listener);
        if (index !== -1) {
            subscribers.splice(index, 1);
        }
    };
};

const start = () => {
    if (state.started || !getDocument()) {
        return;
    }

    state.started = true;
    mark('entry');
    inspect();

    const currentDocument = getDocument();
    if (typeof MutationObserver === 'function') {
        const observer = new MutationObserver(inspect);
        observer.observe(currentDocument.documentElement, {
            childList: true,
            subtree: true,
        });
    }

    setInterval(inspect, 250);
    setInterval(() => {
        sampleMemory();
        notify();
    }, 1000);

    const currentWindow = getWindow();
    if (currentWindow) {
        currentWindow[GLOBAL_KEY] = {
            getSnapshot,
            refresh: () => {
                inspect();
                notify();
                return getSnapshot();
            },
            mark: recordMark,
            recordPlayerImplementation,
            startFps,
            stopFps,
            subscribe,
        };
    }
};

module.exports = {
    getSnapshot,
    mark: recordMark,
    recordPlayerImplementation,
    start,
    startFps,
    stopFps,
    subscribe,
};

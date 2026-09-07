const diagnostics = require('../src/webos/diagnostics/runtime');

const originalPerformance = Object.getOwnPropertyDescriptor(global, 'performance');

const setPerformance = (value) => {
    Object.defineProperty(global, 'performance', {
        configurable: true,
        value,
    });
};

afterEach(() => {
    if (originalPerformance) {
        Object.defineProperty(global, 'performance', originalPerformance);
    } else {
        delete global.performance;
    }
});

describe('webOS diagnostics runtime', () => {
    test('returns a safe snapshot when browser memory is unavailable', () => {
        const snapshot = diagnostics.getSnapshot();

        expect(snapshot.memory.current).toBe(null);
        expect(snapshot.memory.peak).toBe(null);
        expect(snapshot.fps.running).toBe(false);
        expect(snapshot.environment.performanceMemoryAvailable).toBe(false);
    });

    test('does not start FPS sampling without a board scroll container', () => {
        expect(diagnostics.startFps()).toBe(false);
    });

    test('can be started safely outside a browser document', () => {
        expect(() => diagnostics.start()).not.toThrow();
    });

    test('records custom boot marks for the UI smoke', () => {
        diagnostics.mark('t17-test-mark');

        expect(diagnostics.getSnapshot().marks['t17-test-mark']).toEqual(expect.any(Number));
    });

    test('treats a throwing performance.memory accessor as unavailable', () => {
        setPerformance({
            get memory() {
                throw new Error('memory blocked');
            }
        });

        const snapshot = diagnostics.getSnapshot();

        expect(snapshot.memory.current).toBe(null);
        expect(snapshot.environment.performanceMemoryAvailable).toBe(false);
    });

    test('treats malformed performance.memory data as unavailable', () => {
        setPerformance({
            memory: {
                usedJSHeapSize: 'unknown',
            }
        });

        const snapshot = diagnostics.getSnapshot();

        expect(snapshot.memory.current).toBe(null);
        expect(snapshot.environment.performanceMemoryAvailable).toBe(false);
    });
});

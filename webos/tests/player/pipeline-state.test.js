/* global describe, it, expect */
// pipeline-state.js against thread samples measured in the emulator (F5.6, 2026-10-10): a pipeline
// that plays and a wedged one, each read twice one second apart.

const { parseSnapshot, classify } = require('./pipeline-state');

const snapshot = (pid, rssKb, threads) => ['P ' + pid + ' ' + rssKb]
    .concat(threads.map(([comm, state, utime, stime, vcs]) => ['T', pid, state, utime, stime, vcs, comm].join(' ')))
    .join('\n');

// Shared threads of starfish-media-pipeline (main, tLibSystrim, source, queues).
const common = [
    ['starfish-media-', 'S', 16, 2, 555],
    ['tLibSystrim', 'S', 0, 0, 612],
    ['source:src', 'S', 1, 3, 29],
    ['queue2-0:src', 'S', 2, 1, 21],
    ['multiqueue0:src', 'S', 3, 3, 489],
];

describe('pipeline-state', () => {
    it('parses the remote snapshot (thread names with spaces included)', () => {
        const parsed = parseSnapshot(snapshot(1511, 78520, [['vqueue:src', 'R', 248, 2, 271], ['a b', 'S', 1, 1, 1]]) + '\nnoise\n');
        expect(parsed['1511'].rssKb).toBe(78520);
        expect(parsed['1511'].threads).toEqual([
            { name: 'vqueue:src', state: 'R', utime: 248, stime: 2, voluntarySwitches: 271 },
            { name: 'a b', state: 'S', utime: 1, stime: 1, voluntarySwitches: 1 },
        ]);
    });

    it('a playing pipeline is healthy: its video thread decodes in user mode', () => {
        const before = parseSnapshot(snapshot(1511, 78520, common.concat([['vqueue:src', 'R', 248, 2, 271], ['aqueue:src', 'S', 1, 0, 186]])));
        const after = parseSnapshot(snapshot(1511, 78600, common.concat([['vqueue:src', 'S', 301, 3, 290], ['aqueue:src', 'S', 1, 0, 205]])));
        const state = classify(before, after, 1);
        expect(state.wedged).toBe(false);
        expect(state.pipelines[0]).toMatchObject({ pid: 1511, wedged: false, videoThread: { systemShare: 0.01, userShare: 0.53 } });
    });

    it('a wedged pipeline: the video thread spins in the kernel and the audio thread gets nothing', () => {
        // Measured: load 3 of threads-1, sampled 2 s apart (stime 387 -> 542).
        const before = parseSnapshot(snapshot(1649, 74540, common.concat([['vqueue:src', 'R', 217, 387, 13], ['aqueue:src', 'S', 0, 0, 4]])));
        const after = parseSnapshot(snapshot(1649, 74540, common.concat([['vqueue:src', 'R', 301, 542, 13], ['aqueue:src', 'S', 0, 0, 7]])));
        const state = classify(before, after, 2);
        expect(state.wedged).toBe(true);
        expect(state.pipelines[0].videoThread).toEqual({ state: 'R', systemShare: 0.78, userShare: 0.42, voluntarySwitches: 0 });
    });

    it('no pipeline, or one that appeared between the samples, is not wedged', () => {
        expect(classify({}, {}, 1)).toEqual({ wedged: false, pipelines: [] });
        const after = parseSnapshot(snapshot(2000, 14000, [['starfish-media-', 'S', 1, 0, 3]]));
        expect(classify({}, after, 1)).toEqual({ wedged: false, pipelines: [{ pid: 2000, rssKb: 14000, threads: 1, videoThread: null, wedged: false }] });
    });
});

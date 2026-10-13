// webos/lib/catalog-trim (F8.7): with the answers trimmed, the vendored core ends up with the same state the
// page reads (notifications and Continue Watching, the Board, Details of a series episode and of a movie),
// in both variants of the core. core-run.js runs the core in a process of its own each time (the core keeps
// one runtime per process).
const path = require('path');
const { execFileSync } = require('child_process');

const run = (...args) => JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'core-run.js'), ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120000,
}));

describe.each(['wasm', 'wasm2js'])('the core (%s) with and without the trim', (variant) => {
    let plain;
    let trimmed;
    beforeAll(() => {
        plain = run('--variant', variant);
        trimmed = run('--variant', variant, '--trim');
    }, 240000);

    test('the run did what it should (otherwise the comparison proves nothing)', () => {
        const items = plain.notifications.items;
        expect(Object.keys(items).length).toBeGreaterThan(5);
        expect(plain.notifications.cw.items.length).toBeGreaterThan(5);
        const ready = plain.board.board.catalogs.filter((c) => c.content && c.content.type === 'Ready');
        expect(ready.length).toBeGreaterThanOrEqual(4);
        const series = plain.series.meta_details.metaItem.content.content;
        expect(series.videos.length).toBe(18);
        // Built by the core from imdbRating and genres (the meta of this series has no links).
        expect(series.links.map((l) => l.category)).toEqual(expect.arrayContaining(['imdb', 'Genres']));
        expect(plain.movie.meta_details.streams.some((s) => s.content.type === 'Ready')).toBe(true);
    });

    test.each(['notifications', 'board', 'series', 'movie'])('%s: the same state', (step) => {
        expect(trimmed[step]).toEqual(plain[step]);
    });
});

// The visual regression (F2.7): the comparison, the fixture addon and the references in git.
const fs = require('fs');
const path = require('path');
const lib = require('./visual-lib');
const fixture = require('./fixture/data');

const HERE = __dirname;
const REFS = path.join(HERE, 'refs', 'emulator');
const PIXELS = lib.WIDTH * lib.HEIGHT;

const flat = (r, g, b) => {
    const buffer = Buffer.alloc(PIXELS * 3);
    for (let i = 0; i < PIXELS; i++) buffer.set([r, g, b], i * 3);
    return buffer;
};
// A rectangle of the reduced image, in reduced pixels.
const paint = (buffer, x, y, width, height, [r, g, b]) => {
    for (let row = y; row < y + height; row++) {
        for (let column = x; column < x + width; column++) buffer.set([r, g, b], (row * lib.WIDTH + column) * 3);
    }
    return buffer;
};

describe('compare', () => {
    test('identical images pass with nothing changed', () => {
        const result = lib.compare(flat(20, 20, 40), flat(20, 20, 40));
        expect(result.pass).toBe(true);
        expect(result.changed).toBe(0);
        expect(result.compared).toBe(PIXELS);
    });

    test('noise under the pixel tolerance does not count', () => {
        const result = lib.compare(flat(20, 20, 40), flat(35, 25, 60));
        expect(result.changed).toBe(0);
        expect(result.pass).toBe(true);
    });

    test('a thin ring (a focus outline gone) fails, and fills the blocks it is in', () => {
        const reference = flat(20, 20, 40);
        // The ring of a poster: 1 px wide, 55 x 105 reduced pixels, drawn on the reference only.
        paint(reference, 96, 64, 55, 1, [255, 255, 255]);
        paint(reference, 96, 168, 55, 1, [255, 255, 255]);
        paint(reference, 96, 64, 1, 105, [255, 255, 255]);
        paint(reference, 150, 64, 1, 105, [255, 255, 255]);
        const result = lib.compare(reference, flat(20, 20, 40));
        expect(result.worstBlock.ratio).toBeGreaterThan(lib.DEFAULTS.block);
        expect(result.pass).toBe(false);
    });

    test('a block of changed pixels (a missing poster row) fails through the share of the image', () => {
        const result = lib.compare(flat(20, 20, 40), paint(flat(20, 20, 40), 10, 10, 200, 60, [200, 40, 40]));
        expect(result.ratio).toBeGreaterThan(lib.DEFAULTS.ratio);
        expect(result.pass).toBe(false);
    });

    test('masked regions are not compared, in capture pixels', () => {
        const capture = paint(flat(20, 20, 40), 100, 100, 100, 50, [255, 255, 0]);
        const rects = [[400, 400, 400, 200]]; // 1920x1080 pixels: covers x 100-200, y 100-150 of the reduced image
        const masked = lib.compare(flat(20, 20, 40), capture, rects);
        expect(masked.pass).toBe(true);
        expect(masked.compared).toBe(PIXELS - 100 * 50);
        expect(lib.compare(flat(20, 20, 40), capture).pass).toBe(false);
    });

    test('limits of a scene override the defaults', () => {
        const capture = paint(flat(20, 20, 40), 10, 10, 200, 60, [200, 40, 40]);
        expect(lib.compare(flat(20, 20, 40), capture, [], { ratio: 0.5, block: 1 }).pass).toBe(true);
    });

    test('refuses buffers of another size', () => {
        expect(() => lib.compare(Buffer.alloc(10), Buffer.alloc(10))).toThrow('480x270');
    });
});

describe('fixture addon', () => {
    const base = 'http://10.0.2.2:1234';
    const answer = (pathname) => fixture.route(base, pathname);

    test('answers the same thing every time', () => {
        ['/manifest.json', '/catalog/movie/top.json', '/meta/series/tt0903747.json', '/stream/movie/tt1.json', '/image/poster/tt0100001.svg'].forEach((pathname) => {
            expect(JSON.stringify(answer(pathname))).toBe(JSON.stringify(answer(pathname)));
        });
    });

    test('has the catalogs of the Board and a search', () => {
        const manifest = answer('/manifest.json').body;
        expect(manifest.catalogs.map((entry) => `${entry.type}/${entry.id}`)).toEqual(['movie/top', 'series/top']);
        expect(manifest.catalogs[0].extra.map((extra) => extra.name)).toEqual(['genre', 'search', 'skip']);
        const movies = answer('/catalog/movie/top.json').body.metas;
        expect(movies.length).toBe(24);
        expect(answer('/catalog/movie/top/search=matrix.json').body.metas.length).toBe(12);
        expect(answer('/catalog/movie/top/search=zzz.json').body.metas).toEqual(answer('/catalog/movie/top/search=matrix.json').body.metas);
    });

    test('filters by genre and pages with skip', () => {
        const drama = answer('/catalog/movie/top/genre=Drama.json').body.metas;
        expect(drama.length).toBeGreaterThan(0);
        drama.forEach((item) => expect(item.genres).toContain('Drama'));
        expect(answer('/catalog/movie/top/skip=50.json').body.metas).toEqual([]);
    });

    test('has no URL outside the fixture host', () => {
        const text = JSON.stringify([answer('/manifest.json'), answer('/catalog/series/top.json'), answer('/meta/series/tt0903747.json'), answer('/stream/series/tt0903747%3A1%3A1.json')]);
        // The IMDb link of the details column (F8.3) is never fetched: only a click would open it.
        const urls = text.match(/https?:\/\/[^"]+/g).filter((url) => !url.startsWith('https://imdb.com/title/'));
        expect(urls.length).toBeGreaterThan(0);
        urls.forEach((url) => expect(url.startsWith(`${base}/`)).toBe(true));
    });

    test('series have episodes by season; movies do not', () => {
        const series = answer('/meta/series/tt0903747.json').body.meta;
        expect(series.videos.length).toBe(18);
        expect(series.videos[0].id).toBe('tt0903747:1:1');
        expect(answer('/meta/movie/tt0068646.json').body.meta.videos).toBeUndefined();
    });

    test('images are SVG and unknown paths are not answered', () => {
        expect(answer('/image/poster/tt0100001.svg')).toMatchObject({ type: 'svg' });
        expect(answer('/image/poster/tt0100001.svg').body).toMatch(/^<svg /);
        expect(answer('/nothing.json')).toBeNull();
    });
});

describe('scenes, config and references', () => {
    const scenes = fs.readFileSync(path.join(HERE, 'scenes.sh'), 'utf8');
    const names = Array.from(scenes.matchAll(/^\s+"([a-z-]+)\|/gm), (match) => match[1]);
    const config = JSON.parse(fs.readFileSync(path.join(HERE, 'visual.config.json'), 'utf8'));

    test('the config only names scenes that exist (or the Player error, made by run)', () => {
        Object.keys(config.scenes).forEach((name) => expect([...names, 'player-error']).toContain(name));
    });

    test('masks are rectangles of the 1920x1080 capture', () => {
        Object.values(config.scenes).forEach((scene) => {
            (scene.masks || []).forEach(([x, y, width, height]) => {
                expect(x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1920 && y + height <= 1080).toBe(true);
            });
        });
    });

    test('every scene has a reference, a 480x270 PNG, and the whole set is small', () => {
        const files = fs.existsSync(REFS) ? fs.readdirSync(REFS) : [];
        [...names, 'player-error'].forEach((name) => expect(files).toContain(`${name}.png`));
        let total = 0;
        files.forEach((file) => {
            const data = fs.readFileSync(path.join(REFS, file));
            expect(data.slice(1, 4).toString()).toBe('PNG');
            expect([data.readUInt32BE(16), data.readUInt32BE(20)]).toEqual([lib.WIDTH, lib.HEIGHT]);
            total += data.length;
        });
        expect(total).toBeLessThan(3 * 1024 * 1024);
    });
});

// webos/external-links/qr.js: the QR code generator of the external links dialog (F3.4).

const crypto = require('crypto');
const { MAX_VERSION, encode, toPath } = require('../../external-links/qr');
const { fixtureText, rowsOf } = require('./qr-fixture-text');
const FIXTURES = require('./qr-fixtures.json');

// `qrencode -t ASCII -m 0 -l M -v 2 'https://www.stremio.com/'`, one string per row (# = dark module).
const STREMIO_URL_ROWS = [
    '#######.##....#...#######',
    '#.....#.#....##.#.#.....#',
    '#.###.#.#..#####..#.###.#',
    '#.###.#..#.#.#.##.#.###.#',
    '#.###.#.#.#..##.#.#.###.#',
    '#.....#...#..##...#.....#',
    '#######.#.#.#.#.#.#######',
    '..........##.#..#........',
    '#..#######..#..###..#.###',
    '####.....##..###.#.#####.',
    '..##..#.#....#.#..##.#..#',
    '...#...###.....##..#.####',
    '....#.##..##...#..#.....#',
    '#.#.#...##..######..#..#.',
    '####..#...#....####.#####',
    '#.##.#.#....#....#.#.##.#',
    '#.#...##..####.######.##.',
    '........####.#.##...#.##.',
    '#######.#.#.#...#.#.#...#',
    '#.....#.####.#.##...#...#',
    '#.###.#.#.###.#######....',
    '#.###.#.###.####..#....##',
    '#.###.#..###...#.#..#####',
    '#.....#..##...##...##.###',
    '#######.###.#.#.##...#..#',
];

const asRows = rowsOf;

describe('encode', () => {
    test('matches the reference encoder module by module (version 2-M)', () => {
        const qr = encode('https://www.stremio.com/');
        expect(qr.version).toBe(2);
        expect(qr.level).toBe('M');
        expect(qr.size).toBe(25);
        expect(asRows(qr)).toEqual(STREMIO_URL_ROWS);
    });

    test('picks the smallest version at level M, then falls back to L for long text', () => {
        expect(encode('a').version).toBe(1);
        expect(encode('a'.repeat(14)).version).toBe(1);
        expect(encode('a'.repeat(15)).version).toBe(2);
        // 2331 bytes is the capacity of version 40-M; beyond it only 40-L fits (2953 bytes).
        expect(encode('a'.repeat(2331))).toMatchObject({ version: MAX_VERSION, level: 'M' });
        expect(encode('a'.repeat(2332))).toMatchObject({ version: 36, level: 'L' });
        expect(encode('a'.repeat(2953))).toMatchObject({ version: MAX_VERSION, level: 'L' });
    });

    test('the length field is 8 bits up to version 9 and 16 after: 9-M holds 180 bytes, the 181st goes to 10-M', () => {
        expect(encode('a'.repeat(180))).toMatchObject({ version: 9, level: 'M' });
        expect(encode('a'.repeat(181))).toMatchObject({ version: 10, level: 'M' });
    });

    test('returns null when the text does not fit', () => {
        expect(encode('a'.repeat(2954))).toBeNull();
    });

    test('is a square grid of size 17 + 4 * version with the three finder patterns and the dark module', () => {
        [1, 7, 14, 40].forEach((version) => {
            const qr = encode('a'.repeat(version === 1 ? 5 : version === 7 ? 120 : version === 14 ? 330 : 1500));
            expect(qr.size).toBe(17 + 4 * qr.version);
            expect(qr.modules.length).toBe(qr.size);
            qr.modules.forEach((row) => expect(row.length).toBe(qr.size));
            [[0, 0], [qr.size - 7, 0], [0, qr.size - 7]].forEach(([x, y]) => {
                for (let dy = 0; dy < 7; dy++) {
                    for (let dx = 0; dx < 7; dx++) {
                        const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
                        expect(qr.modules[y + dy][x + dx]).toBe(ring !== 2);
                    }
                }
            });
            expect(qr.modules[qr.size - 8][8]).toBe(true);
        });
    });

    test('encodes text as UTF-8 bytes', () => {
        expect(encode('ção').version).toBe(1);
        expect(encode('€'.repeat(5)).version).toBe(encode('x'.repeat(15)).version);
    });

    test('is deterministic', () => {
        expect(asRows(encode('https://example.com/a?b=c'))).toEqual(asRows(encode('https://example.com/a?b=c')));
    });
});

// qr-fixtures.json: for each version 1 to 40 at M and at L, a text of qrencode-verified length (just past
// the capacity of the previous version, or filling this one) and the sha256 of the rows qrencode makes
// of it (gen-qr-fixtures.js regenerates it). Every table entry, block layout, alignment position,
// version information, mask and the length field width is on the path of some fixture.
describe('encode against the qrencode vectors', () => {
    test('the fixtures cover every version at both levels and all eight masks', () => {
        const versions = (level) => FIXTURES.filter((fixture) => fixture.level === level).map((fixture) => fixture.version);
        expect(new Set(versions('M')).size).toBeGreaterThanOrEqual(38);
        expect(new Set(versions('L')).size).toBeGreaterThanOrEqual(38);
        expect(new Set(FIXTURES.map((fixture) => fixture.mask)).size).toBe(8);
        expect(FIXTURES.some((fixture) => fixture.version === 7 && fixture.level === 'M')).toBe(true);
        expect(FIXTURES.some((fixture) => fixture.version === 10 && fixture.level === 'M')).toBe(true);
        expect(FIXTURES.some((fixture) => fixture.version === 40 && fixture.level === 'L')).toBe(true);
    });

    test.each(FIXTURES.map((fixture) => [`${fixture.version}-${fixture.level} (${fixture.length} bytes, mask ${fixture.mask})`, fixture]))('%s', (name, fixture) => {
        const qr = encode(fixtureText(fixture.length, fixture.seed), { level: fixture.level });
        expect({ version: qr.version, level: qr.level, mask: qr.mask }).toEqual({ version: fixture.version, level: fixture.level, mask: fixture.mask });
        expect(crypto.createHash('sha256').update(asRows(qr).join('\n')).digest('hex')).toBe(fixture.sha256);
    });

    test('without a level, the default (M, then L) gives the same code as asking for it', () => {
        const text = fixtureText(500, 0);
        expect(asRows(encode(text))).toEqual(asRows(encode(text, { level: 'M' })));
        const long = fixtureText(2400, 0);
        expect(asRows(encode(long))).toEqual(asRows(encode(long, { level: 'L' })));
        expect(encode(long, { level: 'M' })).toBeNull();
    });
});

describe('toPath', () => {
    test('draws one bar per run of dark modules, in module units', () => {
        const path = toPath({ modules: [[true, true, false, true], [false, false, false, false], [true, false, false, false]] });
        expect(path).toBe('M0 0h2v1h-2zM3 0h1v1h-1zM0 2h1v1h-1z');
    });

    test('covers exactly the dark modules of a code', () => {
        const qr = encode('https://www.stremio.com/');
        const covered = qr.modules.map((row) => row.map(() => false));
        toPath(qr).split('z').filter(Boolean).forEach((bar) => {
            const [, x, y, width] = /^M(\d+) (\d+)h(\d+)v1h-\d+$/.exec(bar);
            for (let i = 0; i < Number(width); i++) {
                covered[Number(y)][Number(x) + i] = true;
            }
        });
        expect(covered).toEqual(qr.modules);
    });
});

/* global describe, it, expect */
// webos/lib/tv-text (F8.3): entities decoded and emoji without a glyph swapped for the TV.

const { decodeEntities, decodeUrlEntities, displayText, createGlyphCheck, tvText } = require('..');

describe('decodeEntities', () => {
    it('decodes the named entities Cinemeta sends and numeric ones', () => {
        expect(decodeEntities('Josh O&apos;Connor')).toBe('Josh O\'Connor');
        expect(decodeEntities('Tom &amp; Jerry &quot;Live&quot; &lt;3 &gt;')).toBe('Tom & Jerry "Live" <3 >');
        expect(decodeEntities('O&#39;Neill &#x2019; &#8212;')).toBe('O\'Neill ’ —');
    });

    it('leaves the rest alone and decodes only once', () => {
        expect(decodeEntities('Fast & Furious')).toBe('Fast & Furious');
        expect(decodeEntities('&unknown; &#0; &#xD800;')).toBe('&unknown; &#0; &#xD800;');
        expect(decodeEntities('&amp;apos;')).toBe('&apos;');
        expect(decodeEntities(null)).toBe(null);
        expect(decodeEntities(undefined)).toBe(undefined);
    });
});

describe('decodeUrlEntities', () => {
    it('decodes the entities percent-encoded in a link, and only those', () => {
        expect(decodeUrlEntities('stremio:///search?search=Josh%20O%26apos%3BConnor')).toBe('stremio:///search?search=Josh%20O\'Connor');
        expect(decodeUrlEntities('stremio:///search?search=Tom%20%26amp%3B%20Jerry')).toBe('stremio:///search?search=Tom%20%26%20Jerry');
        expect(decodeUrlEntities('stremio:///search?search=a%26b%3Bc')).toBe('stremio:///search?search=a%26b%3Bc');
        expect(decodeUrlEntities('https://imdb.com/title/tt1')).toBe('https://imdb.com/title/tt1');
    });
});

describe('displayText', () => {
    // As in the emulator: 👤 and 💾 draw, ⚙ (U+2699) does not, nor the flags once TwemojiFlags is out.
    const drawable = new Set(['👤', '💾', '🇬🇧']);
    const hasGlyph = (emoji) => drawable.has(emoji.replace(/\uFE0F/g, ''));

    it('keeps the emoji that draw and swaps the rest: flags for their letters, others for a bullet', () => {
        const text = 'Disclosure.Day.2026.2160p.REMUX.mkv\n👤 30 💾 37.41 GB ⚙️ 1337x\nMulti Audio / 🇬🇧 / 🇷🇺 / 🇺🇦';
        expect(displayText(text, hasGlyph)).toBe('Disclosure.Day.2026.2160p.REMUX.mkv\n👤 30 💾 37.41 GB • 1337x\nMulti Audio / 🇬🇧 / RU / UA');
    });

    it('takes the selector, the skin tone and ZWJ sequences with the emoji', () => {
        const none = () => false;
        expect(displayText('a ⚙ b ⚙️ c', none)).toBe('a • b • c');
        expect(displayText('👍🏽 🧑‍💻 🏴‍☠️ x', none)).toBe('• • • x');
        expect(displayText('🧲🇧🇷', none)).toBe('•BR');
    });

    it('does not touch text without emoji, or anything without a check', () => {
        expect(displayText('[RD+] Torrentio\n4k DV | HDR', () => false)).toBe('[RD+] Torrentio\n4k DV | HDR');
        expect(displayText('a ⚙ b', undefined)).toBe('a ⚙ b');
        expect(displayText(42, () => false)).toBe(42);
    });
});

describe('createGlyphCheck', () => {
    // A fake 2D context: each text draws a mask of its own, except the ones in `boxes`, which draw
    // the same box as the code points no font has, and the ones in `blank`, which draw nothing.
    const fakeDocument = ({ boxes = [], blank = [], ligatures = [] } = {}) => {
        const drawn = [];
        let last = null;
        const context = {
            font: '',
            // Flags in `ligatures` are one glyph; any other text is as wide as its code points.
            measureText: (text) => ({ width: ligatures.indexOf(text) !== -1 ? 40 : Array.from(text).length * 40 }),
            clearRect: () => { last = null; },
            fillText: (text) => { drawn.push(text); last = text; },
            getImageData: (x, y, width, height) => {
                const data = new Uint8ClampedArray(width * height * 4);
                const missing = last === '\u0378' || last === '\uDB3F\uDFFD' || boxes.indexOf(last) !== -1;
                if (blank.indexOf(last) === -1) {
                    const seed = missing ? 7 : Array.from(last).reduce((sum, char) => sum + char.codePointAt(0), 0);
                    // A hash of the pixel and the seed: texts never share a mask by chance (a `% 5` pattern
                    // gave 🇧🇷 the box's mask, and the flag branch of the check went untested).
                    for (let i = 0; i < width * height; i++) data[i * 4 + 3] = ((Math.imul(i + 1, 2654435761) ^ Math.imul(seed, 40503)) >>> 0) % 3 === 0 ? 255 : 0;
                }
                return { data };
            },
        };
        return { drawn, createElement: () => ({ getContext: () => context }) };
    };

    it('tells a box or nothing drawn from a glyph, once per emoji', () => {
        const doc = fakeDocument({ boxes: ['⚙', '🧲'], blank: ['🇷🇺'], ligatures: ['🇬🇧'] });
        const hasGlyph = createGlyphCheck(doc, 'PlusJakartaSans, sans-serif');
        expect(hasGlyph('💾')).toBe(true);
        expect(hasGlyph('🇬🇧')).toBe(true);
        // Drawn, with a mask of its own, but as two boxed letters (no ligature): plain letters instead.
        expect(hasGlyph('🇧🇷')).toBe(false);
        expect(doc.drawn).toContain('🇧🇷');
        expect(hasGlyph('⚙️')).toBe(false);
        expect(hasGlyph('🧲')).toBe(false);
        expect(hasGlyph('🇷🇺')).toBe(false);
        const count = doc.drawn.length;
        expect(hasGlyph('⚙️')).toBe(false);
        expect(hasGlyph('💾')).toBe(true);
        expect(doc.drawn.length).toBe(count);
    });

    it('counts everything as drawable without a 2D canvas', () => {
        const hasGlyph = createGlyphCheck({ createElement: () => ({ getContext: () => null }) }, '');
        expect(hasGlyph('⚙️')).toBe(true);
        expect(tvText('a ⚙️ O&apos;b', hasGlyph)).toBe('a ⚙️ O\'b');
    });
});

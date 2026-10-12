// Text from addons and metadata as the TV can show it (F8.3).
//
// - HTML entities. Cinemeta sends some names escaped ("Josh O&apos;Connor" in the cast of
//   tt15047880), and React shows them as they are. decodeEntities() turns the common named ones and
//   the numeric ones back into characters; anything else is left alone.
// - Emoji without a glyph. The TV draws a box for a character no font of its own has (U+2699, the
//   "⚙️" of Torrentio, and the emoji after Unicode 8 in the webOS 4 emulator), and nothing for a
//   glyph it cannot paint (the COLR flags of TwemojiFlags, which webos/styles/app.less takes out of
//   the font list). Which emoji the fonts have differs between firmwares (the C8 has color emoji the
//   emulator lacks), so it is measured in the page: createGlyphCheck() draws the emoji in a canvas
//   with the page font and compares it with the box of a code point no font has. displayText()
//   keeps the emoji that draw and swaps the others: a flag for its two letters ("🇬🇧" -> "GB"), any
//   other emoji for a bullet ("💾 37.41 GB ⚙️ 1337x" -> "💾 37.41 GB • 1337x").
// Plain functions, no DOM at load: the tests pass their own glyph check.

'use strict';

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: '\u00a0' };
const ENTITY = /&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z]+);/g;

const decodeEntity = (match, body) => {
    if (body[0] === '#') {
        const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : match;
    }
    return Object.prototype.hasOwnProperty.call(NAMED, body) ? NAMED[body] : match;
};

const decodeEntities = (text) => (
    typeof text === 'string' && text.indexOf('&') !== -1 ? text.replace(ENTITY, decodeEntity) : text
);

// The same entities percent-encoded in a URL: Cinemeta's search link of a cast member is
// "stremio:///search?search=Josh%20O%26apos%3BConnor".
const ENCODED_ENTITY = /%26(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z]+)%3B/g;

const decodeUrlEntities = (url) => (
    typeof url === 'string' && url.indexOf('%26') !== -1 ?
        url.replace(ENCODED_ENTITY, (match, body) => {
            const decoded = decodeEntity(match, body);
            return decoded === match ? match : encodeURIComponent(decoded);
        })
        :
        url
);

// An emoji: a flag (two regional indicators) or a pictograph (the astral planes of the emoji, or the
// BMP symbol blocks), with its skin tone, its emoji presentation selector and the ZWJ sequence it
// starts. Written with surrogate pairs: no `u` flag needed.
const PICTOGRAPH = '(?:[\\uD83C-\\uD83E][\\uDC00-\\uDFFF]|[\\u2190-\\u21FF\\u2300-\\u23FF\\u25A0-\\u27BF\\u2900-\\u297F\\u2B00-\\u2BFF\\u3030\\u303D\\u3297\\u3299])(?:\\uD83C[\\uDFFB-\\uDFFF])?\\uFE0F?';
const FLAG = '\\uD83C[\\uDDE6-\\uDDFF]\\uD83C[\\uDDE6-\\uDDFF]';
const EMOJI = new RegExp(`${FLAG}|${PICTOGRAPH}(?:\\u200D${PICTOGRAPH})*`, 'g');
const BULLET = '\u2022';

// The two letters of a flag: regional indicators U+1F1E6..U+1F1FF are A..Z.
const flagLetters = (flag) => (
    String.fromCharCode(0x41 + flag.charCodeAt(1) - 0xdde6) + String.fromCharCode(0x41 + flag.charCodeAt(3) - 0xdde6)
);

const isFlag = (emoji) => emoji.length === 4 && /^\uD83C[\uDDE6-\uDDFF]\uD83C[\uDDE6-\uDDFF]$/.test(emoji);

// The text with the emoji `hasGlyph(emoji)` says the TV cannot draw swapped for letters or a bullet.
const displayText = (text, hasGlyph) => {
    if (typeof text !== 'string' || typeof hasGlyph !== 'function') return text;
    return text.replace(EMOJI, (emoji) => {
        if (hasGlyph(emoji)) return emoji;
        return isFlag(emoji) ? flagLetters(emoji) : BULLET;
    });
};

// Code points no font has: what the TV draws for a missing glyph (one of them is enough to compare).
const NO_GLYPH = ['\u0378', '\uDB3F\uDFFD'];
const SIZE = { width: 48, height: 40, font: 28 };

// hasGlyph(emoji) for the fonts of this page, measured once per emoji. Without a 2D canvas (jsdom)
// every emoji counts as drawable: the text is shown as it came.
const createGlyphCheck = (doc, fontFamily) => {
    let context;
    let missing = null;
    const cache = new Map();

    const draw = (text) => {
        context.clearRect(0, 0, SIZE.width, SIZE.height);
        context.fillText(text, 2, 4);
        const data = context.getImageData(0, 0, SIZE.width, SIZE.height).data;
        let ink = 0;
        let mask = '';
        for (let i = 3; i < data.length; i += 4) {
            const on = data[i] > 96;
            if (on) ink++;
            mask += on ? '1' : '0';
        }
        return { ink, mask };
    };

    const setup = () => {
        if (context !== undefined) return context !== null;
        context = null;
        try {
            const canvas = doc.createElement('canvas');
            canvas.width = SIZE.width;
            canvas.height = SIZE.height;
            context = canvas.getContext('2d') || null;
        } catch (error) {
            context = null;
        }
        if (context === null) return false;
        context.font = `${SIZE.font}px ${fontFamily || 'sans-serif'}`;
        context.fillStyle = '#fff';
        context.textBaseline = 'top';
        missing = NO_GLYPH.map((text) => draw(text).mask);
        return true;
    };

    return (emoji) => {
        if (cache.has(emoji)) return cache.get(emoji);
        let result = true;
        if (setup()) {
            // The presentation selector draws nothing of its own; the box would be the base's.
            const { ink, mask } = draw(emoji.replace(/\uFE0F/g, ''));
            result = ink > 0 && missing.indexOf(mask) === -1;
            // A flag the fonts have no ligature for is drawn as its two letters in boxes, side by
            // side ("🇧🇷" as "B R" in the emulator): as wide as both. Plain letters read better.
            if (result && isFlag(emoji)) {
                result = context.measureText(emoji).width < 1.5 * context.measureText(emoji.slice(0, 2)).width;
            }
        }
        cache.set(emoji, result);
        return result;
    };
};

// The check of the page, shared by every component (the fonts do not change while the app runs).
let pageCheck = null;
const pageGlyphCheck = () => {
    if (pageCheck === null && typeof document !== 'undefined') {
        const root = document.body || document.documentElement;
        const fontFamily = root && typeof getComputedStyle === 'function' ? getComputedStyle(root).fontFamily : '';
        pageCheck = createGlyphCheck(document, fontFamily);
    }
    return pageCheck;
};

// The text of an addon (stream names and descriptions) for the screen: entities decoded, emoji the
// TV cannot draw swapped.
const tvText = (text, hasGlyph = pageGlyphCheck()) => displayText(decodeEntities(text), hasGlyph);

module.exports = { decodeEntities, decodeUrlEntities, displayText, createGlyphCheck, tvText, EMOJI };

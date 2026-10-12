/* global describe, it, expect */
// F7.3: the comparison of the e2e "the picture shows on the VM screen" check (webos/tests/e2e/picture.js),
// on synthetic frames. A moving picture passes; a frozen one must not pass because something small
// goes away between the captures (a toast, the buffering spinner).

const { PICTURE, comparePictures } = require('./picture');

const { width, height } = PICTURE;

// A lit frame whose content depends on `seed`: two seeds are two different frames all over the screen.
const frame = (seed) => {
    const data = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const value = 90 + ((x * 7 + y * 13 + seed * 101) * 2654435761 >>> 0) % 120;
            const i = (y * width + x) * 3;
            data[i] = value;
            data[i + 1] = value;
            data[i + 2] = value;
        }
    }
    return data;
};

// Paints a rectangle given as fractions of the screen: dark on a lit frame, or lit on a dark one.
const paint = (data, { left, right, top, bottom }, value) => {
    const copy = Buffer.from(data);
    for (let y = Math.floor(height * top); y < Math.floor(height * bottom); y++) {
        for (let x = Math.floor(width * left); x < Math.floor(width * right); x++) {
            const i = (y * width + x) * 3;
            copy[i] = value;
            copy[i + 1] = value;
            copy[i + 2] = value;
        }
    }
    return copy;
};

// Old rule of the check: any change over 1 % of the band, in whichever column.
const OLD = Object.assign({}, PICTURE, { minColumns: 1 });

const still = frame(1);
const BAND = { top: 0.25, bottom: 0.7 };
// The "Subtitles loaded" toast and a stack of three: top right, the stack going down past the corner
// that is left out (x 0.6-0.96, y 0.16-0.48).
const TOAST = { left: 0.62, right: 0.94, top: 0.18, bottom: 0.3 };
const TOAST_STACK = { left: 0.62, right: 0.94, top: 0.18, bottom: 0.66 };
// What sits in the middle of the screen before the picture (the buffering spinner, the title logo that the
// frozen frame of c8-guard-off-1 showed in the first capture and not in the second).
const SPINNER = { left: 0.41, right: 0.59, top: 0.3, bottom: 0.45 };
const LEFT_COLUMN = { left: 0, right: 0.28, top: BAND.top, bottom: BAND.bottom };
const MIDDLE_COLUMN = { left: 0.32, right: 0.58, top: BAND.top, bottom: BAND.bottom };

describe('comparePictures (e2e picture check)', () => {
    it('passes a picture that moves all over the band', () => {
        const result = comparePictures(frame(1), frame(2));
        expect(result.ok).toBe(true);
        expect(result.columns.every((ratio) => ratio > 0.5)).toBe(true);
    });

    it('fails a frozen frame', () => {
        const result = comparePictures(still, Buffer.from(still));
        expect(result.ok).toBe(false);
        expect(result.changedRatio).toBe(0);
    });

    it('fails a frozen frame whose toast goes away between the captures', () => {
        expect(comparePictures(paint(still, TOAST, 255), still).ok).toBe(false);
        expect(comparePictures(still, paint(still, TOAST, 255)).ok).toBe(false);
    });

    it('fails a frozen frame whose stack of toasts goes away, even past the corner left out', () => {
        const result = comparePictures(paint(still, TOAST_STACK, 255), still);
        expect(result.ok).toBe(false);
        expect(result.changedRatio).toBeGreaterThan(PICTURE.minChanged);
        // The old rule passed this one: it counted the change in whichever column.
        expect(comparePictures(paint(still, TOAST_STACK, 255), still, OLD).ok).toBe(true);
    });

    it('fails a frozen frame whose buffering spinner or title logo goes away', () => {
        const result = comparePictures(paint(still, SPINNER, 0), still);
        expect(result.ok).toBe(false);
        expect(result.columns.filter((ratio) => ratio >= PICTURE.minChanged)).toHaveLength(1);
        expect(comparePictures(paint(still, SPINNER, 0), still, OLD).ok).toBe(true);
    });

    it('does not count the corner of the toasts as a change', () => {
        const corner = { left: 0.62, right: 0.94, top: 0.2, bottom: 0.45 };
        expect(comparePictures(paint(still, corner, 255), still).changedRatio).toBe(0);
    });

    it('fails a change in a single column, passes the same change in two', () => {
        expect(comparePictures(frame(1), paint(frame(1), LEFT_COLUMN, 0)).ok).toBe(false);
        const two = paint(paint(frame(1), LEFT_COLUMN, 0), MIDDLE_COLUMN, 0);
        expect(comparePictures(frame(1), two).ok).toBe(true);
    });

    it('fails a dark capture, however much it changes against the other', () => {
        const dark = paint(still, { left: 0, right: 1, top: 0, bottom: 1 }, 0);
        expect(comparePictures(dark, frame(2)).ok).toBe(false);
        expect(comparePictures(frame(2), dark).ok).toBe(false);
    });

    it('fails when a capture is missing or has another size', () => {
        expect(comparePictures(null, still)).toEqual({ ok: false, error: 'no capture' });
        expect(comparePictures(still, Buffer.alloc(0))).toEqual({ ok: false, error: 'no capture' });
        expect(comparePictures(still, still.subarray(3)).ok).toBe(false);
    });
});

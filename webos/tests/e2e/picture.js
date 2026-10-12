// The comparison behind the e2e "picture shows on the VM screen" check (F6.4, F7.3): two captures of the
// VM screen, already reduced to WIDTH x HEIGHT RGB (3 bytes a pixel), and whether they are a moving
// picture. Pure, so it is unit tested (picture.test.js) without the emulator; run.mjs only captures.
//
// Only the middle band of the screen counts (no title, no control bar, no subtitles), and the toasts
// corner is left out. What the band must show:
// - brightness: neither capture is dark (a dark first one against a still frame changes 100 %);
// - motion: at least `minChanged` of the band changes between the captures;
// - spread: and the change is in at least `minColumns` of the 3 columns of the band (`columnEdges`), each with at least
//   `minChanged` of its own. The test media move all over the frame (testsrc2), but a frozen frame can
//   still change in one place: a toast that goes away (the stack grows downward from the top right and
//   can pass the corner that is left out), the buffering spinner in the middle of the screen. Those
//   are one column; a picture that moves is in two or three of them (F7.3: the frozen second media of
//   F5.6b, `c8-guard-off-1`, changed 11.5 % in the middle column only and passed the old check).

const PICTURE = {
    width: 480, height: 270, top: 0.25, bottom: 0.7, minBrightness: 20, minChanged: 0.01, pixel: 32,
    // Left edges of the columns of the band, as fractions of the width. The last one starts where the
    // toasts corner starts (x 0.6): a stack of toasts, however tall, stays in one column.
    columnEdges: [0, 0.3, 0.6], minColumns: 2,
    toast: { left: 0.6, right: 0.96, top: 0.16, bottom: 0.48 },
};

const inToast = (x, y, picture = PICTURE) => x >= picture.width * picture.toast.left && x < picture.width * picture.toast.right &&
    y >= picture.height * picture.toast.top && y < picture.height * picture.toast.bottom;

// a, b: Buffers (or Uint8Arrays) of width * height * 3 bytes. Returns { ok, ... } with the numbers.
const comparePictures = (a, b, picture = PICTURE) => {
    const size = picture.width * picture.height * 3;
    if (!a || !b || a.length !== size || b.length !== size) {
        return { ok: false, error: 'no capture' };
    }
    const rows = [Math.floor(picture.height * picture.top), Math.floor(picture.height * picture.bottom)];
    const columnOf = (x) => picture.columnEdges.filter((edge) => x >= picture.width * edge).length - 1;
    const changedIn = new Array(picture.columnEdges.length).fill(0);
    const countIn = new Array(picture.columnEdges.length).fill(0);
    let sum = 0;
    let sumA = 0;
    let changed = 0;
    let count = 0;
    for (let y = rows[0]; y < rows[1]; y++) {
        for (let x = 0; x < picture.width; x++) {
            if (inToast(x, y, picture)) continue;
            const i = (y * picture.width + x) * 3;
            sum += (b[i] + b[i + 1] + b[i + 2]) / 3;
            sumA += (a[i] + a[i + 1] + a[i + 2]) / 3;
            const column = columnOf(x);
            countIn[column]++;
            if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > picture.pixel) {
                changed++;
                changedIn[column]++;
            }
            count++;
        }
    }
    const round4 = (value) => Math.round(value * 10000) / 10000;
    const brightness = Math.round(sum / count);
    const brightnessA = Math.round(sumA / count);
    const changedRatio = round4(changed / count);
    const columns = changedIn.map((value, column) => round4(value / countIn[column]));
    const movingColumns = columns.filter((ratio) => ratio >= picture.minChanged).length;
    return {
        ok: Math.min(brightness, brightnessA) >= picture.minBrightness && changedRatio >= picture.minChanged && movingColumns >= picture.minColumns,
        brightness,
        brightnessA,
        changedRatio,
        columns,
    };
};

module.exports = { PICTURE, inToast, comparePictures };

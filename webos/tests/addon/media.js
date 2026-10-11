// Media root of the test addon (see catalog.js): kit media, F0.10 headers and e2e media linked, header probe
// fixtures rebuilt at their original size. A fixture .bin holds the recorded byte ranges back to
// back (`pieces` in its .json); here each piece goes back to its offset in a sparse file, so the
// probe reads over HTTP exactly the bytes it read when the fixture was recorded.

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const FIXTURES_DIR = path.join(ROOT, 'webos', 'lib', 'header-probe', '__fixtures__');
const HEADERS_DIR = path.join(ROOT, 'webos', 'tests', 'media', 'headers');
const KIT_DIR = process.env.MEDIA_DIR || path.join(os.homedir(), 'webos-tv-sdk', 'media-tests', 'suite');
// Media of the end-to-end run (F6.4): webos/tests/e2e/make-media.sh.
const E2E_DIR = process.env.E2E_MEDIA_DIR || path.join(os.homedir(), 'webos-tv-sdk', 'media-tests', 'e2e');
const SOURCES = { kit: KIT_DIR, headers: HEADERS_DIR, e2e: E2E_DIR };

// fixtures/<id>.<ext> -> <id>
const fixtureIdOf = (media) => path.basename(media).replace(/\.[^.]+$/, '');

const rebuildFixture = (id, target) => {
    const meta = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, `${id}.json`), 'utf8'));
    const bin = fs.readFileSync(path.join(FIXTURES_DIR, `${id}.bin`));
    const fd = fs.openSync(target, 'w');
    try {
        fs.ftruncateSync(fd, meta.size);
        let position = 0;
        meta.pieces.forEach((piece) => {
            fs.writeSync(fd, bin, position, piece.length, piece.offset);
            position += piece.length;
        });
    } finally {
        fs.closeSync(fd);
    }
};

const link = (source, target) => {
    if (!fs.existsSync(source)) return false;
    fs.rmSync(target, { force: true });
    fs.symlinkSync(source, target);
    return true;
};

// Fills `dir` with the files of `media` (catalog paths). Returns the ones that could not be made
// (kit media not generated yet: webos/tools/gen-media.sh; e2e media: webos/tests/e2e/make-media.sh).
const prepareMedia = (dir, media, kitDir) => {
    const missing = [];
    ['kit', 'headers', 'fixtures', 'e2e'].forEach((sub) => fs.mkdirSync(path.join(dir, sub), { recursive: true }));
    media.forEach((file) => {
        const target = path.join(dir, file);
        const [kind, name] = file.split('/');
        if (kind === 'fixtures') {
            rebuildFixture(fixtureIdOf(name), target);
        } else if (!link(path.join(kind === 'kit' ? kitDir || KIT_DIR : SOURCES[kind], name), target)) {
            missing.push(file);
        }
    });
    return missing;
};

module.exports = { FIXTURES_DIR, HEADERS_DIR, KIT_DIR, E2E_DIR, fixtureIdOf, rebuildFixture, prepareMedia };

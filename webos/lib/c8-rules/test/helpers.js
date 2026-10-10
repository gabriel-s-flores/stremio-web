// Test helpers: run the F5.2 header probe over real headers (probe fixtures and the F0.10
// catalogue) and hand the output to the rules. Nothing here is synthetic unless the helper
// name says so (derived: a real probe output with one field changed, documented per test).

const fs = require('fs');
const path = require('path');
const { probe } = require('../../header-probe');
const { loadFixture, replayReadRange, bufferReadRange } = require('../../header-probe/test/replay');

const FIXTURES = path.join(__dirname, '..', '..', 'header-probe', '__fixtures__');
const HEADERS = path.join(__dirname, '..', '..', '..', 'tests', 'media', 'headers');

const hasFixture = (id) => fs.existsSync(path.join(FIXTURES, id + '.json')) && fs.existsSync(path.join(FIXTURES, id + '.bin'));

// Probe fixture (webos/lib/header-probe/__fixtures__), with optional probe options.
const probeFixture = (id, options) => {
    const fixture = loadFixture(id);
    return probe(replayReadRange(fixture), Object.assign({}, fixture.meta.options, options));
};

// Whole header file from the F0.10 catalogue (webos/tests/media/headers).
const probeHeader = (name, options) => probe(bufferReadRange(new Uint8Array(fs.readFileSync(path.join(HEADERS, name)))), options);

const clone = (value) => JSON.parse(JSON.stringify(value));

// Derived: the same real header without its Dolby Vision configuration, i.e. what the probe
// returns for a plain HDR10 (PQ) or HLG stream with that colour.
const withoutDolbyVision = (result) => {
    const out = clone(result);
    out.tracks.forEach((track) => {
        if (!track.video) return;
        track.video.dolbyVision = null;
        const transfer = track.video.colour ? track.video.colour.transfer : null;
        track.video.hdr = transfer === 'pq' ? 'hdr10' : (transfer === 'hlg' ? 'hlg' : (transfer !== null ? 'sdr' : null));
    });
    const main = out.tracks.filter((track) => track.video)[0];
    out.summary.dolbyVision = null;
    out.summary.dolbyVisionDualTrack = false;
    out.summary.hdr = main ? main.video.hdr : null;
    return out;
};

// Derived: edits the probe tracks (edit(track) per track) and keeps the summary consistent.
const editTracks = (result, edit) => {
    const out = clone(result);
    out.tracks.forEach(edit);
    return out;
};

const codes = (list) => list.map((entry) => entry.code);

module.exports = {
    hasFixture,
    probeFixture,
    probeHeader,
    withoutDolbyVision,
    editTracks,
    codes,
};

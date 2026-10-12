/* global describe, it, expect */
// What the item shows: the rule labels and short warning texts, from the name and from the probe.

const rules = require('../../c8-rules');
const { describe: describeEntry, toDisplay } = require('../index');
const { probeFixture, probeHeader } = require('../../c8-rules/test/helpers');

const show = (description, probe) => {
    const stream = { name: '[RD+] Teste', description };
    return describeEntry({ stream, result: rules.evaluate({ stream, probe: probe || null }) });
};
const texts = (display) => display.labels.map((label) => label.text).concat(display.warnings.map((warning) => warning.text));

describe('toDisplay', () => {
    it('shows the rule labels with the profile texts', () => {
        expect(texts(show('Movie.2160p.WEB-DL.DV.HEVC.mp4'))).toEqual(['DV']);
        expect(texts(show('Movie.2160p.WEB-DL.DV.HDR10.DDP5.1.Atmos.mkv'))).toEqual(['HDR10 nesta TV', 'Atmos']);
        expect(show('Movie.2160p.WEB-DL.DV.HEVC.mp4')).toMatchObject({ tier: 'ok', score: 30, source: 'name' });
    });

    it('turns demoting and hiding warnings into short texts; info warnings stay out', () => {
        expect(texts(show('Movie.2160p.BluRay.REMUX.DV.P5.HEVC.TrueHD.7.1.Atmos.mkv'))).toEqual(['DV P5: cores erradas', 'TrueHD: pode ficar sem som']);
        expect(texts(show('Movie.2160p.WEB-DL.DV.HEVC.mkv'))).toEqual(['Pode ser DV P5']);
        // DTS plays on the C8 (F8.4): no warning by name, and no label (the name does not say which track starts)
        expect(texts(show('Movie.1080p.BluRay.DTS-HD.MA.7.1.mkv'))).toEqual([]);
        const av1 = show('Movie.2160p.WEB-DL.AV1.Opus.mp4');
        expect(texts(av1)).toEqual(['AV1: não toca nesta TV']);
        expect(av1.warnings[0]).toMatchObject({ severity: 'hide', code: 'VIDEO_UNSUPPORTED' });
        expect(av1.warnings[0].message.length).toBeGreaterThan(10);
    });

    it('names the codecs from the probe tracks when there is a probe', async () => {
        const truehd = show('Movie.1080p.mp4', await probeFixture('truehd-atmos-mp4'));
        expect(truehd).toMatchObject({ tier: 'demoted', source: 'probe' });
        expect(texts(truehd)).toEqual(['TrueHD: sem som nesta TV']);
        expect(texts(show('Movie.1080p.mkv', await probeHeader('dts-hd-ma.mkv')))).toEqual(['DTS-HD MA']);
        expect(texts(show('Movie.720p.mp4', await probeFixture('eac3-joc-mp4')))).toEqual(['Atmos']);
    });

    it('a stream with nothing to say shows nothing; no result, no display', () => {
        expect(show('Movie.1080p.WEB-DL.mkv')).toMatchObject({ tier: 'ok', score: 0, labels: [], warnings: [] });
        expect(toDisplay(null)).toBeNull();
        expect(describeEntry({ stream: {}, result: null })).toBeNull();
    });
});

/* global describe, it, expect */
// One describe per row of the table "O que a C8 entrega" (plan, section 2), in the plan's order,
// plus the decisions D6 to D8. Inputs are real headers: the F5.2 probe fixtures and the F0.10
// catalogue. Rows without a real sample of the plain format use a derived probe output (see
// helpers.js). Dolby Vision P7 only exists in the FATE suite, which is not in git: those tests
// are skipped with a warning when tools/fetch-fate-fixtures.sh has not been run.

const { evaluate, compare, sortStreams } = require('../index');
const { hasFixture, probeFixture, probeHeader, withoutDolbyVision, editTracks, codes } = require('./helpers');

const FATE_IDS = ['fate-dv-p7-mkv', 'fate-dv-p7-dual-mp4'];
const missingFate = FATE_IDS.filter((id) => !hasFixture(id));
if (missingFate.length > 0) {
    console.warn('[c8-rules] PULANDO os testes de Dolby Vision P7 que usam a FATE (fixtures ausentes: ' +
        missingFate.join(', ') + '). Rode webos/lib/header-probe/tools/fetch-fate-fixtures.sh para gravá-las.');
}
const itFate = (id) => (hasFixture(id) ? it : it.skip);

const labelsOf = (result) => codes(result.labels);
const warningsOf = (result) => codes(result.warnings);
const rate = (probe, stream, preferences) => evaluate({ probe, stream, preferences });

describe('Linha 1 · 4K HEVC Main10, HDR10, HLG (✅ toca direto)', () => {
    it('HDR10 HEVC Main 10 in MKV plays as HDR10 with no warning (derived: P8.1 MKV header without DV)', async () => {
        const result = rate(withoutDolbyVision(await probeFixture('dv-p81-mkvmerge-mkv')));
        expect(result.video).toMatchObject({ codec: 'hevc', status: 'ok', format: 'hdr10', output: 'hdr10', dolbyVision: null });
        expect(labelsOf(result)).toEqual(['hdr10']);
        expect(result.warnings).toEqual([]);
        expect(result.tier).toBe('ok');
    });

    it('HLG plays as HLG (derived: P8.4 MOV header without DV)', async () => {
        const result = rate(withoutDolbyVision(await probeHeader('dv-p8.4-hlg-iphone.mov')));
        expect(result.video).toMatchObject({ format: 'hlg', output: 'hlg' });
        expect(labelsOf(result)).toEqual(['hlg']);
        expect(result.tier).toBe('ok');
    });

    it('HEVC Main 10 without HDR metadata plays directly', async () => {
        const result = rate(await probeFixture('kit-hevc10-mkv'));
        expect(result.video).toMatchObject({ codec: 'hevc', status: 'ok', format: null, output: null });
        expect(result.tier).toBe('ok');
        expect(result.warnings).toEqual([]);
    });

    it('name only: "2160p HEVC HDR10" and HDR10+ (plays as HDR10)', () => {
        expect(labelsOf(rate(null, 'Movie.2160p.WEB-DL.HDR10.HEVC.DDP5.1.mkv'))).toEqual(['hdr10']);
        const plus = rate(null, 'Movie.2160p.WEB-DL.HDR10+.HEVC.mkv');
        expect(plus.video).toMatchObject({ format: 'hdr10plus', output: 'hdr10' });
        expect(labelsOf(plus)).toEqual(['hdr10-on-tv']);
        expect(labelsOf(rate(null, 'Broadcast 2160p HLG HEVC'))).toEqual(['hlg']);
    });

    itFate('fate-dv-p7-mkv')('4K HEVC (3840x2160) is playable', async () => {
        const probe = await probeFixture('fate-dv-p7-mkv');
        expect(probe.summary.width).toBe(3840);
        expect(rate(probe).video.status).toBe('ok');
    });
});

describe('Linha 2 · Dolby Vision em MP4: P5 e P7 dual-track (✅ toca direto e sobe na lista); P8.1 vira HDR10 na C8 (F8.4)', () => {
    it('P5 in MP4: DV active, "DV" label', async () => {
        const result = rate(await probeFixture('dv-p5-mp4'));
        expect(result.video).toMatchObject({ format: 'dolby-vision', output: 'dolby-vision' });
        expect(result.video.dolbyVision).toEqual({ profile: '5', baseLayer: 'none', dualTrack: false, mode: 'dolby-vision', source: 'probe' });
        expect(labelsOf(result)).toEqual(['dv']);
        expect(result.warnings).toEqual([]);
        expect(result.tier).toBe('ok');
    });

    it('P8.1 in MP4: the TV showed HDR10 (phase 8, two files), so "HDR10 nesta TV" and no DV label', async () => {
        const result = rate(await probeFixture('dv-p81-mp4'));
        expect(result.video.output).toBe('hdr10');
        expect(result.video.dolbyVision).toMatchObject({ profile: '8.1', baseLayer: 'hdr10', mode: 'base-layer' });
        expect(labelsOf(result)).toEqual(['hdr10-on-tv']);
        expect(warningsOf(result)).toEqual(['DV_BASE_LAYER']);
        expect(result.tier).toBe('ok');
    });

    itFate('fate-dv-p7-dual-mp4')('P7 dual-track in MP4 (FATE): DV active', async () => {
        const result = rate(await probeFixture('fate-dv-p7-dual-mp4'));
        expect(result.video.dolbyVision).toMatchObject({ profile: '7', dualTrack: true, mode: 'dolby-vision' });
        expect(labelsOf(result)).toEqual(['dv']);
    });

    it('P7 dual-track in MP4 (derived from the P8.1 MP4: profile 7, two tracks)', async () => {
        const probe = await probeFixture('dv-p81-mp4');
        probe.summary.dolbyVision = Object.assign({}, probe.summary.dolbyVision, { profile: 7, profileName: '7', compatibilityId: 6 });
        probe.summary.dolbyVisionDualTrack = true;
        expect(rate(probe).video.output).toBe('dolby-vision');
        probe.summary.dolbyVisionDualTrack = false;
        // A single-track P7 in MP4 is not in the table: only its HDR10 base layer is counted on.
        expect(labelsOf(rate(probe))).toEqual(['hdr10-on-tv']);
    });

    it('an active DV MP4 (P5) sorts above HDR10 and DV in MKV; a P8.1 MP4 ties with them (all HDR10 on the TV)', async () => {
        const p5 = rate(await probeFixture('dv-p5-mp4'));
        const p81 = rate(await probeFixture('dv-p81-mp4'));
        const hdr10 = rate(withoutDolbyVision(await probeFixture('dv-p81-mp4')));
        const mkv = rate(await probeFixture('dv-p81-mkvmerge-mkv'));
        expect(p5.score).toBeGreaterThan(hdr10.score);
        expect(p5.score).toBeGreaterThan(mkv.score);
        expect([mkv, hdr10, p81, p5].sort(compare)[0]).toBe(p5);
        expect(compare(p81, hdr10)).toBe(0);
        expect(compare(p81, mkv)).toBe(0);
    });

    it('name only: "DV P5" or "DV" in an .mp4 file name', () => {
        const p5 = rate(null, { name: 'Addon\n4k DV', behaviorHints: { filename: 'Movie.2160p.WEB-DL.DV.P5.H265.mp4' } });
        expect(p5.video.dolbyVision).toMatchObject({ profile: '5', mode: 'dolby-vision', source: 'name' });
        expect(labelsOf(p5)).toEqual(['dv']);
        // Without a profile, the base layer tells the likely one: none named is P5 (active in MP4)…
        expect(labelsOf(rate(null, { title: 'Movie 2160p DV', behaviorHints: { filename: 'movie.mp4' } }))).toEqual(['dv']);
        // …and "DV HDR10" is a P8.1 hybrid, which the C8 shows as HDR10 (F8.4)
        const hybrid = rate(null, { title: 'Movie 2160p DV HDR10 HEVC', behaviorHints: { filename: 'movie.mp4' } });
        expect(hybrid.video.dolbyVision).toMatchObject({ profile: null, baseLayer: 'hdr10', mode: 'base-layer' });
        expect(labelsOf(hybrid)).toEqual(['hdr10-on-tv']);
        // "P8" alone is read as 8.1 (8.4 with HLG in the name)
        const p8 = rate(null, { title: 'Movie 2160p DV P8 HDR10 HEVC', behaviorHints: { filename: 'movie.mp4' } });
        expect(p8.video.dolbyVision).toMatchObject({ profile: '8.1', mode: 'base-layer' });
        expect(rate(null, 'Clip DV P8 HLG HEVC.mkv').video.dolbyVision).toMatchObject({ profile: '8.4', baseLayer: 'hlg' });
    });
});

describe('Linha 3 · Dolby Vision em MKV P7 e P8.1 (⚠️ toca como HDR10, rótulo "HDR10 nesta TV")', () => {
    it.each([
        ['dv-p81-mkvmerge-mkv', 'config'],
        ['dv-p81-nobam-mkv', 'RPU, MKV without BlockAdditionMapping'],
        ['dv-p81-multi-mkv', 'multi-track remux'],
    ])('P8.1 in MKV (%s, %s)', async (id) => {
        const result = rate(await probeFixture(id));
        expect(result.video).toMatchObject({ format: 'dolby-vision', output: 'hdr10' });
        expect(result.video.dolbyVision).toMatchObject({ profile: '8.1', baseLayer: 'hdr10', mode: 'base-layer', source: 'probe' });
        expect(labelsOf(result)).toContain('hdr10-on-tv');
        expect(labelsOf(result)).not.toContain('dv');
        expect(warningsOf(result)).toContain('DV_BASE_LAYER');
        expect(result.tier).toBe('ok');
    });

    it('P8.1 in MKV from the F0.10 catalogue (mkvmerge v89)', async () => {
        const result = rate(await probeHeader('dv-p8.1-mkvmerge.mkv'));
        expect(result.labels).toEqual([{ code: 'hdr10-on-tv', text: 'HDR10 nesta TV', source: 'probe' }]);
    });

    itFate('fate-dv-p7-mkv')('P7 in MKV (FATE, BL+EL in one track)', async () => {
        const result = rate(await probeFixture('fate-dv-p7-mkv'));
        expect(result.video.dolbyVision).toMatchObject({ profile: '7', baseLayer: 'hdr10', mode: 'base-layer' });
        expect(labelsOf(result)).toEqual(['hdr10-on-tv']);
        expect(result.tier).toBe('ok');
    });

    it('P7 in MKV (derived from the P8.1 MKV: profile 7, compatibility 6)', async () => {
        const probe = await probeFixture('dv-p81-mkvmerge-mkv');
        probe.summary.dolbyVision = Object.assign({}, probe.summary.dolbyVision, { profile: 7, profileName: '7', compatibilityId: 6, elPresent: true });
        expect(labelsOf(rate(probe))).toEqual(['hdr10-on-tv']);
    });

    it('name only: "DV HDR10" / "DV P7 FEL" / "DoVi P8" in MKV', () => {
        expect(labelsOf(rate(null, 'Movie.2160p.BluRay.REMUX.DV.HDR10.HEVC.mkv'))).toEqual(['hdr10-on-tv']);
        const p7 = rate(null, 'Movie.2160p.BluRay.REMUX.DV.FEL.HEVC.DTS-HD.MA.mkv');
        expect(p7.video.dolbyVision).toMatchObject({ profile: '7', baseLayer: 'hdr10', source: 'name' });
        expect(labelsOf(p7)).toEqual(['hdr10-on-tv']);
        expect(labelsOf(rate(null, 'Movie 2160p DoVi P8.1 HEVC mkv'))).toEqual(['hdr10-on-tv']);
    });
});

describe('Linha 4 · Dolby Vision em MKV P5 (❌ cores erradas: detecta por probe ou nome, rebaixa e avisa)', () => {
    it('P5 in MKV from the DV configuration: wrong colours, demoted, warning', async () => {
        const result = rate(await probeFixture('dv-p5-truehd-atmos-mkv'));
        expect(result.video).toMatchObject({ format: 'dolby-vision', output: 'wrong-colors' });
        expect(result.video.dolbyVision).toMatchObject({ profile: '5', baseLayer: 'none', mode: 'base-layer', source: 'probe' });
        expect(warningsOf(result)).toContain('DV_WRONG_COLORS');
        expect(result.warnings.find((warning) => warning.code === 'DV_WRONG_COLORS')).toMatchObject({ severity: 'demote', source: 'probe' });
        expect(labelsOf(result)).toEqual([]);
        expect(result.tier).toBe('demoted');
    });

    it('P5 in MKV found from the RPU (old mkvmerge, no BlockAdditionMapping)', async () => {
        const result = rate(await probeFixture('dv-p5-nobam-mkv'));
        expect(result.video.dolbyVision).toMatchObject({ profile: '5', source: 'probe' });
        expect(result.video.output).toBe('wrong-colors');
        expect(result.tier).toBe('demoted');
    });

    it('name only: "DV P5" in an MKV is demoted, and the probe is recommended (it can clear a PQ base layer)', () => {
        const result = rate(null, { name: 'Addon 4k', title: 'Show.S01E01.2160p.WEB-DL.DV.P5.HEVC.DDP5.1.mkv' });
        expect(result.video.output).toBe('wrong-colors');
        expect(result.warnings.find((warning) => warning.code === 'DV_WRONG_COLORS')).toMatchObject({ source: 'name', score: -200 });
        expect(result.tier).toBe('demoted');
        expect(result.needsProbe).toBe(true);
        expect(rate(null, 'Movie.2160p.DV.HDR10.HEVC.mkv').needsProbe).toBe(true);
        // in MP4 the name already gives the final answer (DV active)
        expect(rate(null, { name: 'Addon', behaviorHints: { filename: 'Movie.2160p.DV.P5.mp4' } }).needsProbe).toBe(false);
    });

    it('name only: "DV" without profile nor HDR10 in MKV or unknown container may be P5', () => {
        const mkv = rate(null, 'Show.S01E01.2160p.WEB-DL.DV.H265.DDP5.1.Atmos.mkv');
        expect(warningsOf(mkv)).toContain('DV_WRONG_COLORS_POSSIBLE');
        expect(mkv.tier).toBe('demoted');
        expect(mkv.needsProbe).toBe(true);
        const unknown = rate(null, 'Show S01E01 2160p WEB-DL DV H265');
        expect(unknown.container).toBeNull();
        expect(warningsOf(unknown)).toContain('DV_WRONG_COLORS_POSSIBLE');
        expect(unknown.needsProbe).toBe(true);
    });

    it('ambiguous probe (DV_UNKNOWN: first frame not read) + name "DV" → possible P5', async () => {
        const probe = await probeFixture('dv-p5-nobam-mkv', { sniffFrames: false });
        expect(codes(probe.warnings)).toContain('DV_UNKNOWN');
        const result = rate(probe, 'Movie 2160p WEB-DL DV');
        expect(warningsOf(result)).toContain('DV_WRONG_COLORS_POSSIBLE');
        expect(result.tier).toBe('demoted');
    });

    it('ambiguous probe (DV_UNKNOWN) + name "DV P5" → wrong colours', async () => {
        const result = rate(await probeFixture('dv-p5-nobam-mkv', { sniffFrames: false }), 'Movie 2160p DV P5');
        expect(result.video.output).toBe('wrong-colors');
        expect(result.warnings.find((warning) => warning.code === 'DV_WRONG_COLORS')).toMatchObject({ source: 'name' });
    });

    it('a profile token without DV ("Season 1 P5") and DV with an AVC video are not DV', () => {
        const season = rate(null, 'Show Season 1 P5 WEB 1080p HEVC.mkv');
        expect(season.video.dolbyVision).toBeNull();
        expect(season.tier).toBe('ok');
        expect(rate(null, 'Movie 1080p DV P5 x264.mkv').video.dolbyVision).toBeNull();
    });

    it('ambiguous probe (DV_UNKNOWN) without name signals → info only, not demoted', async () => {
        const result = rate(await probeFixture('dv-p5-nobam-mkv', { sniffFrames: false }), 'Movie 2160p WEB-DL');
        expect(warningsOf(result)).toContain('DV_UNVERIFIED');
        expect(result.video.output).toBeNull();
        expect(warningsOf(result)).not.toContain('DV_WRONG_COLORS_POSSIBLE');
    });

    it('ambiguous probe (DV_UNKNOWN) with PQ colour + name "DV" → HDR10 base layer, not P5', async () => {
        const probe = await probeFixture('dv-p81-nobam-mkv', { sniffFrames: false });
        expect(probe.summary.hdr).toBe('hdr10');
        const result = rate(probe, 'Movie 2160p DV');
        expect(labelsOf(result)).toEqual(['hdr10-on-tv']);
        expect(result.tier).toBe('ok');
    });

    it('HEVC MKV with hdr: null and no DV_UNKNOWN (malformed NAL read as "no DV") still adds the name', async () => {
        const probe = await probeFixture('kit-hevc10-mkv');
        expect(probe.summary).toMatchObject({ videoCodec: 'hevc', hdr: null, dolbyVision: null });
        expect(probe.warnings).toEqual([]);
        expect(warningsOf(rate(probe, 'Movie 2160p WEB-DL DV'))).toContain('DV_WRONG_COLORS_POSSIBLE');
        expect(rate(probe, 'Movie 2160p WEB-DL DV P5').video.output).toBe('wrong-colors');
        expect(labelsOf(rate(probe, 'Movie 2160p DV HDR10'))).toEqual(['hdr10-on-tv']);
    });

    it('the probe wins over "DV P5" when it read the first frame and the colour is PQ (derived: P8.1 MKV without DV)', async () => {
        const probe = withoutDolbyVision(await probeFixture('dv-p81-nobam-mkv'));
        expect(probe.warnings).toEqual([]);
        expect(probe.summary.hdr).toBe('hdr10');
        const result = rate(probe, 'Movie 2160p DV P5');
        expect(result.video).toMatchObject({ format: 'hdr10', output: 'hdr10', dolbyVision: null });
        expect(labelsOf(result)).toEqual(['hdr10']);
        expect(result.warnings).toEqual([]);
        expect(result.tier).toBe('ok');
    });

    it('"DV P5" decides when the colour is unknown (hdr: null) or SDR on a 10-bit video', async () => {
        const unknown = await probeFixture('kit-hevc10-mkv');
        expect(unknown.summary.hdr).toBeNull();
        expect(rate(unknown, 'Movie 2160p DV P5').tier).toBe('demoted');
        // derived: the same real header with BT.709 colour (a P5 often carries it in the VUI)
        const sdr = editTracks(unknown, (track) => {
            if (track.video) {
                track.video.colour = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false };
                track.video.hdr = 'sdr';
            }
        });
        sdr.summary.hdr = 'sdr';
        const p5 = rate(sdr, 'Movie 2160p DV P5');
        expect(p5.video.output).toBe('wrong-colors');
        expect(p5.tier).toBe('demoted');
        // an 8-bit HEVC cannot be P5: the probe wins
        const eightBit = editTracks(sdr, (track) => {
            if (track.video) track.video.bitDepth = 8;
        });
        expect(rate(eightBit, 'Movie 2160p DV P5').video.dolbyVision).toBeNull();
    });

    it('the probe wins over the name when it read the DV configuration', async () => {
        const result = rate(await probeFixture('dv-p81-mkvmerge-mkv'), 'Movie DV P5');
        expect(result.video.dolbyVision).toMatchObject({ profile: '8.1', source: 'probe' });
        expect(result.tier).toBe('ok');
        // and in MP4, where the configuration is always in the sample entry, the name is ignored
        const mp4 = rate(withoutDolbyVision(await probeFixture('dv-p81-mp4')), 'Movie DV P5');
        expect(mp4.video.dolbyVision).toBeNull();
    });

    it('P5 MKV sorts below the HDR10 base layer and the DV MP4', async () => {
        const p5 = rate(await probeFixture('dv-p5-nobam-mkv'));
        const p81 = rate(await probeFixture('dv-p81-mkvmerge-mkv'));
        const mp4 = rate(await probeFixture('dv-p5-mp4'));
        expect([p5, p81, mp4].sort(compare)).toEqual([mp4, p81, p5]);
    });
});

describe('Linha 5 · DD+ Atmos, E-AC-3 JOC (✅ Atmos virtual: prefere essa faixa)', () => {
    it.each([
        ['eac3-joc-mp4', probeFixture],
        ['eac3joc-atmos.mkv', probeHeader],
        ['eac3joc-atmos.mp4', probeHeader],
        ['eac3joc-atmos-fragmented.mp4', probeHeader],
    ])('%s: Atmos label and the JOC track chosen', async (id, run) => {
        const result = rate(await run(id));
        expect(result.audio.initialTrack).toMatchObject({ codec: 'eac3', profile: 'E-AC-3 JOC', atmos: true, atmosOnTv: true, status: 'ok' });
        expect(result.audio.atmos).toBe(true);
        expect(result.labels).toEqual([{ code: 'atmos', text: 'Atmos', source: 'probe' }]);
    });

    it('DD+ Atmos is preferred over AC-3 in the same language (derived: multitrack MKV, AC-3 relabelled por)', async () => {
        const probe = editTracks(await probeHeader('mkv-multitrack-ac3-eac3joc-dtshdma-truehd-pgs.mkv'), (track) => {
            if (track.codec === 'ac3') track.language = 'por';
        });
        const result = rate(probe, null, { audioLanguages: ['por'] });
        expect(result.audio.initialTrack).toMatchObject({ id: 3, codec: 'eac3', atmos: true });
        expect(labelsOf(result)).toEqual(['atmos']);
    });

    it('DD+ Atmos beats a plain E-AC-3 of the same language, even default and with more channels (derived)', async () => {
        const probe = editTracks(await probeHeader('mkv-multitrack-ac3-eac3joc-dtshdma-truehd-pgs.mkv'), (track) => {
            if (track.id === 2) {
                Object.assign(track, { codec: 'eac3', language: 'por', default: true });
                Object.assign(track.audio, { channels: 8, profile: null, atmos: false });
            }
            if (track.id === 3) track.default = false;
        });
        const result = rate(probe, null, { audioLanguages: ['por'] });
        expect(result.audio.initialTrack).toMatchObject({ id: 3, profile: 'E-AC-3 JOC', atmosOnTv: true });
        expect(result.audio.tracks[1]).toMatchObject({ id: 2, codec: 'eac3', atmos: false });
        expect(labelsOf(result)).toEqual(['atmos']);
    });

    it('preferred language por picks the DD+ Atmos track of the real multitrack MKV', async () => {
        const result = rate(await probeHeader('mkv-multitrack-ac3-eac3joc-dtshdma-truehd-pgs.mkv'), null, { audioLanguages: ['pt-BR'] });
        expect(result.audio.initialTrack).toMatchObject({ id: 3, codec: 'eac3', language: 'por', atmosOnTv: true });
        expect(labelsOf(result)).toEqual(['atmos']);
    });

    it('plain E-AC-3 (no JOC) has no Atmos label', async () => {
        const result = rate(await probeFixture('eac3-mp4'));
        expect(result.audio.initialTrack).toMatchObject({ codec: 'eac3', atmos: false });
        expect(result.labels).toEqual([]);
    });

    it('atmos: null (frame not read) + name "DDP Atmos" → Atmos from the name; without it, no label', async () => {
        const probe = await probeHeader('eac3joc-atmos.mkv', { sniffFrames: false });
        expect(probe.summary.atmos).toBeNull();
        const named = rate(probe, 'Movie.1080p.WEB-DL.DDP5.1.Atmos.H.264.mkv');
        expect(named.audio.initialTrack).toMatchObject({ atmos: true, atmosSource: 'name' });
        expect(named.labels).toEqual([{ code: 'atmos', text: 'Atmos', source: 'probe+name' }]);
        expect(rate(probe, 'Movie.1080p.WEB-DL.DDP5.1.mkv').labels).toEqual([]);
        // "TrueHD Atmos" in the name does not make the E-AC-3 track Atmos
        expect(rate(probe, 'Movie.TrueHD.7.1.Atmos.mkv').labels).toEqual([]);
    });

    it('name only: "DDP5.1 Atmos" / "DDPA5.1" → Atmos; "TrueHD Atmos" or Atmos without a codec → no label', () => {
        expect(rate(null, 'Movie.2160p.WEB-DL.DDP5.1.Atmos.HEVC').labels).toEqual([{ code: 'atmos', text: 'Atmos', source: 'name' }]);
        expect(labelsOf(rate(null, 'Movie.2160p.WEB-DL.DDPA5.1.H.265'))).toEqual(['atmos']);
        expect(labelsOf(rate(null, 'Movie.2160p.BluRay.REMUX.HEVC.TrueHD.7.1.Atmos'))).toEqual([]);
        expect(labelsOf(rate(null, 'Movie.2160p.BluRay.REMUX.HEVC.TrueHD7.1.Atmos-GRP.mkv'))).toEqual([]);
        expect(labelsOf(rate(null, 'Movie 2160p HEVC 5.1 Atmos.mkv'))).toEqual([]);
    });

    it('the name Atmos goes to one E-AC-3 track only: the default one (derived: kit-multi AAC tracks as E-AC-3, atmos null)', async () => {
        const probe = editTracks(await probeFixture('kit-multi-mkv'), (track) => {
            if (track.id === 2 || track.id === 3) {
                track.codec = 'eac3';
                track.audio.atmos = null;
            }
        });
        const result = rate(probe, 'Movie.2160p.DUAL.DDP5.1.Atmos.H265', { audioLanguages: ['por'] });
        expect(result.audio.tracks.filter((track) => track.atmos === true).map((track) => track.id)).toEqual([2]);
        expect(result.audio.initialTrack).toMatchObject({ id: 3, language: 'por', atmos: null });
        expect(labelsOf(result)).toEqual([]);
    });
});

describe('Linha 6 · E-AC-3 e AC-3 5.1, AAC (✅ downmix nos alto-falantes: toca direto)', () => {
    it.each([
        ['eac3-mp4', 'eac3', probeFixture],
        ['eac3-plain-no-joc.mp4', 'eac3', probeHeader],
        ['mkv-video-ac3-pgs.mkv', 'ac3', probeHeader],
        ['kit-multi-mkv', 'ac3', probeFixture],
        ['dv-p8.4-hlg-iphone.mov', 'aac', probeHeader],
    ])('%s: %s chosen, status ok, no audio warning', async (id, codec, run) => {
        const result = rate(await run(id));
        expect(result.audio.status).toBe('ok');
        expect(result.audio.initialTrack.codec).toBe(codec);
        expect(warningsOf(result).filter((code) => code.indexOf('AUDIO_') === 0)).toEqual([]);
        expect(result.tier).toBe('ok');
    });

    it('kit-multi-mkv (AAC eng default, AAC por, AC-3 5.1 eng): AC-3 5.1 for eng, AAC for por', async () => {
        const probe = await probeFixture('kit-multi-mkv');
        // No preference: the default track's language (eng), and AC-3 5.1 over AAC within it.
        expect(rate(probe).audio.initialTrack).toMatchObject({ id: 4, codec: 'ac3' });
        expect(rate(probe, null, { audioLanguages: ['eng'] }).audio.initialTrack).toMatchObject({ id: 4, codec: 'ac3', channels: 6 });
        expect(rate(probe, null, { audioLanguages: ['por'] }).audio.initialTrack).toMatchObject({ id: 3, codec: 'aac', language: 'por' });
    });
});

describe('Linha 7 · TrueHD com ou sem Atmos (❌ mudo: escolhe outra faixa; sem alternativa, avisa e rebaixa)', () => {
    it('TrueHD jpn preferred but mute: the compatible track is chosen and the skip is reported', async () => {
        const result = rate(await probeHeader('mkv-multitrack-ac3-eac3joc-dtshdma-truehd-pgs.mkv'), null, { audioLanguages: ['jpn'] });
        expect(result.audio.initialTrack).toMatchObject({ codec: 'dts', language: 'eng' });
        expect(result.warnings.find((warning) => warning.code === 'AUDIO_TRACK_SKIPPED')).toMatchObject({ track: 5, severity: 'info' });
        expect(result.audio.tracks.find((track) => track.codec === 'truehd').status).toBe('unsupported');
        expect(result.tier).toBe('ok');
    });

    it.each([
        ['dv-p5-truehd-atmos-mkv', probeFixture],
        ['truehd-atmos-mp4', probeFixture],
        ['truehd-atmos.mp4', probeHeader],
    ])('TrueHD only (%s): no initial track, warning, demoted, no Atmos label', async (id, run) => {
        const result = rate(await run(id));
        expect(result.audio.initialTrack).toBeNull();
        expect(result.audio.status).toBe('unsupported');
        expect(result.warnings.find((warning) => warning.code === 'AUDIO_UNSUPPORTED')).toMatchObject({ severity: 'demote' });
        expect(labelsOf(result)).not.toContain('atmos');
        expect(result.tier).toBe('demoted');
    });

    it('name only: TrueHD as the only codec → possibly mute, demoted less, probe recommended', () => {
        ['Movie.2160p.BluRay.REMUX.HEVC.TrueHD.7.1.Atmos.mkv', 'Movie.2160p.BluRay.REMUX.HEVC.TrueHD7.1.Atmos-GRP.mkv'].forEach((text) => {
            const result = rate(null, text);
            expect(warningsOf(result)).toEqual(['AUDIO_UNSUPPORTED_POSSIBLE']);
            expect(result.tier).toBe('demoted');
            expect(result.needsProbe).toBe(true);
        });
        // with a compatible codec also in the name there is nothing to warn about
        const withAc3 = rate(null, 'Movie.TrueHD.7.1.Atmos.AC3.5.1.mkv');
        expect(withAc3.warnings).toEqual([]);
        expect(withAc3.tier).toBe('ok');
    });

    it('TrueHD main track + AC-3 commentary: no alternative for the film → warning, demoted, no language bonus (derived)', async () => {
        const probe = await probeHeader('mkv-multitrack-ac3-eac3joc-dtshdma-truehd-pgs.mkv');
        probe.tracks = probe.tracks.filter((track) => track.id !== 3 && track.id !== 4);
        probe.tracks.forEach((track) => {
            if (track.id === 2) track.commentary = true;
            if (track.id === 5) track.language = 'eng';
        });
        const result = rate(probe, null, { audioLanguages: ['eng'] });
        expect(result.audio.initialTrack).toMatchObject({ id: 2, codec: 'ac3', secondary: true });
        expect(result.warnings.find((warning) => warning.code === 'AUDIO_ONLY_SECONDARY')).toMatchObject({ severity: 'demote', track: 2 });
        expect(warningsOf(result)).not.toContain('AUDIO_TRACK_SKIPPED');
        expect(result.tier).toBe('demoted');
        expect(result.score).toBe(-200);
    });

    it('a TrueHD-only stream sorts below one with a compatible track', async () => {
        const mute = rate(await probeFixture('truehd-atmos-mp4'));
        const ok = rate(await probeFixture('eac3-mp4'));
        expect([mute, ok].sort(compare)).toEqual([ok, mute]);
    });
});

describe('Linha 8 · DTS e DTS-HD (✅ na C8: a TV tocou DTS-HD MA 5.1 na Fase 8; F8.4)', () => {
    it('DTS in the preferred language beats DD+ Atmos in another one (the language comes first)', async () => {
        const result = rate(await probeFixture('dv-p81-multi-mkv'), null, { audioLanguages: ['eng'] });
        expect(result.audio.initialTrack).toMatchObject({ id: 3, codec: 'dts', profile: 'DTS-HD MA', language: 'eng', status: 'ok' });
        expect(warningsOf(result)).not.toContain('AUDIO_TRACK_SKIPPED');
        expect(labelsOf(result)).toEqual(['hdr10-on-tv', 'dts-hd-ma']);
        expect(result.audio.tracks.filter((track) => track.codec === 'dts').map((track) => track.status)).toEqual(['ok', 'ok']);
    });

    it('DD+ Atmos still beats DTS-HD MA in the same language (derived: dv-p81-multi-mkv, DTS-HD MA relabelled por)', async () => {
        const probe = editTracks(await probeFixture('dv-p81-multi-mkv'), (track) => {
            if (track.id === 3) Object.assign(track, { language: 'por', default: true });
            if (track.id === 2) track.default = false;
        });
        const result = rate(probe, null, { audioLanguages: ['por'] });
        expect(result.audio.initialTrack).toMatchObject({ id: 2, profile: 'E-AC-3 JOC', atmosOnTv: true });
        expect(result.audio.tracks[1]).toMatchObject({ id: 3, codec: 'dts' });
        expect(labelsOf(result)).toEqual(['hdr10-on-tv', 'atmos']);
    });

    it('multitrack MKV: eng DTS-HD MA chosen over eng AC-3', async () => {
        const result = rate(await probeHeader('mkv-multitrack-ac3-eac3joc-dtshdma-truehd-pgs.mkv'), null, { audioLanguages: ['eng'] });
        expect(result.audio.initialTrack).toMatchObject({ id: 4, codec: 'dts', language: 'eng', status: 'ok' });
        expect(result.audio.tracks[1]).toMatchObject({ id: 2, codec: 'ac3' });
        expect(labelsOf(result)).toEqual(['dts-hd-ma']);
        expect(result.tier).toBe('ok');
    });

    it('DTS-HD MA beats a plain E-AC-3 of the same language, even default and with more channels (derived)', async () => {
        const probe = editTracks(await probeHeader('mkv-multitrack-ac3-eac3joc-dtshdma-truehd-pgs.mkv'), (track) => {
            if (track.id === 3) {
                Object.assign(track, { language: 'eng', default: true });
                Object.assign(track.audio, { channels: 8, profile: null, atmos: false });
            }
            if (track.id === 4) track.default = false;
        });
        const result = rate(probe, null, { audioLanguages: ['eng'] });
        expect(result.audio.tracks.map((track) => track.id).slice(0, 3)).toEqual([4, 3, 2]);
    });

    it('DTS-HD MA main track beats an AC-3 commentary (derived: multitrack, AC-3 as commentary, no E-AC-3)', async () => {
        const probe = await probeHeader('mkv-multitrack-ac3-eac3joc-dtshdma-truehd-pgs.mkv');
        probe.tracks = probe.tracks.filter((track) => track.id !== 3);
        probe.tracks.forEach((track) => {
            if (track.id === 2) track.commentary = true;
        });
        const result = rate(probe, null, { audioLanguages: ['eng'] });
        expect(result.audio.initialTrack).toMatchObject({ id: 4, codec: 'dts', status: 'ok' });
        expect(warningsOf(result)).not.toContain('AUDIO_ONLY_SECONDARY');
    });

    it.each([
        ['dts-core-mkv', 'DTS', 'dts', probeFixture],
        ['dts-hdma-mkv', 'DTS-HD MA', 'dts-hd-ma', probeFixture],
        ['dts-x-mkv', 'DTS-HD MA + DTS:X', 'dts-hd-ma', probeFixture],
        ['dts-hdma-mp4', 'DTS-HD MA', 'dts-hd-ma', probeFixture],
        ['dtsc-mp4', 'DTS', 'dts', probeFixture],
        ['dts-hd-ma.mkv', 'DTS-HD MA', 'dts-hd-ma', probeHeader],
    ])('DTS only (%s, %s): plays, not demoted, labelled', async (id, profile, label, run) => {
        const result = rate(await run(id));
        expect(result.audio.initialTrack).toMatchObject({ codec: 'dts', profile, status: 'ok' });
        expect(warningsOf(result).filter((code) => /^AUDIO_/.test(code))).toEqual([]);
        expect(labelsOf(result)).toContain(label);
        expect(result.tier).toBe('ok');
    });

    it('DTS-HD (HRA) gets its own label (derived: DTS-HD MA relabelled)', async () => {
        const probe = editTracks(await probeFixture('dts-hdma-mkv'), (track) => {
            if (track.audio) track.audio.profile = 'DTS-HD';
        });
        expect(labelsOf(rate(probe))).toEqual(['dts-hd']);
    });

    it.each([
        ['dts-express-mka', 'DTS Express'],
        ['dtsx-mp4', 'DTS-UHD'],
    ])('DTS without a DTS core (%s, %s) counts as unsupported', async (id) => {
        const result = rate(await probeFixture(id));
        expect(result.audio.initialTrack).toBeNull();
        expect(warningsOf(result)).toContain('AUDIO_UNSUPPORTED');
        expect(labelsOf(result)).toEqual([]);
    });

    it('DTS-only sorts with a compatible stream (the addon order stays) and above TrueHD-only', async () => {
        const dts = rate(await probeFixture('dts-core-mkv'));
        const truehd = rate(await probeFixture('truehd-atmos-mp4'));
        const ac3 = rate(await probeHeader('mkv-video-ac3-pgs.mkv'));
        expect(compare(dts, ac3)).toBe(0);
        expect(sortStreams([truehd, dts, ac3])).toEqual([dts, ac3, truehd]);
    });

    it('name only: DTS as the only codec plays, with no warning and no probe needed', () => {
        const result = rate(null, 'Movie.1080p.BluRay.x264.DTS-HD.MA.5.1.mkv');
        expect(result.audio.status).toBe('ok');
        expect(result.warnings).toEqual([]);
        expect(result.needsProbe).toBe(false);
    });
});

describe('Linha 9 · AV1 (❌ oculta ou rebaixa)', () => {
    it('AV1 (Dolby Vision P10 sample) is hidden', async () => {
        const result = rate(await probeHeader('dv-p10-av1-dav1-moov-end.mp4'));
        expect(result.video).toMatchObject({ codec: 'av1', status: 'unsupported' });
        expect(result.warnings).toEqual([expect.objectContaining({ code: 'VIDEO_UNSUPPORTED', severity: 'hide' })]);
        expect(result.tier).toBe('hidden');
        expect(labelsOf(result)).toEqual([]);
    });

    it('name only: AV1 is hidden and sorts last', async () => {
        const av1 = rate(null, 'Movie.2160p.WEB-DL.AV1.Opus.mkv');
        expect(av1.tier).toBe('hidden');
        const p5 = rate(await probeFixture('dv-p5-truehd-atmos-mkv'));
        expect([av1, p5].sort(compare)).toEqual([p5, av1]);
    });
});

describe('Linha 10 · Velocidade ≠ 1x (❌ sem áudio: opção escondida)', () => {
    it('only the 1x playback rate is offered, with or without a probe', async () => {
        expect(rate(await probeFixture('eac3-mp4')).playbackRates).toEqual([1]);
        expect(rate(null, 'anything').playbackRates).toEqual([1]);
    });
});

describe('Linha 11 · Legendas PGS e VobSub (❌ ocultas; texto embutido fica)', () => {
    it('PGS is hidden, with an info warning', async () => {
        const result = rate(await probeHeader('mkv-video-ac3-pgs.mkv'));
        expect(result.subtitles.tracks).toEqual([]);
        expect(result.subtitles.hidden).toEqual([expect.objectContaining({ codec: 'pgs', language: 'eng', text: false })]);
        expect(result.warnings).toEqual([expect.objectContaining({ code: 'SUBTITLES_HIDDEN', severity: 'info' })]);
        expect(result.tier).toBe('ok');
    });

    it('embedded SRT stays visible', async () => {
        const result = rate(await probeFixture('kit-multi-mkv'));
        expect(result.subtitles.tracks.map((track) => [track.codec, track.language])).toEqual([['srt', 'eng'], ['srt', 'por']]);
        expect(result.subtitles.hidden).toEqual([]);
    });

    it('VobSub is hidden (derived: the PGS track of the real MKV as VobSub)', async () => {
        const probe = editTracks(await probeHeader('mkv-video-ac3-pgs.mkv'), (track) => {
            if (track.codec === 'pgs') track.codec = 'vobsub';
        });
        expect(rate(probe).subtitles.hidden.map((track) => track.codec)).toEqual(['vobsub']);
    });
});

describe('D6 · perfil da C8 embutido e ajustável por configuração', () => {
    it('the result says which profile version produced it', () => {
        expect(rate(null, 'x').profileVersion).toBe(1);
    });
    // Profile overrides are tested in profile.test.js.
});

describe('D7 · Dolby Vision: P5 em MP4 ativo; P8.1 (MP4 ou MKV) e P7 em MKV como HDR10 (F8.4); MKV P5 rebaixado com aviso', () => {
    it('the same P5 stream: active in MP4, demoted in MKV', async () => {
        const mp4 = rate(await probeFixture('dv-p5-mp4'));
        const mkv = rate(await probeFixture('dv-p5-truehd-atmos-mkv'));
        expect([mp4.video.output, mkv.video.output]).toEqual(['dolby-vision', 'wrong-colors']);
        expect([mp4.tier, mkv.tier]).toEqual(['ok', 'demoted']);
    });

    it('the same P8.1 stream: HDR10 on the C8 in MP4 (phase 8, F8.4) and in MKV; P5 in MP4 stays active', async () => {
        const mp4 = rate(await probeFixture('dv-p81-mp4'));
        const mkv = rate(await probeFixture('dv-p81-mkvmerge-mkv'));
        expect([mp4.video.output, mkv.video.output]).toEqual(['hdr10', 'hdr10']);
        expect(rate(await probeFixture('dv-p5-mp4')).video.output).toBe('dolby-vision');
    });
});

describe('D8 · Atmos: DD+ Atmos preferido; TrueHD trocado sozinho; DTS aceito na Fase 8 (F8.4)', () => {
    it('every audio track of the multitrack MKV gets the D8 status', async () => {
        const result = rate(await probeHeader('mkv-multitrack-ac3-eac3joc-dtshdma-truehd-pgs.mkv'));
        const byCodec = {};
        result.audio.tracks.forEach((track) => {
            byCodec[track.codec] = track.status;
        });
        expect(byCodec).toEqual({ ac3: 'ok', eac3: 'ok', dts: 'ok', truehd: 'unsupported' });
    });
});

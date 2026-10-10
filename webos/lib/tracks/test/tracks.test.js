/* global describe, it, expect, beforeAll */
// The menu lists and the initial audio track, over real headers: the kit's t2_multi.mkv (AAC eng,
// AAC por, AC-3 5.1 eng, SRT eng/por) and a multi-track MKV with AC-3, DD+ Atmos, DTS-HD MA,
// TrueHD Atmos and PGS (webos/tests/media/headers).

const { evaluate } = require('../../c8-rules');
const { probeFixture, probeHeader } = require('../../c8-rules/test/helpers');
const {
    trackId,
    trackIndex,
    readElementTracks,
    enabledIndex,
    buildAudioTracks,
    buildSubtitleTracks,
    chooseAudioTrack,
} = require('../index');

// What video.audioTracks lists for t2_multi.mkv in the emulator (ISO 639-1, empty labels).
const KIT_ELEMENT = [
    { language: 'en', label: '', enabled: true },
    { language: 'pt', label: '', enabled: false },
    { language: 'en', label: '', enabled: false },
];

let kit = null;
let multi = null;
let truehdOnly = null;
beforeAll(async () => {
    kit = await probeFixture('kit-multi-mkv');
    multi = await probeHeader('mkv-multitrack-ac3-eac3joc-dtshdma-truehd-pgs.mkv');
    truehdOnly = await probeHeader('truehd-atmos.mp4');
});

const audioMenu = (probe, elementTracks, selectedIndex) => buildAudioTracks({
    probe,
    rules: probe ? evaluate({ probe }) : null,
    elementTracks,
    selectedIndex: selectedIndex === undefined ? 0 : selectedIndex,
});
const summary = (tracks) => tracks.map((track) => [track.id, track.lang, track.label, track.mode]);

describe('track ids', () => {
    it('EMBEDDED_<n> both ways', () => {
        expect(trackId(2)).toBe('EMBEDDED_2');
        expect(trackIndex('EMBEDDED_2')).toBe(2);
        expect(trackIndex('EMBEDDED_x')).toBeNull();
        expect(trackIndex('EXCLUSIVE_1')).toBeNull();
        expect(trackIndex(null)).toBeNull();
    });
});

describe('audio menu', () => {
    it('t2_multi.mkv: the probe tracks, in file order, with language and codec', () => {
        const tracks = audioMenu(kit, KIT_ELEMENT, 0);
        expect(summary(tracks)).toEqual([
            ['EMBEDDED_0', 'eng', 'English AAC · AAC 1.0', 'showing'],
            ['EMBEDDED_1', 'por', 'Portugues AAC · AAC 1.0', 'disabled'],
            // the name already says the codec
            ['EMBEDDED_2', 'eng', 'AC3 5.1', 'disabled'],
        ]);
        expect(tracks[2]).toMatchObject({ origin: 'EMBEDDED', embedded: true, index: 2, probeId: 4, codec: 'ac3', channels: 6, status: 'ok' });
    });

    it('before the element lists its tracks, the probe alone', () => {
        expect(summary(audioMenu(kit, [], null)).map((entry) => entry[0])).toEqual(['EMBEDDED_0', 'EMBEDDED_1', 'EMBEDDED_2']);
    });

    it('without the probe, the element tracks (ISO 639-1 language, no codec)', () => {
        expect(summary(audioMenu(null, KIT_ELEMENT, 1))).toEqual([
            ['EMBEDDED_0', 'en', '', 'disabled'],
            ['EMBEDDED_1', 'pt', '', 'showing'],
            ['EMBEDDED_2', 'en', '', 'disabled'],
        ]);
    });

    it('probe and element disagree on the number of tracks: the element wins (its indexes are the ones that switch)', () => {
        const tracks = audioMenu(kit, KIT_ELEMENT.slice(0, 2), 0);
        expect(tracks.map((track) => [track.id, track.lang, track.probeId])).toEqual([['EMBEDDED_0', 'en', null], ['EMBEDDED_1', 'pt', null]]);
    });

    it('a track without language in the file takes the element one', () => {
        const noLanguage = JSON.parse(JSON.stringify(kit));
        noLanguage.tracks.filter((track) => track.id === 3)[0].language = null;
        expect(audioMenu(noLanguage, KIT_ELEMENT, 0)[1].lang).toBe('pt');
        expect(audioMenu(noLanguage, [], 0)[1].lang).toBe('');
    });

    it('multi-track MKV: TrueHD is left out (it does not play), the others keep their file index', () => {
        expect(summary(audioMenu(multi, [], 0))).toEqual([
            ['EMBEDDED_0', 'eng', 'AC-3 1.0', 'showing'],
            ['EMBEDDED_1', 'por', 'DD+ Atmos 5.1', 'disabled'],
            ['EMBEDDED_2', 'eng', 'DTS-HD MA 7.1', 'disabled'],
        ]);
        expect(audioMenu(multi, [], 0).map((track) => track.status)).toEqual(['ok', 'ok', 'unconfirmed']);
    });

    it('only TrueHD: listed anyway (nothing else to offer)', () => {
        expect(audioMenu(truehdOnly, [], 0).map((track) => [track.id, track.label, track.status])).toEqual([['EMBEDDED_0', 'TrueHD Atmos 7.1', 'unsupported']]);
    });
});

describe('subtitle menu (listing only)', () => {
    it('t2_multi.mkv: both SRT tracks with language', () => {
        expect(buildSubtitleTracks({ probe: kit }).map((track) => [track.id, track.lang, track.label, track.mode, track.embedded])).toEqual([
            ['EMBEDDED_0', 'eng', 'SRT', 'disabled', true],
            ['EMBEDDED_1', 'por', 'SRT', 'disabled', true],
        ]);
    });

    it('bitmap subtitles (PGS) are hidden; the ids keep the file position', () => {
        expect(buildSubtitleTracks({ probe: multi })).toEqual([]);
        const mixed = JSON.parse(JSON.stringify(kit));
        mixed.tracks.filter((track) => track.id === 5)[0].subtitle.text = false;
        mixed.tracks.filter((track) => track.id === 6)[0].forced = true;
        expect(buildSubtitleTracks({ probe: mixed }).map((track) => [track.id, track.label])).toEqual([['EMBEDDED_1', 'SRT · forced']]);
    });

    it('no probe, no embedded subtitles', () => {
        expect(buildSubtitleTracks({ probe: null })).toEqual([]);
    });
});

describe('initial audio track', () => {
    const choose = (probe, elementTracks, languages, selectedId) => {
        const tracks = audioMenu(probe, elementTracks, 0);
        const track = chooseAudioTrack({ tracks, probe, stream: null, languages, selectedId: selectedId || 'EMBEDDED_0' });
        return track ? track.id : null;
    };

    it('t2_multi.mkv: the preferred language, and among its tracks the best codec (AC-3 5.1 over AAC)', () => {
        expect(choose(kit, KIT_ELEMENT, ['por'])).toBe('EMBEDDED_1');
        expect(choose(kit, KIT_ELEMENT, ['pt'])).toBe('EMBEDDED_1');
        expect(choose(kit, KIT_ELEMENT, ['eng'])).toBe('EMBEDDED_2');
        // the stream preference first, then the global setting
        expect(choose(kit, KIT_ELEMENT, [undefined, 'por'])).toBe('EMBEDDED_1');
        expect(choose(kit, KIT_ELEMENT, ['jpn', 'por'])).toBe('EMBEDDED_1');
        // no preferred language: the language of the default track
        expect(choose(kit, KIT_ELEMENT, [])).toBe('EMBEDDED_2');
    });

    it('multi-track MKV: a track that plays, never TrueHD; DTS waits for phase 8', () => {
        expect(choose(multi, [], ['jpn'])).toBe('EMBEDDED_0');
        expect(choose(multi, [], ['por'])).toBe('EMBEDDED_1');
        // AC-3 eng plays; the DTS-HD MA eng is "to be confirmed" (D8)
        expect(choose(multi, [], ['eng'])).toBe('EMBEDDED_0');
    });

    it('nothing plays: no choice (the pipeline keeps its track)', () => {
        expect(choose(truehdOnly, [], ['eng'])).toBeNull();
    });

    it('without the probe: the preferred language, keeping the selected track when it matches', () => {
        expect(choose(null, KIT_ELEMENT, ['por'])).toBe('EMBEDDED_1');
        expect(choose(null, KIT_ELEMENT, ['eng'], 'EMBEDDED_2')).toBe('EMBEDDED_2');
        expect(choose(null, KIT_ELEMENT, ['eng'], 'EMBEDDED_1')).toBe('EMBEDDED_0');
        expect(choose(null, KIT_ELEMENT, ['jpn'])).toBeNull();
        expect(choose(null, KIT_ELEMENT, [])).toBeNull();
    });
});

describe('element tracks', () => {
    it('reads the AudioTrackList and finds the enabled one', () => {
        const list = [{ language: 'en', label: '', enabled: false }, { language: 'pt', enabled: true }];
        const tracks = readElementTracks({ audioTracks: list });
        expect(tracks).toEqual([{ language: 'en', label: '', enabled: false }, { language: 'pt', label: '', enabled: true }]);
        expect(enabledIndex(tracks)).toBe(1);
        expect(enabledIndex([])).toBeNull();
        expect(readElementTracks({})).toEqual([]);
        expect(readElementTracks(null)).toEqual([]);
    });
});

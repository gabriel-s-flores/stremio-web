/* global describe, it, expect, beforeAll */
// Initial audio track: compatible first, then the user's languages, then the file's own
// language, main over commentary, codec preference, default flag. Real multi-track headers.

const { evaluate } = require('../index');
const { probeFixture, probeHeader, editTracks } = require('./helpers');

const MULTI = 'mkv-multitrack-ac3-eac3joc-dtshdma-truehd-pgs.mkv';
let kitMulti = null;
beforeAll(async () => {
    kitMulti = await probeFixture('kit-multi-mkv');
});
// kit-multi-mkv with the AC-3 5.1 eng track renamed (commentary flag off).
const editTracksSync = (name) => editTracks(kitMulti, (track) => {
    if (track.id === 4) Object.assign(track, { name, commentary: false });
});

const initial = (probe, audioLanguages) => evaluate({ probe, preferences: { audioLanguages } }).audio.initialTrack;

describe('initial audio track', () => {
    it('follows the order of the preferred languages', async () => {
        const probe = await probeHeader(MULTI);
        expect(initial(probe, ['por', 'eng']).language).toBe('por');
        expect(initial(probe, ['eng', 'por']).language).toBe('eng');
        // a preferred language with no playable track falls through to the next one
        expect(initial(probe, ['jpn', 'por']).language).toBe('por');
    });

    it('accepts the language codes of the app settings, video.audioTracks and BCP 47', async () => {
        const probe = await probeHeader(MULTI);
        ['por', 'pt', 'pt-BR'].forEach((code) => expect(initial(probe, [code]).id).toBe(3));
    });

    it('without a match, keeps the language of the file default track', async () => {
        const probe = await probeHeader(MULTI);
        expect(initial(probe, ['ita'])).toMatchObject({ codec: 'dts', language: 'eng' });
        expect(initial(probe, [])).toMatchObject({ codec: 'dts', language: 'eng' });
    });

    it('MP4 tracks with ISO 639-2/T codes match bibliographic preferences (fra = fre)', async () => {
        const probe = editTracks(await probeFixture('kit-multi-mkv'), (track) => {
            if (track.id === 3) track.language = 'fra';
        });
        expect(initial(probe, ['fre'])).toMatchObject({ id: 3, language: 'fra' });
    });

    it('a commentary track loses to the main track of the same language (derived)', async () => {
        const probe = editTracks(await probeFixture('kit-multi-mkv'), (track) => {
            if (track.id === 4) track.commentary = true;
        });
        expect(initial(probe, ['eng'])).toMatchObject({ id: 2, codec: 'aac' });
    });

    it('a commentary is also recognised by the track name (MP4 has no commentary flag)', async () => {
        ['Director Commentary', 'Comentário do diretor', 'Commentaire audio'].forEach((name) => {
            const probe = editTracksSync(name);
            expect(initial(probe, ['eng'])).toMatchObject({ id: 2, codec: 'aac' });
        });
    });

    it('FLAC above 2 channels counts as unsupported (derived: AC-3 5.1 track as FLAC)', async () => {
        const probe = editTracks(await probeFixture('kit-multi-mkv'), (track) => {
            if (track.id === 4) track.codec = 'flac';
        });
        const result = evaluate({ probe, preferences: { audioLanguages: ['eng'] } });
        expect(result.audio.tracks.find((track) => track.id === 4).status).toBe('unsupported');
        expect(result.audio.initialTrack.id).toBe(2);
    });

    it('lists every track with its status, best first', async () => {
        const result = evaluate({ probe: await probeHeader(MULTI), preferences: { audioLanguages: ['por'] } });
        expect(result.audio.tracks.map((track) => [track.id, track.codec, track.status])).toEqual([
            [3, 'eac3', 'ok'], [4, 'dts', 'ok'], [2, 'ac3', 'ok'], [5, 'truehd', 'unsupported'],
        ]);
        expect(result.audio.initialTrack).toBe(result.audio.tracks[0]);
    });

    it('scores a playable track in a preferred language', async () => {
        const probe = await probeFixture('kit-multi-mkv');
        const por = evaluate({ probe, preferences: { audioLanguages: ['por'] } });
        const ita = evaluate({ probe, preferences: { audioLanguages: ['ita'] } });
        expect(por.score - ita.score).toBe(20);
    });

    it('a file without audio tracks has no initial track and no audio warning', async () => {
        const result = evaluate({ probe: await probeFixture('dv-p81-mp4') });
        expect(result.audio).toEqual({ status: null, initialTrack: null, tracks: [], atmos: false });
        expect(result.warnings.filter((warning) => /^AUDIO_/.test(warning.code))).toEqual([]);
    });
});

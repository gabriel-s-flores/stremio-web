// webOS TV 4.x build only (resolved instead of useAudio.ts, F5.4). The same hook, but the track
// it selects on its own follows the C8 rules (webos/lib/tracks, webos/lib/c8-rules): a track the TV
// plays, in the first preferred language that has one. The upstream hook takes the first track in
// the preferred language, which on the C8 can be a TrueHD or DTS one. Unchanged: the track saved
// for the stream wins, a choice made in the menu locks the selection until the stream changes, and
// it is saved as the stream state and as the audio preference.

const { useCallback, useEffect, useRef } = require('react');
const { chooseAudioTrack } = require('../../../webos/lib/tracks');
const { probeCache } = require('../../../webos/lib/tracks/probe-cache');
const { normalizeLanguage } = require('../../../webos/lib/c8-rules');

const findPreferredTrack = (tracks, selectedId, savedTrack, preference, globalLanguage, stream) => {
    const preferredLanguage = normalizeLanguage(preference?.language) ?? normalizeLanguage(savedTrack?.language);
    const saved = tracks.find((track) => track.id === savedTrack?.id);
    if (saved && (!preferredLanguage || normalizeLanguage(saved.lang) === preferredLanguage)) {
        return saved;
    }

    return chooseAudioTrack({
        tracks,
        probe: stream && typeof stream.url === 'string' ? probeCache.peek(stream.url) : null,
        stream,
        languages: [preferredLanguage, globalLanguage],
        selectedId,
    });
};

const useAudio = ({ player, video, settings, streamStateChanged, audioPreferenceChanged }) => {
    const videoRef = useRef(video);
    const trackSelectionLocked = useRef(false);
    const appliedTrack = useRef(null);

    videoRef.current = video;

    const selectTrack = useCallback((id) => {
        const currentVideo = videoRef.current;
        const track = currentVideo.state.audioTracks.find((track) => track.id === id);
        if (!track) {
            return;
        }

        const language = normalizeLanguage(track.lang);
        trackSelectionLocked.current = true;
        appliedTrack.current = id;
        currentVideo.setAudioTrack(id);
        streamStateChanged({ audioTrack: { id, ...(language ? { language } : {}) } });
        audioPreferenceChanged(language ? { language } : {});
    }, [streamStateChanged, audioPreferenceChanged]);

    useEffect(() => {
        trackSelectionLocked.current = false;
        appliedTrack.current = null;
    }, [video.state.stream]);

    useEffect(() => {
        if (trackSelectionLocked.current || video.state.stream === null) {
            return;
        }

        const track = findPreferredTrack(
            video.state.audioTracks,
            video.state.selectedAudioTrackId,
            player.streamState?.audioTrack,
            player.audioPreference,
            settings.audioLanguage,
            video.state.stream,
        );
        if (!track) {
            appliedTrack.current = null;
            return;
        }

        if (appliedTrack.current === track.id) {
            return;
        }

        videoRef.current.setAudioTrack(track.id);
        appliedTrack.current = track.id;
    }, [
        player.audioPreference,
        player.streamState,
        settings.audioLanguage,
        video.state.audioTracks,
        video.state.selectedAudioTrackId,
        video.state.stream,
    ]);

    return selectTrack;
};

module.exports = { default: useAudio };

/* global describe, it, expect */
// Drift guard: the F5.5 subtitles changes rely on upstream details (stremio-video's WebOsVideo and
// withHTMLSubtitles, the Player and the Player settings). If one changes, this fails before the
// webOS code goes silently stale.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const VIDEO_SRC = path.join(path.dirname(require.resolve('@stremio/stremio-video/package.json', { paths: [ROOT] })), 'src');
const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8');

describe('upstream details the F5.5 subtitles depend on', () => {
    const webOsVideo = read(VIDEO_SRC, 'WebOsVideo', 'WebOsVideo.js');

    it('WebOsVideo numbers only the subtitles it does not hide and sends that number to Luna', () => {
        // the convention LUNA_TEXT_INDEX_COUNTS_BITMAP = false follows
        expect(webOsVideo).toMatch(/unsupportedSubs: \['HDMV\/PGS', 'VOBSUB'\]/);
        expect(webOsVideo).toMatch(/if \(device\.unsupportedSubs\.includes\(track\.codec \|\| ''\)\) \{\s*return;\s*\}\s*var textTrackId = nrSubs;\s*nrSubs\+\+;/);
        expect(webOsVideo).toMatch(/'type': 'text',\s*'mediaId': videoElement\.mediaId,\s*'index': trackIndex/);
    });

    it('WebOsVideo turns the pipeline subtitles on with the style calls for an EMBEDDED_ id, off for anything else', () => {
        expect(webOsVideo).toMatch(/if \(\(propValue \|\| ''\)\.indexOf\('EMBEDDED_'\) === 0\) \{\s*toggleSubtitles\(true\);/);
        expect(webOsVideo).toMatch(/'setSubtitleCharacterColor',\s*'setSubtitleBackgroundColor',\s*'setSubtitlePosition',\s*'setSubtitleFontSize',/);
        expect(webOsVideo).toMatch(/if \(\(propValue \|\| ''\)\.indexOf\('EMBEDDED_'\) === -1\) \{\s*currentSubTrack = null;\s*onPropChanged\('selectedSubtitlesTrackId'\);\s*toggleSubtitles\(false\);/);
        // the color keys the webOS colors map to
        ['#FFFFFFFF', '#FFFF00FF', '#FF0000FF', '#00FF00FF', '#0000FFFF', '#000000FF'].forEach((key) => {
            expect(webOsVideo).toContain(`'${key}': `);
        });
        expect(webOsVideo).toMatch(/'rgba\(0, 0, 0, 0\)': 'none'/);
    });

    it('withHTMLSubtitles passes the embedded selection to the video unless the ASS styling is on; add-on tracks are fetched by url', () => {
        const source = read(VIDEO_SRC, 'withHTMLSubtitles', 'withHTMLSubtitles.js');
        expect(source).toMatch(/if \(assSubtitlesStylingEnabled && selectedVideoTrack && embeddedASSSource !== null\)/);
        expect(source).toMatch(/assSubtitlesStylingEnabled = commandArgs\.assSubtitlesStyling === true;/);
        expect(source).toMatch(/var url = isFallback \? track\.fallbackUrl : track\.url;/);
        expect(source).toMatch(/command\('addExtraSubtitlesTracks', \{\s*tracks: commandArgs\.stream\.subtitles\.map/);
    });

    it('the Player loads with the ASS setting and adds the add-on subtitles through video.addExtraSubtitlesTracks', () => {
        expect(read(ROOT, 'src', 'routes', 'Player', 'Player.js')).toMatch(/assSubtitlesStyling: settings\.assSubtitlesStyling,/);
        expect(read(ROOT, 'src', 'routes', 'Player', 'useSubtitles.ts')).toMatch(/video\.addExtraSubtitlesTracks\(externalSubtitles\);/);
        expect(read(ROOT, 'src', 'routes', 'Player', 'useVideo.js')).toMatch(/const addExtraSubtitlesTracks = React\.useCallback\(\(tracks\) => \{/);
    });

    it('the Player settings render the ASS option as an Option with that label (Player.webos.tsx drops it)', () => {
        const settings = read(ROOT, 'src', 'routes', 'Settings', 'Player', 'Player.tsx');
        expect(settings).toMatch(/<Option label=\{'SETTINGS_ASS_SUBTITLES_STYLING'\}>/);
        expect(settings).toMatch(/const Player = forwardRef<HTMLDivElement, Props>\(/);
        expect(read(ROOT, 'src', 'routes', 'Settings', 'Player', 'Player.webos.tsx')).toMatch(/const ASS_STYLING_LABEL = 'SETTINGS_ASS_SUBTITLES_STYLING';/);
    });
});

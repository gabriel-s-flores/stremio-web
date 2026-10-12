// Streams of the local test addon (F6.2; reused by F6.4): debrid-like names and files whose
// headers match them, so the C8 rules can be checked on the name alone and with the probe.
// Two sets (SETS): `f62` (STREAMS, the default) and `e2e` (E2E_STREAMS, the end-to-end run).
// The order is the addon's (like a debrid addon sorted by resolution), not the C8 one.
//
// `media` is the file under the media root that server.mjs prepares (see README.md):
//   kit/<file>       kit media (webos/tools/gen-media.sh, GOP=24): real files that play;
//   headers/<file>   webos/tests/media/headers (F0.10 catalogue): small real files, headers only;
//   fixtures/<id>.*  header probe fixtures (F5.2) rebuilt at their original size (sparse file:
//                    the recorded bytes at their offsets, zeros elsewhere). Probe only, no playback.
// `expect` documents what the rules say (checked by webos/tests/streams/ranking.test.js).

const TITLE = 'Filme.2023';

const STREAMS = [
    {
        id: 'remux-dv-p5-truehd',
        name: '[RD+] Teste\n4k DV | HDR',
        description: `${TITLE}.2160p.BluRay.REMUX.DV.P5.HEVC.TrueHD.7.1.Atmos-GRP.mkv\n💾 58.4 GB ⚙️ Teste`,
        media: 'fixtures/dv-p5-truehd-atmos-mkv.mkv',
        expect: { name: ['demoted', 'DV_WRONG_COLORS', 'AUDIO_UNSUPPORTED_POSSIBLE'], probe: ['demoted', 'DV_WRONG_COLORS', 'AUDIO_UNSUPPORTED'] },
    },
    {
        id: 'remux-unnamed',
        name: '[RD+] Teste\n4k',
        description: `${TITLE}.2160p.UHD.BluRay.REMUX-GRP.mkv\n💾 61.2 GB ⚙️ Teste`,
        media: 'fixtures/dv-p5-nobam-mkv.mkv',
        expect: { name: ['ok'], probe: ['demoted', 'DV_WRONG_COLORS', 'AUDIO_UNSUPPORTED'] },
    },
    {
        id: 'web-dv-hdr10-atmos-mkv',
        name: '[RD+] Teste\n4k DV | HDR10',
        description: `${TITLE}.2160p.WEB-DL.DV.HDR10.DDP5.1.Atmos.MULTI-GRP.mkv\n💾 18.9 GB ⚙️ Teste`,
        media: 'fixtures/dv-p81-multi-mkv.mkv',
        expect: { name: ['ok', 'hdr10-on-tv', 'atmos'], probe: ['ok', 'hdr10-on-tv', 'atmos'] },
    },
    {
        id: 'truehd-only',
        name: '[RD+] Teste\n1080p',
        description: `${TITLE}.1080p.BluRay.TrueHD.7.1.Atmos-GRP.mp4\n💾 21.0 GB ⚙️ Teste`,
        media: 'fixtures/truehd-atmos-mp4.mp4',
        expect: { name: ['demoted', 'AUDIO_UNSUPPORTED_POSSIBLE'], probe: ['demoted', 'AUDIO_UNSUPPORTED'] },
    },
    {
        id: 'web-dv-p81-mp4',
        name: '[RD+] Teste\n4k DV',
        description: `${TITLE}.2160p.WEB-DL.DV.HEVC-GRP.mp4\n💾 14.2 GB ⚙️ Teste`,
        media: 'fixtures/dv-p81-mp4.mp4',
        expect: { name: ['ok', 'dv'], probe: ['ok', 'dv'] },
    },
    {
        id: 'web-dv-p5-mp4',
        name: '[RD+] Teste\n4k DV',
        description: `${TITLE}.2160p.WEB-DL.DV.P5.HEVC-GRP.mp4\n💾 13.8 GB ⚙️ Teste`,
        media: 'fixtures/dv-p5-mp4.mp4',
        expect: { name: ['ok', 'dv'], probe: ['ok', 'dv'] },
    },
    {
        id: 'dts-hd-ma',
        name: '[RD+] Teste\n1080p',
        description: `${TITLE}.1080p.BluRay.DTS-HD.MA.7.1-GRP.mkv\n💾 16.3 GB ⚙️ Teste`,
        media: 'headers/dts-hd-ma.mkv',
        expect: { name: ['ok'], probe: ['ok', 'dts-hd-ma'] },
    },
    {
        id: 'web-hevc10-ddp',
        name: '[RD+] Teste\n1080p',
        description: `${TITLE}.1080p.WEB-DL.HEVC.10bit.DDP5.1-GRP.mp4\n💾 4.1 GB ⚙️ Teste`,
        media: 'kit/t3_hevc10_eac3.mp4',
        expect: { name: ['ok'], probe: ['ok'] },
    },
    {
        id: 'web-multi-mkv',
        name: '[RD+] Teste\n1080p',
        description: `${TITLE}.1080p.WEB-DL.H264.MULTI.AC3.AAC-GRP.mkv\n💾 3.2 GB ⚙️ Teste`,
        media: 'kit/t2_multi.mkv',
        expect: { name: ['ok'], probe: ['ok'] },
    },
    {
        id: 'web-unnamed-atmos',
        name: '[RD+] Teste\n720p',
        description: `${TITLE}.720p.WEB-DL-GRP.mp4\n💾 1.9 GB ⚙️ Teste`,
        media: 'fixtures/eac3-joc-mp4.mp4',
        expect: { name: ['ok'], probe: ['ok', 'atmos'] },
    },
    {
        id: 'web-h264-aac',
        name: '[RD+] Teste\n720p',
        description: `${TITLE}.720p.WEB-DL.H264.AAC-GRP.mp4\n💾 1.2 GB ⚙️ Teste`,
        media: 'kit/t1_h264_aac.mp4',
        expect: { name: ['ok'], probe: ['ok'] },
    },
    {
        id: 'web-av1',
        name: '[RD+] Teste\n4k',
        description: `${TITLE}.2160p.WEB-DL.AV1.Opus-GRP.mp4\n💾 6.6 GB ⚙️ Teste`,
        media: 'headers/dv-p10-av1-dav1-moov-end.mp4',
        expect: { name: ['hidden', 'VIDEO_UNSUPPORTED'], probe: ['hidden', 'VIDEO_UNSUPPORTED'] },
    },
    {
        // Not in the debrid cache: never probed (the addon would start the download).
        id: 'uncached-hdr10',
        name: '[RD download] Teste\n4k HDR',
        description: `${TITLE}.2160p.WEB-DL.HDR10.HEVC.DDP5.1-GRP.mkv\n💾 17.5 GB ⚙️ Teste`,
        media: 'kit/t4_h264_eac3.mkv',
        expect: { name: ['ok', 'hdr10'], probe: null },
    },
    {
        // Needs the streaming server: hidden on webOS by F6.1.
        id: 'torrent',
        name: '[P2P] Teste\n4k',
        description: `${TITLE}.2160p.WEB-DL.HEVC-GRP.mkv\n👤 42 💾 15.0 GB ⚙️ Teste`,
        infoHash: '0123456789abcdef0123456789abcdef01234567',
        fileIdx: 0,
        expect: null,
    },
];

// The `e2e` set (F6.4, `server.mjs --set e2e`): what a debrid addon answers for a movie, with files
// that play in the emulator (webos/tests/e2e/make-media.sh, under e2e/) and the variations of a
// real list: a DV P5 + TrueHD REMUX on top (the C8 rules move it down), an unnamed REMUX that only
// the probe moves down, 1080p H.264 AAC, 4K HEVC
// HDR10, an MKV with several audio tracks, embedded subtitles and
// add-on subtitles, a link that expired (the resolver redirects to a host that answers 410) and a
// torrent (hidden by F6.1). `subtitles` are add-on subtitles (files under e2e/, like an
// OpenSubtitles answer attached to the stream). Order and labels come from the C8 rules
// (webos/tests/e2e/catalog.test.js).
const E2E_STREAMS = [
    {
        // First in the addon's order (biggest file), demoted by the C8 rules (probe only, no playback).
        id: 'e2e-remux-dv-p5-truehd',
        name: '[RD+] Teste\n4k DV | HDR',
        description: `${TITLE}.2160p.BluRay.REMUX.DV.P5.HEVC.TrueHD.7.1.Atmos-GRP.mkv\n💾 58.4 GB ⚙️ Teste`,
        media: 'fixtures/dv-p5-truehd-atmos-mkv.mkv',
        expect: { name: ['demoted', 'DV_WRONG_COLORS', 'AUDIO_UNSUPPORTED_POSSIBLE'], probe: ['demoted', 'DV_WRONG_COLORS', 'AUDIO_UNSUPPORTED'] },
    },
    {
        // Nothing in the name: next to the top by the name, among the first probes, and only the probe
        // (DV P5 + TrueHD) moves it down. The list order then depends on the probe (review c1, finding 5).
        id: 'e2e-remux-unnamed',
        name: '[RD+] Teste\n4k',
        description: `${TITLE}.2160p.UHD.BluRay.REMUX-GRP.mkv\n💾 61.2 GB ⚙️ Teste`,
        media: 'fixtures/dv-p5-nobam-mkv.mkv',
        expect: { name: ['ok'], probe: ['demoted', 'DV_WRONG_COLORS', 'AUDIO_UNSUPPORTED'] },
    },
    {
        id: 'e2e-uhd-hdr10',
        name: '[RD+] Teste\n4k HDR',
        description: `${TITLE}.2160p.WEB-DL.HDR10.HEVC.DDP5.1-GRP.mkv\n💾 16.8 GB ⚙️ Teste`,
        media: 'e2e/e2e_2160p_hevc_hdr10.mkv',
        expect: { name: ['ok', 'hdr10'], probe: ['ok', 'hdr10'] },
    },
    {
        id: 'e2e-fhd-h264-aac',
        name: '[RD+] Teste\n1080p',
        description: `${TITLE}.1080p.WEB-DL.H264.AAC-GRP.mp4\n💾 2.4 GB ⚙️ Teste`,
        media: 'e2e/e2e_1080p_h264_aac.mp4',
        expect: { name: ['ok'], probe: ['ok'] },
    },
    {
        id: 'e2e-multi-subs',
        name: '[RD+] Teste\n720p',
        description: `${TITLE}.720p.WEB-DL.H264.MULTI.AAC.AC3.SUBS-GRP.mkv\n💾 1.6 GB ⚙️ Teste`,
        media: 'e2e/e2e_720p_multi_subs.mkv',
        subtitles: [{ lang: 'eng', file: 'e2e/e2e_addon_eng.srt' }, { lang: 'por', file: 'e2e/e2e_addon_por.srt' }],
        expect: { name: ['ok'], probe: ['ok'] },
    },
    {
        // The resolver still answers (302), the file host says the link expired (410): F6.3.
        id: 'e2e-expired',
        name: '[RD+] Teste\n1080p',
        description: `${TITLE}.1080p.BluRay.H264.AC3-GRP.mkv\n💾 9.7 GB ⚙️ Teste`,
        media: 'e2e/e2e_1080p_h264_aac.mp4',
        path: 'status/410/e2e/e2e_1080p_h264_aac.mp4',
        expect: { name: ['ok'], probe: null },
    },
    {
        id: 'e2e-torrent',
        name: '[P2P] Teste\n1080p',
        description: `${TITLE}.1080p.WEB-DL.H264.AAC-GRP.mp4\n👤 12 💾 2.4 GB ⚙️ Teste`,
        infoHash: 'fedcba9876543210fedcba9876543210fedcba98',
        fileIdx: 0,
        expect: null,
    },
];

const SETS = { f62: STREAMS, e2e: E2E_STREAMS };

const MANIFEST = {
    id: 'io.github.gabrielsflores.webos.test-debrid',
    version: '1.0.0',
    name: 'Debrid de teste',
    description: 'Addon local dos testes do port webOS (webos/tests/addon): streams com nomes de debrid e mídias do kit/fixtures.',
    resources: ['stream'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: [],
    behaviorHints: { configurable: false },
};

const fileNameOf = (entry) => entry.description.split('\n')[0];

// The addon stream objects; `mediaUrl` is the media server as the client sees it; `set` is a key
// of SETS (default: the F6.2 one).
const toStreams = (mediaUrl, set) => (set ? SETS[set] : STREAMS).map((entry) => {
    const stream = { name: entry.name, description: entry.description, behaviorHints: { filename: fileNameOf(entry), bingeGroup: `teste-${entry.id}` } };
    if (entry.infoHash) {
        stream.infoHash = entry.infoHash;
        stream.fileIdx = entry.fileIdx;
    } else {
        // /redirect/ answers 302, like a debrid link.
        stream.url = `${mediaUrl}/redirect/${entry.path || entry.media}`;
    }
    if (entry.subtitles) {
        stream.subtitles = entry.subtitles.map((subtitle) => ({ id: `${entry.id}-${subtitle.lang}`, lang: subtitle.lang, url: `${mediaUrl}/${subtitle.file}` }));
    }
    return stream;
});

module.exports = { STREAMS, E2E_STREAMS, SETS, MANIFEST, toStreams, fileNameOf };

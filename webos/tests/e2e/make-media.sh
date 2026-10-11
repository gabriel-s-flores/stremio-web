#!/usr/bin/env bash
# Media of the end-to-end run (F6.4): the files behind the streams of the test addon's `e2e` set
# (webos/tests/addon/catalog.js), each one matching what its debrid-like name says.
#   webos/tests/e2e/make-media.sh [folder]      (default: $E2E_MEDIA_DIR or ~/webos-tv-sdk/media-tests/e2e)
# Files already there are kept (delete one to make it again).
#   e2e_1080p_h264_aac.mp4      1920x1080 H.264, AAC stereo, 120 s
#   e2e_2160p_hevc_hdr10.mkv    3840x2160 HEVC Main10 with HDR10 (PQ, BT.2020, mastering display), E-AC3 5.1, 10 s:
#                               for the list and the probe only (the emulator decodes in software, up to 1080p)
#   e2e_720p_multi_subs.mkv     1280x720 H.264, audio AAC eng / AAC por / AC3 5.1 eng, embedded SRT eng and por
#                               ("EN-SRT n" / "PT-SRT n", one per 2 s), 120 s
#   e2e_addon_eng.srt, e2e_addon_por.srt   add-on subtitles of the MKV stream ("ADDON EN n" / "ADDON PT n")
# Long enough for the whole Player part of the run (a clip that ends sends the Player back on its own);
# GOP of 24 frames (1 s) so that seeks land near the asked time. The picture has a burned-in clock and
# the file name, so the VM screenshots show which stream plays and whether it moves.
set -euo pipefail
OUT="${1:-${E2E_MEDIA_DIR:-$HOME/webos-tv-sdk/media-tests/e2e}}"
mkdir -p "$OUT"
cd "$OUT"
q=(-loglevel error -y -nostdin)
gop=(-g 24 -keyint_min 24 -sc_threshold 0)
FONT="$(fc-match -f '%{file}' 'DejaVu Sans:bold' 2>/dev/null || true)"
# testsrc2 with the time and a label drawn on it.
picture() { # <size> <seconds> <label>
    local text="drawtext=text='$3  %{pts\\:hms}':fontsize=h/14:fontcolor=white:box=1:boxcolor=black@0.6:x=(w-tw)/2:y=h-th*2"
    [[ -n "$FONT" ]] && text="$text:fontfile=$FONT"
    echo "testsrc2=size=$1:rate=24:duration=$2,$text"
}
srt() { # <prefix> <seconds> <file>: one cue per 2 s
    local i=0 s
    : > "$3"
    for ((s = 0; s < $2; s += 2)); do
        i=$((i + 1))
        printf '%d\n%s --> %s\n%s %d\n\n' "$i" "$(date -u -d "@$s" +%H:%M:%S),000" "$(date -u -d "@$s" +%H:%M:%S),900" "$1" "$i" >> "$3"
    done
}

[[ -s e2e_addon_eng.srt ]] || srt 'ADDON EN' 120 e2e_addon_eng.srt
[[ -s e2e_addon_por.srt ]] || srt 'ADDON PT' 120 e2e_addon_por.srt

if [[ ! -s e2e_1080p_h264_aac.mp4 ]]; then
    ffmpeg "${q[@]}" -f lavfi -i "$(picture 1920x1080 120 '1080p H264 AAC')" -f lavfi -i "sine=frequency=440:duration=120" \
        -c:v libx264 "${gop[@]}" -profile:v high -pix_fmt yuv420p -crf 30 -c:a aac -b:a 128k \
        -metadata:s:a:0 language=eng -movflags +faststart e2e_1080p_h264_aac.mp4
fi

if [[ ! -s e2e_2160p_hevc_hdr10.mkv ]]; then
    ffmpeg "${q[@]}" -f lavfi -i "$(picture 3840x2160 10 '2160p HEVC HDR10')" -f lavfi -i "sine=frequency=440:duration=10" \
        -c:v libx265 -pix_fmt yuv420p10le -crf 32 -preset ultrafast \
        -color_primaries bt2020 -color_trc smpte2084 -colorspace bt2020nc \
        -x265-params "log-level=error:keyint=24:min-keyint=24:hdr10=1:repeat-headers=1:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1):max-cll=1000,400" \
        -c:a eac3 -ac 6 -b:a 384k -metadata:s:a:0 language=eng e2e_2160p_hevc_hdr10.mkv
fi

if [[ ! -s e2e_720p_multi_subs.mkv ]]; then
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    srt 'EN-SRT' 120 "$tmp/en.srt"
    srt 'PT-SRT' 120 "$tmp/pt.srt"
    ffmpeg "${q[@]}" -f lavfi -i "$(picture 1280x720 120 '720p MULTI')" \
        -f lavfi -i "sine=frequency=440:duration=120" -f lavfi -i "sine=frequency=880:duration=120" -f lavfi -i "sine=frequency=220:duration=120" \
        -i "$tmp/en.srt" -i "$tmp/pt.srt" \
        -map 0:v -map 1:a -map 2:a -map 3:a -map 4 -map 5 \
        -c:v libx264 "${gop[@]}" -pix_fmt yuv420p -crf 30 -c:a:0 aac -c:a:1 aac -c:a:2 ac3 -ac:a:2 6 -c:s srt \
        -metadata:s:a:0 language=eng -metadata:s:a:0 title="English AAC" \
        -metadata:s:a:1 language=por -metadata:s:a:1 title="Portugues AAC" \
        -metadata:s:a:2 language=eng -metadata:s:a:2 title="AC3 5.1" \
        -metadata:s:s:0 language=eng -metadata:s:s:1 language=por e2e_720p_multi_subs.mkv
fi
ls -la "$OUT"

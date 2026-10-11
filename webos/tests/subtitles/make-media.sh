#!/usr/bin/env bash
# F5.5 test media: an MKV whose first subtitle track is a bitmap one (PGS), followed by text ones,
# so the emulator shows which file position the Luna `selectTrack` index points to, and the external
# subtitle files the scenarios serve as add-on subtitles.
#   make-media.sh [dir]     (default: ~/webos-tv-sdk/media-tests/suite)
# t8_subs.mkv (30 s, H.264 + AAC, keyframe every second):
#   subtitles 0 PGS eng (red box)  1 SRT eng "EN-SRT n"  2 SRT por "PT-SRT n"  3 ASS spa "ES-ASS n"
# addon_eng.srt / addon_por.srt / addon_eng.ass: "ADDON EN n" / "ADDON PT n" / "ADDON ASS n".
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$HOME/webos-tv-sdk/media-tests/suite}"
SECONDS_LONG=30
mkdir -p "$OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

srt() { # <text> <file>
    local i
    for i in $(seq 0 $((SECONDS_LONG - 1))); do
        printf '%d\n00:00:%02d,000 --> 00:00:%02d,900\n%s %d\n\n' $((i + 1)) "$i" "$i" "$1" "$i"
    done > "$2"
}
ass() { # <text> <file>
    {
        printf '[Script Info]\nScriptType: v4.00+\nPlayResX: 1280\nPlayResY: 720\n\n'
        printf '[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n'
        printf 'Style: Default,Arial,48,&H0000FFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,40,1\n\n'
        printf '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
        local i
        for i in $(seq 0 $((SECONDS_LONG - 1))); do
            printf 'Dialogue: 0,0:00:%02d.00,0:00:%02d.90,Default,,0,0,0,,%s %d\n' "$i" "$i" "$1" "$i"
        done
    } > "$2"
}

python3 "$HERE/make-pgs.py" "$TMP/eng.sup" "$SECONDS_LONG"
srt 'EN-SRT' "$TMP/eng.srt"
srt 'PT-SRT' "$TMP/por.srt"
ass 'ES-ASS' "$TMP/spa.ass"
ffmpeg -loglevel error -y \
    -f lavfi -i "testsrc2=size=1280x720:rate=24:duration=$SECONDS_LONG" -f lavfi -i "sine=frequency=440:duration=$SECONDS_LONG" \
    -f sup -i "$TMP/eng.sup" -i "$TMP/eng.srt" -i "$TMP/por.srt" -i "$TMP/spa.ass" \
    -map 0:v -map 1:a -map 2 -map 3 -map 4 -map 5 \
    -c:v libx264 -g 24 -keyint_min 24 -sc_threshold 0 -pix_fmt yuv420p -c:a aac -b:a 128k \
    -c:s:0 copy -c:s:1 srt -c:s:2 srt -c:s:3 ass \
    -metadata:s:a:0 language=eng \
    -metadata:s:s:0 language=eng -metadata:s:s:0 title=PGS \
    -metadata:s:s:1 language=eng -metadata:s:s:2 language=por -metadata:s:s:3 language=spa \
    "$OUT/t8_subs.mkv"
srt 'ADDON EN' "$OUT/addon_eng.srt"
srt 'ADDON PT' "$OUT/addon_por.srt"
ass 'ADDON ASS' "$OUT/addon_eng.ass"
ffprobe -v error -show_entries stream=index,codec_type,codec_name:stream_tags=language,title -of compact "$OUT/t8_subs.mkv"

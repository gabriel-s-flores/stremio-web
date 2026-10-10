#!/usr/bin/env bash
# Gera a biblioteca de mídias sintéticas usada nos testes do player no emulador.
#   gen-media.sh [pasta]      (padrão: ~/webos-tv-sdk/media-tests/files)
# GOP=N (padrão 250, o do x264/x265) muda o intervalo de keyframes em quadros. O pipeline do
# webOS faz seek para o keyframe anterior: a bateria (media-suite) usa GOP=24 (1 s) para que
# os seeks em vídeos curtos caiam perto do ponto pedido.
set -euo pipefail
OUT="${1:-$HOME/webos-tv-sdk/media-tests/files}"
mkdir -p "$OUT" && cd "$OUT"
q=(-loglevel error -y)
GOP="${GOP:-250}"
gop264=(-g "$GOP" -keyint_min "$GOP" -sc_threshold 0)
src() { echo "testsrc2=size=$1:rate=24:duration=$2"; }
printf '1\n00:00:01,000 --> 00:00:05,000\nLegenda em portugues\n\n2\n00:00:06,000 --> 00:00:10,000\nSegunda legenda\n' > pt.srt
printf '1\n00:00:01,000 --> 00:00:05,000\nEnglish subtitle\n' > en.srt
ffmpeg "${q[@]}" -f lavfi -i "$(src 1280x720 20)" -f lavfi -i "sine=frequency=440:duration=20" -c:v libx264 "${gop264[@]}" -profile:v high -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart t1_h264_aac.mp4
ffmpeg "${q[@]}" -f lavfi -i "$(src 1280x720 20)" -f lavfi -i "sine=frequency=440:duration=20" -f lavfi -i "sine=frequency=880:duration=20" -f lavfi -i "sine=frequency=220:duration=20" -i en.srt -i pt.srt \
    -map 0:v -map 1:a -map 2:a -map 3:a -map 4 -map 5 -c:v libx264 "${gop264[@]}" -pix_fmt yuv420p -c:a:0 aac -c:a:1 aac -c:a:2 ac3 -ac:a:2 6 -c:s srt \
    -metadata:s:a:0 language=eng -metadata:s:a:0 title="English AAC" -metadata:s:a:1 language=por -metadata:s:a:1 title="Portugues AAC" \
    -metadata:s:a:2 language=eng -metadata:s:a:2 title="AC3 5.1" -metadata:s:s:0 language=eng -metadata:s:s:1 language=por t2_multi.mkv
ffmpeg "${q[@]}" -f lavfi -i "$(src 1920x1080 10)" -f lavfi -i "sine=frequency=440:duration=10" -c:v libx265 -pix_fmt yuv420p10le -tag:v hvc1 -x265-params "log-level=error:keyint=$GOP:min-keyint=$GOP" -c:a eac3 -ac 6 t3_hevc10_eac3.mp4
ffmpeg "${q[@]}" -f lavfi -i "$(src 1280x720 10)" -f lavfi -i "sine=frequency=440:duration=10" -c:v libx264 "${gop264[@]}" -pix_fmt yuv420p -c:a eac3 -ac 6 t4_h264_eac3.mkv
ffmpeg "${q[@]}" -f lavfi -i "$(src 1280x720 10)" -f lavfi -i "sine=frequency=440:duration=10" -c:v libx264 "${gop264[@]}" -pix_fmt yuv420p -c:a ac3 -ac 6 t5_h264_ac3.mkv
ffmpeg "${q[@]}" -f lavfi -i "$(src 1280x720 10)" -f lavfi -i "sine=frequency=440:duration=10" -c:v libx264 "${gop264[@]}" -pix_fmt yuv420p -c:a aac t6_h264_aac.mkv
ffmpeg "${q[@]}" -f lavfi -i "$(src 1280x720 10)" -f lavfi -i "sine=frequency=440:duration=10" -c:v libx264 "${gop264[@]}" -pix_fmt yuv420p -c:a ac3 -ac 2 t7_h264_ac3.mp4
ls -la "$OUT"

#!/usr/bin/env bash
# Recria, a partir das URLs originais, TODOS os recortes versionados em
# webos/tests/media/headers/ e confere o sha256 de cada um (valores do CATALOGO.md).
#
# Uso: fetch-all.sh [OUTDIR]     (OUTDIR deve nao existir ou estar vazio; padrao: mktemp -d)
# Requer: bash, curl, sha256sum, head, rsync (so para ffmpeg-fate/), ffmpeg (so para derivados).
# Os arquivos baixados sao dados nao confiaveis: nada aqui os executa; so ffmpeg -c copy (remux).
# Saida: 0 se todos os baixados/cortados batem; derivados (ffmpeg) divergentes so geram WARN,
# pois dependem da versao do ffmpeg (referencia: ffmpeg n9.0.1, ver CATALOGO.md).
set -euo pipefail

OUT="${1:-$(mktemp -d /tmp/f010-headers.XXXXXX)}"
mkdir -p "$OUT/ffmpeg-fate"
if [ -n "$(ls -A "$OUT" 2>/dev/null | grep -v '^ffmpeg-fate$' || true)" ]; then
  echo "OUTDIR nao esta vazio: $OUT" >&2; exit 2
fi
TMP="$(mktemp -d /tmp/f010-fetch-tmp.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
FAIL=0; WARN=0

ANDROIDX=8c6678b657ede1e7883fc164ef73ed483c7796c3
AX_RAW="https://raw.githubusercontent.com/androidx/media/$ANDROIDX/libraries/test_data/src/test/assets/media"
DOVITOOL=614c816b6446dcd1dbaf433403d499a6026fbb5a
DT_RAW="https://raw.githubusercontent.com/quietvoid/dovi_tool/$DOVITOOL/assets/hevc_tests"
FATE=rsync://fate-suite.ffmpeg.org/fate-suite

check() { # relpath sha256 [strict|soft]
  local got; got="$(sha256sum "$OUT/$1" | cut -d' ' -f1)"
  if [ "$got" = "$2" ]; then echo "OK    $1"
  elif [ "${3:-strict}" = soft ]; then echo "WARN  $1 sha256 difere (ffmpeg diferente?) got=$got"; WARN=$((WARN+1))
  else echo "FAIL  $1 got=$got want=$2"; FAIL=$((FAIL+1)); fi
}
# fetch_http dest url nbytes   -> primeiros nbytes (Range) de url
fetch_http() { curl -fsS --proto '=https' --max-time 300 -r "0-$(($3-1))" "$2" -o "$OUT/$1"; }
fetch_fate() { rsync -q "$FATE/$2" "$OUT/$1"; }

# ---------- Apache-2.0 (androidx/media @ $ANDROIDX) ----------
fetch_http dts-core.mkv                      "$AX_RAW/mkv/sample_with_dts.mkv"            45877
fetch_http dts-express.mka                   "$AX_RAW/mka/sample_with_dts_express.mka"    45646
fetch_http dts-hd-ma.mkv                     "$AX_RAW/mkv/sample_with_dts_hd_ma.mkv"      205977
fetch_http dts-hd-ma.mp4                     "$AX_RAW/mp4/sample_dts_hd_ma.mp4"           201034
fetch_http dts-x.mkv                         "$AX_RAW/mkv/sample_with_dts_x.mkv"          211187
fetch_http dv-p10-av1-dav1-moov-end.mp4      "$AX_RAW/mp4/video_dovi_3840x2160_30fps_dav1_10.mp4" 1460455
fetch_http dv-p8.4-hlg-iphone.mov            "$AX_RAW/mp4/dolbyVision-hdr.MOV"            64565
fetch_http dv-p9-avc-dvav-head512k.mp4       "$AX_RAW/mp4/video_dovi_1920x1080_60fps_dvav_09.mp4" 524288
fetch_http eac3joc-atmos.ec3                 "$AX_RAW/ts/sample_eac3joc.ec3"              163840
fetch_http eac3joc-atmos-fragmented.mp4      "$AX_RAW/mp4/sample_eac3joc_fragmented.mp4"  164895
fetch_http eac3joc-atmos.mp4                 "$AX_RAW/mp4/sample_eac3joc.mp4"             164796
fetch_http eac3-plain-no-joc.mp4             "$AX_RAW/mp4/sample_eac3.mp4"                216898
fetch_http mkv-video-ac3-pgs.mkv             "$AX_RAW/mkv/sample_with_pgs_subtitles.mkv"  116069
fetch_http truehd-atmos.mp4                  "$AX_RAW/mp4/sample_dthd.mp4"                98103
# ---------- MIT (quietvoid/dovi_tool @ $DOVITOOL) ----------
fetch_http dv-p8.1-mkvmerge.mkv              "$DT_RAW/regular.mkv"                        78891

check dts-core.mkv                      e8120f9c38a21d2aecc6ab1c47628ca7baa1c2d91b6d4c39e2e7e37e87e41791
check dts-express.mka                   a1ae2b5bbe048ce4bf8efc3bf6ee59c5a7af49962ff5c2116129566fb43b8ce8
check dts-hd-ma.mkv                     522b99f24c104c4273beede93f7cdffe794e7c36376149706dcf41a9ed0c7df5
check dts-hd-ma.mp4                     7968430b42c910cdb36b97c9893fa6fd90a23a4202088dac4dddd3c0c3f53efd
check dts-x.mkv                         f97a1adcfb5811895961f084a9e3c4dc214ddde189fd7f0120fb5c7d3b9ae4ff
check dv-p10-av1-dav1-moov-end.mp4      f7ba34a50a58af7359444fc2ed645bd9c96d38602963be91d272a4a3142cc3f3
check dv-p8.1-mkvmerge.mkv              8f1df1bf34973e1fa146800de0d9c8e6fad60dd2f229c88541b7534f720ff38f
check dv-p8.4-hlg-iphone.mov            c96e24bdfa7f3e0ef9b73b0b891805100119b9fa129e4cf10375af90846de534
check dv-p9-avc-dvav-head512k.mp4       9224a77c4f5eafdd4f07cb720aa653a025c6ecff8d0002fdc3aaf685e51f168c
check eac3joc-atmos.ec3                 32fdd125ed45e6a34e2684e2cb9e81c0612113413a6d4aceac018b815d512edc
check eac3joc-atmos-fragmented.mp4      98e6f7269b57e3ceb86d9884a471ca704c8ddeacce5279a66f9a764d49adf2f4
check eac3joc-atmos.mp4                 febd1b3f77b8412ee72096c6535c0c1dc50d1bdfbaf2f6d9b44ebcab27df56c6
check eac3-plain-no-joc.mp4             bd0abdde84bcc042ce03e3ef166db4954605a6b66fc514fb0db605bd0c91f142
check mkv-video-ac3-pgs.mkv             5fa25166b5bd371956b5cd8b7614403bdc046a29965fa82d2d051329a6ea9faa
check truehd-atmos.mp4                  554d59072c039e880e995b9568390b664323c906ddc835030d4c51f88e1b6877

# ---------- derivados (remux ffmpeg -c copy) de fontes Apache-2.0 ----------
if command -v ffmpeg >/dev/null; then
  FL=(-fflags +bitexact -flags:v +bitexact -flags:a +bitexact -flags:s +bitexact -map_metadata -1 -y)
  ffmpeg -v error -i "$OUT/eac3joc-atmos.ec3" "${FL[@]}" -map 0 -c copy -f matroska "$OUT/eac3joc-atmos.mkv"
  ffmpeg -v error -i "$OUT/mkv-video-ac3-pgs.mkv" -i "$OUT/eac3joc-atmos.ec3" -i "$OUT/dts-hd-ma.mkv" -i "$OUT/truehd-atmos.mp4" \
    "${FL[@]}" -map 0:v -map 0:a -map 1:a -map 2:a -map 3:a -map 0:s -c copy \
    -metadata:s:a:0 language=eng -metadata:s:a:1 language=por -metadata:s:a:2 language=eng -metadata:s:a:3 language=jpn \
    -metadata:s:s:0 language=eng -f matroska "$OUT/mkv-multitrack-ac3-eac3joc-dtshdma-truehd-pgs.mkv"
  check eac3joc-atmos.mkv                                  57b39db13a4bed7c72c2fbb23a2ff1dc54defbd47216f151e31f11ec954719b2 soft
  check mkv-multitrack-ac3-eac3joc-dtshdma-truehd-pgs.mkv  3030e39e236103e5289f06e8a0b20f7e694a365d5c97c9264a4b8c5d9ff0c8f0 soft
else
  echo "SKIP  derivados (ffmpeg ausente)"
fi

# ---------- FFmpeg FATE suite (sem licenca explicita; ver CATALOGO.md) ----------
if command -v rsync >/dev/null; then
  fetch_fate ffmpeg-fate/dv-p5-moov-end.mp4    mov/dovi-p5.mp4
  fetch_fate ffmpeg-fate/dv-p7-moov-end.mp4    mov/dovi-p7.mp4
  fetch_fate ffmpeg-fate/dv-p8.1-moov-end.mp4  mov/dovi-p81.mp4
  fetch_fate ffmpeg-fate/dv-p7-hvce.mkv        mkv/dovi-p7-hvce.mkv
  fetch_fate ffmpeg-fate/dv-p7-hvce.mp4        mov/dovi-p7-hvce.mp4
  fetch_fate ffmpeg-fate/truehd-atmos.thd      truehd/atmos.thd
  rsync -q "$FATE/lossless-audio/truehd_5.1.raw" "$TMP/truehd_5.1.raw"
  [ "$(sha256sum "$TMP/truehd_5.1.raw" | cut -d' ' -f1)" = f00a67adeec561c8bb9e98da06e38f5d3f204778ff931c592f81db54ce428127 ] \
    || { echo "FAIL  truehd_5.1.raw (fonte FATE) sha256 difere"; FAIL=$((FAIL+1)); }
  check ffmpeg-fate/dv-p5-moov-end.mp4    11fe599fd77e31e26fbf855bae1cd9931df9f261a0a7b1dce9fad9b236677c4b
  check ffmpeg-fate/dv-p7-moov-end.mp4    7e4b69c90f8b1ec8a284d2610ab465fded5751f34a50e56129bcf152d8943c79
  check ffmpeg-fate/dv-p8.1-moov-end.mp4  3313278f3dc49b0b3680ec7c3d72622ec0a770faff9721c5842aaf899d5471c5
  check ffmpeg-fate/dv-p7-hvce.mkv        3287bac8deade11e1c57bd65b9c7c8750a1e38e286666cbb4fa39eac264875df
  check ffmpeg-fate/dv-p7-hvce.mp4        67baddaf158bc96c0c7955ca8894e92632df5ccca85bc68733f92f5f9fa7caaa
  check ffmpeg-fate/truehd-atmos.thd      020c9b9e67f80de105663af191740f8b60f550107c9f765b632f4cd5efb1c6ab
  if command -v ffmpeg >/dev/null; then
    ffmpeg -v error -i "$OUT/ffmpeg-fate/dv-p5-moov-end.mp4" "${FL[@]}" -map 0 -c copy -f matroska "$OUT/ffmpeg-fate/dv-p5.mkv"
    ffmpeg -v error -i "$OUT/ffmpeg-fate/dv-p5-moov-end.mp4" "${FL[@]}" -map 0 -c copy -strict unofficial -movflags +faststart -f mp4 "$OUT/ffmpeg-fate/dv-p5-faststart.mp4"
    ffmpeg -v error -i "$OUT/ffmpeg-fate/truehd-atmos.thd" "${FL[@]}" -map 0 -c copy -f matroska "$OUT/ffmpeg-fate/truehd-atmos.mkv"
    ffmpeg -v error -f truehd -i "$TMP/truehd_5.1.raw" "${FL[@]}" -map 0 -c copy -t 0.5 -f matroska "$OUT/ffmpeg-fate/truehd-51-no-atmos.mkv"
    check ffmpeg-fate/dv-p5.mkv              286cc5665cb330edc2adda334e1062640a90344dff0cd784530e2089743f9967 soft
    check ffmpeg-fate/dv-p5-faststart.mp4    9af6db85a68c0a312eacf7343f913f333ee8363cadf04ff867aae1e289083a28 soft
    check ffmpeg-fate/truehd-atmos.mkv       ec58804946ed804b8d94ec3582c9135e4ea11f4d6797d80711bf08a8928baa3d soft
    check ffmpeg-fate/truehd-51-no-atmos.mkv 88e2ddd9fa72bb9f961fc4891c65d0d43294d3f3f2e6eb128e54946bef90ae68 soft
  fi
else
  echo "SKIP  ffmpeg-fate/ (rsync ausente)"
fi

echo "---- saida em: $OUT  (FAIL=$FAIL WARN=$WARN)"
[ "$FAIL" -eq 0 ]

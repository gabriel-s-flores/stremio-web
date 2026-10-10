# Fixtures do header probe: fontes, licenças e checksums

Cada fixture tem dois arquivos:

- `<id>.bin`: os intervalos de bytes que o probe leu, concatenados;
- `<id>.json`: fonte, tamanho original, opções usadas, intervalos (`pieces`) e sha256 do `.bin`.

Só os bytes que o parser precisa ficam aqui: o cabeçalho, o `moov` ou o `Tracks` e, quando é preciso, o começo da primeira amostra de áudio. Nada é decodificado.

**Regra de licença** (devolutiva c0 do orquestrador, a mesma da F0.10):

- **No git:** só fontes com licença que permita redistribuição. São Jellyfin (CC BY-SA 4.0), Chromium (BSD-3-Clause), androidx/media (Apache-2.0), dovi_tool (MIT) e as mídias sintéticas do kit.
- **Textos das licenças:** os integrais estão em [`LICENSES/`](LICENSES/).
- **Fora do git:** a FATE/FFmpeg, que não tem cláusula de redistribuição. Essas fixtures são geradas por script (ver o fim deste arquivo).

Como gravar ou regravar uma fixture:

```bash
node webos/lib/header-probe/tools/probe.mjs <url|arquivo> --record <id> --block-size <N> [--source <url>]
```

Se o parser mudar o padrão de leitura, o teste falha com `fixture <id> has no bytes for …`, e aí é preciso regravar.

Os valores esperados nos testes são a saída do `ffprobe` 9.0.1 para o arquivo original. Isso inclui o `side_data` "DOVI configuration record", o `profile` do áudio ("Dolby Digital Plus + Dolby Atmos", "Dolby TrueHD + Dolby Atmos", "DTS-HD MA", "DTS-HD MA + DTS:X", "DTS Express"), o idioma e a `disposition`. Coleta em 2026-10-09.

## No git

| id | Bytes versionados / original | sha256 do `.bin` | Conteúdo (ffprobe) | Fonte | Licença |
|---|---|---|---|---|---|
| `dv-p5-mp4` | 88.828 / 50.039.227 | `8b3d22a989816be40cb3992bce45da7c0e7bb1c1e02d1d4dfb687e0c514b62bd` | HEVC `dvh1` Main 10 1080p; DOVI P5 L5, compat 0; `moov` no fim | [J1] | CC BY-SA 4.0 |
| `dv-p81-mp4` | 88.840 / 48.198.953 | `8ef7b6c1cdf5fa95e16ae683cb29d296bdad368f11b3d0ac3f059956dd218ac9` | HEVC `hvc1` + `dvvC` 1080p PQ; DOVI P8 L5, compat 1 (8.1); `moov` no fim | [J2] | CC BY-SA 4.0 |
| `dv-p81-mkvmerge-mkv` | 32.768 / 78.891 | `17c1a6240bd688c6958ee15579ab050c1cbb4e0b1fd45121ffa8bc5331366db5` | MKV do mkvmerge v89.0: HEVC Main 10 256x144 PQ; DOVI P8 L1, compat 1 (`dvvC` no BlockAdditionMapping) | [DT] | MIT |
| `dv-p5-truehd-atmos-mkv` | 65.536 / 2.306.747 | `de31157ef9680e39809dbdb06d99a18e9f2edfaa48ef60c1d464e8ff4f94b144` | **Derivado modificado** (remux): HEVC DOVI P5 L5 + TrueHD "Dolby TrueHD + Dolby Atmos" 7.1, eng, padrão | [J1] + [AX] `mp4/sample_dthd.mp4` | CC BY-SA 4.0 (vídeo) + Apache-2.0 (áudio) |
| `dv-p81-multi-mkv` | 65.536 / 2.174.353 | `9fcabfb32fa9d7ff8612315d3a7dedb65b113ef1e264c732ce2c36831e1d8fae` | **Derivado modificado** (remux): HEVC DOVI P8.1 PQ + E-AC-3 Atmos 5.1 por (padrão) + DTS-HD MA 7.1 eng + DTS 5.1 spa + SRT por (forçada) | [J2] + [AX] `ts/sample_eac3joc.ec3`, `mkv/sample_with_dts_hd_ma.mkv`, `mkv/sample_with_dts.mkv` | CC BY-SA 4.0 (vídeo) + Apache-2.0 (áudio) |
| `eac3-joc-mp4` | 4.096 / 164.796 | `6b5d77bd2a9cba096bd8bcf55c6ff721ae79d4b55d274275c3dd94a30b7f6c32` | E-AC-3 "Dolby Digital Plus + Dolby Atmos" 5.1 (`dec3` com JOC, complexity 16) | [AX] `mp4/sample_eac3joc.mp4` | Apache-2.0 |
| `eac3-mp4` | 4.096 / 216.898 | `402f909775e6b4c23b1e7f6a31cdf0aedb5786132451249edec0d9d86f803d80` | E-AC-3 5.1 **sem** Atmos (controle negativo) | [AX] `mp4/sample_eac3.mp4` | Apache-2.0 |
| `truehd-atmos-mp4` | 4.096 / 98.103 | `339295aaa8b4c10ebba0e155c5ef1cba4b5723b0bf38491327e57ffbd9ce3cd1` | TrueHD (`mlpa`) "Dolby TrueHD + Dolby Atmos" 7.1 48 kHz | [AX] `mp4/sample_dthd.mp4` | Apache-2.0 |
| `dts-core-mkv` | 32.768 / 45.877 | `845035295f02fb6466babc1c9109db769988119ae1ec0234b51537eab827e7e3` | DTS (core) 5.1 48 kHz | [AX] `mkv/sample_with_dts.mkv` | Apache-2.0 |
| `dts-hdma-mkv` | 32.768 / 205.977 | `3afab9cb0486782761c7b25d0ead600cbf579efa3be298ccccd3f9a90d155f39` | DTS-HD MA 7.1, eng | [AX] `mkv/sample_with_dts_hd_ma.mkv` | Apache-2.0 |
| `dts-x-mkv` | 32.768 / 211.187 | `a96fca47573be2abcbe12a136b1ef7a11bf2d44e3ace649562faff14652f4e2e` | "DTS-HD MA + DTS:X" 7.1, eng | [AX] `mkv/sample_with_dts_x.mkv` | Apache-2.0 |
| `dts-express-mka` | 32.768 / 45.646 | `0d463657f5fcdebd7189a1e90c8777c18cc752d54b493496d62b29d380220aa8` | DTS Express 5.1 | [AX] `mka/sample_with_dts_express.mka` | Apache-2.0 |
| `dts-hdma-mp4` | 66.494 / 201.034 | `131d6ad334befde38685f99d388bed8eaa11cb51cc4f4e860c0fe77ece2651ae` | DTS-HD MA 7.1 (`mp4a`), eng; `moov` no fim | [AX] `mp4/sample_dts_hd_ma.mp4` | Apache-2.0 |
| `dtsc-mp4` | 711 / 711 | `c36c18925a30710974692ccb339874be9391162053039edb3f4a1a987ce26ffc` | DTS (`dtsc`) 5.1 48 kHz (só o `moov`) | [CR] `bear_dtsc.mp4` | BSD-3-Clause |
| `dtsx-mp4` | 1.335 / 1.335 | `01e7818b744fc2ba1a43577c3764a5c6fe7d8a0b92929c4480fdd5f2be64d43e` | DTS:X (`dtsx`) 6 canais (só o `moov`) | [CR] `bear_dtsx.mp4` | BSD-3-Clause |
| `kit-multi-mkv` | 32.768 / 8.401.787 | `087c4080a52352365903f0e6806fb24967c4f36c152a0c98f98ea16ef2c4f8c9` | H.264 + AAC eng/por + AC-3 5.1 eng + SRT eng/por | `~/webos-tv-sdk/media-tests/files/t2_multi.mkv` (`webos/tools/gen-media.sh`, sintético) | gerado pelo projeto |

Todas as fixtures são **trechos**, isto é, só alguns intervalos de bytes do arquivo original. É a única modificação nas fixtures que não são remux.

## Fontes, atribuição e licenças

- **[J1]** "Test Jellyfin 1080p DV P5.mp4" e **[J2]** "Test Jellyfin 1080p DV P8.1.mp4", do Jellyfin Project, cortesia de Gnattu:
  - https://repo.jellyfin.org/test-videos/HDR/Dolby%20Vision/
  - Licença: Creative Commons Attribution-ShareAlike 4.0 International ("These files are courtesy of Gnattu and are licensed under the Creative Commons Attribution-Sharealike license", https://repo.jellyfin.org/test-videos/).
  - Texto: [`LICENSES/CC-BY-SA-4.0.txt`](LICENSES/CC-BY-SA-4.0.txt).
  - Modificações: trechos de bytes. Nos dois remux, os 2 primeiros segundos foram remuxados para Matroska com outras faixas. Os derivados seguem sob CC BY-SA 4.0 (ShareAlike).
- **[AX]** androidx/media @ `8c6678b657ede1e7883fc164ef73ed483c7796c3`, `libraries/test_data/src/test/assets/media/<caminho>`:
  - https://raw.githubusercontent.com/androidx/media/8c6678b657ede1e7883fc164ef73ed483c7796c3/libraries/test_data/src/test/assets/media/
  - Projeto androidx/media (Android Open Source Project). Licença: Apache License 2.0, texto em [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt), o `LICENSE` do mesmo commit. O repositório não tem arquivo NOTICE (conferido na raiz e em `libraries/test_data/`).
  - O repositório não documenta a procedência de cada mídia; vale a licença do repositório.
  - sha256 dos originais (iguais ao catálogo da F0.10):

    | Arquivo | sha256 |
    |---|---|
    | `sample_dthd.mp4` | `554d59072c039e880e995b9568390b664323c906ddc835030d4c51f88e1b6877` |
    | `sample_eac3joc.ec3` | `32fdd125ed45e6a34e2684e2cb9e81c0612113413a6d4aceac018b815d512edc` |
    | `sample_with_dts_hd_ma.mkv` | `522b99f24c104c4273beede93f7cdffe794e7c36376149706dcf41a9ed0c7df5` |
    | `sample_with_dts.mkv` | `e8120f9c38a21d2aecc6ab1c47628ca7baa1c2d91b6d4c39e2e7e37e87e41791` |

  - Modificações (Apache-2.0 §4(b)): trechos de bytes; nos remux, as faixas foram remuxadas sem recodificar, com idioma e título definidos aqui.
- **[CR]** Chromium @ `3e08d37c08b73fcfcc8ef37e1d58213fd39e6f29`, `media/test/data/`:
  - https://raw.githubusercontent.com/chromium/chromium/3e08d37c08b73fcfcc8ef37e1d58213fd39e6f29/media/test/data/
  - "Copyright 2015 The Chromium Authors". Licença: BSD-3-Clause, texto em [`LICENSES/BSD-3-Clause-Chromium.txt`](LICENSES/BSD-3-Clause-Chromium.txt).
- **[DT]** quietvoid/dovi_tool @ `614c816b6446dcd1dbaf433403d499a6026fbb5a`, `assets/hevc_tests/regular.mkv`:
  - https://raw.githubusercontent.com/quietvoid/dovi_tool/614c816b6446dcd1dbaf433403d499a6026fbb5a/assets/hevc_tests/regular.mkv
  - "Copyright (c) 2026 quietvoid". Licença: MIT, texto em [`LICENSES/MIT-dovi_tool.txt`](LICENSES/MIT-dovi_tool.txt).

### Os dois remux (derivados modificados)

Não existe DV P5/P8.1 com TrueHD, E-AC-3 JOC ou DTS em Matroska com licença aberta. Por isso, montei aqui dois MKV com `ffmpeg 9.0.1 -c copy`: o contêiner é do ffmpeg, e os bitstreams originais seguem sem recodificação.

| Arquivo remuxado | sha256 |
|---|---|
| `mux-dv-p5-truehd.mkv` | `45366c697b455680fba65c03dccbb0da9497e27da565bee42e64eea3db9466c1` |
| `mux-dv-p81-multi.mkv` | `84de75295a74b12cc044926f8dab6329b715f4df12eb7b04a8cdb6a05e889b6e` |

O sha256 depende da versão do ffmpeg.

```bash
J='https://repo.jellyfin.org/test-videos/HDR/Dolby%20Vision'
AX='https://raw.githubusercontent.com/androidx/media/8c6678b657ede1e7883fc164ef73ed483c7796c3/libraries/test_data/src/test/assets/media'
curl -sSfO "$AX/mp4/sample_dthd.mp4"; curl -sSfO "$AX/ts/sample_eac3joc.ec3"
curl -sSfO "$AX/mkv/sample_with_dts_hd_ma.mkv"; curl -sSfO "$AX/mkv/sample_with_dts.mkv"
ffmpeg -t 2 -i "$J/Test%20Jellyfin%201080p%20DV%20P5.mp4" -i sample_dthd.mp4 -map 0:v -map 1:a -c copy -tag:v hvc1 \
  -metadata:s:a:0 language=eng -metadata:s:a:0 title="TrueHD Atmos 7.1" -disposition:a:0 default -t 2 mux-dv-p5-truehd.mkv
printf '1\n00:00:00,500 --> 00:00:01,500\nLegenda de teste\n' > sub-por.srt
ffmpeg -t 2 -i "$J/Test%20Jellyfin%201080p%20DV%20P8.1.mp4" -i sample_eac3joc.ec3 -i sample_with_dts_hd_ma.mkv -i sample_with_dts.mkv -i sub-por.srt \
  -map 0:v -map 1:a -map 2:a -map 3:a -map 4:s -c copy -c:s srt -t 2 \
  -metadata:s:a:0 language=por -metadata:s:a:0 title="DD+ Atmos 5.1" -disposition:a:0 default \
  -metadata:s:a:1 language=eng -metadata:s:a:1 title="DTS-HD MA 7.1" -disposition:a:1 0 \
  -metadata:s:a:2 language=spa -disposition:a:2 0 -metadata:s:s:0 language=por -disposition:s:0 forced mux-dv-p81-multi.mkv
```

## Fora do git: FATE (gerado por script)

A única fonte aberta encontrada para **Dolby Vision Profile 7** é a suíte FATE do FFmpeg (https://fate-suite.ffmpeg.org/), que não tem licença de redistribuição. As fixtures abaixo ficam fora do git (`__fixtures__/.gitignore`: `fate-*`) e são gravadas por:

```bash
webos/lib/header-probe/tools/fetch-fate-fixtures.sh
```

O script baixa o original, confere o sha256 e grava a fixture.

| id | Fonte | sha256 do original | Conteúdo (ffprobe) |
|---|---|---|---|
| `fate-dv-p7-mkv` | https://fate-suite.ffmpeg.org/mkv/dovi-p7-hvce.mkv | `3287bac8deade11e1c57bd65b9c7c8750a1e38e286666cbb4fa39eac264875df` | MKV, HEVC Main 10 2160p PQ; DOVI P7 L6, rpu1 **el1** bl1, compat 6 (`dvcC` + `hvcE`) |
| `fate-dv-p7-dual-mp4` | https://fate-suite.ffmpeg.org/mov/dovi-p7.mp4 | `7e4b69c90f8b1ec8a284d2610ab465fded5751f34a50e56129bcf152d8943c79` | MP4 dual-track: faixa 1 = BL HEVC PQ sem DOVI; faixa 2 = EL, DOVI P7 L4, el1 **bl0**, compat 6 |

Sem esses arquivos, `pnpm test` pula os dois testes `[FATE] …` e imprime o aviso `[header-probe] PULANDO 2 teste(s) de Dolby Vision P7 …`. Nunca passam em silêncio.

Quando a F0.10 mergear o catálogo em `webos/tests/media/headers/`, dá para convergir. O `replayReadRange` aceita arquivos inteiros, que viram uma peça com offset 0.

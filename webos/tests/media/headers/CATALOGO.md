# Catalogo de cabecalhos reais de midia (F0.10, insumo de F5.2/F5.3)

Amostras reais, pequenas, para testar o parsing de conteiner/codec (MKV/MP4: perfil Dolby Vision,
DD+ Atmos/JOC, TrueHD, DTS). Tudo foi verificado com `ffprobe` (ffmpeg n9.0.1) lendo o arquivo
versionado; a coluna "Verificado" reproduz o que o ffprobe mostrou. O que nao foi confirmado
esta escrito como "nao confirmado".

Versionados no git: 17 arquivos, 4 518 802 bytes (~4,3 MiB); maior arquivo 1 460 455 bytes (alvo: <= 2 MB cada, <= 20 MB no total).
**`ffmpeg-fate/` NAO vai para o git** (esta no `.gitignore`): 10 arquivos, 1 607 008 bytes, de uma fonte sem licenca de
redistribuicao explicita (ver "FATE" abaixo). Eles existem aqui como cache local para os testes e se recriam com
`fetch/fetch-all.sh /tmp/headers && cp -r /tmp/headers/ffmpeg-fate .` (o script confere o sha256 de cada um). Sao a unica fonte
aberta achada para DV Profile 5 e Profile 7 e para TrueHD em MKV; sem eles, essas categorias so existem via script.
Script-only (bytes nao versionados): 3 entradas em `fetch/`.

Reproducao: `fetch/fetch-all.sh [OUTDIR]` baixa/recorta tudo a partir das URLs originais (pinadas por commit)
e confere o sha256 de cada arquivo desta tabela (testado: 27/27 OK, inclusive os derivados).
Os arquivos baixados sao tratados como dados nao confiaveis (nenhum e executado; so `ffmpeg -c copy`).

## Fontes e licencas (evidencia)

| Id | Fonte | Licenca | Evidencia |
|----|-------|---------|-----------|
| AX | https://github.com/androidx/media @ `8c6678b657ede1e7883fc164ef73ed483c7796c3`, pasta `libraries/test_data/src/test/assets/media/` (base: `https://raw.githubusercontent.com/androidx/media/8c6678b657ede1e7883fc164ef73ed483c7796c3/libraries/test_data/src/test/assets/media/<caminho>`) | Apache-2.0 (licenca do repositorio, inclui `libraries/test_data`) | `LICENSE` na raiz do commit: "Apache License / Version 2.0, January 2004"; API do GitHub `repos/androidx/media/license` retorna `spdx_id: Apache-2.0`. `libraries/test_data/README.md`: "Provides sample data for media unit and instrumentation tests." Ressalva: o repositorio nao documenta a procedencia de cada midia individual; a licenca aplicada e a do repositorio. |
| DT | https://github.com/quietvoid/dovi_tool @ `614c816b6446dcd1dbaf433403d499a6026fbb5a`, `assets/hevc_tests/regular.mkv` | MIT | `LICENSE` do commit: "MIT License / Copyright (c) 2026 quietvoid"; API `repos/quietvoid/dovi_tool/license` retorna `MIT`. O MKV foi gerado com mkvmerge v89.0 (tag `_STATISTICS_WRITING_APP` do proprio arquivo); video 256x144 de teste, origem do clipe nao documentada. |
| FATE | `rsync://fate-suite.ffmpeg.org/fate-suite/<caminho>` (suite de testes FATE do FFmpeg; `https://samples.ffmpeg.org/fate-suite/` nao e navegavel por HTTP, so rsync) | **Sem licenca explicita** | `https://samples.ffmpeg.org/00-README`: "You are free to download any samples you want". Nao ha texto de redistribuicao; `doc/fate.texi` so diz para enviar amostras "as small as possible". Arquivos incluidos sao videos DV sinteticos minusculos (4-9 KB para ~0,4 s de 1080p, imagem praticamente lisa) e vetores de teste de audio; **a procedencia nao esta documentada**. **Nao versionados** (`.gitignore`): ficam como cache local em `ffmpeg-fate/`, recriado por `fetch-all.sh`. Sao a unica fonte aberta achada para DV Profile 5 e Profile 7 (e para TrueHD em MKV); se a licenca for considerada suficiente, basta retirar `ffmpeg-fate/` do `.gitignore`. |
| SFF | `https://samples.ffmpeg.org/<caminho>` (colecao MPlayer/FFmpeg, nao FATE) | Conteudo comercial (trechos de filme/demo de fabricante), sem licenca de redistribuicao | Mesmo README acima. **Bytes nao versionados**; so script + sha256. |

Textos integrais das licencas, copiados dos commits pinados: `LICENSES/Apache-2.0.txt` (androidx/media; o commit nao tem `NOTICE`)
e `LICENSES/MIT-dovi_tool.txt` ("Copyright (c) 2026 quietvoid"). Eles acompanham as amostras redistribuidas (Apache-2.0 §4(a), MIT).

Procedencia dos derivados: arquivos marcados "derivado" foram criados aqui por remux `ffmpeg -c copy`
(sem recodificar; **arquivos modificados**, Apache-2.0 §4(b)) de uma amostra das fontes acima e herdam a licenca (ou a falta dela) da amostra de origem.
Comando base: `ffmpeg -fflags +bitexact -flags:v +bitexact -flags:a +bitexact -flags:s +bitexact -map_metadata -1 -map 0 -c copy`
(comandos exatos em `fetch/fetch-all.sh`). O sha256 dos derivados depende da versao do ffmpeg (referencia n9.0.1);
em outra versao o script emite WARN em vez de FAIL.

## Dolby Vision

Observacao importante para o parser: o DV nao aparece nos fourcc `dvhe`/`dvh1`. Nestas amostras o sample entry e
`hvc1`/`hev1`/`avc1`/`dav1` e a configuracao DV esta na caixa filha `dvcC` (perfis <= 7) ou `dvvC` (perfis > 7)
em MP4, e no `BlockAdditionMapping` (ID `0x41E4`, tipo `dvcC`/`dvvC`) em Matroska. Em MKV a configuracao fica em Tracks,
antes do primeiro Cluster; em MP4 com `moov` no fim, o recorte do inicio nao basta.

| Arquivo | Fonte / origem | Conteiner | Bytes | Original (offset+tamanho) | sha256 | Verificado (ffprobe e bytes) |
|---------|----------------|-----------|------:|---------------------------|--------|-------------------------------|
| `ffmpeg-fate/dv-p5-moov-end.mp4` | FATE `mov/dovi-p5.mp4` (arquivo inteiro) | MP4 | 4182 | 0+4182 (inteiro) | `11fe599fd77e31e26fbf855bae1cd9931df9f261a0a7b1dce9fad9b236677c4b` | **Profile 5**: `dv_profile=5`, `dv_level=4`, `bl_present=1`, `el_present=0`, `rpu_present=1`, `dv_bl_signal_compatibility_id=0`; HEVC Main 10 1920x1080, 0,42 s; sample entry `hev1`+`hvcC`+`dvcC`. **`moov` no fim** (ftyp, free, mdat 40..3226, moov 3226..4182): o inicio sozinho nao e parseavel. |
| `ffmpeg-fate/dv-p5-faststart.mp4` | derivado do anterior (`-strict unofficial -movflags +faststart`) | MP4 | 4145 | derivado de `dovi-p5.mp4` | `9af6db85a68c0a312eacf7343f913f333ee8363cadf04ff867aae1e289083a28` | Profile 5 identico (dv_profile=5, compat_id=0), `moov` no inicio (ftyp, moov 32..951, free, mdat). Par "moov no fim vs faststart" do mesmo conteudo. |
| `ffmpeg-fate/dv-p5.mkv` | derivado de `dovi-p5.mp4` (remux para Matroska, escrito pelo muxer do ffmpeg) | MKV | 3817 | derivado de `dovi-p5.mp4` | `286cc5665cb330edc2adda334e1062640a90344dff0cd784530e2089743f9967` | **Profile 5 em MKV**: `dv_profile=5`, `dv_level=4`, compat_id=0; `dvcC`@405 em BlockAdditionMapping (`0x41E4`@370; Tracks@83, primeiro Cluster@526). Nota: MKV escrito pelo ffmpeg, nao por mkvmerge. |
| `ffmpeg-fate/dv-p7-moov-end.mp4` | FATE `mov/dovi-p7.mp4` (inteiro) | MP4 | 8999 | 0+8999 (inteiro) | `7e4b69c90f8b1ec8a284d2610ab465fded5751f34a50e56129bcf152d8943c79` | **Profile 7, dual-layer em 2 trilhas**: trilha 0 = camada base HEVC (sem DV), trilha 1 = camada de melhoria com `dvcC` (`dv_profile=7`, `dv_level=4`, `el_present=1`, `bl_present=0`, `dv_bl_signal_compatibility_id=6`); 1920x1080 0,375 s. **`moov` no fim** (mdat 40..7070, moov 7070..8999). |
| `ffmpeg-fate/dv-p7-hvce.mkv` | FATE `mkv/dovi-p7-hvce.mkv` (inteiro) | MKV | 673212 | 0+673212 (inteiro) | `3287bac8deade11e1c57bd65b9c7c8750a1e38e286666cbb4fa39eac264875df` | **Profile 7 em MKV**: trilha unica 3840x2160 com BL+EL (`el_present=1`, `bl_present=1`, `dv_profile=7`, `dv_level=6`, compat_id=6), `dvcC` + caixa `hvcE` (configuracao HEVC da EL) em BlockAdditionMapping (Tracks@78, `dvcC`@4582, `hvcE`@4620; primeiro Cluster@5910); 1 frame. ffprobe lista tambem o side data "HEVC enhancement-layer decoder configuration". |
| `ffmpeg-fate/dv-p7-hvce.mp4` | FATE `mov/dovi-p7-hvce.mp4` (inteiro) | MP4 | 668126 | 0+668126 (inteiro) | `67baddaf158bc96c0c7955ca8894e92632df5ccca85bc68733f92f5f9fa7caaa` | **Profile 7 em MP4** (mesma midia do MKV): `dvcC` + `hvcE`, `dv_profile=7`, `dv_level=6`, compat_id=6, el_present=1, bl_present=1; faststart (moov 20..1124 antes do mdat); sample entry `hev1`. |
| `ffmpeg-fate/dv-p8.1-moov-end.mp4` | FATE `mov/dovi-p81.mp4` (inteiro) | MP4 | 3941 | 0+3941 (inteiro) | `3313278f3dc49b0b3680ec7c3d72622ec0a770faff9721c5842aaf899d5471c5` | **Profile 8.1**: `dv_profile=8`, `dv_level=4`, `dv_bl_signal_compatibility_id=1` (HDR10), `bl_present=1`, `el_present=0`; caixa `dvvC`; 1920x1080 0,42 s. **`moov` no fim** (mdat 36..2965, moov 2965..3941). |
| `dv-p8.1-mkvmerge.mkv` | DT `assets/hevc_tests/regular.mkv` (inteiro) | MKV | 78891 | 0+78891 (inteiro) | `8f1df1bf34973e1fa146800de0d9c8e6fad60dd2f229c88541b7534f720ff38f` | **Profile 8.1 em MKV real do mkvmerge v89.0**: `dv_profile=8`, `dv_level=1`, compat_id=1, bl=1, el=0; HEVC Main 10 256x144, 10,8 s; `dvvC`@4441 dentro de BlockAdditionMapping (`0x41E4`@4406). Primeiro Cluster em 8228: um cabecalho de >= 8,3 KB ja traz Tracks inteiro. |
| `dv-p8.4-hlg-iphone.mov` | AX `mp4/dolbyVision-hdr.MOV` (inteiro) | QuickTime/MOV | 64565 | 0+64565 (inteiro) | `c96e24bdfa7f3e0ef9b73b0b891805100119b9fa129e4cf10375af90846de534` | **Profile 8.4 (HLG)**: `dv_profile=8`, `dv_level=2`, `dv_bl_signal_compatibility_id=4`; caixa `dvvC`; HEVC Main 10 1280x720 + AAC-LC estereo + 3 trilhas `mebx` (metadados). **`moov` no fim** (ftyp, wide, mdat 28..59349, moov 59349..64565). Perfil "8.1" nao se aplica: e 8.4. |
| `dv-p9-avc-dvav-head512k.mp4` | AX `mp4/video_dovi_1920x1080_60fps_dvav_09.mp4` | MP4 | 524288 | 0+524288 de 3326794 | `9224a77c4f5eafdd4f07cb720aa653a025c6ecff8d0002fdc3aaf685e51f168c` | **Profile 9 (AVC)**: `dv_profile=9`, `dv_level=5`, compat_id=2, `dvvC`, sample entry `avc1`; H.264 High 1920x1080. `moov` no inicio (24..2119): recorte truncado no mdat (ffprobe le trilhas e side data; emite avisos de NAL/mdat truncado, esperado). Serve como exemplo de recorte so de cabecalho. |
| `dv-p10-av1-dav1-moov-end.mp4` | AX `mp4/video_dovi_3840x2160_30fps_dav1_10.mp4` (inteiro) | MP4 | 1460455 | 0+1460455 (inteiro) | `f7ba34a50a58af7359444fc2ed645bd9c96d38602963be91d272a4a3142cc3f3` | **Profile 10 (AV1)**: `dv_profile=10`, `dv_level=7`, compat_id=0, `dvvC` + `av1C`, sample entry `dav1`; 3840x2160 3,97 s. **`moov` no fim** (mdat 36..1458269, moov 1458269..1460455). Fora do alvo de HEVC, mas util como caso negativo. |

Cobertura por perfil pedido: P5 (MP4 moov-end, MP4 faststart, MKV), P7 (MP4 2 trilhas, MP4 e MKV com hvcE), P8.1 (MKV mkvmerge, MP4).
Nenhum arquivo e um filme/serie real; todos sao clipes de teste curtos (ate 10 s).
Lacuna: nao ha DV P5/P7 em MKV produzido por mkvmerge/MakeMKV (os MKV de P5 e P7 acima foram escritos pelo ffmpeg).

## DD+ Atmos (E-AC-3 JOC)

| Arquivo | Fonte | Conteiner | Bytes | Original | sha256 | Verificado |
|---------|-------|-----------|------:|----------|--------|------------|
| `eac3joc-atmos.mp4` | AX `mp4/sample_eac3joc.mp4` (inteiro) | MP4 | 164796 | 0+164796 (inteiro) | `febd1b3f77b8412ee72096c6535c0c1dc50d1bdfbaf2f6d9b44ebcab27df56c6` | ffprobe: `eac3`, tag `ec-3`, profile **"Dolby Digital Plus + Dolby Atmos"**, 6 canais (5.1(side)), 48 kHz, 2,05 s. Confirmado nos bytes: caixa `dec3` = `1400200f000110` -> data_rate 640 kbps, `flag_ec3_extension_type_a=1`, `complexity_index_type_a=16` (16 objetos). faststart (moov 24..948). |
| `eac3joc-atmos-fragmented.mp4` | AX `mp4/sample_eac3joc_fragmented.mp4` (inteiro) | MP4 fragmentado | 164895 | 0+164895 (inteiro) | `98e6f7269b57e3ceb86d9884a471ca704c8ddeacce5279a66f9a764d49adf2f4` | Idem; `dec3` identico (`1400200f000110`); boxes ftyp, moov, sidx, moof, mdat, mfra. |
| `eac3joc-atmos.ec3` | AX `ts/sample_eac3joc.ec3` (stream elementar) | E-AC-3 cru | 163840 | 0+163840 (inteiro) | `32fdd125ed45e6a34e2684e2cb9e81c0612113413a6d4aceac018b815d512edc` | ffprobe: profile "Dolby Digital Plus + Dolby Atmos", 5.1(side), 48 kHz, 2,05 s. JOC detectado pelo ffprobe a partir do EMDF no bitstream (nao inspecionei os bytes EMDF manualmente). |
| `eac3joc-atmos.mkv` | derivado de `eac3joc-atmos.ec3` (remux ffmpeg) | MKV | 164733 | derivado | `57b39db13a4bed7c72c2fbb23a2ff1dc54defbd47216f151e31f11ec954719b2` | `A_EAC3`, profile "Dolby Digital Plus + Dolby Atmos" (JOC so e visivel no bitstream; o MKV nao tem equivalente do `dec3`). Tracks@83, primeiro Cluster@401. |
| `eac3-plain-no-joc.mp4` | AX `mp4/sample_eac3.mp4` (inteiro) | MP4 | 216898 | 0+216898 (inteiro) | `bd0abdde84bcc042ce03e3ef166db4954605a6b66fc514fb0db605bd0c91f142` | Controle negativo: E-AC-3 5.1 **sem** JOC (ffprobe sem profile Atmos; `dec3` = `1f40200f00`, sem extensao tipo A), 1,73 s. |

## TrueHD

| Arquivo | Fonte | Conteiner | Bytes | Original | sha256 | Verificado |
|---------|-------|-----------|------:|----------|--------|------------|
| `truehd-atmos.mp4` | AX `mp4/sample_dthd.mp4` (inteiro) | MP4 | 98103 | 0+98103 (inteiro) | `554d59072c039e880e995b9568390b664323c906ddc835030d4c51f88e1b6877` | ffprobe: `truehd`, tag `mlpa`, profile **"Dolby TrueHD + Dolby Atmos"**, 8 canais (7.1), 48 kHz, 0,42 s. Atmos vem do ffprobe (flag no sync major do stream); o MP4 nao tem caixa propria para isso. |
| `ffmpeg-fate/truehd-atmos.thd` | FATE `truehd/atmos.thd` (inteiro) | TrueHD cru (MLP) | 58738 | 0+58738 (inteiro) | `020c9b9e67f80de105663af191740f8b60f550107c9f765b632f4cd5efb1c6ab` | ffprobe: `truehd`, profile "Dolby TrueHD + Dolby Atmos", 7.1, 48 kHz. Procedencia do audio nao documentada. |
| `ffmpeg-fate/truehd-atmos.mkv` | derivado de `atmos.thd` (remux ffmpeg) | MKV | 60088 | derivado | `ec58804946ed804b8d94ec3582c9135e4ea11f4d6797d80711bf08a8928baa3d` | **TrueHD Atmos em MKV** (`A_TRUEHD`): profile "Dolby TrueHD + Dolby Atmos", 7.1, 0,107 s; Tracks@83, primeiro Cluster@410. |
| `ffmpeg-fate/truehd-51-no-atmos.mkv` | derivado de FATE `lossless-audio/truehd_5.1.raw` (primeiros 0,5 s, remux ffmpeg) | MKV | 121760 | derivado de 0+655360 (fonte sha256 `f00a67adeec561c8bb9e98da06e38f5d3f204778ff931c592f81db54ce428127`) | `88e2ddd9fa72bb9f961fc4891c65d0d43294d3f3f2e6eb128e54946bef90ae68` | TrueHD 5.1(side) 48 kHz, ffprobe sem profile Atmos (controle negativo). 0,5 s. |
| (script-only) `truehd-5.1-ffvii-advent-children-head2m.mkv` | SFF `A-codecs/TrueHD/TrueHD Sample 1 (Final Fantasy VII Advent Children).mkv` | MKV | 2097152 | 0+2097152 de 15099622 | `d58f488627c14b0742e1182f7b2dba4ad78cb672b5b0be00cb7277451735b999` | H.264 High 1280x720 (jpn) + `truehd` 5.1(side), 16,2 s; sem Atmos no ffprobe. MKV "de verdade" (muxer de ripper), nao versionado por ser filme comercial. `fetch/fetch-truehd-5.1-ffvii-advent-children.sh` |
| (script-only) `truehd-atmos-dolby-music-demo-head2m.mka` | SFF `ffmpeg-bugs/trac/ticket7988/Dolby Atmos Music Demo.mka` | MKA | 2097152 | 0+2097152 de 33362292 | `755e593a0d42fc72a9d1e9d8bb8e47980fe6b6d91c54feeadb82919706e108eb` | `truehd` profile "Dolby TrueHD + Dolby Atmos", 7.1, eng, ~30 s. Conteudo Dolby, nao versionado. `fetch/fetch-truehd-atmos-dolby-music-demo.sh` |

Sobre TrueHD em MKV: as unicas amostras versionadas em MKV sao derivadas por remux do ffmpeg. Os MKV "de ripper" (acima) ficaram script-only.

## DTS

| Arquivo | Fonte | Conteiner | Bytes | Original | sha256 | Verificado |
|---------|-------|-----------|------:|----------|--------|------------|
| `dts-core.mkv` | AX `mkv/sample_with_dts.mkv` (inteiro) | MKV | 45877 | 0+45877 (inteiro) | `e8120f9c38a21d2aecc6ab1c47628ca7baa1c2d91b6d4c39e2e7e37e87e41791` | ffprobe: `dts`, profile **"DTS"** (core), 5.1(side), 48 kHz, 0,47 s; Tracks@83, primeiro Cluster@469. |
| `dts-hd-ma.mkv` | AX `mkv/sample_with_dts_hd_ma.mkv` (inteiro) | MKV | 205977 | 0+205977 (inteiro) | `522b99f24c104c4273beede93f7cdffe794e7c36376149706dcf41a9ed0c7df5` | `dts`, profile **"DTS-HD MA"**, 7.1, 48 kHz, eng, 1,0 s; primeiro Cluster@5417. |
| `dts-x.mkv` | AX `mkv/sample_with_dts_x.mkv` (inteiro) | MKV | 211187 | 0+211187 (inteiro) | `f97a1adcfb5811895961f084a9e3c4dc214ddde189fd7f0120fb5c7d3b9ae4ff` | `dts`, profile **"DTS-HD MA + DTS:X"**, 7.1(canais base), 48 kHz, eng, 1,0 s; primeiro Cluster@5397. DTS:X identificado pelo ffprobe. |
| `dts-express.mka` | AX `mka/sample_with_dts_express.mka` (inteiro) | MKA | 45646 | 0+45646 (inteiro) | `a1ae2b5bbe048ce4bf8efc3bf6ee59c5a7af49962ff5c2116129566fb43b8ce8` | `dts`, profile "DTS Express" (LBR), 5.1(side), 0,94 s. |
| `dts-hd-ma.mp4` | AX `mp4/sample_dts_hd_ma.mp4` (inteiro) | MP4 | 201034 | 0+201034 (inteiro) | `7968430b42c910cdb36b97c9893fa6fd90a23a4202088dac4dddd3c0c3f53efd` | `dts` (tag `mp4a`), profile "DTS-HD MA", 7.1, eng, 1,0 s. **`moov` no fim** (mdat 36..200076, moov 200076..201034). |

DTS core "puro" em MKV: `dts-core.mkv`. DTS-HD MA/DTS:X em MKV: acima. Nao inclui DTS:X em MP4.

## Bonus

| Arquivo | Fonte | Conteiner | Bytes | Original | sha256 | Verificado |
|---------|-------|-----------|------:|----------|--------|------------|
| `mkv-video-ac3-pgs.mkv` | AX `mkv/sample_with_pgs_subtitles.mkv` (inteiro) | MKV | 116069 | 0+116069 (inteiro) | `5fa25166b5bd371956b5cd8b7614403bdc046a29965fa82d2d051329a6ea9faa` | H.264 High 1080x720 (conforme ffprobe), AC-3 mono 44,1 kHz, legenda `hdmv_pgs_subtitle` (eng); Tracks@110, primeiro Cluster@5627. |
| `mkv-multitrack-ac3-eac3joc-dtshdma-truehd-pgs.mkv` | derivado (remux) de 4 amostras AX: video+AC-3+PGS de `sample_with_pgs_subtitles.mkv`, `sample_eac3joc.ec3`, `sample_with_dts_hd_ma.mkv`, `sample_dthd.mp4`; idiomas definidos por mim | MKV | 591548 | derivado | `3030e39e236103e5289f06e8a0b20f7e694a365d5c97c9264a4b8c5d9ff0c8f0` | 6 trilhas: video H.264 High; audio 0 AC-3 mono (eng); audio 1 E-AC-3 "Dolby Digital Plus + Dolby Atmos" 5.1(side) (por); audio 2 DTS-HD MA 7.1 (eng); audio 3 TrueHD "Dolby TrueHD + Dolby Atmos" 7.1 (jpn); legenda PGS (eng). Duracao da trilha mais longa 2,05 s; trilhas de duracoes diferentes (nao sincronizadas, so layout). Tracks@83, primeiro Cluster@1081. |
| MP4 com `moov` no fim | ver `ffmpeg-fate/dv-p5-moov-end.mp4`, `ffmpeg-fate/dv-p7-moov-end.mp4`, `ffmpeg-fate/dv-p8.1-moov-end.mp4`, `dv-p8.4-hlg-iphone.mov`, `dv-p10-av1-dav1-moov-end.mp4`, `dts-hd-ma.mp4` | MP4/MOV | - | - | - | Todos os arquivos acima ja sao inteiros, entao sao parseaveis; para testar "o cabecalho nao basta", cortar-os no teste (ex.: `head -c 2048`) ou usar o par `dv-p5-moov-end.mp4` (moov em 3226) vs `dv-p5-faststart.mp4` (moov em 32). Nao ha um recorte de inicio pre-fabricado de MP4 com `moov` no fim (seria nao parseavel e sem uso alem do teste negativo). |

## Script-only (bytes NAO versionados)

Cada um baixa `Range: bytes=0-2097151` (2 MiB) da URL e confere o sha256. Motivo: conteudo comercial ou de demo de fabricante, sem licenca de redistribuicao.

| Script | Saida | URL | sha256 do recorte | Conteudo verificado (ffprobe sobre o recorte baixado) |
|--------|-------|-----|-------------------|--------------------------------------------------------|
| `fetch/fetch-truehd-5.1-ffvii-advent-children.sh` | `truehd-5.1-ffvii-advent-children-head2m.mkv` | https://samples.ffmpeg.org/A-codecs/TrueHD/TrueHD%20Sample%201%20(Final%20Fantasy%20VII%20Advent%20Children).mkv (15 099 622 bytes) | `d58f488627c14b0742e1182f7b2dba4ad78cb672b5b0be00cb7277451735b999` | MKV; H.264 High 1280x720; TrueHD 5.1(side), 48 kHz; sem Atmos |
| `fetch/fetch-truehd-atmos-dolby-music-demo.sh` | `truehd-atmos-dolby-music-demo-head2m.mka` | https://samples.ffmpeg.org/ffmpeg-bugs/trac/ticket7988/Dolby%20Atmos%20Music%20Demo.mka (33 362 292 bytes) | `755e593a0d42fc72a9d1e9d8bb8e47980fe6b6d91c54feeadb82919706e108eb` | MKA; TrueHD "Dolby TrueHD + Dolby Atmos" 7.1, 48 kHz |
| `fetch/fetch-dv-p4-lg-demo-trailer.sh` | `dv-p4-lg-demo-trailer-head2m.ts` | https://samples.ffmpeg.org/ffmpeg-bugs/trac/ticket5688/LG%20Demo%20DolbyVision%20Trailer.mkv (323 325 596 bytes) | `55e17c4a0c42abb52f955261e7e11bff48756d3eb8ac447595be3b41d22b72ca` | Apesar da extensao `.mkv`, o formato e **MPEG-TS** (`mpegts`): HEVC Main 10 3840x2160 com DOVI config `dv_profile=4`, `dv_level=6`, bl=1, el=1, compat_id=0 + E-AC-3 5.1. Perfil 4 (legado), caso negativo; a mesma pasta tem uma variante .ts. |

## Lacunas

- **Dolby Vision Profile 5/7/8.1 em MKV produzido por ripper/mkvmerge**: so existe o P8.1 do dovi_tool (MIT). Os MKV de P5 e P7 versionados sao remux do ffmpeg (P7 vindo do FATE ja em MKV; P5 derivado do MP4).
- **Dolby Vision P5 e P7 com licenca explicita**: nao achei nenhum. As unicas amostras abertas achadas estao na FATE (sem licenca explicita); os bytes ficaram isolados em `ffmpeg-fate/`.
- **Kit oficial Dolby OTT** (`https://ott.dolby.com/browser_test_kit/source_mp4s/{24,25,30,50,120}fps.zip`, MP4 com DV P5/P8.1/P8.4 e DD+ Atmos): a documentacao (`.../help_files/topics/r_test_signals_all.html`) so traz "(c)2024 Dolby Laboratories. All rights reserved." sem concessao de redistribuicao, e os ZIPs responderam **HTTP 403 AccessDenied** a `curl` (com e sem Range), entao nem o script-only e possivel. Nao verificado se exige login/referer.
- **TrueHD Atmos em MKV "de ripper"**: so script-only (Dolby Atmos Music Demo, direitos Dolby). O MKV versionado e remux de `atmos.thd` (FATE).
- **TrueHD 5.1 sem Atmos redistribuivel em MKV**: so o remux de `truehd_5.1.raw` (FATE, procedencia do audio desconhecida) e o script-only do Final Fantasy VII.
- **DTS:X em MP4** e **DTS-HD MA/DTS:X de disco real (m2ts)**: nao achei redistribuivel. Os MKV/MP4 do androidx cobrem DTS core, DTS-HD MA, DTS:X (MKV) e DTS Express.
- **MKV com varias faixas de audio criado por ripper real**: o multitrack versionado e uma construcao minha (remux de 4 amostras Apache-2.0); MKV real multitrack (FFmpeg `Matroska/multiple_tracks.mkv`, 12 MB) tem licenca incerta e nao foi incluido.
- **E-AC-3 JOC fora de teste**: os JOC sao curtos (2 s, 5.1(side) com 16 objetos). O E-AC-3 JOC do FATE (`eac3/the_great_wall_7.1.eac3`, 7.1) e audio de filme comercial, nao incluido. O Dolby Atmos 7.1.4 Channel Check e as test tones oficiais do Dolby (`dolby.com/us/en/guide/test-tones.html`) nao foram baixados (termos de uso nao confirmados).
- **Confirmacao de "Atmos"**: para TrueHD, DTS:X e o `.ec3`/MKV de E-AC-3 a confirmacao e a do ffprobe (profile). Para E-AC-3 em MP4 confirmei tambem os bytes da caixa `dec3`. Nao parseei manualmente o EMDF/JOC do bitstream nem o major sync do TrueHD.
- **Procedencia individual das midias do androidx/media**: a licenca Apache-2.0 e do repositorio; o repo nao documenta a origem de cada arquivo.

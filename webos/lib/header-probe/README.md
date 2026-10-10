# header-probe

Biblioteca JS que lê só o cabeçalho de um MKV/WebM ou MP4 por HTTP Range e descreve as faixas:

- tipo, codec, idioma, nome, canais e flags (padrão, forçada…);
- legendas (texto ou bitmap);
- HDR e a configuração **Dolby Vision**: perfil, nível e camada base compatível;
- **Atmos**: E-AC-3 JOC e TrueHD;
- variante do **DTS**: core, DTS-HD MA, DTS-HD MA + DTS:X, Express ou DTS-UHD.

É a decisão D5 do [plano](../../docs/PLANO-PORT-WEBOS4.md) (Fase 5, item 2). Substitui o `/tracks` do servidor de streaming, e a saída alimenta as regras da C8 (F5.3).

- JS puro em CommonJS, sem APIs de Node no runtime. Usa só `Uint8Array`, `DataView`, `TextDecoder`, `fetch` e `ReadableStream`, que existem no Chromium 53.
- Depois do babel (`preset-env`, alvo `chrome 53`) roda no emulador webOS TV 4.0 (ver [smoke](#smoke-no-emulador)).
- Sem dependências.

## Uso

```js
const { probeUrl, probe } = require('./webos/lib/header-probe');

probeUrl(streamUrl).then((result) => {
    result.summary.dolbyVision;   // { profileName: '8.1', baseLayer: 'hdr10', … } ou null
    result.tracks.filter((t) => t.type === 'audio');
});

// Leitura injetável (testes, outra origem de bytes):
// readRange(offset, length) -> Promise<{ data: Uint8Array, size: number | null }>
probe(readRange, options);
```

O contrato de `readRange` tem duas regras:

- `data` começa em `offset` e só pode vir menor que `length` no fim do arquivo.
- `size` é o tamanho total do arquivo (do `Content-Range`) ou `null`, se desconhecido.

`probeUrl` usa `createFetchReadRange(url)`, com este comportamento:

- manda `Range: bytes=a-b` e lê `Content-Range` para saber o tamanho;
- trata 416 como fim de arquivo;
- depois de um redirect (link de debrid), reaproveita a URL final;
- se o servidor ignorar o Range (resposta 200), lê só o necessário do corpo e cancela o resto, até `maxSkipBytes`;
- recusa (`HTTP`) um 206 cujo `Content-Range` começa depois do offset pedido. Se o `Content-Range` não estiver legível (servidor de outra origem que não o expõe via CORS), aceita o 206 só quando o `Content-Length` não passa do tamanho pedido.

| Opção | Padrão | Efeito |
|---|---|---|
| `blockSize` | 256 KB | Tamanho mínimo de cada pedido Range (cache por blocos) |
| `maxBytes` | 8 MB | Teto de bytes baixados por probe |
| `maxRequests` | 24 | Teto de pedidos HTTP por probe |
| `sniffFrames` | `true` | Lê o 1º quadro quando o cabeçalho não basta: áudio no MKV (E-AC-3, TrueHD, DTS) e no MP4 (TrueHD, DTS sem tipo na sample entry, E-AC-3 sem o flag JOC na `dec3`), para detectar Atmos e o tipo de DTS; e vídeo HEVC 10-bit no MKV sem `BlockAdditionMapping` DV, para achar o RPU de Dolby Vision |
| `sniffMaxBlocks` / `sniffMaxClusters` | 256 / 2 | Até onde procurar esses quadros |
| `fetch`, `headers`, `timeout` (15 s), `maxSkipBytes` (1 MB) | | Só `probeUrl` / `createFetchReadRange` |

Os erros são `ProbeError` com `code`:

- `UNSUPPORTED`: não é MKV nem MP4.
- `INVALID`, `TRUNCATED`, `NO_TRACKS`: arquivo corrompido ou incompleto.
- `LIMIT`: estourou `maxBytes` ou `maxRequests` antes de achar as faixas.
- `HTTP`, `NETWORK`, `TIMEOUT`, `RANGE_NOT_SUPPORTED`: falhas de rede ou de servidor.

`probe()` só rejeita com `ProbeError`: qualquer outra exceção de parser (dado corrompido) vira `ProbeError('INVALID')`.

Se o limite estourar só durante a leitura de quadros, o resultado sai normalmente: os campos que dependiam dela ficam `null` e um aviso entra em `warnings`.

### Custo típico

Medido com as fixtures e com URLs reais:

| Caso | Pedidos | Bytes lidos | Observação |
|---|---|---|---|
| MKV comum (Tracks no início) | 1 | 256 KB | |
| MKV com Atmos ou DTS | 1 a 3 | 256 KB a 768 KB | Os blocos de vídeo grandes são pulados pelo tamanho, sem baixar |
| MP4 com `moov` no início | 1 a 2 | 256 KB a 512 KB | |
| MP4 com `moov` no fim | 2 | ~280 KB | Ex.: arquivo de 50 MB: o probe salta o `mdat` e lê só as caixas das faixas (`tkhd`, `mdhd`, `hdlr`, `stsd`); as tabelas de amostras ficam de fora |
| MKV HEVC 10-bit sem `BlockAdditionMapping` DV | + 0 a ~5 | + até o tamanho do 1º quadro-chave | Os NAL units do 1º quadro de vídeo são percorridos pelo tamanho até o RPU (o último NAL do quadro); num 4K, alguns pedidos de 256 KB a mais. MKV com DV sinalizado (mkvmerge 50+, FFmpeg 6+) e HEVC 8-bit não pagam isso |

## Formato da saída (versão 1)

Este é o contrato com a F5.3. Se mudar de forma incompatível, `version` sobe.

```js
{
    version: 1,
    container: 'mkv' | 'webm' | 'mp4',
    size: 1965803 | null,              // bytes do arquivo (Content-Range)
    durationSec: 2.084 | null,
    // MKV:
    title, muxer,                      // Info/Title, WritingApp
    seekIndex: true | false | null,    // MKV: há Cues (índice de seek)? null = desconhecido
    // MP4:
    brand: 'isom', moovAtStart: true, fragmented: false,
    tracks: [Track],
    summary: Summary,
    warnings: [Warning],               // o que não deu para ler (não é erro), ver abaixo
    stats: { requests: 1, bytesRead: 262144 },
}
```

**Track** (todos os campos sempre presentes; `null` significa "não informado no arquivo"):

| Campo | Valores |
|---|---|
| `index` | posição na lista (0…) |
| `id` | MKV `TrackNumber` / MP4 `track_ID` |
| `type` | `video`, `audio`, `subtitle`, `other` |
| `codec` | normalizado: `hevc`, `avc`, `av1`, `vp9`, `eac3`, `ac3`, `truehd`, `dts`, `aac`, `opus`, `flac`, `mp3`, `pcm`, `ac4`, `srt`, `ass`, `ssa`, `webvtt`, `pgs`, `vobsub`, `dvbsub`, `tx3g`, `ttml`, `unknown`… |
| `codecId` | bruto: `V_MPEGH/ISO/HEVC`, `A_EAC3`, `dvh1`, `ec-3`… |
| `language` | ISO 639-2 (`por`, `eng`); `null` para `und`. No MKV, a ausência do elemento vale `eng` (padrão da especificação) |
| `languageBcp47` | `pt-BR` etc. (MKV `LanguageBCP47`, MP4 `elng`) |
| `name` | título da faixa (MKV `Name`; MP4 `hdlr` quando não é genérico, como "SoundHandler") |
| `default`, `forced`, `enabled` | MKV: flags (padrões da especificação: `default` = true). MP4: `default` = `enabled` = flag de `tkhd`, como no FFmpeg |
| `hearingImpaired`, `visualImpaired`, `commentary`, `original` | flags do MKV (no MP4: `false` / `null`) |

`video`:

- `width`, `height`, `profile` (`Main 10`), `level`, `bitDepth`.
- `colour`: `{ primaries, transfer, matrix, fullRange }`. Exemplos: `bt2020`, `pq`/`hlg`/`bt709`, `bt2020nc`. Vem do MKV `Colour` ou do MP4 `colr`; na falta deles, do VUI do SPS HEVC.
- `maxCll`, `maxFall`.
- `hdr`: `dolby-vision`, `hdr10` (transfer PQ), `hlg`, `sdr` ou `null` (desconhecido).
- `dolbyVision`: `null` ou um objeto:

```js
{ profile: 8, profileName: '8.1', level: 5, compatibilityId: 1,
  baseLayer: 'hdr10' | 'sdr' | 'hlg' | 'none' | 'unknown',
  rpuPresent, elPresent, blPresent, version: '1.0',
  source: 'config' | 'rpu' | 'sample-entry' }
```

`source` diz de onde veio a informação:

- **`config`:** registro de configuração DV (`dvcC`/`dvvC`/`dvwC` no MP4, `BlockAdditionMapping` no MKV). Todos os campos preenchidos.
- **`rpu`:** MKV HEVC sem `BlockAdditionMapping` DV (mkvmerge antigo); o probe achou o RPU (NAL 62) no 1º quadro de vídeo e deduziu o perfil como o dovi_tool (5, 7, 8; 4 é legado). `level`, `version` e, fora da P5, `compatibilityId` não estão no RPU: na P8 o `compatibilityId`/`profileName` (`8.1`, `8.2`, `8.4`) e o `baseLayer` vêm da cor do vídeo (PQ, SDR, HLG); sem cor conhecida, `profileName: '8'` e `baseLayer: 'unknown'`. `elPresent` vem da presença de NAL 63.
- **`sample-entry`:** MP4 com sample entry `dvh1`/`dvhe`/`dva1`/`dvav`/`dav1` sem caixa de configuração: DV de perfil desconhecido, os outros campos `null`.

Num MKV HEVC 10-bit sem `BlockAdditionMapping` DV, `dolbyVision: null` sem aviso significa "o 1º quadro foi lido e não tem RPU": não é DV. Se o quadro não pôde ser lido, sai `null` com o aviso `DV_UNKNOWN` para a faixa.

`baseLayer` é o que a TV mostra sem DV:

- **`none`:** P5, ou a faixa EL de uma P7 dual-track (camada base em outra faixa).
- **`hdr10`:** P7 (compat 6) e P8.1.
- **`hlg`:** P8.4.

`audio`:

- `channels`, `sampleRate`, `bitDepth`.
- `profile`: `E-AC-3 JOC`, `TrueHD Atmos`, `DTS` (core), `DTS-HD MA`, `DTS-HD MA + DTS:X`, `DTS-HD`, `DTS Express`, `DTS-UHD` (MP4 `dtsx`/`dtsy`: DTS:X perfil 2, sem core DCA), `AAC LC`, `HE-AAC`… ou `null`.
- `atmos`: `true` ou `false`, e `null` quando não foi possível saber (E-AC-3 ou TrueHD sem leitura do 1º quadro: `sniffFrames: false`, MP4 fragmentado, quadro fora do alcance; sempre com aviso). No MP4, a `dec3` só decide sozinha quando o flag JOC está ligado (`true`); sem a extensão, ou com ela zerada, o 1º quadro decide, porque há muxers que omitem ou zeram a extensão de um stream JOC.
- AC-4 sai com `atmos: null`: a apresentação imersiva da AC-4 não é lida (a C8 não decodifica AC-4).
- `complexityIndex` (MP4 `dec3`, só com JOC).

Codecs que não carregam Atmos sempre saem com `atmos: false`.

`subtitle`: `{ text: true | false }`. É `false` para legendas bitmap: PGS, VobSub, DVB.

**Warning** (`warnings[]`): `{ code, track, message }`, onde `track` é o `id` da faixa ou `null`. Os `code` são estáveis (a F5.3 pode testá-los); `message` é texto livre:

| `code` | Quando |
|---|---|
| `DV_UNKNOWN` | MKV HEVC 10-bit sem `BlockAdditionMapping` DV cujo 1º quadro não foi lido (`sniffFrames: false`, limite, sem Cluster, quadro comprimido/cifrado). Pode ser Dolby Vision, inclusive P5 |
| `FRAME_NOT_FOUND` | A faixa precisava do 1º quadro (Atmos, tipo de DTS) e ele não foi achado ou reconhecido; os campos dependentes ficam `null` |
| `FRAMES_UNREADABLE` | MKV com compressão zlib ou criptografia na faixa: os quadros não são lidos |
| `READ_LIMIT` | A leitura de quadros parou por `maxBytes`/`maxRequests`/rede (`track: null` no MKV, pois vale para todas as faixas pendentes) |

**Summary** (atalho para as regras da F5.3):

```js
{
    videoCodec: 'hevc', width: 1920, height: 1080,
    hdr: 'dolby-vision' | 'hdr10' | 'hlg' | 'sdr' | null,
    dolbyVision: DolbyVision | null,   // da faixa com DV; na P7 dual-track, baseLayer = a camada base real
    dolbyVisionDualTrack: false,       // P7 em MP4 com BL e EL em faixas separadas
    atmos: true | false | null,        // true se alguma faixa tem Atmos; null se alguma ficou indeterminada
    audioCodecs: ['eac3', 'dts'],      // sem repetição, na ordem das faixas
    audioTracks: 3, subtitleTracks: 1,
}
```

## Detalhes e limites conhecidos

- **DV em MKV** vem do `BlockAdditionMapping` (`dvcC`/`dvvC`), que o mkvmerge (v. 50+) e o FFmpeg (6+) gravam. Em MKV mais antigo, sem esse elemento, o probe lê o 1º quadro de vídeo e procura o RPU (`source: 'rpu'`, ver acima); se não conseguir ler, avisa com `DV_UNKNOWN`. O nome do stream continua sendo um reforço útil para a F5.3.
- **Atmos em MKV** não está no cabeçalho. O probe acha o primeiro bloco da faixa no primeiro Cluster e lê o quadro:
  - **E-AC-3:** `flag_ec3_extension_type_a` no `addbsi`, a mesma lógica do FFmpeg `eac3dec`;
  - **TrueHD:** major sync com 4 substreams e o bit de Atmos (FFmpeg `mlpdec`).
  - Tratados também: lacing (Xiph/EBML/fixo), header stripping e `Block` em qualquer posição do `BlockGroup`. Com compressão zlib ou criptografia (raros), os quadros não são lidos (aviso `FRAMES_UNREADABLE`).
- **DTS:** em MKV, a variante sai das palavras de sincronismo do 1º quadro. Substream `0x64582025` indica DTS-HD; XLL indica MA; os syncs `0x02000850` ou `0xF14000D0` dentro do XLL indicam DTS:X (como o FFmpeg, `DTS-HD MA + DTS:X`); LBR indica Express. No MP4, a variante vem do tipo da sample entry (`dtsc`, `dtsh`, `dtsl`, `dtse`, `dtsx`); com `mp4a`, vem da 1ª amostra.
- **TrueHD em MP4 (`mlpa`):** canais e taxa saem da caixa `dmlp`; Atmos sai da 1ª amostra, localizada pela tabela `stco`/`co64`.
- **MP4 com `moov` no fim:** o probe salta o `mdat` pelo tamanho; não precisa do tamanho do arquivo.
- **MP4 fragmentado:** faixas, codecs e DV saem do `moov` normalmente, mas a tabela `stco` vem vazia (as amostras ficam nos pares `moof`/`mdat`) e a 1ª amostra não é procurada no `moof`. TrueHD, DTS em `mp4a` e E-AC-3 sem o flag JOC na `dec3` ficam então com `atmos`/`profile` `null` e o aviso `FRAME_NOT_FOUND`. Os links de debrid são arquivos inteiros, não fragmentados.
- **Fora do escopo:** MPEG-TS/M2TS, AVI e HLS/DASH. Viram `UNSUPPORTED`.
- **Chromium 53:** não tem `AbortController`. O timeout rejeita a promessa, mas a conexão só fecha quando o servidor termina; com `getReader()`, o corpo é cancelado assim que os bytes necessários chegam.

## Decisão: `get-tracks-data`

Avaliamos o pacote usado pelo servidor da Stremio (`get-tracks-data` 0.8.2, ISC, https://github.com/tymmesyde/get-tracks-data). **Decisão: escrever uma biblioteca própria**, com a mesma ideia (ler só o cabeçalho, sem ffprobe) e a estrutura de EBML e caixas MP4 como referência. Motivos:

1. **Não roda no navegador:** importa `fs`, `stream` (`Readable`), `Buffer` e `follow-redirects` (http/https do Node). Para adaptar, seria preciso trocar toda a camada de I/O, que é metade do pacote.
2. **Saída insuficiente para a C8:** devolve só `{ id, type, lang, label, codec }`. Faltam canais, faixa padrão ou forçada, cor e HDR, configuração Dolby Vision (`dvcC`/`dvvC` no MP4, `BlockAdditionMapping` no MKV), Atmos (`dec3`, quadro E-AC-3 ou TrueHD) e o tipo de DTS, que são exatamente as entradas da F5.3.
3. **Leitura cara:** pede blocos de 15 MB. No MKV, exige que Segment e Tracks caibam no 1º bloco e não usa SeekHead. No MP4 com `moov` no fim, baixa o `moov` inteiro (vários MB num filme).
4. Tem um `console.log` de depuração no caminho do MP4 e não tem testes.

Adaptar exigiria reescrever I/O e saída, ou seja, quase tudo. A biblioteca própria tem cerca de 2.100 linhas, zero dependências e leitura incremental com teto de bytes e pedidos.

## Testes

```bash
pnpm test                                   # inclui webos/lib/header-probe/test/*.test.js
```

- `test/codecs.test.js`: registros DOVI, RPU de Dolby Vision, `dec3`, BSI de E-AC-3, major sync do TrueHD (Atmos × 3 substreams × bit zerado), DTS (inclusive DTS:X), AAC e exp-Golomb montados bit a bit.
- `test/catalog.test.js`: o probe sobre o catálogo de cabeçalhos reais da F0.10 (`webos/tests/media/headers/`, arquivos inteiros): DV P8.1, P8.4, P9 e P10, Atmos (MP4, MP4 fragmentado, MKV), TrueHD, DTS em todas as variantes e um MKV multifaixa com PGS.
- `test/mkv.test.js`: MKV sintéticos (`test/mkvbuild.js`) com lacing Xiph, EBML e fixo, header stripping e `BlockGroup` com outro filho antes do `Block`.
- `test/source.test.js`: cache por blocos, limites, e `createFetchReadRange` com servidor falso (206, 200 sem Range, 416, redirect, erros).
- `test/fixtures.test.js`: **cabeçalhos reais** com Dolby Vision P5 e P8.1 (MP4 e MKV, inclusive um MKV do mkvmerge), DD+ Atmos e E-AC-3 sem Atmos, TrueHD Atmos (MP4 e MKV), DTS, DTS-HD MA, DTS:X e DTS Express (MKV e MP4), comparados com o `ffprobe`. Fontes, licenças e checksums em [`__fixtures__/SOURCE.md`](__fixtures__/SOURCE.md); textos das licenças em [`__fixtures__/LICENSES/`](__fixtures__/LICENSES/).
- **Dolby Vision P7** só existe em fonte sem licença de redistribuição (FATE). Essas fixtures ficam fora do git e são gravadas por `webos/lib/header-probe/tools/fetch-fate-fixtures.sh`, que baixa e confere o sha256. Sem elas, os dois testes `[FATE] …` são pulados e o jest imprime `[header-probe] PULANDO 2 teste(s) de Dolby Vision P7 …`.

A ferramenta de desenvolvimento (Node) roda o probe numa URL ou num arquivo e grava fixtures:

```bash
node webos/lib/header-probe/tools/probe.mjs <url|arquivo> [--summary] [--no-sniff] [--record <id> --block-size N]
```

## Smoke no emulador

```bash
webos/tools/emu-run -- webos/lib/header-probe/smoke/run.sh <pasta-de-saída>
```

O script faz o seguinte:

1. Remonta cada fixture como arquivo esparso do tamanho original (`smoke/materialize.mjs`).
2. Serve as fixtures e duas mídias sintéticas do kit com o `webos/tools/media-server.mjs` (Range, CORS e uma URL via `/redirect/`).
3. Empacota e instala o app `smoke/app` com o bundle transpilado para Chrome 53 (`smoke/build.mjs`).
4. Roda o probe no emulador via `cdp.mjs` e compara o JSON de cada arquivo com o do mesmo probe no Node (`smoke/compare.mjs`).

Na saída ficam `emulator.json`, `compare.txt` e as capturas.

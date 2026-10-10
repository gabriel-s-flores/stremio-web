# c8-rules

Motor de regras de capacidade da LG OLED55C8PSA (webOS TV 4.0). Recebe a saída do [probe de cabeçalho](../header-probe/README.md) (F5.2), o texto do stream vindo do addon, ou os dois, e decide o que a C8 vai de fato mostrar e tocar:

- a **faixa de áudio inicial**: uma que toque na TV, no idioma preferido do usuário;
- os **rótulos**: "DV", "HDR10 nesta TV", "Atmos"…;
- os **avisos**: DV P5 em MKV, TrueHD sem alternativa, DTS a confirmar, AV1…;
- a **nota** e a **camada** (`tier`), que a ordenação da lista de streams (F6.2) usa.

São as decisões D6 a D8 do [plano](../../docs/PLANO-PORT-WEBOS4.md) (Fase 5, item 3) aplicadas à tabela "O que a C8 entrega" (seção 2). Os fatos da TV ficam em [`perfil-c8.json`](perfil-c8.json), e a Fase 8 os ajusta por configuração, sem mudar código (D6).

- JS puro em CommonJS, sem dependências e sem APIs de Node no runtime. O código já fica dentro do ES2016 que o Chromium 53 entende, e o bundle transpilado (`preset-env`, alvo `chrome 53`) roda no emulador webOS TV 4.0 (ver [smoke](#smoke-no-emulador)).
- Não faz rede nem guarda estado. Quem chama decide quando rodar o probe (o campo `needsProbe` ajuda).
- Ainda não está integrado ao app: o player usa a lib na F5.4, e a lista de streams na F6.2.

## Uso

```js
const { evaluate, sortStreams, mergeProfile, DEFAULT_PROFILE } = require('./webos/lib/c8-rules');

const result = evaluate({
    probe: probeResult,                  // saída do probe (formato v1) ou null
    stream: addonStream,                 // { name, title, description, behaviorHints: { filename } } ou string
    preferences: { audioLanguages: ['por', 'eng'] },   // em ordem; ISO 639-1/639-2/BCP 47
    profile: DEFAULT_PROFILE,            // opcional; mergeProfile(DEFAULT_PROFILE, ajustes) na Fase 8
});

result.audio.initialTrack;               // { id, codec, language, … } ou null
result.labels;                           // [{ code: 'hdr10-on-tv', text: 'HDR10 nesta TV', source: 'probe' }]
sortStreams(streams, (stream) => stream.rules);      // nova lista; no empate, mantém a ordem do addon
```

Também são exportados `compare(a, b)` (a ordem usada por `sortStreams`), `parseStreamName(stream)` (os sinais lidos do nome, abaixo), `normalizeLanguage(code)` e `VERSION`.

### Entradas

- **`probe`:** a saída do probe na versão 1. Se `version` for outra, o probe é ignorado e sai o aviso `PROBE_IGNORED`. Em caso de erro do probe (`ProbeError`), passe `null`.
- **`stream`:** o objeto de stream do addon ou um texto. O motor junta `name`, `title`, `description` e `behaviorHints.filename`.
- **`preferences.audioLanguages`:** os idiomas em ordem de preferência, por exemplo `[audioPreference.language, settings.audioLanguage]`. Os códigos são normalizados para ISO 639-2/T, então `pt`, `pt-BR`, `por` e o `fre` do MKV contra o `fra` do MP4 se casam.

### Sinais do nome do stream (`parseStreamName`)

| Sinal | Exemplos reconhecidos |
|---|---|
| Dolby Vision | `DV`, `DoVi`, `Dolby Vision` (mas não `DVDRip`) |
| Perfil DV | `DV P5`, `DV.P8.1`, `DoVi Profile 7`, `DV FEL`/`MEL` = P7. Só vale com um token DV no texto (`Season 1 P5` não é DV). `P8` sozinho vira 8.1 (8.4 com `HLG`, 8.2 com `SDR`) |
| HDR | `HDR10`, `HDR` (vale HDR10), `HDR10+`/`HDR10Plus`, `HLG`, `SDR` |
| Áudio | `DDP`, `DD+`, `E-AC-3`/`EAC3`/`EC3`, `Dolby Digital+`; `AC3`, `DD5.1`, `Dolby Digital`; `TrueHD`; `DTS`, `DTS-HD MA`, `DTSHDMA`, `DTS:X`; `AAC`, `FLAC`, `Opus`, `LPCM`, `MP3`; `Atmos`, `DDPA` (= DD+ Atmos). Os canais podem vir colados (`TrueHD7.1`, `DTS5.1`) |
| Vídeo | `HEVC`/`x265`/`H.265`/`H-265`, `AVC`/`x264`/`H.264`, `AV1`, `VP9`. DV pelo nome é ignorado quando o vídeo citado é AVC, AV1 ou VP9 |
| Contêiner | extensão de `behaviorHints.filename` ou `mkv`/`mp4`/`webm` no texto |

O Atmos é atribuído ao E-AC-3 ou ao TrueHD conforme o codec citado. Com os dois (ou nenhum) no nome, o motor não sabe a qual faixa ele pertence e não usa o sinal.

## Formato da saída (versão 1)

```js
{
    version: 1,
    profileVersion: 1,
    sources: { probe: true, name: true },      // o que foi usado
    container: 'mkv' | 'mp4' | 'webm' | null,
    video: {
        codec: 'hevc' | 'avc' | 'av1' | … | null,
        status: 'ok' | 'unknown' | 'unsupported' | null,
        format: 'dolby-vision' | 'hdr10' | 'hdr10plus' | 'hlg' | 'sdr' | null,   // o que o arquivo tem
        output: 'dolby-vision' | 'hdr10' | 'hlg' | 'sdr' | 'wrong-colors' | null, // o que a C8 mostra
        dolbyVision: null | { profile: '8.1', baseLayer: 'hdr10', dualTrack: false,
                              mode: 'dolby-vision' | 'base-layer', source: 'probe' | 'name' },
    },
    audio: {
        status: 'ok' | 'unconfirmed' | 'unknown' | 'unsupported' | null,  // da faixa inicial (ou do nome)
        initialTrack: AudioTrack | null,       // null: nenhuma faixa toca, ou não há probe
        tracks: [AudioTrack],                  // todas, da melhor para a pior
        atmos: true | false,                   // a faixa inicial (ou o nome) entrega Atmos na C8
    },
    subtitles: { tracks: [SubtitleTrack], hidden: [SubtitleTrack] },     // hidden: PGS, VobSub, DVB
    playbackRates: [1],
    labels: [{ code, text, source }],
    warnings: [{ code, severity: 'info' | 'demote' | 'hide', score, source, track, message }],
    score: 25,
    tier: 'ok' | 'demoted' | 'hidden',
    needsProbe: false,                         // só nome, com uma dúvida que o probe resolveria (áudio *_POSSIBLE, DV fora do MP4)
}
```

**AudioTrack:** `index` e `id` (os do probe), `codec`, `profile` (`E-AC-3 JOC`, `DTS-HD MA`…), `language` (ISO 639-2/T ou `null`), `name`, `channels`, `default`, `atmos` (`true`/`false`/`null`), `atmosSource` (`probe`, `name` ou `null`), `atmosOnTv` (o Atmos que a C8 reproduz: só E-AC-3 JOC), `status`, `preferredLanguage` e as chaves de ordenação (`languageRank`, `secondary`, `preference`).

**SubtitleTrack:** `index`, `id`, `codec`, `language`, `name`, `default`, `forced`, `text`.

`source` diz de onde veio cada conclusão: `probe`, `name` ou `probe+name`. Quando o probe está presente, a escolha da faixa de áudio sempre usa as faixas dele.

### Rótulos

| `code` | Texto padrão | Quando |
|---|---|---|
| `dv` | DV | Dolby Vision ativo na C8: MP4 com P5, P8.1 ou P7 dual-track |
| `hdr10-on-tv`, `hlg-on-tv`, `sdr-on-tv` | HDR10 nesta TV… | O arquivo tem DV (ou HDR10+), mas a C8 mostra a camada base: DV em MKV P7/P8.x, DV em MP4 fora da lista acima, HDR10+ |
| `hdr10`, `hlg` | HDR10, HLG | HDR10 ou HLG puro |
| `atmos` | Atmos | A faixa inicial é DD+ Atmos (E-AC-3 JOC). TrueHD Atmos não ganha o rótulo (não toca) |

### Avisos

| `code` | Severidade | Nota | Quando |
|---|---|---|---|
| `VIDEO_UNSUPPORTED` | hide | −1000 | AV1 (probe ou nome) |
| `VIDEO_UNKNOWN` | info | −10 | VP9 e outros sem informação |
| `DV_WRONG_COLORS` | demote | −200 | DV sem camada base (P5) num contêiner onde a C8 não ativa DV: MKV ou contêiner desconhecido. Vem do probe ou de um `DV P5` explícito no nome |
| `DV_WRONG_COLORS_POSSIBLE` | demote | −60 | DV sem perfil nem camada base conhecidos (nome `DV` sem `HDR`) em MKV ou contêiner desconhecido: pode ser P5 |
| `DV_UNVERIFIED` | info | −10 | O probe avisou `DV_UNKNOWN` e o nome não diz nada sobre DV |
| `DV_BASE_LAYER` | info | 0 | DV que a C8 mostra como HDR10/HLG/SDR (acompanha o rótulo `*-on-tv`) |
| `DV_BASE_LAYER_UNKNOWN` | info | −10 | DV de perfil conhecido (não P5) com camada base desconhecida |
| `AUDIO_UNSUPPORTED` | demote | −200 | Probe: nenhuma faixa toca (TrueHD-only, DTS sem núcleo, FLAC com mais de 2 canais) |
| `AUDIO_UNSUPPORTED_POSSIBLE` | demote | −60 | Nome: só cita codecs que não tocam (TrueHD) |
| `AUDIO_UNCONFIRMED` | demote | −40 | Probe: a única opção é DTS (D8: a confirmar) |
| `AUDIO_UNCONFIRMED_POSSIBLE` | demote | −20 | Nome: o melhor codec citado é DTS |
| `AUDIO_UNKNOWN` | demote | −40 | Probe: a única opção é um codec de suporte desconhecido (Opus, Vorbis) |
| `AUDIO_ONLY_SECONDARY` | demote | −200 | Probe: a faixa principal não toca, e só sobra um comentário ou audiodescrição |
| `AUDIO_TRACK_SKIPPED` | info | 0 | A faixa que um player comum escolheria (idioma preferido ou faixa padrão) não toca ou é DTS, e o motor escolheu outra |
| `SUBTITLES_HIDDEN` | info | 0 | Há legendas bitmap (PGS, VobSub, DVB), que ficam ocultas |
| `PROBE_IGNORED` | info | 0 | Saída do probe em outra versão de formato |

`tier` é `hidden` se houver um aviso `hide`, `demoted` se houver um `demote`, e `ok` nos demais casos. `score` soma os pesos dos rótulos e dos avisos, mais `scoring.preferredLanguage` (20) quando a faixa inicial está num idioma preferido. `compare(a, b)` ordena por `tier` e depois por `score`, do maior para o menor, e devolve 0 no empate. No Chromium 53, `Array#sort` não é estável acima de 10 itens (o QuickSort do V8 5.3). Por isso, a lista deve ser ordenada com `sortStreams(items, getResult)`, que desempata pela posição original e devolve uma lista nova. Cabe à F6.2 decidir se esconde os `hidden`.

## Regras

**Vídeo e Dolby Vision (D7).** O modo DV sai de `video.dolbyVision[contêiner]` no perfil, consultando as chaves nesta ordem: `<perfil>-dual` (P7 dual-track), o nome do perfil (`8.1`), o perfil maior (`8`) e `default`.

- `dolby-vision`: DV ativo.
- `base-layer`: a C8 mostra a camada base. HDR10 ou HLG viram rótulo "nesta TV"; `none` (P5) vira `wrong-colors`, com aviso.
- MKV e WebM são sempre `base-layer`. Num contêiner desconhecido (só nome, sem extensão), vale o de `unknownContainer` (`mkv`), por ser o caso mais conservador.
- Pelo nome, sem perfil citado: em MP4, onde P5 e P8.1 são ativos, conta como DV ativo. No resto, se o nome ou a cor PQ/HLG do probe indicar a camada base, ela é usada; senão, "pode ser P5".

**Probe ambíguo: o nome só decide quando o probe não tem evidência.** No MP4, a configuração DV fica na sample entry, e o probe decide sozinho. No MKV HEVC, o probe pode deixar o DV passar: com `DV_UNKNOWN` (1º quadro não lido) ou com uma NAL malformada lida como "sem RPU" (sem aviso). Por isso, quando o probe não achou DV num MKV com HEVC (ou sem vídeo identificado), o DV citado no nome só entra na conta se o probe for **ambíguo**:

- há `DV_UNKNOWN`; ou
- a cor do vídeo é desconhecida (`hdr: null`); ou
- a cor é SDR num vídeo que não se sabe ser de 8 bits. A P5 costuma trazer VUI BT.709, e um HEVC de 8 bits não pode ser P5.

Se o probe leu o 1º quadro e a cor é PQ ou HLG, existe uma camada base HDR10/HLG de verdade, que não é P5. Nesse caso o probe vence, e o resultado é HDR10/HLG sem DV e sem rebaixamento, diga o nome o que disser.

| Probe (MKV HEVC sem DV) | Nome | Resultado |
|---|---|---|
| quadro lido, cor PQ ou HLG | qualquer (inclusive `DV P5`) | o probe vale: HDR10/HLG, sem rebaixar |
| quadro lido, SDR de 8 bits | qualquer | o probe vale: SDR, sem DV |
| ambíguo | `DV P5` | `wrong-colors`, `DV_WRONG_COLORS` (fonte: nome) |
| ambíguo | `DV HDR10`, `DV P7`, `DV P8.1` | "HDR10 nesta TV" |
| `DV_UNKNOWN` com cor PQ/HLG | `DV` | camada base HDR10/HLG: "HDR10 nesta TV" |
| `hdr: null`, ou SDR que não é de 8 bits | `DV` | `DV_WRONG_COLORS_POSSIBLE` (pode ser P5) |
| `DV_UNKNOWN` | nada sobre DV | `DV_UNVERIFIED` (info; o stream não é rebaixado) |
| DV lido (configuração ou RPU) | qualquer | o probe vale; o nome é ignorado |

**Sem probe**, um `DV P5` explícito num MKV (ou contêiner desconhecido) rebaixa com −200 (`DV_WRONG_COLORS`). Como o probe pode inocentar o stream (cor PQ lida), `needsProbe` fica `true` para qualquer DV decidido só pelo nome fora do MP4.

**Áudio (D8).** As faixas são ordenadas por estas chaves, nesta ordem:

1. Tocável: `unsupported` (TrueHD, AC-4, DTS Express, DTS-UHD, FLAC com mais de 2 canais) nunca é escolhida.
2. Faixa principal antes de comentário ou audiodescrição. Isso vem do flag do MKV (`commentary`, `visualImpaired`) ou do nome da faixa (`comment`, `comentário`, `commentaire`, `kommentar`, `audio description`), porque o MP4 não tem o flag. Um DTS principal ganha de um comentário AC-3.
3. O status do codec: `ok` antes de `unconfirmed` (DTS) antes de `unknown`.
4. O idioma: a posição em `audioLanguages`; sem correspondência, vale o idioma da faixa padrão do arquivo.
5. A preferência de codec do perfil: `eac3-atmos` (DD+ Atmos), `eac3`, `ac3`, `aac`…
6. A flag `default`, os canais e a ordem no arquivo.

O status vem antes do idioma porque D8 manda preterir o DTS até a Fase 8, mesmo no idioma preferido. Pode acontecer de a única faixa tocável ser um comentário, enquanto a principal não toca (TrueHD principal + comentário AC-3). Isso não é alternativa (linha 7 da tabela): o comentário fica como faixa inicial, mas sai o aviso `AUDIO_ONLY_SECONDARY`, que rebaixa, e o bônus de idioma não conta. Quando o probe não leu o 1º quadro (`atmos: null`), um `Atmos` no nome junto de DD+ marca como Atmos uma única faixa E-AC-3: a padrão, ou senão a primeira (`atmosSource: 'name'`). Uma dublagem raramente é Atmos.

Sem probe, o status de áudio sai dos codecs citados no nome. Como um remux costuma ter uma faixa compatível que o nome não cita, o rebaixamento do áudio é menor (`*_POSSIBLE`), e `needsProbe` fica `true`.

## Perfil (`perfil-c8.json`)

| Chave | Conteúdo |
|---|---|
| `video.codecs` | status por codec de vídeo (`av1: unsupported`) |
| `video.hdr` | o que a TV mostra para cada formato (`hdr10plus: hdr10`) |
| `video.dolbyVision` | modo DV por contêiner e perfil; `unknownContainer` |
| `audio.codecs` | `{ status, maxChannels? }` por codec |
| `audio.profiles` | status por `profile` do probe (sobrepõe o do codec: `DTS Express`, `DTS-UHD`) |
| `audio.atmosCodecs`, `audio.preference` | quais codecs entregam Atmos na C8; a ordem de preferência |
| `subtitles` | `text: ok`, `bitmap: unsupported` |
| `playback.rates` | velocidades oferecidas (`[1]`: fora de 1x a C8 fica sem áudio) |
| `labels`, `scoring`, `warnings` | textos dos rótulos, pesos e severidade/nota de cada aviso |

Na Fase 8, os ajustes entram por `mergeProfile(DEFAULT_PROFILE, ajustes)`: objetos se fundem, e valores e listas são substituídos. Exemplos:

```js
mergeProfile(DEFAULT_PROFILE, { audio: { codecs: { dts: { status: 'ok' } } } });          // DTS confirmado na TV
mergeProfile(DEFAULT_PROFILE, { warnings: { DV_WRONG_COLORS: { severity: 'hide' } } });   // ocultar P5 em MKV
```

## Testes

```bash
pnpm test                                   # inclui webos/lib/c8-rules/test/*.test.js
npx eslint webos/lib/c8-rules               # o pnpm lint só cobre src/
```

- `test/table.test.js`: um `describe` por linha da tabela "O que a C8 entrega" (Linhas 1 a 11) e por decisão (D6 a D8). Usa as fixtures reais do probe (`../header-probe/__fixtures__`) e o catálogo da F0.10 (`webos/tests/media/headers`). Onde não existe amostra real do formato puro (HDR10 e HLG sem DV, VobSub, P7 sem a FATE), usa uma saída real do probe com um campo trocado, e o nome do teste diz "derived". Os testes P7 com as fixtures FATE são pulados com aviso quando elas faltam (`webos/lib/header-probe/tools/fetch-fate-fixtures.sh` as grava).
- `test/audio.test.js`: escolha da faixa inicial (ordem de idiomas, códigos 639-1/639-2/BCP 47, comentário, FLAC multicanal).
- `test/name.test.js`: sinais do nome em formatos reais de addons e falsos positivos (`DVDRip`, "Lua de Mel", `DDP7.1`).
- `test/profile.test.js`: valores do perfil e ajustes da Fase 8 (DTS confirmado ou descartado, P5 oculto, AV1 rebaixado, DV em MKV ativo).

## Ferramenta

```bash
node webos/lib/c8-rules/tools/evaluate.mjs <url|arquivo|fixture:<id>> [--name "<nome do stream>"] [--lang por,eng] [--no-sniff] [--profile ajustes.json] [--brief]
node webos/lib/c8-rules/tools/evaluate.mjs --name "Movie.2160p.DV.P5.HEVC.DDP5.1.mkv" --brief   # só o nome
```

## Smoke no emulador

```bash
webos/tools/emu-run -- webos/lib/c8-rules/smoke/run.sh <pasta-de-saída>
```

O script monta um app com o bundle transpilado para Chrome 53 e confere a sintaxe ES2016 do bundle e dos fontes. Depois roda as regras no emulador sobre as saídas reais do probe (todas as fixtures e o catálogo) e alguns nomes de stream, e compara caso a caso com o Node. Na saída ficam `emulator.json`, `expected.json`, `compare.txt`, `syntax.txt` e as capturas.

# tracks

Faixas de áudio e legendas embutidas do Player no webOS (F5.4): de onde vem a lista dos menus, qual faixa de áudio começa tocando e como a troca é feita.

- JS puro em CommonJS, dentro do ES2016 do Chromium 53; sem dependências além das libs irmãs [`header-probe`](../header-probe/README.md) (F5.2) e [`c8-rules`](../c8-rules/README.md) (F5.3).
- Só entra no build `WEBOS=1`; o desktop não muda.

## Como entra no app

| Peça | O que faz |
|---|---|
| `webos/webpack/player.js` | Dentro do `@stremio/stremio-video`, troca o `../WebOsVideo` do `selectVideoImplementation` por `WebOsVideo.js` (abaixo) e o `../tracksData` do `WebOsVideo` por `tracksData.js`. Pedidos de outras pastas não são tocados. |
| `tracksData.js` | Substitui o `tracksData.js` do stremio-video, que pedia `http://127.0.0.1:11470/tracks/…` ao servidor de streaming (não existe, P3). Responde "sem faixas" na hora, sem rede. |
| `WebOsVideo.js` | O `WebOsVideo` do upstream decorado por `withC8Tracks`. |
| `withC8Tracks.js` | Assume as props `audioTracks`, `selectedAudioTrackId`, `subtitlesTracks` e `selectedSubtitlesTrackId` e os eventos `audioTrackLoaded` e `subtitlesTrackLoaded`; a legenda embutida escolhida vai ao `WebOsVideo` com o índice Luna (F5.5, [`subtitles`](../subtitles/README.md)); o resto vai ao `WebOsVideo` sem mudança. |
| `probe-cache.js` | Resultado do probe por URL (até 16, o mais antigo sai; falha não fica guardada) e cancelamento (`cancel(url)`). |
| `index.js` | Funções puras: montagem das listas e escolha da faixa inicial. |
| `src/routes/Player/useAudio.webos.js` | O hook `useAudio` com a escolha automática pelas regras da C8. |

## Fluxo

1. **`load`:** o `WebOsVideo` recebe o `load` primeiro (`<video src>`); só depois o decorador pede o probe do `stream.url` ao cache. O probe roda em paralelo (Range nos primeiros 256 KB; no `t2_multi.mkv`, um pedido) e **não atrasa o início da reprodução**.
2. **Lista de áudio** (`buildAudioTracks`): sai do probe e do `video.audioTracks`, na ordem do arquivo. `EMBEDDED_<n>` é sempre `audioTracks[n]` do elemento.
   - Probe e elemento com o mesmo número de faixas (ou o elemento ainda vazio): as faixas do probe, com o idioma do arquivo (o do elemento se o arquivo não tiver) e o rótulo `nome · codec canais` (`English AAC · AAC 1.0`, `DD+ Atmos 5.1`, `DTS-HD MA 7.1`); o nome é omitido do técnico quando só repete o codec (`AC3 5.1`).
   - Sem probe (falha, contêiner fora do escopo) ou com contagem diferente: as faixas do elemento, só com o idioma ISO 639-1 (`en`, `pt`).
   - Faixas que não tocam na C8 (`status: 'unsupported'` nas regras: TrueHD, DTS Express…) saem da lista enquanto houver outra que toque; se nenhuma toca, todas ficam.
   - Cada entrada leva também `index`, `probeId`, `codec`, `channels` e `status` (das regras).
3. **Faixa inicial** (`chooseAudioTrack`, chamada pelo `useAudio.webos.js`):
   - a faixa salva para o stream (`streamState.audioTrack`, escolha anterior no menu) vence, como no upstream;
   - com probe: `evaluate()` das `c8-rules` com os idiomas `[preferência de áudio do stream, idioma de áudio das configurações]` → uma faixa que toca, no primeiro idioma preferido que tiver uma, e entre elas o melhor codec (DD+ Atmos > E-AC-3 > AC-3 > AAC…; DTS só se não houver outra, D8);
   - sem probe: a primeira faixa no idioma preferido (mantém a atual se já estiver nele);
   - nenhuma: fica a escolha do pipeline.
   No `t2_multi.mkv` com o idioma `eng` (padrão do modo convidado), a escolha é `AC3 5.1` (EMBEDDED_2), e não a 1ª faixa AAC inglesa.
4. **Troca** (`setProp selectedAudioTrackId`): liga `audioTracks[n].enabled` e depois desliga as demais (nessa ordem, para nunca ficar sem faixa ativa). **Não** usa Luna `selectTrack`: no emulador, a troca pelo elemento basta (ver abaixo). O decorador publica a nova seleção e emite `audioTrackLoaded`.
5. **Nada toca no pipeline antes de o vídeo tocar:** uma troca pedida antes do 1º `playing` (a escolha automática costuma chegar antes) fica pendente e é aplicada nele; as legendas embutidas também só entram na lista nesse momento, porque escolher uma faz o `WebOsVideo` chamar o Luna (`setSubtitleEnable`, `selectTrack` de texto).
6. **Legendas embutidas** (`buildSubtitleTracks`): as de texto do probe, com idioma e codec (`SRT`, `ASS`, `· forced`), as forçadas depois das completas. As bitmap (PGS, VobSub, DVB) ficam de fora. `EMBEDDED_<n>` conta todas as legendas do arquivo (`n` é a posição no arquivo); `lunaIndex` é o índice que vai ao Luna `selectTrack` (`type: 'text'`), contando só as de texto (F5.5).
   - **Escolher uma liga a legenda no pipeline** (F5.5): o decorador manda ao `WebOsVideo` o id com o `lunaIndex`, publica a seleção e emite `subtitlesTrackLoaded`. Detalhes, estilo e a regra da escolha automática: [`../subtitles/README.md`](../subtitles/README.md).
7. **Idioma salvo** (`languageCode`): o hook salva na preferência e no estado do stream o mesmo código que o upstream (`src/common/languages.ts`: o `'2'` da entrada do `langs` que tem o código; `pt` → `por`, `bn` → `ben`, `pt-BR` → `pob`), e compara os idiomas do mesmo jeito.
8. **Probe que termina depois do `playing`** (debrid lento): a lista ganha os codecs e o hook pode trocar da faixa escolhida só pelo idioma para a das regras da C8, com o vídeo já tocando. Isso é **de propósito**: a escolha só por idioma pode ser uma faixa que não toca (TrueHD), e a troca tira o vídeo do mudo. No emulador o probe sempre terminou antes do `playing` (0,6–4,8 s); confirmar na Fase 8 com links reais.
9. **Cancelamento:** o `header-probe` não aceita sinal de cancelamento (e o Chromium 53 não tem `AbortController`). No `unload`, no `destroy` e num novo `load`, o decorador chama `probeCache.cancel(url)`: as leituras seguintes são recusadas (`ProbeError NETWORK`, `cancelled`), então só o pedido em voo (um bloco de 256 KB) termina, e o resultado não fica no cache.
10. **Troca pendente:** se a troca continuar pendente depois do `playing` (o elemento não lista a faixa; uma TV sem `video.audioTracks`), sai um aviso no console, uma vez por carga: `[webos] tracks: audio EMBEDDED_n still pending after playing: …`.

## Medido no emulador (`webos/tests/player/tracks.sh`)

- **A troca pelo elemento funciona:** depois de escolher "Português" no menu, só `audioTracks[1].enabled` fica `true`, o vídeo segue andando e o menu marca a faixa. Nenhuma chamada Luna `selectTrack` de áudio.
- **Escolha inicial:** com o idioma `eng` (configuração do modo convidado), o probe termina em ~0,6 s, antes de o vídeo tocar; a troca para `AC3 5.1` fica pendente e é aplicada no 1º `playing` (`audioTracks` = `[false, false, true]` já na 1ª amostra).
- **Estabilidade:** a 1ª mídia após o boot às vezes trava em `readyState 0` com o host carregado (vários emuladores do pool ao mesmo tempo). Nos A/B rodados ao mesmo tempo, a base sem nada desta lib também travou (2 de 4 boots), e uma variante com o probe adiado para depois do `playing` travou uma vez sem ter feito probe: o probe não é a causa. Com a lib, o vídeo tocou em 8 de 16 boots (e as checagens de faixas passaram em todos esses); com amostras desse tamanho não dá para dizer se a taxa muda.
- **Log do pipeline:** não dá para ler no emulador com o usuário `developer` (`/var/log` aponta para `/tmp/var/log`, que só tem `bootd.log` e `configd.log`; `crashd` sem permissão). A evidência da troca é o `audioTracks[i].enabled` (o emulador também não tem placa de som).

## Testes

- `pnpm exec jest webos/lib/tracks`:
  - `test/tracks.test.js`: listas e escolha inicial sobre cabeçalhos reais (o `t2_multi.mkv` do kit e um MKV com AC-3, DD+ Atmos, DTS-HD MA, TrueHD Atmos e PGS);
  - `test/withC8Tracks.test.js`: o decorador contra dublês do `WebOsVideo` e do `<video>` (troca, pendência até o `playing` e o aviso, probe atrasado, com falha ou cancelado, legenda embutida pelo Luna com o índice certo e publicada, cores, eventos repassados, `destroy`);
  - `test/probe-cache.test.js` (inclui o cancelamento), `test/useAudio.test.js` (o hook com efeitos, em jsdom; códigos de idioma do upstream);
  - `test/upstream.test.js`: guarda de deriva (o que o override e o decorador esperam do `useAudio.ts`, do `Player.js` e do stremio-video) e o passo do webpack.
- Emulador: `webos/tools/emu-run --timeout 15 -- webos/tests/player/tracks.sh <saída> [arquivo] [faixa]` (depois de `pnpm webos:package`); o resultado sai em `<saída>/resultado.json` (`tracks-evaluate.mjs`).

## Limites conhecidos

- A correspondência probe ↔ `video.audioTracks` é pela posição. Se o pipeline da TV esconder uma faixa (ex.: TrueHD), a contagem diverge e a lista cai para a do elemento (só idioma). Confirmar na Fase 8.
- O `tracksData.js` original continua no bundle pelo `TizenVideo` (código morto no webOS: o `WebOsVideo` usa o substituto).

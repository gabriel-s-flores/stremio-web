# subtitles

Legendas do Player no webOS (F5.5): embutidas pelo pipeline da TV (Luna), de addon no overlay HTML do `stremio-video`.

- JS puro em CommonJS, dentro do ES2016 do Chromium 53, sem dependências.
- Só entra no build `WEBOS=1`; o desktop não muda.

## Como entra no app

| Peça | O que faz |
|---|---|
| `webos/lib/tracks/withC8Tracks.js` (F5.4) | Assume também `selectedSubtitlesTrackId`. A escolha de uma embutida vai ao `WebOsVideo` com o **índice Luna** da faixa; o decorador publica a seleção e emite `subtitlesTrackLoaded`. As cores das configurações passam por `toWebOsTextColor`/`toWebOsBackgroundColor`. |
| `webos/lib/tracks/index.js` | `buildSubtitleTracks`: só as legendas de texto, com `lunaIndex`; as forçadas depois das completas; `mode: 'showing'` na escolhida. |
| `webos/lib/player` (`WEBOS_LOAD_ARGS`) | `assSubtitlesStyling: false` em todo `load`. |
| `src/routes/Player/useVideo.webos.js` | `addExtraSubtitlesTracks` e as `stream.subtitles` do `load` passam por `proxifySubtitlesTracks` (tlsproxy da F3.7). |
| `src/routes/Settings/Player/Player.webos.tsx` | As configurações do Player sem a opção "Estilizar legendas ASS" (render do upstream sem o `Option` com esse rótulo). |
| `index.js` (esta pasta) | Funções puras: cores e proxy das URLs. |

## Legendas embutidas (Luna)

1. A lista sai do probe (F5.4) e só aparece quando o vídeo começa a tocar. As bitmap (PGS, VobSub, DVB) ficam ocultas.
2. **Id e índice:** `EMBEDDED_<n>` é a posição da legenda no arquivo (o id da F5.4, estável). O Luna recebe `lunaIndex`, a posição **entre as legendas de texto** (`LUNA_TEXT_INDEX_COUNTS_BITMAP = false` em `webos/lib/tracks/index.js`). Num MKV com `PGS, SRT eng, SRT por`, o inglês é `EMBEDDED_1` e vai ao Luna como índice 0.
   - **Por que essa convenção:** o emulador não desenha legenda do pipeline (abaixo), então a contagem não pôde ser medida. Segui o `WebOsVideo` do upstream, que numera só as legendas que não esconde (PGS, VobSub) e manda esse número ao Luna. Se a TV contar as bitmap, basta trocar a constante (Fase 8, checklist item 10: o arquivo com 5 legendas).
3. **Ligar:** o decorador manda `setProp selectedSubtitlesTrackId = EMBEDDED_<lunaIndex>` ao `WebOsVideo`, que chama `setSubtitleEnable(true)`, os `setSubtitle*` de estilo e, 500 ms depois, `selectTrack { type: 'text', index }`. O `WebOsVideo` não publicaria a seleção (só faz isso para as faixas da lista dele, vazia sem o servidor), então o decorador publica `EMBEDDED_<n>` e marca a faixa como `showing`. O menu e o pipeline ficam coerentes.
4. **Desligar:** `null` ou uma legenda de addon vão direto ao `WebOsVideo` (`setSubtitleEnable(false)`) e a seleção vira `null`. O `withHTMLSubtitles` já tira a de addon quando uma embutida é publicada.
5. **Estilo** (pelo `WebOsVideo`, enviado de novo a cada escolha):
   - tamanho → `setSubtitleFontSize` 0–4 (100 % → 1, a escala do upstream);
   - posição → `setSubtitlePosition`;
   - cor do texto → a **mais próxima** entre branco, amarelo, vermelho, verde, azul e preto (o `WebOsVideo` sozinho só aceita essas cores exatas e cai no branco);
   - fundo → transparente fica sem fundo; qualquer outro alfa vira a cor mais próxima, **opaca** (o `WebOsVideo` manda opacidade 0 ou 255);
   - contorno e fonte: o Luna não tem.

## Legendas de addon (overlay HTML)

- O `withHTMLSubtitles` do upstream baixa o arquivo (`fetch`), converte e desenha no `div` sobre o `<video>`. Tamanho, cores, contorno e atraso das configurações valem como no desktop.
- **Sem estilo ASS:** o libass é stub (F1.5). Com a opção ligada, pelo código do `withHTMLSubtitles`, cada legenda ASS de addon passaria pelo renderizador ASS, que falha no stub (`reportSubtitleError`, erro `LOAD_FAILED` não crítico) antes de cair no texto simples. No webOS o `load` vai sempre com `assSubtitlesStyling: false`: a ASS vira texto simples direto, e a opção some das configurações.
- **Let's Encrypt (F3.7):** a página não confia na ISRG, então o `fetch` de uma legenda num host Let's Encrypt falharia. As URLs (`url`, `fallbackUrl`) de hosts Let's Encrypt **conhecidos ou aprendidos** passam pelo `proxify` do tlsproxy. Um addon de legendas com certificado Let's Encrypt é aprendido quando o worker do core o consulta pelo proxy, então os arquivos no mesmo host já saem pelo proxy. Arquivo num host LE nunca visto pelo worker: falha como no upstream (pendência). A URL do proxy mantém a extensão no fim (`.ass`), e o tipo também é detectado pelo conteúdo.
- O probe de cabeçalho **não** pode passar pelo proxy: o serviço recusa `Range` e conteúdo de mídia de propósito (P3). Num link de debrid Let's Encrypt, sem probe não há lista de embutidas (F5.4); o vídeo toca pelo pipeline.

## Escolha automática (B5 da F5.4)

A regra é a do `useSubtitles.ts` do upstream, agora que a embutida liga:

1. Idiomas, em ordem: o da escolha anterior (do stream ou da sessão), o idioma de legendas das configurações.
2. Em cada idioma, a **origem da última escolha** vem primeiro (sessão ou estado salvo do stream); sem escolha anterior, **embutida antes de addon**.
3. No webOS, as embutidas **forçadas** ficam depois das completas do mesmo idioma, para a escolha automática não cair numa legenda que só traduz trechos.

Então a legenda de addon liga sozinha quando o arquivo não tem embutida no idioma, ou quando a última escolha do usuário (no stream ou na sessão) foi uma de addon. Com embutida no mesmo idioma e sem escolha anterior, liga a embutida.

Efeito da lista só no `playing`: com legenda de addon no idioma, ela aparece primeiro (o vídeo ainda abrindo) e o Player troca para a embutida assim que ela é listada (~2 s no emulador).

## Medido no emulador

- **O emulador não desenha legendas do pipeline.** Com o app-sonda, `setSubtitleEnable`, `selectTrack` (índices 0 a 3, nas duas ordens, com seek e pausa) e os `setSubtitle*` respondem `returnValue: true`, e nada aparece na tela da VM. As bibliotecas `libstarfish-subtitle*` existem na imagem. Roteiros: `webos/tests/subtitles/luna-probe.sh` e `luna-variants.sh`.
- No app (`webos/tests/subtitles/subtitles.sh`), a evidência das embutidas são as chamadas Luna (parâmetros e índice), o menu e o console.

## Testes

- `pnpm exec jest webos/lib/subtitles webos/lib/tracks webos/lib/player`: cores, proxy, lista com `lunaIndex`, decorador (Luna, publicação, desligar, cores) e guardas de deriva do upstream (`test/upstream.test.js`).
- Emulador, um cenário por boot (depois de `pnpm webos:package` e de `webos/tests/subtitles/make-media.sh`):
  `webos/tools/emu-run --timeout 15 -- webos/tests/subtitles/subtitles.sh <saída> embedded|addon|mixed`.

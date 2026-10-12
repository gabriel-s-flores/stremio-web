# final-url

O link final de um stream de debrid (F8.1, [plano](../../docs/PLANO-PORT-WEBOS4.md), Fase 8): o endereço para onde o resolvedor do addon redireciona. O Player entrega esse link ao `WebOsVideo` (`webos/lib/player/withFinalUrl.js`), e não o do resolvedor.

- JS puro em CommonJS, sem dependências, dentro do ES2016 do Chromium 53 (sem `AbortController`).
- Só entra no build `WEBOS=1`; o desktop não muda.
- **As duas URLs são sensíveis:** a do resolvedor leva a chave do debrid (o Torrentio a põe no caminho) e a final leva um token. Nenhuma vai para o log: só o host.

## Por quê

Na C8 (firmware 05.50.70), com o mesmo arquivo (MP4 de 27,7 GB, DV P8.1, Atmos) e Wi-Fi (notas da Fase 8 do orquestrador, `~/webos-tv-sdk/orquestrador/tarefas/F8/notas.md`, "Diagnóstico 1"):

| `<video src>` | 1ª imagem (`playing`) |
|---|---|
| link **final** do Real-Debrid | ~6,0 s |
| link do **Torrentio** (`/resolve/realdebrid/…` → 302 para o RD) | não tocou em 150 s (`loadstart` + `stalled`, nenhum `progress`) |
| `fetch(torrentio, Range: bytes=0-0)` → `response.url` → `<video src>` | ~6,2 s |
| idem, com seek para 2:04:29 (retomada) | ~5,8 s |

O resolvedor responde em ~0,3 s. O pipeline de mídia da TV lida muito mal com o 302; no app, o início levava 1,5–3 min.

## API

```js
const { getFinalUrls, createFinalUrls } = require('webos/lib/final-url');
const urls = getFinalUrls();          // a instância do app
urls.resolve(url)  // -> Promise<{ url, source, ms, host }>, nunca rejeita
urls.peek(url)     // -> link final já conhecido, ou null (síncrono)
urls.note(url, finalUrl)  // um probe seguiu o redirect: guarda
urls.forget(url)   // o link falhou no Player: a próxima carga pergunta de novo
```

`resolve` faz **um** `fetch` com `Range: bytes=0-0` e `credentials: 'omit'`, segue o redirect como o `<video>` faria e lê `response.url`. O corpo é descartado assim que os cabeçalhos chegam (1 byte; um servidor que ignore o `Range` não manda o vídeo). `source`:

| `source` | `url` | Quando |
|---|---|---|
| `known` | final | já resolvido (até `REUSE_MS`, 10 min), ou anotado por um probe |
| `redirect` | final | o pedido seguiu um redirect |
| `direct` | original | sem redirect (o link já é o final); guardado também, para a próxima carga não esperar |
| `failed` | original | status HTTP ≥ 400 ou erro de rede: o pipeline recebe o link original e a tela de erro da F6.3 explica |
| `timeout` | original | o resolvedor passou de `RESOLVE_TIMEOUT_MS` (5 s): a carga segue com o link original; o pedido continua e a resposta tardia fica guardada |
| `skipped` | original | não é HTTP(S), ou não há `fetch` |

Um pedido por link em voo: quem pede junto (a carga e o probe do Player) recebe a mesma resposta.

**O que não é guardado (revisão c1):** um redirect que termina na **mesma origem do resolvedor** (`isKeepable`). É o vídeo-aviso do próprio addon: o Torrentio responde o `/resolve/…` com `/videos/downloading_v2.mp4` enquanto o Real-Debrid baixa um torrent que não estava em cache (e `failed_access_v3.mp4`, `limits_exceeded…` etc.), no host dele; o link de debrid fica em outro host. A carga atual recebe o aviso (é o que o resolvedor mandou tocar; se o nome for o de um aviso conhecido do Torrentio, veja abaixo), mas a próxima abertura do stream pergunta ao resolvedor de novo e pega o arquivo quando ele fica pronto. Guardar o aviso por 10 min mostraria "baixando" mesmo com o arquivo pronto (antes da F8.1, toda abertura perguntava). Vale também para o `note` dos probes. O link sem redirect (`direct`) e o redirect para outra origem são guardados.

**Aviso conhecido (F8.5).** Se o link final é um aviso que `debridLink.noticeOf` reconhece (`…/videos/<nome>_vN.mp4` do Torrentio), de **qualquer** host: `isKeepable` o recusa (B1 da revisão c2 da F8.1) e `resolve` devolve `source: 'notice'`. O `withFinalUrl` não passa a carga adiante: o Player recebe na hora um erro crítico `STREAM_FAILED_TO_LOAD` para o stream original, e a tela de erro (F6.3/F8.4) explica o aviso ("ainda baixando", "acesso negado"…) sem baixar o MP4 do aviso. O diagnóstico não muda. Um aviso com outro nome (`notice.mkv` do `media-server`) segue a regra da mesma origem. Se o resolvedor passar do tempo (`timeout`), a resposta tardia que for um aviso também não é guardada.

**Desligar:** `webos.player.finalUrl = off` (localStorage, lido ao abrir o app; `FINAL_URL_KEY`, `readFinalUrlSetting`) faz a carga e o probe do Player usarem o link do resolvedor, como antes da F8.1.

## Quem usa

| Arquivo | Papel |
|---|---|
| `webos/lib/player/withFinalUrl.js` | A carga do Player espera o link final (ou o conhecido, na hora) e o passa ao `WebOsVideo` |
| `webos/lib/tracks/probe-cache.js` | O probe do Player (F5.4) resolve primeiro e lê o link final: o resolvedor recebe **um** pedido por stream (o mesmo da carga), e as leituras do probe pulam o redirect |
| `webos/lib/stream-ranking/index.js` | O probe da lista (F6.2) anota o redirect que seguiu (`onFinalUrl` do `fetch-reader`): um stream sondado na lista abre sem esperar o resolvedor |
| `webos/lib/header-probe/fetch-reader.js` | Opção `onFinalUrl(url)`: avisa uma vez a URL da 1ª resposta |

## Testes

- `test/final-url.test.js` (`pnpm test`): redirect, pedido único em voo, sem redirect, o vídeo-aviso na mesma origem (não guardado, nem pelo `note`), o aviso conhecido de outro host (`notice`, não guardado), erro HTTP e de rede, timeout com a resposta tardia guardada, validade e `forget`, os probes que anotam o redirect e a chave `off` (o probe do Player volta ao link do resolvedor).
- Emulador: `webos/tests/final-url/emulator.sh` (ver `webos/lib/player/README.md`, "Link final").

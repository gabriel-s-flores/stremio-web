# debrid-link

Links de debrid que não tocam (F6.3, [plano](../../docs/PLANO-PORT-WEBOS4.md), Fase 6 item 3): o que a tela de erro do Player diz quando o link por trás do stream foi redirecionado, expirou, sumiu, está limitado ou não responde.

- JS puro em CommonJS, sem dependências, dentro do ES2016 do Chromium 53. Nada roda no boot: o módulo só é usado quando o Player falha, e as libs irmãs (`stream-ranking`, `tracks`) são carregadas nessa hora.
- Só entra no build `WEBOS=1`; o desktop não muda.
- **A URL do stream carrega a chave do debrid** (o Torrentio a põe no caminho). Ela nunca vai para o log nem para o resultado do diagnóstico: só o host.

## Por quê

O `<video>` da TV não mostra o status HTTP: um 403, um 404 e um 410 chegam todos como `MEDIA_ERR_SRC_NOT_SUPPORTED` (código 83, "Video is not supported"), e uma falha de rede pode vir como 81 ou 83. Para o usuário, "vídeo não suportado" num link que expirou manda procurar o problema no lugar errado. Depois de um erro crítico do Player, o link é verificado uma vez e a tela diz o que houve e o que fazer.

## Onde entra no app

| Arquivo | Papel |
|---|---|
| `src/routes/Player/Error/Error.webos.js` | Roda o `Error` do upstream (`UpstreamError.render`) e, se o link é o problema, troca a mensagem e acrescenta uma linha de dica (classe `error-sub` do upstream). Sem problema no link (ele responde, ou não deu para saber), a mensagem do upstream fica |
| `src/routes/Player/useVideo.webos.js` | Uma linha no `load`: `rememberStream(args.stream)`. A tela de erro aparece depois do `unload`, quando o estado do Player já não tem o stream |
| `webos/lib/header-probe/fetch-reader.js` | O `ProbeError` HTTP ganhou `httpStatus` |
| `webos/lib/stream-ranking/queue.js` | A fila da lista guarda o `httpStatus` da falha (`entry.httpStatus`) |
| `webos/lib/tracks/probe-cache.js` | O cache do probe do Player guarda o `httpStatus` da última falha HTTP (`failureOf(url)`) |

## O diagnóstico

`diagnose(stream, playerCode)` resolve `{ kind, status, source, redirected, host }`. Em ordem:

1. **Erro de decodificação (82):** o arquivo chegou e a TV não o decodificou. Não é problema de link, `kind: 'ok'`, sem pedido.
2. **Falha HTTP anterior, de até 10 min:** a do probe da lista (F6.2, `source: 'list-probe'`) ou a do probe do próprio Player (F5.4, `'player-probe'`; no mesmo segundo do erro, é o caso comum). O mais recente vale. **Sem pedido novo.**
3. **Resultado do último diagnóstico** do mesmo link (até 16, 10 min).
4. **Um pedido de 1 byte** (`Range: bytes=0-0`, com os `proxyHeaders.request` do addon, `credentials: omit`), `source: 'request'`. O `fetch` segue o redirect do debrid (302 → host do arquivo) como o `<video>`, então o status é o do **destino**. O corpo é descartado assim que os cabeçalhos chegam: um servidor que ignore o `Range` não manda o vídeo inteiro. Limite de 10 s. O vídeo **não** passa pelo proxy da F3.7 (P3).

## Mensagens

Textos em inglês: o pacote `stremio-translations` não tem chave para eles. Cada um tem uma chave i18n (`defaultValue` em inglês, que vale em qualquer idioma até alguém traduzir). Estão em `PROBLEMS` (`index.js`):

| Resposta | `kind` | Chave | Mensagem |
|---|---|---|---|
| 403, 410 | `expired` | `WEBOS_LINK_EXPIRED` | This link has expired or was refused (HTTP 403). |
| 401 | `unauthorized` | `WEBOS_LINK_UNAUTHORIZED` | The debrid service did not accept the access key of this link (HTTP 401). |
| 404 | `not-found` | `WEBOS_LINK_NOT_FOUND` | The file is no longer available at this link (HTTP 404). |
| 429 | `rate-limited` | `WEBOS_LINK_RATE_LIMITED` | The debrid service is limiting requests right now (HTTP 429). |
| 5xx | `server-error` | `WEBOS_LINK_SERVER_ERROR` | The server of this link is having problems (HTTP 503). |
| outro 4xx | `refused` | `WEBOS_LINK_REFUSED` | The server of this link refused the request (HTTP 4xx). |
| `fetch` falhou | `network` | `WEBOS_LINK_NETWORK` | Could not reach the server of this link. |
| 10 s sem resposta | `timeout` | `WEBOS_LINK_TIMEOUT` | The server of this link took too long to answer. |

Cada uma tem uma dica (`…_HINT`): link expirado → voltar e abrir a lista de streams de novo para um link novo ou escolher outro; não encontrado → escolher outro; rede → conferir a internet da TV.

O `fetch` falha do mesmo jeito para a rede fora do ar e para um host sem cabeçalhos CORS. Por isso `network` só é dito quando a TV está offline (`navigator.onLine === false`), quando o próprio `<video>` viu um erro de rede (81) ou quando o pedido estourou o tempo. Num erro 83 em que só o `fetch` falhou, o diagnóstico é `unknown` e a mensagem do upstream fica.

## Redirect

O link do resolvedor (Torrentio, etc.) responde 302 para o host do arquivo. O `<video>` e o `fetch` seguem o redirect. O diagnóstico olha o destino: um redirect para um host que devolve 403 aparece como "expirou (HTTP 403)", e para um host que não atende, como rede. Um redirect que funciona não passa pelo diagnóstico (o Player não falhou).

## Testes

```bash
pnpm test     # webos/lib/debrid-link/test
webos/tools/emu-run --timeout 15 -- webos/tests/debrid/emulator.sh <pasta> <cenário>
```

O cenário do emulador (`webos/tests/debrid`) usa o `media-server.mjs`: `/redirect/<caminho>` (302), `/status/<código>/<arquivo>` (responde esse HTTP) e `/drop/<arquivo>` (derruba a conexão). Um cenário de mídia por `emu-run`.

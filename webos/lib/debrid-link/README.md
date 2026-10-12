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

0. **Aviso do Torrentio na própria URL** (o stream, ou o link que o Player carregou depois de resolver o redirect): `kind: 'notice-…'`, `source: 'url'`, sem pedido. Ver [Avisos do Torrentio](#avisos-do-torrentio-f84).
1. **Erro de decodificação (82):** o arquivo chegou e a TV não o decodificou. Não é problema de link, `kind: 'ok'`, sem pedido.
2. **Falha HTTP anterior, de até 10 min:** a do probe da lista (F6.2, `source: 'list-probe'`) ou a do probe do próprio Player (F5.4, `'player-probe'`; no mesmo segundo do erro, é o caso comum). O mais recente vale. **Sem pedido novo.**
3. **Resultado do último pedido** do mesmo link (até 16, 10 min). O resultado vindo de um probe **não** é guardado (um novo probe pode passar), e o `load` do mesmo link (`rememberStream`) esquece o que estava guardado dele.
4. **Um pedido de 1 byte** (`Range: bytes=0-0`, com os `proxyHeaders.request` do addon, `credentials: omit`), `source: 'request'`. O `fetch` segue o redirect do debrid (302 → host do arquivo) como o `<video>`, então o status é o do **destino**. O corpo é descartado assim que os cabeçalhos chegam: um servidor que ignore o `Range` não manda o vídeo inteiro. Limite de 10 s. O vídeo **não** passa pelo proxy da F3.7 (P3). Se a URL final (`response.url`) for um aviso do Torrentio e o status não for de falha, vale o `kind` do aviso; a URL final não é guardada.

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
| `fetch` falhou, a TV tem internet | `host` | `WEBOS_LINK_HOST` | The TV could not connect to the server of this link. |
| `fetch` falhou, a TV não tem internet | `network` | `WEBOS_LINK_NETWORK` | Could not reach the server of this link. |
| 10 s sem resposta | `timeout` | `WEBOS_LINK_TIMEOUT` | The server of this link took too long to answer. |

Cada uma tem uma dica (`…_HINT`): link expirado → voltar e abrir a lista de streams de novo para um link novo ou escolher outro; não encontrado → escolher outro; 429/5xx/tempo → voltar e abrir o stream de novo (a tela de erro não tem botão de tentar de novo); `host` → "Its certificate may not be accepted by this TV, or the server is down. Pick another stream."; `network` → conferir a internet da TV e abrir o stream de novo.

### Avisos do Torrentio (F8.4)

Quando o serviço de debrid recusa a conta ou ainda está baixando o arquivo, o Torrentio não responde com erro HTTP: o `/resolve/…` redireciona para um vídeo de aviso dele mesmo (`torrentio.strem.fun/videos/failed_access_v3.mp4`…), um MP4 válido que responde 206. Na TV esse MP4 também não tocou, e a tela dizia só "Stream failed to load". O diagnóstico reconhece os avisos pelo caminho `/videos/<nome>_v<n>.mp4` (os nomes de `addon/moch/static.js` do torrentio-scraper; o sufixo de versão muda com o tempo, e o host pode ser outro numa instância própria) e mostra o que o vídeo diria:

| Vídeo | `kind` | Mensagem (dica) |
|---|---|---|
| `downloading` | `notice-downloading` | The debrid service is still downloading this file: it was not in its cache. (esperar alguns minutos, ou escolher um stream já em cache) |
| `failed_access` | `notice-access-denied` | The debrid service denied access to the account set in the addon. (conferir a chave da API e a assinatura, configurar o addon de novo) |
| `blocked_access` | `notice-access-blocked` | The debrid service blocked the access of the addon to the account. |
| `limits_exceeded` | `notice-limits` | The debrid account reached one of its limits (active downloads or traffic). |
| `failed_unavailable` | `notice-unavailable` | The debrid service is unavailable right now. |
| `download_failed`, `failed_opening`, `failed_rar`, `failed_too_big`, `failed_infringement` | `notice-download-failed`, `-opening-failed`, `-archive`, `-too-big`, `-removed` | não deu para baixar, abrir o torrent, só há um RAR, grande demais, removido por direitos autorais (escolher outro stream) |
| `failed_unexpected` e qualquer outro `failed_*` | `notice-addon-error` | The addon could not get this stream from the debrid service. |

As chaves são `WEBOS_LINK_NOTICE_*` (e `…_HINT`), com o texto em inglês como `defaultValue`, como as demais. Se o aviso tocar (no desktop, ou se o pipeline da TV o aceitar), não há erro e o próprio vídeo do Torrentio dá o recado.

### Rede, host e certificado

O `fetch` falha do mesmo jeito para a rede fora do ar, para um host sem CORS e para um certificado que o Chromium 53 recusa (Let's Encrypt, `ERR_INSECURE_RESPONSE`), que o pipeline de mídia toca mesmo assim. Quando o pedido de 1 byte falha:

1. `navigator.onLine === false` ou 10 s sem resposta → `network` / `timeout`.
2. `HEAD` em `no-cors` (sem preflight, sem corpo) no link: responde → o host existe e só não deixa ler → `unknown` (fica a mensagem do upstream).
3. Não responde: `HEAD` `no-cors` num **host de controle** que o app já usa e cujo certificado o Chromium 53 aceita (`CONTROL_URL`, o Cinemeta). Responde → a TV tem internet e o problema é o host do link (`host`: certificado recusado ou servidor fora do ar). Não responde → `network` ("sem internet").

"Check the internet connection" só aparece quando a TV não alcança nem o host de controle.

## Redirect

O link do resolvedor (Torrentio, etc.) responde 302 para o host do arquivo. O `<video>` e o `fetch` seguem o redirect. O diagnóstico olha o destino: um redirect para um host que devolve 403 aparece como "expirou (HTTP 403)", e para um host que não atende, como `host` (ou `network`, sem internet). Um redirect que funciona não passa pelo diagnóstico (o Player não falhou).

## Testes

```bash
pnpm test     # webos/lib/debrid-link/test
webos/tools/emu-run --timeout 15 -- webos/tests/debrid/emulator.sh <pasta> <cenário>
```

Cenários do emulador (`webos/tests/debrid`): `redirect-ok`, `redirect-403`, `expired-410`, `not-found-404`, `rate-limited-429`, `server-error-503`, `network-drop` e `network-refused` (a TV tem internet, o host do link não responde: `host`), `le-host` (https://letsencrypt.org/robots.txt: `host`) e `offline-drop` (`navigator.onLine` falso: `network`). Eles usam o `media-server.mjs`: `/redirect/<caminho>` (302), `/status/<código>/<arquivo>` (responde esse HTTP) e `/drop/<arquivo>` (derruba a conexão). Um cenário de mídia por `emu-run`.

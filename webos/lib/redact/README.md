# redact

O token do proxy de certificados (F3.7) fora dos logs, da tela e do relatório de diagnóstico (F3.7b).

O proxy fala em `http://127.0.0.1:<porta>/proxy?t=<token>&url=…` (e `/status?t=<token>`). O token só dá
a um processo da própria TV o uso do proxy, mas não deve aparecer em log nem em tela. O vazamento que
motivou a tarefa (achado da revisão da F3.4): uma legenda de addon de um host Let's Encrypt passa pelo
proxy (F5.5); se o arquivo falha (404, host fora do ar), o `stremio-video` emite `LOAD_FAILED` com a
`track`, cuja `url` é a do proxy, e o `Player.js` do upstream faz `console.error('Player', error)`.

- JS puro em CommonJS, dentro do ES2016 do Chromium 53, sem dependências. Só entra no build `WEBOS=1`.
- Nada roda no boot além de trocar as funções de `console` (`install.js`) e registrar o token quando o
  serviço responde. Um erro típico de legenda leva ~10 µs para ser examinado (Node 22); limites de
  profundidade (5) e de valores (1000) por argumento.

## Como o token é encontrado

| Como | O que pega |
|---|---|
| Formato da URL do proxy | `/proxy?t=<token>` e `/status?t=<token>`, também com a URL inteira codificada (`%2Fproxy%3Ft%3D…`), de **qualquer** token (inclusive o de um serviço que já morreu) |
| `t=<32 hex>` | O parâmetro `t` de 32 hex em qualquer ordem dos parâmetros |
| Tokens registrados (`addSecret`) | O token exato, onde quer que apareça, mesmo sem a URL em volta. A página (`page.js`, `onToken` do cliente) e o worker (`worker.js`, ao receber a configuração) registram o de cada subida do serviço; ficam os 8 últimos |

O texto fica como estava, com `t=***` no lugar do token: o log continua dizendo qual legenda falhou.

## Onde é aplicado

| Onde | Como |
|---|---|
| `console.*` da página e do worker | `install.js` é o primeiro import de `webos/tlsproxy/page.js` e de `worker-entry.js` (prefixados às entradas `main` e `worker` por `webos/webpack/tlsproxy.js`). `installConsoleFilter` troca `log`, `info`, `warn`, `error`, `debug`, `trace`, `assert`, `dir`, `table`, `group*`; os argumentos passam por `redactValue`, e o que não tem token chega **igual** (mesma referência: o DevTools continua inspecionando o objeto vivo) |
| Erros que o Player recebe | `useVideo.webos.js` devolve `events` com `withRedactedErrors`: os ouvintes de `error` (o log do Player, o toast, a camada de erro) recebem o payload já mascarado |
| Camada de erro (F6.3) | `Error.webos.js` passa a `message` por `redactString` |
| Relatório da tela de diagnóstico (F3.6) | `collectDiagnostics` mascara o relatório inteiro (qualquer seção, inclusive as registradas por outros módulos) e `formatReport` o texto final; o que a tela mostra, o que o botão Copiar seleciona, o que o Salvar grava no `localStorage` e o `console.info` do Salvar já saem mascarados |

`redactValue` olha strings, `Error` (mensagem, pilha e propriedades próprias), arrays e objetos; copia só o
ramo que tinha o token. Nós do DOM, eventos, `Map`, buffers e funções ficam como estão.

## Limitação conhecida (aceita)

- **As mensagens de rede do próprio navegador não passam por `console.*`, e nenhum script da página as filtra.**
  Toda resposta `4xx/5xx` (e erro de conexão) de uma requisição tem uma linha `Failed to load resource: the server
  responded with a status of 404 (Not Found)` no console do inspetor, com a **URL da requisição** num campo à
  parte, e a do proxy leva o token. Medido no emulador (Chromium 53, `Console.messageAdded` com `source: network`):
  a legenda de addon que falha (404 pelo proxy) gera uma dessas linhas, e cada imagem que o proxy não acha
  (por exemplo `yt3.ggpht.com` no Board) gera outra. Elas só aparecem para quem anexa o inspetor (`ares-inspect` ou o
  CDP, que exigem o modo desenvolvedor da TV); nenhuma tela do app nem log do app as mostra, e o token só vale enquanto
  aquele processo do serviço vive. Tirar o token da URL mudaria o protocolo do proxy (F3.7), o que a F3.7b não faz:
  o risco residual está **aceito e registrado**; nenhuma tarefa de protocolo foi aberta.
- O filtro é um quadro a mais entre quem loga e o navegador: o DevTools passa a mostrar `redact/index.js` como
  origem de cada linha do `console`.
- Argumentos além de 5 níveis de profundidade ou 1000 valores num único argumento de `console` não são examinados.

## "Copy subtitle URL" e "Download subtitles"

O estado do vídeo guarda as legendas de addon com a URL do proxy (é o que o pipeline recebeu). O menu de legendas do
upstream usa essa URL no `href` de "Download subtitles" e em "Copy subtitle URL". `useVideo.webos.js` entrega ao Player
o `state` com `extraSubtitlesTracks` de volta com a URL **que o addon deu** (`restoreSubtitlesTracksUrls`, em
`webos/lib/subtitles`: desfaz `proxyUrlFor` em `url` e `fallbackUrl`; sem nada a trocar, o mesmo array). O pipeline
continua recebendo a URL do proxy (`proxifySubtitlesTracks`, na entrada de `load` e `addExtraSubtitlesTracks`), então a
reprodução pelo proxy da F5.5 não muda. Efeito: "Copy subtitle URL" copia a URL real e "Download subtitles" abre o diálogo
com QR da F3.4 com ela, sem token.

## Testes

- `pnpm exec jest webos/lib/redact webos/tests/tlsproxy/token-leak`: a máscara (cru, codificado, vários, token
  registrado, texto comum intacto), `redactValue` (mesma referência sem token, ramo copiado, erros, ciclos, getter que
  lança, custo limitado), o filtro de console, `withRedactedErrors`, e o cenário inteiro: o cliente real do tlsproxy
  recebe `{port, token}`, a legenda é proxificada, o erro `LOAD_FAILED` do `stremio-video` passa pelo Player (log e
  toast), pelo console e pelo relatório de diagnóstico, e **falha se o token aparecer**. Guardas de que a instalação
  continua no lugar e de que o upstream ainda vaza o que isto mascara.
- Emulador: `webos/tools/emu-run --timeout 15 -- webos/tests/redact/token-log.sh <pasta>` (depois de
  `pnpm webos:package` e de `webos/tests/subtitles/make-media.sh`). Uma legenda de addon em `debrid-link.com` que dá
  404 pelo proxy; um gravador de DevTools (`cdp-log.mjs`: cada chamada de console com os argumentos, as mensagens do navegador,
  as exceções) fica ligado durante o cenário, que também abre o menu de contexto da legenda
  ("Download subtitles"), a tela de diagnóstico e o "Save report". `token-check.mjs` procura o token em tudo o que o
  cenário escreveu, e exige que o controle (o console de um iframe, que não tem filtro) mostre o token no
  gravador: sem isso, o silêncio não provaria nada. Numa execução que passa, o token nunca é escrito na pasta (nas mensagens de rede e no controle, que o têm, o gravador o troca por `<TOKEN>`).

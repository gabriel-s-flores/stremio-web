# tlsproxy: certificados Let's Encrypt no webOS TV 4.x

O Chromium 53 do webOS TV 4.0 não tem as raízes da ISRG. Hosts com certificado Let's Encrypt
(`images.metahub.space`, `debrid-link.com`, addons em GitHub Pages…) falham com
`net::ERR_INSECURE_RESPONSE`, em `<img>` e em `fetch`. A solução vem da F0.7
([`webos/spikes/tls/DECISAO.md`](../spikes/tls/DECISAO.md)) e foi integrada na F3.7: um serviço JS
do próprio app (Node v0.12.2) que faz proxy HTTPS em `127.0.0.1` e confia nas raízes ISRG.

Nada disto entra no build desktop: o serviço só vai no IPK, e a página e o worker só o usam no
build `WEBOS=1` (passo `webos/webpack/tlsproxy.js` e o override `Image.webos.tsx`).

## Peças

| Arquivo | O que faz |
|---|---|
| `service/service.js` | Serviço `io.github.gabrielsflores.stremio.tlsproxy` (ES5): raízes padrão + ISRG no repositório do processo, métodos Luna `start` (porta e token) e `status` (diagnóstico com log e pid) |
| `service/proxy.js` | O proxy HTTP em `127.0.0.1:47443` (ou a próxima porta livre): `/proxy?t=<token>&url=<https://…>` e `/status?t=<token>` |
| `service/ca.js`, `certs/`, `gen-ca.js` | Raízes ISRG X1, X2, Root YE e Root YR; `node gen-ca.js` regera o `ca.js`, `--check` confere |
| `client.js` | Lado da página: modo `direct`/`proxy`, assinatura do serviço com backoff, `proxify`, hosts aprendidos, checagem de saúde |
| `page.js` | A instância da página (prefixada na entrada `main`), exposta ao worker como `window.__webosTlsProxy` |
| `worker.js`, `worker-entry.js` | Troca o `self.fetch` do worker do core (prefixado na entrada `worker`) |
| `src/components/Image/Image.webos.tsx` | O `Image` do upstream com o `src` passando por `proxify`, e uma nova tentativa pelo proxy antes do fallback |
| `security-test.mjs` | Bateria de segurança contra o serviço real (hosts públicos; com `--cdp-port`, os redirecionamentos também no `fetch` do Chromium 53) |
| `emulator/run.sh`, `accept.mjs`, `memory.mjs` | Aceite no emulador: Board, Discover, detalhe, addon Let's Encrypt, serviço morto e recuperado, latência, memória, segurança |

O IPK leva o serviço ao lado do app: `webos/scripts/ares.sh package` roda
`webos/scripts/check-service.js` (ES5 puro, `ca.js` = `certs/`, ids coerentes com o `appinfo.json`)
e chama `ares-package <build-webos> webos/tlsproxy/service`.

## Como funciona

1. **Modo, uma vez por firmware.** Na subida, a página faz um `HEAD` `no-cors` a
   `https://images.metahub.space/`. Se der certo, a TV já confia na ISRG: modo `direct`, o serviço
   nem sobe. Se falhar, modo `proxy`. A decisão fica em `localStorage['webos.tlsProxy.mode']` com a
   versão do firmware e o user agent. Offline (ou sem resposta em 8 s) vale `proxy` só nesta sessão.
   Com `direct` guardado, uma falha num host Let's Encrypt conhecido refaz o teste (o `localStorage`
   de apps `file://` pode ser compartilhado; os valores lidos são validados).
2. **Serviço.** No modo `proxy`, a página chama `luna://…tlsproxy/start` com `subscribe: true`. A
   assinatura mantém o serviço vivo; quando o app fecha, o serviço sai sozinho (ocioso, 5 s). Em
   erro, nova tentativa em 1 s, 5 s, 30 s, 30 s…
   - **Se o processo morrer, a assinatura não é avisada** (medido no emulador). O app percebe pelo
     proxy: uma imagem do proxy que falha dispara um `/status` (no máximo a cada 5 s) e um `fetch`
     do worker que não alcança o proxy pede `restart` à página. Nos dois casos a página chama
     `start` de novo, recebe porta e token novos e as imagens são renderizadas com o endereço novo.
3. **Imagens** (`Image.webos.tsx`). `proxify` reescreve as URLs `https` dos hosts conhecidos:
   `images.metahub.space`, `debrid-link.com`, `debrid-link.fr` e os aprendidos. Outra imagem `https`
   que falhe é tentada uma vez pelo proxy antes do fallback do upstream; se carregar, um `HEAD` pelo
   proxy lê o emissor, e o host só é aprendido se for Let's Encrypt/ISRG.
4. **Core** (`worker.js`). Passam direto tudo o que não é `https` (URLs relativas, `file:`, os
   arquivos do core) e `127.0.0.1`/`localhost`. Hosts conhecidos vão pelo proxy, com método,
   cabeçalhos e corpo. Outro host `https` que dê `TypeError` é tentado uma vez pelo proxy, e a
   resposta só é usada (e o host aprendido) se o cabeçalho `X-Proxy-Issuer-O` disser Let's Encrypt:
   um `TypeError` também pode ser CORS, e o proxy não pode virar um contorno de CORS. A configuração
   vem da página pelo protocolo do Bridge (`window.__webosTlsProxy.config`); requisições feitas
   antes da decisão esperam até 3 s e depois seguem direto.

**Vídeo nunca passa pelo proxy (P3).** As URLs de stream vão direto ao `<video>`; só imagens e o
`fetch` do worker usam o proxy. Como defesa em profundidade, o serviço recusa `Range`, `video/*`,
`audio/*`, HLS e DASH, assinaturas de contêiner de mídia (`ftyp`, `styp`/`moof`/`sidx`/`moov`/`mdat`,
EBML, MPEG-TS, `#EXTM3U`, `<MPD`, Ogg, FLAC, ID3, AAC ADTS, quadro MPEG de áudio, FLV, AVI/WAVE,
RealMedia), binário genérico acima de 2 MB e qualquer corpo acima de 16 MB.

## Segurança do serviço

- Escuta só em `127.0.0.1`; token aleatório por processo em `/proxy` e `/status`; a Luna só aceita
  chamadas do próprio app; `Host` diferente de `127.0.0.1:<porta>`/`localhost:<porta>` dá 403.
- Só `https`, e só `GET`, `HEAD` e `POST` (o resto dá 405).
- **`Authorization` nunca vai a outro host.** Nos redirecionamentos que o serviço segue (GET/HEAD,
  até 5 saltos `https`), é removido no primeiro salto para outro host e **não volta** se a cadeia
  retornar ao host pedido (A → B → A, achado baixo da revisão c3 da F0.7). Nos que ele não segue
  (POST/307, cadeia longa), só devolve `Location` (para o próprio proxy) se o destino for o mesmo
  host `https` e a cadeia nunca tiver saído dele; senão, 502 sem `Location`.
- Corpo incompleto (timeout no meio, upstream que fecha antes do `Content-Length`): 504, ou a
  conexão cortada se os cabeçalhos já saíram, nunca um 200 truncado.
- Cliente que desiste cancela o upstream; `HEAD`/`204`/`304` sem corpo juntado; imagens juntadas
  numa escrita só (o `<img>` do Chromium 53 falhava com o corpo em pedaços); `tlsErrors` por código.

## Testes

```bash
pnpm test                                    # webos/tests/tlsproxy: proxy com upstreams HTTPS locais
                                             # (CA de teste), cliente da página e wrapper do worker
pnpm webos:package                           # inclui check-service.js
webos/tools/emu-run --timeout 20 -- webos/tlsproxy/emulator/run.sh <pasta>   # aceite no emulador
```

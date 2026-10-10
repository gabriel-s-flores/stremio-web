# F0.7 · Certificados Let's Encrypt no Chromium 53: decisão

> **Integrado na F3.7.** O serviço, as raízes, `gen-ca` e a bateria de segurança saíram deste
> spike para [`webos/tlsproxy/`](../../tlsproxy/README.md), com id `io.github.gabrielsflores.stremio.tlsproxy`,
> e o app de teste e o `run.sh` foram removidos (ficam no histórico do git). Este documento fica como
> registro da decisão; o funcionamento atual está no README do `webos/tlsproxy/`.

- **Data:** 2026-10-09 · **Fase:** 0 (viabilidade) · **Ambiente:** emulador oficial webOS TV 4.0 (QEMU, `emu-run`), Chromium 53.0.2785.34
- **Decisão:** opção **(a)**, um **serviço JS do próprio app** (Node v0.12.2) que faz proxy HTTPS em `127.0.0.1:47443` e confia nas raízes padrão do Node **mais** as raízes ISRG embutidas. O proxy de imagens de terceiros (`wsrv.nl`) fica documentado como alternativa, nunca como única saída.
- **Evidências:** `~/webos-tv-sdk/orquestrador/tarefas/F0.7/evidencias/`. Relatório: `…/F0.7/relatorio.md`.

## 1. O problema, medido

O repositório de CAs do Chromium 53 do emulador (2018) não tem nenhuma raiz da ISRG. Os hosts com Let's Encrypt falham em `fetch` e em `<img>` com `net::ERR_INSECURE_RESPONSE`. O log de rede via CDP das duas passadas está em `run1-net.json` e `run2-net.json`.

O Let's Encrypt já serve a **hierarquia nova (Gen Y)**, com raízes intermediárias de assinatura cruzada (`cadeias-tls.txt`):

| Host | Cadeia servida | TLS 1.2 com cifra que o OpenSSL 1.0.2 tem |
|---|---|---|
| `images.metahub.space` (pôsteres, fundos) | leaf → **YE2** → Root YE (cruzada por X2) → ISRG Root X2 (cruzada por X1) | ECDHE-ECDSA-AES128-GCM-SHA256 |
| `debrid-link.com` | leaf → **YR2** → Root YR (cruzada por X1) | ECDHE-RSA-AES128-GCM-SHA256 |
| `download.samplelib.com` | leaf → YR2 → Root YR (cruzada por X1) | idem |

Os dois hosts redirecionam `http://` para `https://` (301), então **HTTP puro não é saída**.

## 2. Opções avaliadas

| Opção | Resultado no emulador | Veredito |
|---|---|---|
| **(a) Serviço JS local (Node 0.12) com a CA ISRG** | Pôster e `fetch` LE funcionam; 0 erros de TLS em centenas de requisições; ~30 ms por pôster; RSS de ~40 MB | **Escolhida** |
| (b) Proxy de imagens de terceiros (`wsrv.nl`, cadeia GTS R4 → GlobalSign, a mesma família que já funciona com `api.strem.io`) | Pôsteres funcionam (mediana de 30–39 ms); só serve para imagens, não para APIs | Alternativa documentada |
| (c) HTTP onde o host permitir | `images.metahub.space` e `debrid-link.com` respondem 301 para HTTPS | Descartada |
| (d) Instalar a raiz ISRG no sistema | Exige root; a C8 não tem root confirmado (PESQUISA §5) e o plano não depende dele | Descartada |
| (d') TLS em JS/WASM dentro da página | Não cobre `<img>` nem CSS; custo alto de CPU no ARM | Descartada |

Por que (a) e não (b):
- **(b) não resolve APIs:** debrid-link e eventuais addons LE continuariam quebrados.
- **(b) põe um terceiro no caminho de todo pôster**, sem garantia de disponibilidade e vendo todos os títulos navegados. A premissa do orquestrador pede que isso nunca seja a única saída.
- **(a) não tem dependência externa e respeita a P3:** o próprio serviço recusa mídia (seção 5).

## 3. Como o protótipo funciona

```
app (file://, Chromium 53)                               serviço io.github.gabrielsflores.webostls.service (Node v0.12.2)
  luna://…service/start {subscribe:true}  ───────────▶  sobe http.Server em 127.0.0.1:47443, gera token aleatório
                                           ◀───────────  {port, token, strategy:"merged-root-store"}
  <img src="http://127.0.0.1:47443/proxy?t=TOKEN&url=https%3A%2F%2Fimages.metahub.space%2F…">
  fetch("http://127.0.0.1:47443/proxy?t=TOKEN&url=https%3A%2F%2Fdebrid-link.com%2F…")
                                           ───────────▶  https.request (keep-alive, 6 sockets) com raízes padrão + ISRG
```

- **Confiança:**
  - O Node 0.12 não tem API pública para *acrescentar* raízes.
  - `tls.createSecureContext({})` carrega as raízes padrão no repositório compartilhado do processo, e `context.addCACert(pem)` acrescenta nele as 4 raízes ISRG (X1, X2, Root YE, Root YR, geradas em `service/ca.js` por `gen-ca.sh`).
  - Assim o serviço confia nas raízes padrão **e** nas ISRG. No emulador o `/status` confirmou `strategy: merged-root-store`, Node v0.12.2 e OpenSSL 1.0.2k.
  - Se esse caminho interno não existir, o código cai para `ca` só com ISRG (vale apenas para hosts LE).
- **Vida do serviço:** a assinatura Luna de `/start` aberta pelo app mantém o serviço de pé (também tenta `activityManager`). Subida a frio: **~0,4–0,6 s** do `luna start` até a porta pronta.
- **Proteções** (revisadas nos ciclos 1 e 2; bateria em `security-test.mjs`, 36/36 contra o serviço no emulador, com os casos de redirecionamento rodando também no `fetch` do Chromium 53):
  - **Acesso:**
    - escuta só em `127.0.0.1`;
    - token aleatório por processo, exigido em `/proxy` **e** em `/status`. Outro app não obtém o token: a Luna recusa `start` de outro id;
    - `Host` diferente de `127.0.0.1:<porta>` ou `localhost:<porta>` dá 403 (contra DNS rebinding).
  - **Credenciais em redirect:** `Authorization` **só vai ao host pedido pelo app**, nos dois caminhos.
    - **Salto seguido pelo serviço** (GET/HEAD, até 5 saltos `https`): num salto para outro host ou porta, o `Authorization` é removido antes de seguir, como faz o navegador. No mesmo host é mantido.
    - **Salto não seguido** (método com corpo, como POST/307, ou cadeia acima de 5 saltos): o serviço só devolve `Location` (reescrito para o proxy) quando o destino é o **mesmo host `https`**. Para outro host, ou fora de `https`, responde **502** `{"error":"cross-host redirect not followed: …"}`, sem `Location`.
      - Motivo: um `Location` apontando para o proxy é o mesmo origin para o navegador. O Chromium 53 o segue reenviando o `Authorization`, e o serviço receberia esse pedido como se viesse do app. Reproduzido no ciclo 2 com o serviço anterior: o postman-echo recebia o segredo.
    - Esse é o único ponto em que o serviço emite `Location`: a lista de cabeçalhos repassados do upstream não inclui `location`, `content-location` nem `refresh`.
  - **Mídia (P3):**
    - `Range` recusado com 403;
    - `Content-Type` `video/*`, `audio/*`, HLS e DASH recusado;
    - **assinatura de contêiner** nos primeiros 512 bytes de toda resposta (os cabeçalhos só saem depois da inspeção): `ftyp` (exceto marcas de imagem AVIF/HEIF), EBML, MPEG-TS, `#EXTM3U`, `<MPD`, Ogg, FLAC, ID3, FLV, AVI/WAVE e RealMedia são recusados com 403.
  - **Tamanho:** 4 MB para imagens, **2 MB para binário genérico** (`application/octet-stream` ou sem tipo) e 16 MB para o resto. Timeout de 20 s.
  - **Ciclo da requisição:**
    - se o cliente desiste (`close`), o download no upstream é cancelado;
    - `HEAD`, `204` e `304` repassam os cabeçalhos sem juntar corpo (o `Content-Length` do `HEAD` é o do recurso).
  - **Diagnóstico:**
    - `/status` (com token) traz só estado, memória e contadores; `tlsErrors` é indexado por `err.code`, sem nomes de host;
    - o log e o pid saem só pelo método Luna `status`, que o sistema restringe ao próprio app. O console do serviço não chega a `/var/log/messages` no emulador; o log fica em memória (últimas 100 linhas).
- **Imagens são juntadas antes de responder** (uma escrita, `Content-Length` exato, limite de 4 MB). Repassar os pedaços do TLS (12 B e depois 1 KB por vez) fez o `<img>` do Chromium 53 dar `onerror` de forma intermitente com o corpo íntegro: 30 de 36 no modo repasse contra 36 de 36 juntando. O diagnóstico completo está em `evidencias/diagnostico-img-intermitente.txt`. A causa exata dentro do Chromium não foi isolada; a correção foi validada.

## 4. Critérios de aceite (emulador, boot limpo, `SOAK=600 emu-run -- run.sh`)

| # | Critério | Resultado |
|---|---|---|
| 1 | Pôster de `images.metahub.space` numa `<img>` pela solução | ✅ Nas duas passadas: direto `ERR_INSECURE_RESPONSE`; via serviço **200, 500x750**. Estabilidade 20/20 no combo que falhava. Capturas `run1-app.png`, `run2-app.png` |
| 2 | `fetch` a host Let's Encrypt pela solução | ✅ `debrid-link.com/api/v2/downloader/domains`: direto `TypeError: Failed to fetch` (`ERR_INSECURE_RESPONSE` no CDP); via serviço **HTTP 200, `success=true`, 151 domínios** |
| 3 | Documento com decisão, riscos, custo e plano para a F3.7 | Este arquivo |

Reconfirmados no ciclo 2 (`evidencias/ciclo2/run/`): os mesmos números, com `security-test.mjs` em 36/36, incluindo os casos de redirecionamento no Chromium 53.

Reconfirmados no ciclo 1, com o serviço corrigido (`evidencias/ciclo1/`):
- os critérios 1 e 2 nas duas passadas, com estabilidade 20/20;
- a carga de 600 pôsteres sem falhas, com RSS estável em 38–40 MB;
- `security-test.mjs` 25/25.

## 5. Custo de desempenho (medido no emulador, 2 vCPU, 1 GB)

| Medida | 1ª passada (serviço a frio) | 2ª passada |
|---|---|---|
| `luna start` até a porta pronta | 419 ms | 5 ms (já de pé) |
| Pôster via serviço, sequencial (11 após o 1º) | mediana **29 ms**, p90 38 ms | mediana 33 ms, p90 52 ms |
| 12 pôsteres em paralelo via serviço | **444 ms** no total | 203 ms |
| Pôster via wsrv.nl (alternativa b) | mediana 30 ms | mediana 39 ms |
| Salto local: mesmo JSON de host GTS, direto × via serviço (mediana) | 380 × 435 ms (+55 ms) | 429 × 552 ms |
| Estabilidade (img via serviço + img wsrv + fetch via serviço, simultâneos) | 20/20 | 20/20 |

**Memória do serviço** (RSS por `/proc/<pid>/status`, cruzado com `process.memoryUsage()`):

| Momento | RSS | heapUsed |
|---|---|---|
| Logo após `start` | 22 MB | 5 MB |
| Após as 2 passadas (~150 requisições) | 34–35 MB | 6 MB |
| Carga de 600 pôsteres (6 em paralelo, 10,6 s, 0 falhas) | **estabiliza em 38–40 MB** (VmHWM 41,7 MB) | 5–8 MB, estável |

- O RSS sobe no começo (heap do V8, buffers do OpenSSL e sockets keep-alive) e para de crescer; não há sinal de vazamento.
- A memória do serviço é de **outro processo**, mas conta para a memória da TV. Somada ao app, fica dentro do orçamento da D10 (250 MB para o app) com folga, e deve ser reavaliada na Fase 7.
- O custo por pôster é dominado pela rede: o salto local acrescenta dezenas de ms. O primeiro pôster de cada host paga o handshake TLS no serviço (~0,5–1 s para debrid-link a frio).

## 6. Riscos

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| A TV real (firmware mais novo) se comportar diferente: serviço JS, porta local, `addCACert` | Baixa–média | Alto | Mesma versão de Node e WAM do webOS 4.0; o fallback `isrg-only` cobre a falta do `addCACert`; a alternativa (b) fica pronta para imagens; item da Fase 8 |
| A TV já confiar em ISRG (CAs atualizadas) e o proxy virar sobrecarga desnecessária | Média | Baixo | Na F3.7 o app testa um host LE direto uma vez e só usa o proxy se falhar (seção 7) |
| O sistema encerrar o serviço por ociosidade ou memória | Média | Médio | Assinatura Luna aberta enquanto o app vive; o cliente refaz o `start` e repete a requisição uma vez em erro de conexão |
| Raízes Let's Encrypt novas (Gen Z…) ou fim das assinaturas cruzadas | Baixa (anos) | Médio | `gen-ca.sh` regenera `ca.js`; as raízes YE/YR já embutidas cobrem as cadeias curtas sem cruzamento |
| Cifras e protocolo: hosts que exijam só TLS 1.3 (o OpenSSL 1.0.2 vai até TLS 1.2) | Baixa | Médio | Hoje todos os hosts medidos aceitam TLS 1.2 GCM; o `/status` registra erros por código para diagnóstico |
| Segurança: proxy local acessível a outros apps ou páginas da TV | Baixa | Médio | Só em `127.0.0.1`, token por processo em `/proxy` e `/status` (a Luna nega o `start` a outro app), checagem de `Host`, só https, sem mídia, limites de tamanho |
| Token de debrid ou addon vazar para outro host via redirecionamento | Baixa (corrigido nos ciclos 1 e 2) | Médio | `Authorization` removido nos saltos cross-host que o serviço segue; redirecionamento cross-host não seguido vira 502, sem `Location`. Casos de regressão no `security-test.mjs`, no Node e no Chromium 53, e no aceite da F3.7 |
| Timeout de ociosidade no meio do corpo (Node 0.12 pode emitir `end` após o `abort()`, e uma imagem truncada sairia como 200) | Baixa | Baixo | Apontado na revisão c2; existia antes. Na F3.7, marcar `timedOut`/`aborted` no upstream e destruir a resposta em vez de concluí-la |
| Falha intermitente do `<img>` com repasse fragmentado (causa não isolada no Chromium) | Baixa (corrigida) | Médio | Imagens sempre juntadas no serviço; em JSON grande, juntar também se aparecer sintoma; o cliente tenta de novo uma vez |
| Vídeo do debrid passar pelo serviço (violaria a P3 e o pipeline nativo) | Baixa | Alto | O cliente nunca passa URLs de stream ao proxy (seção 7) **e** o serviço recusa `Range`, `video/*`, `audio/*`, HLS, DASH, assinaturas de contêiner de mídia, binário genérico acima de 2 MB e qualquer corpo acima de 16 MB |
| Proxy de terceiros (b) indisponível ou bloqueado | — | Médio | Só alternativa documentada; não entra no build |

## 7. Plano de integração (F3.7)

Pré-requisitos: build `WEBOS=1` e empacotamento IPK da Fase 1, e webOSTV.js (F3.1). Nada disso muda o build desktop: os módulos abaixo só entram por alias ou override `*.webos.*`, e no desktop resolvem para versões vazias.

**7.1 Serviço no IPK**
1. Mover `webos/spikes/tls/service/` para a pasta de fontes do IPK definida na F1 (ex.: `webos/app/service/`), com id `<id-do-app>.tlsproxy`. O id do serviço precisa começar com o id do app.
2. O script de empacotamento da F1 passa a chamar `ares-package <app> <service>`.
3. Checagens no build: `acorn --ecma5` em `service/*.js` (o serviço não passa pelo Babel), e `gen-ca.sh` conferindo que `ca.js` corresponde a `certs/`.
4. Ajustes no serviço:
   - remover o modo `_stream=1` (só existia para o A/B);
   - porta fixa 47443 com fallback para a próxima livre, devolvida no `start`.
5. **Segurança: obrigações que já estão no spike e não podem regredir.** O `security-test.mjs` vai para o repositório junto com o serviço e roda no aceite da F3.7:
   - `Authorization` (e qualquer cabeçalho de credencial que venha a ser repassado) nunca chega a outro host ou porta por redirecionamento:
     - nos saltos que o serviço segue, é removido;
     - nos que ele não segue, um destino cross-host vira 502, e o serviço nunca devolve um `Location` próprio que aponte para outro host (o navegador o seguiria no mesmo origin, reenviando a credencial);
   - token em `/proxy` e `/status`; diagnóstico detalhado (log, pid) só pela Luna;
   - checagem de `Host`;
   - recusa de mídia por `Content-Type` **e** por assinatura, com limite menor para binário genérico;
   - aborto do upstream quando o cliente desiste; `HEAD`/`204`/`304` sem corpo juntado;
   - `tlsErrors` por código.
6. Endurecimento a decidir na F3.7:
   - ampliar as assinaturas de mídia: segmentos fMP4 sem `ftyp` (`styp`/`moof`/`sidx` no offset 4), AAC ADTS e MP3 sem ID3 (sincronismo `0xFFF`), e considerar inspecionar também respostas `text/*`/JSON;
   - destruir a resposta (em vez de concluí-la) quando o upstream for abortado por timeout no meio do corpo;
   - restringir os métodos a `GET`, `HEAD` e `POST`, se nenhum addon usado precisar de outro. Hoje o proxy aceita qualquer método para qualquer host `https`, inclusive IPs da rede local, o que é aceitável porque só o próprio app tem o token.

**7.2 Cliente na página: `src/webos/tlsProxy.js`** (no desktop, `tlsProxy.desktop.js` com `proxify = url => url`)
1. `start()`:
   - chama `webOS.service.request('luna://<id>.tlsproxy', { method: 'start', parameters: { subscribe: true }, subscribe: true })` e guarda a requisição (é ela que mantém o serviço vivo);
   - em `onFailure` ou cancelamento, marca o proxy como indisponível e tenta de novo com backoff (1 s, 5 s, 30 s).
2. **Detecção de modo** na subida: um `fetch` direto a `https://images.metahub.space/` (HEAD ou um pôster pequeno).
   - Se der certo, a TV já confia na ISRG: `mode = 'direct'`, o serviço nem sobe e `proxify` vira identidade.
   - Se falhar, `mode = 'proxy'`.
   - O resultado fica em `localStorage` com a versão do firmware, para não repetir o teste a cada abertura.
   - Ressalva: o `localStorage` de apps `file://` pode ser compartilhado entre apps, então outro app poderia gravar `mode='direct'` ou hosts falsos. O impacto é só de disponibilidade. Mesmo com `mode='direct'` guardado, uma falha de rede num host do conjunto refaz a detecção, e os hosts lidos do `localStorage` são validados (só nomes de host, tamanho limitado).
3. `proxify(url)`: só reescreve quando `mode === 'proxy'`, o proxy está pronto, a URL é `https:` e o host está no conjunto LE.
   - O conjunto começa com `images.metahub.space`, `debrid-link.com` e `debrid-link.fr`.
   - Ele aprende hosts novos (seção 7.4) e é persistido em `localStorage`.
4. `retryViaProxy(url)`: para o `onError` de imagem e para o `fetch` do worker. Tenta uma vez pelo proxy; se der certo, adiciona o host ao conjunto.

**7.3 Imagens**
1. `src/components/Image/Image.tsx` (43 usos em 30 arquivos), num override `Image.webos.tsx` ou num hook `useImageSrc`:
   - `src` passa por `proxify`;
   - no primeiro `onError` de uma URL `https:` ainda não reescrita, tenta `retryViaProxy` antes do `renderFallback` e do `fallbackSrc` atuais.
2. Os desvios do componente, com o mesmo `proxify`:
   - `src/routes/Player/Player.js:981` (fundo do player, metahub);
   - `src/routes/Discover/Guide/ChannelColumn/Logo/Logo.tsx:39`;
   - `src/routes/Discover/Guide/Row/Row.tsx:67` (`backgroundImage`);
   - `src/components/ModalDialog/ModalDialog.js:66`;
   - `src/components/EventModal/EventModal.js:36`.

   Os avatares (`NavMenuContent.js:71`, `User.tsx:39`) não importam no modo convidado (P3).
3. O serviço já junta as imagens antes de responder (seção 3), então não há o que fazer no cliente quanto à falha intermitente.

**7.4 Core (addons e APIs) no Worker**
1. Entrada própria do worker no build webOS, `src/webos/worker.js`, apontada pelo `webpack.config.js` (hoje é `node_modules/@stremio/stremio-core-web/worker.js`, linha 41): instala o wrapper e depois faz `require` do `worker.js` original.
2. Configuração vinda da página: o override webOS de `src/core/createTransport.ts` manda `{ type: 'webos-tls-proxy', mode, port, token, hosts }` por `postMessage` logo depois do `new Worker(...)`, antes do `init`, e de novo quando o proxy reinicia.
3. O wrapper troca `self.fetch` (a cola chama `arg0.fetch(arg1)` a cada requisição, `stremio_core_web.js:145`):
   - **passam direto:** URLs relativas, `file:` e o mesmo origin (o `.wasm` é carregado por `fetch`, linha 864), `127.0.0.1` e qualquer coisa fora de `https:`;
   - **host no conjunto:** reconstrói o `Request` com a URL do proxy, mantendo método, cabeçalhos e corpo;
   - **`TypeError` de rede em host `https:` fora do conjunto:** tenta uma vez pelo proxy e, se der certo, avisa a página (`postMessage`) para aprender o host.
   - **Aprender só quando a causa é certificado.** O `TypeError` do `fetch` também cobre CORS, e o serviço responde `Access-Control-Allow-Origin: *`; sem esse cuidado, o proxy viraria um contorno de CORS e "aprenderia" hosts sem problema de certificado. Na F3.7 o serviço devolve, no `/proxy`, um cabeçalho com o emissor da cadeia do upstream (ex.: `X-Proxy-Issuer-O: Let's Encrypt`, lido de `getPeerCertificate()`), e o host só é aprendido quando esse emissor é Let's Encrypt/ISRG.
   - Cópia de `Request` com corpo no Chromium 53: testar na F3.7. Se `new Request(url, req)` não preservar o corpo, usar `req.clone().arrayBuffer()`.
4. Requisições que chegam antes da configuração esperam até 3 s e depois seguem direto.

**7.5 O que nunca passa pelo proxy (P3)**
- A URL do stream (`Player.js:541-570` → `useVideo.js:62` → stremio-video) vai direto ao `<video src>`. O pipeline de mídia tem outro repositório de CAs e já tocou HTTPS Let's Encrypt (PESQUISA §7).
- O `HEAD` de `HTMLVideo/getContentType.js:10` e os `fetch` do stremio-video ficam na página, onde não há wrapper global: o patch é só no worker e nos componentes de imagem.
- Defesa em profundidade no serviço: `Range`, `video/*`, `audio/*`, HLS e DASH recusados, assinaturas de contêiner recusadas e limites de tamanho (seção 3).
- Legendas remotas (`withHTMLSubtitles.js:515,670`) são texto e poderiam passar pelo proxy. Ficam fora da F3.7 e entram como item da F5 se aparecer um host LE de legendas.

**7.6 Aceite da F3.7 no emulador**
1. Board, Discover e detalhes com pôsteres e fundos do metahub, em captura de tela.
2. Log CDP sem nenhum `ERR_INSECURE_RESPONSE` ao navegar pelas telas principais.
3. Um addon servido por HTTPS com Let's Encrypt (ex.: addon de teste num host LE) instala e lista catálogos pelo worker.
4. Com o serviço morto à força, o app se recupera (novo `start`) sem recarregar.
5. Tela de diagnóstico (F3.6) mostrando modo, porta, `/status` e hosts aprendidos.
6. Memória do serviço somada à do app na medição da Fase 7.
7. Testes Jest para `proxify`, aprendizado de hosts e o wrapper do worker: passagem do mesmo origin, do `.wasm` e de `127.0.0.1`, e cópia do `Request`.
8. **`security-test.mjs` 100% contra o serviço no emulador, com `--cdp-port`** (casos de redirecionamento também no `fetch` do Chromium 53), incluindo as regressões de credencial:
   - GET cross-host seguido pelo serviço;
   - POST 307 cross-host;
   - cadeia acima de 5 saltos terminando em outro host;
   - cadeia em que o serviço devolve um `Location` do mesmo host;
   - controles no mesmo host, onde a credencial continua chegando.

**7.7 Alternativa (b), só documentada**
- Se o serviço JS falhar na TV real (Fase 8), as imagens podem passar por `https://wsrv.nl/?url=<host/caminho>` (cadeia GTS/GlobalSign, aceita pelo Chromium 53, ~30–40 ms por pôster no emulador), atrás de uma configuração explícita.
- Isso não resolve addons e APIs com Let's Encrypt, por isso não é a solução principal.

## 8. Como reproduzir

```bash
# no worktree, com o ares CLI no PATH
webos/spikes/tls/gen-ca.sh                                    # só se as raízes em certs/ mudarem
SOAK=600 webos/tools/emu-run -- webos/spikes/tls/run.sh /tmp/f07   # boot limpo, 2 passadas + carga + segurança
```

O `run.sh` termina com código ≠ 0 se algum caso do `security-test.mjs` falhar.

| Arquivo | O que é |
|---|---|
| `service/service.js` | Serviço (ES5, Node 0.12): Luna `start` e `status`, HTTP `/proxy` e `/status` |
| `service/ca.js`, `certs/*.pem`, `gen-ca.sh` | Raízes ISRG X1, X2, Root YE, Root YR (SHA-256 nos comentários) |
| `app/` | App de teste (Chromium 53): direto × serviço × wsrv, custo, estabilidade, `__tlsSoak(n)` |
| `cdp-net.mjs` | Log de rede via CDP (`Network.*`), com `--go` para capturar a 1ª passada a frio |
| `security-test.mjs` | Bateria de segurança (30 casos no Node e mais 6 no Chromium 53 com `--cdp-port`): credenciais em redirect seguido e não seguido, token, `Host`, mídia por tipo e por assinatura, limites, `HEAD`, aborto, validação TLS (badssl) |
| `run.sh` | Instala, roda as passadas, a carga e a bateria de segurança (túnel SSH até a porta do serviço), captura telas, memória (`/proc` por SSH) e o log do serviço (Luna `status`), e grava tudo em OUT |

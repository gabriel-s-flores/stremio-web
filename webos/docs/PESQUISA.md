# Pesquisa: Stremio Web na LG OLED55C8PSA (webOS TV 4.x)

Data: 2026-10-09.

Premissas do projeto (ver o plano): desenvolvimento só no emulador; áudio nos alto-falantes da TV, sem soundbar nem receiver; só debrid, sem servidor de streaming. As informações sobre ARC, passthrough e servidor ficam aqui como contexto. Grau de confiança: **[M]** medido aqui no emulador oficial 4.0 · **[V]** verificado em documento oficial ou código-fonte · **[P]** provável (relatos consistentes ou código aberto da LG que pode diferir do firmware) · **[?]** não confirmado ou contraditório.

Os itens marcados **[TV]** precisam de confirmação na TV real.

## 1. Alvo e runtime

| Item | Valor | Conf. |
|---|---|---|
| Modelo | LG OLED55C8PSA (C8, 2018). "05.50.70" é a versão de firmware | [V] |
| Sistema | webOS TV 4.0 | [V] |
| Motor web | Chromium **53.0.2785.34**, UA `Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/53.0.2785.34 Safari/537.36 WebAppManager` | [M] |
| V8 | 5.8.301 (backport da LG; o Chromium 53 original usava V8 5.3) | [V] fonte webosose/chromium53 |
| Resolução da UI | 1920x1080 (o app não renderiza gráficos em 4K); vídeo em 3840x2160 num plano separado | [V] |
| `devicePixelRatio` | **0** no emulador (cuidado com divisões por DPR) | [M] [TV] |
| Heap JS | `jsHeapSizeLimit` 588 MB no emulador. A LG recomenda que o app use **menos de 250 MB** | [M] / [V] |
| Serviços JS | **Node v0.12.2** (ES5: sem `let/const`, arrow, destructuring), sem addons nativos e sem WebAssembly. Node 8.12 só a partir do webOS 5 | [V] |

### O que o Chromium 53 da LG suporta (medido no emulador)

- **Sintaxe presente:** arrow, class, let/const, template, destructuring, default params, spread em chamadas, generators, `**`, **async/await**, regex com named groups e lookbehind.
- **Sintaxe ausente:** object rest/spread, optional chaining, `??`, class fields e private fields, optional catch binding, `for await`, regex `/s`, BigInt, separador numérico, `||=`, `import()`.
- **APIs presentes:** `fetch`, `ReadableStream`, `TextEncoder/Decoder`, `URL`/`URLSearchParams`, Worker, IntersectionObserver, MutationObserver, MediaSource, EME, `HTMLMediaElement.audioTracks` e `videoTracks`, `crypto.subtle`, IndexedDB, localStorage, `Object.entries/values`, `padStart`, `Array#includes`, `formatToParts`, `requestIdleCallback`, Proxy, `PalmServiceBridge`, `PalmSystem`, **`WebAssembly`**.
- **APIs ausentes:** AbortController, `Array#flat`, `Element#append`, `requestFullscreen` (só `webkit…`), `Element#scrollTo`, WeakRef e FinalizationRegistry, `Intl.PluralRules`, `Intl.RelativeTimeFormat`, `Intl.Locale`, `Object.fromEntries`, **PointerEvent**, `Promise.allSettled` e `finally`, **ResizeObserver**, `replaceAll`, `Symbol.asyncIterator`, customElements, `globalThis`, `navigator.clipboard`, `mediaCapabilities`, `mediaSession`, `queueMicrotask`, `structuredClone`, `WebAssembly.instantiateStreaming`.
- **CSS presente:** custom properties, `filter`, `object-fit`, `will-change`, `touch-action`, `-webkit-mask-image`.
- **CSS ausente:** **grid**, **`gap`** (inclusive em flexbox, medido por layout), **sticky** (também `-webkit-sticky`), `aspect-ratio`, `inset`, `clamp()` e `min()`, `backdrop-filter`, `mask-image` sem prefixo, cor `#rrggbbaa`, propriedades lógicas, `overscroll-behavior`, `scroll-behavior`, `env()`, `dvh`.
- **Seletores ausentes:** `:focus-visible`, `:focus-within`, `:is()`, `:where()`, `:has()`, `:not()` com lista. Uma regra cujo seletor contém um deles é **descartada inteira** pelo Chromium 53.
- **Rede de app empacotado (`file://`):** CORS relaxado (leu `https://example.com` sem cabeçalho CORS). Worker carregado de `file://` funciona e faz `fetch`. [M]

## 2. WebAssembly e o core (`stremio-core-web`)

- **WebAssembly MVP funciona no emulador.** [M]
  - Um módulo versão 01 compila. As versões pré-padrão 0x0b, 0x0c e 0x0d são rejeitadas.
  - O `WebAssembly` existe porque o V8 5.8 da LG implementa o MVP, mas o global só aparece com a flag `--expose-wasm`, ligada no emulador. **[TV]** Na TV, conferir `typeof WebAssembly`. Se faltar, testar `"v8ExtraFlags": "--expose-wasm"` no `appinfo.json`, chave que o WAM de 2018 lê. [V] no código
- **Compilação no emulador, dentro de um Worker** [M] (detalhes em `probe/results/core-wasm-emulator-4.0.md`):

  | Binário | Resultado |
  |---|---|
  | 0.65.0 oficial do npm | `CompileError: invalid local type @+165` (externref) |
  | 0.57.0 do npm | compila em **1,8–1,9 s** |
  | **0.65.0 MVP (receita A)** | compila em **2,0 s** (validate 63 ms), 69 imports e 18 exports, **sem `i64` na fronteira JS** (não precisa de BigInt) |

  O pico de memória no sistema convidado ficou entre 115 e 170 MB.
- **Core 0.65.0 oficial (o que o `development` usa) não serve.** [V] [M]
  - Usa externref (reference types), duas tabelas, multivalue, bulk memory (6073 `memory.copy`) e conversões float→int sem trap.
  - O Binaryen não consegue rebaixar externref, a segunda tabela nem o multivalue.
- **Receita A: 0.65.0 como WASM MVP, testada pelo agente de pesquisa** [V]
  1. Rust 1.77.2, com `gloo-utils` 0.3 → 0.2 em `stremio-core-web/Cargo.toml` (`cargo update -p gloo-utils --precise 0.2.0`).
  2. `cargo build --release --target wasm32-unknown-unknown`.
  3. wasm-bindgen CLI 0.2.121 com `--target web`.
  4. `wasm-opt -O --signext-lowering`.
  - **Resultado:** 4,92 MB, só `+mutable-globals`, nenhum opcode pós-MVP. No Node carrega o `ctx` e 6 catálogos do Board. Reproduzido nesta máquina em 1 min 12 s, com o mesmo resultado.
  - **Por que funciona:** no lockfile da 0.65.0, só o `gloo-utils 0.3` exige Rust acima de 1.77, e a Stremio mantém o MSRV do `stremio-core` em 1.77 com CI semanal.
  - **Limitação:** o wasm-pack não compila com Rust 1.77; usar o binário pronto, ou cargo + wasm-bindgen + wasm-opt manualmente.
  - **Artefatos:** `spikes/core-mvp/out/mvp-0.65.0/` e o pacote `spikes/core-mvp/out/stremio-stremio-core-web-0.65.0-mvp.1.tgz`.
- **Receita B, documentada e não testada:** nightly com `RUSTFLAGS=-Ctarget-cpu=mvp` e `-Zbuild-std=panic_abort,std`. Será necessária quando as dependências passarem do Rust 1.77.
- **Fallback wasm2js** [V]
  - O 0.57.0 vira 31,75 MB de JS (3,64 MB com gzip) e roda.
  - O 0.65.0 MVP vira 34,3 MB e roda com um patch de duas linhas na glue do wasm-bindgen: trocar a checagem de buffer destacado por `buffer !== wasm.memory.buffer`. Essa é a causa do "unknown panic" citado pela Stremio.
  - Usa cerca de 2x mais memória que o WASM.
- **Precedente da própria Stremio** [V]
  - A branch `origin/asmjs` do `stremio-core` (Rust 1.77, wasm-bindgen =0.2.78) publica um tgz 0.58.0 em `stremio.github.io/stremio-core/stremio-core-web/asmjs/`.
  - O app de TV fechado da Stremio (`tv.strem.io`, UI "stremio_theater", 2023) usava o core em wasm2js e tratava Chrome/53 como webOS 4.

## 3. Servidor de streaming

- **O app oficial da LG roda o servidor dentro da TV** como serviço JS `io.strem.tv.server`, com um `server.js` próprio (`dl.strem.io/server/v4.21.1/webos/server.js`) que exige Node ≥ 8.10. Por isso **o app oficial só suporta webOS 5 (2020) em diante** ([blog da Stremio](https://blog.stremio.com/stremio-is-now-available-on-lg-tvs-for-models-2020/)). [V]
- **No webOS 4 (Node 0.12.2) esse servidor não roda.** Torrents exigem um servidor de streaming em outra máquina da rede (PC/NAS com stremio-service ou Docker), ou só streams HTTP (debrid). [V]
- O `/tracks` do servidor usa o pacote JS `get-tracks-data` (lê cabeçalhos de MKV/MP4), não o ffprobe. [V]

## 4. Mídia na C8 (caminho `<video src>` nativo)

O `<video src="…">` com URL direta vai para o uMediaServer, o pipeline nativo da TV, que preserva HDR, DV e Atmos. O caminho MSE (hls.js/dash.js) é um player separado e mais limitado. [P]

| Formato / recurso | C8 | Observação | Conf. |
|---|---|---|---|
| HEVC Main10 4K60 (até 60 Mbps) | Sim | MKV, MP4 e TS | [V] |
| AV1 | Não | só a partir do webOS 5 | [V] |
| VP9 Profile 2 | Talvez | só em MKV ou via MSE | [?] |
| HDR10, HLG | Sim | | [P] |
| HDR10+ | Toca como HDR10 | | [P] |
| **Dolby Vision P5 e P8.1 em MP4** | Sim | | [P] |
| **Dolby Vision em MKV** | **Não ativa DV.** P7 e P8.1 caem para HDR10; **P5 fica com cores erradas** (não tem camada base HDR10) | DV em MKV só no webOS 25 | [P] |
| DV P7 | Só MP4 dual-track (muxer antigo) | | [?] |
| DV em TS, HLS ou MSE | Contraditório ou desconhecido | o MSE do Chromium 53 da LG não aceita `dvh1/dvhe` | [?] [TV] |
| AAC, AC3, E-AC3 5.1/7.1 | Sim | | [V] |
| **E-AC3 Atmos (JOC)** | Decodifica (Atmos virtual nos alto-falantes) | pelo ARC: [TV] | [P] |
| **TrueHD (e TrueHD Atmos)** | **Não** (fica mudo) | | [P] |
| DTS, DTS-HD | Contraditório; no máximo o núcleo DTS | a spec 4.0 lista DTS em MKV; o suporte da LG diz "só USB/HDMI" | [?] [TV] |
| FLAC | Só 2 canais | | [V] |
| Opus, Vorbis | Desconhecido | | [?] |
| LPCM | Sim | 2 canais pelo ARC | [P] |
| eARC | **Não** (só ARC, na HDMI 2). TrueHD por passthrough é impossível | | [P] |
| Troca de faixa de áudio | Sim, via `audioTracks` (rótulos sem idioma) ou Luna `selectTrack` | | [P] |
| Legendas de texto embutidas | Renderizadas pelo pipeline (Luna) | | [P] |
| PGS, VobSub | Não | | [?] |
| HLS nativo | v5 com TS; fMP4 não documentado; DASH não suportado | | [V] |
| Velocidade de reprodução ≠ 1 | **Sem áudio** na C8 | | [P] |
| Seek em MKV | Arquivos sem SeekHead→Cues quebram seek e retomada | | [P] |

**Luna `com.webos.media`** (não documentado para TV, usado pela Stremio e pela Lampa):
- `subscribe` entrega `sourceInfo.programInfo[].audioTrackInfo` (idioma, codec, canais) e `subtitleTrackInfo`.
- `selectTrack` e `setSubtitle*` existem.
- O `mediaOption` documentado tem início em ms, `mediaTransportType` e adaptive streaming.
- O `htmlMediaOption.useUMSMediaInfo`, não documentado, dispara eventos `umsmediainfo`. [V]/[P]

**Detecção de capacidades no próprio webOSTV.js:**
- `dolbyVision` = `tv.config.supportDolbyHDRContents`.
- `dolbyAtmos` depende de saída ARC, Digital Sound Out em auto ou passthrough e `atmosDevice` do `com.webos.service.eim`.
- No emulador: `supportDolbyHDRContents=false`, `supportDolbyTVATMOS=false`, `tv.hw.dtsType="DTS HD"`. [M] **[TV]** ler os valores reais da C8.

**Jellyfin no webOS 4**, como referência: DV só em MP4/TS; DTS decidido por `canPlayType`; TrueHD só se o usuário ativar; FLAC no máximo estéreo. Tentaram hls.js e reverteram porque perdia Atmos e DV.

## 5. Plataforma

- **appinfo.json (4.x):** `disableBackHistoryAPI` (o app recebe Back como keyCode 461), `handlesRelaunch`, `resolution`, `transparent`, `splashBackground` e `largeIcon`. O WAM de 2018 também lê as chaves não documentadas `v8ExtraFlags`, `useNativeScroll`, `enableBackgroundRun` e `inspectable`. O `requiredMemory` não é lido. [V]/[P]
- **Teclas:** setas 37–40, OK 13, Back 461, cores 403–406, Play 415, Pause 19, FF 417, RW 412, Stop 413 (as de mídia só no controle comum). Canal +/- e números provavelmente não chegam ao app. [V] [TV]
- **Eventos:** `cursorStateChange` (Magic Remote), `keyboardStateChange`, `webOSLaunch` e `webOSRelaunch`, `visibilitychange`. O ponteiro gera eventos de **mouse**; não há Pointer Events. [V]
- **webOSTV.js:** v1.2.13 (março de 2026), "suportado a partir do webOS TV 4.0", distribuído como zip: `https://webostv.developer.lge.com/assets/library/webOSTVjs-1.2.13.zip`. [V]
- **Developer Mode**
  - Conta de desenvolvedor LG, app "Developer Mode" e o PC na mesma rede.
  - `ares-setup-device` na porta 9922 com usuário `prisoner`, depois `ares-novacom --getkey` com a passphrase.
  - **A sessão agora vai até 1000 h** (LG, dez/2025; antes eram 50 h). Para estender: `ares-launch com.palmdts.devmode -p extend=true`, ou o endpoint `ResetDevModeSession.dev?sessionToken=…` usado pelo webOS Dev Manager.
  - **Se expirar, os apps instalados são removidos.** [V]
- **Persistência:** o exemplo oficial WebStorage da LG diz que o localStorage de app empacotado "é apagado quando o usuário atualiza ou remove o app". Isso pode deslogar o usuário a cada atualização. [V] [TV]
- **Root:** faultmanager e dejavuln atingem o webOS 4.0+, mas o firmware 05.50.70 não foi confirmado. Não é necessário para o plano. [?]

## 6. Achados no código atual (`development` = upstream)

- **Build**
  - `ts-loader` com `module: nodenext` emite ESNext, e o Babel exclui `node_modules`; as duas coisas precisam mudar para o Chromium 53.
  - O worker do core sai de `node_modules/@stremio/stremio-core-web/worker.js`, e o `.wasm` vira asset.
  - O bundle de produção é grande: `main.js` com 9,5 MB minificado, incluindo hls.js (1,1 MB de fonte) e stremio-video, mais o chunk `575.js` com 8,5 MB do `@stremio/libass-wasm`.
- **CSS:** `display: grid` em 12 arquivos (Discover, Library, Calendar, LiveTV…), `gap` em 173 linhas de 72 arquivos, `min()/max()/clamp()` em ~16 arquivos, sticky em 4, `backdrop-filter` em 9, `:focus-visible` e `:focus-within` em 8 regras. A regra de destaque do `MetaItem` (`.hovered, :focus-within, .active, .selected`) seria descartada inteira.
- **APIs:** ResizeObserver (4 arquivos), `onPointer*` (5 arquivos), `navigator.clipboard`, Fullscreen, `mediaSession`, `Object.fromEntries`, `flat`, `globalThis`, `Intl` (i18next precisa de `Intl.PluralRules`).
- **Player**
  - O `Player.js` passa `platform.name`, que vem do Bowser em minúsculas (`'webos'`), mas o stremio-video só escolhe o `WebOsVideo` com `'webOS'`. Sem ajuste, cairia no `HTMLVideo`.
  - Com um servidor que transcodifica, o `withStreamingServer` exige arquivo sem legendas embutidas e com menos de 2 faixas de áudio, e não lista HEVC. Isso **transcodificaria a maioria dos remuxes 4K e perderia DV e Atmos**.
  - O `getMaxAudioChannels()` devolve 2 quando `window.chrome` existe; o Player usa `surroundSound ? 32 : 2`.
  - O `tracksData.js` busca as faixas em `http://127.0.0.1:11470/tracks/` fixo, então falha sem servidor na própria TV.
  - O `WebOsVideo` esconde DTS e TrueHD (a menos que `tv.model.edidType` os mencione) e esconde PGS e VobSub.
- **Navegação:** o `spatial-navigation-polyfill` (fork WICG da Stremio) já é carregado no `App.js`, com cerca de 230 pontos de foco e teclado no código.

## 7. Mídia, rede e certificados no emulador (medido em 2026-10-09)

Emulador oficial 4.0 em QEMU/KVM, mídia sintética gerada com ffmpeg e servida por `scripts/media-server.mjs` (Range e 302). Ferramentas: `scripts/play-test.sh` e `scripts/switch-test.js`.

**O que funciona (primeira reprodução após o boot):**

| Caso | Resultado |
|---|---|
| MP4 H.264 + AAC | toca (7,3 s em 8 s) |
| MKV H.264 + AAC | toca |
| MKV H.264 + AC3 5.1 | toca |
| MKV H.264 + E-AC3 5.1 | toca |
| MP4 **HEVC 10-bit** + E-AC3 5.1 | toca, decodificado em software com artefatos visuais e sem HDR |
| MKV com 3 faixas de áudio (AAC eng, AAC por, AC3 5.1) | `video.audioTracks` lista as 3 faixas com idioma ISO 639-1 (`en`, `pt`, `en`) e rótulo vazio |
| Troca de faixa | `audioTracks[1].enabled = true` é aceito; o app precisa desligar as demais |
| Legendas SRT embutidas | **não** aparecem em `textTracks` (precisam do Luna) |
| Redirect 302 (como os links de debrid) | seguido, inclusive nas requisições Range do seek |
| Seek | `currentTime = 15` gera `Range: bytes=4347303-`, depois `seeked` |
| Seek vai para o **keyframe anterior** | o pipeline posiciona no keyframe anterior ao tempo pedido. Num clipe de 10 s com um só keyframe (GOP de 250 quadros), o seek para 5 s volta ao início e o `seeked` dispara normalmente: só a checagem do progresso (`currentTime`) mostra. Com keyframe a cada 1 s o seek cai no lugar (F0.10, `webos/tools/media-suite`). Na TV: Fase 8 |
| Link HTTPS com Let's Encrypt no **pipeline de mídia** | toca (o pipeline tem outro repositório de CAs) |

**Problemas encontrados:**
- **`luna://com.webos.media/subscribe` feito pelo app congela o `currentTime`** do `<video>` (fica em 0, sem `timeupdate`, embora o vídeo avance). O `WebOsVideo` da Stremio não faz essa assinatura.
- **Só a primeira reprodução após o boot é confiável.** As cargas seguintes ficam em `loadstart` ou em `readyState` 0. Nenhuma destas estratégias resolveu de forma estável:
  - `removeAttribute('src')` + `load()`;
  - um `<video>` novo por carga;
  - `luna://com.webos.media/unload` (funcionou uma vez, falhou em sequência);
  - troca direta do `src`;
  - recarga da página.

  O processo `starfish-media-pipeline` termina em menos de 2 s após a liberação.

  **Causa medida na F5.6 (2026-10-10):** liberar um pipeline **enquanto ele renderiza** (o `unload` do `WebOsVideo`, ou pausar e liberar no mesmo instante) deixa o próximo pipeline com a thread de vídeo (`vqueue:src`) em laço ocupado no kernel. O estado é do sistema: vale para o resto do boot, mesmo com reload ou reabrindo o app. Pausar e esperar 0,5–2 s antes de liberar, ou liberar depois do `ended`: 72 de 72 cargas sem trava (12 boots), contra 1 de 13 boots sem trava liberando direto. O app passou a fazer isso (`webos/lib/player/withPipelineGuard.js`). Detalhes, detector (`webos/tests/player/pipeline-state.js`) e teste no app em `webos/lib/player/README.md`, "Trocas de stream".
- **Tela preta depois da 1ª carga, no app (F5.6b, 2026-10-11):** uma carga depois da 1ª da página toca (relógio andando, pipeline decodificando) com a tela da VM preta. **Mecanismo:** o plano de vídeo não recebe o lugar do `<video>` novo, que ocupa o lugar do anterior; mudar o tamanho do `<video>` traz a imagem na hora. A 1ª carga de cada página mostra imagem (um reload "zera"), e no app-sonda não acontece (4 de 4 com imagem). **O disparo depende do fluxo:** saindo do Player para os Detalhes e escolhendo outro stream, é a liberação silenciosa da F5.6 (ligada 0/10 com imagem, desligada 7/7, p ≈ 5·10⁻⁵); na troca imediata de rota, a tela preta aparece também sem o guarda. O guarda passou a mudar a largura em 2 px por 250 ms no 1º `playing` de cada carga, o que resolve os dois fluxos (`webos/lib/player/README.md`, "Imagem depois da 1ª carga", com a tabela por fluxo). **Capturas:** o `screendump` do QEMU mostra o plano de vídeo (brilho ~120 com a mídia de teste); a captura da página pelo CDP não (o vídeo fica transparente nela). **c8:** o plano falha desde a 1ª carga com e sem o guarda; sem o empurrão ele congela no 1º quadro (3/3), com ele na maioria das vezes não desenha nada (aparece o fundo do sistema, 3/5) ou congela (2/5): item da Fase 8.
- **Placa de som:** com AC97 e backend `none`, a reprodução também travou. O emulador roda sem placa de som por padrão (`--sound pa` liga o som no PC).
- **Rede:** a NIC PCnet da VM oficial travava sob transferências grandes no QEMU; com e1000 está estável.

**Certificados no `fetch`/`<img>` do Chromium 53 (emulador, CAs de 2018):**

| Host | Cadeia | Resultado |
|---|---|---|
| `api.strem.io`, `v3-cinemeta.strem.io`, `opensubtitles-v3.strem.io`, `watchhub.strem.io`, addons do ElfHosted (comet, mediafusion, stremthru, aiostreams) | GTS com assinatura cruzada da GlobalSign | ✅ |
| `api.real-debrid.com`, `*.download.real-debrid.com` | DigiCert Global Root G2 | ✅ |
| `api.alldebrid.com`, `api.torbox.app`, `tb-cdn.st`, `www.premiumize.me` | GTS e GlobalSign | ✅ |
| **`images.metahub.space`** (pôsteres e fundos), **`debrid-link.com`**, `download.samplelib.com` | Let's Encrypt (ISRG Root X1) | ❌ `net::ERR_INSECURE_RESPONSE` |

A TV tem firmware mais novo que o emulador, então pode ter CAs atualizadas, mas pela premissa P1 o problema precisa ser resolvido no emulador (tarefa 0.7).

## 8. Fontes principais

- LG: [Web engine](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine), [Vídeo/áudio 4.0](https://webostv.developer.lge.com/develop/specifications/video-audio-40), [Streaming/DRM](https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm), [Resolução](https://webostv.developer.lge.com/develop/specifications/app-resolution), [mediaOption](https://webostv.developer.lge.com/develop/guides/mediaoption-parameter), [JS service](https://webostv.developer.lge.com/develop/guides/js-service-basics), [Back](https://webostv.developer.lge.com/develop/guides/back-button), [Magic Remote](https://webostv.developer.lge.com/develop/guides/magic-remote), [Developer Mode](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app), [webOSTV.js](https://webostv.developer.lge.com/develop/references/webostvjs-release-notes), [extensão do dev mode (fórum)](https://forum.webostv.developer.lge.com/t/whats-the-way-to-extend-dev-time-with-webos-cli/28033), [memória < 250 MB (fórum)](https://forum.webostv.developer.lge.com/t/this-app-will-now-restart-to-free-up-memory/5605), [WebStorage sample](https://github.com/webOS-TV-app-samples/WebStorage).
- Código aberto LG (webOS OSE, 2018): [chromium53](https://github.com/webosose/chromium53) (V8, `--expose-wasm`, MSE, `mediaOption`), [wam](https://github.com/webosose/wam/blob/submissions/4/src/core/ApplicationDescription.cpp), [umediaserver](https://github.com/webosose/umediaserver).
- Stremio: [stremio-core `asmjs`](https://github.com/Stremio/stremio-core/tree/asmjs), [binaryen#6628](https://github.com/WebAssembly/binaryen/issues/6628), [stremio-core#862](https://github.com/Stremio/stremio-core/issues/862), [blog LG 2020+](https://blog.stremio.com/stremio-is-now-available-on-lg-tvs-for-models-2020/), [server webOS](https://dl.strem.io/server/v4.21.1/webos/server.js).
- Rust: [mudança de features do wasm32](https://blog.rust-lang.org/2024/09/24/webassembly-targets-change-in-default-target-features/).
- Mídia: [jellyfin-web browserDeviceProfile](https://github.com/jellyfin/jellyfin-web/blob/master/src/scripts/browserDeviceProfile.js), [jellyfin-web PR 7328 (DV em MKV no webOS 25)](https://github.com/jellyfin/jellyfin-web/pull/7328), [PRs 6678](https://github.com/jellyfin/jellyfin-web/pull/6678)/[7226](https://github.com/jellyfin/jellyfin-web/pull/7226)/[7296](https://github.com/jellyfin/jellyfin-web/pull/7296) (hls.js perde Atmos/DV), [jellyfin-webos #355 (seek MKV)](https://github.com/jellyfin/jellyfin-webos/issues/355), [#281 (velocidade)](https://github.com/jellyfin/jellyfin-webos/issues/281), [fórum makemkv (DV na C8)](https://forum.makemkv.com/forum/viewtopic.php?p=112269), [Emby (Atmos e TrueHD no E8)](https://emby.media/community/topic/70432-lg-webos-oled-dolby-atmos), [LG C8 spec](https://www.lg.com/nz/tvs/lg-OLED55C8).
- Comunidade webOS: [webOS Dev Manager (renovação do dev mode)](https://github.com/webosbrew/dev-manager-desktop), [webosbrew dev-toolbox (versões de firmware)](https://github.com/webosbrew/dev-toolbox-cli).

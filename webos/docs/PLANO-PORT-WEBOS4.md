# Plano do port: Stremio Web para LG webOS TV 4.x (OLED55C8PSA)

- **Data:** 2026-10-09 (revisão 2: premissas definidas pelo dono do projeto)
- **Etapa atual:** Fase 0 (fundação). A implementação ainda não começou.
- **Base técnica:** [PESQUISA.md](PESQUISA.md), com os fatos, as fontes e o que foi medido no emulador.
- **Ferramentas:** [../README.md](../README.md)

## Premissas do projeto

> **P1. Todo o desenvolvimento e todos os testes acontecem no emulador.**
> A TV real (LG OLED55C8PSA) só entra no projeto **quando tudo estiver pronto**, na fase final de validação (Fase 8). Nenhuma fase anterior depende da TV, e nenhuma decisão é adiada "para ver na TV".
>
> **P2. O áudio sai pelos alto-falantes da TV.** Não há soundbar nem receiver, então ARC e passthrough estão fora do escopo.
>
> **P3. Só debrid.** Os streams chegam como links HTTPS diretos (Real-Debrid, AllDebrid, TorBox, Premiumize…) por meio dos addons. Não há torrents nem servidor de streaming, nem na TV nem na rede.

O emulador é a **imagem oficial da LG do webOS TV 4.0**, rodando em QEMU/KVM nesta máquina (`scripts/emulator-qemu.sh`). Tem o mesmo motor web da TV: Chromium 53.0.2785.34, com o V8 5.8 da LG.

## 1. Resumo

1. **Core em WebAssembly.**
   - O core atual (0.65.0) recompilado como WASM MVP **compila em 2,0 s no emulador**. O pacote publicado no npm não serve: falha com `invalid local type`.
   - Como a TV só será vista no fim, o app traz também o core em **wasm2js** e troca sozinho se o WebAssembly não existir. Os dois caminhos são testados no emulador.
2. **Player nativo.** `<video src>` com o link do debrid vai direto para o pipeline da TV, que preserva 4K, HDR10, Dolby Vision (em MP4) e Dolby Atmos (DD+). Nada de hls.js nem MSE.
   - O pipeline do emulador já reproduziu H.264 e HEVC 10-bit, com AAC, AC3 5.1 e E-AC3 5.1, em MP4 e MKV.
   - Também funcionaram redirect 302, seek por Range e a lista de faixas de áudio com idioma.
3. **Sem servidor.** As faixas e os codecs de cada stream passam a ser lidos **no próprio app**, que baixa só o cabeçalho do arquivo com Range. Isso substitui o `/tracks` do servidor e permite escolher a faixa de áudio compatível e detectar Dolby Vision P5 antes de tocar.
4. **Limites da C8 que nenhum software contorna:**
   - Dolby Vision só é ativado em MP4. Em MKV, P7 e P8.1 caem para HDR10, e P5 fica com as cores erradas.
   - TrueHD não toca.
   - Com debrid e sem servidor não existe remux, então DV em MKV vira HDR10, e streams P5 em MKV precisam ser evitados.
5. **Certificados.** O Chromium 53 do emulador recusa certificados **Let's Encrypt** (`ERR_INSECURE_RESPONSE`). Isso afeta os pôsteres do `images.metahub.space` e alguns addons/debrids. Precisa de solução na Fase 0 (tarefa 0.7). As APIs da Stremio, os addons do ElfHosted e os principais debrids (Real-Debrid, AllDebrid, TorBox, Premiumize) funcionam.

### Decisões

| # | Decisão | Por quê |
|---|---|---|
| D1 | App **empacotado (IPK)** com a UI do stremio-web, gerado por um build `WEBOS=1` numa branch nova `webos` | Funciona offline e sem depender de web.stremio.com; roda de `file://` com CORS relaxado (medido) |
| D2 | Core **WASM MVP** (receita A) com **fallback automático para wasm2js**, testado no emulador forçando o fallback | O WebAssembly da TV só será confirmado na Fase 8; o app não pode depender disso |
| D3 | Player **`WebOsVideo`** (`<video src>` + Luna), com três ajustes vindos do emulador. **(a)** O app não assina `com.webos.media/subscribe`, porque no emulador isso congela o `currentTime`. **(b)** As faixas vêm de `video.audioTracks` e do probe de cabeçalho (D5). **(c)** Liberar o pipeline entre streams é um problema conhecido do emulador (tarefa 5.6) | Comportamentos medidos no emulador |
| D4 | **Sem servidor de streaming**: no build webOS, ocultar streams de torrent (infoHash) e os avisos e telas de servidor | P3 |
| D5 | **Probe de cabeçalho no cliente** (Range nos primeiros MB do link do debrid) para ler contêiner, codecs, idiomas, legendas e perfil Dolby Vision | Substitui o `/tracks` do servidor; permite escolher a faixa de áudio certa e evitar o DV P5 em MKV |
| D6 | **Perfil de capacidades da C8 embutido** (vem da pesquisa), aplicado pelo app (escolha de faixas, filtro e ordenação de streams) e **ajustável por configuração** na Fase 8 | Sem TV durante o desenvolvimento, as regras precisam ser explícitas e fáceis de ajustar no fim |
| D7 | **Dolby Vision:** stream MP4 com DV toca direto (DV ativo). Em MKV, P7 e P8.1 tocam como HDR10. **P5 em MKV é marcado e rebaixado na lista**, com aviso | Limite da C8; sem servidor não há remux |
| D8 | **Atmos:** DD+ Atmos (E-AC3 JOC) toca e a TV o decodifica com Atmos virtual nos alto-falantes. TrueHD: a faixa compatível (E-AC3, AC3 ou AAC) é escolhida sozinha; sem nenhuma, aviso. DTS conta como "a confirmar" e o app prefere outra faixa até a Fase 8 | P2 e limites da C8 |
| D9 | Manter o layout do stremio-web com **fallbacks CSS automáticos** (PostCSS) e **manuais** (grid, `min()/max()`), usando a navegação espacial que já existe | Menos divergência do upstream |
| D10 | **Emulador no "perfil C8":** 1 GB de RAM, orçamento de memória de 250 MB para o app e CPU limitada para estimar desempenho. Há ainda uma tela de **diagnóstico** no app (a sonda incorporada) para agilizar a Fase 8 | Aproximar a TV sem tê-la |

## 2. O que a C8 entrega, dentro das premissas

| Recurso | Na C8 | O que o app faz |
|---|---|---|
| 4K HEVC Main10, HDR10, HLG | ✅ | Toca direto |
| Dolby Vision em **MP4** (P5, P8.1; P7 dual-track) | ✅ | Toca direto, e esses streams sobem na lista |
| Dolby Vision em **MKV** P7 e P8.1 | ⚠️ toca como HDR10 | Toca, com o rótulo "HDR10 nesta TV" |
| Dolby Vision em **MKV P5** | ❌ cores erradas | Detecta (probe ou nome) e rebaixa na lista, com aviso |
| DD+ Atmos (E-AC3 JOC) | ✅ Atmos virtual nos alto-falantes | Prefere essa faixa quando existir |
| E-AC3 e AC3 5.1, AAC | ✅ downmix nos alto-falantes | Toca direto |
| TrueHD (com ou sem Atmos) | ❌ fica mudo | Escolhe outra faixa sozinho; sem alternativa, avisa e rebaixa o stream |
| DTS e DTS-HD | ❓ fontes contraditórias | Prefere outra faixa; a Fase 8 decide |
| AV1 | ❌ | Oculta ou rebaixa |
| Velocidade ≠ 1x | ❌ sem áudio | Opção escondida no webOS |
| Legendas PGS e VobSub | ❌ | Ocultas; texto embutido via Luna e legendas de addons em overlay HTML |

## 3. Arquitetura

```
IPK (app web empacotado, roda de file://)
├── appinfo.json           disableBackHistoryAPI, resolution 1920x1080, handlesRelaunch
├── index.html + main.js   React 18 do stremio-web transpilado para Chromium 53 (Babel + core-js + PostCSS)
├── worker.js              core: core.wasm (MVP); se faltar WebAssembly, core.wasm2js.js
├── webOSTV.js 1.2.13      Luna, deviceInfo, platformBack
└── perfil-c8.json         regras de capacidades (D6), ajustáveis na Fase 8

Fluxo de reprodução
  addon com debrid → stream {url HTTPS}
    → probe de cabeçalho (Range, no app)   faixas, idiomas, codecs, perfil DV
    → regras C8                            escolhe a faixa de áudio, marca ou rebaixa streams
    → <video src=url>                      pipeline nativo (HDR10, DV em MP4, DD+ Atmos)
    → video.audioTracks / Luna selectTrack / setSubtitle*

Rede: APIs da Stremio, addons e debrid por HTTPS direto (sem servidor; tarefa 0.7 resolve o Let's Encrypt)
```

## 4. O que o emulador cobre e o que só a TV mostra

| Área | No emulador (desenvolvimento) | Só na Fase 8 (TV) |
|---|---|---|
| JS, CSS, layout, navegação, foco | ✅ mesmo motor da TV | Legibilidade a 3 m, sensação do Magic Remote |
| Core WASM e fallback wasm2js | ✅ medido | Se o WebAssembly está ligado no firmware da C8 |
| Controle remoto | ✅ teclas reais via porta 19001 (Back 461, cores, mídia) | Teclas de número, canal e info |
| Luna, appinfo, ciclo de vida, persistência entre atualizações | ✅ | |
| Reprodução H.264, HEVC 8/10-bit, AAC, AC3, E-AC3, MP4/MKV, redirect, seek, faixas | ✅ decodificação em software, até 1080p | 4K a 60–80 Mbps, Wi-Fi e cabo |
| HDR10, Dolby Vision, Atmos (imagem e som reais) | ❌ | ✅ checklist da Fase 8 |
| DTS, TrueHD | ❌ não confiável | ✅ |
| Trocas seguidas de stream | ⚠️ instável no emulador (tarefa 5.6) | ✅ |
| Desempenho e memória | ⚠️ proxy com CPU limitada | ✅ medição real |
| Certificados (CA) | ✅ o emulador é mais antigo que a TV, então é o caso pior | Confirmação |

**Regra dos testes de mídia no emulador:** um cenário de reprodução por boot da VM. O boot leva cerca de 15 s; depois da primeira reprodução, novas cargas podem travar.

## 5. Fases

Cada tarefa vira uma branch e um PR para `webos`. **Todos os critérios de aceite das Fases 0 a 7 são verificados no emulador**, com `cdp.mjs`, `remote.mjs`, capturas de tela e os testes automatizados.

### Fase 0: fundação e viabilidade (emulador)

| Tarefa | Status | Aceite |
|---|---|---|
| 0.1 Desfazer o port webOS 5 | ✅ | Branches e PR removidos; backup em `~/stremio-archive/` |
| 0.2 Ferramentas: ares CLI, emulador 4.0, Binaryen, wasm-pack, Rust 1.77.2, wasm-bindgen, scripts, sonda | ✅ | README |
| 0.3 Emulador via QEMU sem root, sonda executada | ✅ | `probe/results/` |
| 0.4 Mídia no emulador: o que o pipeline reproduz | ✅ | PESQUISA, seção 7 |
| 0.5 **Core MVP** | 🟡 compila em 2,0 s | Script reprodutível com gate de opcodes pós-MVP e `i64` na fronteira JS; **inicializa** no emulador (`core ready`, `get_state('ctx')`, catálogos do Board) com tempo e memória medidos |
| 0.6 **Fallback wasm2js** | ⏳ | O core em wasm2js (com o patch da glue) inicializa no emulador com `WebAssembly` escondido; troca automática testada |
| 0.7 **Certificados Let's Encrypt** | ⏳ | Escolher e testar no emulador uma solução para os pôsteres (`images.metahub.space`) e para addons ou debrids com Let's Encrypt. Candidatas: proxy local num serviço JS (Node 0.12 com a CA ISRG embutida), proxy de imagens com certificado compatível, ou HTTP onde o host permitir |
| 0.8 Persistência | ⏳ | Sonda v1 grava localStorage e IndexedDB, sonda v2 instalada por cima lê: o login sobrevive a atualizações? |
| 0.9 Perfil C8 no emulador | ⏳ | `emulator-qemu.sh` com CPU limitada (cgroup ou cota) e 1 GB; baseline de boot e navegação da sonda registrado |
| 0.10 Harness de testes de mídia | ⏳ | Biblioteca de mídias sintéticas (ffmpeg) e servidor de teste (`media-server.mjs`); um cenário por boot, em lote, com relatório |

**Gate G0 (emulador).** Seguir para a Fase 1 só se:
- o core (WASM e wasm2js) inicializa no perfil C8;
- 0.7 tem solução;
- a memória projetada cabe em ~250 MB.

### Fase 1: build webOS e primeiro boot

1. Criar a branch `webos` a partir de `development`. O modo `WEBOS=1` no webpack:
   - gera saída em `build-webos/` com caminhos relativos;
   - não usa Workbox/PWA;
   - copia `appinfo.json`, os ícones e o webOSTV.js.
2. Babel `preset-env` com target `chrome 53` e core-js 3 por uso, transpilando `node_modules`. O `ts-loader` passa a ser seguido do Babel.
3. Polyfills: ResizeObserver, `Intl.PluralRules` com locales, `Element#append/scrollTo`, AbortController (parcial), `queueMicrotask`.
4. Core MVP e fallback wasm2js (tarefas 0.5 e 0.6) via alias no webpack; carregamento com `WebAssembly.instantiate`.
5. Fora do bundle webOS: `hls.js` e `@stremio/libass-wasm` (8,5 MB). Sentry só se couber no orçamento.
6. Gate de sintaxe com `es-check`.
7. Scripts `webos:build`, `webos:package`, `webos:install` e `webos:launch` (emulador).

**Aceite:** o app abre no emulador, mostra o Board com catálogos, o login funciona, o console fica limpo e o `es-check` passa.

### Fase 2: CSS e layout de TV

1. PostCSS:
   - `postcss-preset-env` (chrome 53);
   - autoprefixer;
   - `flex-gap-polyfill` (173 usos de `gap`);
   - `postcss-focus-visible` e `postcss-focus-within` com os polyfills.
2. Fallbacks manuais:
   - CSS Grid → flex-wrap (12 arquivos);
   - `min()/max()/clamp()` → valores fixos (~16 arquivos);
   - sticky (4 arquivos);
   - `backdrop-filter` → fundo opaco (9 arquivos);
   - `aspect-ratio`.
3. Overrides em arquivos `*.webos.less` carregados só com `WEBOS=1`.
4. Escala de TV: fontes, áreas de foco, overscan, foco bem visível.

**Aceite:** capturas do emulador comparadas com o Chrome desktop em todas as telas principais, sem quebras.

### Fase 3: plataforma webOS

1. Plataforma `webos` → `webOS` para o stremio-video; webOSTV.js.
2. Back (461) com `disableBackHistoryAPI`: um despachante central fecha overlays, depois volta rotas e, na raiz, confirma a saída.
3. Ciclo de vida (`visibilitychange`, `webOSRelaunch`).
4. Teclado virtual; links externos e pagamentos viram QR code ou ficam desativados.
5. Persistência conforme a tarefa 0.8.
6. **Tela de diagnóstico** (D10): versão, WebAssembly, configs Luna de DV, Atmos e DTS, `canPlayType`, memória. Serve à Fase 8.
7. Solução de certificados da tarefa 0.7 integrada.

### Fase 4: navegação por controle remoto

1. Navegação espacial em todas as rotas: foco inicial, restauração, listas horizontais e verticais, carregamento sob demanda.
2. Magic Remote como mouse, alternando com o modo setas por `cursorStateChange`. Adaptar os 5 componentes com `onPointer*`.
3. Teclas de mídia e cores no Player.
4. Modais com focus trap.

**Aceite:** percorrer todas as telas só com `remote.mjs` no emulador, sem perder o foco.

### Fase 5: player

1. `WebOsVideo` ativo (platform `webOS`), sem transcodificação, sem a opção de velocidade e sem `com.webos.media/subscribe` pelo app (D3a).
2. **Probe de cabeçalho** (D5): ler MKV e MP4 dos primeiros MB por Range (avaliar o pacote JS `get-tracks-data`, o mesmo do servidor da Stremio) e extrair faixas, idiomas, codecs, legendas e a configuração Dolby Vision (perfil e compatibilidade).
3. **Regras C8** (D6 a D8): faixa de áudio inicial compatível, idioma preferido do usuário, rótulos de qualidade e avisos.
4. Faixas: lista vinda do probe e de `video.audioTracks` (idioma); troca ligando uma faixa e desligando as demais (medido no emulador) ou por Luna `selectTrack`.
5. Legendas: texto embutido via Luna (`setSubtitleEnable`), legendas de addons em overlay HTML.
6. **Trocas de stream e episódio:** liberação confiável do pipeline. No emulador, só a primeira carga após o boot é estável; testar `luna unload` + `removeAttribute/load`, recriação do elemento e recarga controlada. O resultado é documentado e vira item obrigatório da Fase 8.
7. Seek, retomada, próximo episódio, estatísticas. Atenção ao seek em MKV sem índice (cues).

**Aceite no emulador:** a biblioteca de mídias de teste passa (H.264 e HEVC, AAC, AC3 e E-AC3, multi-faixas, legendas, redirect, seek). As regras C8 passam nos testes unitários com cabeçalhos reais de arquivos DV, Atmos, TrueHD e DTS. Essas amostras só são lidas, não decodificadas.

### Fase 6: debrid e lista de streams

1. Ocultar streams que exigem servidor (torrent/infoHash) e as telas e avisos de servidor de streaming.
2. **Ordenação e rótulos pela compatibilidade com a C8:** DV em MP4 primeiro, P5 em MKV rebaixado, áudio compatível e Atmos destacados, TrueHD/DTS-only rebaixados. Usa o nome do stream e o probe sob demanda.
3. Links HTTPS com redirect (já validados), expiração de links e mensagens de erro claras.
4. Testes ponta a ponta no emulador com addons reais: Cinemeta, um addon de debrid e uma conta Stremio de teste.

### Fase 7: desempenho, memória e estabilidade (emulador no perfil C8)

1. Medir boot até o Board, navegação, memória (`performance.memory`, `free` via SSH) e compilação do core.
2. Otimizar: code splitting, pôsteres menores, animações desligadas, listas virtualizadas se preciso.
3. Teste de resistência no emulador: navegação contínua e uma reprodução longa por boot, sem vazamentos.

### Fase 8: validação final na TV real (a única fase com a TV)

Entrada: as Fases 0 a 7 aceitas no emulador.

1. **Developer Mode** na C8 (sessão de até 1000 h), instalação do IPK final, tela de diagnóstico aberta.
2. Checklist de mídia nos alto-falantes da TV (seção 7).
3. Ajustar o perfil C8 por configuração (DTS, P5, regras de faixas) e corrigir o que só aparecer na TV. Correções de código voltam ao fluxo normal e são retestadas no emulador antes de ir de novo à TV.
4. Medir desempenho e memória reais; trocas seguidas de stream; legibilidade a 3 m; Magic Remote.

### Fase 9: distribuição

1. IPK versionado, publicado como release no fork.
2. Instalação pelo Developer Mode com renovação automática (endpoint `ResetDevModeSession`) ou pelo webOS Dev Manager.
3. Opcional: Homebrew Channel com root, se o firmware permitir.

## 6. Riscos

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| **Diferenças entre emulador e TV só aparecem na Fase 8** | Média | Alto | Perfil C8 por configuração; fallback do core; tela de diagnóstico; emulador como caso pior (certificados, CPU limitada); folga de prazo na Fase 8 |
| WebAssembly desligado na C8 | Baixa–média | Alto | Fallback wasm2js automático (0.6) e `v8ExtraFlags: --expose-wasm` |
| Certificados Let's Encrypt recusados | Alta no emulador; ? na TV | Alto (pôsteres, addons) | Tarefa 0.7 antes de tudo |
| Core lento ou pesado no ARM | Média | Alto | Perfil C8 com CPU limitada; medir cedo; build `-Oz` |
| Trocas de stream travando o pipeline | Média | Alto | Tarefa 5.6; item obrigatório da Fase 8 |
| Muitos streams DV P5 em MKV | Média | Médio | Detecção, rebaixamento e aviso; HDR10 quando o stream tiver base layer |
| Login perdido a cada atualização | Média | Médio | Tarefa 0.8 |
| Memória acima de 250 MB | Média | Alto | Sem hls.js e libass; pôsteres menores; medir na Fase 7 |
| Divergência do upstream | Alta | Médio | `WEBOS=1`, aliases e overrides; merge periódico de `development` |

## 7. Checklist da Fase 8 (TV real, alto-falantes da TV)

Para cada stream, registrar: toca? selo DV ou Atmos da TV? cores certas? seek e retomada? troca de faixa? A coleta usa a tela de diagnóstico.

1. HEVC HDR10 MKV 4K
2. DV P5 MP4
3. DV P8.1 MP4
4. DV P8.1 MKV (esperado: HDR10)
5. DV P7 MKV (esperado: HDR10)
6. DV P5 MKV (esperado: rebaixado e com aviso)
7. DD+ Atmos (E-AC3 JOC) em MKV e MP4: selo Atmos e som
8. TrueHD Atmos com faixa AC3 ou E-AC3 alternativa: troca automática
9. DTS e DTS-HD MKV
10. MKV com 3 faixas de áudio e 5 legendas
11. Arquivos de 60–80 Mbps por cabo e por Wi-Fi
12. 10 trocas seguidas de stream e episódio
13. Boot, memória e fluidez da navegação

## 8. Branches e upstream

- `development` é espelho do upstream, sem mudanças do port.
- `webos` (nova) concentra o port. Cada tarefa sai de `webos` em `port/<tarefa>` e volta por PR.
- `development` entra em `webos` por merge a cada release do upstream. Conflitos e quebras são reportados antes de adaptar.
- O build MVP do `stremio-core-web` acompanha a versão do core usada pelo `development`.

## 9. O que preciso de você

- **Fases 0 a 5:** nada. As mídias de teste são sintéticas, e as amostras DV, Atmos, TrueHD e DTS para os testes de regras são públicas: baixo só os cabeçalhos ou trechos curtos.
- **Fase 6:** uma **conta Stremio de teste com um addon de debrid configurado**, para os testes ponta a ponta no emulador. Pode ser a sua, se preferir.
- **Fase 8:** o app *Developer Mode* instalado na TV, ativado com uma conta de desenvolvedor LG, com o IP da TV e a passphrase; e alguns títulos reais seus para o checklist.

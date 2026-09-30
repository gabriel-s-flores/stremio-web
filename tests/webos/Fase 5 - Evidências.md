# Fase 5 — Player, Vídeo e Streaming

Implementação em `t3code/implement-phase-5`, no checkout `/home/dev/Projects/stremio-web`.
Fonte: vault persistente `../stremio/11 - Port webOS 5/Fase 5 — Player, Vídeo e Streaming.md`.
Plano: [Fase 5](../../webos/Fase%205%20-%20Plano.md). Data: 30/09/2026.

O tarball oficial do npm foi baixado e inspecionado nesta sessão: inclui
`package/src/WebOsVideo/WebOsVideo.js`, sem whitelist `files`; SHA-512 igual à
integridade do registry e bytes do WebOsVideo idênticos aos instalados.
[Registro público verificável](phase5/published-package.json).

## Implementação e limites por tarefa

| Tarefa | Entrega no código | Aceite nativo ainda aberto |
|---|---|---|
| T5.1 | Tarball oficial com integridade SHA-512 conferida e fonte idêntica à instalada: 0.0.96 contém `src/WebOsVideo` (main `src/index.js`, sem whitelist `files`). Selector real testado para URL direta/servidor. Eventos do hook isolados por instância e listeners limpos no destroy. Loader webOS cancela timer de mediaId no unload/destroy/load e reinicia `loaded` entre episódios. | `implementationChanged` e eventos na TV, heap nativo e binge real |
| T5.2 | Códigos da biblioteca 82/83 (DOM 3/4) recebem mensagem de codec com ação para outro stream/transcodificação. | Matriz de codecs, HDR e 4K por modelo |
| T5.3 | Settings explica endereço HTTP(S) remoto, valida/normaliza URLs de rede, seleção/status e dispositivo ligado; Board abre diretamente Streaming. URL, reload e fallback visual de cópia da T3.9 preservados. Torrent sem servidor no Player recebe orientação. | `?streamingServerUrl=` e conectividade/Origin/TLS reais |
| T5.4 | Conversor publicado executado com fetch controlado: magnet → POST no host escolhido → URL de playback no mesmo host. Magnet malformado não lança; Err/timeout remove loading/timer e permite nova submissão. Efeito do Player reage a Loading→Ready e troca de transportUrl. | Peers/speed reais, magnet E2E e rede lenta |
| T5.5 | Wrapper HTML, preferências e offset/ResizeObserver fallback preservados. ASS styling desligado na TV, toggle retirado e aviso na seleção explícita de ASS/SSA. Conversão para texto simples existente na biblioteca preservada. | SRT/VTT, seleção embutida e estilos Luna; URL sem extensão pode não receber aviso antecipado, falha recebe orientação SRT/VTT |
| T5.6 | Seleção Luna/fallback audioTracks e surround→maxAudioChannels existentes preservados. | Multi-áudio, EDID, surround/passthrough e estéreo |
| T5.7 | Menu, botão, tecla azul, shortcuts e hold 2× bloqueados no Player webOS. `lastPlaybackSpeed` da biblioteca é otimista e não confirma resposta Luna. | Spike em progressivo/HLS antes de reabilitar |
| T5.8 | Seek com commits debounced da T4.4 preservado; erro de rede permite reload explícito sem loop automático. | Stream >2h, queda/retorno Wi-Fi e buffering prolongado |
| T5.9 | VolumeSlider, indicador de volume e wheel do Player ocultos/desligados na TV; mute preservado; volume pelo controle do sistema. Decisão conservadora até teste físico. | Confirmar mute/volume real por modelo |
| T5.10 | HTML webOS sem cast_sender, serviço não inicia; botão Cast oculto. Downloads/players externos e Play on device retirados da TV; copiar links continua disponível. Erro oferece reload e outro stream com foco confinado/restaurado. Fixture debug pode exibir Cast sintético, sem iniciar sender. | Decidir DLNA com servidor real; atualmente oculto por falta de validação |
| T5.11 | Resume em ms, NextVideo/auto-next e pauseOnMinimize do ciclo de vida mantidos. Teste de contrato verifica ms e três ciclos de teardown. | Binge de 3 episódios, precisão do resume, troca real de apps |
| T5.12 | MediaSession guardada e dispatcher de mídia preservados; azul respeita política de velocidade. | Teclas físicas na TV |

## Decisões de produto

A LG documenta restrição de velocidade diferente de 1.0 em streaming adaptativo:
[Streaming Protocol and DRM](https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm).
O spike físico **não foi executado**. Velocidade fica desabilitada conservadoramente
na TV (inclusive progressivo); a possibilidade de Luna `setPlayRate` permanece
em investigação. Desktop mantém controles de velocidade, volume, Cast e player externo.

ASS/SSA: o plano original dizia que não havia conversão. O pacote efetivamente
instalado contém `loadPlainSubtitles`/`subtitlesConverter` e distingue estilização
ASS. Foi mantida a tentativa de conversão plain text, sem prometer paridade de estilos.
Legendas nativas não expõem `subtitlesOutlineColor` no manifest; outline HTML
permanece suportado, outline nativo é limitação a conferir no hardware.

O loader faz substituições exatas na versão pinada e falha o build se as âncoras
mudarem; não altera `node_modules` nem a seleção de implementação desktop.

## Validação

**Gates finais aprovados:** 39 suítes / 742 testes; lint; builds desktop, webOS,
webOS debug e packaged; ES2018 em todos os três artefatos webOS; verificadores de
debug/packaged e do Player emitido. Cast presente apenas no HTML desktop, patch
nativo presente apenas em webOS. Os três source maps webOS confirmam também a
correção final de transição do servidor Loading→Ready/transportUrl.
Webpack mantém dois avisos de tamanho de bundle; nenhuma falha de build.


Execução com Node 22.23.3 e dependências instaladas. O launcher Corepack desta
sessão aponta para `pnpm.cjs` ausente (cache tem `pnpm.mjs`); os scripts foram
executados diretamente via `node node_modules/...` sem alterar dependências.
Nos builds finais, um preload temporário limitou apenas o pool de workers de
compilação a dois, evitando saturação de memória; targets/loaders/minificação
continuam os do webpack do repositório. O preload não faz parte do aplicativo.


Os testes `tests/webosPhase5.spec.js` executam o conversor publicado e o
`WebOsVideo` real com DOM/Luna simulados. Eles cobrem teardown, loaded por episódio,
time/duration em ms, buffering, ended, code 83, isolamento de eventos, malformed
magnet, timeout/Err/retry e ações/controles TV versus desktop. Isto não comprova decode.

O scan i18n resolve o parser pela dependência declarada do Babel para funcionar
com o layout estrito pnpm; não requer hoist ou alteração de dependências.

TypeScript: 61 diagnósticos também presentes em uma cópia temporária de `git archive HEAD`.
Comparação de caminho/código/mensagem, normalizando posições: idêntica; nenhum diagnóstico novo.

Runtime interativo: CDP conhecido `127.0.0.1:9998/json` retornou connection refused.
T3 preview abriu tab, mas apresentou falha Electron `preloadScripts`/navegação de
localhost e environment-port. Nenhum smoke interativo ou execução Chromium 68
foi registrado como aprovado nesta sessão.

Verificador reutilizável de artefato:
`node tools/verify-webos-player.mjs build webos` (ou `desktop`). Ele verifica
presença da implementação, timer/reset/guard no source map emitido, versão pinada
e política do sender no HTML. O build webOS final emitiu efetivamente a correção.

Resultados finais dos gates: ver [resumo JSON](phase5/validation.json).

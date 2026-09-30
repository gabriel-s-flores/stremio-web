# Fase 5 — Matriz e roteiro nativo

Todos os resultados abaixo estão **pendentes de execução**. Não representam
suporte certificado. Usar mídia própria/licenciada e um servidor remoto autorizado.
Registrar modelo, firmware, EDID/saída HDMI, build, modo hosted/packaged, servidor,
codec/profile/level/bitrate, container, resolução/fps e hash da mídia.
URLs com tokens e magnets privados não devem ser incluídos nas evidências.

| ID | Amostra | TV/modelo e resultado | Duração mínima |
|---|---|---|---|
| F01 | MP4 H.264 + AAC, 1080p | pendente | 30 min |
| F02 | MKV H.264 + AAC, ≥2h | pendente; seek início/meio/fim | 30 min |
| F03 | MKV HEVC Main/Main10, 4K | pendente; UI FHD e decode UHD | 30 min |
| F04 | WebM/MKV VP9 | pendente | 30 min |
| F05 | AV1 | pendente; suporte depende do modelo, falha deve ser amigável | iniciar e registrar |
| F06 | AAC / AC3 / EAC3, duas faixas/idiomas | pendente; estéreo e surround | troca repetida |
| F07 | DTS / TrueHD com e sem EDID compatível | pendente; filtragem e fallback/transcoding | troca repetida |
| F08 | HDR10 / Dolby Vision, quando aplicável | pendente; saída real versus badge | 30 min |
| F09 | HLS direto / adaptativo | pendente; sem menu de velocidade | 30 min |
| F10 | Torrent legal via servidor remoto | pendente; peers/speed/progress | 30 min |
| F11 | Codec inválido/URL indisponível | pendente; erro, reload e outro stream | falha recuperável |

## Execução

1. Build webOS debug: confirmar `implementationChanged` contendo `WebOsVideo`
   no diagnóstico já existente. Repetir no normal/packaged, sem Cast sender.
2. Board → Configurar servidor → Streaming: digitar URL LAN HTTP(S), selecionar,
   status Ready, copiar URL (fallback visual se clipboard negar), Reload após falha.
   Testar também `#/settings?streamingServerUrl=<URL-encoded>` e confirmar o modal.
3. Executar F01/F09/F10 por ≥30 min cada, só com controle remoto. Registrar load,
   play/pause, time/duration/buffering, seek, ended e error. Sem teclado obrigatório.
4. Legendas externas SRT/VTT: escala/cor/fundo/outline/delay/offset e mudança ao
   ocultar controles; embutidas MKV: seleção Luna, `subtitlesTrackLoaded`, cores e
   tamanhos disponíveis. ASS/SSA: aviso e plain text quando conversível.
5. Áudio: selecionar duas faixas, confirmar som/idioma, EDID, surround e fallback.
6. Rede: desligar Wi-Fi durante reprodução, restaurar, testar buffering/erro e
   reload. Magnet indisponível deve limpar loading após 20s; reenviar para retry.
7. Resume salvo (ms), vídeo >2h com seek hold, pauseOnMinimize ao mudar app.
   Auto-next de três episódios, incluindo sair enquanto inicializa mediaId.
8. Medir vídeos/estilos restantes, heap antes/depois de cada episódio e memória
   nativa/GPU no hardware. `performance.memory` não mede decode/worker completo.
   Critério: sem crash, acúmulo de elementos ou crescimento persistente; comparar
   budgets do diagnóstico (heap JS de reprodução ainda precisa baseline nativo).
9. Play/Pause/Stop/FF/RW/cores, Back e mute; volume pelo SO. Azul não abre velocidade
   enquanto o spike estiver pendente. Testar retorno de menus/foco e outro stream.

## Spike de velocidade

Em uma versão diagnóstica isolada, emitir `setPlaybackSpeed(0.5/1/1.5/2)` para
progressivo, HLS e servidor remoto. Observar resposta Luna e avanço real de time
versus relógio monotônico (≥10s por taxa), áudio/sync e retorno a 1×. O valor
`lastPlaybackSpeed` sozinho não é evidência. Registrar modelo/protocolo e só então
introduzir capability por manifest/stream type para reabilitar menus/hold 2×.

## Aceite

- [ ] F01, F09 e F10 ≥30 min sem crash/memória fora do budget medido.
- [ ] Legendas externas/embutidas e seleção de áudio comprovadas.
- [ ] Binge de três episódios e resume/lifecycle aprovados.
- [ ] Decisão sobre velocidade apoiada por spike físico.
- [ ] Hosted e packaged no Chromium 68 e TV física.

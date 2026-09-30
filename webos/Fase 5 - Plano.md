# Fase 5 — Player, Vídeo e Streaming

Fonte: vault `../stremio/11 - Port webOS 5/Fase 5 — Player, Vídeo e Streaming.md`.
Branch: `t3code/implement-phase-5`, baseada no checkout `webos` desta sessão.

1. T5.1: preservar o selector publicado 0.0.96 e testar contratos/lifecycle;
   isolar eventos por instância do hook e limpar listeners no destroy.
   Corrigir timer de mediaId e reset de loaded no build webOS (versão pinada).
2. T5.2/T5.4/T5.10: mensagens de codec/rede, retry explícito e retorno à seleção
   de streams; retirar downloads/player externo/Cast da TV.
3. T5.3: orientação em Settings e Board, reutilizar configuração de URL e
   clipboard fallback existentes; verificar conversão real da biblioteca.
4. T5.5/T5.6: preservar wrappers HTML e seleção Luna; aviso para ASS/SSA;
   registrar estilos, áudio, EDID e formato por modelo no roteiro nativo.
5. T5.7/T5.9: velocidade nativa desabilitada até spike em hardware, volume pelo
   sistema na TV, mute preservado. Aplicar a mesma política a menus e atalhos.
6. T5.8/T5.11/T5.12: manter seek com commits limitados, resume em ms, binge,
   lifecycle e mídia já implementados, com regressão automatizada.
7. Executar testes, lint, desktop/webOS normal/debug/packaged e ES2018.
   Registrar matriz e roteiro de soak, sem fechar critérios de hardware sem prova.

Velocidade: a documentação oficial LG restringe velocidades diferentes de 1.0
em streaming adaptativo. `WebOsVideo` publica `lastPlaybackSpeed` antes de uma
resposta Luna, portanto esse valor não comprova suporte. Política provisória:
sem SpeedMenu/2× no player webOS até existir spike real progressivo/HLS.
Fonte: https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm

## Resultado final

Implementação concluída no código. 39 suítes / 742 testes, lint, quatro builds,
ES2018 e verificadores de artefato aprovados. Typecheck mantém os 61 diagnósticos
da base, com mensagens idênticas. O código emitido contém timer/reset e a correção
Loading→Ready/transportUrl. Critérios físicos e spikes permanecem pendentes.
Ver `tests/webos/Fase 5 - Evidências.md` e `tests/webos/phase5/validation.json`.

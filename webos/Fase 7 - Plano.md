# Fase 7 — Testes, performance e qualidade

Fonte lida: vault `../stremio/11 - Port webOS 5/Fase 7 — Testes, Performance e Qualidade.md`.

1. T7.1: executar Jest inteiro, complementar detecção de dispositivo; reutilizar
   suites comportamentais existentes de Back, teclas, clipboard e openExternal.
2. T7.2–T7.3: adotar E2E semi-manual no Chromium 68 do emulador via CDP bruto,
   conforme a compatibilidade comprovada em T0.2. Não baixar Chromium legado nem
   tratar browser moderno como prova webOS. Versionar roteiro e resultados.
3. T7.4: medir bundle raw/gzip e disponibilizar coleta CDP com budgets T0.6.
   Não otimizar efeitos ou polyfills sem uma medição que justifique a alteração.
4. T7.5: coletor de soak observacional (240 min playback) e setas sintéticas
   (480 min navegação), com heap a cada 30 min e contagem de exceções/crashes.
5. T7.6–T7.8: matriz de dispositivos, regressão desktop e roteiro de acessibilidade.

Aceite de runtime depende do app completo carregando em emulador 5.0 e TV 5.x.
TV não será pareada automaticamente, conforme decisão T0.2. Resultados ausentes
continuam pendentes; a infraestrutura entregue não encerra os gates de hardware.

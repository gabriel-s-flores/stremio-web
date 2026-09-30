# Fase 7 — Evidências e gates pendentes

Data: 30/09/2026. Checkout `/home/dev/Projects/stremio-web`, base webos
`d2201bea356f9b5cf7a19d29d553b93417db9c5b`. Node 22.23.3, pnpm 11.8.0.
Plano versionado: `webos/Fase 7 - Plano.md`; roteiro: `Fase 7 - Roteiro.md`.

## Implementação e validação

- T7.1: Jest inteiro verde, 40 suites / 754 testes. Novos casos de detecção
  webOS/ausência de navigator e regressão Windows/Android/iPad/Vision Pro.
  Suites existentes cobrem Back/prioridades/hold, teclas, clipboard e externos.
- Testes Node: 7 aprovados (empacotamento e qualidade), incluindo budgets ausentes,
  limites exatos, gzip recursivo e coleta indisponível sem falso positivo.
- `pnpm lint`: aprovado.
- T7.2: E2E semi-manual com CDP bruto do emulador; decisão fundamentada nos
  resultados de compatibilidade T0.2. Sem dependência nova de browser legado.
- T7.3/T7.6/T7.8: roteiro versionado com rotas, dispositivos, acessibilidade e
  critérios de aceite; resultados de hardware continuam explicitamente pendentes.
- T7.4: relatório por arquivo raw/gzip em `phase7/bundle.json` (packaged webOS)
  e `phase7/desktop-bundle.json`: webOS 24.039.246 bytes raw / 7.491.203 gzip;
  desktop 23.285.969 raw / 7.229.330 gzip. Não é medição de boot nem impacto
  isolado core-js.
- T7.5: coletor CDP com amostras a cada 30 min, heap, paint, métricas debug
  sanitizadas, exceções/crashes; modo observação e setas sintéticas sem OK/Back.
  Arquivos parciais persistidos. `assess` falha quando budgets estão ausentes.
- Build padrão aprovado com dois avisos de tamanho; packaged aprovado com 53
  referências locais, worker/WASM/SDK preservados. ES2018: 5/5 arquivos aprovados.

- T7.7: desktop reconstruído após webOS: 85/85 arquivos equivalentes por
  SHA-256, zero diferenças; normalizado apenas path temporário do source map
  Workbox pelo verificador existente. Isso não substitui regressão interativa.

## Runtime bloqueado

`phase7/runtime.json`: conexão CDP `http://127.0.0.1:9998` falhou (`fetch failed`),
exit 1, zero amostras. Não foi possível anexar ao app completo do emulador.
Não foram executados boot/TTI/FPS/memória no Chromium 68, E2E por rota,
soak 8 h / playback 4 h / 10 episódios, throttle/offline ou interação em TV.
O bloqueio WASM packaged descrito nas fases anteriores continua sem nova prova
que o resolva. `requiredMemory=384` permanece provisório.

TV real: sem pareamento/instalação nesta sessão; preservar decisão T0.2 de
instalação manual pelo desenvolvedor. webOS 4/6 informativos não executados.
Regressão interativa desktop e acessibilidade em distância de TV pendentes.
A fase entrega infraestrutura e verificações locais; aceite integral depende
 dos gates de runtime definidos no roteiro. Não declarar checklist 100% nem soak
sem leaks/crashes com base nestes resultados.

# Fase 6 — Evidências e limites

Fonte: vault persistente, Fase 6 — Empacotamento e Pipeline. Plano versionado:
[webos/Fase 6 - Plano.md](../../webos/Fase%206%20-%20Plano.md).

## Implementação

- T6.1: manifesto final `com.stremio.webos`, 1080p, Back próprio, assets,
  acessibilidade sem audio guidance. `requiredMemory=384` provisório (T7.4).
- T6.2/T6.4: build packaged verificado, staging separado, `.ipk` pela CLI,
  comandos deploy/launch/inspect/close por device. COMMIT_HASH, worker e WASM
  preservados; sem SW/updater/Cast/Apple auth e sem source maps no `.ipk`.
- T6.3: wrapper hosted LAN opcional, ID distinto, redirect para HTTP(S) validado.
  Smoke de rede/SW não executado; deploy público adiado.
- T6.5: versão emitida e script de sync: `5.0.0-beta.39` → `5.0.0`.
  Prereleases não distinguem versão LG; incremento de release externo é manual.
- T6.6: CI de produção adiada pela documentação; keystore de sideload não exigida.
- T6.7: assets oficiais derivados/comprimidos, dimensões 80/130/400 e 1920×1080.
  Ícone de loja preservado na fonte, excluído do staging de sideload.

## Validação local — 30/09/2026

- Dependências: pnpm 11.8.0, lockfile congelado; CLI oficial @webos-tools/cli 3.2.6.
- Jest: 39 suites, 742 testes aprovados.
- `pnpm lint`: aprovado.
- `node --test tests/webosPackaging.test.mjs`: 4 testes aprovados; fixture de CLI
  cobre preservação do build, omissão de maps, rejeição de SW e URLs hosted.
- `pnpm build`: aprovado com dois avisos de tamanho já existentes.
- Build packaged e verificador: aprovados, 53 referências locais, SDK/worker/WASM
  presentes e sem SW/updater. ES2018: 5/5 arquivos aprovados.
- CLI 3.2.6: `.ipk` packaged real gerado, 11.920.060 bytes / 82 arquivos.
  Inspeção de ar/data.tar.gz confirmou manifesto final, Back próprio, bundle main
  idêntico ao staging, ausência de maps/SW/Workbox/README.
- Wrapper hosted: `.ipk` gerado com URL de exemplo; não constitui smoke LAN.
- CLI no ARM64: Node 22.23.3 e 22.16.0 falharam no schema (`Unexpected token
  extends`, SIGSEGV); Node 20.19.2 gerou os pacotes. Build usa Node 22, launcher
  temporário da CLI usa Node 20. Somente logging de stack na instalação temporária
  da CLI foi alterado para diagnóstico; schema/empacotamento não foram alterados.
- `deploy:tv emulator` do pacote final: ECONNREFUSED em 127.0.0.1:6622.

- Desktop reconstruído após o ciclo de empacotamento: 85/85 arquivos equivalentes
  por SHA-256, sem diferenças; normalizado somente o path temporário do source
  map Workbox, conforme verificador existente. Configuração webpack e src não
  foram alterados nesta fase.

## Gates de runtime ainda abertos

A CLI lista `emulator` em `developer@127.0.0.1:6622`, mas a porta recusou a
conexão. Não há prova de instalação/launch do Stremio no emulador nesta sessão.
Intro/Board/core, playback, persistência localStorage após close/relaunch e Back
nativo permanecem abertos. T0.4 comprovou localStorage em probe file://, mas isso
não substitui o app final. Evidências antigas registram bloqueio WASM packaged;
o empacotamento não deve ser tratado como solução ou prova de boot desse core.
TV física, hosted HTTPS/SW, CI público e submissão de loja não foram executados.

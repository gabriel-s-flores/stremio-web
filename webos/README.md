# webOS Branch

> Branch de longa duração para o port do Stremio Web para **webOS TV 5** (Chromium 68).
> Criado a partir de `development`, conforme decisão **D9** das Decisões Arquiteturais do Port.

## Estratégia

Mesmo repositório + branch `webos` (opção "monorepo por flag", D9). O upstream oficial
(Stremio/stremio-web) continua sendo incorporado periodicamente — não é um fork hard.

## O que este branch carrega de diferente

As diferenças em relação a `development` ficam concentradas em:

1. **`src/common/Platform`** — módulo de plataforma (detecção/capabilities de `webos`).
2. **Webpack config condicional** — flag de build `WEBOS=1` (Fase 0, T0.7) com
   transpile/compatibilidade para Chromium 68.
3. **Esta pasta `webos/`** — assets do app para webOS (`appinfo.json`, ícones, scripts
   de empacotamento `ares-*`).
4. **Shims de entrada** — `src/index.webos.js` (se necessário), incluindo
   `core-js/stable` no entry (D3).

Nenhum código do app desktop é alterado fora desses pontos; o build normal deve
permanecer bit-a-bit igual quando `WEBOS` não está definida.

## Cadência de sync com o upstream

**Gatilho:** a cada tag `v5.0.0-beta.*` publicada no upstream (Stremio/stremio-web).

**Fluxo:**

```powershell
git checkout development
git fetch upstream --tags
git merge --ff-only upstream/development
git push origin development

git checkout webos
git rebase development
git push --force-with-lease origin webos
```

- O rebase mantém o histórico linear e os commits do port sempre no topo, fáceis de inspecionar.
- `--force-with-lease` é obrigatório após o rebase (histórico reescrito) e é seguro aqui
  porque há apenas um mantenedor.
- **Alternativa:** se um ciclo de rebase ficar conflituoso demais, usar
  `git merge development` naquele ciclo e registrar a exceção aqui neste README.

## Status das fases do port

| Fase | Descrição | Status |
|---|---|---|
| 0 | Fundação e Setup | 🟡 Em andamento (T0.1 concluída) |
| 1 | Build e Compatibilidade JS | ⬜ Pendente |
| 2 | CSS e Layout | ⬜ Pendente |
| 3 | Plataforma webOS | ⬜ Pendente |
| 4 | Navegação TV e Controle Remoto | ⬜ Pendente |
| 5 | Player, Vídeo e Streaming | ⬜ Pendente |
| 6 | Empacotamento e Pipeline | ⬜ Pendente |
| 7 | Testes, Performance e Qualidade | ⬜ Pendente |
| 8 | Distribuição e Lançamento | ⬜ Pendente |

Planejamento detalhado por fase e decisões (D1–D10): vault do projeto em
`obsidian/stremio/11 - Port webOS 5/`.

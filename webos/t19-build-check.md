# T1.9 - Gate de CI

## Escopo

O gate protege a branch `webos` contra regressao de sintaxe no bundle destinado ao
Chromium 68. O build webOS e o checker rodam no mesmo job antes do Jest, enquanto o
build desktop permanece no workflow separado.

## Workflow

| Item | Valor |
|---|---|
| Arquivo | `.github/workflows/webos-build-check.yml` |
| Job | `webos-build-check` |
| Push | branch `webos` |
| Pull request | destino `webos` |
| Execucao manual | somente na branch `webos` |
| Runner | `ubuntu-latest` |
| Node | `.nvmrc` (22) |
| pnpm | `11.8.0` |
| Dependencias | `pnpm install --frozen-lockfile` |

## Sequencia

```text
pnpm build:webos
pnpm check:webos-compat
pnpm test
pnpm lint
```

O checker percorre recursivamente `build/**/*.js`, exige `scripts/worker.js` e
retorna exit code diferente de zero quando qualquer artefato falha em ES2018.

## Validacao local

Executar a partir da raiz do repositorio:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm build:webos
corepack pnpm check:webos-compat
corepack pnpm test
corepack pnpm lint
```

Resultado local em 2026-09-06, branch `webos`, HEAD `c481b4e6`:

| Verificacao | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | Passou; pnpm 11.8.0 |
| `pnpm build:webos` | Passou; 2 warnings conhecidos de tamanho |
| `pnpm check:webos-compat` | Passou; 6/6 arquivos JavaScript ES2018 |
| `pnpm test` | Passou; 7 suites e 107 testes |
| `pnpm lint` | Passou |
| `pnpm build` | Passou; regressao desktop separada, 2 warnings conhecidos |

O primeiro run do GitHub Actions ainda deve ser registrado aqui com URL da
execucao e o SHA validado.

## Protecao de merge

A regra da branch `webos` deve exigir o status exibido pelo GitHub como
`webOS Build Check / webos-build-check`. A configuracao da regra e externa ao
repositorio e deve preservar a estrategia de rebase com `force-with-lease` enquanto
essa estrategia permanecer ativa.

# T0.7 - Regressao do build normal

Data: 2026-09-05

## Ambiente

| Item | Valor |
|---|---|
| Commit | `c481b4ee6204120b7f96df01bbbbe5eb28c82c31` |
| Node | `v22.18.0` |
| pnpm | `11.8.0` |
| Dependencias | `pnpm install --frozen-lockfile` |
| Variaveis | `WEBOS`, `WEBOS_DEBUG`, `COMMIT_HASH`, `SENTRY_DSN`, `SERVICE_WORKER_DISABLED`, `VERSION` e `DEBUG` removidas |

## Metodo

O baseline foi gerado a partir de um worktree limpo no mesmo `HEAD`. O candidato
usou o worktree com as alteracoes da T0.7. Os dois builds foram executados no mesmo
caminho fisico e com as mesmas dependencias, evitando diferencas de `COMMIT_HASH` e
de caminhos absolutos nos source maps.

```powershell
corepack pnpm build
corepack pnpm verify:build-equivalence -- --normalize-workbox-sourcemap <baseline> <candidate>
```

## Resultado

| Verificacao | Resultado |
|---|---|
| Arquivos no baseline | 85 |
| Arquivos no candidato | 85 |
| Diferencas funcionais | 0 |
| Diferenca de source map | `service-worker.js.map` |
| Resultado normalizado | `equal: true` |
| Diagnostico no build normal | ausente |

O Workbox gera `service-worker.js.map` a partir de um arquivo temporario com nome
aleatorio. O comparador normaliza somente esse caminho de 32 caracteres hexadecimais;
qualquer outra diferenca no mapa ou em qualquer outro arquivo faz a verificacao falhar.

O build debug foi validado separadamente com `verify:webos-debug` e contem a rota
`#/debug`, o runtime `__stremioWebosDebug` e os estilos de diagnostico.

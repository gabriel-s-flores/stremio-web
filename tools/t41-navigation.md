# Auditoria T4.1

Execute contra um **build webOS debug** em um alvo CDP existente:

```powershell
corepack pnpm build:webos:debug
node tools/t41-static-audit.cjs
node tools/t41-navigation-runner.mjs C:/caminho-fora-do-repo/t41-private.json
```

No emulador instalado localmente, `node tools/t41-prepare.mjs` serve `build/` na porta 8141 e instala/abre o app isolado `com.stremio.webos.t41`. Ele usa o endereço de host `10.0.2.2` do VirtualBox. Em outro terminal, `ares-inspect -d emulator com.stremio.webos.t41` informa a porta CDP. Mantenha ambos abertos durante a coleta. O script de preparação não é necessário para uma TV ou um app já instalado. Não execute builds que sobrescrevam `build/` durante uma coleta.

## Configuração privada

Não versione URLs de streaming, contas, storage, tokens, comandos de processos ou configurações autenticadas. O runner não grava texto de controles, valores de inputs, URLs de navegação, expressões de setup nem detalhes de exceções de página. Screenshots só são salvos com `allowScreenshots: true`; use dados de teste nesse caso.

Exemplo mínimo para validar o contrato dos controles reais da fixture; ele **não fecha a cobertura de rotas**:

```json
{
  "endpoint": "http://localhost:PORTA_DO_INSPECTOR",
  "targetHint": ":8141/",
  "browserCommandLine": "LINHA_REAL_DO_PROCESSO_NATIVO_OBTIDA_NO_EMULADOR",
  "allowScreenshots": false,
  "states": [{
    "name": "fixture-menu",
    "route": "/debug/focus",
    "baseReady": "!!window.__t41Fixture",
    "setup": "document.querySelector('[data-focus-case=menu] button').click()",
    "ready": "!!document.querySelector('[role=menu]')",
    "overlay": "[role=menu]",
    "rules": [{
      "selector": "[role=menuitem]",
      "kind": "safe",
      "expect": {
        "clicks": 1,
        "submits": 0,
        "effect": "!document.querySelector('[role=menu]') && window.__t41Fixture.menu === 1"
      }
    }]
  }]
}
```

`targetHint` deve identificar exatamente uma página. `browserCommandLine` é a linha real de argumentos do browser, obtida independentemente via SSH/processos do emulador; o runner rejeita `--user-agent`. Ele verifica V8 6.8, Chrome 68, viewport e escala visual 1, cruzando `visualViewport.scale` com `Page.getLayoutMetrics`. `devicePixelRatio` é registrado separadamente e não representa o zoom da página. Esse contrato de escala é o mesmo de `t28-layout-probe.js`. O WAM nativo reporta `product` vazio e acrescenta `WebAppManager` ao UA de páginas; essas duas particularidades são tratadas explicitamente. Nenhum comando CDP de alteração de UA ou métricas é enviado.

`diagnostic: true` permite continuar depois de uma falha de escala. Esse modo **sempre reprova o aceite**, mesmo quando todos os estados passam. Não normalize uma engine moderna para fazê-la parecer Chromium 68.

Cada estado precisa de um nome estável, rota completa, condição de prontidão e regras. Use `baseReady` para aguardar o conteúdo antes de `setup`; use `ready` para verificar o resultado. `setup` é JavaScript privado executado na página, por exemplo para abrir um overlay ou preparar dados sintéticos. A abertura por Enter deve também ser testada como ação segura no estado pai. Não substitua o fluxo real de autenticação por uma asserção constante.

Regras são avaliadas em ordem:

- `safe`: Enter é executado. Declare contagens exatas de `clicks` e `submits` e uma expressão booleana `effect` que verifique o efeito real. `before` pode guardar um contador anterior em memória. Contar apenas o evento click não comprova a ação da aplicação.
- `unsafe`: Enter não é executado; `reason` deve identificar a consequência, por exemplo remoção definitiva de um addon real. Não use uma regra genérica para declarar seguras superfícies sem teste.
- `deferred`: comportamento fora da T4.1, como edição detalhada de slider ou teclado virtual. Exige justificativa; o controle continua no grafo de foco.
- `structure`: contêiner/backdrop/propagação sem ação própria, com justificativa da classificação. Seus filhos continuam sendo inventariados.

Elementos sem regra continuam no grafo e reprovam a classificação. Disabled, invisíveis, guards e background de overlays ficam fora dos candidatos, mas uma transição que lhes entregue foco reprova a coleta. As opções roving de `ActionMenu` continuam com `tabIndex=-1` e são percorridas por suas próprias setas.

## Grafo, Enter e scroll

O probe inventaria controles nativos e handlers React delegados. A exploração parte do primeiro controle e envia as quatro setas via CDP. Cada ramificação restaura somente um estado já alcançado, incluindo scroll e seleção do input. Seleção é parte do estado porque o polyfill consome setas até o cursor alcançar a borda do texto. Nenhum conteúdo de input é gravado.

Cada teste seguro de Enter recarrega o estado e reproduz seu caminho por setas desde a origem. O evento CDP inclui `text: "\r"`, necessário para reproduzir a ativação nativa de links e buttons do C68. O runner não chama `.click()` para substituir o Enter sob teste.

`maxStates` (padrão 1500) limita uma coleta; atingir o limite antes de estabilizar reprova o grafo. Use dados finitos para testar listas extensas com repetibilidade. `keyDelayMs`, `waitMs` e `settleMs` ajustam esperas do alvo, sem alterar geometria nem UA.

Para comprovar scroll e carregamento incremental, acrescente ao estado:

```json
{
  "after": {
    "keys": ["ArrowDown", "ArrowDown", "ArrowDown"],
    "waitMs": 1000,
    "assert": "EXPRESSAO_QUE_COMPROVA_SCROLL_E_NOVOS_ITENS"
  }
}
```

Após a asserção, o runner refaz o grafo e os testes seguros de Enter. Identifique essa cobertura em `tags`; não marque lazy-load somente porque o grid foi renderizado.

## Cobertura de aceite

São exigidas as tags abaixo em estados aprovados. Use as rotas reais e os parâmetros privados necessários para detail/player:

- Rotas: `board`, `discover`, `library`, `continuewatching`, `calendar`, `detail`, `search`, `settings`, `addons`, `intro`, `player`.
- Dados: `episodes`, `streams`, `library-authenticated`, `continuewatching-authenticated`, `settings-urls`, `settings-add-form`.
- Addons: `addons-cards`, `addons-filters`, `addons-details`, `addons-share`, `addons-remove-confirm`.
- Player: `player-controlbar`, `player-options`, `player-speed`, `player-subtitles`, `player-audio`, `player-statistics`, `player-cast`, `player-sidedrawer`, `player-nextvideo`.
- Listas: `horizontal-scroll`, `grid-scroll`, `lazy-load`.

`shortcuts-modal`, `gamepad-modal`, `toast` e `update-banner` precisam ser testados quando disponíveis. Para ausência real, `unavailable` aceita `{ "tag": "...", "assert": "condição de ausência no alvo" }`. A ausência deve ser comprovada na página, não apenas descrita. Uma rota vazia, um redirect ou `/debug/player` não substituem Player com mídia nem biblioteca autenticada.

Relatórios: `tests/webos/t41-<estado>.json`, `t41-static-audit.json` e `t41-summary.json`. O campo `accepted` só é verdadeiro quando runtime, estados e cobertura passam. Screenshots representam estados selecionados ou falhas; inspecione-os junto aos dados de anel e clipping. A auditoria estática classifica contratos do código; ela não certifica conectividade ou equivalência desktop por si só.

Cada relatório novo contém sua data de coleta. `focusFailures` preserva a primeira geometria inválida de cada controle e o caminho por setas que a produziu; os retângulos no inventário final podem refletir uma posição de scroll posterior. `clippedBy` identifica os contêineres que recortaram o anel sem registrar textos ou URLs.

Tags de Player real exigem uma rota `/player/:stream`; `/debug/player` pode testar os componentes sem receber essas tags. Library/Continue Watching devem usar o caminho canônico, incluindo parâmetros de consulta emitidos pelo core, e uma asserção de prontidão específica. Um redirecionamento não verificado reprova o estado. `horizontal-scroll`, `grid-scroll` e `lazy-load` exigem `after.assert`.

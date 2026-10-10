# Back no webOS (F3.2)

O `appinfo.json` liga `disableBackHistoryAPI`, então o WebAppMgr **não** chama `history.back()` no
Back do controle: a página recebe um `keydown` com `keyCode` 461 e decide o que fazer. Este módulo é
o único lugar que trata essa tecla. Só entra no build webOS (`src/App/index.webos.js`); o desktop não
muda.

## Como uma tecla Back é tratada

Um listener de captura em `window` (instalado quando o módulo carrega, antes do React) pega o 461,
chama `preventDefault()` e `stopImmediatePropagation()` (nada mais vê a tecla: navegação espacial,
atalhos, listeners de Escape do upstream) e roda os handlers, da prioridade maior para a menor.
Dentro da mesma prioridade, o registrado por último roda primeiro. O primeiro handler que devolve
`true` consome a tecla e para a busca. `keyup`, `keypress` e o auto-repeat (tecla segurada) são
engolidos sem disparar nada: segurar o Back não desmonta a pilha inteira.

| Prioridade | Camada | O que faz |
|---|---|---|
| `KEYBOARD` (400) | `platform.js` | Teclado virtual aberto: tira o foco do campo, o que fecha o teclado (ver abaixo) |
| `HANDLER` (300) | `useBackHandler` | Handlers dos componentes (diálogo de saída; F4.3 e F4.1x daqui em diante) |
| `OVERLAY` (200) | `overlays.js` | Ponte para os overlays do upstream: fecha o de cima, um por toque |
| `ROUTE` (100) | `BackNavigation.js` + `routes.js` | Volta da página/rota; no Board, abre o diálogo de saída |

### Teclado virtual

Medido no emulador: com o teclado do sistema aberto, **o próprio sistema trata o Back** e esconde o
teclado; a página não recebe tecla nenhuma. O próximo Back já chega ao app e segue a pilha (fecha o
modal, volta a rota). O `PalmSystem.isKeyboardVisible` continua `true` depois disso, então a camada
acompanha a visibilidade pelos eventos `keyboardStateChange` (`detail.visibility`) e só usa o
`PalmSystem` antes do primeiro evento. A camada fica como garantia para um sistema que deixe o Back
para o app com o teclado aberto.

### Ponte de overlays (`overlays.js`)

Fecha o overlay do upstream que está por cima, pelo caminho que ele já tem, sem editar o
componente. A procura vale só para a rota visível (as rotas de baixo continuam montadas) e para o que
está em portal no `body`. Ordem (o primeiro encontrado é o fechado):

| Overlay | Como fecha | Por quê |
|---|---|---|
| `StreamingServerUrlModal` | Escape em `window` | O listener dele é em `window` |
| `ShortcutsModal`, `GamepadModal` | clique no backdrop | Escape em `document` também dispararia o atalho `exit` |
| `ContextMenu` | `mousedown` no container | idem |
| `ActionMenu` | Escape no item focado do menu | O handler é o `onKeyDown` do React no menu |
| `Popup` (NavMenu, menus de vídeo/stream, `Multiselect`), dropdown do histórico da busca, `MultiselectMenu` sem portal | "clique fora": `mousedown` + `mouseup` no `body`, e o foco volta para o rótulo | Só popups e dropdowns reagem; o `MultiselectMenu` sem portal não tem Escape |
| `ModalDialog`, `BottomSheet` (no `.modals-container` da rota) | Escape em `window` | Eles conferem se são o de cima; o loader do login não fecha e segura o Back |
| Menus e gaveta do Player | `mousedown` no container do Player | O Escape do Player (`exit`) fecha os menus **e** sai do Player no mesmo toque |
| Popup de próximo vídeo | clique em "dispensar" | O `closeMenus` do Player não fecha esse popup |

O `webos/tests/back/upstream.test.js` falha se algum desses caminhos mudar no upstream.

### Camada de rota (`routes.js`, `BackNavigation.js`)

1. Lista de streams de um episódio: clica no botão de voltar da própria lista (volta para os episódios).
2. `/` (Board) e `/intro`: abrem o diálogo de saída, qualquer que seja o histórico.
3. MetaDetails com origem guardada (`location.state.from`): volta para a origem com `replace`, como o
   botão de voltar da barra.
4. Demais rotas: `navigate(-1)` se `history.state.idx > 0`; senão, `getBackFallback()` com `replace`
   (o mesmo que `useGoBack`, e o que o Escape do Player faz).

Depois de navegar, novos Back na mesma localização são consumidos sem navegar de novo até a rota
mudar (no máximo 1 s): um `navigate(-1)` calculado com a localização antiga pularia uma tela.

### Saída

Diálogo próprio (`ExitDialog.js`), com o foco em **Cancelar** (sair por engano custa um boot inteiro
do app). Setas alternam os botões, OK aciona, Back cancela, e as outras teclas não chegam à página.
**Sair** chama `window.close()`, que encerra o app no webOS e libera a memória; se a janela continuar
aberta depois de 1 s, `webOS.platformBack()` leva ao launcher (o app fica suspenso, mas o usuário sai).

## API

```js
const { useBackHandler, backDispatcher, PRIORITY, BACK_KEY_CODE } = require('../../webos/back');
```

### `useBackHandler(handler, { enabled, priority, name })`

Hook para componentes React. Enquanto `enabled` (padrão `true`), `handler(context)` roda a cada Back,
antes da ponte de overlays e da rota. Devolva `true` para consumir a tecla; qualquer outro valor passa
para o próximo handler. Sempre roda o handler mais recente (não precisa de `useCallback`).

```js
// Modal com focus trap (F4.3): o Back fecha só este modal.
useBackHandler(() => {
    onCloseRequest();
    return true;
}, { enabled: open, name: 'addon-details-modal' });
```

- `priority`: padrão `PRIORITY.HANDLER`. Não use `KEYBOARD`, `OVERLAY` nem `ROUTE`: são das camadas.
- `name`: aparece no histórico (`window.__webosBack.history`); ajuda nos testes.
- `context.event` é o `keydown`; `context.detail` pode receber uma descrição do que foi feito.
- Ordem entre handlers da mesma prioridade = ordem em que os efeitos registraram (o último por
  cima). Num mesmo commit o React roda os efeitos dos filhos antes dos pais; abrir overlays um por
  vez (o caso normal) mantém a ordem certa.

Quando um overlay do upstream passar a usar `useBackHandler`, a entrada correspondente de
`overlays.js` pode sair (e o teste de contrato junto).

### `backDispatcher`

Instância única, exposta também em `window.__webosBack` para os testes no emulador e a tela de
diagnóstico (F3.6).

- `register(handler, { priority, name })` → função que remove o handler. Para código fora do React.
- `dispatch(context)` → nome do handler que consumiu, ou `null`. Usado pelo listener; útil em testes.
- `handlers` → `[{ name, priority }]` na ordem em que rodam.
- `history` → as últimas 20 teclas: `{ time, consumedBy, detail }`.

`createBackDispatcher()` (em `dispatcher.js`) cria instâncias independentes, para testes.

## Testes

- `pnpm test webos/tests/back`: despachante, regras de rota, teclado/saída e o contrato com o upstream.
- Emulador (depois de `pnpm webos:package`):
  `webos/tools/emu-run --timeout 15 -- node webos/tests/back/emulator/run.mjs <pasta>`. Usa teclas
  reais (`remote.mjs`) e confere, a cada Back, um único despacho, a rota, o `history.state.idx`, os
  eventos `popstate` e capturas de tela; no fim sai pelo diálogo (direita + OK) e confere que o app
  fechou.

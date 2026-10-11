# Modais e menus com o controle (F4.3)

Arquivos desta tarefa (o resto de `webos/lib/navigation/` é de outras tarefas):

| Arquivo | O que faz |
|---|---|
| `modals.js` | Foco dos overlays: entra, fica preso, volta ao fechar |
| `contextMenu.js` | Gatilhos de controle para os menus de contexto (tecla amarela e segurar o botão do ponteiro) |
| `ModalsNavigation.js` | Componente que instala os dois no app (`src/App/index.webos.js`, ao lado do `BackNavigation`) |

## Foco dos overlays (`modals.js`)

Os overlays do upstream não combinam entre si: `ModalDialog` e `Popup` usam `react-focus-lock`, mas só
levam o foco para dentro se alguém pedir (`autoFocus`); o `ContextMenu`, os menus do Player e a gaveta
não cuidam do foco. Só com setas (a navegação espacial parte de `document.activeElement`), o foco
fica na página **atrás** do overlay e o OK ativa algo que ninguém vê. O módulo cobre todos os overlays
do catálogo de `webos/back/overlays.js` (uma lista só, para o Back e para o foco), sem editar os
componentes:

1. **Entrar.** Quando um overlay abre e o último input foi uma tecla, o foco vai para o primeiro
   elemento focável que não seja campo de texto (o teclado do sistema não aparece sozinho); prefere
   `autofocus` e o item selecionado. Se o overlay ainda está montando (sem focáveis, ou
   `visibility: hidden` enquanto se posiciona), tenta de novo a cada 100 ms, até 2 s.
2. **Ficar preso.** Com o foco dentro, a seta anda só entre os focáveis do overlay (a busca do
   polyfill restrita a eles: `spatialNavigationSearch` com `candidates` e `container`); na borda a
   tecla é consumida e o foco fica. Mover o foco para trás do overlay também rolaria a página de baixo.
   Campos de texto mantêm as setas do cursor (decide o polyfill) e o `ActionMenu` cuida das próprias setas.
   Um foco que cai fora mesmo assim volta ao último elemento de dentro. Seta ou OK com o foco fora
   do overlay só trazem o foco para dentro: nunca agem na página.
3. **Voltar.** Ao fechar, o foco volta ao elemento que abriu o overlay (o `ModalDialog` e os menus do
   Player o largam no `body`). O elemento certo vem do histórico dos últimos focos, porque um modal
   com `autoFocus` coloca o foco dentro de si antes de ser notado.
4. **Ponteiro.** Depois de um evento de mouse confiável nada move o foco: clicar fora continua
   fechando popups do jeito do upstream. A primeira seta depois disso entra no overlay e é consumida.

5. **Overlay que não fecha na hora (dropdown sem portal).** O `MultiselectMenu` sem portal só perde o
   menu ao fechar: a raiz (rótulo + menu) continua no DOM. Um overlay conta como fechado quando deixa
   de estar aberto (`isOverlayOpen`), não só quando sai do DOM, e o foco volta ao gatilho.

Exceções: o diálogo do QR code da F3.4 (`ExternalLinkDialog`) é dono do controle (foco, teclas e Back
próprios): enquanto aberto, a camada não faz nada, nem puxa o foco de volta ao overlay que estiver
embaixo dele; ao fechar, o overlay de baixo reassume. O popup de "próximo vídeo" (canto da tela, aparece sozinho) e o dropdown de histórico da
busca (o foco fica no campo enquanto se digita) não prendem o foco.

Custo: um `MutationObserver` no `body` (só lista de filhos, sem atributos) que agenda uma checagem
16 ms depois da rajada, mais ouvintes de `focusin`/`keydown`/`mousedown`/`mousemove`. Uma checagem são
algumas chamadas de `querySelector`. Nada no boot.

Diagnóstico: `window.__webosModalFocus` (`current`, `lastInput`, `history`).

## Menus de contexto (`contextMenu.js`)

Os menus do upstream abrem com botão direito: o menu do episódio e o do stream (`mouseup` com
`button 2`), o `ContextMenu` do Player e o das variantes de legenda (evento `contextmenu`). Nenhum dos
dois controles tem botão direito e o long press do upstream ignora ponteiros do tipo mouse
(`Popup`: `pointerType !== 'mouse'`), que é o que o Magic Remote é.

**Decisão:** dois gatilhos que mandam os mesmos eventos de um clique direito (`mousedown`, `mouseup`,
`contextmenu`, `button 2`, no centro do elemento), então cada menu abre pelo próprio código:

- **Tecla amarela (405), com o foco no item** — controle de 5 vias. No Player, se nada sob o foco
  trata o evento, ele vai para o vídeo e abre o menu de opções do stream. Escolhida em vez do long
  press do OK porque o `Button` clica no `keydown` do Enter (o long press ativaria o item antes do
  menu aparecer) e porque o `remote.mjs` do emulador não segura tecla (não dá para testar). A
  sequência R-G-Y-B do diagnóstico (F3.6) continua valendo: um amarelo logo depois do verde (2,5 s)
  faz parte dela e não abre menu. Futuras teclas de cor do Player (F4.x/F5.x) precisam respeitar isso.
- **Segurar o botão do ponteiro (~0,6 s, sem mexer mais de 16 px)** — Magic Remote. O clique da
  soltura é engolido, mas só quando um menu tratou o evento (`contextmenu` voltou com
  `defaultPrevented`): segurar um botão comum continua clicando ao soltar. **Nunca sobre um slider**
  (seek bar, volume): o `Slider` do upstream encerra o arrasto em qualquer `mouseup` na `window`, de
  qualquer botão, então o clique direito sintético soltaria o arrasto de quem mira parado e depois arrasta.
  Não dispara se o aperto começou num `slider-container`, se o ponteiro está sobre um quando o tempo
  acaba, nem com um arrasto ativo (`active-slider-within` no `<html>`).

## Testes

- `pnpm test webos/tests/navigation` — `modals.test.js` (jsdom: entrar, preso, voltar, ponteiro, setas),
  `contextMenu.test.js`, `overlayRoots.test.js` (o catálogo de overlays).
- Emulador, um cenário por `emu-run`, depois de `pnpm webos:package`:
  `webos/tools/emu-run --timeout 15 -- node webos/tests/modals/emulator/run.mjs <pasta em $HOME> [menus|player|pointer]`.
  `menus`: popup do perfil, dropdown do Discover, modal de adicionar addon, dropdown do Settings e menu
  do episódio (amarelo): o foco entra, dez setas o mantêm dentro, o Back fecha e o foco volta.
  `player`: menu de contexto (amarelo) e menu de áudio no Player, com a reprodução a 1x.
  `pointer`: long press do Magic Remote por `Input.dispatchMouseEvent`. O `player` também segura o
  ponteiro 0,9 s no seek bar e arrasta (o seek tem que chegar a ~40 %).

## Pendências

- Os menus do Player (áudio, legendas, opções) ainda não abrem só com o controle: a barra de controles
  do Player não é alcançável pelas setas (tarefa de teclas de mídia/cores do Player). Aqui eles abrem
  pelo atalho de teclado do upstream; quando abrirem, o foco já entra e prende.
- O long press do OK (segurar a tecla) não foi implementado; só a TV real diria se o auto-repeat do
  Enter chega ao app.

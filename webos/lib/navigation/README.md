# Navegação pelo controle remoto

Tudo o que move o foco com o controle no build webOS (`WEBOS=1`; o desktop nunca carrega esta pasta).
As setas continuam no `spatial-navigation-polyfill` do upstream: cada parte só toma as teclas que sabe
resolver melhor e devolve o resto (`null`) ao polyfill. Escrita em paralelo pelas F4.1a (Board, Discover,
Busca), F4.1b (Library, Calendar, Addons, Settings, barra lateral), F4.1c (Detalhes) e F4.3 (modais e
menus); a F4.4 juntou o que era comum num núcleo (`core/`) e deixou as telas como descrições finas.

## Mapa

| Arquivo | O que faz |
|---|---|
| `core/dom.js` | Elemento focável (tab index, habilitado, renderizado com área), primeiro focável, campo de texto, nomes de classe dos CSS modules (`<local>-<hash>`) |
| `core/routes.js` | Rota visível (as de baixo ficam montadas com `display: none`), foco perdido, barras de navegação, modal aberto |
| `core/scroll.js` | Rolar uma lista até o elemento com margem, convertendo os pixels de tela (zoom 1,75 da F2.6) nos pixels CSS do `scrollTop` |
| `core/memory.js` | O que vale lembrar (nem barras nem modais), lugar na árvore (`pathOf`), localizador por link/rótulo/posição, memória por chave (LRU) |
| `core/input.js` | **O hub**: um `keydown` e um `focusin` de captura para todas as partes, em ordem de prioridade, e o modo de entrada (tecla × ponteiro) |
| `core/screenFocus.js` | **O motor de foco de uma tela**: foco inicial com espera e fallback, restauração ao voltar, recuperação, memória, setas da tela |
| `core/lists.js` | Listas roláveis (Library, Calendar, Addons, Settings): busca em todos os itens, rolagem com margem, saída lateral |
| `withScreenNavigation.js` | O lado React do motor: embrulha o componente da rota no `index.webos.*` de cada tela |
| `board.js`, `search.js`, `discover.js` | Descrições do Board e da Busca (faixas de linhas) e do Discover (grade) |
| `screens.js` | Descrições de Library, Calendar, Addons e Settings (sobre `core/lists.js`) |
| `metadetails.js` | Detalhes (coluna, episódios, streams), ligado por `src/routes/MetaDetails/MetaDetails.webos.js` |
| `modals.js` | Foco dos overlays: entra, fica preso, volta ao fechar |
| `contextMenu.js` | Menus de contexto pelo controle (tecla amarela, segurar o ponteiro) |
| `sideBar.js` | RIGHT da barra lateral de volta ao item de onde se saiu, em qualquer tela |
| `RemoteNavigation.js` | Componente montado uma vez (`src/App/index.webos.js`, ao lado do `BackNavigation`): instala modais, menus de contexto, barra lateral e o realinhamento do zoom |

## O núcleo

### Um hub de entrada (`core/input.js`)

Um só ouvinte de `keydown` (captura, na `window`) e um só de `focusin` (captura, no `document`) para tudo,
instalados com o primeiro manipulador e removidos com o último (nada no boot). A captura na `window`
roda antes do polyfill (que ouve a `window` em bolha): quem move o foco chama `preventDefault()` e o
polyfill pula a tecla. O dispatcher do Back (`webos/back`) se registra antes, na importação, e não deixa
o Back chegar aqui.

Os manipuladores de tecla rodam por prioridade e, empatados, na ordem em que entraram. Um manipulador
que devolve `true` para os seguintes (e chama `stopImmediatePropagation()` quando a tecla não pode chegar
a mais nada, polyfill incluído):

| Prioridade | Quem |
|---|---|
| `overlay` (10) | `modals.js`: com um overlay aberto, as setas ficam nele; tecla com o foco atrás só traz o foco para dentro (e para tudo) |
| `colorKeys` (20) | `contextMenu.js`: a tecla amarela |
| `global` (30) | `sideBar.js`: RIGHT da barra lateral |
| `screen` (40) | o motor de cada tela montada (seta com o foco perdido) e `metadetails.js` |

Fora do hub restam estes ouvintes (conferido em `grep addEventListener webos/lib/navigation`):

- o `keydown` das telas no próprio contêiner (as setas que a tela conhece, ver abaixo): em bolha, ou **em
  captura** nas telas de lista (`capture: true` em `screens.js`: Library, Calendar, Addons e Settings), para rodar antes das
  teclas dos dropdowns abertos; ainda depois do hub, que está na `window`;
- o **rastreio de entrada de Detalhes** (`installInputTracking`, em `metadetails.js`): um `keydown` e um
  `mousedown` **de captura na `window`**, mais um `cursorStateChange` no `document`, instalados **uma vez por
  janela** (`window.__webosMetaDetailsInput`) e nunca removidos. Só leem (guardam `keys` ou `pointer`, o
  `mousedown` só se confiável) e não chamam `preventDefault()` nem param a tecla. É a exceção ao "um só
  `keydown` de captura": o hub não serve a Detalhes (ver **Modo de entrada**);
- o `keydown` em bolha de Detalhes (depois do polyfill) e o `navnotarget` de Detalhes, na `window`;
- o gesto de segurar o ponteiro do `contextMenu.js` (`mousedown`, `mousemove`, `mouseup` e `click` em
  captura, `blur`, `cursorStateChange`) e o `resize` do `RemoteNavigation.js`.

**Modo de entrada.** Tecla, ponteiro (um `mousedown`/`mousemove` confiável) ou o cursor do Magic
Remote (`cursorStateChange`). `pointerInUse()`: o atributo `data-webos-pointer="visible"` da F4.2 ou,
antes do primeiro `cursorStateChange`, a última tecla ou clique ter sido do ponteiro. **Um `mousemove`
sozinho não conta:** o Chromium manda `mousemove` confiáveis quando o layout se mexe sob um cursor parado,
e as telas pulariam alinhamento e recuperação sem ninguém tocar no ponteiro. Os overlays (`isKeyInput`)
continuam contando o movimento, como na F4.3. Detalhes mantém o rastreio de entrada próprio da F4.1c (o
mesmo critério, sem o movimento): com o modo ponteiro do hub, o renderer guardava ~15 MB a mais depois da
2ª abertura de Detalhes no perfil c8 (revisão c1 da F4.4; a bissecção está no relatório). Com o ponteiro em uso nada
rola listas nem tira o foco do lugar (a exceção é o realinhamento depois de mudar o zoom da interface,
como a F4.1b fazia). `cursorStateChange` com `visibility: false` volta ao modo tecla, também para os
modais (antes eles só voltavam com uma tecla).

### O motor de foco de uma tela (`core/screenFocus.js`)

Um por tela montada, no `.route-content` da rota (`withScreenNavigation.js` cria e destrói). Vale só
enquanto a rota é a visível e nenhum modal está aberto sobre ela.

- **Foco inicial**: a tela montada sem foco recebe o primeiro item assim que ele aparece (o Board espera
  os catálogos do core, ~30 s no perfil c8). Depois de `fallbackDelay` vai um fallback (os filtros acima
  da lista), que cede lugar ao item quando ele chega, se o usuário não assumiu (uma seta ou OK, o foco
  movido; as pseudo-teclas 1536/1537 que o webOS manda quando o cursor do Magic Remote aparece ou some não
  contam). A espera acompanha as mutações da tela e para no `timeout`. Um fallback que só aparece depois da
  montagem também entra (o Discover reaberto pela barra ficava com o foco no `body` mais de 3 s).
- **Restauração**: as telas ficam montadas sob as que se abriram a partir delas (`src/router/Routes.tsx`).
  Quando outra rota cobre a tela, o motor tira um retrato do foco (`leave`); quando o Back a traz de volta,
  o elemento volta a ter o foco, ou o que está no mesmo lugar da árvore se ele foi re-renderizado
  (`restore`), mesmo que a tela tenha focado outra coisa sozinha (o campo da Busca).
- **Recuperação**: o elemento focado sumiu (linha trocada, lista recarregada, filtro aplicado) ou uma seta
  chegou sem foco: o foco volta à tela, não ao `body` (de onde o polyfill recomeça do canto). Pelo
  `focusout`, por uma mutação que levou o elemento lembrado junto (o Chromium 53 pode largar o foco de um
  elemento removido sem evento) e por uma troca de localização na mesma tela (filtro, ordenação).
- **Memória**: o último elemento focado da tela, **sem a barra lateral e sem os modais** (`isMemorable`):
  sair pela barra lateral e voltar cai no conteúdo. A barra de cima só nas telas com `rememberTopBar`
  (Board, Discover, Busca: o Back da Busca volta ao botão de busca, como na F4.1a); as de lista voltam ao
  conteúdo (F4.1b). `memory.lastContent` é o mesmo sem barra nenhuma: é para onde o RIGHT da barra lateral
  volta (nunca à barra de cima, onde o botão ao lado do campo da Busca é o X que limpa a consulta).
- **Setas**: a tela toma as que conhece (`navigate`) no próprio contêiner, em bolha (depois dos
  manipuladores do elemento focado) ou em captura (`capture: true`: antes deles, para os dropdowns
  abertos e o range do zoom de Settings, que para a propagação das setas).

A descrição de uma tela (todas as chaves menos `initial` são opcionais):

| Chave | O que é |
|---|---|
| `initial(container, { recovering })` | o elemento do foco inicial, ou `null` enquanto não há; `recovering` quando é para um foco perdido depois (a Busca evita o campo) |
| `fallback(container)`, `fallbackDelay`, `timeout` | o elemento enquanto o inicial não vem, quanto esperar por ele antes do fallback e no total |
| `path` | `false` quando o mesmo lugar da árvore pode guardar outra coisa (uma lista trocada por outra) |
| `navigate(target, dir, container, memory, event)` | um elemento para focar, `true` para engolir a seta ou `null` para o polyfill; `memory.last`, `memory.lastContent` (sem barras) e `memory.content` (o último dentro das listas) |
| `rememberTopBar` | a memória do Back guarda também a barra de cima |
| `capture` | `navigate` na fase de captura do contêiner |
| `isContent(element, container)` | o elemento está nas listas da tela (`memory.content`) |
| `align(element, container)` / `realign` | rolar as listas até o elemento focado, a cada foco (não com o ponteiro em uso) / depois de um resize (o zoom de Settings, também pelo ponteiro) |
| `onMutation(container)` | o conteúdo da tela mudou |

Diagnóstico: `window.__webosNavigation` (`status.last`: o último foco que um motor pôs; `hub`;
`screen()`: o motor da rota visível). `window.__webosNavigationF41b` é o mesmo objeto (o roteiro da F4.1b
espera por ele).

### Custo

Nada roda no boot: os ouvintes entram com o primeiro manipulador (o motor do Board, que monta com o app)
e o `RemoteNavigation` só instala. Por tela montada, um `MutationObserver` no conteúdo (lista de filhos)
cuja checagem, fora da espera do foco inicial, é `contains()` do elemento lembrado. A busca do motor só
acontece durante a espera do foco inicial (como antes, na F4.1a). O `onMutation` do Board e da Busca sai
na hora sem espiada pendente (as mutações chegam em rajadas enquanto os catálogos carregam). O hub não
guarda nada além das listas de manipuladores.

**Fora do núcleo (F8.2).** Na TV cada seta levava ~370 ms até o foco aparecer, com o perfil de CPU tomado
por `focus()` e `getClientRects`. O núcleo não era a causa: o polyfill de `:focus-within`
(`postcss-focus-within/browser`) tirava e repunha o atributo `[focus-within]` em toda a cadeia de
ancestrais, até o `<html>`, a cada `focus`/`blur`, e cada troca num ancestral invalidava o estilo de todos
os pôsteres da página. Isso forçava um recálculo inteiro dentro do `focus()` e na primeira leitura de layout
depois dele (o `align` do Board). Hoje o polyfill é o `webos/polyfills/focus-within.js`, que só mexe nos
nós que entram ou saem da cadeia. O resto vinha da transição de 100 ms do zoom do pôster: animar o
`transform` repintava ~25 pôsteres por quadro (sem transição desde a F8.2, `webos/styles/app.less`). No
perfil c8 do emulador (A/B intercalado, medianas finais de todas as rodadas), a seta foi de 697 a 32 ms até
o 2º quadro e de 297 a 7 ms até o foco. Medição: `webos/tests/perf/keys.mjs`.

## As telas

### Board e Busca (`board.js`, `search.js`)

A lista é um rolador vertical de linhas; no build webOS cada linha mostra os 10 itens numa faixa
horizontal que rola (`webos/styles/strips.less`).

- LEFT/RIGHT andam na faixa; LEFT no primeiro item fica com o polyfill (a barra lateral), RIGHT no último fica.
- UP/DOWN vão à linha mais próxima com itens, na mesma coluna da tela. Linhas de mensagem (erro de addon)
  são puladas. Uma linha ainda carregando aparece por 8 px (o `useVisibleCatalogs` só a carrega se ela
  aparece) e o foco espera. Com o zoom 1,75 uma linha focada pode ser mais alta que a lista: espiar a
  seguinte tira o título da linha focada de vista, então, quando a linha espiada termina de carregar (itens
  ou erro), a linha focada é alinhada de novo, com o título.
- A linha focada vai ao topo da lista, com o título; a faixa rola só o bastante para mostrar o item.
- UP da primeira linha vai à barra de cima (busca, perfil), pela busca do polyfill restrita aos botões
  dela: a barra lateral, focável desde a F4.1b, fica mais perto do primeiro pôster e tomava esse UP.
- DOWN da barra de cima volta ao conteúdo: o item de onde se veio, ou o primeiro da primeira linha na tela.
- Busca: UP da primeira linha vai ao campo (o `tabIndex` dele é -1 no upstream; o polyfill ia ao botão ao
  lado). DOWN do campo vai aos resultados; com o menu de histórico aberto, entra no menu, e DOWN no último
  item segue aos resultados fechando o menu. A recuperação nunca escolhe o campo (focar abre o teclado do
  sistema): com o campo vazio, a lupa; **com uma consulta, o botão ao lado é o X que limpa a busca**, então
  o foco espera o primeiro resultado da consulta.

### Discover (`discover.js`)

Grade que quebra linha num rolador vertical, filtros acima, painel de prévia à direita. LEFT/RIGHT numa
linha da grade (nas pontas, o polyfill); UP/DOWN na mesma coluna; UP da primeira linha ao filtro acima;
DOWN na última rola até o fim (carrega a próxima página) e o foco espera; DOWN dos filtros ou da barra de
cima volta à grade. Foco inicial no primeiro item; enquanto o catálogo não vem, o primeiro filtro.

### Library, Calendar, Addons e Settings (`screens.js`, `core/lists.js`)

Foco inicial no primeiro item (pôster, addon, dia do calendário, entrada selecionada do menu de Settings;
"Log in" do placeholder de convidado em Library e Calendar), esperando 1,5 s pela lista antes dos filtros.
Nas listas, UP/DOWN procuram entre todos os itens (não só os visíveis) e rolam com margem de 15 %; sem item
na direção, a lista rola 60 % da altura; DOWN no fim fica, UP no topo sai pelo polyfill. LEFT/RIGHT na
fileira visível; sem nada, o elemento visível mais próximo fora da lista (em Settings, a entrada
selecionada do menu), nunca a barra de cima; RIGHT do menu de Settings volta à linha de onde se saiu. Um
dropdown aberto é uma lista própria para UP/DOWN. Depois de mudar o zoom da interface, o item focado volta
para dentro da lista.

### Detalhes (`metadetails.js`)

Seções (barra, coluna de informações, lista de episódios ou streams) como contêineres da navegação
espacial; o `navnotarget` decide a passagem entre elas. Foco inicial no episódio selecionado ou, numa
lista de streams, no painel da lista (um stream focado congela a ordem do ranking da C8, F6.2). Do painel,
DOWN/RIGHT/OK entram no primeiro stream, LEFT vai à coluna e UP ao cabeçalho da lista (o filtro de addons
e o voltar dos streams de um episódio); **com um addon só não há cabeçalho e o foco fica** (antes ia ao
"Install addons" do fim da lista). Voltar à página restaura o último foco dela (memória por caminho, entre
montagens), esperando enquanto a seção ainda é placeholder (até 15 s); **o placeholder que segura é o da
coluna (`MetaPreview.Placeholder`)**, não o nome no lugar do logo de um título sem logo. **Ao sair do
Player**, o nó dele fica no lugar por 1,5 s (`holdVideosInPlace`, F5.6) e cobre a página, sem mutação
nela quando sai: enquanto a página não tem caixa, a restauração tenta de novo a cada 250 ms, dentro da
mesma guarda, e o foco volta ao stream tocado. A restauração tardia nunca acontece com o ponteiro em uso
nem depois que o foco se moveu. O resto (rolagem com margem,
resumo alcançável, toggles com OK) está no cabeçalho do arquivo.

### Overlays e menus (`modals.js`, `contextMenu.js`)

#### Foco dos overlays (`modals.js`)

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
16 ms depois da rajada. Teclas, foco e modo de entrada vêm do hub (`core/input.js`). Uma checagem são
algumas chamadas de `querySelector`. Nada no boot.

Diagnóstico: `window.__webosModalFocus` (`current`, `lastInput`, `history`).

#### Menus de contexto (`contextMenu.js`)

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

### Barra lateral (`sideBar.js`)

Os botões da barra são focáveis no build webOS (`NavTabButton.webos.js`): LEFT da primeira coluna chega a
ela pelo polyfill. RIGHT volta ao item do conteúdo de onde se saiu (`memory.lastContent` do motor da rota
visível, nunca a barra de cima); sem memória, ao conteúdo pela busca do polyfill restrita a ele; sem nada focável no conteúdo (a Busca vazia), o foco fica na barra. O botão do perfil
também é focável (`NavMenu.webos.js`); o menu dele é um overlay de `modals.js` (o foco entra no primeiro item).

## Testes

- `pnpm test webos/tests/navigation`: `core.test.js` (o núcleo), `f4.1a.test.js` (Board, Discover, Busca e
  o motor), `screens.test.js` (Library, Calendar, Addons, Settings e a barra lateral), `metadetails.test.js`,
  `withScreenNavigation.test.js`, `remoteNavigation.test.js`, `modals.test.js`, `contextMenu.test.js`,
  `overlayRoots.test.js`, `f4.1b-overrides.test.js`, `f4.1b-color-input.test.js`. O jsdom não tem layout:
  cada arquivo simula as caixas (`getClientRects`/`getBoundingClientRect`).
- Emulador, um cenário por `emu-run`, depois de `pnpm webos:package` (os roteiros-contrato da F4.4):
  - `node webos/tests/navigation/emulator/f4.1a.mjs <saída> board|discover|search`;
  - `node webos/tests/navigation/f4.1b/run.mjs <saída> guest|library`;
  - `node webos/tests/navigation/metadetails/emulator.mjs <saída> walk|player` e `restore` (com `--profile c8`);
  - `node webos/tests/modals/emulator/run.mjs <saída> menus|player|pointer`;
  - `node webos/tests/back/emulator/run.mjs <saída> navigation|screens` (o Back, F3.2/F3.2b);
  - `webos/tests/screens/visual.sh check <saída>` (regressão visual da F2.7).

## Pendências

- Os menus do Player (áudio, legendas, opções) só abrem pelo atalho de teclado do upstream: a barra de
  controles do Player é da F5.7. Quando abrirem pelo controle, o foco já entra e prende.
- O long press do OK (segurar a tecla) não foi implementado; só a TV real diria se o auto-repeat do Enter
  chega ao app.
- Detalhes continua com o próprio motor (`metadetails.js`): seções, painel de streams e restauração entre
  montagens são da página; o genérico (focáveis, rolagem, localizadores, memória, teclas, modo de entrada)
  vem do núcleo.

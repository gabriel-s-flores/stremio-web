# Controle remoto no Player (F5.7)

Seek, play/pause, teclas de mídia, barra de controles navegável e Back no Player, com o controle comum
e com o Magic Remote. Só entra no build webOS: o `ControlBar.webos.js` (override que já tirava o
botão de velocidade, F5.1) monta o controlador. O `Player.js` do upstream não é tocado.

| Arquivo | O que faz |
|---|---|
| `keys.js` | Tecla → ação (códigos LG e nomes `key` de mídia) |
| `controller.js` | O que cada tecla faz no Player (listeners de captura em `window`, Back) |
| `usePlayerRemote.js` | Hook usado pelo `ControlBar.webos.js`: instala o controlador e o handler de Back |
| `index.js` | `makeFocusable`: os botões que o upstream tira da ordem de tab (`tabIndex -1`) ficam focáveis |

## Teclas

O controlador só age com o Player na rota visível e, para setas e OK, sem overlay aberto (menus de
áudio/legendas/opções, gaveta de episódios, menu de contexto, modais: o foco e as setas deles são da
F4.3, e o Back fecha cada um pela ponte do `webos/back`). Com um overlay aberto, a seta que a F4.3 já
usou para mover o foco (ela faz `preventDefault`) **para aqui**: os atalhos do upstream (`volume`,
`seekForward`/`seekBackward`, em `document`, que não olham `defaultPrevented`) e a navegação espacial
não a recebem. Sem isso, com o menu de contexto aberto (tecla amarela), ↑/↓ no menu mudavam o volume
do vídeo atrás dele e ←/→ faziam seek: o `menusOpen` do Player não conhece o `ContextMenu` (achado da
revisão do ciclo 1; também na base). Setas que a F4.3 deixa para o próprio overlay (não prevenidas)
seguem adiante. O popup de "próximo vídeo" não conta como overlay aqui: ele não prende o foco.

| Tecla | Barra escondida (ou foco fora dela) | Foco no seek bar | Foco num botão da barra | Foco no popup de próximo vídeo |
|---|---|---|---|---|
| OK | play/pause; foco no play/pause | play/pause | aciona o botão (o `Button` do upstream clica no Enter) | aciona o botão |
| ← → | seek de 10 s pelo upstream; foco vai para o seek bar | seek de 10 s (com o popup de próximo vídeo aberto: nada, ver abaixo) | anda entre os botões (para nas pontas) | dispensar ↔ assistir |
| ↑ | mostra a barra; foco no último botão usado (ou play/pause) | vai para o popup, se estiver aberto | seek bar | fica |
| ↓ | idem | último botão usado (ou play/pause) | fica | seek bar |
| PLAY (415) / PAUSE (19) / `MediaPlayPause` | toca / pausa / alterna, em qualquer estado (também com menu aberto) | | | |
| FF (417) / RW (412) | seek de 10 s, com aceleração ao segurar, igual às setas (com menu ou popup de próximo vídeo aberto: nada) | | | |
| STOP (413) | sai do Player pelo despachante do `webos/back` (`dispatch({ source: 'stop' })`) | | | |
| `MediaTrackNext` | próximo episódio (o controle LG não tem essa tecla; vale para outros controles e teclados) | | | |
| qualquer outra | mostra a barra e segue (cores, números: o amarelo abre o menu de contexto da F4.3) | | | |

Com o foco num elemento do popup ou fora de tudo e o popup aberto, a primeira seta leva o foco para
"assistir". O upstream já põe o foco lá quando a animação do popup termina.

**Seek com o popup de próximo vídeo aberto** (últimos ~35 s): o upstream desliga o seek por teclado
enquanto ele está na tela (`menusOpen` inclui o popup). FF/RW e ←/→ no seek bar não fazem nada
(`status.result` = `none`); o Back dispensa o popup e o seek volta. O arrasto do Magic Remote no seek
bar continua valendo.

**Seek.** É o do upstream (`useKeyboardSeek`, pelos atalhos `ArrowLeft`/`ArrowRight`): passo de
`settings.seekTimeDuration` (10 s), e, segurando a tecla, o passo cresce 5 % a cada repetição aceita
(até 10 % da duração). O alvo aparece no seek bar (posição e tempo) enquanto a tecla está segurada e
só é aplicado no `keyup`: segurar não dispara um seek por repetição. FF/RW chegam a ele como setas
sintéticas (marcadas, `keydown` com o `repeat` da tecla real e `keyup` na soltura). Sem o `keyup` (foco
perdido, evento perdido), o controlador solta a tecla sozinho depois de 1 s, senão o alvo ficaria na
tela sem ser aplicado. No emulador o seek cai no keyframe anterior (PESQUISA §7).

**Seek no perfil c8 do emulador** (`seek-probe`, arquivo 1080p do e2e da F6.4, GOP de 1 s). O alvo
aplicado é sempre o pedido (+10 s por toque, ao keyframe anterior). O que reduz o "salto líquido"
(`avanço − tempo decorrido`, a métrica do e2e) é: (1) **o `keydown` do segundo toque rápido não chega à
página** em 6 de 7 rodadas (só o `keyup` dele chega, 100–500 ms depois do primeiro; com 1,7 s entre os
toques os dois chegam): a tecla se perde antes de qualquer listener do app, no sistema do emulador com a
CPU limitada, então um toque vale −10 s; (2) cada seek para a reprodução por ~3 s no c8
(`seeking`→`seeked` 1,5–2,6 s e a retomada), tempo que a métrica conta como perda. Juntar toques num
seek só não recupera um `keydown` perdido, e tratar `keyup` órfão como toque arriscaria ações dobradas:
nada mudou no app. **Fase 8:** conferir na C8 se dois toques rápidos de → chegam ao app e quanto um seek
para a reprodução (decodificação por hardware, link de debrid).

**Volume.** ↑/↓ não mexem mais no volume do `<video>` (atalho `volume` do upstream): na TV o volume é
o do sistema, nas teclas próprias do controle.

**Barra.** Aparece com qualquer tecla e some 3 s depois da última, como com o ponteiro: o
controlador manda um `mousemove` para o container do Player, o mesmo caminho do mouse (o Magic Remote
ignora eventos não confiáveis). Pausado, o upstream mantém a barra sempre visível. O foco movido pelo
controle ganha o anel de foco da F2.6 mesmo quando a última entrada foi o ponteiro (o polyfill de
`:focus-visible` só vê a tecla no listener dele, que roda depois deste).

## Back

`useBackHandler` (`player-controls`, prioridade `HANDLER`): com a barra visível e o vídeo tocando,
o Back esconde a barra (o `onTouchEnd` que o Player dá à barra é o `onContainerMouseLeave`) e fica no
Player. Nos outros casos passa adiante: com menu, gaveta ou popup aberto, a ponte de overlays fecha
o de cima; pausado ou com a barra escondida, a camada de rota sai do Player. O STOP pula este passo
(`context.source === 'stop'`), mas um menu aberto ainda é fechado antes pela ponte.

## Próximo episódio

O popup e o botão "próximo" da barra chamam o `onNextVideoRequested` do upstream; com o `bingeGroup` igual
nos dois episódios o core monta o deep link do Player e o próximo toca direto (senão, abre a lista de
streams dele). Com o guarda de pipeline da F5.6, o episódio novo começava na posição do anterior (o
`time` do `<video>` segurado chegava ao core como posição do novo): corrigido no `useVideo.webos.js`
(ver `webos/lib/player/README.md`, "O tempo do stream que sai").

## Saída do Player e o foco

Quando o Player abre, a rota de baixo (Detalhes, Board) vira `display: none` e perde o foco (o stream
tocado). Na saída, o guarda da F5.6 segura o nó do Player, escondido, por ~1,5 s; enquanto ele é o último
filho, a rota de baixo continua escondida, e a restauração da página (F4.1c) tenta uma vez só e não pega.
O resultado era o foco no `<body>` ao voltar do Player (também na base; a F5.7 tornava isso sistemático
porque o foco fica na barra). Por isso `usePlayerRemote.js` acompanha o último elemento focado na página
(`focusin` em captura); ao montar, o controlador guarda esse elemento (o stream) e, ao sair, tira o foco da
barra e o devolve ao stream, tentando a cada 100 ms por até 3 s, até a rota de baixo reaparecer (com o anel,
salvo com o ponteiro do Magic Remote em uso). `window.__webosPlayerRemoteLast` (`entry`, `exit`) diz o que
aconteceu. Cenário de emulador: `exit-focus`.

## Magic Remote

Os eventos de mouse continuam com o upstream: o ponteiro mostra a barra, clica nos botões e arrasta o
seek bar (o `Slider`). Quando o ponteiro some (primeira seta), o `webos/magic-remote` põe o foco no
elemento sob ele, que agora pode ser um botão da barra ou o seek bar (`tabIndex 0`), e a seta segue as
regras acima.

## Por que assim

- **Sem override do `Player.js`** (1.100 linhas; override substitui o arquivo inteiro). A barra já
  recebe do Player tudo o que o controle precisa: `paused`, `onPlayRequested`, `onPauseRequested`,
  `onNextVideoRequested`, `nextVideo` e o handler que esconde a barra. O seek e a pré-visualização são
  os do upstream, acionados pelas mesmas setas.
- **Captura em `window`.** Uma tecla tratada aqui é consumida (`preventDefault` +
  `stopImmediatePropagation`): nem os atalhos do upstream (`document`), nem o polyfill de navegação
  espacial (`window`, bolha), nem o React a veem. As setas de seek só recebem `preventDefault`: os
  atalhos ainda as veem e o polyfill as ignora (`defaultPrevented`).

## Testes

- `pnpm test webos/lib/player-remote` (jsdom): cada tecla em cada estado, FF/RW como setas com
  repetição e soltura, overlays, popup, Back e a rota escondida (`controller.test.js`);
  `upstream.test.js` falha se mudar algum detalhe do upstream de que o controlador depende (classes,
  props da barra, atalhos de seek, `onContainerMouseMove`/`onContainerMouseLeave`).
- Emulador, um cenário por `emu-run`, depois de `pnpm webos:package` (mídias em
  `~/webos-tv-sdk/run/f57-media`; o addon de teste `webos/tests/player-remote/addon.mjs` serve uma
  série de 2 episódios com o mesmo `bingeGroup`, para o core montar o deep link do próximo):

  ```bash
  webos/tools/emu-run --timeout 20 -- node webos/tests/player-remote/emulator/run.mjs ~/saida keys
  webos/tools/emu-run --timeout 20 -- node webos/tests/player-remote/emulator/run.mjs ~/saida next
  webos/tools/emu-run --timeout 20 -- node webos/tests/player-remote/emulator/run.mjs ~/saida watch
  webos/tools/emu-run --timeout 20 -- node webos/tests/player-remote/emulator/run.mjs ~/saida menu
  webos/tools/emu-run --timeout 20 -- node webos/tests/player-remote/emulator/run.mjs ~/saida resume
  webos/tools/emu-run --timeout 20 --instance N -- node webos/tests/player-remote/emulator/run.mjs ~/saida resume-save
  SKIP_INSTALL=1 webos/tools/emu-run --timeout 20 --instance N --keep-state -- node webos/tests/player-remote/emulator/run.mjs ~/saida resume-check
  ```

  (`menu`: o menu de áudio aberto pela barra só com o controle; a F4.3 põe o foco dentro e o Back o
  fecha, com o foco de volta no botão.)

  `keys`: OK, setas, FF/RW (apertadas e seguradas, por eventos CDP com `autoRepeat`), PLAY/PAUSE,
  arrasto do Magic Remote no seek bar, Back que esconde a barra e Back que sai. `next`: popup de
  próximo vídeo pelas setas, Back que o dispensa, botão "próximo" da barra, STOP. `watch`: OK em
  "assistir". `resume-*`: a posição salva pelo core sobrevive ao reboot e o episódio abre nela.
  `context-menu`: as setas no menu de contexto (amarelo) não mudam volume nem tempo do vídeo atrás.
  `exit-focus`: Detalhes → stream → Player → Back: o foco volta ao stream tocado.
  `seek-probe` (de preferência com `--profile c8` e `F57_MEDIA` apontando para o 1080p do e2e): teclas
  que chegam à página, tempos aplicados ao `<video>` e paradas de seek.

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
F4.3, e o Back fecha cada um pela ponte do `webos/back`). O popup de "próximo vídeo" não conta como
overlay aqui: ele não prende o foco.

| Tecla | Barra escondida (ou foco fora dela) | Foco no seek bar | Foco num botão da barra | Foco no popup de próximo vídeo |
|---|---|---|---|---|
| OK | play/pause; foco no play/pause | play/pause | aciona o botão (o `Button` do upstream clica no Enter) | aciona o botão |
| ← → | seek de 10 s pelo upstream; foco vai para o seek bar | seek de 10 s | anda entre os botões (para nas pontas) | dispensar ↔ assistir |
| ↑ | mostra a barra; foco no último botão usado (ou play/pause) | vai para o popup, se estiver aberto | seek bar | fica |
| ↓ | idem | último botão usado (ou play/pause) | fica | seek bar |
| PLAY (415) / PAUSE (19) / `MediaPlayPause` | toca / pausa / alterna, em qualquer estado (também com menu aberto) | | | |
| FF (417) / RW (412) | seek de 10 s, com aceleração ao segurar, igual às setas | | | |
| STOP (413) | sai do Player pelo despachante do `webos/back` (`dispatch({ source: 'stop' })`) | | | |
| `MediaTrackNext` | próximo episódio (o controle LG não tem essa tecla; vale para outros controles e teclados) | | | |
| qualquer outra | mostra a barra e segue (cores, números: o amarelo abre o menu de contexto da F4.3) | | | |

Com o foco num elemento do popup ou fora de tudo e o popup aberto, a primeira seta leva o foco para
"assistir". O upstream já põe o foco lá quando a animação do popup termina.

**Seek.** É o do upstream (`useKeyboardSeek`, pelos atalhos `ArrowLeft`/`ArrowRight`): passo de
`settings.seekTimeDuration` (10 s), e, segurando a tecla, o passo cresce 5 % a cada repetição aceita
(até 10 % da duração). O alvo aparece no seek bar (posição e tempo) enquanto a tecla está segurada e
só é aplicado no `keyup`: segurar não dispara um seek por repetição. FF/RW chegam a ele como setas
sintéticas (marcadas, `keydown` com o `repeat` da tecla real e `keyup` na soltura). Sem o `keyup` (foco
perdido, evento perdido), o controlador solta a tecla sozinho depois de 1 s, senão o alvo ficaria na
tela sem ser aplicado. No emulador o seek cai no keyframe anterior (PESQUISA §7).

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
  webos/tools/emu-run --timeout 20 --instance N -- node webos/tests/player-remote/emulator/run.mjs ~/saida resume-save
  SKIP_INSTALL=1 webos/tools/emu-run --timeout 20 --instance N --keep-state -- node webos/tests/player-remote/emulator/run.mjs ~/saida resume-check
  ```

  `keys`: OK, setas, FF/RW (apertadas e seguradas, por eventos CDP com `autoRepeat`), PLAY/PAUSE,
  arrasto do Magic Remote no seek bar, Back que esconde a barra e Back que sai. `next`: popup de
  próximo vídeo pelas setas, Back que o dispensa, botão "próximo" da barra, STOP. `watch`: OK em
  "assistir". `resume-*`: a posição salva pelo core sobrevive ao reboot e o episódio abre nela.

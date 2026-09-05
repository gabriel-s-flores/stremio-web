# Hello webOS — app esqueleto de diagnóstico (T0.3)

> Produto da tarefa **T0.3** (Fase 0 do port). Dois apps mínimos (hosted + packaged)
> que renderizam uma página de diagnóstico ES5-safe com painel de log em tela,
> usados para validar o ciclo de vida básico no emulador webOS TV 5.0.

## Estrutura

```
webos/hello/
├── site/                 # conteúdo servido localmente (http://<host>:8090)
│   ├── index.html        # página de diagnóstico (ES5, log em tela, mini-router #/a-c)
│   └── webOSTVjs-1.2.10/ # vendor oficial LG (webOSTV.js/webOSTV-dev.js)
├── hosted/               # app HOSTED (redirect) — com.stremio.webos.hello.hosted
│   ├── appinfo.json      # disableBackHistoryAPI: true (rodada 2)
│   ├── index.html        # location.replace('http://10.0.2.2:8090/')
│   │                     #   10.0.2.2 = host visto de dentro do NAT do VirtualBox
│   ├── icon.png / largeIcon.png
├── packaged/             # app PACKAGED (file://) — com.stremio.webos.hello.packaged
│   ├── appinfo.json      # disableBackHistoryAPI: true (rodada 2)
│   ├── index.html        # cópia de site/index.html (o pacote é self-contained)
│   ├── webOSTVjs-1.2.10/ # vendored (packaged não tem rede garantida)
│   └── icon.png / largeIcon.png
├── tools/
│   ├── cdp.mjs           # debug via CDP bruto (list/eval/logs) na porta 9998
│   └── rcu.mjs           # injeção de teclas do controle remoto (remocon, porta 19001)
└── dist/                 # .ipk gerados (gitignored)
```

## Checklist de comandos (todos validados em 2026-09-05, Windows 11 + CLI 3.2.1)

```powershell
# 0. Pré-requisito: emulador ligado (NAT com forwards 6622, 9998, 19001)
ares-device -i                 # confirma webOS 5.0.0 / fw 02.00.30

# 1. Servidor local do app hosted (porta 8090, na raiz do repo)
npx http-server -p 8090 -a 0.0.0.0 webos\hello\site

# 2. Empacotar (de webos/hello/)
ares-package -o dist hosted
ares-package -o dist packaged

# 3. Instalar no emulador
ares-install dist\com.stremio.webos.hello.hosted_1.0.0_all.ipk
ares-install dist\com.stremio.webos.hello.packaged_1.0.0_all.ipk

# 4. Ciclo de vida
ares-launch com.stremio.webos.hello.hosted      # abre e vai para http://10.0.2.2:8090/
ares-launch -r                                  # lista apps rodando
ares-launch <id>                                # de novo = RELAUNCH (dispara webOSRelaunch)
ares-launch -c <id>                             # fecha

# 5. Teclas do controle remoto (emulador): tools/rcu.mjs
node tools\rcu.mjs BACK        # Back (461). HOME, OK, UP/DOWN/LEFT/RIGHT, EXIT...
node tools\rcu.mjs 509         # código numérico direto também funciona

# 6. Debug remoto (sem DevTools moderno — ver T0.2):
node tools\cdp.mjs list                          # alvos (pages) com URL
node tools\cdp.mjs eval hello.packaged "location.hash='#/b'"
node tools\cdp.mjs eval "10.0.2.2" "document.visibilityState"
node tools\cdp.mjs logs hello.packaged 30        # tail do console por 30s
```

### Remocon (porta 19001) — protocolo

Extraído via `javap` do RCU do SDK (`LG_webOS_TV_Emulator_win.jar`): para **cada**
tecla, abre-se uma conexão TCP e envia o código como string decimal ASCII, sem
newline; fecha em seguida. Não há handshake no envio (o HELLO/FINE de
`RemoconSocket.checkServer` não é usado nesse caminho). Códigos (skins RCU
2013/2018): **BACK=509**, HOME=502, EXIT=511, UP=504, DOWN=508, LEFT=505,
RIGHT=507, OK=506, cores 601–604, QMENU=703, PLAY=705… Long-press: `"509|long"`.

⚠️ Teclado do **host ≠ controle remoto**: Backspace/ESC do PC chegam à página como
`keydown` 8/27 comuns (o emulador não os traduz para 461). Para testar o Back de
verdade, use `rcu.mjs` (ou a GUI "Remote Controller" do SDK).

## Matriz de resultados (emulador 5.0.0, 2026-09-05)

### Boot e ambiente

| Item | Hosted | Packaged |
|---|---|---|
| Boot + render 1920×1080 | ✅ | ✅ |
| `window.PalmSystem` / `window.webOS` | object / object | object / object |
| Ponte Luna (`webOS.service.request`) | — | ✅ `getTime` OK |
| `document.cookie` | **SIM** | **NÃO** (esperado — D1) |
| `localStorage` | OK | OK |
| `serviceWorker` no navigator | presente | presente (registrar é outra história → spike T0.4) |
| Origem reportada | `http://10.0.2.2:8090` | `file://com.stremio.webos.hello.packaged-webos` |

### Botão Back — rodada 1 (appinfo default, sem `disableBackHistoryAPI`)

| Ação | Resultado (hosted = packaged) |
|---|---|
| BACK com histórico (`#/c` empilhado) | plataforma consome → `history.back()` em silêncio; a página **não** recebe `keydown` 461 ✅ |
| BACK na raiz (histórico esgotado) | **no-op**: app permanece em foreground, `visibilityState=visible` (não vai ao Home sozinho) |
| `webOS.platformBack()` | abre a Home/launcher overlay do webOS 5 (app recebe `window blur`; processo segue vivo) ✅ |

### Botão Back — rodada 2 (`"disableBackHistoryAPI": true` no appinfo) — evidência D2

| Ação | Resultado (hosted = packaged) |
|---|---|
| BACK com menu simulado aberto | página recebe **`keydown 461`**; o handler fecha o menu e consome com `preventDefault()` — hash **não** muda, app não sai ✅ |
| BACK sem menu, page não consome | `keydown 461` chega, mas a plataforma **não faz nada** (sem `history.back()`, sem saída) — o app é 100% responsável ✅ |
| `webOS.platformBack()` | continua abrindo a Home overlay (escape preserve funciona com a flag) ✅ |

### Ciclo de vida

| Evento | Resultado |
|---|---|
| 1º launch | `webOSLaunch {"displayAffinity":0}` + `pageshow` ✅ |
| `ares-launch` no app já em background | `webOSRelaunch {"displayAffinity":0}` na **mesma instância** (sem reboot) ✅ |
| `ares-launch -c` | app fecha (some de `ares-launch -r`) ✅ |
| Screensaver | ⚠️ **não testável no emulador**: não há app de screensaver em `/usr/palm/applications`, `com.webos.service.screensaver` não existe, e `com.webos.settingsservice` nega acesso ao usuário `developer`. A página já instrumenta `visibilitychange`/`focus`/`blur`/`pagehide`/`pageshow` — validação fica para a TV real (ver R15). |

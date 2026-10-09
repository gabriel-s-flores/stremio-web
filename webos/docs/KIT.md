# Kit de desenvolvimento: Stremio para LG webOS TV 4.x

Ferramentas instaladas nesta máquina para o port do Stremio Web para a LG OLED55C8PSA (webOS TV 4.0, Chromium 53).

**Todo o desenvolvimento e todos os testes são feitos no emulador.** A TV real só entra na validação final (Fase 8 do plano).

- **Plano:** [docs/PLANO-PORT-WEBOS4.md](docs/PLANO-PORT-WEBOS4.md)
- **Pesquisa com fontes:** [docs/PESQUISA.md](docs/PESQUISA.md)

```bash
source ~/webos-tv-sdk/env.sh
```

## Conteúdo

| Caminho | O que é |
|---|---|
| `sdk/Emulator/v4.0.0/` | Emulador oficial LG webOS TV 4.0 (imagem `4.0.0-152 04.00.014 20180604`, VM VirtualBox) |
| `sdk/Resources/Jre/` | JRE 8 da LG para o launcher gráfico do emulador (só com VirtualBox) |
| `webos/tools/emulator-qemu.sh` | **Emulador sem root:** a mesma imagem em QEMU/KVM (QEMU do flatpak `org.gnome.Boxes`, instalado com `--user`) com overlay qcow2 em `run/` |
| `webos/tools/emulator.sh` | O mesmo controle para o VirtualBox, se ele for instalado |
| `webos/tools/cdp.mjs` | DevTools Protocol no Web Inspector (porta 9998): `targets`, `eval`, `screenshot`, `key`, `console`, `reload` |
| `webos/tools/remote.mjs` | Teclas do controle remoto no emulador (porta 19001, protocolo do launcher LG) |
| `webos/tools/qmp.py` | Comandos QMP para a VM QEMU (screendump, teclas) |
| `webos/tools/probe-run.sh` | Instala e roda o app-sonda no emulador ou na TV e salva JSON e capturas em `probe/results/` |
| `webos/tools/wasm-compile-test.sh` | Compila um `.wasm` dentro de um Worker no emulador e mede tempo e memória |
| `webos/tools/media-server.mjs` | Servidor de mídia para o emulador: Range (seek), CORS e `/redirect/<arquivo>` (302, como links de debrid) |
| `webos/tools/play-test.sh` | Teste padronizado de reprodução: eventos, faixas, progresso e seek |
| `webos/tools/switch-test.js` | Teste de trocas seguidas de stream (estratégias de liberação do pipeline) |
| `media-tests/files/` | Mídias sintéticas: H.264 e HEVC 10-bit, AAC, AC3 5.1 e E-AC3 5.1, MP4/MKV, multi-áudio, SRT |
| `probe/` | App-sonda (IPK): sintaxe JS, APIs, CSS, codecs (`canPlayType`/MSE), Luna, CORS, Worker; `probePlay(url)` para testes de mídia |
| `spikes/core-mvp/` | Core 0.65.0 compilado como **WASM MVP** (receita A), o wasm2js de reserva e os scripts de verificação (`webos/tools/wasmfeat.py`) |
| `tools/binaryen-version_133/` | Binaryen (`wasm2js`, `wasm-opt`) |
| `tools/bin/wasm-pack` | wasm-pack 0.15.0 |
| `src/stremio-core/` | Código do `stremio-core` (HEAD = release 0.65.0; a branch `origin/asmjs` é o build legado da própria Stremio) |
| `webos/tools/install-virtualbox-root.sh` | Instalação opcional do VirtualBox (precisa de `sudo`) |

O CLI oficial da LG (`ares-*`, pacote npm `@webos-tools/cli` 3.2.6) está instalado globalmente no Node do nvm.

## Emulador: uso rápido

```bash
emulator-qemu.sh start            # headless (VNC em 127.0.0.1:5905); "start gui" abre uma janela
emulator-qemu.sh wait
ares-install -d emulator probe/out/io.github.gabrielsflores.webosprobe_1.0.0_all.ipk
ares-launch  -d emulator io.github.gabrielsflores.webosprobe
node webos/tools/cdp.mjs targets
node webos/tools/cdp.mjs eval 'JSON.stringify(window.__probe.api)'
emulator-qemu.sh screenshot /tmp/tela.png
node webos/tools/remote.mjs DOWN OK BACK      # teclas do controle remoto
emulator-qemu.sh stop                     # "reset" volta o disco ao estado de fábrica
```

- O host aparece para o emulador como `10.0.2.2`. Exemplo: `python3 -m http.server 8099 --bind 127.0.0.1` em `run/www`, acessado no emulador como `http://10.0.2.2:8099/`.
- SSH no emulador: `ssh -o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa -i run/ares_webos_emul -p 6622 developer@127.0.0.1`.
- A VM tem 1 GB de RAM, como a oficial (`start --mem 2048` aumenta). A rede usa e1000: a PCnet da VM oficial travava no QEMU depois de transferências grandes.
- `remote.mjs` manda teclas do sistema (o app recebe Back = 461, cores = 403–406). `cdp.mjs key` injeta direto na página. Para `cdp.mjs eval` com várias instruções, use uma IIFE `(function(){ … })()`.
- **Mídia no emulador** (detalhes em `docs/PESQUISA.md`, seção 7):
  - Toca H.264 e HEVC 10-bit (em software), AAC, AC3 e E-AC3, em MP4 e MKV, com redirect, seek e lista de faixas.
  - Sem HDR, DV ou Atmos reais.
  - **Um cenário de reprodução por boot da VM**: cargas seguintes podem travar.
  - **Não assinar `com.webos.media/subscribe` pelo app**: congela o `currentTime`. O `play-test.sh` só assina com `LUNA=1`.
  - O emulador sobe sem placa de som; `start --sound pa` liga o áudio no PC.

```bash
node webos/tools/media-server.mjs &                       # serve media-tests/files em 127.0.0.1:8099
emulator-qemu.sh start && emulator-qemu.sh wait && ares-launch -d emulator io.github.gabrielsflores.webosprobe
webos/tools/play-test.sh http://10.0.2.2:8099/redirect/t2_multi.mkv 8 15   # 8 s, seek para 15 s
```

## TV real (só na Fase 8, quando tudo estiver pronto)

```bash
ares-setup-device -a tv -i "host=<IP-da-TV>" -i "port=9922" -i "username=prisoner"
ares-novacom -d tv --getkey                    # passphrase de 6 caracteres do app Developer Mode
webos/tools/probe-run.sh tv                        # sonda: JSON em probe/results/tv-*.json
ares-launch -d tv com.palmdts.devmode -p extend=true    # estende a sessão do Developer Mode
```

Testes de mídia com a sonda aberta e o inspector ativo (`ares-inspect -d tv --app io.github.gabrielsflores.webosprobe` mostra a porta local):

```bash
node webos/tools/cdp.mjs --port <porta> eval 'probePlay("http://<ip-do-pc>:8080/amostra.mkv")'
node webos/tools/cdp.mjs --port <porta> eval 'JSON.stringify(__probe.media.log)'
```

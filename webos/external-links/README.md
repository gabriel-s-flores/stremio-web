# external-links

Links para fora do app na TV (F3.4). A TV não tem navegador para receber um link, e uma página que
navega para `https://` tira a janela do app. Por isso toda saída do upstream é interceptada aqui.
Só entra no build webOS (`src/App/index.webos.js`); o desktop não muda.

| Arquivo | O que faz |
|---|---|
| `links.js` | Classifica a URL, guarda o link aberto (`createStore`) e instala as duas interceptações (`install`) |
| `ExternalLinkDialog.js` / `.less` | O diálogo com o QR code, o link e o botão Fechar |
| `qr.js` | Gerador de QR code (modo byte, correção L ou M, versões 1 a 40), sem dependências |
| `index.js` | Instala ao carregar o módulo (antes do React) e exporta `ExternalLinks` (o componente) |

## O que vira o quê

| O que o app faz | O que acontece na TV |
|---|---|
| `window.open(url)` com `http(s)` (`Platform.openExternal`: login social, reset de senha, "configure" de addon, exportar dados, legendas) | QR code do link |
| Clique (OK) num `<a href>` `http(s)` (`target="_blank"` ou não): Help, Terms, Privacy, Share, IMDb, trailer, Settings | QR code do link (a navegação é cancelada) |
| `magnet:`, `stremio:`, `mailto:`, `intent:` e qualquer outro esquema externo | **Desativado**: o clique é cancelado e nada acontece |
| `#/rota`, `file:`, `blob:`, `data:` | Intocado |

- A interceptação de clique roda em `window`, na fase de bolha: um handler do app que já tratou o clique
  (`preventDefault`) não é duplicado. O `Button` do upstream transforma Enter em clique, então o OK do
  controle cai no mesmo caminho.
- Em página servida da web (build desktop, testes), uma URL da mesma origem é do app e não é interceptada.
- `Platform.openExternal` do upstream já troca hosts fora da lista por `stremio.com/warning#<url>`; o QR
  leva a essa página, como no upstream.

## O diálogo

- Texto: `LOGIN_SCAN_QR_CODE` ("Scan the QR code or go to") e `BUTTON_CLOSE`, traduzidos pelo i18next do app.
- O QR code é um SVG (um `<path>` com uma barra por sequência de módulos escuros, zona silenciosa de 4
  módulos, 20 rem de lado, `shape-rendering: crispEdges`). Só é calculado quando um link é aberto: nada
  roda no boot além de dois listeners.
- O foco vai para **Fechar** e fica lá. Enquanto o diálogo está aberto ele é dono do controle: setas e
  outras teclas não chegam à página (navegação espacial, atalhos de número). OK fecha; Back fecha pelo
  despachante (`useBackHandler`, F3.2); clique no fundo fecha (Magic Remote). Ao fechar, o foco volta
  para o link que o tinha.
- Link longo demais para um QR (mais de 2953 bytes) mostra só o texto e o botão.

## qr.js

ISO/IEC 18004: padrões de função, Reed-Solomon sobre GF(256), as 8 máscaras com a penalidade padrão, BCH do
formato e da versão. Escolhe a menor versão no nível M e cai para L quando o link não cabe (até a versão 40-L,
2953 bytes). Escrito para este port (sem biblioteca: nenhuma dependência nova, ~350 linhas, o mesmo
licenciamento do repositório). Conferido contra o `qrencode` (matriz idêntica módulo a módulo, versões 2 a 36)
e decodificado com o `zbarimg` (veja o relatório da F3.4).

## Testes

- `pnpm exec jest webos/tests/external-links`: gerador (fixture do `qrencode`), classificação e interceptação,
  diálogo renderizado em jsdom com o despachante real.
- Emulador: `webos/tests/keyboard/emulator/run.mjs <pasta> links` (dentro do `emu-run`, depois de
  `pnpm webos:package`).

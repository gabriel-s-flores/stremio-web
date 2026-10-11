# Capturas e regressão visual das telas

Roteiro de capturas das telas principais (F2.6) e, em cima dele, a **regressão visual** (F2.7): captura as telas no emulador com um conteúdo que nunca muda, compara com **referências versionadas** e falha quando uma tela mudou além de um limiar.

## Peças

| Arquivo | Papel |
|---|---|
| `scenes.sh` | As cenas: rota, ação (menu, diálogo), elemento a focar. Uma linha por captura |
| `run` | Roda as cenas na página atrás de `$CDP_PORT` (emulador ou Chrome): screenshot + sonda (`page.js`) por cena |
| `emulator.sh` / `desktop.sh` | `run` no app empacotado dentro do `emu-run` / no `build/` desktop em Chrome headless |
| `fixture/` | **Addon de teste** (`server.mjs` + `data.js`): catálogos, detalhes, streams e imagens SVG fixos, sem rede |
| `fixture.sh` | Sobe o addon do lado do host para `emulator.sh` e `desktop.sh` |
| `visual.sh` | Captura (`emulator.sh`) e compara com as referências, ou as atualiza |
| `visual.mjs`, `visual-lib.js`, `visual.config.json` | A comparação, o relatório HTML e os limiares/máscaras por cena |
| `refs/emulator/` | As referências: uma PNG 480×270 por cena (~30 KB cada, ~0,5 MB no total) |
| `compare.sh` | Lado a lado de pastas de captura (emulador × desktop × antes/depois), sem limiar |
| `visual.test.js` | Testes do comparador, do addon e das referências (rodam no `pnpm test`) |

## Conteúdo estável

Os catálogos do Cinemeta mudam e os pôsteres vêm da rede, então a captura não seria repetível. Com o addon de `fixture/`:

1. o `run` lê o perfil do core (convidado), troca os addons por **só o addon de teste** (`window.__screens.seed`, `page.js`) e escreve o `profile` no `localStorage`, junto com o aviso do servidor de streaming dispensado; recarrega o app e espera o Board;
2. o addon (no host: `10.0.2.2` no emulador, `127.0.0.1` no desktop) serve 2 catálogos de 24 itens (Popular – Movie/Series, com gênero, busca e `skip`), o detalhe de qualquer `tt…` (série com 3 temporadas de 6 episódios), 4 streams de nome parecido com o de um addon de debrid e imagens SVG feitas dos ids (gradientes, sem texto);
3. a busca devolve sempre os mesmos 12 itens, qualquer que seja o termo;
4. o Player da cena `player-error` abre um stream de `/status/404/…` do próprio addon: a tela de erro de link de debrid da F6.3 ("The file is no longer available at this link (HTTP 404)");
5. transições e animações são desligadas na página (`page.js`) e a captura espera as imagens carregarem.

Nada sai da máquina: sem Cinemeta, sem imagens remotas. `FIXTURE=0` volta aos catálogos ao vivo (a regressão não vale nesse modo). Duas execuções em boots limpos separados deram capturas **idênticas** (0,000 % de pixels diferentes em 16 cenas; só o URL do addon no modal muda de porta e está mascarado).

O que ainda varia entre builds ou execuções é mascarado por cena em `visual.config.json` (retângulos `[x, y, largura, altura]` na captura de 1920×1080, em preto-azulado no diff e fora da conta):

- `settings`: "App Version" e "Build Version" (mudam a cada commit);
- `diagnostics`: versão do app, commit e versão do core;
- `addon-details`: o URL do addon (porta aleatória).

## Como comparar

Dentro de uma reserva do pool, com o IPK atual (`pnpm webos:package`, ou `IPK=<arquivo>`):

```bash
webos/tools/emu-run --timeout 15 -- webos/tests/screens/visual.sh check /tmp/visual
```

- Saída: o resultado por cena na tela, `/tmp/visual/report/index.html` (referência, nova e diferença por cena, as com problema primeiro, com link para a captura inteira) e `report/result.json`. **Código de saída 1** se alguma cena passou do limiar, não tem referência ou não tem captura.
- O pool costuma estar disputado: dá para capturar **uma ou poucas telas por reserva**, `visual.sh check /tmp/visual board settings`, e o relatório só leva essas. As cenas de uma execução inteira são 16 e levam uns 4 min depois do boot.
- Já tem uma pasta de capturas (de `emulator.sh`/`run`)? `node webos/tests/screens/visual.mjs compare <capturas> [--refs <pasta>] [--out <relatório>] [--scene a,b] [--desktop <capturas do desktop>]`. `--desktop` põe a captura do desktop (`desktop.sh`) ao lado no relatório, só para ler.
- O Player com vídeo não faz parte: o quadro do vídeo não é estável no emulador.

### Limiares

Cada captura é reduzida a 480×270 (média de área) e comparada pixel a pixel. Padrões em `visual.config.json` (por cena, sobrescrevem as chaves de `default`):

| Chave | Padrão | Significa |
|---|---|---|
| `pixel` | 32 | um pixel "mudou" quando algum canal difere mais que isso (0–255) |
| `ratio` | 0,2 % | falha se mais que isso da imagem (sem as máscaras) mudou |
| `block` | 8 % | falha se mais que isso dos pixels de **um** bloco de 16×16 (64 px da tela) mudou: pega mudança pequena e local, como o contorno de foco sumindo, que é pouco da imagem toda |

O emulador deu diferença zero entre execuções, então os limiares são folgas contra o ruído de uma TV/emulador diferente, não contra o ruído medido. `INJECT_CSS='<css>'` no `run`/`visual.sh` acrescenta uma folha de estilo a cada cena: uma mudança de propósito, para conferir que a regressão a pega (o contorno de foco desligado derruba Board, Detalhes, Library e Settings).

## Como atualizar as referências

Quando a mudança de uma tela é **de propósito** (ou o addon de teste mudou):

```bash
webos/tools/emu-run --timeout 15 -- webos/tests/screens/visual.sh update /tmp/visual [cena ...]
git diff --stat webos/tests/screens/refs
```

1. Abra o relatório de um `check` antes e confirme que o que mudou é o esperado.
2. `update` reescreve `refs/emulator/<cena>.png` das cenas pedidas (todas, sem nomes). Cena nova em `scenes.sh` → `update` dessa cena; o teste `visual.test.js` exige uma referência por cena.
3. Faça commit das PNGs junto da mudança da tela, e diga no PR quais cenas mudaram. As referências são do emulador com a escala de TV (zoom 1,75): outra escala ou perfil muda todas.
4. Mantenha o conjunto pequeno (o teste falha acima de 3 MB): 480×270, sem metadados.

Máscara nova: ponha o retângulo em `visual.config.json` (`scenes.<cena>.masks`) e rode o `check`; o diff mostra a região em azul-escuro.

## O que isto não pega

- Texto trocado por outro de mesma forma e cor (a 480×270 as letras são manchas); a sonda das capturas (`<cena>.json`: tamanhos de fonte, caixa do foco) cobre parte.
- Diferenças de fonte/renderização da TV real contra o emulador (P1: só o emulador).
- Telas que dependem de conta, de torrents ou do servidor de streaming (fora do plano).

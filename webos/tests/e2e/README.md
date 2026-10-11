# Ponta a ponta no emulador (F6.4)

O roteiro de aceitação do port até aqui, num boot do emulador, com o app empacotado, sem conta e só com o controle remoto (`remote.mjs`):

1. **Board** com os catálogos do Cinemeta (convidado) → as setas até um pôster de **filme** (as fileiras ao vivo mudam: as de série são puladas) → OK;
2. **Detalhes** → a lista de streams de um **addon local que imita um addon de debrid**, ordenada e rotulada para a C8 (F6.2), comparada com a das bibliotecas;
3. o MKV com várias faixas → OK → **toca**;
4. **faixa de áudio** (F5.4): menu, inglês → português, o vídeo segue;
5. **legenda** (F5.5): a embutida em inglês ligada pelo Player (Luna); depois a **de addon**, desenhada no overlay HTML ("ADDON EN n");
6. **seek** pelas setas (o atalho de teclado do Player);
7. **Back** → Detalhes com o foco no stream tocado (F4.1c) → o 1080p H.264 → OK: **troca de stream** (F5.6);
8. Back → o **link expirado** → a tela de erro do debrid (F6.3, "expired (HTTP 410)");
9. Back → Detalhes → Back → **Board**, com o foco no pôster aberto (F4.1a).

O CDP só observa (foco, lista, estado do Player, capturas) e faz a preparação: instala o addon de teste pela URL no perfil de convidado, como a tela de Addons faz. Quando um passo **não dá** para fazer com o controle (hoje, abrir os menus do Player: os controles não recebem foco, tarefa F5.7), o roteiro registra a falha numa checagem e faz só aquela ação com um clique pelo CDP, para o resto do roteiro acontecer. Essas ações ficam em `results.json` (`fallbacks`) e no `summary.md`.

## Peças

| Arquivo | Papel |
|---|---|
| `run.mjs` | O roteiro: passos, checagens, tempo e memória por etapa |
| `page.js` | Helpers na página (`window.__e2e`): foco, estado do Player, menus, overlay, tela de erro, caixas e fontes na escala da TV. Junto com os da F6.2 (`streams/page.js`), F5.1 (`player/page.js`) e F4.1c (`navigation/metadetails/page.js`) |
| `make-media.sh` | As mídias do conjunto `e2e` (ver abaixo) |
| `catalog.test.js` | O conjunto `e2e` pelas regras da C8: ordem, rótulos e probes iniciais (roda no `pnpm test`) |
| [`../addon/`](../addon/README.md) | O addon de teste: `server.mjs --set e2e` |

## O addon de debrid simulado (`--set e2e`)

Responde ao recurso `stream` de qualquer filme ou série `tt…`, com nomes no formato de um addon de debrid (`[RD+] Teste` + qualidade, o nome do arquivo na descrição) e URLs que passam pelo `/redirect/` do `media-server.mjs` (302, como o resolvedor de um debrid):

| Ordem do addon | Stream | Mídia | O que testa |
|---|---|---|---|
| 1 | `2160p.BluRay.REMUX.DV.P5.HEVC.TrueHD.7.1.Atmos` | fixture do probe (só cabeçalho) | a C8 rebaixa: vai para o fim, com os avisos "DV P5: cores erradas" e "TrueHD" |
| 2 | `2160p.WEB-DL.HDR10.HEVC.DDP5.1` | 3840×2160 HEVC Main10 com HDR10 (PQ, BT.2020, mastering display), E-AC3 5.1 | rótulo HDR10 pelo nome e pelo probe (o emulador decodifica em software, até 1080p: não é tocado) |
| 3 | `1080p.WEB-DL.H264.AAC` | 1920×1080 H.264, AAC | a troca de stream |
| 4 | `720p.WEB-DL.H264.MULTI.AAC.AC3.SUBS` | 1280×720 H.264; áudio AAC eng, AAC por, AC3 5.1 eng; SRT eng/por embutidas; 2 legendas de addon (eng, por) no stream | tocar, faixa de áudio, legendas embutidas e de addon, seek |
| 5 | `1080p.BluRay.H264.AC3` | `/redirect/status/410/…`: o resolvedor responde, o host do arquivo diz que o link expirou | a tela de erro da F6.3 |
| 6 | `[P2P]` com `infoHash` | — | escondido (F6.1) |

As mídias têm 300 s (`DURATION`; o Player volta sozinho no fim de um arquivo, e 120 s acabaram no meio do roteiro no perfil c8), GOP de 1 s e o relógio e a descrição desenhados na imagem, para as capturas da VM mostrarem qual stream toca e se ele anda. As legendas mudam a cada 2 s (`EN-SRT n`, `PT-SRT n`, `ADDON EN n`, `ADDON PT n`).

## Como rodar

```bash
webos/tests/e2e/make-media.sh                     # uma vez: ~/webos-tv-sdk/media-tests/e2e (E2E_MEDIA_DIR)
webos/tools/build-run -- pnpm webos:package       # ou IPK=<arquivo>
webos/tools/emu-run --timeout 15 -- node webos/tests/e2e/run.mjs /tmp/e2e
webos/tools/emu-run --timeout 30 --profile c8 -- node webos/tests/e2e/run.mjs /tmp/e2e-c8
```

- Saída: `results.json` (checagens, com a área/tarefa de cada uma), `steps.json` e `summary.md` (tempo, heap JS e memória do WebAppMgr na VM por etapa), `run.log`, capturas `NN-*.png` (da página, com o zoom da F2.6) e `vm-*.png` (da tela da VM, com o vídeo), `mem.log`, `console.json`, `luna.json`, `lista.json`, `layout-*.json` e o log do addon/servidor de mídia (o que o app leu, com Range). Código de saída 1 se alguma checagem falhou.
- `BOOT_SETTLE_S` (30; 60 no c8): espera depois do Board antes de navegar, para passar o pico de memória do boot, que no emulador às vezes mata a página (OOM). `PLAY_WAIT_S` (75): espera por mídia, mais que o watchdog de 60 s da F5.6. `RIGHT_STEPS` (1): quantos pôsteres andar para a direita antes do OK.
- **Várias mídias num boot.** O roteiro toca duas mídias e abre um link que falha no mesmo boot, porque é o que o usuário faz. O emulador só reproduz com segurança a 1ª mídia do boot (`docs/PESQUISA.md` §7; F5.6): uma 2ª mídia que não começa conta no relatório como "emulador" quando o `starfish-media` não anda, e a checagem tem a contagem de pipelines.
- A página recarregada no meio (o renderer morto por falta de memória, como na F7.1) é detectada (os helpers somem) e registrada em `events`.

## O que conta como falha de quem

Cada checagem tem `area`: a tarefa dona do que ela mede (`F5.7` para os controles do Player pelo controle remoto, `F6.3` para a tela de erro…) ou `emulator`. O relatório da F6.4 junta as falhas por área, com evidência.

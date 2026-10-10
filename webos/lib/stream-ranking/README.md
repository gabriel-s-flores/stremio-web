# stream-ranking

Ordenação e rótulos da **lista de streams** (Detalhes → streams) pelo que a LG OLED55C8PSA toca (F6.2, [plano](../../docs/PLANO-PORT-WEBOS4.md), Fase 6 item 2). Junta as [regras da C8](../c8-rules/README.md) (F5.3) e o [probe de cabeçalho](../header-probe/README.md) (F5.2):

- **na abertura**, as regras leem só o **nome do stream** (`name`, `title`, `description`, `behaviorHints.filename`). A lista já abre ordenada, no mesmo render, sem esperar a rede;
- **depois**, o **probe sob demanda** refina: os primeiros streams visíveis e o item em que o usuário para. Cada resultado reavalia o stream.

JS puro em CommonJS, sem dependências. As regras e o probe só são carregados quando a lista precisa deles, e nada roda no boot.

## Onde entra no app

Só no build `WEBOS=1`, por overrides ao lado dos originais. O desktop não muda.

| Arquivo | Papel |
|---|---|
| `src/routes/MetaDetails/StreamsList/StreamsList.webos.js` | Roda o `StreamsList` do upstream como está e reordena o array de itens que ele renderiza (`replaceItems`). Cada item ganha a prop `c8` |
| `src/routes/MetaDetails/StreamsList/useC8Ranking.js` | O hook: ordenação, agenda dos probes, ordem congelada e assinatura da fila |
| `src/routes/MetaDetails/StreamsList/Stream/Stream.webos.js` | Roda o `Stream` do upstream e acrescenta ao rótulo dele uma linha discreta com os rótulos e avisos (`c8-labels.less`), a classe do `tier` e o `onFocus` que pede o probe. Sem a prop `c8` (Live TV, botões compactos), é o item do upstream |

Na visão "Todos os addons", a ordenação vale para a lista inteira. No empate, fica a ordem original: primeiro a ordem dos addons, depois a ordem de cada addon.

## Ordem

`compare` das regras: `ok` antes de `demoted` antes de `hidden`, e depois a nota, da maior para a menor. A ordenação é estável, porque o `Array#sort` do Chromium 53 não é.

| Caso | Efeito |
|---|---|
| DV em MP4 (P5, P8.1) | Rótulo `DV`, +30: sobe |
| DV P7/P8.1 em MKV, HDR10+ | `HDR10 nesta TV` |
| DD+ Atmos | `Atmos`, +15 |
| Faixa inicial no idioma do perfil (`audioLanguage`, `secondaryAudioLanguage`) | +20 (só com probe) |
| DV P5 em MKV | `DV P5: cores erradas`: rebaixa |
| TrueHD, DTS:X sem núcleo… sem faixa que toque | `TrueHD: sem som nesta TV` (probe) ou `TrueHD: pode ficar sem som` (nome): rebaixa |
| Só DTS | `DTS a confirmar`: rebaixa (D8, até a Fase 8) |
| AV1 | `AV1: não toca nesta TV`: `hidden`, fica **no fim da lista, esmaecido** (não é escondido) |

Os textos dos rótulos vêm do `perfil-c8.json`. Os dos avisos ficam em `display.js`, um por código que rebaixa ou esconde. Os avisos `info` não aparecem, porque o rótulo já diz o necessário.

## Probe sob demanda

`LIST_SETTINGS` (em `index.js`):

| Chave | Valor | O quê |
|---|---|---|
| `initialProbes` | 4 | Quantos dos primeiros streams "probeáveis" da lista são lidos sem o usuário pedir |
| `maxAutoProbes` | 8 | Teto de probes automáticos por lista. Se um resultado tira um stream do topo, o que entra no lugar também é lido, até esse limite |
| `initialDelay` | 1000 ms | Espera depois que o topo da lista para de mudar (addons ainda chegando). Assim os probes nunca atrasam a abertura |
| `focusDelay` | 600 ms | Tempo parado num item antes de lê-lo. Descer a lista com o controle não dispara probes |

Fila (`queue.js`):

- é uma só para o app (`getProbeQueue()`), então reabrir a lista reaproveita o cache;
- roda no máximo 2 probes ao mesmo tempo;
- guarda 64 entradas, e as falhas também ficam (sem nova tentativa a cada foco);
- o item focado passa para a frente da fila;
- sair da lista cancela os pedidos que ainda não começaram.

Cada probe usa `LIST_PROBE_OPTIONS`: até 2 MB, 8 pedidos e 10 s. O normal é 1 a 3 pedidos de 256 KB.

O que **não** é lido:

- streams que não são HTTP(S) (YouTube, links externos);
- os **não cacheados no debrid**: `[RD download]` (Torrentio), `⬇️` (Comet), `⏳` (MediaFusion/AIOStreams) e `uncached`. Abrir um link desses faz o addon adicionar o torrent à conta do usuário e começar o download. Esses streams são ordenados só pelo nome.

`localStorage['webos.streamProbe'] = 'off'` desliga os probes da lista, e a ordenação fica só pelos nomes.

Os headers de `behaviorHints.proxyHeaders.request` vão junto no probe.

## Ordem congelada

Enquanto o usuário não mexe na lista, a ordem segue os resultados dos probes. Um REMUX sem nada no nome, que o probe revela ser DV P5 + TrueHD, desce para o fim dos rebaixados.

Na primeira tecla, clique ou rolagem dentro da lista, a ordem que está na tela é guardada (`orderOf`). Daí em diante:

- novos resultados só mudam os **rótulos**, e nenhum item troca de lugar sob o foco;
- streams que chegam depois (outro addon) entram **depois** dos que já estavam na tela, ordenados entre si;
- trocar de vídeo (episódio) começa uma ordenação nova.

## API

```js
const ranking = require('webos/lib/stream-ranking');

const ranker = ranking.createRanker({ rules: require('webos/lib/c8-rules') });  // ou ranking.getRanker()
const ranked = ranker.rank(items, { streamOf, probeOf, preferences });            // [{ item, stream, key, result }]
ranking.describe(ranked[0]);          // { tier, score, source: 'name' | 'probe', labels: [{code,text}], warnings: [{code,text,severity,message}] }
ranking.pickProbeTargets(ranked, 4, queue.has);   // streams a ler entre os 4 primeiros probeáveis
ranking.applyFrozenOrder(ranked, ranking.orderOf(previous));
const queue = ranking.getProbeQueue();           // request(url, stream, first), resultOf(url), subscribe(fn), cancel(urls)
```

A fila serve a quem mais precisar do probe do mesmo link (ex.: o Player): `getProbeQueue().resultOf(url)` devolve o que já foi lido.

## Testes

```bash
pnpm test     # webos/lib/stream-ranking/test e webos/tests/streams
```

- `test/rank.test.js`: o que é probeável, a ordenação (nome, probe, empates acima de 10 itens), o cache, a ordem congelada e a escolha dos probes.
- `test/queue.test.js`: concorrência, cache, prioridade do foco, cancelamento, falhas e limite.
- `test/display.test.js`: textos dos rótulos e avisos, pelo nome e pelo probe.
- `test/elements.test.js`: as transformações de elementos React dos overrides.
- `webos/tests/streams/ranking.test.js`: a lista do [addon de teste](../../tests/addon/README.md) só com os nomes e com o probe de cada arquivo.
- `webos/tests/streams/streams-list.test.js`: os overrides renderizados com React em jsdom. Cobre a ordem e os rótulos na abertura, os probes do topo depois de 1 s, a reordenação, a ordem congelada depois de uma tecla, o probe no foco e o cancelamento ao sair.
- No emulador, `webos/tests/streams/emulator.sh` (ver o cabeçalho do script).

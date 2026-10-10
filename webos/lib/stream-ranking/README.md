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
| `src/routes/MetaDetails/StreamsList/useC8Ranking.js` | O hook: ordenação, agenda dos probes, ordem congelada, assinatura da fila e parada dos probes ao sair |
| `src/routes/MetaDetails/StreamsList/Stream/Stream.webos.js` | Roda o `Stream` do upstream e acrescenta ao rótulo dele uma linha discreta com os rótulos e avisos (`c8-labels.less`), a classe do `tier`, o atributo `data-c8-tier` e o `onFocus`/`onBlur` do probe no foco. Sem a prop `c8` (Live TV, botões compactos), é o item do upstream |

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
- sair do item antes dos 600 ms (`blur`) cancela o probe do foco;
- **sair da lista** cancela os pedidos que ainda não começaram e **interrompe os que estão em andamento**. Sair quer dizer desmontar a lista ou outra rota por cima dela, como o Player ao dar OK num stream. Os probes interrompidos não ficam no cache (são lidos de novo na próxima visita); os terminados ficam.

O Chromium 53 não tem `AbortController`. Para interromper, o probe da lista (`probeStream`) entrega à header-probe um `fetch` próprio (`createCancellableFetch`, pela opção `fetch` dela). O `cancel()` desse `fetch` cancela os leitores dos corpos em andamento, o que fecha a conexão, e recusa os pedidos e leituras seguintes.

Cada probe usa `LIST_PROBE_OPTIONS`:

- até 2 MB, 8 pedidos e 10 s;
- `maxSkipBytes: 0`: só valem respostas 206 (e a leitura no offset 0). Um servidor que ignore o `Range` não manda bytes antes do offset pedido fora da conta dos 2 MB; o probe falha com `RANGE_NOT_SUPPORTED`.

O normal é 1 a 3 pedidos de 256 KB.

O que **não** é lido:

- streams que não são HTTP(S) (YouTube, links externos);
- os **não cacheados no debrid**: `[RD download]` (Torrentio), `⬇️` (Comet), `⏳` (MediaFusion/AIOStreams) e `uncached`. Abrir um link desses faz o addon adicionar o torrent à conta do usuário e começar o download. Esses streams são ordenados só pelo nome.

`localStorage['webos.streamProbe'] = 'off'` desliga os probes da lista, e a ordenação fica só pelos nomes.

Os headers de `behaviorHints.proxyHeaders.request` vão junto no probe.

Hosts de debrid com certificado Let's Encrypt (ex.: debrid-link) não são lidos pelo `fetch` da página no Chromium 53 (`ERR_INSECURE_RESPONSE`; o proxy da F3.7 só atende imagens e o core). O probe falha, a falha fica no cache e esses streams ficam ordenados só pelo nome.

## Ordem congelada

A regra: **a lista nunca é reordenada enquanto um item dela tem o foco, nem depois da primeira interação do usuário na tela.**

Antes disso, a ordem segue os resultados dos probes. Um REMUX sem nada no nome, que o probe revela ser DV P5 + TrueHD, desce para o fim dos rebaixados.

A ordem que está na tela é guardada (`orderOf`) no primeiro destes casos:

- qualquer entrada do usuário **em qualquer ponto da tela**: tecla (`keydown`), clique, roda, toque ou o ponteiro do Magic Remote se movendo (ouvintes na janela, na fase de captura). O `keyup` não conta, porque o OK que abriu os detalhes termina nele;
- o foco entrando na lista (`focusin` no contêiner), venha de onde vier;
- um item da lista focado no momento de um render (`document.activeElement` com `data-c8-tier`), mesmo sem nenhum evento visto;
- uma interação antes de os streams chegarem congela já a primeira ordem mostrada.

Daí em diante:

- novos resultados só mudam os **rótulos**, e nenhum item troca de lugar sob o foco;
- streams que chegam depois (outro addon) entram **depois** dos que já estavam na tela, ordenados entre si;
- trocar de vídeo (episódio) começa uma ordenação nova, congelada logo de saída se o usuário já interagiu.

Por quê: o upstream usa `key={index}`. Se a lista reordenasse sob o foco, o mesmo nó continuaria focado mas mostrando outro stream, e um OK tocaria um stream diferente do que o usuário viu.

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
- `test/queue.test.js`: concorrência, cache, prioridade do foco, cancelamento (inclusive de probes em andamento), falhas e limite.
- `test/probe.test.js`: o probe da lista com o `fetch` cancelável, o orçamento (`LIST_PROBE_OPTIONS`, `maxSkipBytes: 0`) e os headers do addon.
- `test/display.test.js`: textos dos rótulos e avisos, pelo nome e pelo probe.
- `test/elements.test.js`: as transformações de elementos React dos overrides.
- `webos/tests/streams/ranking.test.js`: a lista do [addon de teste](../../tests/addon/README.md) só com os nomes e com o probe de cada arquivo.
- `webos/tests/streams/streams-list.test.js`: os overrides renderizados com React em jsdom (setup em `render-setup.js`, com um `fetch` falso que serve as mídias do addon de teste com Range). Cobre a ordem e os rótulos na abertura, os probes do topo depois de 1 s com as opções da lista, a reordenação, a ordem congelada depois de uma tecla, o probe no foco e a interrupção ao sair.
- `webos/tests/streams/streams-list-freeze.test.js`: as regras de congelamento (foco entrando sem tecla, tecla ou ponteiro fora da lista, item focado sem evento, tecla antes dos streams), o `blur`, a rota coberta pelo Player e o teto de probes automáticos.
- No emulador, `webos/tests/streams/emulator.sh`, em dois modos (ver o cabeçalho do script): `sem-toque` (os probes reordenam a lista intocada; depois o controle entra nela) e `MODE=entrada` (latência de debrid, o controle entra na lista antes de os probes chegarem e fica parado).

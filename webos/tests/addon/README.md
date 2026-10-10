# Addon de teste local

Um addon Stremio local para testar a lista de streams e o Player sem conta e sem debrid (F6.2, reaproveitado na F6.4). Responde ao recurso `stream` de qualquer filme ou série com id `tt…` com a mesma lista estática de streams:

- os **nomes** imitam os de addons de debrid (`[RD+] Teste` + `4k DV | HDR`, e o nome do arquivo na descrição);
- as **URLs** apontam para o [`media-server.mjs`](../../tools/media-server.mjs) por `/redirect/…` (302, como um link de debrid);
- os **arquivos** combinam com os nomes, para o probe de cabeçalho confirmar ou corrigir o que o nome diz.

| Pasta na raiz de mídia | Origem | Serve para |
|---|---|---|
| `kit/` | Mídias do kit (`~/webos-tv-sdk/media-tests/suite`, `webos/tools/gen-media.sh` com `GOP=24`; `MEDIA_DIR` muda a pasta), por link simbólico | Tocam no emulador (F6.4) |
| `headers/` | Catálogo da F0.10 (`webos/tests/media/headers`), por link simbólico | Só o probe |
| `fixtures/` | Fixtures do probe (`webos/lib/header-probe/__fixtures__`) reconstruídas no tamanho original: um arquivo esparso com os bytes gravados nos seus offsets e zeros no resto | Só o probe, que lê pelo HTTP os mesmos bytes da gravação |

Os streams estão em [`catalog.js`](catalog.js), na ordem do addon, com o resultado esperado das regras da C8 só pelo nome e com o probe. Tem de tudo:

- DV em MP4 (P8.1 e P5);
- DV P8.1 em MKV com DD+ Atmos;
- DV P5 em MKV com TrueHD;
- um REMUX sem nada no nome (o probe revela DV P5 + TrueHD);
- TrueHD sozinho, DTS-HD MA e AV1;
- três mídias do kit;
- um 720p sem nada no nome (o probe revela DD+ Atmos);
- um não cacheado (`[RD download]`, nunca lido);
- um torrent (`infoHash`, que a F6.1 esconde).

## Uso

```bash
node webos/tests/addon/server.mjs [--port N] [--media-port N] [--host 10.0.2.2] [--dir <raiz de mídia>] [--info addon.json] [--delay <ms>]
```

- `--delay <ms>` põe um proxy na frente do servidor de mídia que segura cada pedido por esse tempo, para simular a latência de um debrid real. As URLs dos streams passam a apontar para o proxy.

- As portas livres são escolhidas sozinhas. `--host` é como o cliente enxerga esta máquina: `10.0.2.2` no emulador (padrão) e `127.0.0.1` num navegador do desktop.
- Quando fica pronto, imprime (e grava em `--info`) `{ manifestUrl, mediaUrl, port, mediaPort, dir }`.
- O `media-server.mjs` sobe como processo filho e é encerrado junto, com SIGINT ou SIGTERM. A raiz de mídia temporária (sem `--dir`) é apagada na saída.

Para instalar no app em modo convidado (sem conta), por CDP, como faz a tela de Addons (`window.core` é o transport do core):

```js
fetch(manifestUrl).then((r) => r.json()).then((manifest) => window.core.dispatch({
    action: 'Ctx',
    args: { action: 'InstallAddon', args: { transportUrl: manifestUrl, manifest, flags: { official: false, protected: false } } },
}));
```

O [`webos/tests/streams/page.js`](../streams/page.js) já tem isso (`__f62.install(url)`). Depois, abra `#/detail/movie/tt0111161/tt0111161`.

O log do servidor (stdout) mostra cada pedido ao addon e cada Range lido das mídias. É a prova de quais arquivos o app leu.

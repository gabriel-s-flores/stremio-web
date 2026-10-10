# F0.8 · Persistência entre atualizações do app

Pergunta: o que o app empacotado (IPK, `file://`) mantém quando é atualizado, quando a TV reinicia e quando o app é desinstalado e reinstalado? O core do Stremio grava **tudo** em `localStorage` (ver "Chaves do core"), então o login e a biblioteca dependem disso.

Medido no emulador webOS TV 4.0 (imagem oficial, Chromium 53). Origem do app: `file://<id-do-app>`; o app roda de `file:///media/developer/apps/usr/palm/applications/<id>/index.html`.

## Resultado

Legenda: ✅ sobrevive · ❌ perdido · — sem suporte (a API falha no `file://`).

| Armazenamento | Reabrir o app | Atualizar (`ares-install` de versão nova, app aberto) | Reinstalar a mesma versão por cima | Reboot do webOS | Desinstalar + reinstalar | Corte de energia (≥ ~1 s após gravar) |
|---|---|---|---|---|---|---|
| `localStorage` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `indexedDB` | ✅ | ✅ | ✅ | ✅ | ✅ (⚠ ver abaixo) | ✅ |
| Luna db8 (`com.webos.service.db`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `sessionStorage` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ (esperado: só vale enquanto o app está aberto) |
| Cookies (persistente e de sessão) | — | — | — | — | — | — (o `document.cookie` aceita a escrita e não devolve nada) |
| WebSQL | — | — | — | — | — | — (`unable to open database file`) |
| Cache API | — | — | — | — | — | — (`Request scheme 'file' is unsupported`) |
| FileSystem API (`webkitRequestFileSystem`) | — | — | — | — | — | — (`SecurityError`) |

Outros fatos medidos:

- **Isolamento.** O `localStorage` e o db8 são separados por app: um segundo app (`...persistprobeb`) não enxergou os dados do primeiro. O **IndexedDB não é isolado**: o app B leu o banco do app A. Todo app `file://` compartilha o mesmo armazenamento de IndexedDB. Por isso o banco **sobrevive à desinstalação** e fica **visível a qualquer outro app sideloaded**.
- **Cota do `localStorage`:** com 1 MB já gravado, mais ~3,75 MB couberam antes de falhar, ou seja ~5 MB no total. A biblioteca do core vai para uma única chave (`library`/`library_recent`), então uma biblioteca muito grande pode estourar isso.
- **IndexedDB:** gravou e leu 1 MB sem problema.
- **db8:** a chamada `putKind` + `put` funcionou sem permissões extras no manifesto, e o dado (`kind` do app) sobreviveu a remover e instalar de novo. Falta confirmar na TV real.
- **Reboot:** o emulador não tem reboot gracioso (`reboot` exige root, o Luna nega `machineReboot` e o ACPI `system_powerdown` é ignorado). O reboot medido foi `sync` no guest + `system_reset` pelo QMP (o guest reiniciou de verdade: uptime 88 s → 13 s).
- **Corte de energia:** `QMP quit` corta a VM sem desligar o guest. Cortes com 0, 3, 6 e 12 s de espera depois do fim da gravação preservaram `localStorage`, IndexedDB e db8 em todos os casos. O "0 s" tem um piso de cerca de 1–2 s, que é a latência da própria ferramenta (a sonda termina, o cdp lê o JSON e só então a VM é cortada). Janelas menores que isso não foram medidas.
- **Atualização:** o `ares-install` parece relançar o app sozinho (o `sessionStorage` já tinha o marcador da v2 quando a sonda foi aberta de novo; não confirmei o mecanismo). Por isso a sonda guarda o relatório do primeiro carregamento da sessão no `sessionStorage` (`session.firstLoad` no JSON).

## Chaves do core

Só o core grava no `localStorage` (nenhum outro código de `src/` nem dependência). Ele chama `localStorage.getItem/setItem/removeItem` pelo worker, via `Bridge` com escopo `window` (`src/core/createTransport.ts`; `worker.js` do `stremio-core-web`). Chaves (`stremio-core/src/constants.rs` e `stremio-core-web/src/env.rs`):

`installation_id`, `schema_version`, `profile`, `library`, `library_recent`, `streams`, `search_history`, `streaming_server_urls`, `notifications`, `calendar`, `dismissed_events`

`profile` guarda a sessão (authKey), os addons instalados e as configurações. No modo convidado (P3), `library` e o histórico só existem localmente: perder o `localStorage` perde esses dados e não há como reconstruí-los.

## Recomendação para a F3.5

**Atualização e reboot não são problema:** o `localStorage` sobrevive, então o plano de usar só `localStorage` já cobre o caso comum. O que o `localStorage` não aguenta é **desinstalar e reinstalar** (e, pela pesquisa, a expiração do Developer Mode remove os apps). Para esse caso:

1. **Espelhar o `localStorage` no IndexedDB** (única opção testada que sobrevive à desinstalação e é padrão da Web).
   - Banco com nome único, ex. `stremio-webos-persist` (o IndexedDB é compartilhado entre apps `file://`, então nada de nomes genéricos).
   - Um registro por chave do core (valor = a string do `localStorage`). Não inventar outro formato.
2. **Restaurar antes de iniciar o core.** No boot do app (antes de `createTransport().init`), se `localStorage.getItem('schema_version') === null` e o IndexedDB tem registros, copiar todas as chaves de volta para o `localStorage` e só então inicializar o core. Se os dois estiverem vazios, é primeira instalação: nada a fazer.
3. **Espelhar as escritas.** Embrulhar `Storage.prototype.setItem/removeItem` (só quando `this === window.localStorage`) para repassar a escrita ao IndexedDB de forma assíncrona e agrupada (~1 s). Assim o código do core não muda. Alternativa se a cota de 5 MB virar problema: passar ao `Bridge` um escopo com `localStorage` assíncrono apoiado no IndexedDB, mas isso mexe em `createTransport.ts` e no escopo `window` usado por `onCoreEvent`.
4. **Fica de fora do espelho:** `sessionStorage`, cookies, WebSQL, Cache API, FileSystem (não funcionam ou não valem).
5. **Se algo não sobreviver** (IndexedDB indisponível ou vazio): o app segue com `localStorage` sozinho e começa limpo, sem erro visível. Registrar no log de diagnóstico (F3.6) qual armazenamento restaurou. Perguntas para a F8 (TV real, não dá para medir no emulador): (a) o IndexedDB sobrevive à desinstalação na TV como no emulador? (b) o Developer Mode apaga o IndexedDB ao expirar? (c) o db8 aceita escrita de app de terceiros?
6. **Reserva:** se (a) ou (b) falharem na TV, o db8 (`com.webos.service.db`, kind próprio `<id>:1`) é o segundo candidato a espelho: medido aqui, sobreviveu a tudo. Não é a primeira escolha porque exige Luna e não está confirmado na TV.
7. **Privacidade:** o IndexedDB é legível por outros apps sideloaded na TV; o `profile` contém a authKey, mas no modo convidado (P3) não há conta. Se um dia houver login, avaliar cifrar o espelho.

## Como reproduzir

```bash
# todo o cenário (instalar v1, atualizar, reinstalar, outro app, reboot, desinstalar, cortes de energia)
webos/tools/emu-run -- webos/spikes/persistence/scenario.sh <pasta-de-evidências>
# janela do corte de energia (atrasos em segundos)
webos/tools/emu-run -- webos/spikes/persistence/power-cut.sh <pasta-de-evidências> 0 3 6 12
```

Arquivos:

- `app/`: a sonda (`persist.js`, ES5 para o Chromium 53). Em cada abertura lê o marcador deixado antes e grava um novo se não houver; nunca sobrescreve. Resultado em `window.__persist`.
- `build.sh <versão> <id> <saída>`: empacota a sonda; a v1 e a v2 só diferem na versão do `appinfo.json`.
- `scenario.sh`, `power-cut.sh`: os cenários acima (cada passo grava `<passo>.json` e `.png`).

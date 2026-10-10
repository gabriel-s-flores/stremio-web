# F0.8 · Persistência entre atualizações do app

Pergunta: o que o app empacotado (IPK, `file://`) mantém quando é atualizado, quando a TV reinicia e quando o app é desinstalado e reinstalado? O core do Stremio grava **tudo** em `localStorage`, então o login e a biblioteca dependem disso.

Medido no emulador webOS TV 4.0 (imagem oficial, Chromium 53). Origem do app: `file://<id-do-app>`; o app roda de `file:///media/developer/apps/usr/palm/applications/<id>/index.html`.

## Resultado

Legenda: ✅ sobrevive · ⚠ sobrevive com ressalva (ver a nota) · ❌ perdido · — sem suporte (a API falha no `file://`).

"Sobrevive" = a sonda achou o marcador **e** ele foi gravado **antes de a sessão do app começar** (`writtenAt` anterior ao início da sessão, rastreada de forma síncrona no `sessionStorage`). Um recarregamento da página dentro da mesma sessão não conta.

| Armazenamento | Reabrir o app | Atualizar (`ares-install` de versão nova, app aberto) | Reinstalar a mesma versão por cima | Reboot do webOS | Desinstalar + reinstalar | Corte de energia |
|---|---|---|---|---|---|---|
| `localStorage` | ✅ | ✅ | ✅ | ✅ | ❌ ⚠ não garantido (nota 1) | ⚠ perde a última escrita se o corte vier em < ~0,75 s (nota 2) |
| `indexedDB` | ✅ | ✅ | ✅ | ✅ | ✅ (⚠ nota 3) | ✅ |
| Luna db8 (`com.webos.service.db`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `sessionStorage` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ (esperado: só vale enquanto o app está aberto) |
| Cookies (persistente e de sessão) | — | — | — | — | — | — (o `document.cookie` aceita a escrita e não devolve nada) |
| WebSQL | — | — | — | — | — | — (`unable to open database file`) |
| Cache API | — | — | — | — | — | — (`Request scheme 'file' is unsupported`) |
| FileSystem API (`webkitRequestFileSystem`) | — | — | — | — | — | — (`SecurityError`) |

**Nota 1 · o `localStorage` nem sempre é apagado na desinstalação.** No `scenario.sh` ele é apagado (passo 08, em todas as rodadas). No `mirror-test.sh` do revisor (rodado com o pool de emuladores cheio) ele **sobreviveu** à desinstalação em 5 de 6 reservas, mesmo com "Removed package" e página nova. Nas minhas execuções não reproduzi: 0 de 48 reinstalações (4 reservas do `mirror-test.sh` com 8 reinstalações cada; `uninstall-timing.sh` 2×8 ciclos, variando de 1 a 8 s o tempo entre abrir e remover o app, uma delas com 3 laços de CPU dentro do guest). Não achei a causa; a hipótese que fica em aberto é contenção de CPU do **host**, que não testei por não querer sobrecarregar o pool compartilhado. Conclusão para a F3.5: **não contar com a desinstalação para limpar o `localStorage`**; a recomendação abaixo trata um `localStorage` parcial ou antigo.

**Nota 2 · corte de energia e o `localStorage`.** O Chromium grava o `localStorage` em lote, com atraso. Sobrescritas do contador (1 → 2), com o intervalo real entre a última escrita e o corte (corrigido pelo desvio do relógio):

| Intervalo até o corte | Amostras | `localStorage` perdeu a sobrescrita | IndexedDB e db8 perderam |
|---|---|---|---|
| ≤ 0,75 s | 499, 502, 515, 518, 673, 713 ms | **5 de 6** (499 ms foi a exceção) | 0 de 6 |
| 0,75 a 1 s | 869, 910, 916 ms | 0 de 3 | 0 de 3 |
| ≥ 1 s | 1141, 1180, 1361, 1676, 1731, 1745, 1892, 2674, 2736 ms (e 6 amostras entre 3,4 e 12,8 s) | 0 de 15 | 0 de 15 |

Gravações novas (não sobrescritas) sobreviveram em todos os cortes: 11 amostras, de 0,9 s a 12,8 s. Janelas abaixo de ~0,5 s não foram medidas. Fontes: `ciclo1/power-cut` (499 ms e os 12 s), `revisao-c2/power-cut*` (502, 515, 673, 713, 910, 916, 1731 ms) e `ciclo2/power-cut` (13 casos: 10 sobrescritas e 3 gravações novas), nas evidências da tarefa.

**Nota 3 · IndexedDB.** Sobrevive à desinstalação, mas é **compartilhado por todos os apps `file://`** (o app B leu o banco do app A), então também é legível por qualquer outro app sideloaded.

Outros fatos medidos:

- **Isolamento.** O `localStorage` e o db8 são separados por app: um segundo app (`...persistprobeb`) não enxergou os dados do primeiro. O IndexedDB não é isolado (nota 3).
- **Cota do `localStorage`:** com 1 MB já gravado, mais ~3,75 MB couberam antes de falhar, ou seja ~5 MB no total. A biblioteca do core vai para uma única chave (`library`/`library_recent`), então uma biblioteca muito grande pode estourar isso.
- **IndexedDB:** gravou e leu 1 MB sem problema.
- **db8:** `putKind` + `put` + `merge` funcionaram sem permissões extras no manifesto, e o dado (`kind` do app) sobreviveu a remover e instalar de novo. Falta confirmar na TV real.
- **Atualização:** o `ares-install` **relança o app sozinho**. Na sonda, o passo da atualização aparece com `carga=2` e com o `sessionStorage` já preenchido pela v2 (`nova(2.0.0)`). A segunda carga é a mesma sessão, e é por isso que o critério "gravado antes da sessão" é necessário.
- **Reboot:** o emulador não tem reboot gracioso (`reboot` exige root, o Luna nega `machineReboot` e o ACPI `system_powerdown` é ignorado). O reboot medido foi `sync` no guest + `system_reset` pelo QMP (o guest reiniciou de verdade). O QEMU também não simula o cache da eMMC da TV.

### Conflito com a documentação da LG

O exemplo oficial [WebStorage](https://github.com/webOS-TV-app-samples/WebStorage) da LG (citado em `docs/PESQUISA.md`, seção 5) diz que o `localStorage` de app empacotado "é apagado quando o usuário atualiza ou remove o app". No emulador, a **atualização não apaga**, e a remoção apaga na maioria das vezes (nota 1). Pode ser diferença entre o emulador e a TV (firmware, tipo de instalação), ou a doc estar desatualizada. **Só a TV real resolve**, então a pergunta (d) abaixo está na lista da Fase 8, e a recomendação foi escrita para funcionar mesmo que a atualização também apague o `localStorage`.

## O que o app grava no localStorage

O core grava no `localStorage` por `localStorage.getItem/setItem/removeItem`, chamados do worker através do `Bridge` com escopo `window` (`src/core/createTransport.ts`). As chaves que o core 0.65.0 usa (`stremio-core/src/constants.rs` e `stremio-core-web/src/env.rs`):

`installation_id`, `schema_version`, `profile`, `library`, `library_recent`, `streams`, `search_history`, `streaming_server_urls`, `notifications`, `dismissed_events`

(`calendar` está declarada em `constants.rs`, mas nada lê ou grava essa chave na 0.65.0: são **10 chaves**, não 11.) **A recomendação não usa lista fixa de chaves**: espelha tudo o que houver no `localStorage`, que é isolado por app e só tem chaves do Stremio. Assim, uma chave nova de uma versão futura do core é coberta sem mudança.

**O core não é o único que mexe nele.** `src/core/Error/Error.tsx:16-19` chama `window.localStorage.clear()` seguido de `window.location.reload()` no botão **CLEAR_DATA**, mostrado em `CoreProvider.tsx:92` quando o `init` do core falha. É o único caminho de recuperação de um storage corrompido ou incompatível. A recomendação abaixo existe, em grande parte, para **não quebrar esse botão**.

`profile` guarda a sessão (authKey), os addons instalados e as configurações. No modo convidado (P3), `library` e o histórico só existem localmente: perder o `localStorage` perde esses dados e não há como reconstruí-los.

## Recomendação para a F3.5

**Atualização e reboot não são problema** no emulador: o `localStorage` sobrevive. O que ele não aguenta é **desinstalar e reinstalar** (e, pela pesquisa, a expiração do Developer Mode remove os apps; e a doc da LG diz que até a atualização apaga). Para isso, espelhar o `localStorage` no IndexedDB. A implementação de referência está em `app/mirror.js` e foi testada no emulador com IndexedDB real (`mirror-test.sh`: 37 verificações por rodada, 4 rodadas em 4 reservas, 0 falhas; entre elas o controle negativo do item 5; o flush em `pagehide`/`visibilitychange` está implementado mas não foi exercitado).

**Modelo.** O `localStorage` continua sendo o que o core lê. O IndexedDB guarda uma cópia, uma entrada por chave, e só repõe o `localStorage` quando ele está **vazio ou parcial** no boot.

1. **Banco por app.** Nome `stremio-webos-persist:<appId>` (o id do `appinfo.json`). O IndexedDB é compartilhado por todos os apps `file://`, então um IPK de teste ou um build antigo com outro id não pode restaurar os dados um do outro. Um registro `meta` guarda `{ appId, state, epoch, pendingRestore, updatedAt }`, e o `appId` é **validado ao restaurar** (diferente → descarta a cópia). Uma chave `stremio_webos_persist_epoch` no `localStorage` guarda a **época** da cópia: é o que liga um `localStorage` à cópia que o acompanha.
2. **Boot que nunca trava o app.** Chamar `mirror.bootSafe(3000)` antes de `transport.init()` (`CoreProvider.tsx`, no `useEffect`):

   ```js
   mirror.bootSafe(3000)                       // nunca rejeita, nunca passa de 3 s
       .then((r) => log(r))                    // r.reason vai para a tela de diagnóstico (F3.6)
       .then(() => transport.init(props.appInfo))
   ```

   Se o IndexedDB der erro ou não responder (banco corrompido, cota esgotada por **outro** app `file://`, bloqueado), o `bootSafe` resolve com `reason: 'idb-error'` ou `'idb-timeout'`; o `init` roda mesmo assim, e o app segue só com o `localStorage` (o `watch()` fica desligado). Sem isso, um `boot()` que rejeita ou trava deixa **tela preta**, sem nem a tela de erro do core, e desinstalar o Stremio não resolve porque o banco é de todos. O `openDb` do `mirror.js` não guarda uma promessa rejeitada, então uma nova tentativa na mesma página funciona (testado). Se o timeout vence, uma restauração que ainda estivesse em andamento **não** copia nada para o `localStorage` depois que o `init` começou.
3. **Ordem das regras do `boot()`:**
   1. Marcador de "Limpar dados" presente → **não restaura**, apaga a cópia (`clear-data`).
   2. **O `localStorage` é a verdade** se (a) tem `schema_version` **e** `profile`, ou (b) tem a época da cópia, ou (c) não há cópia. Em (b) e (c), a cópia vira um retrato exato dele. Só em (a), sem a época, a cópia apenas **acrescenta e atualiza**: não apaga o que o `localStorage` não tem, para um `localStorage` incompleto não destruir a cópia boa (`localStorage-ok`).
   3. Sem cópia válida → nada a restaurar (`nothing-to-restore`).
   4. Cópia de outro `appId` → descarta (`app-mismatch`).
   5. Cópia com `pendingRestore = true` → **descarta em vez de restaurar de novo** (`unconfirmed-restore`).
   6. Senão: o `localStorage` está **vazio** (`restored`) ou **parcial**, sem as chaves essenciais e de outra época (`merged`). Grava `pendingRestore = true` **e espera a transação commitar**; depois copia **só as chaves que faltam**, sem pisar no que o `localStorage` já tem, e grava a época.
4. **`confirm()`** no `.then` do `transport.init` (`pendingRestore = false`). **`discard()`** no `.catch` do `init`, se houve restauração naquele boot (apaga a cópia). O `pendingRestore` **fica gravado** se o app for fechado e reaberto antes do `init` confirmar (só `confirm()`, `discard()` e `wipe()` zeram), e um boot que acha o `localStorage` cheio não o zera.
5. **`clear()`, o ponto de "Limpar dados".** O botão faz `localStorage.clear()` e `reload()` em seguida. Se o `clear()` não chegar ao espelho, o reload acha o `localStorage` vazio, **restaura o mesmo estado ruim** do IndexedDB, o `init` falha de novo e a tela de erro volta, sem fim, e nem desinstalar resolve (o IndexedDB sobrevive). Por isso o `clear()` embrulhado grava **de forma síncrona** um marcador no `sessionStorage` (`stremio_webos_persist_no_restore`, que sobrevive ao `reload()` imediato) e só então dispara a limpeza assíncrona da cópia; no boot seguinte o marcador vence (regra 3.1). O controle negativo do `mirror-test.sh` mostra que, **sem** o marcador, o mesmo reload restaura o estado ruim. **Quem impede o laço são o marcador e o `discard()`**; o `pendingRestore` é uma reserva para o caso em que o `localStorage` some por outro caminho.
6. **Espelhar as escritas.** Embrulhar `Storage.prototype.setItem` e `removeItem` (só quando `this === window.localStorage`), marcando a chave como suja e gravando em lote ~1 s depois (e também em `pagehide`/`visibilitychange`). O lote relê o valor atual de cada chave, então escritas seguidas viram uma só. O código do core não muda.
7. **Durabilidade das escritas recentes.** Para escritas recentes, o **IndexedDB e o db8 são mais duráveis que o `localStorage`** (nota 2: o `localStorage` perdeu a sobrescrita em 5 de 6 cortes a ≤ 0,75 s; o IndexedDB e o db8, em nenhum). A regra "`localStorage` não vazio é a verdade" **aceita perder a última escrita se a energia cair em menos de ~1 s**. É tolerável (o core regrava no próximo evento), mas está escrito aqui como decisão, não como acaso. Se um dia isso importar (por exemplo, a `authKey` logo depois de um login), a cópia tem o valor mais novo e dá para comparar `updatedAt` antes de preferir o `localStorage`; não está implementado.
8. **Reset por fora do fluxo normal.** `mirror.wipe()` apaga a cópia (cópia, `meta` e época). Expor na **tela de diagnóstico (F3.6)** como "limpar cópia de segurança", e aceitar uma flag de URL ou de `launchParams` (`?resetMirror`) para o caso de a UI nem abrir.
9. **O que não vai para o espelho:** `sessionStorage`, cookies, WebSQL, Cache API, FileSystem (não funcionam ou não valem).
10. **Se algo não sobreviver** (IndexedDB indisponível, banco bloqueado, vazio): o app segue com `localStorage` e começa limpo, sem erro visível. Registrar na tela de diagnóstico (F3.6) o `reason` do `boot`: `restored`, `merged`, `clear-data`, `localStorage-ok`, `nothing-to-restore`, `app-mismatch`, `unconfirmed-restore`, `idb-error`, `idb-timeout`.
11. **Reserva:** se (a) ou (b) abaixo falharem na TV, o db8 (`com.webos.service.db`, kind próprio `<id>:1`) é o segundo candidato a espelho: aqui sobreviveu a tudo, inclusive a sobrescrita seguida de corte. Não é a primeira escolha porque exige Luna e não está confirmado na TV.
12. **Privacidade:** o IndexedDB é legível por outros apps sideloaded na TV; o `profile` contém a authKey, mas no modo convidado (P3) não há conta. Se um dia houver login, avaliar cifrar o espelho.

### Perguntas para a Fase 8 (TV real)

- (a) O IndexedDB sobrevive à desinstalação na TV como no emulador?
- (b) O Developer Mode apaga o IndexedDB ao expirar?
- (c) O db8 aceita escrita de app de terceiros?
- (d) O `localStorage` sobrevive à **atualização** na TV, ou a doc da LG (ver acima) está certa? Ver os dois casos: `ares-install` por cima com o app aberto e com o app fechado.
- (e) O `localStorage` é mesmo apagado na desinstalação na TV (nota 1)? Se não for, a regra de mescla (3.2 e 3.6) é o que protege a cópia.

## Como reproduzir

```bash
# o cenário (instalar v1, atualizar, reinstalar, outro app, reboot, desinstalar + reinstalar)
webos/tools/emu-run -- webos/spikes/persistence/scenario.sh <pasta-de-evidências>
# cortes de energia: w<D> grava, o<D> grava e sobrescreve, D = segundos de espera antes do corte (casos podem se repetir)
webos/tools/emu-run -- webos/spikes/persistence/power-cut.sh <pasta-de-evidências> o0 o0 o0 o1 o2 w0
# a lógica de restauração da F3.5 (app/mirror.js); rode em várias reservas
webos/tools/emu-run -- webos/spikes/persistence/mirror-test.sh <pasta-de-evidências>
# o localStorage sobrevive à desinstalação? (LOAD=3 liga carga de CPU no guest)
LOAD=3 webos/tools/emu-run -- webos/spikes/persistence/uninstall-timing.sh <pasta-de-evidências>
```

Arquivos:

- `app/persist.js`: a sonda (ES5 para o Chromium 53). Em cada abertura lê o marcador deixado antes e grava um novo se não houver; nunca sobrescreve. Resultado em `window.__persist`. `__persistReset()`, `__persistRun()` e `__persistBump()` servem ao `power-cut.sh`.
- `app/mirror.js`: implementação de referência do espelho (`bootSafe`, `boot`, `watch`, `confirm`, `discard`, `wipe`, `flush`).
- `build.sh <versão> <id> <saída> [probe|mirror]`: empacota; a v1 e a v2 só diferem na versão do `appinfo.json`; o modo `mirror` não roda a sonda e deixa o `localStorage` limpo para o teste.
- `scenario.sh`, `power-cut.sh`, `mirror-test.sh`, `uninstall-timing.sh`: os cenários acima (cada passo grava um `.json`; o `scenario.sh` também grava um `.png`). No `mirror-test.sh`, se o `localStorage` sobrar depois de reinstalar, o fenômeno é registrado (`FENOMENO` no log) e o teste limpa com o `clear()` original numa página nova, para a lógica não depender do acaso da desinstalação.
- `summary.cjs`: resume um JSON da sonda (`SIM(v)` só se sobreviveu; `nova(v)` se foi gravado na própria sessão).

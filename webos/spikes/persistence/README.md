# F0.8 · Persistência entre atualizações do app

Pergunta: o que o app empacotado (IPK, `file://`) mantém quando é atualizado, quando a TV reinicia e quando o app é desinstalado e reinstalado? O core do Stremio grava **tudo** em `localStorage`, então o login e a biblioteca dependem disso.

Medido no emulador webOS TV 4.0 (imagem oficial, Chromium 53). Origem do app: `file://<id-do-app>`; o app roda de `file:///media/developer/apps/usr/palm/applications/<id>/index.html`.

## Resultado

Legenda: ✅ sobrevive · ❌ perdido · — sem suporte (a API falha no `file://`).

"Sobrevive" = a sonda achou o marcador **e** ele foi gravado **antes de a sessão do app começar** (`writtenAt` anterior ao início da sessão, rastreada de forma síncrona no `sessionStorage`). Um recarregamento da página dentro da mesma sessão não conta.

| Armazenamento | Reabrir o app | Atualizar (`ares-install` de versão nova, app aberto) | Reinstalar a mesma versão por cima | Reboot do webOS | Desinstalar + reinstalar | Corte de energia |
|---|---|---|---|---|---|---|
| `localStorage` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `indexedDB` | ✅ | ✅ | ✅ | ✅ | ✅ (⚠ ver abaixo) | ✅ |
| Luna db8 (`com.webos.service.db`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `sessionStorage` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ (esperado: só vale enquanto o app está aberto) |
| Cookies (persistente e de sessão) | — | — | — | — | — | — (o `document.cookie` aceita a escrita e não devolve nada) |
| WebSQL | — | — | — | — | — | — (`unable to open database file`) |
| Cache API | — | — | — | — | — | — (`Request scheme 'file' is unsupported`) |
| FileSystem API (`webkitRequestFileSystem`) | — | — | — | — | — | — (`SecurityError`) |

Corte de energia (`power-cut.sh`, 8 casos, cada um com banco, kind e `localStorage` apagados antes e regravados): gravação nova e **sobrescrita** de um registro existente (contador 1 → 2) nos três armazenamentos, cortando a VM **0,5 s, 0,9 s, 3,4 s, 3,5 s, 6,5 s, 6,8 s, 12,7 s e 12,8 s** depois da última gravação (intervalo real medido, corrigido pelo desvio de relógio). Nos 8 casos, o dado novo ou sobrescrito estava lá depois. Janelas menores que ~0,5 s não foram medidas.

Outros fatos medidos:

- **Isolamento.** O `localStorage` e o db8 são separados por app: um segundo app (`...persistprobeb`) não enxergou os dados do primeiro. O **IndexedDB não é isolado**: o app B leu o banco do app A. Todo app `file://` compartilha o mesmo armazenamento de IndexedDB. Por isso o banco **sobrevive à desinstalação** e fica **visível a qualquer outro app sideloaded**.
- **Cota do `localStorage`:** com 1 MB já gravado, mais ~3,75 MB couberam antes de falhar, ou seja ~5 MB no total. A biblioteca do core vai para uma única chave (`library`/`library_recent`), então uma biblioteca muito grande pode estourar isso.
- **IndexedDB:** gravou e leu 1 MB sem problema.
- **db8:** `putKind` + `put` + `merge` funcionaram sem permissões extras no manifesto, e o dado (`kind` do app) sobreviveu a remover e instalar de novo. Falta confirmar na TV real.
- **Atualização:** o `ares-install` **relança o app sozinho**. Na sonda, o passo da atualização aparece com `carga=2` e com o `sessionStorage` já preenchido pela v2 (`nova(2.0.0)`). A segunda carga é a mesma sessão, e é por isso que o critério "gravado antes da sessão" é necessário.
- **Reboot:** o emulador não tem reboot gracioso (`reboot` exige root, o Luna nega `machineReboot` e o ACPI `system_powerdown` é ignorado). O reboot medido foi `sync` no guest + `system_reset` pelo QMP (o guest reiniciou de verdade: uptime 110 s → 12 s). O QEMU também não simula o cache da eMMC da TV.

### Conflito com a documentação da LG

O exemplo oficial [WebStorage](https://github.com/webOS-TV-app-samples/WebStorage) da LG (citado em `docs/PESQUISA.md`, seção 5) diz que o `localStorage` de app empacotado "é apagado quando o usuário atualiza ou remove o app". No emulador, a **atualização não apaga**, só a remoção apaga. Pode ser diferença entre o emulador e a TV (firmware, tipo de instalação), ou a doc estar desatualizada. **Só a TV real resolve**, então a pergunta (d) abaixo está na lista da Fase 8, e a recomendação foi escrita para funcionar mesmo que a atualização também apague o `localStorage`.

## O que o app grava no localStorage

O core grava no `localStorage` por `localStorage.getItem/setItem/removeItem`, chamados do worker através do `Bridge` com escopo `window` (`src/core/createTransport.ts`). As chaves que o core 0.65.0 usa (`stremio-core/src/constants.rs` e `stremio-core-web/src/env.rs`):

`installation_id`, `schema_version`, `profile`, `library`, `library_recent`, `streams`, `search_history`, `streaming_server_urls`, `notifications`, `dismissed_events`

(`calendar` está declarada em `constants.rs`, mas nada lê ou grava essa chave na 0.65.0: são **10 chaves**, não 11.) **A recomendação não usa lista fixa de chaves**: espelha tudo o que houver no `localStorage`, que é isolado por app e só tem chaves do Stremio. Assim, uma chave nova de uma versão futura do core é coberta sem mudança.

**O core não é o único que mexe nele.** `src/core/Error/Error.tsx:16-19` chama `window.localStorage.clear()` seguido de `window.location.reload()` no botão **CLEAR_DATA**, mostrado em `CoreProvider.tsx:92` quando o `init` do core falha. É o único caminho de recuperação de um storage corrompido ou incompatível. A recomendação abaixo existe, em grande parte, para **não quebrar esse botão**.

`profile` guarda a sessão (authKey), os addons instalados e as configurações. No modo convidado (P3), `library` e o histórico só existem localmente: perder o `localStorage` perde esses dados e não há como reconstruí-los.

## Recomendação para a F3.5

**Atualização e reboot não são problema** no emulador: o `localStorage` sobrevive. O que ele não aguenta é **desinstalar e reinstalar** (e, pela pesquisa, a expiração do Developer Mode remove os apps; e a doc da LG diz que até a atualização apaga). Para isso, espelhar o `localStorage` no IndexedDB. A implementação de referência está em `app/mirror.js` e foi testada no emulador com IndexedDB real (`mirror-test.sh`, 22 verificações, 0 falhas, uma delas o controle negativo descrito no item 5; o flush em `pagehide`/`visibilitychange` está implementado mas não foi exercitado).

**Modelo.** O `localStorage` continua sendo a fonte da verdade que o core lê. O IndexedDB guarda uma cópia, uma entrada por chave, e só serve para repor o `localStorage` quando ele está **vazio** no boot.

1. **Banco por app.** Nome `stremio-webos-persist:<appId>` (o id do `appinfo.json`). O IndexedDB é compartilhado por todos os apps `file://`, então um IPK de teste ou um build antigo com outro id não pode restaurar os dados um do outro. Um registro `meta` guarda `{ appId, state, pendingRestore, updatedAt }`, e o `appId` é **validado ao restaurar** (diferente → descarta a cópia).
2. **`boot()` antes de `transport.init()`** (`CoreProvider.tsx`, no `useEffect`, encadeando `mirror.boot().then(() => transport.init(...))`), na ordem:
   1. Marcador de "Limpar dados" presente → **não restaura**, apaga a cópia.
   2. `localStorage` não vazio → ele é a verdade; atualiza a cópia a partir dele.
   3. `localStorage` vazio e cópia ausente/inválida → nada a restaurar (instalação nova).
   4. Cópia de outro `appId` → descarta.
   5. Cópia com `pendingRestore = true` (uma restauração anterior que o `init` nunca confirmou) → **descarta em vez de restaurar de novo**. É isso que impede o laço.
   6. Senão: grava `pendingRestore = true` **e espera a transação commitar**, depois copia as chaves para o `localStorage`.
3. **`confirm()`** no `.then` do `transport.init` (`pendingRestore = false`). **`discard()`** no `.catch` do `init`, se houve restauração naquele boot (apaga a cópia).
4. **Espelhar as escritas.** Embrulhar `Storage.prototype.setItem` e `removeItem` (só quando `this === window.localStorage`), marcando a chave como suja e gravando em lote ~1 s depois (e também em `pagehide`/`visibilitychange`). O lote relê o valor atual de cada chave, então escritas seguidas viram uma só. O código do core não muda.
5. **`clear()` — o ponto que a primeira versão desta recomendação errava.** O botão "Limpar dados" faz `localStorage.clear()` e `reload()` em seguida. Se o `clear()` não chegar ao espelho, o reload acha o `localStorage` vazio, **restaura o mesmo estado ruim** do IndexedDB, o `init` falha de novo e a tela de erro volta, sem fim, e nem desinstalar resolve (o IndexedDB sobrevive). Por isso o `clear()` embrulhado:
   - grava **de forma síncrona** um marcador no `sessionStorage` (`stremio_webos_persist_no_restore`), que sobrevive ao `reload()` imediato, e só depois dispara a limpeza assíncrona da cópia;
   - no boot seguinte, o marcador vence (regra 2.1): não restaura e termina de apagar a cópia.
   - O controle negativo do `mirror-test.sh` mostra que, **sem** o marcador, o mesmo reload restaura o estado ruim.
6. **Reset por fora do fluxo normal.** `mirror.wipe()` apaga a cópia (cópia e `meta`). Expor na **tela de diagnóstico (F3.6)** como "limpar cópia de segurança", e aceitar uma flag de URL ou de `launchParams` (`?resetMirror`) para o caso de a UI nem abrir.
7. **O que não vai para o espelho:** `sessionStorage`, cookies, WebSQL, Cache API, FileSystem (não funcionam ou não valem).
8. **Se algo não sobreviver** (IndexedDB indisponível, banco bloqueado, vazio): o app segue só com `localStorage` e começa limpo, sem erro visível. Registrar no diagnóstico (F3.6) o resultado do `boot()` (`reason`): `restored`, `clear-data`, `localStorage-ok`, `nothing-to-restore`, `app-mismatch`, `unconfirmed-restore`.
9. **Reserva:** se (a) ou (b) abaixo falharem na TV, o db8 (`com.webos.service.db`, kind próprio `<id>:1`) é o segundo candidato a espelho: aqui sobreviveu a tudo, inclusive a sobrescrita seguida de corte. Não é a primeira escolha porque exige Luna e não está confirmado na TV.
10. **Privacidade:** o IndexedDB é legível por outros apps sideloaded na TV; o `profile` contém a authKey, mas no modo convidado (P3) não há conta. Se um dia houver login, avaliar cifrar o espelho.

### Perguntas para a Fase 8 (TV real)

- (a) O IndexedDB sobrevive à desinstalação na TV como no emulador?
- (b) O Developer Mode apaga o IndexedDB ao expirar?
- (c) O db8 aceita escrita de app de terceiros?
- (d) O `localStorage` sobrevive à **atualização** na TV, ou a doc da LG (ver acima) está certa? Ver os dois casos: `ares-install` por cima com o app aberto e com o app fechado.

## Como reproduzir

```bash
# o cenário (instalar v1, atualizar, reinstalar, outro app, reboot, desinstalar + reinstalar)
webos/tools/emu-run -- webos/spikes/persistence/scenario.sh <pasta-de-evidências>
# cortes de energia: w<D> grava, o<D> grava e sobrescreve, D = segundos de espera antes do corte
webos/tools/emu-run -- webos/spikes/persistence/power-cut.sh <pasta-de-evidências> w0 w3 w6 w12 o0 o3 o6 o12
# a lógica de restauração da F3.5 (app/mirror.js)
webos/tools/emu-run -- webos/spikes/persistence/mirror-test.sh <pasta-de-evidências>
```

Arquivos:

- `app/persist.js`: a sonda (ES5 para o Chromium 53). Em cada abertura lê o marcador deixado antes e grava um novo se não houver; nunca sobrescreve. Resultado em `window.__persist`. `__persistReset()`, `__persistRun()` e `__persistBump()` servem ao `power-cut.sh`.
- `app/mirror.js`: implementação de referência do espelho (`boot`, `watch`, `confirm`, `discard`, `wipe`, `flush`).
- `build.sh <versão> <id> <saída> [probe|mirror]`: empacota; a v1 e a v2 só diferem na versão do `appinfo.json`; o modo `mirror` não roda a sonda e deixa o `localStorage` limpo para o teste.
- `scenario.sh`, `power-cut.sh`, `mirror-test.sh`: os cenários acima (cada passo grava um `.json`; o `scenario.sh` também grava um `.png`).
- `summary.cjs`: resume um JSON da sonda (`SIM(v)` só se sobreviveu; `nova(v)` se foi gravado na própria sessão).

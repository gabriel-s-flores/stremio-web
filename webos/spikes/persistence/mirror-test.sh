#!/usr/bin/env bash
# Prova no emulador a lógica de restauração recomendada para a F3.5 (app/mirror.js), com IndexedDB real:
#   restaura após desinstalar + reinstalar · "Limpar dados" (clear() + reload()) não restaura e não deixa laço ·
#   restauração que o init não confirmou é descartada · cópia de outro appId é descartada · caminho normal.
#
#   webos/tools/emu-run -- webos/spikes/persistence/mirror-test.sh <pasta-de-evidências>
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TOOLS="$(cd "$HERE/../../tools" && pwd)"
EVID="$(realpath -m "${1:?pasta de evidências}")"
: "${EMU_DEVICE:?rode dentro do emu-run}" "${EMU_CDP_PORT:?}"
APP="io.github.gabrielsflores.persistmirror"
PKG="$(mktemp -d)"; trap 'rm -rf "$PKG"' EXIT
mkdir -p "$EVID"
LOG="$EVID/mirror-test.log"; FAILS=0; INSTALLS=0; LS_SURVIVED=0
log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG" >&2; }
"$HERE/build.sh" 1.0.0 "$APP" "$PKG" mirror >/dev/null
IPK="$PKG/${APP}_1.0.0_all.ipk"
SSH=(ssh -o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa -o StrictHostKeyChecking=no
     -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=5
     -i "$HOME/webos-tv-sdk/run/ares_webos_emul" -p "${EMU_SSH_PORT:-6622}" developer@127.0.0.1)
uptime_s() { "${SSH[@]}" 'cut -d. -f1 /proc/uptime' 2>/dev/null || echo ?; }
ev() { node "$TOOLS/cdp.mjs" --port "$EMU_CDP_PORT" --target "$APP" eval "$1"; }   # uma expressão (Promise é aguardada)
evs() { ev "(function () { $1 })()"; }                                                # várias instruções, com return
# check <rótulo> <json> <predicado JS sobre x>
check() {
    if node -e 'const x = JSON.parse(process.argv[1]); process.exit(eval(process.argv[2]) ? 0 : 1)' "$2" "$3"; then
        log "  OK     $1  ->  $2"
    else
        log "  FALHOU $1  ->  $2   (esperado: $3)"; FAILS=$((FAILS + 1))
    fi
}
wait_mirror() { local i; for i in $(seq 1 60); do [[ "$(ev 'typeof window.__mirror' 2>/dev/null)" == object ]] && return 0; sleep 0.5; done; log "ERRO: __mirror não apareceu"; exit 1; }
# Desinstala e reinstala (o IndexedDB fica) e abre. O emulador NÃO garante que o localStorage seja apagado
# (ver uninstall-timing.sh): se sobrou algo, registra o fenômeno e limpa com o clear() original numa página
# NOVA, para que os testes de lógica não dependam do acaso da desinstalação.
fresh_install() {
    INSTALLS=$((INSTALLS + 1))
    ares-launch -d "$EMU_DEVICE" -c "$APP" >/dev/null 2>&1 || true
    ares-install -d "$EMU_DEVICE" --remove "$APP" >/dev/null 2>&1 || true
    ares-install -d "$EMU_DEVICE" "$IPK" >/dev/null
    ares-launch -d "$EMU_DEVICE" "$APP" >/dev/null
    wait_mirror
    local left; left="$(ev 'JSON.stringify(Object.keys(localStorage))')"
    if [[ "$left" != "[]" ]]; then
        LS_SURVIVED=$((LS_SURVIVED + 1))
        log "  FENOMENO o localStorage sobreviveu à desinstalação (reinstalação nº $INSTALLS, uptime do guest $(uptime_s) s): $left; limpando com o clear() original, página nova"
        ev '__mirror.rawClear.call(localStorage)' >/dev/null
    fi
}
launch() {         # fecha e reabre o app (o localStorage fica)
    ares-launch -d "$EMU_DEVICE" -c "$APP" >/dev/null 2>&1 || true
    ares-launch -d "$EMU_DEVICE" "$APP" >/dev/null
    wait_mirror
}
reload() {         # como o botão "Limpar dados": a ação e o reload() acontecem na própria página, sem pausa
    evs "window.__old = 1; setTimeout(function () { $1; location.reload(); }, 50); return 1;" >/dev/null
    local i; for i in $(seq 1 60); do sleep 0.5; [[ "$(ev 'typeof window.__old' 2>/dev/null)" == undefined && "$(ev 'typeof window.__mirror' 2>/dev/null)" == object ]] && return 0; done
    log "ERRO: a página não recarregou"; exit 1
}
seed() {           # estado "normal": boot vazio, watch, 3 chaves, flush, confirm
    check "boot vazio" "$(ev '__mirror.boot()')" 'x.restored === false && x.reason === "nothing-to-restore"'
    evs '__mirror.watch(); localStorage.setItem("profile", "{\"ok\":1}"); localStorage.setItem("library", "L1"); localStorage.setItem("schema_version", "3"); return 1;' >/dev/null
    ev '__mirror.flush().then(function () { return __mirror.confirm(); })' >/dev/null
}

log "=== M1: caminho normal, espelho de setItem/removeItem ==="
fresh_install
seed
check "espelho tem as 3 chaves e está confirmado" "$(ev '__mirror.read().then(function (s) { return { keys: Object.keys(s.kv).sort(), pending: s.meta.pendingRestore, app: s.meta.appId }; })')" 'x.keys.join() === "library,profile,schema_version" && x.pending === false && x.app === "'"$APP"'"'
evs 'localStorage.setItem("streams", "S"); localStorage.setItem("library", "L2"); return __mirror.flush().then(function () { localStorage.removeItem("streams"); return __mirror.flush(); });' >/dev/null
check "sobrescrita e removeItem chegam ao espelho" "$(ev '__mirror.read().then(function (s) { return { library: s.kv.library, hasStreams: "streams" in s.kv }; })')" 'x.library === "L2" && x.hasStreams === false'
reload 'void 0'
check "reload comum: localStorage manda, nada é restaurado" "$(ev '__mirror.boot()')" 'x.restored === false && x.reason === "localStorage-ok" && x.keys === 3'

log "=== M2: desinstalar + reinstalar restaura ==="
fresh_install
check "boot restaura do IndexedDB" "$(ev '__mirror.boot()')" 'x.restored === true && x.reason === "restored" && x.keys === 3'
check "localStorage voltou igual" "$(ev '__mirror.lsDump()')" 'x.profile === "{\"ok\":1}" && x.library === "L2" && x.schema_version === "3"'
check "restauração fica pendente até o init confirmar" "$(ev '__mirror.read().then(function (s) { return s.meta.pendingRestore; })')" 'x === true'
ev '__mirror.confirm()' >/dev/null
check "confirmada" "$(ev '__mirror.read().then(function (s) { return s.meta.pendingRestore; })')" 'x === false'

log "=== M3: \"Limpar dados\" (localStorage.clear() + reload()) não restaura e não faz laço ==="
evs '__mirror.watch(); return 1;' >/dev/null
reload 'localStorage.clear()'
check "após Limpar dados: sem restauração" "$(ev '__mirror.boot()')" 'x.restored === false && x.reason === "clear-data"'
check "localStorage vazio e espelho apagado" "$(ev '__mirror.read().then(function (s) { return { ls: Object.keys(__mirror.lsDump()).length, kv: Object.keys(s.kv).length }; })')" 'x.ls === 0 && x.kv === 0'
fresh_install
check "depois de desinstalar + reinstalar continua limpo (sem laço)" "$(ev '__mirror.boot()')" 'x.restored === false && x.reason === "nothing-to-restore"'

log "=== M3b: controle negativo. Sem o marcador síncrono, o mesmo reload RESTAURA o estado ruim (o laço que a regra evita) ==="
seed
fresh_install
check "restaura" "$(ev '__mirror.boot()')" 'x.restored === true'
ev '__mirror.confirm()' >/dev/null
reload '__mirror.rawClear.call(localStorage)'
check "sem o marcador: restaurou de novo (é o que o clear-data impede)" "$(ev '__mirror.boot()')" 'x.restored === true && x.reason === "restored"'
evs '__mirror.rawClear.call(localStorage); return __mirror.wipe();' >/dev/null

log "=== M4: restauração que o init não confirmou é descartada (guarda contra laço) ==="
seed
fresh_install
check "restaura" "$(ev '__mirror.boot()')" 'x.restored === true'
# o init "falha" e o usuário limpa por um caminho que perde o marcador (clear original, sem o watch)
reload '__mirror.rawClear.call(localStorage)'
check "segunda tentativa: descarta em vez de restaurar de novo" "$(ev '__mirror.boot()')" 'x.restored === false && x.reason === "unconfirmed-restore"'
reload 'void 0'
check "e depois não há mais nada para restaurar" "$(ev '__mirror.boot()')" 'x.restored === false && x.reason === "nothing-to-restore"'

log "=== M5: cópia de outro appId é descartada ==="
seed
reload '__mirror.rawClear.call(localStorage)'
ev 'new Promise(function (res) { var r = indexedDB.open(__mirror.dbName, 1); r.onsuccess = function () { var t = r.result.transaction("meta", "readwrite"); t.objectStore("meta").put({ appId: "outro.app", state: "valid", pendingRestore: false }, "meta"); t.oncomplete = function () { res(1); }; }; })' >/dev/null
check "appId diferente: não restaura" "$(ev '__mirror.boot()')" 'x.restored === false && x.reason === "app-mismatch"'

log "=== M6: reset externo do espelho (wipe) ==="
seed
ev '__mirror.wipe()' >/dev/null
check "wipe esvazia a cópia" "$(ev '__mirror.read().then(function (s) { return Object.keys(s.kv).length + (s.meta ? 1 : 0); })')" 'x === 0'

evs '__mirror.rawClear.call(localStorage); return __mirror.wipe();' >/dev/null   # estado limpo para os próximos casos

log "=== M7: localStorage PARCIAL (sem schema_version/profile, de outra época) é mesclado, não sobrescreve a cópia ==="
seed
fresh_install
ev '__mirror.rawSetItem.call(localStorage, "library_recent", "P_LOCAL")' >/dev/null
check "mescla com a cópia" "$(ev '__mirror.boot()')" 'x.restored === true && x.reason === "merged" && x.keys === 3'
check "ficou com tudo, e o valor local não foi pisado" "$(ev '__mirror.lsDump()')" 'x.profile === "{\"ok\":1}" && x.schema_version === "3" && x.library === "L1" && x.library_recent === "P_LOCAL"'
ev '__mirror.confirm()' >/dev/null
evs '__mirror.rawClear.call(localStorage); return __mirror.wipe();' >/dev/null

log "=== M8: localStorage com as chaves essenciais é a verdade, e a cópia boa não perde o que ele não tem ==="
seed
fresh_install
ev '(function () { __mirror.rawSetItem.call(localStorage, "profile", "NOVO"); __mirror.rawSetItem.call(localStorage, "schema_version", "3"); return 1; })()' >/dev/null
check "localStorage manda" "$(ev '__mirror.boot()')" 'x.restored === false && x.reason === "localStorage-ok"'
check "a cópia continua com a library que o localStorage não tem" "$(ev '__mirror.read().then(function (s) { return { library: s.kv.library, profile: s.kv.profile }; })')" 'x.library === "L1" && x.profile === "NOVO"'
evs '__mirror.rawClear.call(localStorage); return __mirror.wipe();' >/dev/null

log "=== M9: restauração não confirmada continua pendente se o app é reaberto (só confirm() zera) ==="
seed
fresh_install
check "restaura" "$(ev '__mirror.boot()')" 'x.restored === true'
launch
check "reabrir: localStorage manda" "$(ev '__mirror.boot()')" 'x.reason === "localStorage-ok"'
check "pendingRestore continua true" "$(ev '__mirror.read().then(function (s) { return s.meta.pendingRestore; })')" 'x === true'
reload '__mirror.rawClear.call(localStorage)'
check "clear sem o marcador: descarta em vez de restaurar de novo" "$(ev '__mirror.boot()')" 'x.restored === false && x.reason === "unconfirmed-restore"'

log "=== M10: IndexedDB com erro não trava nem derruba o app (bootSafe) ==="
reload 'void 0'
check "bootSafe com indexedDB.open falhando" "$(ev '(function () { window.__realOpen = indexedDB.open; indexedDB.open = function () { var r = {}; setTimeout(function () { r.error = new Error("simulado"); r.onerror && r.onerror(); }, 0); return r; }; return __mirror.bootSafe(2000); })()')" 'x.restored === false && x.reason === "idb-error"'
check "watch() não faz nada com o IndexedDB quebrado" "$(ev '(function () { __mirror.watch(); return Storage.prototype.setItem === __mirror.rawSetItem; })()')" 'x === true'
check "voltando a abrir, o boot normal funciona (sem promessa rejeitada em cache)" "$(ev '(function () { indexedDB.open = window.__realOpen; return __mirror.boot(); })()')" 'x.reason === "nothing-to-restore" || x.reason === "localStorage-ok"'

log "=== M11: IndexedDB que nunca responde: bootSafe resolve no timeout ==="
reload 'void 0'
check "bootSafe(1500) com indexedDB.open sem resposta" "$(ev '(function () { var t0 = Date.now(); indexedDB.open = function () { return {}; }; return __mirror.bootSafe(1500).then(function (r) { r.ms = Date.now() - t0; return r; }); })()')" 'x.restored === false && x.reason === "idb-timeout" && x.ms >= 1400 && x.ms < 3000'

log "reinstalações: $INSTALLS · localStorage sobreviveu à desinstalação em $LS_SURVIVED"
log "falhas: $FAILS"
log fim
[[ "$FAILS" -eq 0 ]]

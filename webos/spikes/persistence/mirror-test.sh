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
LOG="$EVID/mirror-test.log"; FAILS=0
log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG" >&2; }
"$HERE/build.sh" 1.0.0 "$APP" "$PKG" mirror >/dev/null
IPK="$PKG/${APP}_1.0.0_all.ipk"
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
fresh_install() {  # desinstala e reinstala (apaga o localStorage; o IndexedDB fica) e abre
    ares-launch -d "$EMU_DEVICE" -c "$APP" >/dev/null 2>&1 || true
    ares-install -d "$EMU_DEVICE" --remove "$APP" >/dev/null 2>&1 || true
    ares-install -d "$EMU_DEVICE" "$IPK" >/dev/null
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

log "falhas: $FAILS"
log fim
[[ "$FAILS" -eq 0 ]]

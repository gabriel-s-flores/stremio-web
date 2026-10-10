#!/usr/bin/env bash
# Gera service/ca.js a partir das raízes ISRG em certs/ (baixadas de letsencrypt.org/certificates).
# Rodar de novo quando o Let's Encrypt publicar raízes novas.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
{
    echo "// Gerado por gen-ca.sh a partir de certs/*.pem. Não editar à mão."
    echo "'use strict';"
    echo "module.exports = ["
    for pem in "$HERE"/certs/*.pem; do
        name="$(openssl x509 -in "$pem" -noout -subject -nameopt multiline | sed -n 's/^ *commonName *= *//p')"
        fp="$(openssl x509 -in "$pem" -noout -fingerprint -sha256 | cut -d= -f2)"
        echo "    // $name, SHA-256 $fp"
        echo -n "    '"
        awk 'NF { printf "%s\\n", $0 }' "$pem"
        echo "',"
    done
    echo "];"
} > "$HERE/service/ca.js"
echo "service/ca.js: $(grep -c BEGIN "$HERE/service/ca.js") raízes"

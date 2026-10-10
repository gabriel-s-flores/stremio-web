# webOSTV.js 1.2.13

Biblioteca oficial da LG para apps web do webOS TV (Luna, `deviceInfo`, `platformBack`, teclado).
Suportada a partir do webOS TV 4.0. Os arquivos estão aqui sem nenhuma alteração.

| Item | Valor |
|---|---|
| Versão | 1.2.13 (março de 2026) |
| Origem | https://webostv.developer.lge.com/assets/library/webOSTVjs-1.2.13.zip |
| Notas de versão | https://webostv.developer.lge.com/develop/references/webostvjs-release-notes |
| Licença | Apache License 2.0 (`LICENSE-2.0.txt`, incluído no zip da LG) |
| Baixado em | 2026-10-09 |

## sha256

```
507c759f65a035122afead166608e8c7f444961468c3570245f0982c8f855ff6  webOSTVjs-1.2.13.zip
2e83e028aef8651ef0b79b25a70c7ebc076a36781486a68623634bc0c2162670  webOSTV.js
aa204c8b925b3214e9aa0f047a2874f8dda8aa0bb452936ca819368b349f0a51  webOSTV-dev.js
cb5e8e7e5f4a3988e1063c142c60dc2df75605f4c46515e776e3aca6df976e14  LICENSE-2.0.txt
```

Conferir: `sha256sum -c` com as três últimas linhas, dentro desta pasta.

## Uso no build

O build webOS (`webos/webpack/app.js`) copia `webOSTV.js` e a licença para `build-webos/webOSTV/`,
e o `index.html` do webOS carrega `webOSTV/webOSTV.js` antes do bundle (global `webOS`).
O `webOSTV-dev.js` (APIs de desenvolvimento) fica só versionado, fora do IPK.

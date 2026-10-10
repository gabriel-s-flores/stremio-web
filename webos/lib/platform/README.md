# platform

Plataforma webOS do app (F3.1): detecção em runtime, nome da plataforma para o `stremio-video` e leitura das capacidades da TV pelo Luna.

- JS puro em CommonJS, sem dependências, dentro do ES2016 do Chromium 53.
- **Nome da plataforma:** o Bowser dá `webos` (minúsculas) e o `stremio-video` só escolhe o `WebOsVideo` com `webOS`. O override `src/common/Platform/device.webos.js` (só no build webOS, mecanismo da F1.1) resolve `Platform.name` como `webOS` quando `isWebOS()` é verdadeiro. Fora do webOS cai no nome do Bowser, como o upstream.
- **webOSTV.js:** carregado pelo `index.html` do webOS (F1.1), define `window.webOS`. O módulo só usa `webOS.service.request`; não usa `webOS.deviceInfo`, que assina o `arccontroller`/`eim`, e **nunca** chama `com.webos.media/subscribe` (congela o `currentTime` no emulador, D3a).

## Uso

```js
const { isWebOS, readCapabilities, getCapabilities } = require('./webos/lib/platform');

isWebOS();                       // UA com "Web0S", ou window.PalmSystem / window.webOS
readCapabilities().then((c) => { // nunca rejeita
    c.dolbyVision;               // tv.config.supportDolbyHDRContents (boolean | null)
    c.dolbyAtmos;                // tv.config.supportDolbyTVATMOS
    c.edidType;                  // tv.model.edidType (null no emulador)
    c.dts;                       // tv.hw.dtsType ("DTS HD" no emulador)
    c.model;                     // { name, firmware, sdk, uhd } de tv.systemproperty/getSystemInfo
});
getCapabilities();               // resultado em cache, ou null antes da primeira leitura
```

Saída: `{ platform, available, dolbyVision, dolbyAtmos, edidType, dts, soundModeType, model, missing, errors }`.

- Duas chamadas Luna sem `subscribe`: `com.webos.service.config/getConfigs` e `com.webos.service.tv.systemproperty/getSystemInfo`. Configs que a TV não conhece vêm em `missing` (não é erro); `null` significa "desconhecido".
- **Cache:** a leitura em andamento é compartilhada e o resultado bem-sucedido fica em cache (`readCapabilities(true)` força). Falha total (`available: false`) não é guardada, e a próxima chamada tenta de novo.
- **Tolerância a erro:** cada chamada tem timeout (5 s) e exceções viram erro em `errors`; uma fonte pode falhar sem derrubar a outra.
- **Boot:** `device.webos.js` chama `startCapabilitiesRead`, que só dispara a leitura depois do evento `load` (e de um `setTimeout`), sem trabalho síncrono. Publica `window.__webos = { platform, capabilities }` (sondas CDP e a tela de diagnóstico da F3.6) e registra uma linha `[webos] platform=… capabilities=…` no console.
- `edidType` é o mesmo valor que o `WebOsVideo` lê sozinho para liberar DTS/TrueHD; a F5.x decide com ele e com o `canPlayType`.

## Testes

- Unitários com Luna simulado: `pnpm exec jest webos/lib/platform` (valores do emulador, TV com DV/Atmos/EDID, cache, falhas, timeout, sem `webOS.service`).
- Emulador: `pnpm webos:package` e `webos/tools/emu-run --timeout 15 -- webos/tests/platform/emulator.sh <pasta>` (instala, abre, espera `window.__webos.capabilities` e falha se a plataforma não for `webOS`).

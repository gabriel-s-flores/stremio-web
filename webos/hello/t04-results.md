# T0.4 — Evidências

Data da execução: **2026-09-05**  
Ambiente: Windows 11, webOS TV Emulator 5.0.0, firmware 02.00.30, CLI 3.2.1, Chromium 68.0.3440.106.  
Dispositivo: `emulator` (`developer@127.0.0.1:6622`).

## Escopo

O teste valida a decisão D1 da Fase 0 usando:

- `https://v3-cinemeta.strem.io/manifest.json` como addon público real.
- `https://web.stremio.com/?t04=1` como origem hosted HTTPS com certificado válido.
- O app isolado `com.stremio.webos.hello.t04.packaged` para o cenário `file://`.
- O app `com.stremio.webos.hello.t04.https` como wrapper hosted.

O hosted usa o Service Worker real publicado em `web.stremio.com`, gerado pelo
Workbox. Isso valida o caminho de produção, embora a página não seja uma fixture
HTML mínima.

## Packaged

Estado retornado pelo probe:

```json
{
  "href": "file:///media/developer/apps/usr/palm/applications/com.stremio.webos.hello.t04.packaged/index.html",
  "origin": "file://com.stremio.webos.hello.t04.packaged-webos",
  "protocol": "file:",
  "fetchCors": {
    "ok": true,
    "status": 200,
    "type": "cors",
    "contentType": "application/json; charset=utf-8",
    "bodyLength": 6395,
    "manifestId": "com.linvo.cinemeta"
  },
  "cookie": { "writeAttempted": true, "readable": false },
  "localStorage": { "writeAttempted": true, "readable": true },
  "serviceWorker": {
    "propertyPresent": true,
    "controllerBefore": false,
    "result": "rejected",
    "error": {
      "name": "SecurityError",
      "message": "Failed to register a ServiceWorker: The URL protocol of the current origin ('file://com.stremio.webos.hello.t04.packaged-webos') is not supported."
    }
  }
}
```

O CDP capturou para o request do addon apenas `Accept-Language` e `User-Agent`;
nenhum cabeçalho `Origin` foi enviado pelo WebAppManager neste cenário. A resposta
incluiu `Access-Control-Allow-Origin: *`. O request explícito com `mode: no-cors`
retornou `type: opaque`, sem corpo legível.

O `localStorage` permaneceu disponível após fechar e reabrir o app. O cookie
permaneceu vazio. O registro do Service Worker falhou de forma determinística por
`SecurityError`, mesmo com um `sw.js` válido dentro do pacote.

## Hosted HTTPS

Primeiro registro:

```json
{
  "href": "https://web.stremio.com/?t04=1",
  "origin": "https://web.stremio.com",
  "protocol": "https:",
  "cookie": { "writeAttempted": true, "readable": true },
  "localStorage": { "writeAttempted": true, "readable": true },
  "fetchCors": {
    "ok": true,
    "status": 200,
    "type": "cors",
    "manifestId": "com.linvo.cinemeta"
  },
  "serviceWorker": {
    "propertyPresent": true,
    "result": "registered",
    "scope": "https://web.stremio.com/",
    "ready": true,
    "activeAfterReady": true,
    "controllerAfter": false
  }
}
```

Após reload e relaunch do app:

```json
{
  "origin": "https://web.stremio.com",
  "cookie": true,
  "localStorage": true,
  "controller": true,
  "controllerUrl": "https://web.stremio.com/service-worker.js"
}
```

O CDP capturou `Origin: https://web.stremio.com` no request para o addon, com
resposta HTTP 200 e `Access-Control-Allow-Origin: *`.

## Decisão

**D1 ratificada:** hosted HTTPS é o modelo primário; packaged permanece secundário.

R06 foi confirmado: Service Worker não é utilizável no app packaged `file://`.
R12 não foi reproduzido com o endpoint Cinemeta testado: o addon aceitou a requisição
e o WebAppManager nem enviou `Origin` no cenário packaged. Isso não elimina o risco
para addons ou servidores que imponham uma política diferente.

Consequências para as próximas fases:

- T0.5 pode usar `web.stremio.com` como referência de hosting/TLS.
- T3.5 deve manter o fallback sem cookies no packaged.
- T3.6 deve manter Workbox no hosted e desligar o updater no packaged.
- T6.4 deve documentar que o pacote não recebe atualizações por Service Worker.

# Port webOS TV 4.x

Branch de integração do port do Stremio Web para a LG OLED55C8PSA (webOS TV 4.0, Chromium 53).

- `development` espelha o upstream (Stremio/stremio-web); esta branch recebe o port.
- Cada tarefa vem de uma branch `webos/<tarefa>` por PR, criada e revisada pelo orquestrador
  (threads do T3 Code) e mergeada aqui depois da revisão.
- Premissas: todo desenvolvimento e teste no emulador webOS TV 4.0 (a TV real só na validação
  final), áudio nos alto-falantes da TV, streams só de debrid (sem servidor de streaming).

Plano, pesquisa e regras do orquestrador ficam no kit da máquina de desenvolvimento
(`~/webos-tv-sdk/docs/`): `PLANO-PORT-WEBOS4.md`, `PESQUISA.md` e `ORQUESTRADOR.md`.

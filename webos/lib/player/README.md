# player

Player do app no webOS (F5.1): o que o `Player` manda para o `stremio-video` na TV e o que some da interface.

- JS puro em CommonJS, sem dependências (o `React` do `removeElements` é injetado), dentro do ES2016 do Chromium 53.
- **Implementação:** com `platform: 'webOS'` (F3.1) e sem `streamingServerURL` (F6.1), o `stremio-video` 0.0.98 escolhe `withVideoParams(withHTMLSubtitles(WebOsVideo))`: `<video src>` com a URL do stream, o pipeline nativo da TV e Luna (`com.webos.media`) só para faixas e legendas. Sem `withStreamingServer`, portanto **sem transcodificação**. O `WebOsVideo` **não** assina `com.webos.media/subscribe` (congela o `currentTime` no emulador, D3a); nada no app assina.
- **`toWebOsLoadArgs(args)`:** aplicado pelo `src/routes/Player/useVideo.webos.js` a todo `load`. Fixa `forceTranscoding: false`, `streamingServerURL: null` (garante o caminho acima mesmo com `?forceTranscoding` na rota) e `maxAudioChannels: 32` (o `surroundSound` ligado: a TV faz o downmix para os alto-falantes, P2). O resto dos argumentos passa como veio.
- **Velocidade (`PLAYBACK_SPEED_SUPPORTED = false`):** velocidade ≠ 1x fica sem áudio na C8. O `useVideo.webos.js` expõe `state.playbackSpeed = null` (o upstream já lê `null` como "sem velocidade": menu e atalhos `speedMenu`/`speed` desligados) e ignora `setPlaybackSpeed` (o "segurar espaço = 2x" do `usePlaybackSpeedHold` não muda nada). O `src/routes/Player/ControlBar/ControlBar.webos.js` roda o render do `ControlBar` original e tira só o botão cujo `onClick` é `onToggleSpeedMenu` (`removeElements`), sem copiar o arquivo.

## Testes

- `pnpm exec jest webos/lib/player`: argumentos do `load`, `removeElements` e a guarda de deriva (`test/upstream.test.js`), que falha se o upstream mudar os pontos de que os overrides dependem.
- Emulador: `webos/tests/player/emulator.sh` (ver o cabeçalho do script).

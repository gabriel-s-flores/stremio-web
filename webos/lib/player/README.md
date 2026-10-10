# player

Player do app no webOS (F5.1): o que o `Player` manda para o `stremio-video` na TV e o que some da interface.

- JS puro em CommonJS, sem dependências (o `React` do `removeElements` é injetado), dentro do ES2016 do Chromium 53.
- **Implementação:** com `platform: 'webOS'` (F3.1) e sem `streamingServerURL` (F6.1), o `stremio-video` 0.0.98 escolhe `withVideoParams(withHTMLSubtitles(WebOsVideo))`: `<video src>` com a URL do stream, o pipeline nativo da TV e Luna (`com.webos.media`) só para faixas e legendas. Sem `withStreamingServer`, portanto **sem transcodificação**. O `WebOsVideo` **não** assina `com.webos.media/subscribe` (congela o `currentTime` no emulador, D3a); nada no app assina.
- **`toWebOsLoadArgs(args)`:** aplicado pelo `src/routes/Player/useVideo.webos.js` a todo `load`. Fixa `forceTranscoding: false`, `streamingServerURL: null` (garante o caminho acima mesmo com `?forceTranscoding` na rota) e `maxAudioChannels: 32` (o `surroundSound` ligado: a TV faz o downmix para os alto-falantes, P2). O resto dos argumentos passa como veio.
- **Velocidade (`PLAYBACK_SPEED_SUPPORTED = false`):** velocidade ≠ 1x fica sem áudio na C8. O `useVideo.webos.js` expõe `state.playbackSpeed = null` (o upstream já lê `null` como "sem velocidade": menu e atalhos `speedMenu`/`speed` desligados) e ignora `setPlaybackSpeed` (o "segurar espaço = 2x" do `usePlaybackSpeedHold` não muda nada). O `src/routes/Player/ControlBar/ControlBar.webos.js` roda o render do `ControlBar` original com `playbackSpeed: NATIVE_PLAYBACK_SPEED` (1) e tira só o botão cujo `onClick` é `onToggleSpeedMenu` (`removeElements`), sem copiar o arquivo. A barra recebe 1, e não `null`, porque o `SeekBar` divide o "tempo restante" pela velocidade (com `null` mostraria `Infinity:NaN:NaN-`).
- **Consumidores de `playbackSpeed`** no Player e o valor que cada um vê: `ControlBar`/`SeekBar` recebem 1; `Indicator` ignora `null`; `SpeedMenu` nunca abre; `usePlaybackSpeedHold` usa `?? 1` e o setter não faz nada; `Player.js` usa o valor nos gates. A guarda de deriva lista esses arquivos, e um consumidor novo a faz falhar.

## Testes

- `pnpm exec jest webos/lib/player`: argumentos do `load`, `removeElements`, os dois overrides contra dublês do upstream (`test/overrides.test.js`) e a guarda de deriva (`test/upstream.test.js`), que falha se o upstream mudar os pontos de que os overrides dependem.
- Emulador: `webos/tests/player/emulator.sh` (ver o cabeçalho do script).

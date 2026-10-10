# Bateria de testes de mídia

Roda uma lista de cenários de reprodução no emulador webOS TV 4.0 e gera um relatório em markdown.

```bash
node webos/tools/media-suite/run.mjs                    # os 7 cenários sintéticos, em paralelo no pool
node webos/tools/media-suite/run.mjs --only t1-mp4-h264-aac,t2-mkv-multiaudio
node webos/tools/media-suite/run.mjs --list
node --test webos/tools/media-suite                     # testes da lógica de avaliação (sem emulador)
```

Opções: `--scenarios <json>`, `--only id,id`, `--jobs N` (cenários lançados ao mesmo tempo; padrão: todos),
`--retries N` (padrão 1), `--media-dir <pasta>`, `--out <pasta>`, `--timeout-min N` (por cenário, padrão 6).
Saída padrão: `~/webos-tv-sdk/run/media-suite/<data>/` com `relatorio.md`, `resultados.json`,
`media-server.log` e uma pasta por cenário (`play.json`, `tela-app.png`, `tela-vm.png`, `emu-run.log`).
O código de saída é 0 só se todos os cenários passarem.

## Como funciona

1. Gera as mídias que faltam com `webos/tools/gen-media.sh` (ffmpeg; pasta `~/webos-tv-sdk/media-tests/suite`, com `GOP=24`:
   keyframe a cada 1 s, porque o pipeline do webOS faz seek para o keyframe **anterior** e um vídeo curto com um só
   keyframe volta ao início).
2. Deriva as expectativas de cada arquivo com `ffprobe` (duração, resolução, quantidade e idioma das
   faixas de áudio) e soma o que o cenário declara em `expect`.
3. Sobe **um** `media-server.mjs` numa porta livre (Range, CORS e `/redirect/<arquivo>` com 302) e empacota
   a sonda (`webos/tools/probe/app`) uma vez.
4. Para cada cenário, chama `emu-run -- run-one.sh …`: boot limpo, uma instância do pool, instala a sonda,
   roda o `play-test.sh` e desliga. **Um cenário por boot**, porque o emulador só reproduz de forma
   confiável a primeira mídia após o boot. Os sete `emu-run` são lançados juntos; quem manda é o pool
   (`EMU_POOL_SIZE`, padrão 4), então só roda em paralelo o que couber nas instâncias livres.
5. Avalia o resultado e cruza com o log do servidor (redirect seguido, Range com offset > 0 no seek).
6. Só repete a tentativa (novo boot) quando **não houve resultado** (falha de infraestrutura). Expectativa
   não cumprida nunca é repetida.

## Formato de `scenarios.json`

```json
{
    "defaults": { "redirect": true, "seconds": 8, "expect": { "events": ["playing"], "rangeSeek": true } },
    "scenarios": [
        { "id": "t4-mkv-h264-eac3", "title": "…", "file": "t4_h264_eac3.mkv", "seconds": 8, "seek": 5,
          "expect": { "audioTracks": { "count": 1, "languages": ["en"] } } }
    ]
}
```

| Campo | Significado |
|---|---|
| `file` / `url` | Arquivo da pasta de mídias, ou link completo (`{base}` vira `http://10.0.2.2:<porta>`) |
| `redirect` | Serve por `/redirect/<arquivo>` (302, como links de debrid) |
| `seconds`, `seek` | Argumentos do `play-test.sh`: duração do teste; o seek (em s) acontece na metade do tempo |
| `luna` | `true` assina `luna://com.webos.media/subscribe` (no emulador congela o `currentTime`) |
| `derive` | `false` desliga a derivação por `ffprobe` (obrigatório com `url`) |
| `expect.noError` | Sem erro do `<video>` (padrão: verifica) |
| `expect.events` | Eventos que precisam ocorrer (`seeked` é exigido sozinho quando há `seek`) |
| `expect.duration`, `size` | `[min, max]` em s; `"1280x720"` |
| `expect.minCurrentTime` | Padrão: `seek + 1` quando há seek |
| `expect.minTimeupdates` | Mínimo de eventos `timeupdate` |
| `expect.audioTracks` | `{ "count": N, "languages": ["en", "pt"] }` (ISO 639-1, como o webOS entrega) |
| `expect.redirect` | Redirect 302 e depois requisição ao arquivo no log do servidor |
| `expect.rangeSeek` | Alguma requisição com `Range: bytes=N-` e N > 0 (em MKV, pode vir também do índice Cues; o `seeked` é a prova do seek) |

## Limites conhecidos

- Reprodução de HEVC 10-bit é em software e pode ficar abaixo do tempo real quando várias VMs disputam a CPU;
  as expectativas de progresso são folgadas de propósito.
- Sem HDR, Dolby Vision, Atmos nem DTS/TrueHD reais no emulador (ver `docs/PESQUISA.md`, seção 7). Os
  cabeçalhos de amostras reais em `webos/tests/media/headers/` servem a testes de **parsing**, não de reprodução.

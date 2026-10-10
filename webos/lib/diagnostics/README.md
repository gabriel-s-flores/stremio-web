# diagnostics

Tela de diagnóstico do app no webOS TV 4.x (F3.6, plano D10): reúne o que a TV, o Chromium e o app expõem, para a Fase 8 (validação na C8 real) e para depurar o emulador. Só existe no build webOS.

- JS puro em CommonJS, sem dependências, dentro do ES2016 do Chromium 53.
- **Nada disso roda no boot.** A tela é um chunk carregado sob demanda (`React.lazy` na rota) e a coleta só acontece quando ela abre (ou no botão Refresh). No boot ficam só: `registry.js` (alguns timestamps e a lista de seções), um listener de `keydown` para o atalho do controle e, na rota do Board, um `MutationObserver` que se desliga no primeiro item de catálogo (o custo medido aparece na própria tela, em "Board watcher cost").

## Como abrir a tela

1. **Atalho do controle remoto, de qualquer rota:** as quatro teclas coloridas em ordem, **vermelho, verde, amarelo, azul**, cada uma até 2,5 s depois da anterior (`shortcut.js`). Não consome as teclas. Existe porque a barra de navegação ainda não é alcançável por setas (F4.1) e a sessão na TV não pode depender dela.
2. **Settings → Diagnostics:** item no fim do menu da esquerda de Settings (`Menu.webos.tsx`), alcançável com as setas.
3. **Rota direta:** `#/webos-diagnostics` (a rota é comum: o Back da F3.2 volta pelo histórico, para a rota de onde se veio).

Na tela: setas para cima e para baixo percorrem os botões e as seções (cada seção é focável para a página rolar).

## O que mostra

| Seção | Conteúdo |
|---|---|
| App | versão do app, hash do commit (`COMMIT_HASH`), versão do core (`package.json` do core vendorizado) |
| Environment | user agent, versão do Chromium, plataforma resolvida (`webOS`), tela, janela, idioma, threads, `deviceMemory` |
| Core | variante em uso e o motivo (`getCoreLoaderStatus()` do worker, pelo Bridge), estado e erro do carregador, preferência e origem, valor pedido em `localStorage['webos.coreVariant']`, tempos do carregador, memória do core |
| Boot times | `DOMContentLoaded` e `load` (`performance.timing`), início do init do core, **core pronto**, **Board montado**, **primeiro item do Board**, instante em que a tela abriu, custo do observador |
| WebAssembly | `WebAssembly` presente, `validate`, `Module`, `Instance`, `Memory`, `Table`, `compile` assíncrono |
| TV capabilities (Luna) | `supportDolbyHDRContents`, `supportDolbyTVATMOS`, `edidType`, `hw.dtsType`, modelo/firmware/SDK, configs desconhecidas (nova leitura forçada, `readCapabilities(true)` da F3.1) |
| Media (canPlayType) | `canPlayType` e `MediaSource.isTypeSupported` das linhas da tabela da C8 (`canplay.js`): H.264, HEVC Main10, VP9, AV1, DV P5/P7/P8 (`dvh1`/`dvhe`), AAC, AC-3, E-AC-3/JOC, TrueHD, DTS (`dtsc/dtsh/dtse/dtsx`), FLAC, Opus, MKV, MPEG-TS, HLS |
| Memory | `performance.memory` (quantizado pelo Chromium 53: serve para tendência, não para valor exato), `deviceMemory`, serviço Luna `com.webos.memorymanager/getCurrentMemState` (tentativa; um app comum recebe "Denied" no emulador, e a resposta fica no relatório) |
| Certificate proxy | ponto de extensão da F3.7 (veja abaixo); sem a F3.7, "not integrated yet" |

`canPlayType` só diz que o pipeline conhece o tipo, nunca que vai tocar: a resposta real é o checklist de mídia da Fase 8. JOC (Atmos) viaja no codec `ec-3`, que o `canPlayType` não distingue do E-AC-3 comum.

A RSS do processo (o que o gerenciador de memória do webOS julga) só aparece por SSH no emulador/TV; não há API de página para ela.

## Trocar a variante do core

Os botões **Core: wasm2js / WebAssembly / default + restart** gravam `localStorage['webos.coreVariant']` (`wasm`, `wasm2js`, ou removem a chave) e recarregam a página; o carregador do core (`webos/core/loader.js`) lê a chave quando o worker sobe. O botão da escolha atual mostra "(current)". A tela volta aberta, porque o hash permanece.

## Exportar o relatório

Sem `navigator.clipboard` no Chromium 53, e sem biblioteca de QR code (seria uma dependência nova para um relatório de ~7 KB, grande para um QR): o relatório fica num **bloco de texto selecionável** no fim da tela (um Magic Remote seleciona arrastando). Os botões:

- **Copy report:** seleciona o bloco e chama `document.execCommand('copy')` (funciona onde houver área de transferência, como no emulador com o inspector).
- **Save report:** grava em `localStorage['webos.diagnostics.report']` e registra o texto no console (`[webos-diagnostics]`), para ler pelo inspector (`ares-inspect`).
- Para sondas CDP: `window.__webos.diagnostics` (objeto) e `window.__webos.diagnosticsText` (texto), atualizados a cada coleta.

## API (`index.js`)

```js
const { collectDiagnostics, formatReport, getSection } = require('./webos/lib/diagnostics');

collectDiagnostics({ app: { version, commit, coreVersion } })  // nunca rejeita
    .then((report) => {
        report.generatedAt;               // ISO
        report.sections;                  // [{ id, title, data, rows: [[rótulo, valor], …] }]
        getSection(report, 'tv');         // dados de uma seção, por id
        formatReport(report);             // texto simples, uma seção por bloco
    });
```

- Ids: `app`, `environment`, `core`, `boot`, `webAssembly`, `tv`, `media`, `memory`, `certificateProxy`.
- Cada fonte falha sozinha: um erro vira `{ error }` (ou "unavailable: …") na própria seção.
- Opções para teste: `window`, `request` (compatível com `webOS.service.request`), `getCoreStatus()`, `readCapabilities(force)`, `registry`, `timeoutMs`, `now()`.
- `getRequestedVariant(storage)` / `setRequestedVariant(storage, variant)` leem e gravam a chave da variante; `VARIANT_KEY` é igual ao `PREFER_KEY` do carregador (um teste garante).

## Ponto de extensão: outras seções (F3.7, F5.x…)

```js
const { registerSection } = require('./webos/lib/diagnostics/registry'); // pequeno, seguro no boot

registerSection('certificateProxy', 'Certificate proxy', () => ({ running: true, port: 8123 }));
```

`collect()` devolve um objeto (ou uma promessa) e só roda quando o relatório é coletado. O `id` `certificateProxy` substitui o texto "not integrated yet". Registrar o mesmo id duas vezes troca a seção. Não importe `index.js` no boot: ele é o chunk lazy.

## Marcas de boot (`registry.js`)

`mark(nome)` guarda `performance.now()` (a mesma linha do tempo da definição de "core pronto" da F1.4: `window.core` atribuído). Quem marca:

- `coreInitStart` e `coreReady`: `src/core/createTransport.webos.ts` (override gerado, `webos/tests/no-server/overrides.js`);
- `boardMounted` e `boardFirstItem`: `src/router/routerPaths.webos.js`, na rota do Board (primeiro `[class*="meta-item-container"]` dentro de `.routes-container`).

`boardFirstItem` é o primeiro item de catálogo no DOM, não o primeiro quadro pintado (a definição de "Board visível" da F1.6, medida por uma sonda externa com `requestAnimationFrame`): costuma ser um pouco anterior.

## Testes

- Unitários (Luna, `window` e status do core simulados): `pnpm exec jest webos/lib/diagnostics`.
- Os overrides gerados (`createTransport.webos.ts`, `Menu.webos.tsx`) seguem o teste de deriva do upstream: `pnpm exec jest webos/tests/no-server`.
- Emulador, depois de `pnpm webos:package`:
  - `webos/tools/emu-run --timeout 15 [--profile c8] -- webos/tests/diagnostics/emulator.sh <pasta>`: sobe até o Board, abre a tela, salva o relatório (JSON e texto) e uma captura;
  - `webos/tools/emu-run --timeout 15 -- webos/tests/diagnostics/remote.sh <pasta>`: só com o controle remoto (atalho, setas, Copy/Save, troca da variante do core com reinício, Settings → Diagnostics).

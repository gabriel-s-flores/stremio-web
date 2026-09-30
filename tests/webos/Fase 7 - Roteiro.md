# Fase 7 — Roteiro de aceite

Para cada rodada registrar commit/build, packaged ou hosted, data, operador,
modelo, firmware, SDK e UA Chromium, resultado por linha (pass/fail/blocked),
evidência e issue/exceção. Não salvar senha, token ou URL de mídia privada.
Usar conta de teste e conteúdo autorizado. Nenhuma linha está executada por padrão.

| Ambiente | Estado nesta entrega |
| --- | --- |
| Emulador webOS 5.0 / Chromium 68 | Pendente de conexão e boot do app completo |
| TV webOS 5.x | Pendente; instalação manual pelo desenvolvedor |
| webOS 4.x / 6.x | Informativo, fora do escopo oficial |
| Desktop/web | Build e suites locais; interação manual pendente |

## T7.3 — Executar em emulador e TV

| Rota/fluxo | Ação e resultado esperado | Emulador | TV |
| --- | --- | --- | --- |
| Boot | Cold launch deslogado → Intro, logado → Board interativa | pendente | pendente |
| Intro/Login | Teclado virtual, credencial inválida, login válido, logout | pendente | pendente |
| Board | Catálogos, scroll 2 eixos, warning servidor ausente | pendente | pendente |
| Discover | Trocar catálogo/filtros, navegar 500+ itens e segurar setas | pendente | pendente |
| Library/ContinueWatching | Add/remove e resume na posição salva | pendente | pendente |
| Calendar | Células 2:3, seletor e detalhes com Back | pendente | pendente |
| MetaDetails | Vídeos/streams, assistido, externos desativados | pendente | pendente |
| Search | Teclado virtual, resultados, cruzar colunas | pendente | pendente |
| Addons | Instalar/desinstalar addon de teste, recarregar catálogo | pendente | pendente |
| Settings | Idioma, servidor remoto, flags, close/relaunch preserva | pendente | pendente |
| Player | Executar roteiro da Fase 5, incluindo erro e Back | pendente | pendente |
| Lifecycle | Background pausa conforme configuração, retorno e relaunch | pendente | pendente |

## T7.4 — Medições

Usar build debug para métricas; repetir no packaged final para avaliar overhead.
Manter túnel `ares-inspect` aberto. Listar alvos em `CDP_ENDPOINT/json`, usar ID
ou URL exata do app; o coletor rejeita alvo ausente ou ambíguo.

```
pnpm quality:webos bundle build
pnpm quality:webos assess metrics.json
pnpm quality:webos collect http://127.0.0.1:9998 TARGET_ID boot.json
pnpm quality:webos collect http://127.0.0.1:9998 TARGET_ID navigation.json 480 navigate
pnpm quality:webos collect http://127.0.0.1:9998 TARGET_ID playback.json 240 observe
```

Coletor usa Node 22 e CDP antigo (sem frontend DevTools moderno). Conexão falha
produz JSON `blocked` e exit 1. Amostras persistem durante execução; interrupção
mantém `incomplete`. `collection-complete` significa apenas coleta finalizada.
Setas percorrem um ciclo sem OK/Back; não provam cobertura de rotas nem binge.
Exceções contadas não incluem seus textos/dados de conta. Crash/desconexão encerra
ou sinaliza a coleta. Relacionar cada arquivo ao dispositivo e commit no registro.

Cold boot: repetir ≥20 lançamentos frios, calcular p95 de paint/Board interativa.
Para `assess`, preencher JSON numérico com `firstPaintMs`, `bootInteractiveMs`,
`bootHeapBytes`, `scrollHeapBytes`, `scrollFps`, `frameP95Ms`. Usar p95 das
rodadas de boot e o pior heap observado em cada contexto. Falha/ausência sai 1.
Budgets T0.6: paint ≤1500 ms, Board ≤5000 ms, heap pós-boot ≤256 MiB,
scroll ≤384 MiB, ≥45 FPS e frame p95 ≤22,2 ms. `unmeasured` nunca é aprovação.
Coletor não classifica heap automaticamente como boot/scroll; registrar contexto
antes de comparar. FPS exige iniciar/parar medição na página debug existente.
Coleta isolada não prova p95 de múltiplos boots. Avaliar jank com hold nativo RCU,
IntersectionObserver de imagens e sombras/animações nas listas longas.
Bundle gzip representa transporte; packaged lê arquivos locais. Comparar builds
com o mesmo commit/configuração; total sozinho não isola impacto do core-js.

## T7.5 — Soak e rede

Navegação 8 h: alternar também rotas manualmente; capturar screenshots a cada
30 min no DevTools remoto, heap da página, workers/WASM e memória do processo.
Playback 4 h 1080p + 10 episódios em binge: observar imagem/áudio, transições,
controles e retomada. Heap CDP exclui workers, GPU e vídeo nativo; não ajustar
`requiredMemory=384` com base apenas nele. Comparar baseline/final na mesma rota,
repetir ciclo para diferenciar cache limitado de crescimento contínuo.
Aplicar throttle, offline e reconexão no inspector/rede de teste; verificar erro
compreensível e recuperação. Restaurar rede ao final. Registrar crash/OOM,
interrupções e defeitos; não aceitar soak interrompido como aprovado.

## T7.7–T7.8 — Regressão e acessibilidade

No desktop repetir login, atalhos, navegação, clipboard, links e player.
Build equivalente não prova interação. Na TV 1080p verificar foco sempre visível,
texto a distância de uso, contraste (4,5:1 texto normal / 3:1 texto grande),
controle remoto sem mouse, modais/teclado sem foco preso, nomes dos controles.
Audio guidance é opcional v1.x; manifesto não anuncia suporte não validado.

Aceite final: todas as linhas nos dois dispositivos, budgets ou exceções com
plano, soak sem OOM/crash e regressão desktop comprovada. Gates pendentes impedem
 declarar a fase integralmente validada.

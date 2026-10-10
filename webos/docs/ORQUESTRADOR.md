# Orquestrador nativo do T3 para o port webOS 4

- **Data:** 2026-10-09
- **Status:** proposta. Nada foi implementado.
- **Objetivo:** executar as Fases 0 a 7 do [plano do port](PLANO-PORT-WEBOS4.md) sem você presente (AFK), e parar na Fase 8 (TV real).

## 1. Requisitos

1. **Nativo do T3.** Todo agente que trabalha no projeto é uma **thread do T3**, visível na barra lateral, com a conversa completa, chamadas de ferramenta, diff, terminal e PR. Os subagentes de cada thread aparecem no **painel de Agentes** dessa thread.
2. **Nada oculto.** Nenhum processo em segundo plano (Python ou outro) controla agentes. Tudo o que coordena é visível no T3:
   - os turnos do orquestrador;
   - as chamadas ao `t3ctl`, um comando de linha sem estado, sem daemon;
   - as mensagens entre threads;
   - os arquivos de estado em markdown.
3. **AFK de verdade.** O orquestrador continua sozinho entre tarefas, sobrevive a limites de uso e a falhas de agentes, e para nos pontos definidos.
4. **Premissas do port valem para todos os agentes:** só emulador (P1), alto-falantes da TV (P2), só debrid (P3).

## 2. O que o T3 oferece (verificado no T3 instalado, servidor 0.0.45)

| Recurso do T3 | Uso no orquestrador |
|---|---|
| **Threads com worktree e branch próprias**, turnos, interrupção, arquivamento | Cada tarefa ganha uma thread isolada na sua branch `port/<tarefa>` |
| **PR vinculado à thread** (ferramenta `link_pull_request`); a thread é "assentada" quando o PR é mergeado | Status do PR ao lado de cada thread; threads concluídas saem da frente sozinhas |
| **Painel de Agentes** por thread: subagentes, lotes e workflows com status ao vivo, última ferramenta, modelo, effort, tokens e o script do workflow | Ver os subagentes de cada agente |
| **API de orquestração** (`POST /api/orchestration/dispatch`, `GET /api/orchestration/snapshot`, `GET /api/orchestration/threads/:id`), a mesma que a interface usa: `thread.turn.start` com `bootstrap.createThread` + `prepareWorktree` cria a thread, prepara a worktree e envia a tarefa | O orquestrador cria e acompanha threads como você faria pela interface |
| **Pareamento de clientes** em *Configurações → Connections → Create pairing link*, com permissões ("View environment", "Operate tasks"…); o cliente aparece em *Authorized clients* e pode ser revogado | Acesso do orquestrador à API com escopo mínimo, e um "botão de desligar" na sua mão |
| **Mensagens entre sessões**: as threads do T3 se enxergam como sessões do Claude | O agente avisa o orquestrador quando termina; a mensagem aparece nas duas threads |
| **Notificações no celular** (app móvel e Live Activities) | Acompanhar de longe |

Ressalva: a API de orquestração é interna. Ela é usada pela própria interface e por clientes pareados, mas não tem documentação pública e pode mudar numa atualização do T3. O `t3ctl` verifica a versão do protocolo (`orchestrationProtocolVersion: 1`); se a resposta mudar, o orquestrador pausa e avisa. Durante uma execução AFK, convém não atualizar o T3.

## 3. Arquitetura: três níveis, todos visíveis

```
T3 · projeto stremio-web (barra lateral)
├── 🎛️ Orquestrador webOS4         thread em /loop, não edita código
│      painel de Agentes: subagentes leves (triagem de relatórios)
├── 🔨 T1.2 · Babel chrome53        thread implementadora, worktree webos/t1.2, PR → webos
│      painel de Agentes: subagentes (exploração, validação no emulador, auto-revisão)
├── 🔍 T1.2 · Revisão               thread revisora independente, só leitura
├── 🔨 T2.1 · PostCSS …
└── (threads concluídas: PR mergeado, thread assentada ou arquivada)
```

- **Nível 1, Orquestrador.** Uma thread do T3 rodando o `/loop` do Claude Code em ritmo próprio. A cada iteração:
  1. relê o estado;
  2. confere os agentes;
  3. decide;
  4. despacha;
  5. faz merge;
  6. atualiza o painel;
  7. agenda o próximo despertar.

  Não escreve código do app.
- **Nível 2, Agentes de tarefa.** Threads do T3 criadas pelo orquestrador via API, como você as criaria na interface:
  - **Implementador:** worktree nova a partir de `webos`, branch `port/<tarefa>`.
  - **Revisor:** thread separada e independente, só leitura, sobre o commit do PR.
  - **Correções:** voltam para a mesma thread implementadora como uma nova mensagem do orquestrador, visível nela.
- **Nível 3, Subagentes.** Ferramenta Agent dentro de cada thread (exploração, rodar o roteiro de testes no emulador, auto-revisão). Aparecem no painel de Agentes da thread que os criou.

## 4. Como roda sem nada oculto

| Peça | O que é | Onde você vê |
|---|---|---|
| **Motor** | `/loop` em modo autoritmado na thread do orquestrador. Cada iteração é um turno; ao terminar, ele agenda o próximo despertar | Turnos e despertares na thread do orquestrador |
| **`t3ctl`** | CLI pequena, sem estado e sem daemon: `snapshot`, `spawn`, `status`, `send`, `interrupt`, `archive`. Cada uso é um comando Bash do orquestrador | Chamadas de ferramenta na thread do orquestrador |
| **Avisos de conclusão** | O agente termina enviando uma mensagem ao orquestrador. A cada despertar, o orquestrador também confere o estado pela API, como rede de segurança | Mensagem nas duas threads; consultas na do orquestrador |
| **Estado** | Arquivos em `~/webos-tv-sdk/orquestrador/`: `PAINEL.md` (quadro de tarefas), `DIARIO.md` (decisões e eventos), `tarefas/<id>/brief.md` e `relatorio.md`, `evidencias/`. O orquestrador não confia na memória da conversa: a cada iteração ele relê esses arquivos | Abrindo os arquivos no T3 |
| **Emulador** | Pool de instâncias QEMU (portas distintas) com uma trava por instância (`flock`) e boot limpo por cenário. É usado pelos scripts de teste, não controla agentes | Comandos e evidências nas threads dos agentes |

## 5. Ciclo de uma tarefa

1. **Pronta.** As dependências foram mergeadas. O orquestrador escreve o `brief.md`: objetivo, critérios de aceite (do plano), contexto, limites, premissas P1 a P3, como validar no emulador e como avisar ao terminar. Depois cria a thread implementadora.
2. **Implementação.** Explorar, implementar e validar: testes, lint, `es-check` e roteiro no emulador com capturas. Em seguida, escrever o `relatorio.md` com as evidências, abrir o PR para `webos`, vincular o PR à thread e avisar o orquestrador.
3. **Conferência objetiva.** O orquestrador confere se as checagens passam e se as evidências existem. Se faltar algo, devolve à própria thread.
4. **Revisão independente.** Uma thread revisora verifica por conta própria: roda os testes e o emulador, cobre correção e regressão, escopo e premissas, e dá o veredito no relatório.
5. **Correções.** O orquestrador envia a devolutiva à thread implementadora e repete a partir do passo 3, por no máximo 2 ciclos. Depois disso a tarefa vira **bloqueada**, com o motivo no painel, e ele segue com as tarefas independentes.
6. **Merge.** O orquestrador faz o merge do PR em `webos`. O T3 assenta a thread quando o PR é mergeado. Em seguida, ele atualiza o painel e o diário e arquiva as threads concluídas.

**Gates do plano** (como o G0 da Fase 0): o orquestrador avalia pelos critérios objetivos escritos no plano. Se um critério falhar, ele para a frente afetada, registra no diário e avisa você.

## 6. Concorrência, recursos e limites

- **Padrão:** 2 agentes de tarefa ao mesmo tempo, mais 1 revisão. Ajustável no painel.
- **Emulador:** 2 instâncias (1 GB e 3 vCPUs cada) com trava; cada cenário de mídia roda num boot limpo, por causa da limitação medida no emulador.
- **Máquina** (8 núcleos, 31 GB): builds pesados passam por uma trava `build` (`flock`) para não disputar CPU com os emuladores.
- **Limites de uso do Claude:**
  - Se um agente parar por limite ("session limit… resets HH:MM"), o orquestrador agenda o despertar para depois do reset e retoma a thread com "continue de onde parou".
  - O próprio orquestrador sempre deixa um despertar agendado antes de encerrar o turno; assim um limite ou uma falha não o desligam.
- **Retomada:** toda thread começa lendo o `git log`, o `git status` e o próprio relatório, então uma tarefa interrompida continua de onde parou.

## 7. Onde você vê cada coisa

| Quero ver… | Onde |
|---|---|
| O que o orquestrador decidiu e por quê | Thread **🎛️ Orquestrador webOS4** e `DIARIO.md` |
| Situação geral (fase, tarefas, PRs, bloqueios) | `PAINEL.md` (o orquestrador também resume a cada iteração) |
| O que um agente está fazendo agora | A thread dele: conversa, ferramentas, diff, terminal |
| Os subagentes de um agente | Painel de Agentes daquela thread (status, atividade, tokens) |
| O código entregue | PR vinculado à thread e diff no T3 ou no GitHub |
| Provas de que funciona no emulador | `relatorio.md` e `evidencias/` (capturas, JSON da sonda, logs) |
| De longe | Notificações do T3 no celular |

## 8. Controle e segurança

- **Pausar:** dizer "pausar" na thread do orquestrador, ou criar `~/webos-tv-sdk/orquestrador/PAUSAR`. Ele termina o que está fazendo e não despacha mais nada.
- **Parar tudo:** Stop na thread do orquestrador e **revogar o cliente "Orquestrador webOS4"** em *Connections*, o que corta o acesso à API na hora. Qualquer agente pode ser interrompido direto na própria thread.
- **Acesso mínimo:** o pareamento leva só "View environment" e "Operate tasks", sem terminais e sem gestão de acesso. O token fica em arquivo `0600` fora do repositório e nunca aparece em logs.
- **Git:**
  - só as branches `webos` e `port/*` no seu fork;
  - nunca `development`, nunca force-push em `webos`;
  - merge só com a revisão aprovada e as checagens passando;
  - nenhum sync com o upstream durante a execução, a menos que você peça.
- **Premissas:** sem TV real, sem servidor de streaming, sem torrents.
- **Credenciais de teste** (conta Stremio da Fase 6): arquivo `0600` fora do repositório, lido só pelos agentes que precisam.

## 9. Modelos e esforço (proposta)

| Papel | Modelo | Effort |
|---|---|---|
| Orquestrador | Opus 5.5 | high |
| Implementador | Opus 5.5 (tarefas complexas) ou Sonnet 5.5 (mecânicas, ex. fallbacks CSS) | high / medium |
| Revisor | Opus 5.5 | high |
| Subagentes (exploração, rodar testes) | Sonnet 5.5 ou Haiku 5.5 | medium |

O orquestrador registra no painel o modelo e o effort de cada tarefa, que podem ser trocados por tarefa.

## 10. Construção do orquestrador (antes de rodar AFK)

| Etapa | Entrega | Aceite |
|---|---|---|
| **O0 Integração** (precisa de você uma vez) | Você cria o link de pareamento ("View environment" + "Operate tasks", rótulo "Orquestrador webOS4"); o `t3ctl` troca o código por um token | O `t3ctl` lista projetos e threads; cria uma thread de teste numa worktree, ela roda e termina; o orquestrador detecta o fim pela API e pela mensagem; um subagente da thread de teste aparece no painel de Agentes; a thread é arquivada e a branch de teste removida |
| **O1 `t3ctl`** | CLI sem dependências, com teste de fumaça e checagem da versão do protocolo | `spawn`, `status`, `send`, `interrupt`, `archive` e `snapshot` funcionam contra o T3 real |
| **O2 Emulador para vários agentes** | `emulator-qemu.sh` com instâncias (portas e overlays por instância), dispositivos ares `emu1` e `emu2`, trava por instância, roteiros de teste com boot limpo | Dois agentes validam ao mesmo tempo sem colisão |
| **O3 Playbook e backlog** | `ORQUESTRADOR-PLAYBOOK.md` (regras do orquestrador), modelos de brief e relatório, backlog das Fases 0 a 7 com dependências e critérios de aceite, `PAINEL.md` e `DIARIO.md` iniciais | Backlog revisado por você |
| **O4 Ensaio com você olhando** | Uma tarefa real e de baixo risco, ponta a ponta: implementação, PR, revisão, merge | Tudo visível no T3 e quadro atualizado |
| **O5 Execução AFK** | Você abre a thread do orquestrador e inicia o `/loop` | Para sozinho na Fase 8 ou num bloqueio, e avisa |

## 11. Decisões que preciso de você

1. **Autorização AFK:** o orquestrador pode, sem perguntar:
   - criar e arquivar threads no projeto stremio-web;
   - commitar e dar push nas branches `webos` e `port/*` do seu fork;
   - abrir PRs e fazer merge em `webos` depois da revisão aprovada.
2. **Concorrência e modelos:** 2 agentes simultâneos e a tabela da seção 9. Ok ou prefere outro equilíbrio entre custo e velocidade?
3. **Pareamento:** criar o link em *Connections* no momento da etapa O0.
4. **Conta Stremio de teste** com addon de debrid, para a Fase 6.
5. **Avisos no celular:** quais eventos (gate, bloqueio, fase concluída, fim).

## 12. Alternativa sem pareamento (modo reduzido)

O orquestrador numa thread só, usando subagentes e Workflows do Claude Code. O T3 mostra isso no painel de Agentes (status ao vivo, atividade, tokens e script do workflow), mas **nenhum agente tem thread própria**: não dá para abrir a conversa completa de cada um, conversar com ele ou ver o diff e o PR por agente. Fica como plano B caso a API do T3 mude ou você não queira parear um cliente.

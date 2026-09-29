# Recuperação do acesso ao planejamento — 29/09/2026

## Diagnóstico comprovado

A sessão usa `/home/dev/Projects/stremio-web`. O vault existia em
`/workspace/stremio`, mas faltava o caminho irmão `/home/dev/Projects/stremio`.
Os dois checkouts stremio-web são diretórios distintos, ambos em `407f981e` no
momento da inspeção, com alterações documentais locais apenas no checkout desta
sessão. Nenhum deles foi removido ou sincronizado.

O histórico de uma sessão anterior aponta explicitamente `/workspace/stremio`
como destino da documentação. O script Termux `bin/start-dev` monta
`$HOME/projects` em `/workspace`; o histórico de shell registra cópias dos
repositórios para `/workspace`. Não foi encontrado o comando original que copiou
o vault, portanto não se atribui sua execução a um agente específico.

## Origem e integridade

- Origem encontrada: `/data/data/com.termux/files/home/transfer/stremio-memory`
  (diretório com data de modificação de 27/09).
- Cópia de trabalho: `/data/data/com.termux/files/home/projects/stremio`
  (diretório com data de modificação de 29/09, 03:02).
- `/workspace/stremio` e a cópia de trabalho têm o mesmo dispositivo/inode:
  representam os mesmos arquivos, não duplicatas para apagar.
- Os 90 arquivos, incluindo os 80 Markdown, têm caminhos relativos e SHA-256
  idênticos entre origem e cópia. Nenhum conteúdo ou nome foi reconstruído.

## Correção

Criado `/home/dev/Projects/stremio` como link simbólico para o caminho persistente
`/data/data/com.termux/files/home/projects/stremio`. Assim `../stremio` funciona
nos dois checkouts, com uma única cópia de trabalho e sem depender do bind
`/workspace` no checkout em `/home/dev/Projects`.

Adicionado `AGENTS.md` aos dois checkouts, com a localização do vault e a distinção
entre eles. Este relatório e o manifesto também ficam nos dois checkouts.
A origem da transferência foi preservada. Nenhuma duplicata perdida de Markdown
foi encontrada além dessa origem; nenhum vault ou checkout foi apagado.

## Verificação

Manifestos comparados antes e depois da correção: origem, diretório persistente,
`/workspace/stremio` e `/home/dev/Projects/stremio` idênticos. As sete tarefas
T4.6–T4.12 foram lidas do arquivo original da Fase 4. O manifesto JSON registra
os caminhos relativos e hashes de todos os arquivos recuperados.

Esta intervenção corrige a localização da documentação; não implementa T4.6–T4.12.

O manifesto e o inventário registram a recuperação original (80 Markdown).
Atualizações posteriores do port acrescentam planos/evidências e alteram o vault
de trabalho; a origem em `transfer/stremio-memory` permanece preservada.

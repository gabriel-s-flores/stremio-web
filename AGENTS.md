# Localização do planejamento Stremio / webOS

O vault de planejamento fica em `../stremio`,
ao lado deste checkout. Leia os arquivos existentes; não reconstrua tarefas a
partir dos títulos ou solicite novamente o conteúdo antes de verificar os caminhos.

Caminhos verificados em 29/09/2026:

- `/home/dev/Projects/stremio`: link para o diretório persistente abaixo.
- `/data/data/com.termux/files/home/projects/stremio`: diretório persistente do vault.
- `/workspace/stremio`: o mesmo diretório persistente, via bind do `start-dev`.
- `/data/data/com.termux/files/home/transfer/stremio-memory`: origem da transferência;
  preservar como fonte, não usar como segunda cópia de trabalho.

O planejamento T4.6–T4.12 está em
`../stremio/11 - Port webOS 5/Fase 4 — Navegação TV e Controle Remoto.md`.
As linhas 69–105 continham essas tarefas na verificação acima.

Antes de trabalhar, confira `pwd`, `git status` e a existência de `../stremio`.
Se o link não estiver acessível, confira os caminhos persistente e `/workspace`
acima. Não confunda os checkouts `/home/dev/Projects/stremio-web` e
`/workspace/stremio-web`: são diretórios distintos, e podem conter alterações
locais diferentes. Trabalhe no checkout indicado pela sessão; não sincronize,
remova nem substitua um checkout automaticamente.

A recuperação e o manifesto SHA-256 estão em
`webos/documentation-recovery.md` e `webos/documentation-recovery.sha256.json`.

# Fase 6 — Plano de implementação

Fonte lida: vault persistente `11 - Port webOS 5/Fase 6 — Empacotamento e Pipeline.md`,
com D1, D2, D8 e D9. Checkout: branch `t3code/implement-webos-phase-six`;
base local `97ec850e` inclui a Fase 5 ainda ausente de `origin/webos` (`fe41143e`).
O PR contra `webos` inclui essa dependência.

1. T6.1/T6.5: manifesto `com.stremio.webos`, Back próprio, 1080p, memória
   provisória de 384 MB e versão LG derivada dos três inteiros de package.json.
2. T6.2/T6.4: staging isolado, verificação do build file://, empacotamento sem
   nova minificação, instalação/launch/inspect por device explícito.
3. T6.3: wrapper hosted LAN opcional com identidade própria e redirect para a
   raiz informada; preservar o build hosted com SW existente.
4. T6.7: redimensionar os assets oficiais existentes, gerar splash 1080p e
   PNGs comprimidos; nenhuma nova identidade visual.
5. Validar builds desktop/hosted/packaged, ES2018, testes e pacote real da CLI.
   Instalação, boot completo e persistência após relaunch exigem emulador acessível.
6. Registrar evidências e limites, commit/push e PR contra `webos`.

T6.6 (CI de produção, deploy público e loja) permanece adiada conforme a fonte.
Não alterar o workflow público nesta etapa. Não fechar gates de runtime sem prova.

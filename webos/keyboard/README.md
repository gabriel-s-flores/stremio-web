# keyboard

Teclado do sistema (VKB) nos campos de texto da TV (F3.4). Só entra no build webOS
(`src/App/index.webos.js`); o desktop não muda.

O webOS mostra o teclado para um campo de texto com foco e o esconde no Back (a F3.2, `webos/back`, trata
o resto: depois de escondido o Back seguinte segue a pilha). O que a página precisa resolver é o **Enter**
(`keyCode` 13), que na TV vem de duas coisas diferentes:

| Situação | O que significa | O que o módulo faz |
|---|---|---|
| Enter num campo com o teclado **fechado** | OK no campo: "quero digitar" | Cancela a tecla (nada é enviado, nada entra no histórico) e abre o teclado: espera 150 ms pelo sistema e, se ele não abriu, `blur()` + `focus()` |
| Enter com o teclado **aberto** | O Enter do teclado: terminei | Deixa passar (o `onSubmit` do `TextInput` envia) e fecha o teclado mantendo o foco no campo |
| Enter até 400 ms depois do teclado abrir | O mesmo OK que abriu o teclado, chegando depois | Cancela, sem reabrir |

Só campos de uma linha (`<input>` de texto, busca, url, e-mail, senha, tel, número). Botões, links,
checkboxes e `<textarea>` ficam com o Enter deles.

Fechar com o foco mantido: `blur()` esconde o teclado e a seta seguinte iria para o corpo da página;
então o campo recebe o foco de volta **somente leitura** (um campo somente leitura não chama o teclado) e
volta a ser editável 50 ms depois. As setas seguem do campo para os resultados.

A visibilidade vem do evento `keyboardStateChange`; `PalmSystem.isKeyboardVisible` só vale antes do primeiro
evento (ele continua `true` depois que o sistema esconde o teclado no Back).

## O que se mediu no emulador (webOS TV 4.0) e pode diferir da TV

- O teclado só abre por `focus()` depois que o app recebeu **alguma tecla do controle**; antes disso o foco
  programático (a busca focando o campo ao abrir a rota) não abre nada.
- Depois disso qualquer `focus()` abre o teclado, inclusive o da busca ao voltar de um resultado.
- Teclas do controle (dígitos) e do teclado do QEMU **escondem** o teclado e escrevem no campo; o teclado em
  si não é operável pelo `remote.mjs`. O OK chega à página como Enter, com o teclado aberto ou fechado.
- `PalmSystem.keyboardShow()`/`keyboardHide()`/`setManualKeyboardEnabled()` existem mas não fazem efeito aqui.
- Na TV, o esperado (a confirmar na validação final): OK num campo abre o teclado, o Enter do teclado chega
  como Enter. O módulo funciona nos dois casos: se o sistema abrir o teclado sozinho, a abertura pela página
  não acontece (ver a tabela).

## Testes

- `pnpm exec jest webos/tests/keyboard`.
- Emulador: `webos/tests/keyboard/emulator/run.mjs <pasta> keyboard`.

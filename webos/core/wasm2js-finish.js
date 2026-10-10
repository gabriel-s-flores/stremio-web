#!/usr/bin/env node
// Última etapa do .wasm2js.js (webos/core/build): minifica com o terser e marca a fábrica e asmFunc
// como "funções chamadas logo", para o V8 5.8 analisar o arquivo uma vez só.
//
//   node webos/core/wasm2js-finish.js entrada saída [--minify default|ws|none] [--no-eager]
//
// Por quê (medido no perfil c8 do emulador, spike webos/spikes/core-init, tarefa F0.11):
// - O V8 5.8 pré-analisa o script no importScripts, analisa a fábrica inteira (com asmFunc dentro)
//   ao chamá-la e analisa asmFunc de novo ao chamá-la: três passadas sobre o arquivo. Com a fábrica
//   e asmFunc entre parênteses (a heurística do V8 para função que vai ser chamada logo), as duas
//   são analisadas e compiladas já no importScripts, numa passada: importScripts + fábrica cai de
//   ~12 s para ~4 s no arquivo de 32,6 MB.
// - --minify default: as opções padrão do terser (compress + mangle), o mesmo que o ares-package
//   faz em todo .js sem --no-minify; 32,6 MB → 9,4 MB, ~1 s a menos de init e pico de memória menor.
//   ws: só tira espaços e comentários. none: não minifica.
// - O terser tira os parênteses, então a marcação vem depois dele e localiza as duas funções pela
//   AST (acorn), não pelo texto: o argumento-fábrica da chamada de topo vira "(function(){...})", e
//   asmFunc (devolvida pela fábrica pelo nome, ou embutida no return pelo terser) fica entre
//   parênteses. O código não muda.
// O terser e o acorn vêm do node_modules do repo (os do webpack, versões fixadas no pnpm-lock).
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');

function fromWebpack(name, via) {
    const base = path.dirname(require.resolve(via, { paths: [REPO] }));
    return require(require.resolve(name, { paths: [base] }));
}

function fail(msg) {
    console.error('wasm2js-finish: ' + msg);
    process.exit(1);
}

// Marca a fábrica e asmFunc entre parênteses (veja o cabeçalho).
function eagerize(text) {
    const acorn = fromWebpack('acorn', 'webpack');
    const ast = acorn.parse(text, { ecmaVersion: 5, sourceType: 'script' });
    const top = ast.body.filter((n) => n.type === 'ExpressionStatement');
    if (top.length !== 1) fail('esperava uma instrução de topo');
    let call = top[0].expression;
    if (call.type === 'UnaryExpression') call = call.argument;
    if (call.type !== 'CallExpression' || call.arguments.length !== 2 || call.arguments[1].type !== 'FunctionExpression') {
        fail('chamada de topo inesperada');
    }
    const factory = call.arguments[1];
    const body = factory.body.body;
    const ret = body[body.length - 1];
    if (!ret || ret.type !== 'ReturnStatement' || !ret.argument) fail('a fábrica não termina em return');
    let inner;
    if (ret.argument.type === 'Identifier') {
        const decls = body.filter((n) => n.type === 'FunctionDeclaration' && n.id.name === ret.argument.name);
        if (decls.length !== 1) fail('asmFunc não encontrada');
        const asm = decls[0];
        inner = [asm.start, asm.end, 'var ' + asm.id.name + '=(' + text.slice(asm.start, asm.end) + ');'];
    } else if (ret.argument.type === 'FunctionExpression') {
        const fn = ret.argument;
        inner = [fn.start, fn.end, '(' + text.slice(fn.start, fn.end) + ')'];
    } else {
        fail('return da fábrica inesperado: ' + ret.argument.type);
    }
    // asmFunc está dentro da fábrica: edita de dentro para fora.
    let out = text.slice(0, inner[0]) + inner[2] + text.slice(inner[1]);
    const shift = inner[2].length - (inner[1] - inner[0]);
    out = out.slice(0, factory.start) + '(' + out.slice(factory.start, factory.end + shift) + ')' + out.slice(factory.end + shift);
    return out;
}

async function main() {
    const args = process.argv.slice(2);
    const [src, dst] = args;
    if (!src || !dst) fail('uso: wasm2js-finish.js entrada saída [--minify default|ws|none] [--no-eager]');
    const i = args.indexOf('--minify');
    const minify = i >= 0 ? args[i + 1] : 'default';
    if (!['default', 'ws', 'none'].includes(minify)) fail('--minify default|ws|none');
    const eager = !args.includes('--no-eager');
    let text = fs.readFileSync(src, 'utf8');
    if (minify !== 'none') {
        const terser = fromWebpack('terser', 'terser-webpack-plugin');
        const result = await terser.minify(text, minify === 'ws' ? { compress: false, mangle: false } : {});
        text = result.code;
    }
    if (eager) text = eagerize(text);
    fs.writeFileSync(dst, text);
    console.error('wasm2js-finish: minify ' + minify + ', eager ' + (eager ? 'sim' : 'não') + ', ' + text.length + ' bytes');
}

main().catch((err) => fail(String(err && (err.stack || err))));

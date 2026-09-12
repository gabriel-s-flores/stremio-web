const ts = require('typescript');
module.exports = function (source) {
    return ts.transpileModule(source, { fileName: this.resourcePath.replace(/\.js$/, '.jsx'), compilerOptions: {
        target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React, esModuleInterop: true,
    } }).outputText;
};

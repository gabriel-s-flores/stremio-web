// Classify each measured exception, retaining the exact route, text and selector.
const fs = require('fs');
const summary = JSON.parse(fs.readFileSync('tests/webos/t28-runtime-summary.json'));
const exceptions = [];
for (const { name } of summary.reports) {
    const report = JSON.parse(fs.readFileSync(`tests/webos/t28-${name}.json`));
    for (const item of report.typography.filter(t => t.fontSize < 21.5)) {
        const context = [item.classes, ...(item.ancestors || [])].join(' ');
        let reason, source;
        if (/runtime-release-info/.test(context)) {
            reason = 'Metadados compactos: duração, ano e avaliação na mesma linha.';
            source = 'src/components/MetaPreview/styles.less';
        } else if (/meta-links/.test(context)) {
            reason = 'Chips e legendas de metadados; preservar a composição das listas de gênero/elenco/direção.';
            source = 'src/components/MetaPreview/MetaLinks/styles.less';
        } else if (/description-container/.test(context) && item.fontSize === 14.25) {
            reason = 'Legenda secundária Summary; a sinopse primária foi aumentada para 22px.';
            source = 'src/components/MetaPreview/styles.less';
        } else if (name === 'settings') {
            if (/version-info/.test(context)) {
                reason = 'Diagnóstico de versão/build, com hash longo e elipse.';
                source = 'src/routes/Settings/Menu/Menu.less';
            } else if (/wrapper-/.test(context)) {
                reason = 'Tabela técnica URL/Status, com endereços longos; ação Reload em 22px.';
                source = 'src/routes/Settings/Streaming/URLsManager';
            } else {
                reason = 'Referência densa de atalhos/combinações de teclas.';
                source = 'src/components/ShortcutsGroup';
            }
        } else if (name === 'addons' && /version-container|types-container/.test(item.classes)) {
            reason = 'Versão e tipos são metadados secundários; nome e descrição primária em pelo menos 22px.';
            source = 'src/routes/Addons/Addon/styles.less';
        } else if (name === 'intro' && /checkbox-/.test(context)) {
            reason = 'Consentimentos densos no formulário de 330px; manter composição vertical. Requer avaliação física de legibilidade.';
            source = 'src/components/Checkbox/Checkbox.less';
        } else if (name === 'player-idle-fixture' && /seek-bar/.test(context)) {
            reason = 'Timestamps compactos na barra de progresso.';
            source = 'src/routes/Player/ControlBar/SeekBar/styles.less';
        } else if (/fixture-label/.test(context)) {
            reason = 'Identificador de diagnóstico do fixture, fora da interface de produção.';
            source = 'src/webos/diagnostics/PlayerDebugPage.less';
        } else {
            reason = 'UNREVIEWED';
            process.exitCode = 1;
        }
        exceptions.push({ route: name, ...item, source, reason });
    }
}
fs.writeFileSync('tests/webos/t28-typography-exceptions.json', JSON.stringify(exceptions, null, 2) + '\n');
console.log(JSON.stringify({ exceptions: exceptions.length, unreviewed: exceptions.filter(e => e.reason === 'UNREVIEWED') }, null, 2));

// Classify source event owners; runtime reachability is exclusively a CDP assertion.
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const samples = [];
const structures = {
    'components/ContextMenu/ContextMenu.tsx': 'Backdrop/propagation layer; FocusScope children own actions',
    'components/ModalDialog/ModalDialog.js': 'Modal pointer propagation guard; close is a Button',
    'components/ActionMenu/ActionMenu.tsx': 'Backdrop closes the menu; menu items own actions',
    'components/BottomSheet/BottomSheet.tsx': 'Backdrop and delegated dismissal; children own actions',
    'components/Video/Video.js': 'Context-menu event propagation guard',
    'components/Multiselect/Multiselect.js': 'Menu event propagation guard',
    'components/NavBar/HorizontalNavBar/NavMenu/NavMenuContent.js': 'Navigation menu event delegation',
    'components/NavBar/HorizontalNavBar/SearchBar/SearchBar.js': 'Search trigger child is the TV action',
    'routes/MetaDetails/StreamsList/Stream/Stream.js': 'Context-menu event propagation guard',
    'routes/Player/Video/Video.js': 'Pointer video surface; play/pause is represented by ControlBar',
};
function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (/\.(jsx?|tsx?)$/.test(file)) {
            const source = fs.readFileSync(file, 'utf8');
            const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
            const relative = path.relative(path.join(root, 'src'), file).replaceAll('\\', '/');
            const visit = node => {
                if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
                    const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
                    const tag = node.tagName.getText(tree);
                    const attr = name => attrs.find(a => a.name.getText(tree) === name);
                    if (attr('onClick') || attr('onMouseDown') || attr('tabIndex')) {
                        const tabindex = attr('tabIndex')?.initializer?.getText(tree);
                        let classification = 'shared-control';
                        let reason = 'Component contract; concrete DOM checked by runtime probe';
                        if (/^[a-z]/.test(tag)) {
                            if (/^(button|input|select|textarea|a)$/.test(tag) || (attr('tabIndex') && attr('onKeyDown'))) {
                                classification = 'native-or-keyboard-control';
                                reason = 'Native focus/activation or explicit keyboard owner';
                            } else if (structures[relative] || (/^App\//.test(relative) && /backdrop/.test(node.getText(tree)))) {
                                classification = 'structure'; reason = structures[relative] || 'Backdrop; modal has a separate close action';
                            } else if (relative === 'components/Slider/Slider.js') {
                                classification = 'slider'; reason = 'TV focus stop; detailed editing/Enter belongs to T4.3/T4.7';
                            } else if (relative === 'routes/Player/Player.js') {
                                classification = 'structure'; reason = 'Player pointer event delegation';
                            } else {
                                classification = 'needs-review'; reason = 'No static keyboard owner established';
                            }
                        }
                        samples.push({ file: relative, line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1, tag, tabindex, classification, reason });
                    }
                }
                ts.forEachChild(node, visit);
            };
            visit(tree);
        }
    }
}
walk(path.join(root, 'src'));
const report = { date: new Date().toISOString(), note: 'Static classification only; not a reachability certificate', samples, unresolved: samples.filter(s => s.classification === 'needs-review') };
fs.mkdirSync(path.join(root, 'tests/webos'), { recursive: true });
fs.writeFileSync(path.join(root, 'tests/webos/t41-static-audit.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ samples: samples.length, unresolved: report.unresolved }));
if (report.unresolved.length) process.exitCode = 1;

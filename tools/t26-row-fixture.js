// Test-only route replacement: real MetaRow and MetaItem, no production API changes.
const React = require('react');
const MetaRow = require('stremio/components/MetaRow');
const MetaItem = require('stremio/components/MetaItem');
const items = Array.from({ length: 6 }, (_, index) => ({
    id: String(index), type: 'movie', name: `Residual card ${index + 1}`, posterShape: 'poster',
    href: '#/debug/focus', actionMenu: true, options: [{ label: 'Secondary action', value: 'secondary' }],
}));
module.exports = () => <div data-t26-fixture="true" style={{ width: 560, margin: 80 }}>
    <MetaRow title="T2.6 horizontal focus" catalog={{ items }} itemComponent={MetaItem} />
</div>;

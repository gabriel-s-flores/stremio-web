// Fixture-only boundaries: no platform behavior or feature gates are implemented here.
const React = require('react');
const useBinaryState = require('../src/common/useBinaryState');
const usePlatform = () => window.__t310.platform;
const useProfile = () => ({ settings: { discordRpcEnabled: true } });
const Section = React.forwardRef(({ label, children }, ref) => <section ref={ref} data-label={label}>{children}</section>);
const Option = ({ label, children }) => <div data-label={label}>{children}</div>;
const Group = ({ children }) => <div>{children}</div>;
const Control = () => <span />;
const Button = ({ children, className, title, onClick, ...props }) => <button data-section={props['data-section']} title={title} onClick={onClick}>{children}</button>;
const UpdateBanner = ({ visible, onAction, onClose }) => <div data-test="updater" hidden={!visible}><button data-test="install" onClick={onAction}>Install</button><button onClick={onClose}>Close</button></div>;
module.exports = {
    usePlatform, useProfile, useBinaryState,
    useRouteFocused: () => false, useStreamingServer: () => ({}),
    withCoreSuspender: component => component, useShortcuts: () => ({ grouped: [] }),
    useTranslation: () => ({ t: key => key }), useMatch: () => window.__t310.player ? {} : null,
    Section, Option, Category: Group, MainNavBars: Group, Button, UpdateBanner,
    Toggle: Control, ColorInput: Control, MultiselectMenu: Control, ShortcutsGroup: Control,
};

// LG exposes visibility, not keyboard geometry. Let the platform resize/pan;
// reveal the native input again after layout instead of synthesizing key events.
const installTVKeyboard = (doc = document, host = window) => {
    let visible = false;
    let frame;
    const reveal = () => {
        host.cancelAnimationFrame(frame);
        frame = host.requestAnimationFrame(() => {
            const input = doc.activeElement;
            if (!input || !input.matches('input:not([type="hidden"]),textarea,[contenteditable="true"]')) return;
            if (input.disabled || input.readOnly || !input.isConnected) return;
            input.scrollIntoView({ block: visible ? 'start' : 'nearest', inline: 'nearest', behavior: 'auto' });
        });
    };
    const onKeyboard = (event) => {
        if (!event.detail || typeof event.detail.visibility !== 'boolean') return;
        visible = event.detail.visibility;
        if (visible) reveal();
        else host.cancelAnimationFrame(frame);
    };
    const onFocus = () => { if (visible) reveal(); };
    doc.addEventListener('keyboardStateChange', onKeyboard);
    doc.addEventListener('focusin', onFocus);
    host.addEventListener('resize', reveal);
    if (host.visualViewport) host.visualViewport.addEventListener('resize', reveal);
    return () => {
        host.cancelAnimationFrame(frame);
        doc.removeEventListener('keyboardStateChange', onKeyboard);
        doc.removeEventListener('focusin', onFocus);
        host.removeEventListener('resize', reveal);
        if (host.visualViewport) host.visualViewport.removeEventListener('resize', reveal);
    };
};
module.exports = installTVKeyboard;

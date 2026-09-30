const FOCUSABLE = 'a[href],button,input,textarea,select,[tabindex]';

const isFocusable = (node) => {
    if (!node || !node.isConnected || node.tabIndex < 0 || node.disabled || node.getAttribute('aria-disabled') === 'true') return false;
    if (node.closest('[hidden],[aria-hidden="true"],[data-tv-route-active="false"],.disabled')) return false;
    const style = getComputedStyle(node);
    return style.visibility !== 'hidden' && style.display !== 'none' && node.getClientRects().length > 0;
};

const candidates = (root) => Array.from(root.querySelectorAll(FOCUSABLE)).filter(isFocusable);

const initialTarget = (root, pathname, fallback = false) => {
    if (pathname === '/search') {
        const input = Array.from(root.querySelectorAll('input')).find(isFocusable);
        if (input) return input;
    }
    const priorities = Array.from(root.querySelectorAll('[data-focus-priority]')).filter(isFocusable);
    priorities.sort((a, b) => Number(b.dataset.focusPriority) - Number(a.dataset.focusPriority));
    if (priorities.length) return priorities[0];
    if (!fallback && (/^\/(discover|library|continuewatching)(\/|$)/.test(pathname) || pathname === '/')) return null;
    const content = root.querySelector('[data-tv-content]');
    return (content && candidates(content)[0]) || (fallback ? candidates(root)[0] : null);
};

module.exports = { FOCUSABLE, isFocusable, initialTarget };

// Boundaries use the polyfill's cancellable event; no replacement navigation algorithm.
const revealTarget = (target) => {
    if (!target || typeof target.getBoundingClientRect !== 'function') return;
    // A newly loaded row starts with opacity 0 and a translated position.
    // Finish that entrance before focusing; leaving it running moves the ring
    // after we have aligned it with the scrollport.
    for (let node = target; node; node = node.parentElement) {
        if (node.classList && node.classList.contains('animation-fade-in')) node.style.animationName = 'none';
    }
    // The polyfill calls native scrollIntoView before navbeforefocus. C68 can
    // round its result across a fractional scrollport edge, clipping the ring.
    for (let parent = target.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        const box = parent.getBoundingClientRect();
        const rect = target.getBoundingClientRect();
        const top = box.top + (parseFloat(style.borderTopWidth) || 0);
        const bottom = box.bottom - (parseFloat(style.borderBottomWidth) || 0);
        const left = box.left + (parseFloat(style.borderLeftWidth) || 0);
        const right = box.right - (parseFloat(style.borderRightWidth) || 0);
        if (/(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight && rect.bottom - rect.top <= bottom - top) {
            if (rect.top < top) parent.scrollTop -= Math.ceil(top - rect.top);
            else if (rect.bottom > bottom) parent.scrollTop += Math.ceil(rect.bottom - bottom);
        }
        if (/(auto|scroll)/.test(style.overflowX) && parent.scrollWidth > parent.clientWidth && rect.right - rect.left <= right - left) {
            if (rect.left < left) parent.scrollLeft -= Math.ceil(left - rect.left);
            else if (rect.right > right) parent.scrollLeft += Math.ceil(rect.right - right);
        }
    }
};

const installTVSpatialNavigation = () => {
    const beforeFocus = (event) => {
        const origin = document.activeElement;
        const scope = origin && origin.closest('[data-focus-lock-disabled="false"],[role="menu"]');
        if (scope && !scope.contains(event.target)) event.preventDefault();
        else revealTarget(event.target);
    };
    document.addEventListener('navbeforefocus', beforeFocus, true);
    return () => document.removeEventListener('navbeforefocus', beforeFocus, true);
};

module.exports = installTVSpatialNavigation;

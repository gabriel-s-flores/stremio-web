// Chromium 68 ignores img.loading. Share one observer for all off-screen posters.
let observer = null;
const pending = new Map();
const release = (node) => {
    pending.delete(node);
    if (observer) observer.unobserve(node);
    if (!pending.size && observer) {
        observer.disconnect();
        observer = null;
    }
};

const observeTVImage = (node, onVisible) => {
    if (!node) return () => undefined;
    if (typeof IntersectionObserver !== 'function') {
        onVisible();
        return () => undefined;
    }
    if (!observer) {
        observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting && !(entry.intersectionRatio > 0)) return;
                const callback = pending.get(entry.target);
                release(entry.target);
                if (callback) callback();
            });
        }, { rootMargin: '400px' });
    }
    pending.set(node, onVisible);
    observer.observe(node);
    return () => release(node);
};

module.exports = observeTVImage;

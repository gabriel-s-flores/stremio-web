// Whether an image is already loaded, to show text instead of an empty box until it is (F8.7).
//
// MetaPreview shows the title's logo, or its name only when the logo fails. On the TV the logo of a title
// (images.metahub.space, through the tlsproxy) takes a while, and the details page had no title at all until
// it came. MetaPreview.webos.js passes the logo only once this says it is loaded, and the name meanwhile;
// the logo then paints from the cache.
//
// useImageReady(src, resolve) -> true once the image at resolve(src) loaded, or failed (the upstream Image
// then does what it does with a failure: retry through the proxy, or show the name). resolve maps src to
// the URL the Image will ask for (Image.webos.tsx: the tlsproxy's proxify); null means "not yet" (the
// proxy is starting). The URLs that loaded are remembered (the last LIMIT), so a logo seen once is ready
// at once.

const React = require('react');

const LIMIT = 300;
const loaded = new Map();

const remember = (url) => {
    loaded.delete(url);
    loaded.set(url, true);
    if (loaded.size > LIMIT) loaded.delete(loaded.keys().next().value);
};

const isLoaded = (url) => url !== null && loaded.has(url);

const useImageReady = (src, resolve, ImageCtor) => {
    const url = typeof src === 'string' && src.length > 0 ? resolve(src) : null;
    // The URL that loaded (or failed), so that another src is not taken as ready for one render.
    const [readyUrl, setReadyUrl] = React.useState(() => (isLoaded(url) ? url : null));
    React.useEffect(() => {
        if (url === null || isLoaded(url)) return undefined;
        const Ctor = ImageCtor || (typeof window !== 'undefined' ? window.Image : null);
        if (typeof Ctor !== 'function') {
            setReadyUrl(url);
            return undefined;
        }
        let active = true;
        const image = new Ctor();
        image.onload = () => {
            remember(url);
            if (active) setReadyUrl(url);
        };
        image.onerror = () => {
            if (active) setReadyUrl(url);
        };
        image.src = url;
        return () => {
            active = false;
            image.onload = null;
            image.onerror = null;
        };
    }, [url, ImageCtor]);
    return url !== null && (readyUrl === url || isLoaded(url));
};

module.exports = { useImageReady, isLoaded, remember };

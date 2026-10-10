// webOS TV 4.x build only (resolved instead of Image.tsx by webos/webpack/app.js).
//
// The upstream Image, with its https src going through the tlsproxy (webos/tlsproxy/README.md):
// the Chromium 53 of webOS TV 4.x refuses Let's Encrypt certificates, like the ones of
// images.metahub.space (posters and backgrounds). Known Let's Encrypt hosts are rewritten to the
// local proxy (while the proxy is starting they show the placeholder instead of failing); any
// other https image that fails is tried once through it before the upstream fallback, and its host
// is learned if the proxy reports a Let's Encrypt issuer. The component re-renders when the proxy
// becomes ready, restarts or learns a host.

import React, { useCallback, useState, useSyncExternalStore } from 'react';
import Image from './Image.tsx';
import tlsProxy from '../../../webos/tlsproxy/page';

type Props = React.ComponentProps<typeof Image>;

const ProxiedImage = ({ src, onError, onLoad, ...props }: Props) => {
    useSyncExternalStore(tlsProxy.subscribe, tlsProxy.getVersion);
    const [retried, setRetried] = useState(false);
    const proxied = typeof src === 'string' ? tlsProxy.proxify(src) : src;
    const retryUrl = retried && typeof src === 'string' ? tlsProxy.proxyUrl(src) : null;

    const onImageError = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
        if (typeof src === 'string' && proxied === src && retryUrl === null) {
            if (!retried && tlsProxy.canRetry(src)) {
                setRetried(true);
                return;
            }
            tlsProxy.noteDirectFailure(src);
        } else if (typeof src === 'string') {
            // Through the proxy and failed: the image, or the service died (checked; if so, the
            // service restarts and this component re-renders with the new address).
            tlsProxy.checkProxy();
        }
        if (typeof onError === 'function') {
            onError(event);
        }
    }, [src, proxied, retried, retryUrl, onError]);

    const onImageLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
        if (retryUrl !== null && typeof src === 'string') {
            tlsProxy.learnFromImage(src);
        }
        if (typeof onLoad === 'function') {
            onLoad(event);
        }
    }, [src, retryUrl, onLoad]);

    // proxied is null while the proxy for a known host is pending: no request, the placeholder.
    return <Image {...props} src={retryUrl ?? proxied ?? undefined} onError={onImageError} onLoad={onImageLoad} />;
};

const WebosImage = (props: Props) => <ProxiedImage key={props.src} {...props} />;

export default WebosImage;

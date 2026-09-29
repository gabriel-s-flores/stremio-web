// Copyright (C) 2017-2023 Smart code 203358507

import React, { useCallback, useLayoutEffect, useState, useRef } from 'react';

type Props = {
    className: string,
    src: string,
    alt: string,
    fallbackSrc: string,
    renderFallback: () => React.ReactNode,
    onError: (event: React.SyntheticEvent<HTMLImageElement>) => void,
};

const Image = ({ className, src, alt, fallbackSrc, renderFallback, ...props }: Props) => {
    const [broken, setBroken] = useState(false);
    const [visible, setVisible] = useState(!process.env.WEBOS);
    const imageRef = useRef<HTMLImageElement>(null);
    useLayoutEffect(() => {
        if (!process.env.WEBOS || visible) return;
        return require('stremio/common/TV/lazyImages')(imageRef.current, () => setVisible(true));
    }, [src, broken, visible]);
    const onError = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
        if (typeof props.onError === 'function') {
            props.onError(event);
        }

        setBroken(true);
    }, [props.onError]);

    useLayoutEffect(() => {
        setBroken(false);
    }, [src]);

    return (broken || typeof src !== 'string' || src.length === 0) && (typeof renderFallback === 'function' || typeof fallbackSrc === 'string') ?
        typeof renderFallback === 'function' ?
            renderFallback()
            :
            <img {...props} ref={imageRef} className={className} src={visible ? fallbackSrc : undefined} alt={alt} loading='lazy'/>
        :
        <img {...props} ref={imageRef} className={className} src={visible ? src : undefined} alt={alt} loading='lazy' onError={onError} />;
};

export default Image;

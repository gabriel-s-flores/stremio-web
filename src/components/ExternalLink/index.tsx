import React, { forwardRef } from 'react';
import Button from '../Button';
import { usePlatform } from 'stremio/common/Platform';

type Props = React.ComponentProps<typeof Button> & { rel?: string };

const ExternalLink = forwardRef<unknown, Props>(({ href, onClick, ...props }, ref) => {
    const platform = usePlatform();
    const handleClick: Props['onClick'] = (event) => {
        if (platform.name !== 'webos') {
            onClick?.(event);
            return;
        }
        let prevented = event.defaultPrevented;
        try {
            onClick?.(event);
            prevented = event.defaultPrevented;
        } finally {
            event.preventDefault();
        }
        if (!prevented && href && !props.disabled) platform.openExternal(href);
    };
    return <Button {...props} ref={ref} href={href} onClick={handleClick} />;
});

ExternalLink.displayName = 'ExternalLink';
export default ExternalLink;

import React from 'react';
export default function ExternalLink({ href, children, ...props }) {
    return <a {...props} href={href} onClick={event => {
        event.preventDefault(); window.__t311.platform.openExternal(href);
    }}>{children}</a>;
}

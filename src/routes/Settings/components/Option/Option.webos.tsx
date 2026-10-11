// webOS TV 4.x build only (resolved instead of Option.tsx by webos/webpack/app.js, F4.1b).
// The upstream settings row with its controls focusable: Settings renders every Toggle (and the
// Trakt button) with tabIndex -1, so the remote could not reach them. A control given tabIndex -1
// gets 0 here; the rest of the row is the upstream one.

import React from 'react';
// The explicit extension resolves to the upstream component, not to this file.
import UpstreamOption from './Option.tsx';

type Props = React.ComponentProps<typeof UpstreamOption>;

const focusable = (child: React.ReactNode) => (
    React.isValidElement<{ tabIndex?: number }>(child) && child.props.tabIndex === -1 ?
        React.cloneElement(child, { tabIndex: 0 })
        :
        child
);

const Option = ({ children, ...props }: Props) => (
    <UpstreamOption {...props}>
        {React.Children.map(children, focusable)}
    </UpstreamOption>
);

export default Option;

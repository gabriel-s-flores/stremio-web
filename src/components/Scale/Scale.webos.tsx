// webOS TV 4.x build only (resolved instead of Scale.tsx by webos/webpack/app.js, F4.1b).
// The "Interface zoom" setting on the TV. 100% is already the TV scale of F2.6 (LG's minimum text
// size from 3 m), so the steps below it are left out, and so are 150% and 175%, where the layout
// turns into the small-screen one (TV_INTERFACE_SCALES in src/common/interfaceScale.webos.ts). The range input leaves the focus order: it took the arrow keys (DOWN went to
// 75%), and the percentage buttons above it do the same job with the remote (LEFT/RIGHT between
// them, OK applies), while UP/DOWN go on to the next setting. normalizeInterfaceScale
// (src/common/interfaceScale.webos.ts) brings a stored value outside these steps back to 100%.

import React from 'react';
// The explicit extension resolves to the upstream component, not to this file.
import UpstreamScale from './Scale.tsx';
import { TV_INTERFACE_SCALES } from '../../common/interfaceScale.webos';

type Props = React.ComponentProps<typeof UpstreamScale>;

const Scale = ({ options, ...props }: Props) => {
    const tvOptions = options.filter((option) => TV_INTERFACE_SCALES.includes(option));
    return (
        <UpstreamScale
            {...props}
            options={tvOptions}
            min={tvOptions[0]}
            max={tvOptions[tvOptions.length - 1]}
            tabIndex={-1}
        />
    );
};

export default Scale;

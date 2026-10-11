// webOS TV 4.x build only (resolved instead of Player.tsx by webos/webpack/app.js, F5.5).
// The upstream Player settings without the ASS subtitles styling option: libass is a stub in the
// webOS build (F1.5) and the Player loads with the styling off (webos/lib/player). The upstream
// render runs as is and only the option with that label is dropped from its output, so the rest
// of the section follows upstream changes.

import React, { forwardRef } from 'react';
import UpstreamPlayer from './Player.tsx';
import { removeElements } from '../../../../webos/lib/player';

const ASS_STYLING_LABEL = 'SETTINGS_ASS_SUBTITLES_STYLING';

type Props = React.ComponentProps<typeof UpstreamPlayer>;
type Render = (props: Props, ref: React.ForwardedRef<HTMLDivElement>) => React.ReactElement;

const Player = forwardRef<HTMLDivElement, Props>((props, ref) => {
    const element = (UpstreamPlayer as unknown as { render: Render }).render(props, ref);
    return removeElements(React, element, (node: React.ReactElement) => node.props.label === ASS_STYLING_LABEL);
});

Player.displayName = 'Player';

export default Player;

// webOS TV 4.x build only (resolved instead of Player.tsx by webos/webpack/app.js, F5.5).
// The upstream Player settings without the ASS subtitles styling option: libass is a stub in the
// webOS build (F1.5) and the Player loads with the styling off (webos/lib/player). Nor the external
// player option (F8.4): no player of its list runs on the TV ('webOS' is in none of their
// platforms), so it would be an empty menu; without it the Advanced category (the rest is for the
// desktop shell) is empty and goes too. The upstream render runs as is and only the options with
// those labels (and a category left empty) are dropped from its output, so the rest of the section
// follows upstream changes.

import React, { forwardRef } from 'react';
import UpstreamPlayer from './Player.tsx';
import { removeElements } from '../../../../webos/lib/player';

const REMOVED_LABELS = ['SETTINGS_ASS_SUBTITLES_STYLING', 'SETTINGS_PLAY_IN_EXTERNAL_PLAYER'];

type Props = React.ComponentProps<typeof UpstreamPlayer>;
type Render = (props: Props, ref: React.ForwardedRef<HTMLDivElement>) => React.ReactElement;

const isRemoved = (node: React.ReactElement) => REMOVED_LABELS.includes(node.props.label);

// A category whose options are all removed ones.
const isEmptied = (node: React.ReactElement) => {
    const children = React.Children.toArray(node.props.children);
    return children.length > 0 && children.every((child) => React.isValidElement(child) && isRemoved(child));
};

const Player = forwardRef<HTMLDivElement, Props>((props, ref) => {
    const element = (UpstreamPlayer as unknown as { render: Render }).render(props, ref);
    return removeElements(React, element, (node: React.ReactElement) => isRemoved(node) || isEmptied(node));
});

Player.displayName = 'Player';

export default Player;

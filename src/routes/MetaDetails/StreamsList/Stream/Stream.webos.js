// webOS TV 4.x build only (resolved instead of Stream.js by webos/webpack/app.js, F6.2).
// The upstream stream item with the LG C8 labels ("DV", "HDR10 nesta TV", "Atmos", warnings such as
// "DV P5: cores erradas") in a discreet row under it. The `c8` prop comes from StreamsList.webos.js;
// without it (Live TV, compact buttons) the item is the upstream one. The upstream render runs as
// is: only the label it renders gets the extra row, a tier class and the focus hook that asks for
// the header probe. No JSX: the Jest setup of the repo has no React preset
// (webos/tests/streams/streams-list.test.js renders this file).

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
// The explicit extension resolves to the upstream component, not to this file.
const UpstreamStream = require('./Stream.js');
const styles = require('./styles');
const c8Styles = require('./c8-labels.less');
const { insertAfter, chain } = require('../../../../../webos/lib/stream-ranking');

const C8Labels = ({ labels, warnings }) => React.createElement(
    'div',
    { className: c8Styles['c8-labels'] },
    labels.map((label) => React.createElement('span', { key: `label-${label.code}`, className: c8Styles['label'] }, label.text)),
    warnings.map((warning) => React.createElement('span', {
        key: `warning-${warning.code}`,
        className: classnames(c8Styles['warning'], c8Styles[warning.severity]),
        title: warning.message,
    }, warning.text))
);

C8Labels.propTypes = {
    labels: PropTypes.arrayOf(PropTypes.object).isRequired,
    warnings: PropTypes.arrayOf(PropTypes.object).isRequired,
};

// After the play icon, the last element of the item's row: the labels wrap to a row of their own and
// the upstream row (name, description, icon) stays as it is.
const isPlayIcon = (element) => element.props.className === styles['icon'];

const withC8 = (label, c8) => {
    const shown = c8.labels.length > 0 || c8.warnings.length > 0 ?
        React.createElement(C8Labels, { key: 'c8-labels', labels: c8.labels, warnings: c8.warnings })
        :
        null;
    return insertAfter(React, label, isPlayIcon, shown, {
        className: classnames(label.props.className, c8Styles[`tier-${c8.tier}`]),
        onFocus: chain(label.props.onFocus, c8.onFocus),
        onBlur: chain(label.props.onBlur, c8.onBlur),
        'data-c8-tier': c8.tier,
        'data-c8-score': c8.score,
        'data-c8-source': c8.source,
    });
};

const Stream = ({ c8 = null, ...props }) => {
    const element = UpstreamStream(props);
    if (c8 === null || props.compact) {
        return element;
    }

    const renderLabel = element.props.renderLabel;
    return React.cloneElement(element, {
        renderLabel: (labelProps) => withC8(renderLabel(labelProps), c8),
    });
};

Stream.Placeholder = UpstreamStream.Placeholder;

Stream.propTypes = {
    ...UpstreamStream.propTypes,
    c8: PropTypes.shape({
        tier: PropTypes.oneOf(['ok', 'demoted', 'hidden']),
        score: PropTypes.number,
        source: PropTypes.string,
        labels: PropTypes.arrayOf(PropTypes.object),
        warnings: PropTypes.arrayOf(PropTypes.object),
        onFocus: PropTypes.func,
        onBlur: PropTypes.func,
    }),
};

module.exports = Stream;

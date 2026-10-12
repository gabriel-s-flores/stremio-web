// webOS TV 4.x build only (resolved instead of Stream.js by webos/webpack/app.js, F6.2).
// The upstream stream item with the LG C8 labels ("DV", "HDR10 nesta TV", "Atmos", warnings such as
// "DV P5: cores erradas") right under its text. The `c8` prop comes from StreamsList.webos.js;
// without it (Live TV, compact buttons) the item is the upstream one. The upstream render runs as
// is: only the label it renders gets the labels, a tier class and the focus hook that asks for
// the header probe. No JSX: the Jest setup of the repo has no React preset
// (webos/tests/streams/streams-list.test.js renders this file).
// F8.3: the text of the addon goes through webos/lib/tv-text (entities, emoji the TV has no glyph
// for), and the description is wrapped so it can break (styles.webos.less) with the labels in its
// column, under the text, instead of a row of their own across the item.

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
// The explicit extension resolves to the upstream component, not to this file.
const UpstreamStream = require('./Stream.js');
const styles = require('./styles');
const c8Styles = require('./c8-labels.less');
const { chain } = require('../../../../../webos/lib/stream-ranking');
const { tvText } = require('../../../../../webos/lib/tv-text');

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

const isDescription = (element) => React.isValidElement(element) && element.props.className === styles['description-container'];

// The description's text in a block of its own (it breaks and is clamped there), and the labels after
// it, in the same column. Everything else of the item stays as upstream renders it.
const withC8 = (label, c8) => {
    const shown = c8.labels.length > 0 || c8.warnings.length > 0 ?
        React.createElement(C8Labels, { key: 'c8-labels', labels: c8.labels, warnings: c8.warnings })
        :
        null;
    const children = label.props.children;
    const list = (Array.isArray(children) ? children : [children]).map((child) => (
        isDescription(child) ?
            React.cloneElement(child, undefined,
                React.createElement('div', { key: 'text', className: styles['description-text'] }, child.props.children),
                shown)
            :
            child
    ));
    return React.cloneElement.apply(null, [label, {
        className: classnames(label.props.className, c8Styles[`tier-${c8.tier}`]),
        onFocus: chain(label.props.onFocus, c8.onFocus),
        onBlur: chain(label.props.onBlur, c8.onBlur),
        'data-c8-tier': c8.tier,
        'data-c8-score': c8.score,
        'data-c8-source': c8.source,
    }].concat(list));
};

const Stream = ({ c8 = null, ...props }) => {
    const element = UpstreamStream({
        ...props,
        addonName: tvText(props.addonName),
        name: tvText(props.name),
        description: tvText(props.description),
    });
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

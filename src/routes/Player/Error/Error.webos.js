// webOS TV 4.x build only (resolved instead of Error.js by webos/webpack/app.js, F6.3).
// The upstream error layer, with the message of a dead debrid link when that is what failed: the
// <video> only reports "not supported" or "network", so the stream URL is checked once after the
// error (webos/lib/debrid-link: the stream list's probe result when it has one, else one 1-byte
// Range request that follows the debrid redirect) and the layer says "expired", "not found",
// "unreachable"… with what to do. The upstream message stays when the link answers (a file the TV
// cannot decode) or the check cannot tell. A Torrentio notice video (the resolver's answer when the
// debrid service refuses or is still downloading, F8.4) gets the message that video would show.
// There is no external player on the TV (F8.4): the upstream "Open in external player" button (an
// .m3u download) and its hint (code 2) are left out. No JSX: the Jest setup of the repo has no React preset.

const React = require('react');
const { useTranslation } = require('react-i18next');
// The explicit extension resolves to the upstream component, not to this file.
const UpstreamError = require('./Error.js');
const styles = require('./styles');
const debridLink = require('../../../../webos/lib/debrid-link');
const { redactString } = require('../../../../webos/lib/redact');

// stremio-video's UNSUPPORTED_STREAM: the upstream layer adds the external player hint to it.
const EXTERNAL_PLAYER_HINT_CODE = 2;

const useLinkProblem = (stream, code) => {
    const [problem, setProblem] = React.useState(null);
    const target = stream || debridLink.lastLoadedStream();
    const url = debridLink.urlOf(target);

    React.useEffect(() => {
        let cancelled = false;
        setProblem(null);
        if (url !== null) {
            debridLink.diagnose(target, code).then((diagnosis) => {
                if (cancelled) return;
                const described = debridLink.describe(diagnosis);
                if (described !== null) console.warn('Player', 'link check', diagnosis.kind, diagnosis.status, diagnosis.source, diagnosis.host);
                setProblem(described);
            }, () => null);
        }
        return () => {
            cancelled = true;
        };
    }, [url, code]);

    return problem;
};

// The props the upstream layer renders with: no external player links (the button) and no code 2
// (the hint about the external player setting). The link check keeps the real code.
const withoutExternalPlayer = (props) => {
    const stream = props.stream;
    const deepLinks = stream && stream.deepLinks;
    const withoutLinks = deepLinks && deepLinks.externalPlayer ?
        Object.assign({}, stream, { deepLinks: Object.assign({}, deepLinks, { externalPlayer: null }) })
        :
        stream;
    return Object.assign({}, props, { stream: withoutLinks, code: props.code === EXTERNAL_PLAYER_HINT_CODE ? null : props.code });
};

const Error = React.forwardRef((props, ref) => {
    const { t } = useTranslation();
    const problem = useLinkProblem(props.stream, props.code);
    const upstreamProps = withoutExternalPlayer(props);
    if (problem === null) {
        // A message with the certificate proxy URL (F3.7b) would show its token.
        const safe = redactString(props.message);
        return UpstreamError.render(safe === props.message ? upstreamProps : Object.assign({}, upstreamProps, { message: safe }), ref);
    }

    const message = t(problem.key, Object.assign({ defaultValue: problem.message }, problem.values));
    const hint = t(problem.hintKey, { defaultValue: problem.hint });
    // The upstream "try an external player" hint (code 2) would contradict the one of the link.
    const element = UpstreamError.render(Object.assign({}, upstreamProps, { message, code: null }), ref);
    return React.cloneElement(
        element,
        { 'data-link-problem': problem.kind },
        ...React.Children.toArray(element.props.children),
        React.createElement('div', { key: 'link-hint', className: styles['error-sub'], title: hint }, hint)
    );
});

Error.displayName = 'Error';

Error.propTypes = UpstreamError.propTypes;

module.exports = Error;

// Apply the lifecycle fix to the pinned published implementation only in webOS builds.
// Exact anchors fail the build on dependency changes rather than silently losing it.
module.exports = function(source) {
    const replaceOnce = (before, after) => {
        if (source.split(before).length !== 2) throw new Error('WebOsVideo 0.0.96 lifecycle patch anchor changed');
        source = source.replace(before, after);
    };
    replaceOnce('var destroyed = false;', 'var destroyed = false;\n    var pendingMediaIdTimer = null;');
    replaceOnce('var timer = setInterval(retrieveMediaId, 300);',
        'var timer = setInterval(retrieveMediaId, 300);\n                        pendingMediaIdTimer = timer;');
    replaceOnce("case 'unload': {", "case 'unload': {\n                clearInterval(pendingMediaIdTimer);\n                pendingMediaIdTimer = null;\n                isLoaded = null;\n                onPropChanged('loaded');");
    replaceOnce('stream = commandArgs.stream;', 'stream = commandArgs.stream;\n                    clearInterval(pendingMediaIdTimer);\n                    pendingMediaIdTimer = null;\n                    isLoaded = false;');
    replaceOnce('var startVideo = function () {', 'var startVideo = function () {\n                        if (destroyed || !stream) return;');
    return source;
};

# Main screens of the app, for webos/tests/screens/run (F2.6; the visual regression of F2.7 reuses them).
# One entry per capture: <name>|<route hash>|<action>|<element to focus>
#   action: empty, click:<selectors> (opens a menu) or key:<remote key of cdp.mjs> (Back opens the exit dialog)
#   selectors: CSS lists separated by ||, the first one with a visible match wins. Classes are CSS
#   modules hashes: match them by the name prefix ([class*=name]).
# Guest mode (no account): Library and Calendar show their "log in" placeholder. The Player is the
# last capture of run (one media scenario per boot) and needs STREAM_URL.
SCENES=(
    "board|#/||[class*=board-row] [class*=meta-item-container]"
    "discover|#/discover||[class*=meta-items-container] [class*=meta-item-container]"
    "discover-menu|#/discover|click:[class*=selectable-inputs-container] [class*=multiselect-menu] > [tabindex]|[class*=multiselect-menu] [class*=option]||[class*=dropdown] [class*=option]"
    "search|#/search?search=matrix||[class*=search-row] [class*=meta-item-container]||[class*=meta-item-container]"
    "detail-movie|#/detail/movie/tt0068646||[class*=action-buttons-container] [class*=action-button]||[class*=meta-preview] [tabindex]"
    "detail-series|#/detail/series/tt0903747||[class*=videos-list] [class*=video-container]||[class*=videos-list] [tabindex]"
    "detail-streams|#/detail/series/tt0903747/tt0903747%3A1%3A1||[class*=streams-list] [class*=stream-container]||[class*=streams-list] [tabindex]"
    "library|#/library||[class*=placeholder] [class*=button]||[class*=library] [tabindex]"
    "calendar|#/calendar||[class*=placeholder] [class*=button]||[class*=calendar] [tabindex]"
    "addons|#/addons||[class*=addon-container] [class*=install-button]||[class*=addon-container]"
    "addon-details|#/addons?addon=https%3A%2F%2Fv3-cinemeta.strem.io%2Fmanifest.json||[class*=modal-dialog-container] [class*=action-button]||[class*=modal-dialog-container] [tabindex]"
    "settings|#/settings||[class*=settings-content] [class*=option] [tabindex]||[class*=menu] [class*=button]"
    "nav-menu|#/|click:[class*=nav-menu-popup-label]|[class*=nav-menu-container] [class*=nav-menu-option-container]||[class*=nav-menu-container] [tabindex]"
    "exit-dialog|#/|key:BACK|[class*=exit-dialog] button"
)
# The Player: control bar button focused (the bar shows on pointer movement).
PLAYER_FOCUS="[class*=control-bar-container] [class*=control-bar-button]"

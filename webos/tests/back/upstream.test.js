// The overlay bridge and the route layer of webos/back close and navigate through paths that the
// upstream components already have. These checks fail when upstream changes one of them, so the
// matching entry of webos/back/overlays.js or routes.js gets revisited (webos/back/README.md).

const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', '..', '..', 'src');
const read = (file) => fs.readFileSync(path.join(SRC, file), 'utf8');

describe('upstream paths used by webos/back', () => {
    test('the webOS App wraps the upstream App inside the router', () => {
        expect(read('index.js')).toMatch(/<HashRouter>[\s\S]*<App \/>[\s\S]*<\/HashRouter>/);
        expect(read('App/index.webos.js')).toMatch(/<App \/>\s*<BackNavigation \/>/);
    });

    test('routes: only the last route container is visible and each has its modals container', () => {
        expect(read('router/styles.css')).toMatch(/\.route-container:not\(:last-child\)/);
        expect(read('router/Route/Route.js')).toContain("className={'route-container'}");
        expect(read('router/ModalsContainerContext/ModalsContainerProvider.js')).toContain("'modals-container'");
        expect(read('router/Modal/Modal.js')).toContain("'modal-container'");
        expect(read('router/Routes.tsx')).toContain("className={'routes-container'}");
    });

    test('ModalDialog and BottomSheet close the topmost one on an Escape keydown on window', () => {
        const modalDialog = read('components/ModalDialog/ModalDialog.js');
        expect(modalDialog).toContain("event.code === 'Escape' && modalsContainer.childNodes[modalsContainer.childElementCount - 2] === modalContainerRef.current");
        expect(modalDialog).toContain("window.addEventListener('keydown', onKeyDown)");
        const bottomSheet = read('components/BottomSheet/BottomSheet.tsx');
        expect(bottomSheet).toContain("event.code !== 'Escape'");
        expect(bottomSheet).toMatch(/window\.addEventListener\('keydown'/);
    });

    test('Popup closes on a mousedown outside and marks its label with `active`', () => {
        const popup = read('components/Popup/Popup.js');
        expect(popup).toContain("window.addEventListener('mousedown', onCloseEvent)");
        expect(popup).toContain("!labelRef.current.contains(event.target) && !menuRef.current?.contains(event.target)");
        expect(popup).toContain("{ 'active': open }");
        expect(popup).toContain("styles['menu-container']");
        expect(popup).toContain("styles['portal-layer']");
    });

    test('MultiselectMenu closes on a mouseup outside and its label has aria-expanded', () => {
        expect(read('components/MultiselectMenu/MultiselectMenu.tsx')).toContain('useOutsideClick(closeMenu)');
        expect(read('common/useOutsideClick.ts')).toContain("document.addEventListener('mouseup', handleClickOutside)");
        const label = read('components/MultiselectMenu/Label/Label.tsx');
        expect(label).toContain('aria-haspopup');
        expect(label).toContain('aria-expanded={open}');
    });

    test('the search history closes on a mousedown outside the search bar', () => {
        const searchBar = read('components/NavBar/HorizontalNavBar/SearchBar/SearchBar.js');
        expect(searchBar).toContain("document.addEventListener('mousedown', searchHistoryOnClose)");
        expect(searchBar).toContain("<div className={styles['menu-container']}>");
        expect(searchBar).toContain("styles['search-bar-container']");
    });

    test('ActionMenu closes on Escape inside its menu', () => {
        const actionMenu = read('components/ActionMenu/ActionMenu.tsx');
        expect(actionMenu).toContain("role={'menu'}");
        expect(actionMenu).toMatch(/menuOnKeyDown[\s\S]*event\.key === 'Escape'[\s\S]*closeMenuAndRestoreFocus\(\)/);
    });

    test('ContextMenu closes on a left mousedown on its container, portalled into body', () => {
        const contextMenu = read('components/ContextMenu/ContextMenu.tsx');
        expect(contextMenu).toContain('if (event.button !== 2 && !event.ctrlKey) close();');
        expect(contextMenu).toContain("className={styles['context-menu-container']}");
        expect(contextMenu).toContain('document.body');
    });

    test('the app modals in body: backdrops, the gamepad attribute and the server URL title id', () => {
        expect(read('App/ShortcutsModal/ShortcutsModal.tsx')).toContain("<div className={styles['backdrop']} onClick={onClose} />");
        const gamepadModal = read('App/GamepadModal/GamepadModal.tsx');
        expect(gamepadModal).toContain('data-gamepad-modal');
        expect(gamepadModal).toContain("<div className={styles['backdrop']} onClick={onClose} />");
        const serverUrlModal = read('App/StreamingServerUrlModal/StreamingServerUrlModal.tsx');
        expect(serverUrlModal).toContain("'streaming-server-url-modal-title'");
        expect(serverUrlModal).toContain("window.addEventListener('keydown'");
    });

    test('Player: Escape on document also leaves the Player, so its menus close by mousedown', () => {
        const player = read('routes/Player/Player.js');
        expect(player).toMatch(/useShortcut\('exit', React\.useCallback\(\(\) => \{\s*closeMenus\(\);[\s\S]*goBack\(\);/);
        expect(player).toMatch(/const onContainerMouseDown = React\.useCallback\(\(event\) => \{\s*if \(!event\.nativeEvent\.optionsMenuClosePrevented\)/);
        expect(player).toContain("className={classnames(styles['player-container']");
        expect(player).toContain("styles['menu-layer']");
        expect(player).toContain("styles['side-drawer-layer']");
        const nextVideoPopup = read('routes/Player/NextVideoPopup/NextVideoPopup.js');
        expect(nextVideoPopup).toContain("styles['next-video-popup-container']");
        expect(nextVideoPopup).toContain("styles['dismiss']");
    });

    test('route layer: the streams list back button, useGoBack and the MetaDetails origin', () => {
        const streamsList = read('routes/MetaDetails/StreamsList/StreamsList.js');
        expect(streamsList).toContain("styles['streams-list-container']");
        expect(streamsList).toContain("styles['back-button-container'])} tabIndex={0} onClick={backButtonOnClick}");
        const useGoBack = read('router/useGoBack.ts');
        expect(useGoBack).toContain('window.history.state?.idx > 0');
        expect(useGoBack).toContain('navigate(getBackFallback(location), { replace: true })');
        expect(read('routes/MetaDetails/MetaDetails.js')).toContain('const originPath = React.useMemo(() => getStoredOrigin(), [getStoredOrigin]);');
        expect(read('router/useNavigateWithOrigin.ts')).toContain('state: { from: origin }');
        const routerPaths = read('router/routerPaths.tsx');
        expect(routerPaths).toMatch(/path: '\/intro'/);
        expect(routerPaths).toMatch(/path: '\/'/);
    });
});

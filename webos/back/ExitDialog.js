// Quit confirmation shown by Back on the Board (owner: F3.2).
//
// Cancel has the focus when it opens: quitting by accident costs a full boot of the app. While it
// is open the dialog owns the remote: left/right/up/down move between the two buttons, OK presses
// the focused one, and every other key is kept from the page behind (spatial navigation,
// shortcuts). Back is the dispatcher's: BackNavigation closes the dialog with it.

const React = require('react');
const { createPortal } = require('react-dom');
const { useTranslation } = require('react-i18next');
const styles = require('./ExitDialog.less');

const TITLES = {
    pt: 'Sair do Stremio?',
    en: 'Quit Stremio?',
};

const ARROW_KEY_CODES = [37, 38, 39, 40];
const ENTER_KEY_CODE = 13;

const getTitle = (language) => TITLES[String(language || '').split('-')[0]] || TITLES.en;

const ExitDialog = ({ onCancel, onConfirm }) => {
    const { t, i18n } = useTranslation();
    const cancelRef = React.useRef(null);
    const confirmRef = React.useRef(null);

    React.useEffect(() => {
        cancelRef.current.focus();
        const onKeyDown = (event) => {
            const buttons = [cancelRef.current, confirmRef.current];
            const focused = buttons.indexOf(document.activeElement);
            if (ARROW_KEY_CODES.includes(event.keyCode)) {
                buttons[focused === 0 ? 1 : 0].focus();
            } else if (event.keyCode === ENTER_KEY_CODE) {
                if (focused === -1) {
                    cancelRef.current.focus();
                } else {
                    buttons[focused].click();
                }
            } else {
                event.stopImmediatePropagation();
                return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, []);

    return createPortal((
        <div className={styles['exit-dialog']} role={'alertdialog'} aria-modal={'true'} aria-labelledby={'webos-exit-dialog-title'}>
            <div className={styles['container']}>
                <div id={'webos-exit-dialog-title'} className={styles['title']}>{getTitle(i18n.language)}</div>
                <div className={styles['buttons']}>
                    <button ref={cancelRef} type={'button'} className={styles['button']} onClick={onCancel}>
                        {t('BUTTON_CANCEL')}
                    </button>
                    <button ref={confirmRef} type={'button'} className={`${styles['button']} ${styles['confirm']}`} onClick={onConfirm}>
                        {t('QUIT')}
                    </button>
                </div>
            </div>
        </div>
    ), document.body);
};

module.exports = ExitDialog;

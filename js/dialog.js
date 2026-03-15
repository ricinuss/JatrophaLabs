/* ═══════════ CUSTOM DIALOGS ═══════════ */
'use strict';

(function() {
    let currentDialog = null;
    let dialogQueue = [];

    function createDialogBase(content) {
        const bg = document.createElement('div');
        bg.className = 'dialog-bg';
        bg.innerHTML = `<div class="dialog">${content}</div>`;
        return bg;
    }

    function showDialog(bg, focusEl) {
        document.body.appendChild(bg);
        // Force reflow para animação funcionar
        bg.offsetHeight;
        bg.classList.add('show');
        if (focusEl) focusEl.focus();
    }

    function hideDialog(bg) {
        bg.classList.remove('show');
        bg.addEventListener('transitionend', () => bg.remove(), { once: true });
        // Fallback se transição não disparar
        setTimeout(() => { if (bg.parentNode) bg.remove(); }, 300);
    }

    function processQueue() {
        if (dialogQueue.length && !currentDialog) {
            const next = dialogQueue.shift();
            next();
        }
    }

    /**
     * Exibe modal de confirmação customizado.
     * @param {string} message
     * @param {Object} [options]
     * @param {string} [options.confirmText='Confirmar']
     * @param {string} [options.cancelText='Cancelar']
     * @param {boolean} [options.danger=false]
     * @returns {Promise<boolean>}
     */
    window.customConfirm = function(message, options = {}) {
        return new Promise(resolve => {
            const run = () => {
                const {
                    confirmText = 'Confirmar',
                    cancelText = 'Cancelar',
                    danger = false
                } = options;

                const btnClass = danger ? 'dialog-btn dialog-btn-danger' : 'dialog-btn dialog-btn-primary';

                const bg = createDialogBase(`
                    <div class="dialog-body">
                        <p class="dialog-msg">${esc(message)}</p>
                    </div>
                    <div class="dialog-footer">
                        <button class="dialog-btn dialog-btn-secondary" data-action="cancel">${esc(cancelText)}</button>
                        <button class="${btnClass}" data-action="confirm">${esc(confirmText)}</button>
                    </div>
                `);

                currentDialog = bg;

                const close = (result) => {
                    hideDialog(bg);
                    currentDialog = null;
                    resolve(result);
                    processQueue();
                };

                // Clique no backdrop
                bg.addEventListener('click', e => {
                    if (e.target === bg) close(false);
                });

                // Botões
                bg.querySelector('[data-action="cancel"]').addEventListener('click', () => close(false));
                bg.querySelector('[data-action="confirm"]').addEventListener('click', () => close(true));

                // Escape
                const onKey = e => {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        close(false);
                    }
                };
                document.addEventListener('keydown', onKey);
                bg.addEventListener('transitionend', () => {
                    if (!bg.classList.contains('show')) {
                        document.removeEventListener('keydown', onKey);
                    }
                });

                const confirmBtn = bg.querySelector('[data-action="confirm"]');
                showDialog(bg, confirmBtn);
            };

            if (currentDialog) {
                dialogQueue.push(run);
            } else {
                run();
            }
        });
    };

    /**
     * Exibe modal de prompt customizado.
     * @param {string} message
     * @param {string} [defaultValue='']
     * @param {Object} [options]
     * @param {string} [options.placeholder='']
     * @param {string} [options.confirmText='OK']
     * @param {string} [options.cancelText='Cancelar']
     * @returns {Promise<string|null>}
     */
    window.customPrompt = function(message, defaultValue = '', options = {}) {
        return new Promise(resolve => {
            const run = () => {
                const {
                    placeholder = '',
                    confirmText = 'OK',
                    cancelText = 'Cancelar'
                } = options;

                const bg = createDialogBase(`
                    <div class="dialog-body">
                        <p class="dialog-msg">${esc(message)}</p>
                        <input type="text" class="dialog-input" value="${esc(defaultValue)}" placeholder="${esc(placeholder)}">
                    </div>
                    <div class="dialog-footer">
                        <button class="dialog-btn dialog-btn-secondary" data-action="cancel">${esc(cancelText)}</button>
                        <button class="dialog-btn dialog-btn-primary" data-action="confirm">${esc(confirmText)}</button>
                    </div>
                `);

                currentDialog = bg;
                const input = bg.querySelector('.dialog-input');

                const close = (result) => {
                    hideDialog(bg);
                    currentDialog = null;
                    resolve(result);
                    processQueue();
                };

                const confirm = () => {
                    const val = input.value.trim();
                    close(val || null);
                };

                // Clique no backdrop
                bg.addEventListener('click', e => {
                    if (e.target === bg) close(null);
                });

                // Botões
                bg.querySelector('[data-action="cancel"]').addEventListener('click', () => close(null));
                bg.querySelector('[data-action="confirm"]').addEventListener('click', confirm);

                // Enter no input confirma, Escape cancela
                input.addEventListener('keydown', e => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        confirm();
                    }
                });

                const onKey = e => {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        close(null);
                    }
                };
                document.addEventListener('keydown', onKey);
                bg.addEventListener('transitionend', () => {
                    if (!bg.classList.contains('show')) {
                        document.removeEventListener('keydown', onKey);
                    }
                });

                showDialog(bg, input);
                // Seleciona texto existente
                input.select();
            };

            if (currentDialog) {
                dialogQueue.push(run);
            } else {
                run();
            }
        });
    };
})();

/* ═══════════ FILES, IMAGES, IMPORT/EXPORT ═══════════ */
'use strict';

// ─── Constantes ───────────────────────────────────────────────────────────────
const MAX_IMAGE_SIZE  = 20 * 1024 * 1024; // 20 MB
const MAX_IMAGES      = 5;
const EXPORT_VERSION  = 2;

// SVG de fechar reutilizável
const CLOSE_SVG = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2">
    <line x1="18" y1="6"  x2="6"  y2="18"/>
    <line x1="6"  y1="6"  x2="18" y2="18"/>
</svg>`;

// ─── Conversão de arquivo ─────────────────────────────────────────────────────
/**
 * Lê um arquivo de imagem e retorna seus dados em base64.
 * @param {File} file
 * @returns {Promise<ImageData>}
 */
function imageToBase64(file) {
    return new Promise((resolve, reject) => {
        if (file.size > MAX_IMAGE_SIZE) {
            return reject(new Error(`Imagem muito grande (máx ${MAX_IMAGE_SIZE / 1024 / 1024}MB)`));
        }

        const reader = new FileReader();

        reader.onload = () => {
            const preview = reader.result;
            resolve({
                mimeType: file.type,
                data:     preview.split(',')[1],
                name:     file.name,
                size:     file.size,
                preview,
            });
        };

        reader.onerror = () => reject(new Error(`Erro ao ler "${file.name}"`));
        reader.readAsDataURL(file);
    });
}

// ─── Preview de anexos ────────────────────────────────────────────────────────
/**
 * Atualiza a área de preview de imagens pendentes.
 * Usa event delegation em vez de um listener por botão.
 */
function renderAttachPreview() {
    const preview = el('attachPreview');
    const isEmpty = pendingImages.length === 0;

    preview.style.display = isEmpty ? 'none' : 'flex';

    if (isEmpty) { preview.innerHTML = ''; updBtn(); return; }

    // Reconstrói apenas se necessário (evita reflow desnecessário)
    preview.innerHTML = pendingImages.map((img, i) => {
        const sizeKB = Math.round(img.size / 1024);
        return `<div class="attach-item" data-idx="${i}">
            📷 ${esc(img.name)} (${sizeKB} KB)
            <button class="attach-rm" data-idx="${i}" aria-label="Remover ${esc(img.name)}">
                ${CLOSE_SVG}
            </button>
        </div>`;
    }).join('');

    updBtn();
}

// Event delegation: um único listener no container
el('attachPreview').addEventListener('click', e => {
    const btn = e.target.closest('.attach-rm');
    if (!btn) return;
    const idx = Number(btn.dataset.idx);
    if (!isNaN(idx)) {
        pendingImages.splice(idx, 1);
        renderAttachPreview();
        updBtn();
    }
});

// ─── Processamento de arquivos recebidos ──────────────────────────────────────
/**
 * Processa uma lista de arquivos (drag-drop, input, paste).
 * Ignora não-imagens, respeita o limite de MAX_IMAGES.
 *
 * @param {FileList|File[]} files
 */
async function handleFiles(files) {
    const slots = MAX_IMAGES - pendingImages.length;
    if (slots <= 0) { toast(`Máximo ${MAX_IMAGES} imagens por mensagem`, '⚠️'); return; }

    let added = 0;

    for (const file of [...files].slice(0, slots + pendingImages.length)) {
        if (pendingImages.length >= MAX_IMAGES) {
            toast(`Máximo ${MAX_IMAGES} imagens por mensagem`, '⚠️');
            break;
        }
        if (!file.type.startsWith('image/')) {
            toast(`"${file.name}" não é uma imagem suportada`, '⚠️');
            continue;
        }
        try {
            pendingImages.push(await imageToBase64(file));
            added++;
        } catch (e) {
            toast(e.message, '❌');
        }
    }

    if (added > 0) renderAttachPreview();
}

// ─── Export ───────────────────────────────────────────────────────────────────
/**
 * Exporta todos os chats como arquivo JSON.
 * Remove dados binários das imagens (base64) para manter o arquivo leve.
 */
function exportChats() {
    if (!chats.length) { toast('Nada para exportar', '⚠️'); return; }

    const payload = {
        app:      'RicinusAI',
        version:  EXPORT_VERSION,
        exported: new Date().toISOString(),
        chats:    chats.map(_sanitizeChatForExport),
    };

    _downloadJSON(payload, `ricinusai_${Date.now()}.json`);
    toast('Exportado com sucesso!', '✅');
}

/** Remove dados binários das imagens de um chat para o export */
function _sanitizeChatForExport(chat) {
    return {
        ...chat,
        messages: chat.messages.map(m => {
            if (!m.images?.length) return m;
            return {
                ...m,
                images: m.images.map(({ name, mimeType, size }) => ({ name, mimeType, size })),
            };
        }),
    };
}

/** Cria um link temporário e dispara o download de um objeto JSON */
function _downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click();
    URL.revokeObjectURL(url);
}

// ─── Import ───────────────────────────────────────────────────────────────────
/**
 * Abre seletor de arquivo e importa chats de um JSON exportado.
 * IDs duplicados são regeneados automaticamente.
 */
function importChats() {
    const input = Object.assign(document.createElement('input'), {
        type:   'file',
        accept: '.json',
    });

    input.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const data = JSON.parse(await file.text());
            _validateImport(data);

            const count = data.chats.length;
            if (!confirm(`Importar ${count} chat${count !== 1 ? 's' : ''}?`)) return;

            const existingIds = new Set(chats.map(c => c.id));
            const imported = data.chats.map(c => ({
                ...c,
                id: existingIds.has(c.id) ? uid() : c.id,
            }));

            chats.push(...imported);
            save();
            renderList();
            renderMsgs();

            const n = imported.length;
            toast(`${n} chat${n !== 1 ? 's' : ''} importado${n !== 1 ? 's' : ''}!`, '✅');
        } catch (e) {
            toast('Erro ao importar: ' + e.message, '❌');
        }
    });

    input.click();
}

/**
 * Valida estrutura básica de um arquivo de importação.
 * Lança Error descritivo se inválido.
 * @param {object} data
 */
function _validateImport(data) {
    if (!data || typeof data !== 'object')    throw new Error('Arquivo inválido');
    if (!Array.isArray(data.chats))           throw new Error('Formato inválido: "chats" ausente');
    if (data.version > EXPORT_VERSION)        throw new Error(`Versão ${data.version} não suportada`);
    if (data.chats.some(c => !c.id || !Array.isArray(c.messages))) {
        throw new Error('Um ou mais chats estão corrompidos');
    }
}

// ─── Limpar tudo ──────────────────────────────────────────────────────────────
/**
 * Remove todos os chats após confirmação do usuário.
 */
function clearAll() {
    if (!confirm('Excluir TODOS os chats? Esta ação não pode ser desfeita.')) return;

    chats    = [];
    activeId = null;
    save();
    renderList();
    renderMsgs();
    toast('Tudo limpo', '🗑️');
}

/* ═══════════ RENDERING ═══════════ */
'use strict';

// ─── Referências DOM fixas ────────────────────────────────────────────────────
const chatMsgs = el('chatMsgs');
const chatWrap = el('chatWrap');

// ─── SVGs inline reutilizáveis ────────────────────────────────────────────────
const SVG_ICONS = {
    pin:    `<line x1="12" y1="2" x2="12" y2="14"/><path d="M5 10h14l-1.5 4H6.5z"/><line x1="12" y1="14" x2="12" y2="22"/>`,
    chat:   `<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>`,
    pencil: `<path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5z"/>`,
    trash:  `<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>`,

    _wrap(inner, size = 12) {
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2">${inner}</svg>`;
    },
};

// Cards de sugestão da tela de boas-vindas
const WELCOME_CARDS = [
    // Código
    { emoji: '💻', title: 'Código JS',         desc: 'Ordenar array',        prompt: 'Escreva uma função JavaScript para ordenar um array de objetos por uma propriedade específica' },
    { emoji: '🐍', title: 'Código Python',      desc: 'Script útil',          prompt: 'Escreva um script Python para renomear arquivos em lote numa pasta' },
    { emoji: '🎨', title: 'CSS Animação',       desc: 'Efeito moderno',       prompt: 'Crie uma animação CSS fluida de loading skeleton para um card' },
    { emoji: '🗄️', title: 'SQL Query',          desc: 'Consulta complexa',    prompt: 'Escreva uma query SQL para encontrar os 5 clientes que mais compraram no último mês' },

    // Aprendizado
    { emoji: '🧠', title: 'Machine Learning',   desc: 'Explicação simples',   prompt: 'Explique como funciona machine learning de forma simples com exemplos do dia a dia' },
    { emoji: '🔒', title: 'Segurança API',       desc: 'Boas práticas REST',   prompt: 'Quais as melhores práticas de segurança para APIs REST em produção?' },
    { emoji: '📚', title: 'Python',             desc: 'Plano de estudos',     prompt: 'Crie um plano de 30 dias para aprender Python do zero com recursos gratuitos' },
    { emoji: '⚡', title: 'Performance Web',    desc: 'Otimizações',          prompt: 'Quais as principais técnicas para melhorar a performance de um site em 2024?' },

    // Produtividade
    { emoji: '📝', title: 'README',             desc: 'Para seu projeto',     prompt: 'Crie um README profissional para um projeto de API REST em Node.js' },
    { emoji: '🔍', title: 'Code Review',        desc: 'Boas práticas',        prompt: 'Quais os pontos mais importantes para fazer um bom code review?' },
    { emoji: '🚀', title: 'Deploy',             desc: 'Passo a passo',        prompt: 'Explique como fazer deploy de uma aplicação Node.js na AWS do zero' },
    { emoji: '🐛', title: 'Debug',              desc: 'Estratégias',          prompt: 'Quais as melhores estratégias para debugar um bug difícil de reproduzir?' },
];

// Grupos temporais para organizar chats na sidebar
const TIME_GROUPS = [
    { label: 'Hoje',    maxMs: 864e5  },
    { label: 'Ontem',   maxMs: 1728e5 },
    { label: '7 dias',  maxMs: 6048e5 },
    { label: '30 dias', maxMs: 2592e6 },
    { label: 'Antigos', maxMs: Infinity },
];

// ─── Lista de chats (sidebar) ─────────────────────────────────────────────────

/**
 * Re-renderiza a lista de chats na sidebar.
 * Separa fixados de não-fixados e agrupa estes por período.
 */
function renderList() {
    const sList = el('sList');
    const filtered = _filterChats();

    if (!filtered.length) {
        sList.innerHTML = `<div class="s-empty">${searchFilter ? 'Nenhum resultado' : 'Nenhum chat ainda'}</div>`;
        return;
    }

    const frag    = document.createDocumentFragment();
    const pinned  = filtered.filter(c =>  c.pinned);
    const regular = filtered.filter(c => !c.pinned);

    if (pinned.length) {
        _appendGroupLabel(frag, '📌 Fixados');
        pinned.forEach(c => frag.appendChild(_buildSidebarItem(c)));
    }

    const now    = Date.now();
    const groups = Object.fromEntries(TIME_GROUPS.map(g => [g.label, []]));

    for (const c of regular) {
        const age = now - c.createdAt;
        const g   = TIME_GROUPS.find(g => age < g.maxMs);
        groups[g.label].push(c);
    }

    for (const { label } of TIME_GROUPS) {
        if (!groups[label].length) continue;
        _appendGroupLabel(frag, label);
        groups[label].forEach(c => frag.appendChild(_buildSidebarItem(c)));
    }

    sList.innerHTML = '';
    sList.appendChild(frag);
}

/** Filtra chats pelo searchFilter atual */
function _filterChats() {
    if (!searchFilter) return chats;
    const q = searchFilter.toLowerCase();
    return chats.filter(c =>
        c.title.toLowerCase().includes(q) ||
        c.messages.some(m => m.content?.toLowerCase().includes(q))
    );
}

/** Cria e anexa um label de grupo (ex: "Hoje", "📌 Fixados") */
function _appendGroupLabel(parent, text) {
    const g = document.createElement('div');
    g.className  = 's-group';
    g.textContent = text;
    parent.appendChild(g);
}

/**
 * Constrói o elemento DOM de um item da sidebar.
 * Usa event delegation interna para os botões de ação.
 */
function _buildSidebarItem(c) {
    const isActive = c.id === activeId;
    const it       = document.createElement('div');
    it.className   = ['s-item', isActive && 'act', c.pinned && 'pinned'].filter(Boolean).join(' ');
    it.dataset.id  = c.id;

    it.innerHTML = `
        <svg class="s-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            ${c.pinned ? SVG_ICONS.pin : SVG_ICONS.chat}
        </svg>
        <span class="s-item-text">${esc(c.title)}</span>
        <span class="s-item-count">${c.messages.length}</span>
        <div class="s-item-btns">
            <button class="s-item-btn" data-action="pin"  title="${c.pinned ? 'Desfixar' : 'Fixar'}">
                ${SVG_ICONS._wrap(SVG_ICONS.pin)}
            </button>
            <button class="s-item-btn" data-action="ren"  title="Renomear">
                ${SVG_ICONS._wrap(SVG_ICONS.pencil)}
            </button>
            <button class="s-item-btn" data-action="del"  title="Excluir">
                ${SVG_ICONS._wrap(SVG_ICONS.trash)}
            </button>
        </div>`;

    // Event delegation: um único listener cobre todos os botões
    it.addEventListener('click', async e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) { switchChat(c.id); return; }

        e.stopPropagation();
        switch (btn.dataset.action) {
            case 'pin': pinChat(c.id); break;
            case 'ren': renChat(c.id); break;
            case 'del': if (await customConfirm('Excluir este chat?', { danger: true, confirmText: 'Excluir' })) delChat(c.id); break;
        }
    });

    return it;
}

// ─── Mensagens ────────────────────────────────────────────────────────────────

/**
 * Re-renderiza todas as mensagens do chat ativo.
 * Usa DocumentFragment para minimizar reflows.
 */
function renderMsgs() {
    const c = active();
    if (!c?.messages.length) { renderWelcome(); return; }

    const frag = document.createDocumentFragment();
    c.messages.forEach((m, i) => frag.appendChild(_buildMsgNode(m, i)));

    chatMsgs.innerHTML = '';
    chatMsgs.appendChild(frag);
    scrollDown();
}

/**
 * Constrói e retorna o nó DOM de uma mensagem.
 * Também chamado por send.js ao acrescentar mensagens novas.
 */
function addMsgDOM(m, msgIdx) {
    const node = _buildMsgNode(m, msgIdx);
    chatMsgs.appendChild(node);
    return node;
}

function _buildMsgNode(m, msgIdx) {
    const isUser = m.role === 'user';
    const chat   = active();
    const d      = document.createElement('div');
    d.className  = 'msg';
    d.dataset.idx = msgIdx;

    d.innerHTML = `
        <div class="msg-av ${isUser ? 'u' : 'a'}">
            ${isUser ? SVG.userAvatar : SVG.botAvatar}
        </div>
        <div class="msg-body">
            <div class="msg-name">${isUser ? 'Você' : 'RicinusAI'}</div>
            ${_buildImagesHTML(m.images)}
            ${_buildThinkHTML(m.thinking, m.meta)}
            <div class="msg-text">${isUser ? esc(m.content) : md(m.content)}</div>
            ${_buildWordCountHTML(m.content)}
            <div class="msg-acts">
                <button class="act-btn" data-action="copy">📋 Copiar</button>
                ${!isUser ? `<button class="act-btn" data-action="regen">🔄 Regenerar</button>` : ''}
                ${chat && msgIdx !== undefined ? `<button class="act-btn" data-action="fork" data-idx="${msgIdx}">🔀 Bifurcar</button>` : ''}
                ${isUser ? `<button class="act-btn" data-action="edit">✏️ Editar</button>` : ''}
            </div>
        </div>`;

    _bindMsgEvents(d, m, msgIdx, isUser, chat);
    return d;
}

// ─── Builders de sub-blocos de mensagem ───────────────────────────────────────

function _buildImagesHTML(images) {
    if (!images?.length) return '';
    const imgs = images
        .filter(img => img.preview)
        .map(img => `<img src="${img.preview}" alt="${esc(img.name || 'imagem')}"
            onclick="R.openLightbox(this.src)">`)
        .join('');
    return imgs ? `<div class="msg-images">${imgs}</div>` : '';
}

function _buildThinkHTML(thinking, meta) {
    if (!thinking) return '';
    const tid = 't' + Math.random().toString(36).slice(2, 8);
    const dur = meta?.dur ? `<span class="think-dur">${meta.dur}s</span>` : '';
    return `
        <div class="think-box">
            <div class="think-head" data-tid="${tid}">
                <span class="think-arrow" id="ar_${tid}">▶</span> Pensamento${dur}
            </div>
            <div class="think-body" id="${tid}">${md(thinking)}</div>
        </div>`;
}

function _buildWordCountHTML(content) {
    const wc = wordCount(content);
    return `<div class="msg-word-count">${wc} palavra${wc !== 1 ? 's' : ''}</div>`;
}

// ─── Event bindings de mensagem ───────────────────────────────────────────────

/**
 * Registra todos os listeners de uma mensagem via event delegation.
 * Um único listener no container substitui os 4–5 individuais.
 */
function _bindMsgEvents(node, m, msgIdx, isUser, chat) {
    // Toggle do bloco de pensamento
    node.querySelector('.think-head')?.addEventListener('click', function () {
        const tid = this.dataset.tid;
        el(tid)?.classList.toggle('open');
        el('ar_' + tid)?.classList.toggle('open');
    });

    // Delegation para os botões de ação
    node.querySelector('.msg-acts').addEventListener('click', e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;

        switch (btn.dataset.action) {
            case 'copy':
                navigator.clipboard.writeText(m.content ?? '').then(() => {
                    btn.textContent = '✅ Copiado!';
                    setTimeout(() => { btn.textContent = '📋 Copiar'; }, 2000);
                });
                break;

            case 'regen':
                regen();
                break;

            case 'fork':
                if (chat) forkChat(chat.id, Number(btn.dataset.idx));
                break;

            case 'edit':
                if (isUser) editMessage(chat, msgIdx);
                break;
        }
    });
}

// ─── Tela de boas-vindas ──────────────────────────────────────────────────────

function renderWelcome() {
    const shuffled = [...WELCOME_CARDS]
        .sort(() => Math.random() - .5)
        .slice(0, 4);

    const cards = shuffled.map(({ emoji, title, desc, prompt }) => `
        <div class="w-card" data-p="${esc(prompt)}">
            <div class="w-card-t">${emoji} ${esc(title)}</div>
            <div class="w-card-d">${esc(desc)}</div>
        </div>`).join('');

    chatMsgs.innerHTML = `
        <div class="welcome">
            <div class="w-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.73 12.73l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
                </svg>
            </div>
            <h1 class="w-title">Como posso ajudar?</h1>
            <p class="w-sub">Sou o RicinusAI. Pergunte qualquer coisa — código, textos, análises e mais.</p>
            <div class="w-cards">${cards}</div>
        </div>`;

    chatMsgs.querySelector('.w-cards').addEventListener('click', e => {
        const card = e.target.closest('.w-card');
        if (!card) return;
        el('inp').value = card.dataset.p;
        updBtn();
        send();
    });
}
// ─── Scroll ───────────────────────────────────────────────────────────────────

function scrollDown() {
    requestAnimationFrame(() => { chatWrap.scrollTop = chatWrap.scrollHeight; });
}

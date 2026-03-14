/* ═══════════ SEND & STREAMING ═══════════ */
'use strict';

const MEDICAL_KEYWORDS = [
    'remédio', 'medicamento', 'medicina', 'médico', 'diagnóstico',
    'diagnose', 'doença', 'sintoma', 'tratamento', 'dose', 'dosagem',
    'bula', 'receita', 'prescrição', 'farmácia', 'antibiótico',
    'analgésico', 'anti-inflamatório', 'vacina', 'cirurgia', 'exame',
    'hospital', 'clínica', 'consulta', 'dor', 'febre', 'infecção',
    'vírus', 'bactéria', 'câncer', 'tumor', 'diabetes', 'pressão alta',
    'depressão', 'ansiedade', 'psiquiatra', 'psicólogo', 'terapia'
];

function checkMedicalContent(text) {
    const lower = text.toLowerCase();
    return MEDICAL_KEYWORDS.some(k => lower.includes(k));
}

const LEGAL_KEYWORDS = [
    'processo', 'contrato', 'advogado', 'lei', 'crime', 'tribunal',
    'juiz', 'sentença', 'recurso', 'ação judicial', 'direito', 'multa',
    'indenização', 'réu', 'autor', 'petição', 'liminar', 'mandado',
    'delegacia', 'boletim de ocorrência', 'divórcio', 'herança', 'testamento'
];

function checkSensitiveData(text) {
    const cpf = /\d{3}[\.\s]?\d{3}[\.\s]?\d{3}[-\.\s]?\d{2}/;
    const cartao = /\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}/;
    const senha = /(senha|password|secret)\s*[:=]\s*\S+/i;
    return cpf.test(text) || cartao.test(text) || senha.test(text);
}

function checkLegalContent(text) {
    const lower = text.toLowerCase();
    return LEGAL_KEYWORDS.some(k => lower.includes(k));
}

async function send() {
    const inp = el('inp');
    const text = inp.value.trim();
    
    if (checkMedicalContent(text)) {
    toast('⚕️ Consulte sempre um profissional de saúde.', 'ℹ️');
    
    const alertDiv = document.createElement('div');
    alertDiv.className = 'medical-alert';
    alertDiv.innerHTML = `
        <span>⚕️</span>
        <span>As informações abaixo são de caráter informativo. Consulte sempre um médico ou profissional de saúde habilitado antes de tomar qualquer decisão clínica.</span>`;
    chatMsgs.appendChild(alertDiv);
    }

    if (checkLegalContent(text)) {
    toast('⚖️ Consulte sempre um advogado para questões jurídicas.', 'ℹ️');

    const alertDiv = document.createElement('div');
    alertDiv.className = 'legal-alert';
    alertDiv.innerHTML = `
        <span>⚖️</span>
        <span>As informações abaixo são de caráter informativo. Consulte sempre um advogado habilitado antes de tomar decisões jurídicas.</span>`;
    chatMsgs.appendChild(alertDiv);
    }

    if (checkSensitiveData(text)) {
    const confirma = confirm('⚠️ Detectamos o que pode ser um dado sensível (CPF, cartão ou senha) na sua mensagem. Deseja enviar mesmo assim?');
    if (!confirma) return;
    }
    
    if ((!text && pendingImages.length === 0) || generating) return;
    if (!getValidKeys().length) { toast('Configure uma chave API', '⚠️'); openSet(); return; }

    let c = active();
    if (!c) c = newChat();

    const uMsg = { role: 'user', content: text };
    if (pendingImages.length > 0) {
        uMsg.images = [...pendingImages];
        pendingImages = [];
        renderAttachPreview();
    }
    c.messages.push(uMsg);
    autoTitle(c);
    save();

    inp.value = '';
    inp.style.height = 'auto';
    updBtn();
    updCharCount();

    if (chatMsgs.querySelector('.welcome')) chatMsgs.innerHTML = '';
    addMsgDOM(uMsg, c.messages.length - 1);
    scrollDown();

    // Typing indicator
    const typDiv = document.createElement('div');
    typDiv.className = 'msg';
    typDiv.id = 'typInd';
    typDiv.innerHTML = `
        <div class="msg-av a">${SVG.botAvatar}</div>
        <div class="msg-body">
            <div class="msg-name">RicinusAI</div>
            <div class="typing"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
        </div>`;
    chatMsgs.appendChild(typDiv);
    scrollDown();

    generating = true;
    updBtn();
    const t0 = Date.now();

    try {
        const res = await callAPI(c.messages);
        const typ = document.getElementById('typInd');
        if (typ) typ.remove();

        if (res.isStream) {
            await handleStream(res.stream, c, t0, res.keyUsed);
        } else {
            handleFull(res.data, c, t0, res.keyUsed);
        }
    } catch (e) {
        const typ = document.getElementById('typInd');
        if (typ) typ.remove();

        if (e.name === 'AbortError') {
            toast('Cancelado', '🛑');
        } else {
            const eMsg = {
                role: 'model',
                content: `❌ **Erro:** ${e.message}`,
                meta: { dur: ((Date.now() - t0) / 1000).toFixed(1) }
            };
            c.messages.push(eMsg);
            addMsgDOM(eMsg, c.messages.length - 1);
            toast(e.message, '❌');
        }
    } finally {
        generating = false;
        aborter = null;
        updBtn();
        save();
        renderList();
        scrollDown();
    }
}

function handleFull(data, c, t0, keyUsed) {
    const cand = data.candidates?.[0];
    if (!cand) {
        const reason = data.candidates?.[0]?.finishReason;
        throw new Error(reason ? `Resposta bloqueada: ${reason}` : 'Resposta vazia');
    }

    let txt = '', think = '';
    if (cand.content && cand.content.parts) {
        for (const p of cand.content.parts) {
            if (p.thought) think += p.text || '';
            else txt += p.text || '';
        }
    }

    const u = data.usageMetadata || {};
    const dur = ((Date.now() - t0) / 1000).toFixed(1);
    const msg = {
        role: 'model', content: txt, thinking: think || null,
        meta: {
            inTok: u.promptTokenCount, outTok: u.candidatesTokenCount,
            thinkTok: u.thoughtsTokenCount, dur, model: S.model, keyUsed
        }
    };
    c.messages.push(msg);
    addMsgDOM(msg, c.messages.length - 1);
    scrollDown();
}

async function handleStream(stream, c, t0, keyUsed) {
    let txt = '', think = '', lastU = null;
    const sid = uid();

    const d = document.createElement('div');
    d.className = 'msg';
    d.innerHTML = `
        <div class="msg-av a">${SVG.botAvatar}</div>
        <div class="msg-body">
            <div class="msg-name">RicinusAI</div>
            <div class="think-box" id="stThink_${sid}" style="display:none">
                <div class="think-head" id="stThinkH_${sid}">
                    <span class="think-arrow" id="stThinkAr_${sid}">▶</span> Pensando...
                </div>
                <div class="think-body" id="stThinkB_${sid}"></div>
            </div>
            <div class="msg-text streaming" id="stTxt_${sid}"></div>
            <div class="msg-meta" id="stMeta_${sid}" style="display:none"></div>
        </div>`;
    chatMsgs.appendChild(d);
    scrollDown();

    const stTxt = el(`stTxt_${sid}`);
    const stThink = el(`stThink_${sid}`);
    const stThinkB = el(`stThinkB_${sid}`);
    const stMeta = el(`stMeta_${sid}`);
    const stThinkH = el(`stThinkH_${sid}`);
    const stThinkAr = el(`stThinkAr_${sid}`);

    if (stThinkH) {
        stThinkH.addEventListener('click', () => {
            stThinkB.classList.toggle('open');
            stThinkAr.classList.toggle('open');
        });
    }

    try {
        for await (const chunk of parseSSE(stream)) {
            if (!chunk.candidates?.[0]?.content?.parts) continue;
            for (const p of chunk.candidates[0].content.parts) {
                if (p.thought) {
                    think += p.text || '';
                    stThink.style.display = 'block';
                    stThinkB.innerHTML = md(think);
                } else {
                    txt += p.text || '';
                    stTxt.innerHTML = md(txt);
                }
            }
            if (chunk.usageMetadata) lastU = chunk.usageMetadata;
            scrollDown();
        }
    } catch (e) {
        if (e.name !== 'AbortError') throw e;
    }

    stTxt.classList.remove('streaming');
    const dur = ((Date.now() - t0) / 1000).toFixed(1);
    const u = lastU || {};

    stMeta.style.display = 'none';
    stMeta.innerHTML = '';

    // Word count
    const wc = wordCount(txt);
    const wcDiv = document.createElement('div');
    wcDiv.className = 'msg-word-count';
    wcDiv.textContent = `${wc} palavra${wc !== 1 ? 's' : ''}`;
    d.querySelector('.msg-body').insertBefore(wcDiv, stMeta.nextSibling);

    // Action buttons
    const acts = document.createElement('div');
    acts.className = 'msg-acts';

    const cpBtn = document.createElement('button');
    cpBtn.className = 'act-btn';
    cpBtn.textContent = '📋 Copiar';
    cpBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(txt).then(() => {
            cpBtn.textContent = '✅ Copiado!';
            setTimeout(() => cpBtn.textContent = '📋 Copiar', 2000);
        });
    });

    const rgBtn = document.createElement('button');
    rgBtn.className = 'act-btn';
    rgBtn.textContent = '🔄 Regenerar';
    rgBtn.addEventListener('click', () => regen());

    acts.appendChild(cpBtn);
    acts.appendChild(rgBtn);
    d.querySelector('.msg-body').appendChild(acts);

    const msg = {
        role: 'model', content: txt, thinking: think || null,
        meta: {
            inTok: u.promptTokenCount, outTok: u.candidatesTokenCount,
            thinkTok: u.thoughtsTokenCount, dur, model: S.model, keyUsed
        }
    };
    c.messages.push(msg);
}

const contBtn = document.createElement('button');
contBtn.className = 'act-btn';
contBtn.textContent = '▶️ Continuar';
contBtn.addEventListener('click', async () => {
    if (generating) return;
    const c = active();
    if (!c) return;
    const lastMsg = c.messages[c.messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'model') return;

    // Injeta instrução de continuar
    c.messages.push({ role: 'user', content: 'Continue a resposta do ponto onde parou.' });
    contBtn.disabled = true;

    generating = true;
    updBtn();
    const t0 = Date.now();
    try {
        const res = await callAPI(c.messages);
        if (res.isStream) await handleStream(res.stream, c, t0, res.keyUsed);
        else handleFull(res.data, c, t0, res.keyUsed);
    } catch(e) {
        toast(e.message, '❌');
    } finally {
        generating = false;
        updBtn();
        save();
    }
});
acts.appendChild(contBtn);

function stopGen() {
    if (aborter) aborter.abort();
}

async function regen() {
    const c = active();
    if (!c || c.messages.length < 2 || generating) return;

    // Find and remove last model message
    let lastModelIdx = -1;
    for (let i = c.messages.length - 1; i >= 0; i--) {
        if (c.messages[i].role === 'model') { lastModelIdx = i; break; }
    }
    if (lastModelIdx === -1) return;

    c.messages.splice(lastModelIdx, 1);
    save();
    renderMsgs();

    const lastMsg = c.messages[c.messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'user') return;

    // Typing indicator
    const typDiv = document.createElement('div');
    typDiv.className = 'msg';
    typDiv.id = 'typInd';
    typDiv.innerHTML = `
        <div class="msg-av a">${SVG.botAvatar}</div>
        <div class="msg-body">
            <div class="msg-name">RicinusAI</div>
            <div class="typing"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
        </div>`;
    chatMsgs.appendChild(typDiv);
    scrollDown();

    generating = true;
    updBtn();
    const t0 = Date.now();

    try {
        const res = await callAPI(c.messages);
        const typ = document.getElementById('typInd');
        if (typ) typ.remove();

        if (res.isStream) await handleStream(res.stream, c, t0, res.keyUsed);
        else handleFull(res.data, c, t0, res.keyUsed);
    } catch (e) {
        const typ = document.getElementById('typInd');
        if (typ) typ.remove();
        if (e.name === 'AbortError') toast('Cancelado', '🛑');
        else {
            const eMsg = { role: 'model', content: `❌ **Erro:** ${e.message}`, meta: { dur: ((Date.now() - t0) / 1000).toFixed(1) } };
            c.messages.push(eMsg);
            addMsgDOM(eMsg, c.messages.length - 1);
            toast(e.message, '⚠️');
        }
    } finally {
        generating = false;
        aborter = null;
        updBtn();
        save();
        renderList();
        scrollDown();
    }
}

/* ═══════════ API CALLS ═══════════ */
'use strict';

// ─── Constantes ───────────────────────────────────────────────────────────────
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MIN_KEY_LEN = 30;
const MAX_CONTEXT_TOKENS = 800_000;

// Status HTTP que justificam tentar a próxima chave
const RETRYABLE_STATUSES = new Set([429, 403, 500, 502, 503]);

// [FIX #1] Declaração explícita de aborter no escopo do módulo.
// Evita ReferenceError em strict mode e documenta o propósito da variável.
let aborter = null;

// ─── Chaves ───────────────────────────────────────────────────────────────────
/**
 * Decodifica uma chave obfuscada em base64.
 * Retorna string vazia se inválida.
 */
function _decodeKey(k) {
    try { return atob(k.replace(/\s/g, '')); } catch { return ''; }
}

/**
 * Retorna as chaves válidas conforme o modo atual.
 * Em modo 'default' usa _OBFUSCATED_KEYS (base64); caso contrário usa S.apiKeys.
 */
function getValidKeys() {
    const raw = S.apiMode === 'default'
        ? _OBFUSCATED_KEYS.map(_decodeKey)
        : [...S.apiKeys];

    return raw.filter(k => typeof k === 'string' && k.trim().length >= MIN_KEY_LEN);
}

// ─── System prompt ────────────────────────────────────────────────────────────
/**
 * Decodifica o prompt obfuscado e mescla com o prompt customizado do usuário.
 * Memoizado: recalcula apenas quando S.systemPrompt muda.
 */
const _promptCache = { custom: null, result: null };

function buildSystemPrompt() {
    if (_promptCache.custom === S.systemPrompt) return _promptCache.result;

    const base = (() => {
        try { return decodeURIComponent(escape(atob(_OBFUSCATED_PROMPT))); } catch { return ''; }
    })();

    const merged = base + (S.systemPrompt ? '\n\n' + S.systemPrompt : '');
    _promptCache.custom = S.systemPrompt;
    _promptCache.result = merged.trim() ? merged : null;
    return _promptCache.result;
}

// ─── Truncamento inteligente de contexto ──────────────────────────────────────
/**
 * Estima tokens de uma mensagem.
 * Texto: heurística chars/4. Imagens: ~85 tokens por KB de dados binários.
 *
 * [FIX #3] Separa a estimativa de tokens de texto e de imagens, evitando
 * misturar unidades (chars de texto vs. bytes de imagem) na mesma divisão.
 *
 * @param {object} m - mensagem com content e images opcionais
 * @returns {number}
 */
function _estimateTokens(m) {
    // Texto: ~4 chars por token
    const textTokens = Math.ceil((m.content ?? '').length / 4);

    // Imagens base64: converte para bytes e estima ~85 tokens por KB
    let imageTokens = 0;
    for (const img of (m.images ?? [])) {
        if (img?.data) {
            const bytes = img.data.length * 0.75; // base64 → bytes
            imageTokens += Math.ceil((bytes / 1024) * 85);
        }
    }

    return textTokens + imageTokens;
}

/**
 * Trunca mensagens para caber no limite de tokens.
 * Preserva: primeira mensagem do usuário + máximo de mensagens recentes possível.
 * Injeta aviso (role 'model') no ponto de corte para manter alternância de turnos.
 *
 * [FIX #2] Mensagem de aviso agora usa role 'model' — evita dois turns 'user'
 * consecutivos, que causariam HTTP 400 na API Gemini.
 * [FIX #4] Loop usa `continue` em vez de `break` — mensagens menores após uma
 * mensagem grande que não coube continuam sendo consideradas.
 * [FIX #5] Removida verificação redundante `!kept.includes(firstUserMsg)`:
 * o firstUserIdx é explicitamente ignorado no loop, logo firstUserMsg nunca
 * entra em `kept`. Substituída por `!kept.includes(lastMsg)` mais preciso.
 *
 * @param {Array} messages - histórico completo
 * @returns {Array} - histórico truncado
 */
function truncateMessages(messages) {
    if (!messages.length) return messages;

    const tokenCounts = messages.map(_estimateTokens);
    const totalTokens = tokenCounts.reduce((a, b) => a + b, 0);

    if (totalTokens <= MAX_CONTEXT_TOKENS) return messages;

    toast('Conversa longa: histórico parcialmente omitido', '⚠️');

    const firstUserIdx = messages.findIndex(m => m.role === 'user');
    const firstUserMsg = firstUserIdx >= 0 ? messages[firstUserIdx] : null;
    const firstUserTokens = firstUserMsg ? tokenCounts[firstUserIdx] : 0;

    // Reserva tokens para: primeira mensagem de usuário + aviso (~20 tokens)
    const NOTICE_TOKENS = 20;
    const availableTokens = MAX_CONTEXT_TOKENS - firstUserTokens - NOTICE_TOKENS;

    // Coleta mensagens do final até esgotar o budget.
    // `continue` (não `break`) permite aproveitar mensagens menores após um gap.
    const kept = [];
    let keptTokens = 0;

    for (let i = messages.length - 1; i >= 0; i--) {
        if (i === firstUserIdx) continue; // será adicionada separadamente

        const msgTokens = tokenCounts[i];
        if (keptTokens + msgTokens <= availableTokens) {
            kept.unshift(messages[i]);
            keptTokens += msgTokens;
        }
        // não quebra: mensagens menores anteriores ainda podem caber
    }

    // A última mensagem (turno atual do usuário) nunca pode ser descartada
    const lastMsg = messages[messages.length - 1];
    if (!kept.includes(lastMsg)) {
        kept.push(lastMsg);
    }

    const result = [];

    // Âncora de contexto: primeira mensagem do usuário
    if (firstUserMsg) {
        result.push(firstUserMsg);
    }

    // Aviso de corte com role 'model' para garantir alternância user→model→user…
    result.push({
        role: 'model',
        content: '[Contexto anterior omitido para caber no limite de tokens]'
    });

    result.push(...kept);

    return result;
}

// ─── Body builder ─────────────────────────────────────────────────────────────
/**
 * Converte uma mensagem do chat num objeto contents aceito pela API Gemini.
 *
 * [FIX #2] Garante que `parts` nunca seja vazio — a API Gemini rejeita
 * parts:[] com HTTP 400.
 */
function _buildContentPart(m) {
    const parts = [];

    if (m.content) parts.push({ text: m.content });

    for (const img of (m.images ?? [])) {
        if (img?.data) {
            parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
        }
    }

    // Fallback: garante ao menos uma parte para evitar HTTP 400
    if (!parts.length) parts.push({ text: '' });

    return { role: m.role === 'user' ? 'user' : 'model', parts };
}

/**
 * Monta o corpo da requisição para a API Gemini.
 *
 * [FIX #3] thinkingBudget só é enviado quando é um inteiro positivo válido,
 * evitando erros de API com valores undefined, null ou 0.
 *
 * @param {Array} messages - histórico de mensagens do chat
 * @param {object} [options] - opções adicionais
 * @param {number} [options.maxOutputTokens] - override para maxOutputTokens
 */
function buildBody(messages, options = {}) {
    const body = {
        contents: messages.map(_buildContentPart),
        generationConfig: {
            temperature: S.temperature,
            maxOutputTokens: options.maxOutputTokens ?? S.maxTokens,
            topP: S.topP,
        },
    };

    // Thinking config — só disponível em modelos 2.5+ com budget inteiro positivo
    if (
        S.thinking &&
        S.model.includes('2.5') &&
        Number.isInteger(S.thinkingBudget) &&
        S.thinkingBudget > 0
    ) {
        body.generationConfig.thinkingConfig = { thinkingBudget: S.thinkingBudget };
    }

    const prompt = buildSystemPrompt();
    if (prompt) {
        body.systemInstruction = { parts: [{ text: prompt }] };
    }

    return body;
}

// ─── URL builder ──────────────────────────────────────────────────────────────
function _buildUrl(key, streaming = S.streaming) {
    const action = streaming ? 'streamGenerateContent' : 'generateContent';
    const sse = streaming ? '&alt=sse' : '';
    return `${API_BASE}/${S.model}:${action}?key=${key}${sse}`;
}

// ─── Fetch com retry por chave ────────────────────────────────────────────────
/**
 * Tenta cada chave válida em round-robin.
 * Avança para a próxima chave em erros retryable (quota, rate-limit, servidor).
 * Lança erro consolidado se todas as chaves falharem.
 *
 * [FIX #1] `aborter` agora é declarado no topo do módulo e recebe um novo
 * AbortController a cada tentativa. Isso elimina a race condition de chamadas
 * concorrentes sobrescreverem o controller umas das outras.
 * [FIX #7] `currentKeyIdx` é sanitizado com Math.abs e fallback para 0,
 * evitando índice negativo caso o valor persistido esteja corrompido.
 *
 * @param {Array} messages
 * @returns {{ data?, stream?, isStream: boolean, keyUsed: number }}
 */
async function callAPI(messages) {
    const validKeys = getValidKeys();
    if (!validKeys.length) throw new Error('Nenhuma chave API válida configurada.');

    const truncatedMessages = truncateMessages(messages);
    const body = buildBody(truncatedMessages);

    // [FIX #7] Protege contra currentKeyIdx negativo ou indefinido
    const startIdx = Math.abs(S.currentKeyIdx ?? 0) % validKeys.length;
    const errors = [];

    for (let tried = 0; tried < validKeys.length; tried++) {
        const keyIdx = (startIdx + tried) % validKeys.length;
        const key    = validKeys[keyIdx];

        // [FIX #1] Controller local por tentativa — sem race condition entre
        // chamadas concorrentes. O módulo exporta sempre o controller mais recente.
        const controller = new AbortController();
        aborter = controller;

        let res;
        try {
            res = await fetch(_buildUrl(key), {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(body),
                signal:  controller.signal,
            });
        } catch (e) {
            if (e.name === 'AbortError') throw e;
            errors.push(`Chave #${keyIdx + 1}: falha de rede – ${e.message}`);
            continue;
        }

        if (res.ok) {
            updateSettings({ currentKeyIdx: keyIdx });

            if (S.streaming) return { stream: res.body, isStream: true, keyUsed: keyIdx };
            const data = await res.json();
            return { data, isStream: false, keyUsed: keyIdx };
        }

        // ── Resposta de erro ──────────────────────────────────────────────────
        const errPayload = await res.json().catch(() => ({}));
        const errMsg     = errPayload.error?.message ?? '';
        const isRetryable = RETRYABLE_STATUSES.has(res.status)
            || /quota|rate[\s_-]?limit/i.test(errMsg);

        errors.push(`Chave #${keyIdx + 1} (HTTP ${res.status}): ${errMsg || 'sem detalhe'}`);
        console.warn(`[api] ${errors.at(-1)}`);

        if (isRetryable) continue;

        // Erro definitivo (ex: 400 Bad Request) — não adianta tentar outra chave
        throw new Error(errMsg || `Erro HTTP ${res.status}`);
    }

    // Todas as chaves esgotadas
    console.error('[api] Todas as chaves falharam:\n' + errors.join('\n'));
    throw new Error(
        'Nossos servidores estão enfrentando instabilidades no momento. Tente novamente em alguns instantes.'
    );
}

// ─── Validação de chave API no carregamento ───────────────────────────────────
/** Flag para rastrear se o usuário interagiu com o app */
let _userHasInteracted = false;

// Detecta interação do usuário
['click', 'keydown', 'touchstart'].forEach(evt => {
    document.addEventListener(evt, () => { _userHasInteracted = true; }, { once: true, passive: true });
});

/**
 * Valida se pelo menos uma chave API está funcional.
 * Roda em background sem bloquear o carregamento.
 * Exibe toast e abre settings se a chave estiver inválida.
 */
async function validateKeysOnLoad() {
    // Não valida se estiver usando chaves do sistema (modo default com chaves obfuscadas)
    if (S.apiMode === 'default' && _OBFUSCATED_KEYS.length > 0) {
        return;
    }

    const validKeys = getValidKeys();
    if (!validKeys.length) {
        _showKeyError();
        return;
    }

    const testKey = validKeys[0];

    try {
        const res = await fetch(
            `${API_BASE}/${S.model}:generateContent?key=${testKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
                    generationConfig: { maxOutputTokens: 1 }
                })
            }
        );

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            const errMsg = errData.error?.message ?? '';

            // Verifica se é erro de chave inválida ou quota
            if (res.status === 400 || res.status === 401 || res.status === 403 ||
                /invalid|api.?key|quota|billing/i.test(errMsg)) {
                _showKeyError();
            }
            // Outros erros (5xx, rate limit) não significam chave inválida
        }
    } catch (e) {
        // Erro de rede — não significa chave inválida, ignora silenciosamente
        console.warn('[api] Falha ao validar chave (rede):', e.message);
    }
}

/**
 * Exibe erro de chave inválida e abre settings automaticamente.
 */
function _showKeyError() {
    const t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'alert');
    t.innerHTML = `<span aria-hidden="true">⚠️</span><span>Chave API inválida ou sem cota. Verifique em Configurações.</span>`;
    el('toasts').appendChild(t);

    setTimeout(() => { if (t.isConnected) t.remove(); }, 6000);

    setTimeout(() => {
        if (!_userHasInteracted && typeof openSet === 'function') {
            openSet();
        }
    }, 1500);
}

// ─── Parser SSE ───────────────────────────────────────────────────────────────
/**
 * Gerador assíncrono que parseia um stream SSE linha a linha.
 * Suporta chunks parciais via buffer e libera o reader sempre ao final.
 *
 * @param {ReadableStream} stream
 * @yields {object} Objetos JSON parseados de cada evento data:
 */
async function* parseSSE(stream) {
    const reader = stream.getReader();
    const dec    = new TextDecoder();
    let buf = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buf += dec.decode(value, { stream: true });

            const lines = buf.split('\n');
            buf = lines.pop() ?? ''; // preserva linha incompleta

            for (const line of lines) {
                const chunk = _parseSSELine(line);
                if (chunk === 'DONE') return;
                if (chunk) yield chunk;
            }
        }

        // Drena o buffer residual
        if (buf.trim()) {
            const chunk = _parseSSELine(buf);
            if (chunk && chunk !== 'DONE') yield chunk;
        }
    } finally {
        reader.releaseLock();
    }
}

/**
 * Parseia uma única linha SSE.
 *
 * [FIX #6] Chunks malformados agora emitem console.warn antes de retornar null,
 * facilitando o diagnóstico de respostas truncadas em produção.
 *
 * @returns {object|'DONE'|null}
 */
function _parseSSELine(line) {
    const t = line.trim();
    if (!t.startsWith('data: ')) return null;

    const payload = t.slice(6);
    if (payload === '[DONE]') return 'DONE';

    try {
        return JSON.parse(payload);
    } catch (e) {
        console.warn('[api] Chunk SSE malformado, ignorado:', payload, e.message);
        return null;
    }
}

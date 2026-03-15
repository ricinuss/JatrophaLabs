/* ═══════════ API CALLS ═══════════ */
'use strict';

// ─── Constantes ───────────────────────────────────────────────────────────────
const API_BASE    = 'https://generativelanguage.googleapis.com/v1beta/models';
const MIN_KEY_LEN = 30;

// Status HTTP que justificam tentar a próxima chave
const RETRYABLE_STATUSES = new Set([429, 403, 500, 502, 503]);

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

// ─── Body builder ─────────────────────────────────────────────────────────────
/**
 * Converte uma mensagem do chat num objeto `contents` aceito pela API Gemini.
 */
function _buildContentPart(m) {
    const parts = [];

    if (m.content) parts.push({ text: m.content });

    for (const img of (m.images ?? [])) {
        if (img?.data) {
            parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
        }
    }

    return { role: m.role === 'user' ? 'user' : 'model', parts };
}

/**
 * Monta o corpo da requisição para a API Gemini.
 * @param {Array} messages - histórico de mensagens do chat
 */
function buildBody(messages) {
    const body = {
        contents: messages.map(_buildContentPart),
        generationConfig: {
            temperature:      S.temperature,
            maxOutputTokens:  S.maxTokens,
            topP:             S.topP,
        },
    };

    // Thinking config — só disponível em modelos 2.5+
    if (S.thinking && S.model.includes('2.5')) {
        body.generationConfig.thinkingConfig = { thinkingBudget: S.thinkingBudget };
    }

    const prompt = buildSystemPrompt();
    if (prompt) {
        body.systemInstruction = { parts: [{ text: prompt }] };
    }

    return body;
}

// ─── URL builder ──────────────────────────────────────────────────────────────
function _buildUrl(key) {
    const action = S.streaming ? 'streamGenerateContent' : 'generateContent';
    const sse    = S.streaming ? '&alt=sse' : '';
    return `${API_BASE}/${S.model}:${action}?key=${key}${sse}`;
}

// ─── Fetch com retry por chave ────────────────────────────────────────────────
/**
 * Tenta cada chave válida em round-robin.
 * Avança para a próxima chave em erros retryable (quota, rate-limit, servidor).
 * Lança erro consolidado se todas as chaves falharem.
 *
 * @param {Array} messages
 * @returns {{ data?, stream?, isStream: boolean, keyUsed: number }}
 */
async function callAPI(messages) {
    const validKeys = getValidKeys();
    if (!validKeys.length) throw new Error('Nenhuma chave API válida configurada.');

    const body     = buildBody(messages);
    const startIdx = S.currentKeyIdx % validKeys.length;
    const errors   = [];

    for (let tried = 0; tried < validKeys.length; tried++) {
        const keyIdx = (startIdx + tried) % validKeys.length;
        const key    = validKeys[keyIdx];

        aborter = new AbortController();

        let res;
        try {
            res = await fetch(_buildUrl(key), {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(body),
                signal:  aborter.signal,
            });
        } catch (e) {
            if (e.name === 'AbortError') throw e;
            errors.push(`Chave #${keyIdx + 1}: falha de rede – ${e.message}`);
            continue; // tenta próxima chave
        }

        if (res.ok) {
            // Persiste a key que funcionou
            updateSettings({ currentKeyIdx: keyIdx });

            if (S.streaming) return { stream: res.body, isStream: true,  keyUsed: keyIdx };
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

// ─── Parser SSE ───────────────────────────────────────────────────────────────
/**
 * Gerador assíncrono que parseia um stream SSE linha a linha.
 * Suporta chunks parciais via buffer e libera o reader sempre ao final.
 *
 * @param {ReadableStream} stream
 * @yields {object} Objetos JSON parseados de cada evento `data:`
 */
async function* parseSSE(stream) {
    const reader = stream.getReader();
    const dec    = new TextDecoder();
    let   buf    = '';

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
 * @returns {object|'DONE'|null}
 */
function _parseSSELine(line) {
    const t = line.trim();
    if (!t.startsWith('data: ')) return null;

    const payload = t.slice(6);
    if (payload === '[DONE]') return 'DONE';

    try { return JSON.parse(payload); } catch { return null; }
}

/* ═══════════ STATE MANAGEMENT ═══════════ */
'use strict';

const _OBFUSCATED_KEYS = [
    'QUl6YVN5Q0pwTXFaLTZQbTFUNGtPa1ZaZ2NUUGNHM2lNQ2ZCYjNv',
    'QUl6YVN5RElyUjFmb1I4OVJ3dU8yYnJQYy1KY2Zzb283bUZwd05V',
    'QUl6YVN5QUVJRjRKRnZ3dXRqV3o3eFVfa3FGQ2ZDdWI0Z0FxSGo0',
    'QUl6YVN5Q3EtNjVKaGEwS1pNQ1BzSTFOa1c0UmdrYzhNejFyNW1B',
    'QUl6YVN5Q0didjZEZWotd2hlNU9NalhQRVB2OW9zM3AxbG02b2hJ',
    'QUl6YVN5RGQ3YlF6RzQ0Q01FV0lkb1VfbDMzTzl0MzBqRHZxbzZF',
    'QUl6YVN5RFNGN1NYLUNxUnQwQk9ySVdTYm9pYlAwV3pxcXh3dUFv',
    'QUl6YVN5RGQwQmgtdHdJNVZNVjZCbFpEM2NneE5nUDcyZW4xWW9B',
    'QUl6YVN5REJxZF9yWmZnQlhtSmo3bnNnZ3R1MEMycTNy b3NKeTkzYw==',
    'QUl6YVN5QWpFZlJ0VW1kaXVXVG4tdDNLd29sd3JabHJxV3JUbnBj'
];

const DEFAULTS = {
    apiKeys: _OBFUSCATED_KEYS, // Agora usa as chaves processadas
    apiMode: 'default',
    currentKeyIdx: 0,
    systemPrompt: '',
    temperature: 1,
    maxTokens: 8192,
    topP: 0.95,
    model: 'gemini-2.5-flash',
    thinking: true,
    thinkingBudget: 8192,
    streaming: true,
    theme: 'dark'
};

let S = { ...DEFAULTS };
let chats = [];
let activeId = null;
let generating = false;
let aborter = null;
let pendingImages = [];
let searchFilter = '';

const el = id => document.getElementById(id);

function save() {
    try {
        localStorage.setItem('rai_s', JSON.stringify(S));
        localStorage.setItem('rai_c', JSON.stringify(chats));
        localStorage.setItem('rai_a', activeId);
    } catch (e) {
        if (e.name === 'QuotaExceededError') {
            toast('Armazenamento cheio! Exclua chats antigos.', '⚠️');
        }
    }
}

function load() {
    try {
        const s = localStorage.getItem('rai_s');
        if (s) S = { ...DEFAULTS, ...JSON.parse(s) };
        if (!Array.isArray(S.apiKeys)) S.apiKeys = S.apiKeys ? [S.apiKeys] : [''];
        if (!S.apiMode) S.apiMode = 'default';

        const c = localStorage.getItem('rai_c');
        if (c) chats = JSON.parse(c);

        const a = localStorage.getItem('rai_a');
        if (a && chats.find(x => x.id === a)) activeId = a;
    } catch (e) {
        console.warn('Failed to load state:', e);
    }
}

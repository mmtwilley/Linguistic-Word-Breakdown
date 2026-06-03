import { translateOnly, CHUNK_TIMEOUT_MS, TRANSLATION_SYSTEM_PROMPT, TEXT_TRANSLATION_TOOL } from './analyzer.js';
import { getCached, addEntry } from './history.js';
import { SlidingWindowRateLimiter } from './rate-limiter.js';
import { ApiError, ValidationError } from './errors/index.js';

const CHUNK_TARGET_SIZE = 500;
const MAX_RETRIES       = 3;
const RETRY_BASE_MS     = 1_000;
const MAX_BULK_CHARS    = 30_000;

const API_URL     = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const MODEL       = 'claude-sonnet-4-6';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export function chunkText(text, targetSize = CHUNK_TARGET_SIZE) {
  const segments = text.split(/\n\n|\n/);
  const units = [];
  let index = 0;

  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;

    if (trimmed.length <= targetSize) {
      units.push({ index: index++, text: trimmed, status: 'pending', translation: null, retries: 0, fromCache: false });
    } else {
      let start = 0;
      while (start < trimmed.length) {
        let end = Math.min(start + targetSize, trimmed.length);
        if (end < trimmed.length) {
          const lastSpace = trimmed.lastIndexOf(' ', end);
          if (lastSpace > start) end = lastSpace;
        }
        const chunk = trimmed.slice(start, end).trim();
        if (chunk) units.push({ index: index++, text: chunk, status: 'pending', translation: null, retries: 0, fromCache: false });
        start = end;
      }
    }
  }

  return units;
}

export function validateBulkInput(text) {
  if (text.length > MAX_BULK_CHARS) {
    throw new ValidationError('text', 'Text is too long for bulk translation. Maximum is approximately 5 000 words.');
  }
}

export async function prewarmCache(apiKey) {
  try {
    await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1,
        system: [{ type: 'text', text: TRANSLATION_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        tools: [{ ...TEXT_TRANSLATION_TOOL, cache_control: { type: 'ephemeral' } }],
        tool_choice: { type: 'tool', name: 'text_translation' },
        messages: [{ role: 'user', content: 'warmup' }],
      }),
    });
  } catch {
    console.warn('[Lingua] Cache pre-warm failed (non-fatal)');
  }
}

export class BulkTranslator {
  constructor(text) {
    validateBulkInput(text);
    this.units = chunkText(text);
    this.session = {
      units: this.units,
      total: this.units.length,
      completed: 0,
      failed: 0,
      cancelled: false,
    };
    this.abortController = new AbortController();
    this._rateLimiter = new SlidingWindowRateLimiter();
  }

  abort() {
    this.session.cancelled = true;
    this.abortController.abort();
  }

  async _dispatchUnit(unit, apiKey, deeplKey, callbacks) {
    if (this.session.cancelled) return;

    const cached = await getCached(unit.text);
    if (cached?.translation) {
      unit.status = 'hit';
      unit.translation = cached.translation;
      unit.fromCache = true;
      return;
    }

    if (this.session.cancelled) return;

    await this._rateLimiter.waitForSlot();
    this._rateLimiter.record();

    if (this.session.cancelled) return;

    let delay = RETRY_BASE_MS;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const chunkController = new AbortController();
      const onParentAbort = () => chunkController.abort();
      this.abortController.signal.addEventListener('abort', onParentAbort, { once: true });
      const chunkTimer = setTimeout(() => chunkController.abort(), CHUNK_TIMEOUT_MS);

      unit.status = 'translating';
      try {
        const result = await translateOnly(unit.text, apiKey, deeplKey, { signal: chunkController.signal });
        clearTimeout(chunkTimer);
        this.abortController.signal.removeEventListener('abort', onParentAbort);
        unit.status = 'done';
        unit.translation = result.translation;
        try { await addEntry({ translation: result.translation, tokens: [] }, unit.text, 'UND'); } catch {}
        return;
      } catch (err) {
        clearTimeout(chunkTimer);
        this.abortController.signal.removeEventListener('abort', onParentAbort);
        if (err instanceof ApiError && err.status === 429 && attempt < MAX_RETRIES) {
          unit.retries++;
          if (delay >= 5_000) callbacks.onRateLimitDelay?.(delay);
          await sleep(delay);
          delay *= 2;
          if (this.session.cancelled) { unit.status = 'failed'; return; }
          continue;
        }
        unit.status = 'failed';
        console.warn('[Lingua] Bulk unit failed:', err.message);
        return;
      }
    }
  }

  async runQueue(apiKey, deeplKey, callbacks = {}) {
    for (const unit of this.units) {
      if (this.session.cancelled) break;
      await this._dispatchUnit(unit, apiKey, deeplKey, callbacks);
      if (unit.status === 'done' || unit.status === 'hit') {
        this.session.completed++;
      } else if (unit.status === 'failed') {
        this.session.failed++;
      }
      callbacks.onUnitComplete?.(unit, this.session);
    }

    if (this.session.completed > 0) {
      const fullInput = this.units.map(u => u.text).join(' ').trim();
      const fullTranslation = this.units
        .filter(u => u.status === 'done' || u.status === 'hit')
        .map(u => u.translation)
        .join('\n\n');
      try {
        await addEntry({ translation: fullTranslation, tokens: [] }, fullInput, 'UND');
      } catch (err) {
        console.warn('[Lingua] Bulk history write failed:', err.message);
      }
    }

    callbacks.onQueueComplete?.(this.session);
  }
}

# Security & Error Handling: Linguistic Word Breakdown

**Branch**: `001-lingua-word-breakdown` | **Date**: 2026-05-03

This document provides implementation guidance for security and error handling measures defined in [spec.md](spec.md).

---

## Error Handling Architecture

### Error Classification

| Class | Examples | User Action | Retry Helpful? |
|-------|----------|-------------|--|
| **User Input** | Empty text, too long (>2000 chars) | Fix input, resubmit | N/A (not an error) |
| **Network** | Connection lost, DNS failure, timeout | Retry (wait if timeout) | Yes |
| **API Auth** | Invalid/expired API key (HTTP 401) | Update API key in Settings | No (need key change) |
| **API Rate Limit** | Too many requests (HTTP 429) | Manual retry after wait | Yes (after cooldown) |
| **API Server** | Server error (HTTP 5xx) | Manual retry | Yes |
| **Response Format** | Malformed JSON, missing fields | Retry | Maybe (transient bug) |
| **Response Validity** | Invalid POS tag, token count mismatch | Accept with warning | No (model limitation) |
| **Response Size** | Response > 50 KB or >500 tokens | User reduces input length | N/A (suggest shorter input) |

### Client-Side Implementation Strategy

**Error Boundary**: Wrap all API calls in try/catch. Categorize errors before rendering.

```
try {
  validate input length ≤ 2000
  read apiKey from chrome.storage.local
  if (!apiKey) → show Settings view
  
  set 1-second rate limit (block submit if called < 1s ago)
  show loading spinner
  
  const result = await analyzeText(text, apiKey)
    // throws ApiError(status, message) on HTTP error
    // throws JsonError(message) on parse failure
    // throws ValidationError(field, message) on missing/invalid field
  
  validate result (token count, all fields present)
  render results
  
} catch (error) {
  if (error instanceof NetworkError) {
    show "Network error..." with Retry button
  } else if (error instanceof TimeoutError) {
    show "Request timed out..." with Retry button
  } else if (error instanceof ApiError) {
    if (error.status === 401) show "Invalid API key..." with Settings link
    else if (error.status === 429) show "Rate limited..." with wait message
    else show "API error..." with Retry button
  } else if (error instanceof JsonError) {
    log full response for debugging
    show "Unexpected response..." with Retry button
  } else if (error instanceof ValidationError) {
    log validation failure
    show "Incomplete response..." with Retry button
  }
  // All errors include Retry button (except 401)
}
```

### Timeout Implementation

- **Request timeout**: Wrap `fetch()` in `Promise.race([fetch(...), timeout(10000)])`.
- **Timeout error**: Create `TimeoutError` class; catch and display "Request took too long."
- **No automatic retries**: User controls all retries via Retry button.

### Rate Limiting (Client Side)

- **Last submit timestamp**: Track in `popup.js` variable (not persisted).
- **Check before submit**: If `now - lastSubmitTime < 1000ms`, disable submit button and show "Please wait..." message.
- **Update on success/error**: Set `lastSubmitTime = now()` even if request fails.

### Logging & Debugging

**Logs to keep** (verbose, helps debugging):
- HTTP status codes and response headers (redacted of sensitive values)
- JSON parse errors (the raw text that failed to parse, first 200 chars)
- Validation errors (which field, what was invalid)
- Network error types and messages

**Logs to avoid** (privacy/security):
- User input text
- API key (never log the actual key)
- Full response bodies (too large, may contain user data echoes)
- User's browser fingerprint or identity

**Logging destination**: `console.warn()` and `console.error()` only. No cloud logging, no persistent storage.

---

## Security Implementation Details

### Input Validation

```js
function validateInput(text) {
  // Check type
  if (typeof text !== 'string') {
    throw new ValidationError('input', 'Must be a string');
  }
  
  // Check length
  if (text.trim().length === 0) {
    throw new ValidationError('input', 'Text cannot be empty');
  }
  
  // Check max length
  const MAX_LENGTH = 2000;
  if (text.length > MAX_LENGTH) {
    throw new ValidationError('input', `Text exceeds ${MAX_LENGTH} characters`);
  }
  
  // No content validation (e.g., no script detection)
  // User text is opaque data; no sanitization on input
  return text;
}
```

### Output Sanitization

**Rule**: Never use `innerHTML` when inserting user-controlled data.

```js
// SAFE: textContent strips all markup
element.textContent = translation;
tokenElement.querySelector('.word').textContent = token.word;

// SAFE: setAttribute with string value
element.setAttribute('data-pos', token.pos); // pos is from response, sanitized

// DANGEROUS: Do NOT do this
element.innerHTML = `<span>${token.word}</span>`; // XSS risk
element.insertAdjacentHTML('beforeend', `<p>${translation}</p>`); // XSS risk
```

### API Key Storage & Handling

```js
// Safe storage
async function saveApiKey(key) {
  // Validate: non-empty, reasonable length
  if (!key || key.length < 20) {
    throw new Error('API key appears invalid');
  }
  // Store in chrome.storage.local (unencrypted but scope-restricted)
  await chrome.storage.local.set({ apiKey: key });
}

// Safe retrieval
async function getApiKey() {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  return apiKey || null;
}

// Safe clearing
async function clearApiKey() {
  await chrome.storage.local.remove('apiKey');
}

// In UI: use password input to mask the key
// <input type="password" id="apiKeyInput" placeholder="Enter your API key">
```

### Response Validation

```js
function validateResponse(response) {
  // Check root structure
  if (!response || typeof response !== 'object') {
    throw new ValidationError('response', 'Response must be an object');
  }
  
  // Check required fields
  if (typeof response.translation !== 'string' || response.translation.trim() === '') {
    throw new ValidationError('translation', 'Missing or invalid translation');
  }
  
  if (!Array.isArray(response.tokens)) {
    throw new ValidationError('tokens', 'Tokens must be an array');
  }
  
  if (response.tokens.length === 0) {
    throw new ValidationError('tokens', 'At least one token required');
  }
  
  // Validate each token
  response.tokens.forEach((token, i) => {
    const requiredFields = ['word', 'lemma', 'pos', 'meaning'];
    requiredFields.forEach(field => {
      if (typeof token[field] !== 'string' || token[field].trim() === '') {
        throw new ValidationError(`token[${i}].${field}`, `Missing or invalid ${field}`);
      }
    });
    
    // Validate POS tag (warn if invalid, don't fail)
    const validPosTags = ['noun', 'verb', 'adj', 'adv', 'pron', 'prep', 'conj', 'det', 'num', 'punct', 'other'];
    if (!validPosTags.includes(token.pos)) {
      console.warn(`Invalid POS tag: ${token.pos}, treating as 'other'`);
      token.pos = 'other'; // Correct silently
    }
  });
  
  // Check response size limits
  const maxSizeKB = 50;
  const maxTokens = 500;
  
  if (JSON.stringify(response).length > maxSizeKB * 1024) {
    throw new ValidationError('response', `Response too large (>${maxSizeKB} KB)`);
  }
  
  if (response.tokens.length > maxTokens) {
    throw new ValidationError('tokens', `Too many tokens (>${maxTokens})`);
  }
  
  return response; // Valid
}
```

### HTTPS & Network Security

**Manifest requirement** (see manifest.json spec):
```json
{
  "host_permissions": [
    "https://api.anthropic.com/*"
  ]
}
```

**Fetch implementation**:
```js
// Always use HTTPS
const apiUrl = 'https://api.anthropic.com/v1/messages'; // never http://

// Include timeout
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s

try {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, max_tokens, system, messages }),
    signal: controller.signal, // Enable timeout
  });
  
  clearTimeout(timeoutId);
  
  if (!response.ok) {
    throw new ApiError(response.status, response.statusText);
  }
  
  return await response.json();
  
} catch (error) {
  if (error.name === 'AbortError') {
    throw new TimeoutError('Request exceeded 10 seconds');
  }
  throw error;
}
```

### Content Security Policy

**In manifest.json**:
```json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self'; default-src 'self'; img-src 'self' data:;"
  }
}
```

**In popup.html**:
- No `<script>` tags with inline code
- No `onclick`, `oninput` event attributes
- All event listeners attached via `addEventListener()` in popup.js
- All styles in external `popup.css`, never in `style` attributes

**In popup.js**:
- Never use `eval()`, `Function()`, `setTimeout(stringCode)`, `setInterval(stringCode)`
- Never construct HTML strings and use `innerHTML`
- Use DOM APIs: `createElement()`, `textContent`, `appendChild()`

---

## Testing Error Paths

### Manual Test Cases

1. **Empty input**: Type nothing, press Analyze → See "Please enter text..." prompt
2. **Whitespace input**: Type "   ", press Analyze → See prompt
3. **Too long input**: Paste 2001 characters → See "Exceeds limit..." warning
4. **No API key**: Delete key in Settings, try to analyze → See "Please configure API key..." prompt with Settings button
5. **Network offline**: Disable WiFi, try to analyze → See "Network error..." after timeout
6. **Invalid API key**: Use dummy key "test123", analyze → See "Invalid API key..." with Settings link
7. **Rate limit**: Analyze 5 times in rapid succession → After 429 response, see "Rate limited..."
8. **Server error**: (Mock a 503 response in dev tools) → See "Claude API error..." with Retry
9. **Malformed JSON**: (Mock response `"invalid json"`...) → See "Unexpected response..."
10. **Missing field**: (Mock response `{"translation": "test"}`...) → See "Incomplete response..."

### Unit Tests (analyzer.js)

- Test `validateInput()` with empty, whitespace, normal, oversized inputs
- Test `validateResponse()` with valid response, missing fields, invalid POS, oversized response
- Test `fetch()` timeout handling with 10-second limit
- Test HTTP error classification (401, 429, 5xx)
- Test JSON parse error handling

---

## Security Assumptions & Limitations

| Aspect | Assumption | Limitation |
|--------|-----------|-----------|
| **API Key Storage** | User's OS profile security is adequate | No encryption beyond OS-level; stolen device = stolen key |
| **Network** | HTTPS + browser cert validation sufficient | No certificate pinning; advanced attacker could MITM |
| **Input** | User won't intentionally submit malicious payloads | 2000-char limit is UX constraint, not a security boundary |
| **Output** | DOM rendering via `textContent` prevents XSS | Assumes browser's textContent implementation is safe |
| **Permissions** | Requested permissions are minimal | No access to browsing data, but has network access |
| **Telemetry** | We trust ourselves to not log user data | No third-party audit; relies on code review |

**Trade-off**: Client-side extension = no backend = API key exposed to browser. Acceptable for a learning tool; not for financial/health data.

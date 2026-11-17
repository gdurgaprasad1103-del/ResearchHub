"""Shared helper that calls the LLM API. Keys are read from .env only.
Uses Google Gemini (free tier, no card) if GEMINI_API_KEY is set, otherwise Anthropic."""
import os, json, re, asyncio, httpx

class LLMError(Exception):
    pass

# Tried in order if the first model name is not available for your key.
GEMINI_FALLBACKS = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash"]

def _real(value):
    return bool(value) and "your-key" not in value

async def _post(c, url, headers, body):
    r = await c.post(url, headers=headers, json=body)
    if r.status_code in (429, 503):          # busy: wait a little and try once more
        await asyncio.sleep(8)
        r = await c.post(url, headers=headers, json=body)
    return r

async def _gemini(system, prompt, max_tokens, as_json, key):
    wanted = os.getenv("GEMINI_MODEL", "").strip()
    models = list(dict.fromkeys(([wanted] if wanted else []) + GEMINI_FALLBACKS))
    cfg = {"maxOutputTokens": max_tokens * 3}   # extra room: Gemini "thinking" uses tokens too
    if as_json:
        cfg["responseMimeType"] = "application/json"
    body = {"systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}], "generationConfig": cfg}
    async with httpx.AsyncClient(timeout=httpx.Timeout(60, connect=15)) as c:
        for m in models:
            try:
                r = await _post(c, f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent",
                                {"x-goog-api-key": key}, body)
            except httpx.HTTPError as e:
                raise LLMError(f"Could not reach the Gemini API ({type(e).__name__}): {e}. Run test_gemini.py to find out why.")
            if r.status_code == 404:
                continue                          # model name not available, try the next one
            if r.status_code == 429:
                raise LLMError("Free limit reached (about 10 requests per minute). Wait one minute and try again.")
            if r.status_code != 200:
                raise LLMError(f"Gemini API error {r.status_code}: {r.text[:200]}")
            parts = (r.json().get("candidates") or [{}])[0].get("content", {}).get("parts", [])
            text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
            if not text:
                raise LLMError("Gemini returned an empty answer. Please try again.")
            return text
    raise LLMError("No Gemini model was found for your key. Set GEMINI_MODEL in .env to a model shown in aistudio.google.com.")

async def _anthropic(system, prompt, max_tokens, key):
    body = {"model": os.getenv("LLM_MODEL", "claude-sonnet-5-5"), "max_tokens": max_tokens,
            "system": system, "messages": [{"role": "user", "content": prompt}]}
    try:
        async with httpx.AsyncClient(timeout=120) as c:
            r = await c.post("https://api.anthropic.com/v1/messages", json=body,
                             headers={"x-api-key": key, "anthropic-version": "2023-06-01"})
    except httpx.HTTPError as e:
        raise LLMError(f"Could not reach the LLM API: {e}")
    if r.status_code != 200:
        raise LLMError(f"LLM API error {r.status_code}: {r.text[:200]}")
    return r.json()["content"][0]["text"]

async def ask(system, prompt, max_tokens=1500, as_json=False):
    gem, ant = os.getenv("GEMINI_API_KEY", ""), os.getenv("ANTHROPIC_API_KEY", "")
    if _real(gem):
        return await _gemini(system, prompt, max_tokens, as_json, gem)
    if _real(ant):
        return await _anthropic(system, prompt, max_tokens, ant)
    raise LLMError("No API key found. Put your free Gemini key in the .env file (GEMINI_API_KEY=...).")

async def ask_json(system, prompt, max_tokens=3000):
    text = await ask(system + " Reply with valid JSON only. No markdown fences.", prompt, max_tokens, as_json=True)
    m = re.search(r"[\[{].*[\]}]", text, re.S)
    try:
        return json.loads(m.group(0))
    except Exception:
        raise LLMError("The AI returned an unreadable answer. Please try again.")
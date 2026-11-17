import os, time, asyncio
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")
import httpx

key = os.getenv("GEMINI_API_KEY", "")
BASE = "https://generativelanguage.googleapis.com/v1beta/models"
MODELS = ["gemini-flash-lite-latest", "gemini-2.5-flash-lite", "gemini-3.1-flash-lite",
          "gemini-3-flash-preview", "gemini-flash-latest"]

async def main():
    async with httpx.AsyncClient(timeout=httpx.Timeout(30, connect=10)) as c:
        for m in MODELS:
            t = time.time()
            try:
                r = await c.post(f"{BASE}/{m}:generateContent", headers={"x-goog-api-key": key},
                                 json={"contents": [{"parts": [{"text": "Say OK"}]}],
                                       "generationConfig": {"maxOutputTokens": 300}})
                ok = r.status_code == 200
                print(("WORKS  " if ok else "FAILED ") + m, r.status_code, f"{time.time()-t:.1f}s",
                      "" if ok else r.text[:100].replace("\n", " "))
            except Exception as e:
                print("FAILED", m, type(e).__name__, f"{time.time()-t:.1f}s")

asyncio.run(main())
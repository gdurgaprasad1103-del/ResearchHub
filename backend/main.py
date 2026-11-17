"""FastAPI server. Run from the backend folder:  uvicorn main:app --reload"""
import os, json
from pathlib import Path
from dotenv import load_dotenv
ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from pydantic import BaseModel
import orchestrator
from agents import assistant_agent, analyzer_agent
from llm import LLMError

app = FastAPI(title="ResearchHub")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

class Ctx(BaseModel):
    query: str = ""
    papers: list = []
    analysis: dict = {}
    summary: str = ""
    question: str = ""
    history: list = []

@app.get("/api/run")
async def run(query: str, field: str = "", years: int = 0, sort: str = "relevance"):
    async def stream():
        async for event in orchestrator.run(query.strip(), field.strip(), years, sort):
            yield f"data: {json.dumps(event)}\n\n"
    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

@app.post("/api/chat")
async def chat(c: Ctx):
    try:
        return {"answer": await assistant_agent.answer(c.question, c.history, c.papers, c.analysis)}
    except LLMError as e:
        return JSONResponse({"error": str(e)}, status_code=502)

@app.post("/api/report")
async def report(c: Ctx):
    try:
        return {"report": await assistant_agent.report(c.query, c.papers, c.analysis, c.summary)}
    except LLMError as e:
        return JSONResponse({"error": str(e)}, status_code=502)

@app.post("/api/compare")
async def compare(c: Ctx):
    try:
        return await analyzer_agent.compare(c.papers, c.analysis)
    except LLMError as e:
        return JSONResponse({"error": str(e)}, status_code=502)

# Serve only the three frontend files (never the .env file).
for name, kind in [("index.html", "text/html"), ("style.css", "text/css"), ("script.js", "text/javascript")]:
    def make(n=name, k=kind):
        return lambda: FileResponse(ROOT / n, media_type=k)
    app.add_api_route("/" if name == "index.html" else f"/{name}", make(), methods=["GET"])
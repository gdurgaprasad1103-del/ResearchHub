"""Orchestrator: runs Agent 1 -> Agent 2 -> Agent 3 and streams real status events."""
import asyncio
from agents import search_agent, analyzer_agent, assistant_agent
from llm import LLMError

async def run(query, field, years=0, sort="relevance"):
    queue = asyncio.Queue()

    def status(agent, state, msg=""):
        queue.put_nowait({"type": "status", "agent": agent, "status": state, "message": msg})

    async def pipeline():
        stage = "search"
        try:
            status("search", "searching", "Starting...")
            async def note(m): status("search", "searching", m)
            papers = await search_agent.search(query, field, note, years, sort)
            queue.put_nowait({"type": "papers", "papers": papers})
            status("search", "completed", f"Found {len(papers)} ranked papers.")

            stage = "analyzer"
            status("analyzer", "analyzing", "Reading abstracts and extracting key points...")
            analysis = await analyzer_agent.analyze(papers)
            queue.put_nowait({"type": "analysis", "analysis": analysis})
            status("analyzer", "completed", f'Analyzed {len(analysis.get("papers", []))} papers.')

            stage = "assistant"
            status("assistant", "generating", "Writing summary and related topics...")
            out = await assistant_agent.summarize(query, papers, analysis)
            queue.put_nowait({"type": "assistant", **out})
            status("assistant", "completed", "Summary ready. Ask questions below.")
            queue.put_nowait({"type": "done"})
        except (LLMError, search_agent.SearchError) as e:
            queue.put_nowait({"type": "error", "agent": stage, "message": str(e)})
        except Exception as e:
            queue.put_nowait({"type": "error", "agent": stage, "message": f"Unexpected error: {e}"})
        queue.put_nowait(None)

    task = asyncio.create_task(pipeline())
    while True:
        event = await queue.get()
        if event is None:
            break
        yield event
    await task
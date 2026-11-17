"""Agent 2 - Paper Analyzer: extracts structure from abstracts and compares papers."""
import json
from llm import ask_json, LLMError

def _block(papers):
    return "\n\n".join(f'[{p["id"]}] {p["title"]} ({p["year"]})\nAbstract: {p["abstract"][:1500]}'
                       for p in papers)

async def analyze(papers):
    usable = [p for p in papers if p["abstract"]]
    if not usable:
        return {"papers": [], "comparison": None,
                "note": "None of the papers had an abstract, so nothing could be analyzed."}
    return await ask_json(
        "You are a careful research analyst. Use ONLY the abstracts given. "
        'If something is not stated, write "Not stated in abstract". Never invent facts.',
        _block(usable) + '\n\nReturn JSON: {"papers":[{"id":1,"objective":"","methodology":"",'
        '"findings":"","limitations":"","key_points":["",""]}],'
        '"comparison":{"similarities":[""],"differences":[""],"best_for":""}}\n'
        "Include every paper id above. Use paper ids like [1] when comparing.", 4000)

async def compare(papers, analysis):
    """Compare only the papers the person selected."""
    usable = [p for p in papers if p.get("abstract")]
    if len(usable) < 2:
        raise LLMError("Pick at least 2 papers that have abstracts.")
    ids = {p["id"] for p in usable}
    items = [a for a in analysis.get("papers", []) if a.get("id") in ids]
    return await ask_json(
        "You are a careful research analyst. Use ONLY the given abstracts and analysis. Never invent facts.",
        _block(usable) + "\n\nANALYSIS:\n" + json.dumps(items)[:6000] +
        '\n\nReturn JSON: {"similarities":[""],"differences":[""],"best_for":""}. Refer to papers as [id].', 2000)
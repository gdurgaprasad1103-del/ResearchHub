"""Agent 3 - Research Assistant: summary, related topics, Q&A and reports."""
import json
from llm import ask, ask_json

def _context(papers, analysis):
    return "PAPERS:\n" + "\n".join(
        f'[{p["id"]}] {p["title"]} - {", ".join(p["authors"][:3])} ({p["year"]})' for p in papers
    ) + "\n\nANALYSIS:\n" + json.dumps(analysis)[:9000]

async def summarize(query, papers, analysis):
    return await ask_json(
        "You explain research in simple words for a beginner. Use only the given analysis.",
        f'Question: "{query}"\n{_context(papers, analysis)}\n\n'
        'Return {"summary":"150-200 words, plain language, cite papers like [1]",'
        '"related_topics":["4-6 specific related search topics"]}', 1500)

async def answer(question, history, papers, analysis):
    turns = "\n".join(f'{m["role"]}: {m["text"]}' for m in history[-6:])
    return await ask(
        "You answer questions about the retrieved papers only. Cite like [1]. "
        "If the papers do not contain the answer, say so plainly.",
        f"{_context(papers, analysis)}\n\nCHAT SO FAR:\n{turns}\n\nQuestion: {question}", 900)

async def report(query, papers, analysis, summary):
    body = await ask(
        "You write research reports in Markdown. Use only the given material and cite as [n]. "
        "Do not write a references section.",
        f'Topic: "{query}"\nSummary: {summary}\n{_context(papers, analysis)}\n\n'
        "Sections: Introduction, Key Findings, Methods Used, Comparison, Limitations, Conclusion.", 2500)
    refs = "\n".join(f'[{p["id"]}] {", ".join(p["authors"][:4]) or "Unknown"} ({p["year"]}). '
                     f'{p["title"]}. {p["url"]}' for p in papers)
    return f"# Research Report: {query}\n\n{body}\n\n## References\n\n{refs}\n"

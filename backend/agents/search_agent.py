"""Agent 1 - Research Finder: understands the query, searches real APIs, ranks papers."""
import os, re, math, asyncio, datetime, httpx
import xml.etree.ElementTree as ET
from llm import ask_json, LLMError

class SearchError(Exception):
    pass

def _norm(t):
    return re.sub(r"\W+", " ", t.lower()).strip()

async def understand(query, field):
    """Tool 1: the LLM turns a question into a good search query plus keywords."""
    data = await ask_json(
        "You turn research questions into academic search queries.",
        f'Question: "{query}"\nField: "{field or "any"}"\n'
        'Return {"search_query": "4-8 words", "keywords": ["5-8 lowercase terms"]}', 400)
    return data["search_query"], [k.lower() for k in data.get("keywords", [])]

async def _semantic_scholar(c, q, n):
    headers = {}
    if os.getenv("SEMANTIC_SCHOLAR_API_KEY"):
        headers["x-api-key"] = os.getenv("SEMANTIC_SCHOLAR_API_KEY")
    r = await c.get("https://api.semanticscholar.org/graph/v1/paper/search", headers=headers,
                    params={"query": q, "limit": n,
                            "fields": "title,authors,year,abstract,url,citationCount,openAccessPdf"})
    r.raise_for_status()
    return [{"title": p["title"], "authors": [a["name"] for a in p.get("authors", [])][:6],
             "year": p.get("year"), "abstract": p.get("abstract") or "", "url": p.get("url") or "",
             "citations": p.get("citationCount") or 0, "source": "Semantic Scholar",
             "pdf": (p.get("openAccessPdf") or {}).get("url") or ""}
            for p in r.json().get("data", []) if p.get("title")]

def _abstract(index):
    if not index:
        return ""
    words = [(pos, w) for w, positions in index.items() for pos in positions]
    return " ".join(w for _, w in sorted(words))

async def _openalex(c, q, n):
    params = {"search": q, "per-page": n, "filter": "open_access.is_oa:true"}
    if os.getenv("OPENALEX_API_KEY"):
        params["api_key"] = os.getenv("OPENALEX_API_KEY")
    if os.getenv("CONTACT_EMAIL"):
        params["mailto"] = os.getenv("CONTACT_EMAIL")
    r = await c.get("https://api.openalex.org/works", params=params)
    r.raise_for_status()
    out = []
    for w in r.json().get("results", []):
        if not w.get("title"):
            continue
        out.append({"title": w["title"],
                    "authors": [a["author"]["display_name"] for a in w.get("authorships", [])][:6],
                    "year": w.get("publication_year"),
                    "abstract": _abstract(w.get("abstract_inverted_index")),
                    "url": (w.get("primary_location") or {}).get("landing_page_url") or w.get("doi") or w.get("id") or "",
                    "pdf": (w.get("best_oa_location") or {}).get("pdf_url") or (w.get("primary_location") or {}).get("pdf_url")
                           or next((l.get("pdf_url") for l in (w.get("locations") or []) if l.get("pdf_url")), "") or "",
                    "citations": w.get("cited_by_count") or 0, "source": "OpenAlex"})
    return out

async def _arxiv(c, q, n):
    """arXiv: every paper there has a free PDF."""
    terms = re.findall(r"[A-Za-z0-9]+", q)[:4]
    if not terms:
        return []
    r = await c.get("https://export.arxiv.org/api/query", params={
        "search_query": " AND ".join(f"all:{t}" for t in terms), "max_results": n, "sortBy": "relevance"})
    r.raise_for_status()
    ns = {"a": "http://www.w3.org/2005/Atom"}
    out = []
    for e in ET.fromstring(r.text).findall("a:entry", ns):
        link = (e.findtext("a:id", "", ns) or "").strip()
        out.append({"title": " ".join((e.findtext("a:title", "", ns) or "").split()),
                    "authors": [a.findtext("a:name", "", ns) for a in e.findall("a:author", ns)][:6],
                    "year": int((e.findtext("a:published", "", ns) or "0")[:4]) or None,
                    "abstract": " ".join((e.findtext("a:summary", "", ns) or "").split()),
                    "url": link, "pdf": link.replace("/abs/", "/pdf/"), "citations": 0, "source": "arXiv"})
    return [p for p in out if p["title"]]

async def search(query, field, notify, years=0, sort="relevance"):
    """Runs the whole agent. `notify(msg)` sends live status text to the screen."""
    try:
        search_query, keywords = await understand(query, field)
        await notify(f'Understood the question. Searching for: "{search_query}"')
    except LLMError as e:
        search_query, keywords = query, [w for w in _norm(query).split() if len(w) > 3]
        await notify(f"Query understanding unavailable ({e}). Using your exact words.")
    q = f"{search_query} {field}".strip() if field else search_query

    await notify("Querying Semantic Scholar, OpenAlex and arXiv...")
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as c:
        results = await asyncio.gather(_semantic_scholar(c, q, 30), _openalex(c, q, 30),
                                       _arxiv(c, search_query, 20), return_exceptions=True)
    papers, warnings = [], []
    for name, res in zip(["Semantic Scholar", "OpenAlex", "arXiv"], results):
        if isinstance(res, Exception):
            warnings.append(f"{name} failed: {res}")
        else:
            papers += res
    if not papers:
        raise SearchError("Both research APIs failed or returned nothing. " + " ".join(warnings))
    if warnings:
        await notify(" ".join(warnings) + " Continuing with the other source.")

    seen, unique = {}, []
    for p in papers:
        key = _norm(p["title"])
        if key in seen:                      # same paper from both sources: keep the best of each
            k = seen[key]
            for f in ("pdf", "abstract", "url"):
                if not k.get(f) and p.get(f):
                    k[f] = p[f]
            k["citations"] = max(k["citations"], p["citations"])
        else:
            seen[key] = p
            unique.append(p)

    if years:                                   # filter: only recent papers
        cutoff = datetime.date.today().year - years
        recent = [p for p in unique if p["year"] and p["year"] >= cutoff]
        if recent:
            unique = recent
        else:
            await notify("No papers found in that year range. Showing all years.")
    await notify(f"Ranking {len(unique)} unique papers...")
    terms = set(keywords) | set(_norm(search_query).split())
    def score(p):
        text = _norm(p["title"] + " " + p["abstract"])
        hits = sum(1 for t in terms if t in text) / max(len(terms), 1)
        return hits * 10 + math.log1p(p["citations"]) * 0.5 + (2 if p["abstract"] else 0)
    ordered = sorted(unique, key=score, reverse=True)
    if sort == "citations":
        ordered = sorted(ordered, key=lambda p: p["citations"], reverse=True)
    elif sort == "newest":
        ordered = sorted(ordered, key=lambda p: p["year"] or 0, reverse=True)
    with_pdf = [p for p in ordered if p["pdf"]]
    if len(with_pdf) >= 3:                      # show only papers that have a free PDF
        ranked = with_pdf[:8]
        await notify(f"Keeping only papers with a free PDF ({len(with_pdf)} found).")
    else:
        ranked = (with_pdf + [p for p in ordered if not p["pdf"]])[:8]
        await notify(f"Only {len(with_pdf)} papers with a free PDF exist for this topic. Showing others too.")
    for i, p in enumerate(ranked, 1):
        p["id"] = i
    return ranked
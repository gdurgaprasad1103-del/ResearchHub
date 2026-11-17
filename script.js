/* ResearchHub frontend. All results come from the Python backend. */
// Backend address: same server if the page is served by FastAPI (port 8000),
// otherwise (Live Server on :5500, or a file opened from disk) call the backend on :8000.
const API = location.port === "8000" ? "" : "http://127.0.0.1:8000";
const FIELDS = ["All", "Computer Science", "AI & Machine Learning", "Healthcare", "Agriculture", "Education", "Cybersecurity"];
const AGENTS = [
  { id: "search", name: "Research Finder", role: "Understands your question, searches and ranks papers" },
  { id: "analyzer", name: "Paper Analyzer", role: "Extracts objectives, methods, findings, limitations" },
  { id: "assistant", name: "Research Assistant", role: "Summarizes, suggests topics, answers questions" },
];
const LABEL = { waiting: "Waiting", searching: "Searching", analyzing: "Analyzing", generating: "Generating", completed: "Completed", error: "Error" };
const $ = id => document.getElementById(id);
const S = { query: "", field: "", papers: [], analysis: {}, summary: "", history: [], sel: new Set(), report: "" };
let source = null;

function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined && text !== null) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}
function reveal(node) { node.hidden = false; node.classList.remove("show"); void node.offsetWidth; node.classList.add("show"); }
$("year").textContent = new Date().getFullYear();

/* ---------- saved data in this browser: history, library, theme ---------- */
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
function renderRecent() {
  const h = store.get("rh_hist", []), box = $("recent"); box.replaceChildren();
  if (!h.length) return;
  box.append(el("span", "Recent:", "muted"));
  h.forEach(q => { const b = el("button", q, "chip"); b.type = "button"; b.onclick = () => run(q); box.append(b); });
  const c = el("button", "Clear", "chip"); c.type = "button";
  c.onclick = () => { store.set("rh_hist", []); renderRecent(); }; box.append(c);
}
function addHistory(q) {
  const h = store.get("rh_hist", []).filter(x => x.toLowerCase() !== q.toLowerCase());
  h.unshift(q); store.set("rh_hist", h.slice(0, 8)); renderRecent();
}
renderRecent();

const keyOf = p => (p.url || p.title).toLowerCase();
const getLib = () => store.get("rh_lib", []);
const inLib = p => getLib().some(x => keyOf(x) === keyOf(p));
function toggleLib(p) {
  let lib = getLib();
  if (inLib(p)) lib = lib.filter(x => keyOf(x) !== keyOf(p));
  else lib.unshift({ title: p.title, authors: p.authors, year: p.year, abstract: (p.abstract || "").slice(0, 1500),
                     url: p.url, pdf: p.pdf, citations: p.citations, source: p.source });
  store.set("rh_lib", lib); $("navLib").textContent = `Library (${lib.length})`;
}
function renderLibrary() {
  const lib = getLib(), box = $("libList"); box.replaceChildren();
  $("libInfo").textContent = lib.length ? `${lib.length} saved paper(s). They stay saved in this browser.` : "Nothing saved yet. Click Save on any paper.";
  lib.forEach((p, i) => box.append(paperCard(p, null, "library", i)));
}
$("navLib").textContent = `Library (${getLib().length})`;
$("navLib").onclick = e => { e.preventDefault(); renderLibrary(); go("library"); };
$("libBack").onclick = () => go("search");

(function () {
  const apply = t => { document.documentElement.dataset.theme = t; $("themeBtn").textContent = t === "light" ? "Dark mode" : "Light mode"; };
  apply(store.get("rh_theme", "dark"));
  $("themeBtn").onclick = () => { const n = document.documentElement.dataset.theme === "light" ? "dark" : "light"; apply(n); store.set("rh_theme", n); };
})();

/* ---------- pages (views) with animated transitions ---------- */
let moving = false;
function go(name) {
  const next = $("v-" + name), cur = document.querySelector(".view.active");
  if (moving || cur === next) return;
  moving = true;
  const show = () => { next.classList.add("active"); document.body.dataset.view = name; scrollTo(0, 0); moving = false; };
  if (cur) { cur.classList.add("leaving"); setTimeout(() => { cur.classList.remove("active", "leaving"); show(); }, 430); } else show();
}
function showActions() { $("runActions").hidden = false; $("seeBtn").hidden = !S.papers.length; }
["logo", "navSearch"].forEach(id => ($(id).onclick = e => { e.preventDefault(); go("search"); }));
$("navResults").onclick = e => { e.preventDefault(); if (S.papers.length) go("results"); };
$("backBtn").onclick = $("newBtn").onclick = () => go("search");
$("seeBtn").onclick = () => go("results");

/* welcome screen: moves on by itself, or when you click / press a key */
(function () {
  const t = setTimeout(() => go("search"), 4800);
  const skip = () => { clearTimeout(t); go("search"); };
  $("v-welcome").addEventListener("click", skip);
  addEventListener("keydown", e => { if (document.body.dataset.view === "welcome" && ["Enter", " "].includes(e.key)) skip(); });
})();

/* open PDF / website: animation first, then the new tab */
function linkBtn(kind, label, url) {
  const ok = /^https?:\/\//i.test(url || "");
  const b = el("button", ok ? label : (kind === "pdf" ? "PDF not available" : "Website not available"), "btn small " + kind);
  b.type = "button"; b.disabled = !ok;
  if (ok) b.onclick = () => openLink(kind, url);
  else if (kind === "pdf") b.title = "No free PDF was listed for this paper (only open-access papers have one).";
  return b;
}
function openLink(kind, url) {
  let host = ""; try { host = new URL(url).hostname; } catch (e) {}
  const box = $("opening");
  box.dataset.kind = kind;
  $("openingText").textContent = kind === "pdf" ? "Opening PDF..." : "Opening website...";
  $("openingHost").textContent = host; $("openingLink").hidden = true;
  box.classList.remove("show"); void box.offsetWidth; box.classList.add("show");   // play the animation on THIS page first
  setTimeout(() => {
    const w = window.open(url, "_blank");
    if (w) { w.opener = null; setTimeout(() => box.classList.remove("show"), 600); }
    else { $("openingLink").href = url; $("openingLink").hidden = false; }          // pop-up blocked: show a link instead
  }, 1800);
}
$("opening").addEventListener("click", e => { if (e.target.id !== "openingLink") $("opening").classList.remove("show"); });

/* ---------- filters ---------- */
FIELDS.forEach((f, i) => {
  const b = el("button", f, "chip" + (i === 0 ? " on" : ""));
  b.type = "button";
  b.onclick = () => {
    S.field = i === 0 ? "" : f;
    document.querySelectorAll("#filters .chip").forEach(c => c.classList.toggle("on", c === b));
  };
  $("filters").appendChild(b);
});

/* ---------- agent cards ---------- */
const cards = {}, links = [];
AGENTS.forEach((a, i) => {
  const card = el("article", undefined, "agent");
  card.dataset.status = "waiting";
  const pill = el("span", "Waiting", "pill"), msg = el("p", "", "msg"), dots = el("div", undefined, "dots");
  dots.append(el("i"), el("i"), el("i"));
  card.append(el("div", undefined, "scan"), el("h3", a.name), el("p", a.role, "role"), pill, msg, dots);
  cards[a.id] = { card, pill, msg, status: "waiting" };
  $("flow").appendChild(card);
  if (i < AGENTS.length - 1) { const l = el("div", undefined, "link"); links.push(l); $("flow").appendChild(l); }
});

function setAgent(id, status, message) {
  const c = cards[id];
  c.status = status; c.card.dataset.status = status; c.pill.textContent = LABEL[status];
  if (message !== undefined) c.msg.textContent = message;
  if (message) logLine(id, status, message);
  const active = ["searching", "analyzing", "generating"];
  links.forEach((l, i) => {
    const from = cards[AGENTS[i].id].status, to = cards[AGENTS[i + 1].id].status;
    l.classList.toggle("live", from === "completed" && active.includes(to));
  });
  const done = AGENTS.filter(a => cards[a.id].status === "completed").length;
  $("barFill").style.width = Math.round(((done + (active.includes(status) ? 0.4 : 0)) / 3) * 100) + "%";
}
function resetAgents() { AGENTS.forEach(a => setAgent(a.id, "waiting", "")); $("barFill").style.width = "0"; }

/* ---------- run the pipeline (Server-Sent Events) ---------- */
$("searchForm").addEventListener("submit", e => { e.preventDefault(); run($("q").value.trim()); });

function run(query) {
  if (!query) return;
  if (source) source.close();
  Object.assign(S, { query, papers: [], analysis: {}, summary: "", history: [], sel: new Set(), report: "" });
  addHistory(query);
  ["results", "insights", "chat"].forEach(id => ($(id).hidden = true));
  $("log").replaceChildren(); $("reportMsg").textContent = "";
  $("notice").className = ""; $("notice").textContent = "Starting agents...";
  resetAgents(); $("termLog").textContent = ""; $("go").disabled = true; $("q").value = query;
  $("runQuery").textContent = query; $("runActions").hidden = true; $("seeBtn").hidden = true; $("navResults").hidden = true;
  go("run");

  let finished = false;
  source = new EventSource(`${API}/api/run?query=${encodeURIComponent(query)}&field=${encodeURIComponent(S.field)}&years=${$("years").value}&sort=${$("sort").value}`);
  source.onmessage = msg => {
    const ev = JSON.parse(msg.data);
    if (ev.type === "status") setAgent(ev.agent, ev.status, ev.message);
    else if (ev.type === "papers") { S.papers = ev.papers; }
    else if (ev.type === "analysis") { S.analysis = ev.analysis; renderPapers(); renderComparison(); }
    else if (ev.type === "assistant") { S.summary = ev.summary; renderInsights(ev); }
    else if (ev.type === "done") { finished = true; $("notice").textContent = "All three agents finished. Opening your papers..."; stop(); setTimeout(() => go("results"), 1100); }
    else if (ev.type === "error") {
      finished = true; setAgent(ev.agent, "error", ev.message);
      $("notice").className = "error"; $("notice").textContent = "Something went wrong: " + ev.message;
      if (S.papers.length && !S.analysis.papers) renderPapers();
      showActions(); stop();
    }
  };
  source.onerror = () => {
    if (finished) return;
    finished = true; stop(); showActions();
    $("notice").className = "error";
    $("notice").textContent = `Cannot reach the backend at ${API || location.origin}. Start it with: uvicorn main:app --reload (inside the backend folder), then try again.`;
    const running = AGENTS.find(a => ["searching", "analyzing", "generating"].includes(cards[a.id].status));
    if (running) setAgent(running.id, "error", "Connection lost.");
  };
}
function stop() { if (source) source.close(); $("go").disabled = false; }

/* ---------- render ---------- */
function paperCard(p, a, mode, i = 0) {       // mode: "result" or "library"
  const card = el("article", undefined, "paper");
  card.style.setProperty("--i", i);
  card.append(el("h3", (mode === "result" && p.id ? `[${p.id}] ` : "") + p.title));
  const meta = el("p", undefined, "meta");
  meta.append(el("span", p.source, "badge"), document.createTextNode(
    `${(p.authors || []).join(", ") || "Unknown authors"} | ${p.year || "Year n/a"} | ${p.citations} citations`));
  card.append(meta);
  const abs = p.abstract ? p.abstract.slice(0, 450) + (p.abstract.length > 450 ? "..." : "") : "No abstract available for this paper.";
  card.append(el("p", abs, "abs"));
  if (a) {
    const d = el("details"); d.append(el("summary", "AI analysis"));
    const g = el("div", undefined, "grid2");
    [["Objective", a.objective], ["Methodology", a.methodology], ["Findings", a.findings], ["Limitations", a.limitations]]
      .forEach(([k, v]) => { const c = el("div"); c.append(el("b", k), document.createTextNode(v || "Not stated in abstract")); g.append(c); });
    d.append(g);
    if ((a.key_points || []).length) { const ul = el("ul"); a.key_points.forEach(k => ul.append(el("li", k))); d.append(ul); }
    card.append(d);
  }
  const acts = el("div", undefined, "acts");
  acts.append(linkBtn("pdf", "Open PDF", p.pdf), linkBtn("web", "Open website", p.url));
  const sv = el("button", "", "btn small ghost"); sv.type = "button";
  const paint = () => { sv.textContent = inLib(p) ? "Saved" : "Save"; sv.classList.toggle("saved", inLib(p)); };
  sv.onclick = () => { toggleLib(p); paint(); sv.classList.remove("pulse"); void sv.offsetWidth; sv.classList.add("pulse"); if (mode === "library") renderLibrary(); };
  paint(); acts.append(sv);
  if (mode === "result") {
    const lab = el("label", undefined, "cmp"), cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = S.sel.has(p.id);
    cb.onchange = () => {
      if (cb.checked && S.sel.size >= 3) { cb.checked = false; return; }      // compare at most 3
      cb.checked ? S.sel.add(p.id) : S.sel.delete(p.id); updateCmp();
    };
    lab.append(cb, document.createTextNode(" Compare")); acts.append(lab);
  }
  card.append(acts);
  return card;
}
function updateCmp() {
  $("cmpBtn").textContent = `Compare selected (${S.sel.size})`;
  $("cmpBtn").disabled = S.sel.size < 2 || !S.analysis.papers;
}
function renderPapers() {
  const box = $("papers"); box.replaceChildren();
  const byId = {};
  (S.analysis.papers || []).forEach(a => (byId[a.id] = a));
  S.papers.forEach((p, i) => box.append(paperCard(p, byId[p.id], "result", i)));
  $("navResults").hidden = false; updateCmp();
  reveal($("results"));
}
$("cmpBtn").onclick = async () => {
  const ids = [...S.sel].sort(), chosen = S.papers.filter(p => ids.includes(p.id));
  $("insights").hidden = false;
  $("comparison").replaceChildren(el("p", "Comparing the selected papers...", "muted"));
  $("comparison").scrollIntoView({ behavior: "smooth", block: "center" });
  try { const c = await post("/api/compare", { papers: chosen }); renderComparison(c, "Comparing " + ids.map(i => `[${i}]`).join(", ")); }
  catch (err) { $("comparison").replaceChildren(el("p", "Comparison failed: " + err.message, "muted")); }
};

function list(title, items) {
  const wrap = el("div"); wrap.append(el("h3", title));
  const ul = el("ul"); (items || []).forEach(i => ul.append(el("li", i))); wrap.append(ul); return wrap;
}
function renderComparison(c = S.analysis.comparison, label = "") {
  const box = $("comparison"); box.replaceChildren();
  if (!c) { box.append(el("p", S.analysis.note || "No comparison available.", "muted")); return; }
  if (label) box.append(el("h3", label));
  box.append(list("Similarities", c.similarities), list("Differences", c.differences));
  if (c.best_for) { box.append(el("h3", "Best used for")); box.append(el("p", c.best_for)); }
}
function renderInsights(ev) {
  $("summary").replaceChildren(el("p", ev.summary));
  const rel = $("related"); rel.replaceChildren();
  (ev.related_topics || []).forEach(t => {
    const b = el("button", t, "chip"); b.type = "button"; b.onclick = () => run(t); rel.append(b);
  });
  reveal($("insights"));
  reveal($("chat"));
  addBubble("bot", "Ask me anything about these papers. I answer only from the retrieved abstracts and analysis.");
}

/* ---------- chat ---------- */
function addBubble(role, text) {
  const b = el("div", text, "bubble " + role); $("log").append(b); $("log").scrollTop = $("log").scrollHeight; return b;
}
async function post(path, extra) {
  const res = await fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: S.query, papers: S.papers, analysis: S.analysis, summary: S.summary, history: S.history, ...extra }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
$("chatForm").addEventListener("submit", async e => {
  e.preventDefault();
  const q = $("chatInput").value.trim(); if (!q) return;
  $("chatInput").value = ""; addBubble("user", q);
  const wait = addBubble("bot", "Thinking...");
  try {
    const { answer } = await post("/api/chat", { question: q });
    wait.textContent = answer; S.history.push({ role: "user", text: q }, { role: "assistant", text: answer });
  } catch (err) { wait.className = "bubble err"; wait.textContent = "Could not get an answer: " + err.message; }
});

/* ---------- report download: PDF or text ---------- */
async function getReport() {
  if (S.report) return S.report;
  $("reportMsg").textContent = "Assistant is writing the report...";
  const { report } = await post("/api/report", {}); S.report = report; return report;
}
function makePdf(md) {
  if (!window.jspdf) throw new Error("The PDF tool could not load (check your internet). Use Download as text.");
  const doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
  const M = 50, maxW = 595 - 2 * M; let y = M;
  const clean = t => t.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, "-")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\*\*|__|`/g, "").replace(/[^\x20-\x7E]/g, "?");
  const put = (text, size, bold) => {
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size);
    doc.splitTextToSize(clean(text), maxW).forEach(line => { if (y > 790) { doc.addPage(); y = M; } doc.text(line, M, y); y += size * 1.45; });
  };
  md.split("\n").forEach(raw => {
    const t = raw.trim();
    if (!t) { y += 6; return; }
    if (t.startsWith("# ")) { put(t.slice(2), 20, true); y += 6; }
    else if (t.startsWith("## ")) { y += 8; put(t.slice(3), 14, true); }
    else if (t.startsWith("### ")) put(t.slice(4), 12, true);
    else put(t.replace(/^[-*]\s+/, "- "), 11, false);
  });
  doc.save("researchhub-report.pdf");
}
$("reportBtn").onclick = async () => {
  $("reportBtn").disabled = true;
  try { makePdf(await getReport()); $("reportMsg").textContent = "PDF downloaded."; }
  catch (err) { $("reportMsg").textContent = "Report failed: " + err.message; }
  $("reportBtn").disabled = false;
};
$("reportTxtBtn").onclick = async () => {
  try {
    const a = el("a"); a.href = URL.createObjectURL(new Blob([await getReport()], { type: "text/markdown" }));
    a.download = "researchhub-report.md"; a.click(); URL.revokeObjectURL(a.href); $("reportMsg").textContent = "Text report downloaded.";
  } catch (err) { $("reportMsg").textContent = "Report failed: " + err.message; }
};

/* ---------- live terminal: only real messages sent by the backend agents ---------- */
function logLine(id, status, message) {
  const t = $("termLog");
  t.textContent += `${new Date().toLocaleTimeString()}  ${id.padEnd(9)} ${status.padEnd(10)} ${message}\n`;
  t.scrollTop = t.scrollHeight;
}
const busy = () => AGENTS.some(a => ["searching", "analyzing", "generating"].includes(cards[a.id].status));

/* ---------- typed prompt and subject ticker (category names) ---------- */
(function () {
  const words = FIELDS.slice(1); let w = 0, i = 0, del = false;
  (function tick() {
    const word = words[w];
    i += del ? -1 : 1; $("typed").textContent = word.slice(0, i);
    let wait = del ? 40 : 90;
    if (!del && i === word.length) { del = true; wait = 1400; }
    else if (del && i === 0) { del = false; w = (w + 1) % words.length; wait = 300; }
    setTimeout(tick, wait);
  })();
  const dots = ["#22d3ee", "#a78bfa", "#f472b6", "#60a5fa"];
  $("tickTrack").append(...[...words, ...words].map((f, k) => {
    const s = el("span", f); s.style.setProperty("--d", dots[k % 4]); return s;
  }));
})();

/* ---------- cursor ring and card tilt ---------- */
(function () {
  const ring = $("ring"), fine = matchMedia("(pointer:fine)").matches;
  if (!fine) { ring.remove(); return; }
  addEventListener("pointermove", e => {
    ring.style.transform = `translate(${e.clientX - 14}px,${e.clientY - 14}px)`;
    const c = e.target.closest(".agent,.paper");
    if (!c) return;
    const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
    c.style.transform = `perspective(700px) rotateY(${x * 8}deg) rotateX(${-y * 8}deg) translateY(-4px)`;
  });
  document.addEventListener("pointerout", e => { const c = e.target.closest && e.target.closest(".agent,.paper"); if (c) c.style.transform = ""; });
})();

/* ---------- 3D wireframe scene (spins faster while agents are really working) ---------- */
(function () {
  if (!window.THREE) return;
  const r = new THREE.WebGLRenderer({ canvas: $("gl"), alpha: true, antialias: true });
  const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(60, 1, .1, 100); cam.position.z = 14;
  const geos = [new THREE.TorusKnotGeometry(1, .3, 80, 10), new THREE.IcosahedronGeometry(1.2, 1), new THREE.OctahedronGeometry(1.2),
                new THREE.TetrahedronGeometry(1.3), new THREE.TorusGeometry(1, .35, 10, 30)];
  const cols = [0x22d3ee, 0xa78bfa, 0xf472b6, 0x60a5fa], objs = [];
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(geos[i % 5], new THREE.MeshBasicMaterial({ color: cols[i % 4], wireframe: true, transparent: true, opacity: .55 }));
    m.position.set((Math.random() - .5) * 26, (Math.random() - .5) * 14, (Math.random() - .5) * 10 - 2);
    m.scale.setScalar(.5 + Math.random() * 1.1);
    m.userData = { rx: (Math.random() - .5) * .01, ry: (Math.random() - .5) * .012, ph: Math.random() * 6, sp: .3 + Math.random() * .5 };
    sc.add(m); objs.push(m);
  }
  const pos = new Float32Array(1800).map(() => (Math.random() - .5) * 60), sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  sc.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x9fb4ff, size: .06 })));
  let mx = 0, my = 0;
  addEventListener("pointermove", e => { mx = e.clientX / innerWidth - .5; my = e.clientY / innerHeight - .5; });
  function size() { r.setPixelRatio(Math.min(devicePixelRatio, 2)); r.setSize(innerWidth, innerHeight); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); }
  size(); addEventListener("resize", size);
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  (function loop(t) {
    const k = busy() ? 5 : 1;
    objs.forEach(o => { o.rotation.x += o.userData.rx * k; o.rotation.y += o.userData.ry * k;
      if (!still) o.position.y += Math.sin(t / 1000 * o.userData.sp + o.userData.ph) * .003; });
    cam.position.x += (mx * 3 - cam.position.x) * .03; cam.position.y += (-my * 2 - cam.position.y) * .03; cam.lookAt(0, 0, 0);
    r.render(sc, cam); requestAnimationFrame(loop);
  })(0);
})();

/* ---------- click ripple on buttons ---------- */
document.addEventListener("pointerdown", e => {
  const t = e.target.closest(".btn,.chip,.searchbox button,.themebtn");
  if (!t || t.disabled) return;
  const r = t.getBoundingClientRect(), d = Math.max(r.width, r.height), s = document.createElement("span");
  s.className = "ripple";
  s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
  t.append(s); setTimeout(() => s.remove(), 650);
});
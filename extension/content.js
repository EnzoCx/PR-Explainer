// PR Explainer: handwritten notes on the diff, a reading-order panel and a "circle and ask" pencil
// on GitHub "Files changed" pages. Relies on i18n.js (loaded first).
(() => {
  const PR_RE = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/(files|changes)/;
  const LEVELS = ['mechanical', 'logic', 'sensitive'];
  const LEGACY_LEVELS = { vert: 'mechanical', jaune: 'logic', rouge: 'sensitive' };

  let current = null;          // { repo, pr }
  let state = null;            // state of the displayed PR
  let ui = null;               // injected DOM elements
  let settings = { ...PRX_DEFAULTS };
  let lang = prxLang(settings.lang);
  let port = null;
  let reqSeq = 0;
  const pending = new Map();
  let observer = null;
  let layoutTimer = null;
  const placed = [];

  const t = (key, vars) => prxT(lang, key, vars);

  // ---------- Messaging with the service worker ----------

  function getPort() {
    if (port) return port;
    port = chrome.runtime.connect({ name: 'pr-explainer' });
    port.onMessage.addListener((msg) => {
      const handler = pending.get(msg.reqId);
      if (!handler) return;
      if (msg.type === 'result' || msg.type === 'error') pending.delete(msg.reqId);
      handler(msg);
    });
    port.onDisconnect.addListener(() => {
      port = null;
      for (const handler of pending.values()) handler({ type: 'error', message: t('reloaded') });
      pending.clear();
    });
    return port;
  }

  function parsePaths(text) {
    const map = {};
    for (const line of String(text || '').split(/\r?\n/)) {
      const m = line.match(/^\s*([^=\s]+\/[^=\s]+)\s*=\s*(.+?)\s*$/);
      if (m) map[m[1].toLowerCase()] = m[2];
    }
    return map;
  }

  function send(payload, onEvent) {
    const reqId = ++reqSeq;
    pending.set(reqId, onEvent);
    try {
      getPort().postMessage({
        reqId,
        repo: current.repo,
        pr: current.pr,
        engine: settings.engine,
        lang,
        useProject: settings.useProject,
        localPath: parsePaths(settings.repoPaths)[current.repo.toLowerCase()] || '',
        ...payload,
      });
    } catch (_) {
      pending.delete(reqId);
      onEvent({ type: 'error', message: t('reloaded') });
    }
  }

  // ---------- Helpers ----------

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function rich(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  // Accepts the current format and older cached analyses (French keys).
  function normalize(b) {
    const level = LEGACY_LEVELS[b.level ?? b.niveau] || b.level;
    return {
      file: String(b.file ?? b.fichier ?? ''),
      start: Number(b.start ?? b.debut) || 0,
      end: Number(b.end ?? b.fin ?? b.start ?? b.debut) || 0,
      side: (b.side ?? b.cote) === 'old' || b.cote === 'gauche' ? 'old' : 'new',
      level: LEVELS.includes(level) ? level : 'logic',
      note: String(b.note ?? b.titre ?? ''),
      detail: String(b.detail ?? b.explication ?? ''),
      question: String(b.question ?? b.attention ?? ''),
    };
  }

  function visibleBlocks() {
    return state.blocks.map((b, i) => ({ b, i })).filter(({ b }) => !(settings.hideMechanical && b.level === 'mechanical'));
  }

  function isDarkPage() {
    const m = getComputedStyle(document.body).backgroundColor.match(/\d+/g);
    if (!m) return false;
    const [r, g, b] = m.map(Number);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.45;
  }

  // ---------- Locating lines in GitHub's diff ----------

  function findFileContainer(path) {
    const sel = `[data-tagsearch-path="${CSS.escape(path)}"], [data-file-path="${CSS.escape(path)}"]`;
    const candidates = [...document.querySelectorAll(sel)];
    // Classic and new UI: walk up to an element that contains line numbers.
    for (const c of candidates) {
      if (c.querySelector('[data-line-number]')) return c;
    }
    const headers = [...document.querySelectorAll('a, span, h3, code')].filter(
      (e) => e.childElementCount === 0 && e.textContent.replace(/[‎‏]/g, '').trim() === path
    );
    for (const start of [...candidates, ...headers]) {
      let node = start.parentElement;
      for (let depth = 0; node && depth < 12; depth++, node = node.parentElement) {
        if (node.querySelector('[data-line-number]')) return node;
      }
    }
    return null;
  }

  function sideOf(cell, line) {
    const id = cell.id || '';
    if (id.endsWith('R' + line)) return 'new';
    if (id.endsWith('L' + line)) return 'old';
    const side = cell.getAttribute('data-diff-side');
    if (side) return side === 'left' ? 'old' : 'new';
    const row = cell.closest('tr') || cell.parentElement;
    const numbered = [...row.querySelectorAll('[data-line-number]')];
    if (numbered.length === 2) return numbered.indexOf(cell) === 0 ? 'old' : 'new';
    return null;
  }

  function findRow(container, line, side) {
    let fallback = null;
    for (const cell of container.querySelectorAll(`[data-line-number="${line}"]`)) {
      const row = cell.closest('tr') || cell.parentElement;
      const s = sideOf(cell, line);
      if (s === side) return row;
      if (!s && !fallback) fallback = row;
    }
    return fallback;
  }

  function rowsOfBlock(block) {
    const container = block.file ? findFileContainer(block.file) : null;
    if (!container) return { container: null, rows: [] };
    const rows = [];
    const end = Math.min(Math.max(block.end, block.start), block.start + 300);
    for (let n = block.start; n <= end; n++) {
      const row = findRow(container, n, block.side);
      if (row && !rows.includes(row)) rows.push(row);
    }
    return { container, rows };
  }

  // In split view a row has two code cells: pick the one on the right side.
  function codeCell(row, side) {
    const cells = row.querySelectorAll('.blob-code, .diff-text-cell');
    if (!cells.length) return row.lastElementChild || row;
    return side === 'old' ? cells[0] : cells[cells.length - 1];
  }

  // Viewport x where the code text ends, so the note can sit right after it.
  function textRight(row, side) {
    const cell = codeCell(row, side);
    const inner = cell.querySelector('.blob-code-inner, .diff-text-inner') || cell;
    const range = document.createRange();
    range.selectNodeContents(inner);
    const r = range.getBoundingClientRect();
    return r.width ? r.right : cell.getBoundingClientRect().left + 40;
  }

  // ---------- Handwritten notes ----------

  function bracePath(h) {
    // A slightly uneven, hand-drawn "}".
    const m = h / 2;
    const j = (k) => +(Math.sin(h * 0.37 + k) * 1.2).toFixed(1);
    return `M2,${2 + j(1)} C9,${2 + j(2)} 7,${m * 0.45} 8,${m - 5} C8.5,${m - 1.5} 10,${m} 14,${m + j(3)}
            M14,${m + j(3)} C10,${m} 8.5,${m + 1.5} 8,${m + 5} C7,${m + m * 0.55} 9,${h - 2 + j(4)} 2,${h - 2}`;
  }

  function layoutNotes() {
    if (!ui) return;
    ui.layer.innerHTML = '';
    ui.layer.classList.toggle('prx-dark', isDarkPage());
    placed.length = 0;
    state.blocks.forEach((b) => { b.found = undefined; });
    if (settings.showNotes) visibleBlocks().forEach(({ b, i }) => { b.found = placeNote(b, i); });
    state.answers.forEach((a) => placeAnswer(a));
    renderLauncher();
  }

  function placeNote(block, i) {
    const rows = rowsOfBlock(block).rows.filter((r) => r.getBoundingClientRect().height > 0);
    if (!rows.length) return false;

    const top = rows[0].getBoundingClientRect().top + scrollY;
    const bottom = rows[rows.length - 1].getBoundingClientRect().bottom + scrollY;
    const cellRect = codeCell(rows[0], block.side).getBoundingClientRect();
    const cellRight = cellRect.right + scrollX;
    const textEnd = Math.max(...rows.slice(0, 80).map((r) => textRight(r, block.side))) + scrollX;

    // In the margin right after the code when there is room; otherwise brace against the right edge
    // and a "paper" note just left of it, to hide as little code as possible.
    const h = Math.max(18, bottom - top - 4);
    let braceX = Math.max(textEnd + 18, cellRect.left + scrollX + 60);
    const roomy = cellRight - (braceX + 20) >= 210;
    let noteX;
    let width;
    if (roomy) {
      noteX = braceX + 20;
      width = Math.min(320, cellRight - noteX - 8);
    } else {
      braceX = cellRight - 20;
      width = Math.min(300, Math.max(160, cellRect.width * 0.45));
      noteX = braceX - width - 2;
    }

    const brace = el('div', `prx-brace prx-ink-${block.level}`);
    brace.style.cssText = `left:${braceX}px;top:${top + 2}px;height:${h}px`;
    brace.innerHTML = `<svg width="16" height="${h}" viewBox="0 0 16 ${h}"><path d="${bracePath(h)}"/></svg>`;
    ui.layer.appendChild(brace);

    const open = state.expanded.has(i);
    const more = block.detail || block.question;
    const note = el('div', `prx-note prx-ink-${block.level}${roomy ? '' : ' prx-paper'}${open ? ' prx-open' : ''}`);
    note.dataset.i = i;
    note.title = t('levels')[block.level];
    note.style.cssText = `left:${noteX}px;width:${width}px;--rot:${((i * 37) % 5) - 2}deg`;
    note.innerHTML = `
      <span class="prx-num">${i + 1}</span>${esc(block.note)}${more && !open ? '<span class="prx-more">+</span>' : ''}
      ${open && block.detail ? `<div class="prx-detail">${rich(block.detail)}</div>` : ''}
      ${open && block.question ? `<div class="prx-ask">→ ${rich(block.question)}</div>` : ''}`;
    ui.layer.appendChild(note);

    // Push down when an earlier note already takes the spot.
    let y = top - 2 + Math.max(0, (h - note.offsetHeight) / 2);
    for (const p of placed) {
      if (noteX < p.right && noteX + width > p.left && y < p.bottom + 4 && y + note.offsetHeight > p.top) y = p.bottom + 4;
    }
    note.style.top = `${y}px`;
    placed.push({ left: noteX, right: noteX + width, top: y, bottom: y + note.offsetHeight });
    return true;
  }

  function placeAnswer(a) {
    const note = el('div', 'prx-note prx-answer prx-paper');
    note.style.cssText = `left:${a.x}px;top:${a.y}px;width:${a.width}px;--rot:-1deg`;
    note.innerHTML = `<button class="prx-close" title="${esc(t('erase'))}">×</button>${a.loading ? `<span class="prx-dots">${esc(t('looking'))}</span>` : rich(a.text)}`;
    note.querySelector('.prx-close').addEventListener('click', (e) => {
      e.stopPropagation();
      state.answers.splice(state.answers.indexOf(a), 1);
      layoutNotes();
    });
    ui.layer.appendChild(note);
  }

  function scheduleLayout() {
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(layoutNotes, 250);
  }

  function goToBlock(i) {
    const block = state.blocks[i];
    const { container, rows } = rowsOfBlock(block);
    state.expanded.add(i);
    if (!settings.showNotes) setSetting('showNotes', true);
    if (rows.length) {
      togglePanel(false);
      layoutNotes();
      const note = ui.layer.querySelector(`.prx-note[data-i="${i}"]`);
      (note || rows[0]).scrollIntoView({ behavior: 'smooth', block: 'center' });
      note?.classList.add('prx-flash');
    } else if (container) {
      togglePanel(false);
      container.scrollIntoView({ behavior: 'smooth', block: 'start' });
      flashStatus(t('collapsed'));
    } else {
      flashStatus(t('notLoaded'));
    }
  }

  function setSetting(key, value) {
    settings[key] = value;
    chrome.storage.sync.set({ [key]: value });
    layoutNotes();
    renderPanel();
  }

  // ---------- Floating button and panel ----------

  function renderLauncher() {
    if (!ui) return;
    const s = state;
    const red = s.blocks.filter((b) => b.level === 'sensitive').length;
    let label;
    if (s.loading) label = `<span class="prx-spin"></span>${esc(s.progress || t('reading'))}`;
    else if (s.blocks.length) label = `<b>${esc(t('notesCount', { n: s.blocks.length }))}</b>${red ? ` · <span class="prx-red">${esc(t('toCheck', { n: red }))}</span>` : ''}`;
    else label = esc(t('annotate'));
    ui.launcher.innerHTML = `
      <button class="prx-pill" data-act="toggle-panel"><span class="prx-logo"></span>${label}</button>
      <button class="prx-round${s.drawing ? ' on' : ''}" data-act="draw" title="${esc(t('drawTitle'))}">✏️</button>`;
  }

  function flashStatus(text) {
    state.status = text;
    if (ui.panel.hidden) togglePanel(true); else renderPanel();
    clearTimeout(state.statusTimer);
    state.statusTimer = setTimeout(() => { if (state) { state.status = ''; renderPanel(); } }, 5000);
  }

  function renderPanel() {
    renderLauncher();
    if (!ui || ui.panel.hidden) return;
    const s = state;
    const items = visibleBlocks().map(({ b, i }) => `
      <li class="prx-item" data-i="${i}" title="${esc(t('levels')[b.level])}">
        <span class="prx-dot prx-bg-${b.level}">${i + 1}</span>
        <span class="prx-item-text">${esc(b.note)}<small>${esc(b.file.split('/').pop())}${b.found === false ? ` · ${esc(t('notShown'))}` : ''}</small></span>
      </li>`).join('');
    const where = s.project ? t('project', { name: s.project }) : s.blocks.length ? t('diffOnly') : `${current.repo} #${current.pr}`;

    ui.panel.innerHTML = `
      <header class="prx-head">
        <span class="prx-logo prx-logo-lg"></span>
        <div class="prx-head-text">
          <div class="prx-title">PR Explainer</div>
          <div class="prx-sub">${s.engine ? `${esc(s.engine)} · ` : ''}${esc(where)}</div>
        </div>
        <button class="prx-x" data-act="close" title="${esc(t('close'))}">×</button>
      </header>
      ${s.status ? `<div class="prx-status">${esc(s.status)}</div>` : ''}
      ${s.error ? `<div class="prx-error">${esc(s.error)}</div>` : ''}
      ${s.loading ? `
        <div class="prx-loading"><span class="prx-spin"></span><div><b>${esc(t('reading'))}</b><br><small>${esc(s.progress)}</small></div></div>` : ''}
      ${!s.loading && !s.blocks.length ? `
        <div class="prx-empty">
          <p>${esc(t('emptyText'))}</p>
          <button class="prx-btn prx-btn-main" data-act="explain">${esc(t('annotate'))}</button>
        </div>` : ''}
      ${s.summary ? `<p class="prx-resume">${rich(s.summary)}</p>` : ''}
      ${s.blocks.length ? `
        <div class="prx-section-head">
          <span>${esc(t('readingOrder'))}</span>
          <label class="prx-switch"><input type="checkbox" data-act="notes" ${settings.showNotes ? 'checked' : ''}><i></i>${esc(t('notesToggle'))}</label>
        </div>
        <ol class="prx-list">${items}</ol>` : ''}
      <div class="prx-section-head"><span>${esc(t('askTitle'))}</span></div>
      <p class="prx-help">${esc(t('askHelp'))}</p>
      <div class="prx-ask-row">
        <button class="prx-btn${s.drawing ? ' prx-btn-pen' : ''}" data-act="draw">✏️ ${esc(s.drawing ? t('penOn') : t('circle'))}</button>
        ${s.zones.length ? `<button class="prx-btn" data-act="clear">${esc(t('clear', { n: s.zones.length }))}</button>` : ''}
      </div>
      <textarea class="prx-question" rows="2" maxlength="2000" placeholder="${esc(s.zones.length ? t('questionPlaceholder') : t('circleFirst'))}">${esc(s.draft)}</textarea>
      <button class="prx-btn prx-btn-main" data-act="ask" ${s.zones.length ? '' : 'disabled'}>${esc(t('ask'))}</button>
      ${s.blocks.length && !s.loading ? `<button class="prx-link" data-act="explain">${esc(t('redo'))}</button>` : ''}`;
  }

  function onPanelClick(e) {
    const btn = e.target.closest('[data-act]');
    if (btn) {
      const act = btn.dataset.act;
      if (act === 'close') togglePanel(false);
      if (act === 'explain') runExplain(false);
      if (act === 'draw') setDrawing(!state.drawing);
      if (act === 'clear') clearZones();
      if (act === 'ask') runAsk();
      if (act === 'notes') setSetting('showNotes', btn.checked);
      return;
    }
    const item = e.target.closest('.prx-item');
    if (item) goToBlock(Number(item.dataset.i));
  }

  function togglePanel(open) {
    ui.panel.hidden = !open;
    renderPanel();
  }

  // ---------- Analysis ----------

  function runExplain(cacheOnly) {
    state.loading = !cacheOnly;
    state.error = '';
    state.progress = t('reading');
    renderPanel();
    send({ type: 'explain', cacheOnly }, (msg) => {
      if (!state) return;
      if (msg.type === 'progress') { state.progress = msg.text; renderPanel(); return; }
      state.loading = false;
      if (msg.type === 'error') {
        state.error = /native messaging host/i.test(msg.message) ? t('hostMissing') : msg.message;
        if (!cacheOnly) togglePanel(true); else renderPanel();
        return;
      }
      state.engine = msg.engine;
      state.project = msg.project;
      if (msg.data) {
        state.summary = String(msg.data.summary ?? msg.data.resume ?? '');
        state.blocks = (msg.data.blocks ?? msg.data.blocs ?? []).map(normalize).filter((b) => b.file && b.start > 0);
        state.expanded.clear();
        layoutNotes();
      } else if (cacheOnly && settings.autoAnalyze) {
        runExplain(false);
        return;
      }
      renderPanel();
    });
  }

  function runAsk() {
    const question = ui.panel.querySelector('.prx-question').value.trim();
    const box = zonesBox();
    const answer = {
      loading: true,
      text: '',
      x: Math.min(box.right + 16, scrollX + innerWidth - 340),
      y: box.top,
      width: 320,
    };
    state.answers.push(answer);
    state.draft = '';
    layoutNotes();
    renderPanel();
    send({ type: 'ask', question, zones: state.zones.map(({ label, text }) => ({ label, text })) }, (msg) => {
      if (!state || msg.type === 'progress') return;
      answer.loading = false;
      answer.text = msg.type === 'error' ? t('error') + msg.message : String(msg.data?.answer ?? msg.data?.reponse ?? '') || t('noAnswer');
      layoutNotes();
    });
  }

  // ---------- Pencil mode ----------

  function setDrawing(on) {
    state.drawing = on;
    ensureCanvas();
    ui.canvas.classList.toggle('prx-drawing', on);
    if (on && ui.panel.hidden) togglePanel(true);
    renderPanel();
  }

  function ensureCanvas() {
    if (ui.canvas) return;
    const c = el('canvas', 'prx-canvas');
    document.body.appendChild(c);
    ui.canvas = c;
    resizeCanvas();
    let stroke = null;
    c.addEventListener('pointerdown', (e) => {
      if (!state.drawing || e.button !== 0) return;
      c.setPointerCapture(e.pointerId);
      stroke = { points: [{ x: e.clientX + scrollX, y: e.clientY + scrollY }], label: null };
      state.strokes.push(stroke);
    });
    c.addEventListener('pointermove', (e) => {
      if (!stroke) return;
      stroke.points.push({ x: e.clientX + scrollX, y: e.clientY + scrollY });
      redraw();
    });
    c.addEventListener('pointerup', () => {
      if (!stroke) return;
      finishStroke(stroke);
      stroke = null;
    });
    window.addEventListener('scroll', redraw, { passive: true });
    window.addEventListener('resize', onCanvasResize);
  }

  function onCanvasResize() {
    resizeCanvas();
    redraw();
  }

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    ui.canvas.width = innerWidth * dpr;
    ui.canvas.height = innerHeight * dpr;
    ui.canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function redraw() {
    if (!ui?.canvas) return;
    const ctx = ui.canvas.getContext('2d');
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const s of state.strokes) {
      ctx.strokeStyle = '#2563eb';
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = ctx.lineCap = 'round';
      ctx.beginPath();
      s.points.forEach((p, k) => (k ? ctx.lineTo(p.x - scrollX, p.y - scrollY) : ctx.moveTo(p.x - scrollX, p.y - scrollY)));
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (s.label && state.zones.length > 1) {
        const p = s.points[0];
        ctx.fillStyle = '#2563eb';
        ctx.font = 'bold 18px "Ink Free", "Segoe Print", cursive';
        ctx.fillText(String(s.label), p.x - scrollX - 14, p.y - scrollY - 4);
      }
    }
  }

  function zonesBox() {
    const pts = state.strokes.flatMap((s) => s.points);
    return { top: Math.min(...pts.map((p) => p.y)), right: Math.max(...pts.map((p) => p.x)) };
  }

  function finishStroke(stroke) {
    const xs = stroke.points.map((p) => p.x);
    const ys = stroke.points.map((p) => p.y);
    const box = { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
    const text = collectCode(box);
    if (!text || state.zones.length >= 10) {
      state.strokes.splice(state.strokes.indexOf(stroke), 1);
      redraw();
      if (!text) flashStatus(t('noCode'));
      return;
    }
    stroke.label = state.zones.length + 1;
    state.zones.push({ label: stroke.label, text });
    redraw();
    renderPanel();
    ui.panel.querySelector('.prx-question')?.focus();
  }

  function collectCode(box) {
    const rows = new Set();
    document.querySelectorAll('[data-line-number]').forEach((cell) => rows.add(cell.closest('tr') || cell.parentElement));
    const hits = [...rows].filter((row) => {
      const r = row.getBoundingClientRect();
      const top = r.top + scrollY;
      return r.height > 0 && top + r.height >= box.top && top <= box.bottom;
    }).slice(0, 200);
    if (!hits.length) return '';
    let lastFile = null;
    const out = [];
    for (const row of hits) {
      const fileEl = row.closest('[data-tagsearch-path], [data-file-path]');
      const file = fileEl?.getAttribute('data-tagsearch-path') || fileEl?.getAttribute('data-file-path') || '(unknown file)';
      if (file !== lastFile) { out.push(`--- ${file}`); lastFile = file; }
      const nums = [...row.querySelectorAll('[data-line-number]')].map((c) => c.getAttribute('data-line-number')).join('/');
      const marker = row.querySelector('[class*="addition"]') ? '+' : row.querySelector('[class*="deletion"]') ? '-' : ' ';
      const code = (row.querySelector('.blob-code-inner, .diff-text-inner')?.innerText ?? codeCell(row).innerText).replace(/\n$/, '');
      out.push(`${nums.padStart(9)} ${marker} ${code}`);
    }
    return out.join('\n').slice(0, 20000);
  }

  function clearZones() {
    state.zones = [];
    state.strokes = [];
    state.answers = [];
    redraw();
    layoutNotes();
    renderPanel();
  }

  function onKey(e) {
    if (e.key !== 'Escape' || !state) return;
    if (state.drawing) setDrawing(false);
    else if (!ui.panel.hidden) togglePanel(false);
  }

  // ---------- Mount / unmount depending on the page ----------

  function mount(info) {
    current = info;
    state = {
      blocks: [], summary: '', zones: [], strokes: [], answers: [], expanded: new Set(),
      drawing: false, loading: false, status: '', error: '', progress: '', draft: '', engine: '', project: '',
    };
    const root = el('div', 'prx-root');
    const launcher = el('div', 'prx-launcher');
    const panel = el('aside', 'prx-panel');
    panel.hidden = true;
    root.append(launcher, panel);
    const layer = el('div', 'prx-layer');
    document.body.append(layer, root);
    ui = { root, panel, launcher, layer, canvas: null };
    root.classList.toggle('prx-dark', isDarkPage());
    root.style.setProperty('--prx-logo', `url("${chrome.runtime.getURL('icons/icon48.png')}")`);

    panel.addEventListener('click', onPanelClick);
    panel.addEventListener('input', (e) => { if (e.target.classList.contains('prx-question')) state.draft = e.target.value; });
    launcher.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'toggle-panel') togglePanel(ui.panel.hidden);
      if (act === 'draw') setDrawing(!state.drawing);
    });
    layer.addEventListener('click', (e) => {
      const note = e.target.closest('.prx-note[data-i]');
      if (!note) return;
      const i = Number(note.dataset.i);
      if (state.expanded.has(i)) state.expanded.delete(i); else state.expanded.add(i);
      layoutNotes();
    });
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', scheduleLayout);

    observer = new MutationObserver((muts) => {
      if (muts.some((m) => !ui.root.contains(m.target) && !ui.layer.contains(m.target) && m.target !== document.body)) scheduleLayout();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    renderLauncher();
    runExplain(true);
  }

  function unmount() {
    observer?.disconnect();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', scheduleLayout);
    window.removeEventListener('scroll', redraw);
    window.removeEventListener('resize', onCanvasResize);
    ui?.canvas?.remove();
    ui?.layer.remove();
    ui?.root.remove();
    ui = null;
    state = null;
    current = null;
  }

  function checkLocation() {
    const m = location.pathname.match(PR_RE);
    const info = m ? { repo: `${m[1]}/${m[2]}`, pr: Number(m[3]) } : null;
    if (current && (!info || info.repo !== current.repo || info.pr !== current.pr)) unmount();
    if (info && !current) mount(info);
  }

  chrome.storage.sync.get(PRX_DEFAULTS, (stored) => {
    settings = stored;
    lang = prxLang(settings.lang);
    checkLocation();
    setInterval(checkLocation, 1000);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [k, { newValue }] of Object.entries(changes)) settings[k] = newValue;
    lang = prxLang(settings.lang);
    if (!ui) return;
    // The analysis depends on the AI, the language and the project context: reload it.
    if ('engine' in changes || 'lang' in changes || 'useProject' in changes) {
      state.blocks = [];
      state.summary = '';
      runExplain(true);
    }
    layoutNotes();
    renderPanel();
  });
})();

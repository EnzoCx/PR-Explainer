const HOST = 'com.pr_explainer.host';
const SWITCHES = ['autoAnalyze', 'showNotes', 'hideMechanical', 'useProject'];
const $ = (id) => document.getElementById(id);

let lang = 'en';
let lastStatus = null;
const t = (key, vars) => prxT(lang, key, vars);

function translate() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-t]').forEach((e) => { e.innerHTML = t(e.dataset.t); });
  renderStatus();
}

function selectSeg(id, value) {
  document.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle('on', b.dataset.v === value));
}

function check(label, ok, okText, koText) {
  return `<div class="check"><span>${label}</span><span class="${ok ? 'ok' : 'ko'}">${ok ? okText : koText}</span></div>`;
}

function renderStatus() {
  const res = lastStatus;
  if (!res) {
    $('checks').innerHTML = `<div class="check muted">${t('checking')}</div>`;
    return;
  }
  if (res.error) {
    $('checks').innerHTML = check(t('localApp'), false, '', t('missing'));
    $('hint').innerHTML = `<div class="hint">${t('runInstaller')}</div>`;
    return;
  }
  const d = res.data;
  const engine = (e) => (e.loggedIn ? t('connected') : e.installed ? t('notConnected') : t('notInstalled'));
  $('checks').innerHTML =
    check('GitHub', d.gh, t('connected'), t('notConnected')) +
    check('Claude', d.claude.loggedIn, engine(d.claude), engine(d.claude)) +
    check('ChatGPT', d.codex.loggedIn, engine(d.codex), engine(d.codex));
  document.querySelector('#engine [data-v="claude"]').disabled = !d.claude.loggedIn;
  document.querySelector('#engine [data-v="codex"]').disabled = !d.codex.loggedIn;
  $('hint').innerHTML = !d.gh || (!d.claude.loggedIn && !d.codex.loggedIn)
    ? `<div class="hint">${t('finishInstaller')}</div>` : '';
}

$('version').textContent = 'v' + chrome.runtime.getManifest().version;

chrome.storage.sync.get(PRX_DEFAULTS, (s) => {
  lang = prxLang(s.lang);
  SWITCHES.forEach((id) => { $(id).checked = s[id]; });
  $('repoPaths').value = s.repoPaths;
  selectSeg('engine', s.engine);
  selectSeg('lang', s.lang);
  translate();
});

SWITCHES.forEach((id) => $(id).addEventListener('change', () => chrome.storage.sync.set({ [id]: $(id).checked })));
$('repoPaths').addEventListener('change', () => chrome.storage.sync.set({ repoPaths: $('repoPaths').value }));

for (const id of ['engine', 'lang']) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    selectSeg(id, b.dataset.v);
    chrome.storage.sync.set({ [id]: b.dataset.v });
    if (id === 'lang') { lang = prxLang(b.dataset.v); translate(); }
  });
}

$('clearCache').addEventListener('click', () => {
  chrome.runtime.sendNativeMessage(HOST, { type: 'clearCache' }, () => {
    void chrome.runtime.lastError;
    $('clearCache').textContent = t('cacheCleared');
  });
});

chrome.runtime.sendNativeMessage(HOST, { type: 'status' }, (res) => {
  lastStatus = chrome.runtime.lastError || !res || res.type !== 'result' ? { error: true } : res;
  renderStatus();
});

'use strict';

/* RadPING renderer — builds the request config, calls into the main process
   over the preload bridge (window.radping), and renders the reply. */

const $ = (id) => document.getElementById(id);

const els = {
  server: $('server'),
  port: $('port'),
  secret: $('secret'),
  timeout: $('timeout'),
  retries: $('retries'),
  requestType: $('requestType'),
  authMethod: $('authMethod'),
  authMethodField: $('authMethodField'),
  username: $('username'),
  password: $('password'),
  passwordRow: $('passwordRow'),
  addAttr: $('addAttr'),
  attrList: $('attrList'),
  attrEmpty: $('attrEmpty'),
  sendBtn: $('sendBtn'),
  clearBtn: $('clearBtn'),
  targetLabel: $('targetLabel'),
  result: $('result'),
  resultCode: $('resultCode'),
  resultMeta: $('resultMeta'),
  replyBody: $('replyBody'),
  attrCount: $('attrCount'),
  copyResponse: $('copyResponse'),
  rawReq: $('rawReq'),
  rawResp: $('rawResp'),
  attemptsItem: $('attemptsItem'),
  attemptsLog: $('attemptsLog'),
  statusMsg: $('statusMsg'),
  attrRowTpl: $('attrRowTpl'),
  profileSelect: $('profileSelect'),
  profileSave: $('profileSave'),
  profileDelete: $('profileDelete'),
  modalOverlay: $('modalOverlay'),
  modalTitle: $('modalTitle'),
  modalMessage: $('modalMessage'),
  modalField: $('modalField'),
  modalLabel: $('modalLabel'),
  modalInput: $('modalInput'),
  modalOk: $('modalOk'),
  modalCancel: $('modalCancel'),
  dictBtn: $('dictBtn'),
  dictOverlay: $('dictOverlay'),
  dictBuiltins: $('dictBuiltins'),
  dictList: $('dictList'),
  dictEmpty: $('dictEmpty'),
  dictWarn: $('dictWarn'),
  dictImport: $('dictImport'),
  dictClose: $('dictClose'),
  dictRowTpl: $('dictRowTpl'),
  updateChip: $('updateChip'),
  updateChipLabel: $('updateChipLabel'),
  appVersion: $('appVersion')
};

// Request-type → { code, acctStatus }
const REQUEST_TYPES = {
  'auth':         { code: 1 },
  'acct-start':   { code: 4, acctStatus: 'Start' },
  'acct-stop':    { code: 4, acctStatus: 'Stop' },
  'acct-interim': { code: 4, acctStatus: 'Interim-Update' },
  'acct-on':      { code: 4, acctStatus: 'Accounting-On' },
  'acct-off':     { code: 4, acctStatus: 'Accounting-Off' }
};

// Map a RADIUS reply code to a result state.
const CODE_STATE = {
  2: 'accept',     // Access-Accept
  3: 'reject',     // Access-Reject
  11: 'challenge', // Access-Challenge
  5: 'accept'      // Accounting-Response
};

let dictionary = { attributes: [], values: {}, codes: {} };
let profiles = [];

// Last completed auth request/response, kept so the reply can be copied.
let lastConfig = null;
let lastResult = null;

// ---------------------------------------------------------------- init
async function init() {
  if (window.radping.version) {
    els.appVersion.textContent = `RadPING v${window.radping.version}`;
  }

  try {
    dictionary = await window.radping.getDictionary();
  } catch (err) {
    setStatus('Failed to load dictionary: ' + err.message);
  }

  els.addAttr.addEventListener('click', () => addAttrRow());
  els.clearBtn.addEventListener('click', clearReply);
  els.sendBtn.addEventListener('click', send);
  els.copyResponse.addEventListener('click', copyResponseDetails);
  els.requestType.addEventListener('change', onRequestTypeChange);
  els.server.addEventListener('input', updateTarget);
  els.port.addEventListener('input', updateTarget);

  els.profileSelect.addEventListener('change', onProfileSelect);
  els.profileSave.addEventListener('click', saveProfile);
  els.profileDelete.addEventListener('click', deleteProfile);
  await loadProfiles();

  els.dictBtn.addEventListener('click', openDictModal);
  els.dictClose.addEventListener('click', closeDictModal);
  els.dictImport.addEventListener('click', importDictionary);
  els.dictOverlay.addEventListener('mousedown', (e) => {
    if (e.target === els.dictOverlay) closeDictModal();
  });

  els.updateChip.addEventListener('click', () => {
    window.radping.update.openReleases(els.updateChip.dataset.url || '');
  });
  checkForUpdate();

  document.querySelectorAll('.affix-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = $(btn.dataset.reveal);
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.textContent = showing ? 'Show' : 'Hide';
    });
  });

  // Enter in the request pane sends.
  document.querySelector('.pane--request').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      send();
    }
  });

  onRequestTypeChange();
  updateTarget();
}

// ---------------------------------------------------------------- profiles
async function loadProfiles() {
  try {
    profiles = await window.radping.profiles.list();
  } catch (err) {
    profiles = [];
    setStatus('Could not load profiles: ' + err.message);
  }
  renderProfileOptions();
}

function renderProfileOptions(selectId) {
  const keep = selectId !== undefined ? selectId : els.profileSelect.value;
  els.profileSelect.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '— No profile —';
  els.profileSelect.appendChild(placeholder);

  for (const p of profiles) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    els.profileSelect.appendChild(opt);
  }

  els.profileSelect.value = profiles.some((p) => p.id === keep) ? keep : '';
  updateProfileButtons();
}

function updateProfileButtons() {
  els.profileDelete.disabled = !els.profileSelect.value;
}

function onProfileSelect() {
  const p = profiles.find((x) => x.id === els.profileSelect.value);
  updateProfileButtons();
  if (!p) return;
  els.server.value = p.server;
  els.port.value = p.port;
  els.secret.value = p.secret;
  els.timeout.value = p.timeout;
  els.retries.value = p.retries;
  updateTarget();
  setStatus(`Loaded profile “${p.name}”.`);
}

async function saveProfile() {
  const current = profiles.find((x) => x.id === els.profileSelect.value);
  const name = await openModal({
    title: 'Save server profile',
    inputLabel: 'Profile name',
    inputValue: current ? current.name : '',
    okText: 'Save'
  });
  if (name === null) return; // cancelled
  if (!name) return setStatus('Profile name is required.');

  try {
    const saved = await window.radping.profiles.save({
      name,
      server: els.server.value.trim(),
      port: Number(els.port.value) || 1812,
      secret: els.secret.value,
      timeout: Number(els.timeout.value) || 5,
      retries: Number(els.retries.value) || 0
    });
    await loadProfiles();
    renderProfileOptions(saved.id);
    setStatus(`Saved profile “${saved.name}”.`);
  } catch (err) {
    setStatus('Could not save profile: ' + err.message);
  }
}

async function deleteProfile() {
  const p = profiles.find((x) => x.id === els.profileSelect.value);
  if (!p) return;
  const confirmed = await openModal({
    title: 'Delete profile',
    message: `Delete the profile “${p.name}”? This can’t be undone.`,
    okText: 'Delete',
    danger: true
  });
  if (!confirmed) return;

  try {
    await window.radping.profiles.remove(p.id);
    await loadProfiles();
    renderProfileOptions('');
    setStatus(`Deleted profile “${p.name}”.`);
  } catch (err) {
    setStatus('Could not delete profile: ' + err.message);
  }
}

/**
 * A small promise-based modal. With `inputLabel` it prompts for text and
 * resolves to the trimmed string (or null on cancel). Without it, it's a
 * confirm dialog resolving to true (OK) / false (cancel).
 */
function openModal({ title, message, inputLabel, inputValue = '', okText = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const useInput = inputLabel !== undefined;

    els.modalTitle.textContent = title;
    els.modalMessage.textContent = message || '';
    els.modalMessage.hidden = !message;
    els.modalField.hidden = !useInput;
    if (useInput) {
      els.modalLabel.textContent = inputLabel;
      els.modalInput.value = inputValue;
    }
    els.modalOk.textContent = okText;
    els.modalOk.classList.toggle('btn--danger', danger);
    els.modalOk.classList.toggle('btn--primary', !danger);
    els.modalOverlay.hidden = false;

    if (useInput) {
      els.modalInput.focus();
      els.modalInput.select();
    } else {
      els.modalOk.focus();
    }

    function cleanup(result) {
      els.modalOverlay.hidden = true;
      els.modalOk.removeEventListener('click', onOk);
      els.modalCancel.removeEventListener('click', onCancel);
      els.modalOverlay.removeEventListener('mousedown', onBackdrop);
      document.removeEventListener('keydown', onKey, true);
      resolve(result);
    }
    const onOk = () => cleanup(useInput ? els.modalInput.value.trim() : true);
    const onCancel = () => cleanup(useInput ? null : false);
    const onBackdrop = (e) => { if (e.target === els.modalOverlay) onCancel(); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      else if (e.key === 'Enter') { e.preventDefault(); onOk(); }
    };

    els.modalOk.addEventListener('click', onOk);
    els.modalCancel.addEventListener('click', onCancel);
    els.modalOverlay.addEventListener('mousedown', onBackdrop);
    document.addEventListener('keydown', onKey, true);
  });
}

// ---------------------------------------------------------------- dictionaries
async function openDictModal() {
  els.dictWarn.hidden = true;
  await refreshDictList();
  els.dictOverlay.hidden = false;
}

function closeDictModal() {
  els.dictOverlay.hidden = true;
}

async function refreshDictList() {
  let data;
  try {
    data = await window.radping.dictionaries.list();
  } catch (err) {
    setStatus('Could not load dictionaries: ' + err.message);
    return;
  }

  els.dictBuiltins.textContent = (data.builtins || []).join(', ');

  els.dictList.innerHTML = '';
  const imported = data.imported || [];
  els.dictEmpty.hidden = imported.length > 0;

  for (const d of imported) {
    const frag = els.dictRowTpl.content.cloneNode(true);
    const row = frag.querySelector('.dict-row');
    row.querySelector('.dict-row__name').textContent = d.name;
    row.querySelector('.dict-row__meta').textContent =
      `${d.vendorCount} vendor${d.vendorCount === 1 ? '' : 's'} · ${d.attrCount} attribute${d.attrCount === 1 ? '' : 's'}`;
    row.querySelector('.dict-row__del').addEventListener('click', () => removeDictionary(d));
    els.dictList.appendChild(row);
  }
}

async function importDictionary() {
  els.dictWarn.hidden = true;
  els.dictImport.disabled = true;
  els.dictImport.textContent = 'Importing…';
  try {
    const res = await window.radping.dictionaries.import();
    if (res.canceled) return;
    if (res.error) {
      els.dictWarn.hidden = false;
      els.dictWarn.textContent = res.error;
      return;
    }
    await refreshDictList();
    const m = res.imported;
    setStatus(`Imported “${m.name}” — ${m.vendorCount} vendor(s), ${m.attrCount} attribute(s).`);
    if (res.warnings && res.warnings.length) {
      els.dictWarn.hidden = false;
      els.dictWarn.textContent = `Imported with ${res.warnings.length} warning(s): ${res.warnings.slice(0, 3).join('; ')}`;
    }
  } catch (err) {
    els.dictWarn.hidden = false;
    els.dictWarn.textContent = 'Import failed: ' + err.message;
  } finally {
    els.dictImport.disabled = false;
    els.dictImport.textContent = 'Import dictionary…';
  }
}

async function removeDictionary(d) {
  const confirmed = await openModal({
    title: 'Remove dictionary',
    message: `Remove “${d.name}”? Its vendor attributes will no longer be decoded by name.`,
    okText: 'Remove',
    danger: true
  });
  if (!confirmed) return;
  try {
    await window.radping.dictionaries.remove(d.id);
    await refreshDictList();
    setStatus(`Removed dictionary “${d.name}”.`);
  } catch (err) {
    setStatus('Could not remove dictionary: ' + err.message);
  }
}

// ---------------------------------------------------------------- attr rows
function sortedAttrOptions() {
  return [...dictionary.attributes].sort((a, b) => a.name.localeCompare(b.name));
}

function addAttrRow(preset) {
  const frag = els.attrRowTpl.content.cloneNode(true);
  const row = frag.querySelector('.attr-row');
  const select = row.querySelector('.attr-row__name');
  const value = row.querySelector('.attr-row__value');
  const del = row.querySelector('.attr-row__del');

  for (const attr of sortedAttrOptions()) {
    const opt = document.createElement('option');
    opt.value = String(attr.id);
    opt.textContent = attr.name;
    select.appendChild(opt);
  }

  if (preset) {
    if (preset.id !== undefined) select.value = String(preset.id);
    if (preset.value !== undefined) value.value = preset.value;
  }

  del.addEventListener('click', () => {
    row.remove();
    refreshAttrEmpty();
  });

  els.attrList.appendChild(row);
  refreshAttrEmpty();
  if (!preset) value.focus();
  return row;
}

function refreshAttrEmpty() {
  const has = els.attrList.querySelector('.attr-row');
  els.attrEmpty.style.display = has ? 'none' : 'block';
}

function collectAttributes() {
  const out = [];
  els.attrList.querySelectorAll('.attr-row').forEach((row) => {
    const id = row.querySelector('.attr-row__name').value;
    const value = row.querySelector('.attr-row__value').value;
    if (id !== '' && value !== '') out.push({ id: Number(id), value });
  });
  return out;
}

// ---------------------------------------------------------------- request type
function onRequestTypeChange() {
  const type = REQUEST_TYPES[els.requestType.value] || REQUEST_TYPES.auth;
  const isAuth = type.code === 1;

  toggleField(els.passwordRow, isAuth);
  toggleField(els.authMethodField, isAuth);

  if (isAuth && els.port.value === '1813') els.port.value = '1812';
  if (!isAuth && els.port.value === '1812') els.port.value = '1813';
  updateTarget();
}

function toggleField(field, enabled) {
  field.classList.toggle('is-disabled', !enabled);
  field.querySelectorAll('input, select').forEach((el) => (el.disabled = !enabled));
}

// ---------------------------------------------------------------- send
async function send() {
  const type = REQUEST_TYPES[els.requestType.value] || REQUEST_TYPES.auth;

  const server = els.server.value.trim();
  if (!server) return setStatus('Enter a RADIUS server address.');
  if (!els.secret.value) return setStatus('Enter the shared secret.');

  const attributes = collectAttributes();
  if (type.acctStatus) {
    attributes.unshift({ name: 'Acct-Status-Type', value: type.acctStatus });
  }

  const config = {
    server,
    port: Number(els.port.value) || (type.code === 1 ? 1812 : 1813),
    secret: els.secret.value,
    code: type.code,
    authMethod: els.authMethod.value,
    username: els.username.value,
    password: els.password.value,
    timeout: Number(els.timeout.value) || 5,
    retries: Number(els.retries.value) || 0,
    attributes
  };

  lastConfig = config;
  setSending(true);
  setResult('sending', 'Sending…', []);
  setStatus(`Sending ${dictionary.codes[config.code] || 'request'} to ${config.server}:${config.port} …`);

  try {
    const result = await window.radping.send(config);
    renderResult(result);
  } catch (err) {
    lastResult = null;
    updateCopyButton();
    setResult('error', 'Error', [{ text: err.message || String(err), kind: 'bad' }]);
    setStatus('Error: ' + (err.message || String(err)));
  } finally {
    setSending(false);
  }
}

function setSending(on) {
  els.sendBtn.disabled = on;
  els.sendBtn.classList.toggle('is-sending', on);
  els.sendBtn.querySelector('.btn__label').textContent = on ? 'Sending…' : 'Send Request';
}

// ---------------------------------------------------------------- render
function renderResult(result) {
  lastResult = result;
  updateCopyButton();

  if (!result) {
    setResult('error', 'No result', [{ text: 'The request returned nothing.', kind: 'bad' }]);
    return;
  }

  els.rawReq.textContent = result.request ? formatHex(result.request.hex) : '—';

  if (!result.ok) {
    const timedOut = /No response/i.test(result.error || '');
    setResult(timedOut ? 'timeout' : 'error', timedOut ? 'Request timed out' : 'Error', [
      { text: result.error || 'Request failed', kind: 'bad' }
    ]);
    els.rawResp.textContent = '—';
    renderReplyTable([]);
    renderAttempts(result.attempts);
    setStatus(result.error || 'Request failed');
    return;
  }

  const resp = result.response;
  const state = CODE_STATE[resp.code] || 'neutral';
  const rtt = lastRtt(result);

  setResult(state, resp.codeName, [
    { text: `code ${resp.code}` },
    { text: `id ${resp.identifier}` },
    { text: `${rtt} ms` },
    { text: `${resp.length} bytes` },
    resp.authenticatorValid
      ? { text: 'authenticator OK', kind: 'ok' }
      : { text: 'authenticator FAILED — check secret', kind: 'bad' }
  ]);

  renderReplyTable(resp.attributes);
  els.rawResp.textContent = formatHex(resp.hex);
  renderAttempts(result.attempts);
  setStatus(`${resp.codeName} · id ${resp.identifier} · ${rtt} ms`);
}

function lastRtt(result) {
  if (!result.attempts || !result.attempts.length) return result.totalMs || 0;
  const answered = result.attempts.find((a) => !a.timedOut);
  return answered ? answered.rttMs : result.totalMs;
}

function renderReplyTable(attributes) {
  els.replyBody.innerHTML = '';
  els.attrCount.textContent = attributes.length
    ? `(${attributes.length})`
    : '';

  if (!attributes.length) {
    const tr = document.createElement('tr');
    tr.className = 'empty-row';
    const td = document.createElement('td');
    td.colSpan = 3;
    td.textContent = 'No attributes returned.';
    tr.appendChild(td);
    els.replyBody.appendChild(tr);
    return;
  }

  for (const attr of attributes) {
    const tr = document.createElement('tr');

    const name = document.createElement('td');
    name.className = 'cell-name';
    name.textContent = attr.name;

    const id = document.createElement('td');
    id.className = 'cell-id';
    id.textContent = attr.id;

    const val = document.createElement('td');
    val.className = 'cell-val';
    val.textContent = attr.value;

    tr.append(name, id, val);
    els.replyBody.appendChild(tr);
  }
}

function renderAttempts(attempts) {
  if (!attempts || attempts.length <= 1) {
    els.attemptsItem.hidden = true;
    return;
  }
  els.attemptsItem.hidden = false;
  els.attemptsLog.textContent = attempts
    .map((a) => `#${a.attempt}  ${a.timedOut ? 'timeout' : 'reply'}  ${a.rttMs} ms`)
    .join('\n');
}

// ---------------------------------------------------------------- copy response
// Show the "Copy details" button only for a completed Authentication Request
// that got an Access-Accept or Access-Reject back.
function updateCopyButton() {
  const resp = lastResult && lastResult.ok ? lastResult.response : null;
  const canCopy = !!(lastConfig && lastConfig.code === 1 && resp &&
    (resp.code === 2 || resp.code === 3));
  els.copyResponse.hidden = !canCopy;
  // Drop any lingering "Copied!" state from a previous response.
  clearTimeout(copyFeedbackTimer);
  els.copyResponse.textContent = 'Copy details';
  els.copyResponse.classList.remove('is-copied');
}

function buildResponseSummary() {
  const c = lastConfig;
  const resp = lastResult.response;
  const attrs = resp.attributes || [];

  const sentence =
    `${c.server} using shared secret ${c.secret} provided an ${resp.codeName} ` +
    `for User ${c.username} using password ${c.password}.`;

  // A reject is just the outcome — no attributes block.
  if (resp.code === 3) return sentence;

  let text = `${sentence} The RADIUS server returned these attributes :\n\n`;
  text += attrs.length
    ? attrs.map((a) => `${a.name} - ${a.value}`).join('\n')
    : '(none)';

  return text;
}

let copyFeedbackTimer = null;

async function copyResponseDetails() {
  if (els.copyResponse.hidden) return;
  try {
    await navigator.clipboard.writeText(buildResponseSummary());
    flashCopied('Copied!', 'Response details copied to clipboard.');
  } catch (err) {
    flashCopied('Copy failed', 'Could not copy to clipboard: ' + (err.message || String(err)));
  }
}

// Briefly swap the button label to confirm the click landed.
function flashCopied(label, status) {
  const btn = els.copyResponse;
  btn.textContent = label;
  btn.classList.add('is-copied');
  setStatus(status);
  clearTimeout(copyFeedbackTimer);
  copyFeedbackTimer = setTimeout(() => {
    btn.textContent = 'Copy details';
    btn.classList.remove('is-copied');
  }, 1600);
}

// ---------------------------------------------------------------- result / status
function setResult(state, code, pills) {
  els.result.dataset.state = state;
  els.resultCode.textContent = code;
  els.resultMeta.innerHTML = '';
  for (const p of pills || []) {
    const span = document.createElement('span');
    span.className = 'meta-pill' + (p.kind === 'ok' ? ' meta-pill--ok' : p.kind === 'bad' ? ' meta-pill--bad' : '');
    span.textContent = p.text;
    els.resultMeta.appendChild(span);
  }
}

function clearReply() {
  lastConfig = null;
  lastResult = null;
  els.copyResponse.hidden = true;
  els.result.dataset.state = 'idle';
  els.resultCode.textContent = 'No response yet';
  els.resultMeta.innerHTML = '<span class="hint">Configure a request and click Send Request.</span>';
  renderReplyTable([]);
  // Reset the empty-row copy to its initial wording.
  const emptyTd = els.replyBody.querySelector('.empty-row td');
  if (emptyTd) emptyTd.textContent = 'Response attributes will appear here.';
  els.attrCount.textContent = '';
  els.rawReq.textContent = '—';
  els.rawResp.textContent = '—';
  els.attemptsItem.hidden = true;
  setStatus('Ready');
}

function setStatus(msg) {
  els.statusMsg.textContent = msg;
}

// ---------------------------------------------------------------- update check
async function checkForUpdate() {
  try {
    const res = await window.radping.update.check();
    if (!res || !res.updateAvailable) return;
    els.updateChipLabel.textContent = `Update to v${res.latestVersion}`;
    els.updateChip.dataset.url = res.releaseUrl || '';
    els.updateChip.title =
      `You're on v${res.currentVersion}. v${res.latestVersion} is available — click to view the release.`;
    els.updateChip.hidden = false;
  } catch (_) {
    // Best-effort; stay silent if the check fails (offline, rate-limited, etc.).
  }
}

function updateTarget() {
  const server = els.server.value.trim();
  els.targetLabel.textContent = server ? `${server}:${els.port.value || '—'}` : 'No target';
}

// ---------------------------------------------------------------- helpers
function formatHex(hex) {
  if (!hex) return '—';
  return hex.replace(/(.{2})/g, '$1 ').replace(/(.{48})/g, '$1\n').trim();
}

document.addEventListener('DOMContentLoaded', init);

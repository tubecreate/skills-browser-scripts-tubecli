/**
 * Script Studio — Main Application Logic
 */

const API = '/api/v1/scripts';
let currentScript = null;
let scripts = [];
let previewSession = null;
let pickerActive = false;

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
    loadScripts();
    loadProfiles();
    setupEventListeners();
    setupResizeHandles();
});

async function loadProfiles() {
    try {
        const res = await fetch('/api/v1/browser/profiles');
        const data = await res.json();
        const profiles = data.profiles || [];
        const select = document.getElementById('execProfile');
        select.innerHTML = '<option value="">Select Profile...</option>';
        profiles.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.name;
            opt.textContent = `${p.name}${p.google_account ? ' (' + p.google_account.email + ')' : ''}`;
            select.appendChild(opt);
        });
    } catch (e) {
        console.warn('Could not load browser profiles:', e);
    }
}

function setupEventListeners() {
    document.getElementById('btnNewScript').onclick = () => showModal('newScriptModal');
    document.getElementById('btnAddStep').onclick = () => showModal('stepTypeModal');
    document.getElementById('btnImportScript').onclick = importScriptPrompt;
    document.getElementById('btnAIGenerate').onclick = () => showModal('aiGenerateModal');
    document.getElementById('searchScripts').oninput = e => filterScripts(e.target.value);
    document.querySelectorAll('.category-item').forEach(el => {
        el.onclick = () => {
            document.querySelectorAll('.category-item').forEach(c => c.classList.remove('active'));
            el.classList.add('active');
            loadScripts(el.dataset.category);
        };
    });
    document.querySelectorAll('.tab').forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('tab' + capitalize(tab.dataset.tab)).classList.add('active');
        };
    });
}

// ── API Helpers ──
async function api(url, opts = {}) {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
    return res.json();
}

// ── Scripts CRUD ──
async function loadScripts(category) {
    const q = category ? `?category=${category}` : '';
    const data = await api(`${API}${q}`);
    scripts = data.scripts || [];
    renderScriptList();
}

function renderScriptList() {
    const list = document.getElementById('scriptList');
    if (!scripts.length) {
        list.innerHTML = '<div class="empty-state"><span class="material-symbols-outlined">code_off</span><p>No scripts yet</p></div>';
        return;
    }
    list.innerHTML = scripts.map(s => `
        <div class="script-item ${currentScript?.id === s.id ? 'active' : ''}" onclick="selectScript(${s.id})">
            <div class="script-item-name">${esc(s.name)}</div>
            <div class="script-item-meta">
                <span>${getCategoryIcon(s.category)} ${s.category}</span>
                <span>${(s.steps || []).length} steps</span>
            </div>
            <div class="script-item-actions">
                <button class="step-action-btn" onclick="event.stopPropagation();duplicateScript(${s.id})" title="Duplicate">
                    <span class="material-symbols-outlined" style="font-size:0.9rem">content_copy</span>
                </button>
                <button class="step-action-btn" onclick="event.stopPropagation();deleteScript(${s.id})" title="Delete">
                    <span class="material-symbols-outlined" style="font-size:0.9rem">delete</span>
                </button>
            </div>
        </div>
    `).join('');
}

async function selectScript(id) {
    currentScript = await api(`${API}/${id}`);
    document.getElementById('currentScriptName').textContent = currentScript.name;
    renderScriptList();
    renderSteps();
    renderVariables();
    fillSettings();
    loadHistory();
}

async function createNewScript() {
    const name = document.getElementById('newScriptName').value.trim();
    if (!name) return;
    const data = await api(API, {
        method: 'POST',
        body: JSON.stringify({
            name,
            category: document.getElementById('newScriptCategory').value,
            target_url: document.getElementById('newScriptUrl').value.trim(),
        })
    });
    closeModal('newScriptModal');
    document.getElementById('newScriptName').value = '';
    await loadScripts();
    if (data.script) selectScript(data.script.id);
}

async function deleteScript(id) {
    if (!confirm('Delete this script?')) return;
    await api(`${API}/${id}`, { method: 'DELETE' });
    if (currentScript?.id === id) currentScript = null;
    loadScripts();
}

async function duplicateScript(id) {
    const data = await api(`${API}/${id}/duplicate`, { method: 'POST' });
    await loadScripts();
    if (data.script) selectScript(data.script.id);
}

// ── Steps ──
const STEP_ICONS = {
    navigate: 'language', click: 'ads_click', type: 'keyboard', wait: 'hourglass_empty',
    sleep: 'timer', evaluate: 'code', extract: 'content_copy', screenshot: 'screenshot_monitor',
    download: 'download', condition: 'call_split', loop: 'loop', keyboard: 'keyboard_return',
    wait_hidden: 'visibility_off', scroll: 'swap_vert', mouse_move: 'mouse', hover: 'near_me', ai_generate: 'auto_awesome',
};

function renderSteps() {
    const list = document.getElementById('stepsList');
    const steps = currentScript?.steps || [];
    if (!steps.length) {
        list.innerHTML = '<div class="empty-state"><span class="material-symbols-outlined">list_alt</span><p>Add steps to build your script</p><button class="btn btn-primary btn-sm" onclick="showModal(\'stepTypeModal\')"><span class="material-symbols-outlined">add</span> Add Step</button></div>';
        return;
    }
    list.innerHTML = steps.map((s, i) => `
        <div class="step-card ${s.enabled === false ? 'disabled' : ''}" data-index="${i}" id="step-${i}">
            <div class="step-header" onclick="toggleStep(${i})">
                <span class="step-drag material-symbols-outlined" style="font-size:1rem">drag_indicator</span>
                <span class="step-index">${i + 1}</span>
                <span class="step-type-icon material-symbols-outlined">${STEP_ICONS[s.type] || 'code'}</span>
                <span class="step-label">${esc(s.label || s.type)}</span>
                <div class="step-actions">
                    <button class="step-action-btn" onclick="event.stopPropagation();testStep(${i})" title="Test step">
                        <span class="material-symbols-outlined" style="font-size:0.9rem">play_arrow</span>
                    </button>
                    <button class="step-action-btn" onclick="event.stopPropagation();toggleEnabled(${i})" title="Toggle">
                        <span class="material-symbols-outlined" style="font-size:0.9rem">${s.enabled === false ? 'toggle_off' : 'toggle_on'}</span>
                    </button>
                    <button class="step-action-btn" onclick="event.stopPropagation();removeStep(${i})" title="Remove">
                        <span class="material-symbols-outlined" style="font-size:0.9rem">close</span>
                    </button>
                </div>
            </div>
            <div class="step-body">${renderStepBody(s, i)}</div>
        </div>
    `).join('');
    setupDragDrop();
}

function renderStepBody(step, idx) {
    const p = step.params || {};
    let html = `<div class="form-group"><label>Label</label><input class="form-input" value="${esc(step.label || '')}" onchange="updateStepField(${idx},'label',this.value)"></div>`;

    if (['click', 'type', 'wait', 'wait_hidden', 'extract', 'download'].includes(step.type)) {
        html += `<div class="form-group"><label>CSS Selector</label><div class="selector-row"><input class="form-input" value="${esc(step.selector || '')}" onchange="updateStepField(${idx},'selector',this.value)"><button class="btn btn-sm btn-accent" onclick="pickElement(${idx})" title="Pick from browser"><span class="material-symbols-outlined" style="font-size:1rem">my_location</span></button></div></div>`;
    }
    if (step.type === 'navigate') {
        html += `<div class="form-group"><label>URL</label><input class="form-input" value="${esc(p.url || '')}" onchange="updateStepParam(${idx},'url',this.value)"></div>`;
    }
    if (step.type === 'type') {
        html += `<div class="form-group"><label>Text</label><textarea class="form-input" rows="2" onchange="updateStepParam(${idx},'text',this.value)">${esc(p.text || '')}</textarea></div>`;
        html += `<div class="form-group"><label><input type="checkbox" ${p.clear_first ? 'checked' : ''} onchange="updateStepParam(${idx},'clear_first',this.checked)"> Clear first</label></div>`;
    }
    if (step.type === 'sleep') {
        html += `<div class="form-group"><label>Duration (ms)</label><input type="number" class="form-input" value="${p.ms || 2000}" onchange="updateStepParam(${idx},'ms',+this.value)"></div>`;
    }
    if (step.type === 'evaluate') {
        html += `<div class="form-group"><label>JavaScript Code</label><textarea class="form-input" rows="4" style="font-family:var(--mono)" onchange="updateStepParam(${idx},'code',this.value)">${esc(p.code || '')}</textarea></div>`;
        html += `<div class="form-group"><label>Save result as variable</label><input class="form-input" value="${esc(p.save_as || '')}" onchange="updateStepParam(${idx},'save_as',this.value)"></div>`;
    }
    if (step.type === 'extract') {
        html += `<div class="form-group"><label>Attribute</label><select class="form-input" onchange="updateStepParam(${idx},'attribute',this.value)"><option value="innerText" ${p.attribute === 'innerText' ? 'selected' : ''}>innerText</option><option value="innerHTML" ${p.attribute === 'innerHTML' ? 'selected' : ''}>innerHTML</option><option value="href" ${p.attribute === 'href' ? 'selected' : ''}>href</option><option value="src" ${p.attribute === 'src' ? 'selected' : ''}>src</option><option value="value" ${p.attribute === 'value' ? 'selected' : ''}>value</option></select></div>`;
        html += `<div class="form-group"><label>Save as variable</label><input class="form-input" value="${esc(p.save_as || '')}" onchange="updateStepParam(${idx},'save_as',this.value)"></div>`;
    }
    if (step.type === 'keyboard') {
        html += `<div class="form-group"><label>Key</label><input class="form-input" value="${esc(p.key || 'Enter')}" onchange="updateStepParam(${idx},'key',this.value)"></div>`;
    }
    if (step.type === 'loop') {
        html += `<div class="form-group"><label>Iterations</label><input type="number" class="form-input" value="${p.count || 1}" onchange="updateStepParam(${idx},'count',+this.value)"></div>`;
        html += `<div class="form-group"><label>Delay between (ms)</label><input type="number" class="form-input" value="${p.delay || 1000}" onchange="updateStepParam(${idx},'delay',+this.value)"></div>`;
    }

    // Error handling
    html += `<div style="display:flex;gap:8px;margin-top:8px">`;
    html += `<div class="form-group" style="flex:1"><label>On Error</label><select class="form-input" onchange="updateStepField(${idx},'on_error',this.value)"><option value="abort" ${step.on_error === 'abort' ? 'selected' : ''}>Abort</option><option value="skip" ${step.on_error === 'skip' ? 'selected' : ''}>Skip</option><option value="retry" ${step.on_error === 'retry' ? 'selected' : ''}>Retry</option></select></div>`;
    html += `<div class="form-group" style="width:80px"><label>Retries</label><input type="number" class="form-input" value="${step.retry_count || 0}" onchange="updateStepField(${idx},'retry_count',+this.value)"></div>`;
    html += `<div class="form-group" style="width:100px"><label>Timeout</label><input type="number" class="form-input" value="${(p.timeout || 10000)}" onchange="updateStepParam(${idx},'timeout',+this.value)"></div>`;
    html += `</div>`;
    return html;
}

function toggleStep(idx) {
    const card = document.getElementById(`step-${idx}`);
    card.classList.toggle('expanded');
}

function updateStepField(idx, field, value) {
    if (!currentScript) return;
    currentScript.steps[idx][field] = value;
    saveSteps();
}

function updateStepParam(idx, param, value) {
    if (!currentScript) return;
    if (!currentScript.steps[idx].params) currentScript.steps[idx].params = {};
    currentScript.steps[idx].params[param] = value;
    saveSteps();
}

function toggleEnabled(idx) {
    if (!currentScript) return;
    currentScript.steps[idx].enabled = currentScript.steps[idx].enabled === false ? true : false;
    renderSteps();
    saveSteps();
}

function removeStep(idx) {
    if (!currentScript) return;
    currentScript.steps.splice(idx, 1);
    renderSteps();
    saveSteps();
}

function addStep() { showModal('stepTypeModal'); }

async function insertStep(type) {
    if (!currentScript) {
        // Auto-create a script if none selected
        const data = await api(API, {
            method: 'POST',
            body: JSON.stringify({ name: 'Untitled Script', category: 'general' })
        });
        if (data.script) {
            await loadScripts();
            await selectScript(data.script.id);
        }
        if (!currentScript) return;
    }
    if (!currentScript.steps) currentScript.steps = [];
    currentScript.steps.push({
        id: `step_${Date.now()}`,
        type,
        label: type.charAt(0).toUpperCase() + type.slice(1),
        enabled: true,
        selector: '',
        params: {},
        on_error: 'abort',
        retry_count: 0,
    });
    closeModal('stepTypeModal');
    renderSteps();
    saveSteps();
    // Auto expand last step
    const last = document.getElementById(`step-${currentScript.steps.length - 1}`);
    if (last) last.classList.add('expanded');
}

async function saveSteps() {
    if (!currentScript) return;
    await api(`${API}/${currentScript.id}/steps`, {
        method: 'PUT',
        body: JSON.stringify({ steps: currentScript.steps })
    });
}

// ── Drag & Drop ──
function setupDragDrop() {
    const list = document.getElementById('stepsList');
    let dragIdx = null;
    list.querySelectorAll('.step-drag').forEach((handle, idx) => {
        const card = handle.closest('.step-card');
        card.setAttribute('draggable', true);
        card.ondragstart = e => { dragIdx = idx; e.dataTransfer.effectAllowed = 'move'; card.style.opacity = '0.5'; };
        card.ondragend = () => { card.style.opacity = '1'; };
        card.ondragover = e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
        card.ondrop = e => {
            e.preventDefault();
            if (dragIdx === null || dragIdx === idx) return;
            const steps = currentScript.steps;
            const [moved] = steps.splice(dragIdx, 1);
            steps.splice(idx, 0, moved);
            dragIdx = null;
            renderSteps();
            saveSteps();
        };
    });
}

// ── Variables ──
function renderVariables() {
    const list = document.getElementById('variablesList');
    const vars = currentScript?.variables || [];
    if (!vars.length) {
        list.innerHTML = '<div class="empty-state" style="padding:20px"><p>No variables defined</p></div>';
        return;
    }
    list.innerHTML = vars.map((v, i) => `
        <div class="variable-row">
            <input class="form-input" value="${esc(v.name || '')}" placeholder="Name" onchange="updateVar(${i},'name',this.value)">
            <select class="form-input" style="width:100px" onchange="updateVar(${i},'type',this.value)">
                <option value="string" ${v.type === 'string' ? 'selected' : ''}>String</option>
                <option value="number" ${v.type === 'number' ? 'selected' : ''}>Number</option>
                <option value="boolean" ${v.type === 'boolean' ? 'selected' : ''}>Boolean</option>
            </select>
            <input class="form-input" value="${esc(v.default || '')}" placeholder="Default" onchange="updateVar(${i},'default',this.value)">
            <button class="step-action-btn" onclick="removeVar(${i})"><span class="material-symbols-outlined" style="font-size:0.9rem">close</span></button>
        </div>
    `).join('');
}

function addVariable() {
    if (!currentScript) return;
    if (!currentScript.variables) currentScript.variables = [];
    currentScript.variables.push({ name: '', type: 'string', default: '' });
    renderVariables();
}

function updateVar(idx, field, value) {
    currentScript.variables[idx][field] = value;
    api(`${API}/${currentScript.id}`, { method: 'PUT', body: JSON.stringify({ variables: currentScript.variables }) });
}

function removeVar(idx) {
    currentScript.variables.splice(idx, 1);
    renderVariables();
    api(`${API}/${currentScript.id}`, { method: 'PUT', body: JSON.stringify({ variables: currentScript.variables }) });
}

// ── Settings ──
function fillSettings() {
    if (!currentScript) return;
    document.getElementById('settingName').value = currentScript.name || '';
    document.getElementById('settingSlug').value = currentScript.slug || '';
    document.getElementById('settingDesc').value = currentScript.description || '';
    document.getElementById('settingCategory').value = currentScript.category || 'general';
    document.getElementById('settingUrl').value = currentScript.target_url || '';
}

async function saveSettings() {
    if (!currentScript) return;
    await api(`${API}/${currentScript.id}`, {
        method: 'PUT',
        body: JSON.stringify({
            name: document.getElementById('settingName').value,
            slug: document.getElementById('settingSlug').value,
            description: document.getElementById('settingDesc').value,
            category: document.getElementById('settingCategory').value,
            target_url: document.getElementById('settingUrl').value,
        })
    });
    currentScript.name = document.getElementById('settingName').value;
    document.getElementById('currentScriptName').textContent = currentScript.name;
    loadScripts();
}

// ── Execution ──
let currentExecId = null;

async function runScript() {
    if (!currentScript) return;
    const profile = document.getElementById('execProfile').value;
    const vars = {};
    (currentScript.variables || []).forEach(v => { if (v.name) vars[v.name] = v.default || ''; });
    const showBrowser = document.getElementById('showBrowserToggle')?.checked || false;
    const engine = document.getElementById('execEngine')?.value || 'playwright';
    const data = await api(`${API}/${currentScript.id}/run`, {
        method: 'POST',
        body: JSON.stringify({ profile, variables: vars, headless: !showBrowser, engine })
    });
    currentExecId = data.exec_id;
    document.getElementById('btnRun').disabled = true;
    document.getElementById('btnStop').disabled = false;
    document.getElementById('btnPause').disabled = false;
    appendLog('Script started...', 'info');
    pollExecution();
}

let scriptPaused = false;

function togglePauseScript() {
    if (!previewWs || previewWs.readyState !== 1) return;
    scriptPaused = !scriptPaused;
    const btn = document.getElementById('btnPause');
    if (scriptPaused) {
        previewWs.send(JSON.stringify({ type: 'pause' }));
        btn.innerHTML = '<span class="material-symbols-outlined">play_arrow</span> Resume';
        btn.classList.remove('btn-warning');
        btn.classList.add('btn-success');
        appendLog('⏸ Script paused — you can interact with the browser.', 'info');
    } else {
        previewWs.send(JSON.stringify({ type: 'resume' }));
        btn.innerHTML = '<span class="material-symbols-outlined">pause</span> Pause';
        btn.classList.remove('btn-success');
        btn.classList.add('btn-warning');
        appendLog('▶ Script resumed.', 'info');
    }
}

async function stopScript() {
    if (!currentExecId) return;
    // Send stop via WS first (graceful)
    if (previewWs && previewWs.readyState === 1) {
        previewWs.send(JSON.stringify({ type: 'stop_script' }));
    }
    // Then kill process (force)
    await api(`${API}/execution/${currentExecId}/stop`, { method: 'POST' });
    document.getElementById('btnRun').disabled = false;
    document.getElementById('btnStop').disabled = true;
    document.getElementById('btnPause').disabled = true;
    scriptPaused = false;
    const pauseBtn = document.getElementById('btnPause');
    pauseBtn.innerHTML = '<span class="material-symbols-outlined">pause</span> Pause';
    pauseBtn.classList.remove('btn-success');
    pauseBtn.classList.add('btn-warning');
    appendLog('Script stopped.', 'error');
}

let logPollTimer = null;
let logOffset = 0;
let activeStepIndex = -1;

function clearStepStates() {
    document.querySelectorAll('.step-card').forEach(el => {
        el.classList.remove('running', 'success', 'error', 'ai-fixing');
    });
    activeStepIndex = -1;
}

function setStepState(index, state) {
    // Clear previous running state
    if (state === 'running') {
        document.querySelectorAll('.step-card.running').forEach(el => el.classList.remove('running'));
    }
    const card = document.getElementById(`step-${index}`);
    if (!card) return;
    card.classList.remove('running', 'success', 'error', 'ai-fixing');
    if (state) card.classList.add(state);
    if (state === 'running') {
        activeStepIndex = index;
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function parseStepLog(line) {
    if (typeof line !== 'string') return;
    // Try JSON parse
    if (line.trimStart().startsWith('{')) {
        try {
            const parsed = JSON.parse(line);
            if (parsed.status === 'step' && parsed.step_index !== undefined) {
                const idx = parseInt(parsed.step_index);
                const msg = parsed.message || '';
                if (msg.includes('failed') || msg.includes('FAILED')) {
                    setStepState(idx, 'error');
                } else if (msg.includes('SKIPPED')) {
                    // skip
                } else {
                    setStepState(idx, 'running');
                }
            }
            if (parsed.status === 'done') {
                if (parsed.success) {
                    // Mark last running step as success
                    if (activeStepIndex >= 0) setStepState(activeStepIndex, 'success');
                }
            }
            // Detect AI fix
            if (parsed.message && parsed.message.includes('AI Auto-Fix')) {
                if (activeStepIndex >= 0) setStepState(activeStepIndex, 'ai-fixing');
            }
            if (parsed.message && parsed.message.includes('✅')) {
                if (activeStepIndex >= 0) setStepState(activeStepIndex, 'success');
            }
            return;
        } catch (e) {}
    }

    // Non-JSON fallback: detect step status from text
    if (line.includes('AI Auto-Fix')) {
        if (activeStepIndex >= 0) setStepState(activeStepIndex, 'ai-fixing');
    } else if (line.includes('✅') || line.includes('AI fix worked')) {
        if (activeStepIndex >= 0) setStepState(activeStepIndex, 'success');
    } else if (line.includes('Navigated to') || line.includes('Clicked') || line.includes('Typed') ||
               line.includes('Element visible') || line.includes('Slept') || line.includes('Pressed key') ||
               line.includes('Extracted') || line.includes('Evaluated') || line.includes('Screenshot saved')) {
        // Step completed successfully
        if (activeStepIndex >= 0) setStepState(activeStepIndex, 'success');
    } else if (line.includes('failed') || line.includes('❌')) {
        if (activeStepIndex >= 0) setStepState(activeStepIndex, 'error');
    }
}

async function pollExecution() {
    if (!currentExecId) return;
    logOffset = 0;
    clearStepStates();
    if (logPollTimer) clearInterval(logPollTimer);
    logPollTimer = setInterval(async () => {
        try {
            const data = await api(`${API}/execution/${currentExecId}/logs?offset=${logOffset}`);
            if (data.lines && data.lines.length > 0) {
                data.lines.forEach(line => {
                    appendLog(line);
                    parseStepLog(line);

                    // Check if runner reported a preview port
                    if (typeof line === 'string' && line.includes('preview_port')) {
                        try {
                            const parsed = JSON.parse(line);
                            if (parsed.preview_port) {
                                previewSession = { port: parsed.preview_port };
                                // Prefer WebSocket for real-time preview
                                if (parsed.preview_ws) {
                                    connectPreviewWS(parsed.preview_port);
                                } else {
                                    startScreenshotStream();
                                }
                                document.getElementById('btnLaunchPreview').innerHTML =
                                    '<span class="material-symbols-outlined">check_circle</span> Live';
                                document.getElementById('btnLaunchPreview').classList.add('btn-success');
                            }
                        } catch (e) {}
                    }
                });
                logOffset = data.offset;
            }
            if (!data.running) {
                clearInterval(logPollTimer);
                logPollTimer = null;
                document.getElementById('btnRun').disabled = false;
                document.getElementById('btnStop').disabled = true;
                document.getElementById('btnPause').disabled = true;
            }
        } catch (e) {}
    }, 800);
}

async function testStep(idx) {
    appendLog(`Testing step ${idx + 1}...`, 'info');
    // For now just log — full implementation would run single step via preview browser
}

// ── Browser Preview (WebSocket + CDP Screencast) ──
let previewWs = null;
let previewCanvas = null;
let previewCtx = null;
let previewScale = { x: 1, y: 1 };

async function launchPreview() {
    const profile = document.getElementById('execProfile').value;
    const url = document.getElementById('previewUrl').value || 'about:blank';
    appendLog('Launching browser preview...', 'info');
    const data = await api(`${API}/preview/launch`, {
        method: 'POST',
        body: JSON.stringify({ profile, url })
    });
    if (data.session_id) {
        previewSession = data;
        appendLog(`Browser launched on port ${data.port}`, 'success');
        document.getElementById('btnLaunchPreview').textContent = 'Connected';
        connectPreviewWS(data.port);
    }
}

function connectPreviewWS(port) {
    if (previewWs) { previewWs.close(); previewWs = null; }
    stopScreenshotStream();

    const container = document.getElementById('previewContainer');
    container.innerHTML = `
        <canvas id="previewCanvas" style="cursor:crosshair;display:block"></canvas>
        <div id="inspectOverlay" style="position:absolute;pointer-events:none;border:2px solid #58a6ff;background:rgba(88,166,255,0.1);display:none;z-index:10"></div>
        <div id="inspectInfo" style="position:absolute;bottom:4px;left:4px;background:rgba(0,0,0,0.85);color:#e6edf3;font-size:11px;padding:3px 8px;border-radius:4px;font-family:var(--mono);display:none;z-index:11;max-width:90%"></div>
    `;
    previewCanvas = document.getElementById('previewCanvas');
    previewCtx = previewCanvas.getContext('2d');

    try {
        previewWs = new WebSocket(`ws://localhost:${port}`);
    } catch (e) {
        appendLog('WebSocket failed, falling back to screenshots', 'error');
        startScreenshotStream();
        return;
    }

    previewWs.onopen = () => {
        appendLog('🔴 Live preview connected (WebSocket)', 'success');
    };

    previewWs.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'frame') {
                if (msg.viewport) window.previewCSSViewport = msg.viewport;
                // Draw CDP screencast frame on canvas
                const img = new Image();
                img.onload = () => {
                    if (previewCanvas.width !== img.width || previewCanvas.height !== img.height) {
                        previewCanvas.width = img.width;
                        previewCanvas.height = img.height;
                    }
                    previewCtx.drawImage(img, 0, 0);
                    // Calculate scale for mouse coordinate translation
                    const rect = previewCanvas.getBoundingClientRect();
                    previewScale.x = img.width / rect.width;
                    previewScale.y = img.height / rect.height;
                };
                img.src = 'data:image/jpeg;base64,' + msg.data;
            } else if (msg.type === 'picked') {
                // Element picker result
                if (msg.selector && pickerTargetStep !== null) {
                    const input = document.querySelector(`#step-${pickerTargetStep} .selector-row input`);
                    if (input) input.value = msg.selector;
                    updateStepField(pickerTargetStep, 'selector', msg.selector);
                    appendLog(`Picked: ${msg.selector}`, 'success');
                } else if (msg.selector) {
                    appendLog(`Element: ${msg.selector}`, 'info');
                }
                pickerActive = false;
                document.getElementById('btnPicker').classList.remove('btn-accent');
                document.getElementById('btnPicker').classList.add('btn-ghost');
            } else if (msg.type === 'inspect') {
                // Show hover overlay
                const overlay = document.getElementById('inspectOverlay');
                const info = document.getElementById('inspectInfo');
                if (window.previewCSSViewport && previewCanvas.width) {
                    const rect = previewCanvas.getBoundingClientRect();
                    const displayAspect = rect.width / rect.height;
                    const canvasAspect = previewCanvas.width / previewCanvas.height;
                    let renderW, renderH, offsetX, offsetY;
                    if (canvasAspect > displayAspect) {
                        renderW = rect.width;
                        renderH = rect.width / canvasAspect;
                        offsetX = 0;
                        offsetY = (rect.height - renderH) / 2;
                    } else {
                        renderH = rect.height;
                        renderW = rect.height * canvasAspect;
                        offsetX = (rect.width - renderW) / 2;
                        offsetY = 0;
                    }
                    const pctX = msg.rect.x / window.previewCSSViewport.width;
                    const pctY = msg.rect.y / window.previewCSSViewport.height;
                    const pctW = msg.rect.w / window.previewCSSViewport.width;
                    const pctH = msg.rect.h / window.previewCSSViewport.height;
                    
                    overlay.style.display = 'block';
                    overlay.style.left = (offsetX + pctX * renderW) + 'px';
                    overlay.style.top = (offsetY + pctY * renderH) + 'px';
                    overlay.style.width = (pctW * renderW) + 'px';
                    overlay.style.height = (pctH * renderH) + 'px';
                }
                info.style.display = 'block';
                info.textContent = `<${msg.tag}${msg.id ? '#' + msg.id : ''}${msg.classes ? '.' + msg.classes.split(' ')[0] : ''}> ${msg.text}`;
            } else if (msg.type === 'url_changed') {
                document.getElementById('previewUrl').value = msg.url || '';
            }
        } catch (e) {}
    };

    previewWs.onclose = () => {
        appendLog('Preview disconnected', 'info');
        previewWs = null;
    };

    previewWs.onerror = () => {
        appendLog('WebSocket error, falling back to screenshots', 'error');
        startScreenshotStream();
    };

    // Mouse events on canvas → forward to browser
    previewCanvas.addEventListener('click', (e) => {
        if (!previewWs) return;
        const { x, y } = canvasCoords(e);
        if (pickerActive) {
            previewWs.send(JSON.stringify({ type: 'pick_element', x, y }));
        } else {
            previewWs.send(JSON.stringify({ type: 'mouse', action: 'click', x, y }));
        }
    });

    previewCanvas.addEventListener('mousemove', (e) => {
        if (!previewWs) return;
        const { x, y } = canvasCoords(e);
        if (pickerActive) {
            previewWs.send(JSON.stringify({ type: 'hover_inspect', x, y }));
        }
    });

    previewCanvas.addEventListener('wheel', (e) => {
        if (!previewWs) return;
        e.preventDefault();
        previewWs.send(JSON.stringify({ type: 'scroll', deltaX: e.deltaX, deltaY: e.deltaY }));
    }, { passive: false });

    previewCanvas.addEventListener('mouseleave', () => {
        document.getElementById('inspectOverlay').style.display = 'none';
        document.getElementById('inspectInfo').style.display = 'none';
    });

    // Keyboard events when canvas is focused
    previewCanvas.setAttribute('tabindex', '0');
    previewCanvas.addEventListener('keydown', (e) => {
        if (!previewWs) return;
        e.preventDefault();
        if (e.key.length === 1) {
            previewWs.send(JSON.stringify({ type: 'keyboard', action: 'type', text: e.key }));
        } else {
            previewWs.send(JSON.stringify({ type: 'keyboard', action: 'press', key: e.key }));
        }
    });
}

function canvasCoords(e) {
    const rect = previewCanvas.getBoundingClientRect();
    const cw = previewCanvas.width;  // actual pixel width of canvas (from CDP)
    const ch = previewCanvas.height; // actual pixel height of canvas
    // With object-fit:contain, canvas is centered with letterboxing
    const displayAspect = rect.width / rect.height;
    const canvasAspect = cw / ch;
    let renderW, renderH, offsetX, offsetY;
    if (canvasAspect > displayAspect) {
        // Canvas is wider than container — letterbox top/bottom
        renderW = rect.width;
        renderH = rect.width / canvasAspect;
        offsetX = 0;
        offsetY = (rect.height - renderH) / 2;
    } else {
        // Canvas is taller — letterbox left/right
        renderH = rect.height;
        renderW = rect.height * canvasAspect;
        offsetX = (rect.width - renderW) / 2;
        offsetY = 0;
    }
    const localX = e.clientX - rect.left - offsetX;
    const localY = e.clientY - rect.top - offsetY;

    const pctX = Math.max(0, Math.min(1, localX / renderW));
    const pctY = Math.max(0, Math.min(1, localY / renderH));

    if (window.previewCSSViewport) {
        return {
            x: pctX * window.previewCSSViewport.width,
            y: pctY * window.previewCSSViewport.height,
            pctX, pctY
        };
    }
    
    return {
        x: Math.max(0, Math.min(cw, pctX * cw)),
        y: Math.max(0, Math.min(ch, pctY * ch)),
        pctX, pctY
    };
}

let screenshotInterval = null;
function startScreenshotStream() {
    if (!previewSession) return;
    stopScreenshotStream();
    const container = document.getElementById('previewContainer');
    container.innerHTML = '<img id="previewImg" alt="Browser Preview" style="width:100%;height:100%;object-fit:contain">';
    const img = document.getElementById('previewImg');
    let loading = false;
    screenshotInterval = setInterval(() => {
        if (loading) return;
        loading = true;
        const buf = new Image();
        buf.onload = () => { img.src = buf.src; loading = false; };
        buf.onerror = () => { loading = false; };
        buf.src = `http://localhost:${previewSession.port}/screenshot?t=${Date.now()}`;
    }, 1000);
}

function stopScreenshotStream() {
    if (screenshotInterval) { clearInterval(screenshotInterval); screenshotInterval = null; }
}

async function navigatePreview() {
    let url = document.getElementById('previewUrl').value.trim();
    if (!url) return;
    // Auto-add protocol
    if (!/^https?:\/\//i.test(url) && url !== 'about:blank') {
        url = 'https://' + url;
        document.getElementById('previewUrl').value = url;
    }
    // Use WebSocket if available (script runner mode)
    if (previewWs && previewWs.readyState === 1) {
        previewWs.send(JSON.stringify({ type: 'navigate', url }));
        return;
    }
    // Fallback: preview server HTTP
    if (previewSession) {
        await fetch(`http://localhost:${previewSession.port}/navigate`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
    }
}

function navAction(action) {
    if (previewWs && previewWs.readyState === 1) {
        previewWs.send(JSON.stringify({ type: 'nav', action }));
    }
}

// ── Element Picker ──
async function togglePicker() {
    if (!previewSession && !previewWs) { appendLog('Launch browser first', 'error'); return; }
    pickerActive = !pickerActive;
    const btn = document.getElementById('btnPicker');
    if (pickerActive) {
        btn.classList.add('btn-accent');
        btn.classList.remove('btn-ghost');
        if (previewCanvas) previewCanvas.style.cursor = 'crosshair';
        appendLog('🎯 Element Picker ON — hover to inspect, click to select', 'info');
    } else {
        btn.classList.remove('btn-accent');
        btn.classList.add('btn-ghost');
        if (previewCanvas) previewCanvas.style.cursor = 'default';
        document.getElementById('inspectOverlay').style.display = 'none';
        document.getElementById('inspectInfo').style.display = 'none';
    }
}

let pickerTargetStep = null;
async function pickElement(stepIdx) {
    if (!previewSession) { appendLog('Launch browser first', 'error'); return; }
    pickerTargetStep = stepIdx;
    if (!pickerActive) await togglePicker();
    appendLog(`Pick element for Step ${stepIdx + 1}`, 'info');
}

async function takeScreenshot() {
    if (!previewSession) return;
    window.open(`http://localhost:${previewSession.port}/screenshot`, '_blank');
}

// ── Profiles ──
async function loadProfiles() {
    try {
        const data = await api('/api/v1/browser/profiles');
        const select = document.getElementById('execProfile');
        const profiles = data.profiles || [];
        select.innerHTML = '<option value="">Select Profile...</option>' +
            profiles.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
    } catch (e) {}
}

// ── History ──
async function loadHistory() {
    if (!currentScript) return;
    try {
        const data = await api(`${API}/executions/history`);
        const list = document.getElementById('executionHistory');
        const execs = (data.executions || []).filter(e => e.script_id === currentScript.id);
        if (!execs.length) {
            list.innerHTML = '<div class="empty-state"><span class="material-symbols-outlined">history</span><p>No history</p></div>';
            return;
        }
        list.innerHTML = execs.slice(0, 20).map(e => `
            <div class="history-item ${e.status}">
                <div style="display:flex;justify-content:space-between;font-size:0.82rem">
                    <span>${e.status === 'success' ? '✅' : e.status === 'error' ? '❌' : '⏳'} ${e.status}</span>
                    <span style="color:var(--text-muted)">${e.started_at || ''}</span>
                </div>
                <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px">${e.profile_name || 'No profile'}</div>
            </div>
        `).join('');
    } catch (e) {}
}

// ── Import ──
async function importScriptPrompt() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.js';
    input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        const text = await file.text();
        try {
            if (file.name.endsWith('.js')) {
                // AI Parser for .js files
                appendLog(`Parsing ${file.name} with AI...`, 'info');
                const data = await api(`${API}/import/js`, {
                    method: 'POST',
                    body: JSON.stringify({ content: text, filename: file.name, use_ai: true })
                });
                await loadScripts();
                if (data.script) selectScript(data.script.id);
                appendLog(`Imported! ${data.parsed_steps || 0} steps, ${data.parsed_variables || 0} variables`, 'success');
            } else {
                // JSON import
                const json = JSON.parse(text);
                const data = await api(`${API}/import/json`, {
                    method: 'POST',
                    body: JSON.stringify({ script: json.script || json })
                });
                await loadScripts();
                if (data.script) selectScript(data.script.id);
                appendLog('Script imported!', 'success');
            }
        } catch (e) { appendLog('Import failed: ' + e.message, 'error'); }
    };
    input.click();
}

// ── AI Generate ──
async function doAIGenerate() {
    const prompt = document.getElementById('aiPrompt').value.trim();
    const targetUrl = document.getElementById('aiTargetUrl').value.trim();
    if (!prompt) { alert('Vui lòng mô tả script bạn muốn tạo'); return; }

    const statusEl = document.getElementById('aiGenerateStatus');
    const statusText = document.getElementById('aiGenerateStatusText');
    const btn = document.getElementById('btnDoAIGenerate');

    statusEl.style.display = 'block';
    statusText.textContent = 'Đang tạo script bằng AI...';
    btn.disabled = true;

    try {
        const data = await api(`${API}/generate`, {
            method: 'POST',
            body: JSON.stringify({ prompt, target_url: targetUrl })
        });

        if (data.script) {
            statusText.textContent = `✅ Tạo thành công! ${data.steps_count} steps (${data.provider})`;
            await loadScripts();
            await selectScript(data.script.id);
            appendLog(`AI generated script: ${data.script.name} (${data.steps_count} steps via ${data.provider})`, 'success');

            setTimeout(() => {
                closeModal('aiGenerateModal');
                statusEl.style.display = 'none';
                document.getElementById('aiPrompt').value = '';
                document.getElementById('aiTargetUrl').value = '';
            }, 1500);
        } else {
            statusText.textContent = '❌ Không tạo được script';
        }
    } catch (e) {
        statusText.textContent = `❌ Lỗi: ${e.message || 'AI generation failed'}`;
        appendLog('AI generate failed: ' + (e.message || 'Unknown error'), 'error');
    } finally {
        btn.disabled = false;
    }
}

// ── Log ──
function appendLog(msg, type = '') {
    const log = document.getElementById('logContent');
    const time = new Date().toLocaleTimeString();

    // Parse JSON log lines from script_runner.js
    let displayMsg = msg;
    if (typeof msg === 'string' && msg.trimStart().startsWith('{')) {
        try {
            const parsed = JSON.parse(msg);
            displayMsg = parsed.message || parsed.error || msg;
            // Auto-detect type from status
            if (!type) {
                if (parsed.status === 'error' || parsed.success === false) type = 'error';
                else if (parsed.status === 'done' && parsed.success) type = 'success';
                else if (parsed.status === 'step') type = 'info';
            }
        } catch (e) {} // not JSON, use as-is
    }

    log.innerHTML += `<div class="log-line ${type}">[${time}] ${esc(displayMsg)}</div>`;
    log.scrollTop = log.scrollHeight;
}

function clearLog() { document.getElementById('logContent').innerHTML = ''; }

// ── Resize Handles ──
function setupResizeHandles() {
    setupResize('sidebarResize', 'sidebar', 'left');
    setupResize('editorResize', 'preview-panel', 'right');
}

function setupResize(handleId, panelId, side) {
    const handle = document.getElementById(handleId);
    const panel = document.getElementById(panelId);
    if (!handle || !panel) return;
    let startX, startW;
    handle.onmousedown = e => {
        startX = e.clientX;
        startW = panel.offsetWidth;
        document.body.classList.add('panel-resizing');
        const onMove = e => {
            const diff = side === 'left' ? e.clientX - startX : startX - e.clientX;
            panel.style.width = Math.max(200, startW + diff) + 'px';
            panel.style.flex = 'none';
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.classList.remove('panel-resizing');
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    };
}

// ── Utils ──
function showModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function closeStepTypeModal() { closeModal('stepTypeModal'); }
function closeNewScriptModal() { closeModal('newScriptModal'); }
function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function getCategoryIcon(c) { return { video: '🎬', image: '🖼️', audio: '🎵', scraping: '🕷️' }[c] || '📄'; }
function filterScripts(q) {
    const items = document.querySelectorAll('.script-item');
    items.forEach(el => { el.style.display = el.textContent.toLowerCase().includes(q.toLowerCase()) ? '' : 'none'; });
}

// ── Chat Bot ──
let chatHistory = [];

function toggleChat() {
    const panel = document.getElementById('chatPanel');
    const btn = document.getElementById('chatToggle');
    if (panel.style.display === 'none') {
        panel.style.display = 'flex';
        btn.style.display = 'none';
        document.getElementById('chatInput').focus();
    } else {
        panel.style.display = 'none';
        btn.style.display = 'flex';
    }
}

function clearChat() {
    chatHistory = [];
    const msgs = document.getElementById('chatMessages');
    msgs.innerHTML = `<div class="chat-msg bot"><div class="chat-bubble">Chat đã xóa. Hỏi tôi bất cứ điều gì!</div></div>`;
}

function addChatMsg(role, html) {
    const msgs = document.getElementById('chatMessages');
    const div = document.createElement('div');
    div.className = `chat-msg ${role}`;
    div.innerHTML = `<div class="chat-bubble">${html}</div>`;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
}

async function sendChat() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';

    addChatMsg('user', esc(text));
    chatHistory.push({ role: 'user', content: text });

    // Show typing indicator
    const typingDiv = addChatMsg('bot', '<div class="typing-dots"><span></span><span></span><span></span></div>');

    try {
        const data = await api(`${API}/chat`, {
            method: 'POST',
            body: JSON.stringify({
                message: text,
                history: chatHistory.slice(-10),
                script: currentScript,
            })
        });

        typingDiv.remove();

        if (data.reply) {
            addChatMsg('bot', data.reply);
            chatHistory.push({ role: 'assistant', content: data.reply });
        }

        // If AI modified steps, apply them
        if (data.updated_steps && currentScript) {
            currentScript.steps = data.updated_steps;
            renderSteps();
            saveSteps();
            addChatMsg('bot', '✅ Script đã được cập nhật! Xem các bước bên trái.');
        }
    } catch (e) {
        typingDiv.remove();
        addChatMsg('bot', `❌ Lỗi: ${e.message}`);
    }
}

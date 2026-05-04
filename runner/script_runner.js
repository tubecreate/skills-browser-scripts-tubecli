#!/usr/bin/env node
/**
 * script_runner.js — Execute Script Studio steps using Playwright.
 * 
 * Usage: node script_runner.js --exec-file <path_to_exec.json>
 * 
 * Output: JSON lines on stdout for real-time progress.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const args = require('minimist')(process.argv.slice(2));
const execFile = args['exec-file'];

if (!execFile || !fs.existsSync(execFile)) {
    console.log(JSON.stringify({ status: 'error', message: 'Missing --exec-file' }));
    process.exit(1);
}

const execData = JSON.parse(fs.readFileSync(execFile, 'utf-8'));
const { script, variables = {}, profile = '', headless = false, engine = 'playwright', exec_id } = execData;
const steps = script.steps || [];

function log(msg) { console.log(JSON.stringify({ status: 'log', exec_id, message: msg, time: new Date().toISOString() })); }
function stepLog(idx, type, msg) { console.log(JSON.stringify({ status: 'step', exec_id, step_index: idx, step_type: type, message: msg })); }

// Variable interpolation: replace {{var_name}} with values
function interpolate(text) {
    if (typeof text !== 'string') return text;
    return text.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] !== undefined ? variables[key] : `{{${key}}}`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const randBetween = (a, b) => a + Math.random() * (b - a);

// ── Human-like Mouse Movement (Bezier curve) ──
let lastMouseX = 0, lastMouseY = 0;

function bezierPoint(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return {
        x: u*u*u*p0.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*p3.x,
        y: u*u*u*p0.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*p3.y,
    };
}

async function humanMove(page, targetX, targetY) {
    const startX = lastMouseX || randBetween(100, 600);
    const startY = lastMouseY || randBetween(100, 400);
    const steps = 25 + Math.floor(Math.random() * 25);

    // Random Bezier control points for curved path
    const ctrl1 = {
        x: startX + (targetX - startX) * randBetween(0.2, 0.5) + randBetween(-80, 80),
        y: startY + (targetY - startY) * randBetween(0.1, 0.4) + randBetween(-60, 60),
    };
    const ctrl2 = {
        x: startX + (targetX - startX) * randBetween(0.5, 0.8) + randBetween(-50, 50),
        y: startY + (targetY - startY) * randBetween(0.6, 0.9) + randBetween(-40, 40),
    };

    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        // Ease-in-out for natural acceleration
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const pos = bezierPoint(
            { x: startX, y: startY },
            ctrl1, ctrl2,
            { x: targetX, y: targetY },
            eased
        );
        await page.mouse.move(pos.x, pos.y);
        // Varying speed — occasional micro-pauses
        if (Math.random() > 0.85) await sleep(randBetween(5, 20));
    }

    lastMouseX = targetX;
    lastMouseY = targetY;
}

// ── Human-like Typing ──
async function humanType(page, text) {
    for (const char of text) {
        await page.keyboard.type(char, { delay: 0 });
        // Variable delay per character (40-120ms, occasional pauses)
        let delay = randBetween(40, 120);
        if (char === ' ') delay += randBetween(20, 60);         // Slightly longer on spaces
        if (Math.random() > 0.92) delay += randBetween(100, 300); // Occasional "thinking" pause
        await sleep(delay);
    }
}

// ── Human-like Scroll ──
async function humanScroll(page, deltaY = 300) {
    const scrollSteps = 5 + Math.floor(Math.random() * 5);
    const stepAmount = deltaY / scrollSteps;
    for (let i = 0; i < scrollSteps; i++) {
        const jitter = stepAmount * randBetween(0.7, 1.3);
        await page.mouse.wheel(0, jitter);
        await sleep(randBetween(30, 80));
    }
}

// ── Human-like random pause between steps ──
async function humanPause(page) {
    await sleep(randBetween(300, 800));
    // 15% chance of random idle mouse movement (looks natural)
    if (page && Math.random() > 0.85) {
        const rx = randBetween(200, 1000);
        const ry = randBetween(100, 600);
        await humanMove(page, rx, ry);
    }
}

async function executeStep(page, step, index) {
    const type = step.type;
    const params = step.params || {};
    const selector = interpolate(step.selector || '');
    const timeout = params.timeout || 10000;

    stepLog(index, type, step.label || `Step ${index + 1}`);

    // Human pause between steps
    await humanPause(page);

    switch (type) {
        case 'navigate': {
            let url = interpolate(params.url || script.target_url || '');
            // Auto-add protocol if missing
            if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
                url = 'https://' + url;
            }
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            stepLog(index, type, `Navigated to ${url}`);
            break;
        }
        case 'click': {
            const el = page.locator(selector).first();
            await el.waitFor({ state: 'visible', timeout });
            // Human-like: move mouse to element, then click
            const box = await el.boundingBox();
            if (box) {
                // Click at a slightly randomized position within the element
                const clickX = box.x + box.width * randBetween(0.3, 0.7);
                const clickY = box.y + box.height * randBetween(0.3, 0.7);
                await humanMove(page, clickX, clickY);
                await sleep(randBetween(100, 300)); // Brief pause before clicking
            }
            if (params.force) await el.click({ force: true });
            else await el.click();
            stepLog(index, type, `Clicked: ${selector}`);
            break;
        }
        case 'type': {
            const text = interpolate(params.text || '');
            const el = page.locator(selector).first();
            await el.waitFor({ state: 'visible', timeout });
            // Human-like: move to input, click, then type
            const box = await el.boundingBox();
            if (box) {
                await humanMove(page, box.x + box.width / 2, box.y + box.height / 2);
                await sleep(randBetween(100, 250));
            }
            await el.click();
            if (params.clear_first) { await el.fill(''); await sleep(200); }
            // Use human-like typing with random delays
            await humanType(page, text);
            stepLog(index, type, `Typed ${text.length} chars into ${selector}`);
            break;
        }
        case 'wait': {
            const state = params.state || 'visible';
            await page.locator(selector).first().waitFor({ state, timeout });
            stepLog(index, type, `Element ${state}: ${selector}`);
            break;
        }
        case 'wait_hidden': {
            await page.locator(selector).first().waitFor({ state: 'hidden', timeout });
            stepLog(index, type, `Element hidden: ${selector}`);
            break;
        }
        case 'evaluate': {
            const code = interpolate(params.code || '');
            const result = await page.evaluate(code);
            if (params.save_as) variables[params.save_as] = result;
            stepLog(index, type, `Evaluated, result: ${JSON.stringify(result).slice(0, 200)}`);
            break;
        }
        case 'extract': {
            const el = page.locator(selector).first();
            await el.waitFor({ state: 'visible', timeout });
            let value;
            if (params.attribute === 'innerText') value = await el.innerText();
            else if (params.attribute === 'innerHTML') value = await el.innerHTML();
            else value = await el.getAttribute(params.attribute || 'href');
            if (params.save_as) variables[params.save_as] = value;
            stepLog(index, type, `Extracted ${params.attribute}: ${String(value).slice(0, 200)}`);
            break;
        }
        case 'screenshot': {
            const savePath = interpolate(params.save_as || `step_${index}.png`);
            await page.screenshot({ path: savePath, fullPage: params.full_page || false });
            stepLog(index, type, `Screenshot saved: ${savePath}`);
            break;
        }
        case 'sleep': {
            const ms = params.ms || 2000;
            await sleep(ms);
            stepLog(index, type, `Slept ${ms}ms`);
            break;
        }
        case 'condition': {
            const checkCode = interpolate(params.check || 'false');
            const result = await page.evaluate(checkCode);
            const branch = result ? (params.then_steps || []) : (params.else_steps || []);
            for (let i = 0; i < branch.length; i++) {
                await executeStepWithRetry(page, branch[i], `${index}.${i}`);
            }
            break;
        }
        case 'loop': {
            const count = params.count || 1;
            const delay = params.delay || 1000;
            const loopSteps = params.steps || [];
            for (let iter = 0; iter < count; iter++) {
                variables['_loop_index'] = iter;
                if (params.break_on) {
                    const shouldBreak = await page.evaluate(interpolate(params.break_on));
                    if (shouldBreak) { stepLog(index, type, `Loop break at iteration ${iter}`); break; }
                }
                for (let i = 0; i < loopSteps.length; i++) {
                    await executeStepWithRetry(page, loopSteps[i], `${index}.loop${iter}.${i}`);
                }
                if (iter < count - 1) await sleep(delay);
            }
            break;
        }
        case 'download': {
            // Wait for download event
            const downloadPromise = page.waitForEvent('download', { timeout });
            if (selector) {
                // Human-like click on download trigger
                const el = page.locator(selector).first();
                const box = await el.boundingBox();
                if (box) {
                    await humanMove(page, box.x + box.width / 2, box.y + box.height / 2);
                    await sleep(randBetween(100, 300));
                }
                await el.click();
            }
            const download = await downloadPromise;
            const outputDir = interpolate(params.output_dir || '.');
            const filename = interpolate(params.filename || download.suggestedFilename());
            const savePath = path.join(outputDir, filename);
            await download.saveAs(savePath);
            variables['_last_download'] = savePath;
            stepLog(index, type, `Downloaded: ${savePath}`);
            break;
        }
        case 'keyboard': {
            const key = interpolate(params.key || 'Enter');
            await sleep(randBetween(100, 300));
            await page.keyboard.press(key);
            stepLog(index, type, `Pressed key: ${key}`);
            break;
        }
        case 'scroll': {
            const direction = params.direction || 'down';
            const amount = params.amount || 400;
            const delta = direction === 'up' ? -amount : amount;
            await humanScroll(page, delta);
            stepLog(index, type, `Scrolled ${direction} ${amount}px`);
            break;
        }
        case 'mouse_move': {
            const mx = params.x || randBetween(200, 1000);
            const my = params.y || randBetween(100, 600);
            await humanMove(page, mx, my);
            stepLog(index, type, `Moved mouse to (${Math.round(mx)}, ${Math.round(my)})`);
            break;
        }
        case 'hover': {
            if (selector) {
                const el = page.locator(selector).first();
                await el.waitFor({ state: 'visible', timeout });
                const box = await el.boundingBox();
                if (box) {
                    await humanMove(page, box.x + box.width / 2, box.y + box.height / 2);
                }
                stepLog(index, type, `Hovered: ${selector}`);
            }
            break;
        }
        case 'ai_generate': {
            // Extract page context if selector provided
            let context = '';
            const extractSel = params.extract_selector || params.context_selector || 'h1';
            try {
                context = await page.locator(extractSel).first().innerText({ timeout: 5000 });
            } catch (e) {
                // Fallback: get page title
                context = await page.title();
            }

            const aiPrompt = interpolate(params.prompt || 'Write a short, friendly comment');
            const saveName = params.save_as || '_ai_text';

            stepLog(index, type, `🤖 AI generating: "${aiPrompt}" (context: ${context.slice(0, 50)}...)`);

            // Call AI via TubeCLI API
            const tubecliPort = process.env.TUBECLI_PORT || '5295';
            try {
                const http = require('http');
                const aiResult = await new Promise((resolve, reject) => {
                    const postData = JSON.stringify({
                        message: `${aiPrompt}\n\nPage context: "${context}"\n\nRespond with ONLY the generated text, no explanations or quotes.`,
                        history: [],
                        script: null,
                    });
                    const req = http.request({
                        hostname: '127.0.0.1', port: tubecliPort,
                        path: '/api/v1/scripts/chat', method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
                    }, (res) => {
                        let data = '';
                        res.on('data', c => data += c);
                        res.on('end', () => {
                            try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Invalid AI response')); }
                        });
                    });
                    req.on('error', reject);
                    req.write(postData);
                    req.end();
                });

                const generatedText = (aiResult.reply || '').trim();
                variables[saveName] = generatedText;
                stepLog(index, type, `🤖 Generated: "${generatedText.slice(0, 80)}..." → {{${saveName}}}`);
            } catch (aiErr) {
                stepLog(index, type, `🤖 AI generation failed: ${aiErr.message}`);
                variables[saveName] = params.fallback || 'Great content! 👍';
            }
            break;
        }
        default:
            stepLog(index, type, `Unknown step type: ${type}`);
    }
}

async function executeStepWithRetry(page, step, index) {
    if (step.enabled === false) {
        stepLog(index, step.type, 'SKIPPED (disabled)');
        return;
    }
    const retryCount = step.retry_count || 0;
    const retryDelay = step.retry_delay || 1000;
    const onError = step.on_error || 'abort';

    for (let attempt = 0; attempt <= retryCount; attempt++) {
        try {
            await executeStep(page, step, index);
            return;
        } catch (err) {
            const msg = `Step ${index} failed (attempt ${attempt + 1}/${retryCount + 1}): ${err.message}`;
            stepLog(index, step.type, msg);
            if (attempt < retryCount) {
                await sleep(retryDelay);
                continue;
            }

            // ── Smart Auto-Fix: try to find correct selector ──
            const isSelectorError = err.message.includes('Timeout') ||
                                    err.message.includes('waiting for') ||
                                    err.message.includes('locator');
            if (isSelectorError && (step.selector || step.type === 'wait' || step.type === 'navigate')) {

                // ─── Phase 1: Smart Selector Finder (no AI, instant) ───
                stepLog(index, step.type, '🔍 Smart fix: probing page for element...');
                const origSelector = step.selector;
                let smartFixed = false;

                // Extract keywords from failed selector for matching
                const selectorKeywords = origSelector.toLowerCase()
                    .replace(/[#.\[\]='"]/g, ' ').split(/\s+/)
                    .filter(w => w.length > 2 && !['first', 'last', 'nth'].includes(w));
                const labelHint = (step.label || '').toLowerCase();
                const isSearching = labelHint.includes('search') || selectorKeywords.includes('search');
                const isInput = origSelector.includes('input') || origSelector.includes('text') || isSearching;

                // ── Strategy 1: Playwright Native Locators (pierce Shadow DOM) ──
                const nativeTrials = [];

                // By placeholder
                for (const kw of ['Search', 'search', 'Tìm kiếm', ...selectorKeywords]) {
                    nativeTrials.push({ locator: page.getByPlaceholder(kw, { exact: false }).first(), desc: `getByPlaceholder("${kw}")` });
                }
                // By role
                if (isInput) {
                    nativeTrials.push({ locator: page.getByRole('searchbox').first(), desc: 'getByRole("searchbox")' });
                    nativeTrials.push({ locator: page.getByRole('combobox').first(), desc: 'getByRole("combobox")' });
                    nativeTrials.push({ locator: page.getByRole('textbox').first(), desc: 'getByRole("textbox")' });
                }
                // By label
                for (const kw of selectorKeywords) {
                    nativeTrials.push({ locator: page.getByLabel(kw, { exact: false }).first(), desc: `getByLabel("${kw}")` });
                }

                // ── Strategy 2: XPath (deep DOM traversal) ──
                const xpathTrials = [];
                if (isInput) {
                    xpathTrials.push(`//input[contains(@name,'search')]`);
                    xpathTrials.push(`//input[contains(@placeholder,'Search') or contains(@placeholder,'search')]`);
                    xpathTrials.push(`//input[contains(@class,'search') or contains(@class,'Search')]`);
                    xpathTrials.push(`//input[@type='text' or @type='search']`);
                    xpathTrials.push(`//*[@role='combobox' and (contains(@placeholder,'Search') or contains(@name,'search'))]`);
                    xpathTrials.push(`//*[@role='searchbox']`);
                }
                // Generic: match by label text
                for (const kw of selectorKeywords) {
                    xpathTrials.push(`//*[contains(@name,'${kw}') or contains(@id,'${kw}') or contains(@placeholder,'${kw}')]`);
                }

                // ── Strategy 3: CSS alternatives ──
                const cssTrials = [];
                if (isInput) {
                    cssTrials.push(`input[name*="search"]`);
                    cssTrials.push(`input[name*="query"]`);
                    cssTrials.push(`input[placeholder*="Search"]`);
                    cssTrials.push(`input[type="search"]`);
                    cssTrials.push(`[role="combobox"]`);
                    cssTrials.push(`[role="searchbox"]`);
                }
                for (const kw of selectorKeywords) {
                    cssTrials.push(`[name*="${kw}"]`);
                    cssTrials.push(`[aria-label*="${kw}"]`);
                    cssTrials.push(`#${kw}`);
                }

                // ── Try all strategies ──
                // 1. Playwright native (best for Shadow DOM)
                for (const trial of nativeTrials) {
                    try {
                        const visible = await trial.locator.isVisible({ timeout: 2000 });
                        if (!visible) continue;
                        stepLog(index, step.type, `🔍 Found: ${trial.desc}`);
                        // Execute the step using this locator directly
                        const tempStep = { ...step };
                        // We need to get a CSS-like selector from the locator
                        // Click/type using the locator directly
                        if (step.type === 'wait') {
                            await trial.locator.waitFor({ state: 'visible', timeout: 5000 });
                        } else if (step.type === 'click') {
                            const box = await trial.locator.boundingBox();
                            if (box) await humanMove(page, box.x + box.width * randBetween(0.3, 0.7), box.y + box.height * randBetween(0.3, 0.7));
                            await sleep(randBetween(100, 300));
                            await trial.locator.click();
                        } else if (step.type === 'type') {
                            const box = await trial.locator.boundingBox();
                            if (box) await humanMove(page, box.x + box.width / 2, box.y + box.height / 2);
                            await sleep(randBetween(100, 250));
                            await trial.locator.click();
                            if (step.params?.clear_first) await trial.locator.fill('');
                            await humanType(page, interpolate(step.params?.text || ''));
                        }
                        stepLog(index, step.type, `✅ Smart fix worked! ${trial.desc}`);
                        smartFixed = true;
                        break;
                    } catch (e) { /* next */ }
                }

                // 2. XPath
                if (!smartFixed) {
                    for (const xpath of xpathTrials) {
                        try {
                            const loc = page.locator(xpath).first();
                            const visible = await loc.isVisible({ timeout: 1500 });
                            if (!visible) continue;
                            stepLog(index, step.type, `🔍 XPath found: ${xpath}`);
                            step.selector = `xpath=${xpath}`;
                            await executeStep(page, step, index);
                            stepLog(index, step.type, `✅ XPath fix worked! ${xpath}`);
                            smartFixed = true;
                            break;
                        } catch (e) { /* next */ }
                    }
                }

                // 3. CSS alternatives
                if (!smartFixed) {
                    for (const css of cssTrials) {
                        try {
                            const loc = page.locator(css).first();
                            const visible = await loc.isVisible({ timeout: 1500 });
                            if (!visible) continue;
                            stepLog(index, step.type, `🔍 CSS found: ${css}`);
                            step.selector = css;
                            await executeStep(page, step, index);
                            stepLog(index, step.type, `✅ CSS fix worked! ${css}`);
                            smartFixed = true;
                            break;
                        } catch (e) { /* next */ }
                    }
                }

                if (smartFixed) return;
                step.selector = origSelector; // Restore

                // ─── Phase 2: AI Fix (if smart finder failed) ───
                stepLog(index, step.type, '🤖 AI Auto-Fix: analyzing page...');
                try {
                    // Get FULL DOM including shadow roots
                    const pageHtml = await page.evaluate(() => {
                        function getFullDOM(root, depth = 0) {
                            if (depth > 3) return '';
                            let html = '';
                            for (const child of root.children || []) {
                                html += child.outerHTML?.slice(0, 500) || '';
                                if (child.shadowRoot) {
                                    html += '<!-- SHADOW ROOT -->';
                                    html += getFullDOM(child.shadowRoot, depth + 1);
                                }
                            }
                            return html;
                        }
                        return getFullDOM(document.body).slice(0, 15000);
                    }).catch(() => '');

                    const pageUrl = await page.url();
                    const visibleText = await page.evaluate(() => {
                        return document.body ? document.body.innerText.slice(0, 3000) : '';
                    }).catch(() => '');

                    // Also include smart-found selectors as hints for AI
                    const smartHints = smartSelectors.map(m => `${m.sel} (${m.info.tag} name=${m.info.name} placeholder=${m.info.placeholder})`).join('\n');

                    const tubecliPort = process.env.TUBECLI_PORT || '5295';
                    const fixRes = await fetch(`http://localhost:${tubecliPort}/api/v1/scripts/ai-fix`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            selector: step.selector,
                            step_type: step.type,
                            label: step.label || `Step ${index}`,
                            error: err.message,
                            page_html: pageHtml,
                            page_url: pageUrl,
                            visible_text: visibleText + '\n\n--- FOUND ELEMENTS ---\n' + smartHints,
                        }),
                    });
                    const fix = await fixRes.json();
                    if (fix.status === 'fixed') {
                        stepLog(index, step.type, `🤖 AI: ${fix.reason}`);

                        // Try pre-action clicks
                        const clicks = fix.pre_action_clicks || [];
                        for (const clickSel of clicks) {
                            try {
                                stepLog(index, step.type, `🤖 Clicking: ${clickSel}`);
                                await page.click(clickSel, { force: true, timeout: 5000 });
                                await sleep(1000);
                            } catch (clickErr) {
                                try {
                                    await page.getByRole('button', { name: clickSel }).first().click({ timeout: 3000 });
                                    await sleep(1000);
                                } catch (e2) {}
                            }
                        }

                        // Execute pre-action JS
                        if (fix.pre_action_js) {
                            stepLog(index, step.type, `🤖 Running JS fix...`);
                            try {
                                await page.evaluate(fix.pre_action_js);
                                await sleep(1000);
                            } catch (preErr) {}
                        }

                        // Unblock page
                        try {
                            await page.evaluate(() => {
                                document.body.style.overflow = '';
                                document.body.style.position = '';
                                document.documentElement.style.overflow = '';
                                document.querySelectorAll('[class*="consent"], [class*="overlay"], [class*="backdrop"], [id*="consent"]')
                                    .forEach(el => { try { el.remove(); } catch(e) {} });
                            });
                        } catch (e) {}

                        await sleep(1500);
                        await page.waitForLoadState('domcontentloaded').catch(() => {});

                        // Retry with AI's selector
                        if (fix.selector) step.selector = fix.selector;
                        try {
                            await executeStep(page, step, index);
                            stepLog(index, step.type, `✅ AI fix worked!`);
                            return;
                        } catch (fixErr) {
                            stepLog(index, step.type, `❌ AI fix also failed: ${fixErr.message}`);
                            step.selector = origSelector;
                        }
                    } else {
                        stepLog(index, step.type, `🤖 AI could not fix: ${fix.reason || 'unknown'}`);
                    }
                } catch (aiErr) {
                    stepLog(index, step.type, `🤖 AI fix error: ${aiErr.message}`);
                }
            }

            if (onError === 'skip') {
                stepLog(index, step.type, 'Error handled: skip');
                return;
            }
            if (onError === 'abort') throw err;
        }
    }
}

(async () => {
    log(`Starting execution: ${script.name} (${steps.length} steps)`);

    // Resolve browser profile storage
    const profilesDir = execData.profiles_dir || '';
    let storageDir = '';
    let rawProxy = null;
    let pwProxy = undefined;
    let normalizedProxy = null;

    if (profile && profilesDir) {
        const profileDir = path.join(profilesDir, profile);
        if (fs.existsSync(profileDir)) {
            storageDir = profileDir;
            log(`Profile: ${profile} → ${storageDir}`);
            
            // Load proxy from config
            try {
                const configPath = path.join(storageDir, 'config.json');
                if (fs.existsSync(configPath)) {
                    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                    if (cfg.proxy) {
                        rawProxy = cfg.proxy;
                        log(`  Loaded proxy from config: ${rawProxy}`);
                        
                        // Normalize proxy (same logic as BrowserManager)
                        const simpleFormatRegex = /^(socks5|http|https):\/\/([^:@]+):([^:@]+):([^:@]+):(\d+)$/i;
                        const match = rawProxy.match(simpleFormatRegex);
                        if (match) {
                            normalizedProxy = `${match[1].toLowerCase()}://${match[2]}:${match[3]}@${match[4]}:${match[5]}`;
                        } else {
                            normalizedProxy = rawProxy;
                        }

                        // Parse for Playwright format
                        try {
                            const parsed = new URL(normalizedProxy.includes('://') ? normalizedProxy : `http://${normalizedProxy}`);
                            pwProxy = { server: `${parsed.protocol}//${parsed.hostname}:${parsed.port}` };
                            if (parsed.username) pwProxy.username = decodeURIComponent(parsed.username);
                            if (parsed.password) pwProxy.password = decodeURIComponent(parsed.password);
                        } catch (e) {
                            pwProxy = { server: normalizedProxy.includes('://') ? normalizedProxy : `http://${normalizedProxy}` };
                        }
                    }
                }
            } catch (e) {
                log(`  ⚠️ Failed to parse proxy from config: ${e.message}`);
            }

            // Check if profile has cookies
            const cookiePath = path.join(storageDir, 'Default', 'Network', 'Cookies');
            const loginPath = path.join(storageDir, 'Default', 'Login Data');
            if (fs.existsSync(cookiePath)) log(`  ✅ Cookies found (${Math.round(fs.statSync(cookiePath).size / 1024)}KB)`);
            else log('  ⚠️ No cookies file found in profile');
            if (fs.existsSync(loginPath)) log(`  ✅ Login Data found`);
        } else {
            log(`⚠️ Profile dir not found: ${profileDir}`);
        }
    }

    // Kill Chrome processes using THIS specific profile (safe: won't touch user's browser)
    if (storageDir && fs.existsSync(storageDir)) {
        try {
            const { execSync } = require('child_process');
            const escaped = storageDir.replace(/\\/g, '\\\\\\\\');
            const wmicOut = execSync(
                `wmic process where "name='chrome.exe' and CommandLine like '%${escaped}%'" get ProcessId /format:csv`,
                { encoding: 'utf-8', timeout: 5000 }
            ).trim();
            const pids = wmicOut.split('\n')
                .map(l => l.trim().split(',').pop())
                .filter(p => p && /^\d+$/.test(p));
            if (pids.length > 0) {
                log(`Closing ${pids.length} Chrome process(es) using profile "${profile}"...`);
                for (const pid of pids) {
                    try { execSync(`taskkill /PID ${pid} /F`, { timeout: 3000 }); } catch (e) {}
                }
                await sleep(1500);
            }
        } catch (e) { /* wmic may not be available */ }

        // Also clean lock files
        const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
        const dirs = [storageDir, path.join(storageDir, 'Default')];
        for (const dir of dirs) {
            for (const lf of [...lockFiles, 'LOCK', 'lockfile']) {
                try {
                    const p = path.join(dir, lf);
                    if (fs.existsSync(p)) fs.unlinkSync(p);
                } catch (e) {}
            }
        }
    }

    // ── Launch Browser ──
    const launchArgs = ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1280,900'];
    let context;

    if (engine === 'bablosoft') {
        log('Launching with Bablosoft engine (fingerprint)...');
        const originalCwd = process.cwd();
        try {
            const browserExtDir = path.resolve(__dirname, '..', '..', '..', '..', 'tubecli', 'extensions', 'browser');
            process.chdir(browserExtDir);

            const { createRequire } = require('module');
            const extRequire = createRequire(path.join(browserExtDir, 'package.json'));
            const { plugin } = extRequire('playwright-with-fingerprints');

            // ── 1. Service key (REQUIRED for fingerprint injection) ──
            try {
                const http = require('http');
                const keyData = await new Promise((resolve, reject) => {
                    http.get('http://api.tubecreate.com/api/fingerprints/key.php', { timeout: 10000 }, (res) => {
                        let d = '';
                        res.on('data', c => d += c);
                        res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
                    }).on('error', reject);
                });
                if (keyData && keyData.status === 'success' && keyData.key) {
                    plugin.setServiceKey(Buffer.from(keyData.key, 'base64').toString('utf8'));
                    log('  ✅ Service key set.');
                }
            } catch (keyErr) {
                log('  ⚠ Service key failed: ' + keyErr.message);
            }

            // Set generous timeout for BAS engine requests (premium fingerprints are ~8MB)
            plugin.setRequestTimeout(120000);

            // ── 2. Detect installed engine & hotfix project.xml ──
            const ENGINE_MAP = {
                '30.0.0': '147.0.7727.56',
                '29.9.2': '146.0.7680.80',
                '29.8.1': '145.0.7632.46',
                '29.7.0': '144.0.7559.60',
            };
            let targetBasVer = null;
            let targetChromiumVer = null;
            const scriptDir = path.join(browserExtDir, 'data', 'script');
            if (fs.existsSync(scriptDir)) {
                const dirs = fs.readdirSync(scriptDir)
                    .filter(d => /^\d+\.\d+\.\d+$/.test(d))
                    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
                for (const d of dirs) {
                    if (fs.existsSync(path.join(scriptDir, d, 'FastExecuteScript.exe'))) {
                        targetBasVer = d;
                        targetChromiumVer = ENGINE_MAP[d] || null;
                        break;
                    }
                }
            }
            if (targetBasVer) {
                log(`  Engine: ${targetBasVer} (Chrome ${targetChromiumVer || '?'})`);
                if (targetChromiumVer) {
                    try {
                        plugin.useBrowserVersion(targetChromiumVer);
                    } catch (verErr) {
                        log(`  ⚠ plugin.useBrowserVersion failed: ${verErr.message.split('\n')[0]}. Proceeding anyway.`);
                    }
                }
                // Hotfix project.xml
                const projectXml = path.join(browserExtDir, 'node_modules', 'browser-with-fingerprints', 'project.xml');
                if (fs.existsSync(projectXml)) {
                    let xml = fs.readFileSync(projectXml, 'utf8');
                    xml = xml.replace(/<EngineVersion>.*?<\/EngineVersion>/, `<EngineVersion>${targetBasVer}</EngineVersion>`);
                    fs.writeFileSync(projectXml, xml, 'utf8');
                    log('  ✅ project.xml hotfixed.');
                }
            }

            // ── 3. Load fingerprint ──
            const fingerprintPath = path.join(storageDir, 'fingerprint.json');
            let fpData;
            if (fs.existsSync(fingerprintPath)) {
                // IMPORTANT: keep as raw string — plugin.useFingerprint requires typeof === 'string'
                fpData = fs.readFileSync(fingerprintPath, 'utf-8');
                log('  Loaded saved fingerprint.');
            } else {
                log('  No fingerprint. Fetching new...');
                // Build fetch options matching engine configuration
                const fetchOpts = {
                    tags: ['Microsoft Windows', 'Chrome'],
                    minWidth: 1280,
                    minHeight: 900,
                };
                // Set minBrowserVersion to match installed engine's Chromium major version
                if (targetChromiumVer) {
                    const majorVer = parseInt(targetChromiumVer.split('.')[0], 10);
                    if (majorVer > 0) {
                        fetchOpts.minBrowserVersion = majorVer;
                        log(`  Fingerprint filter: Chrome >= ${majorVer}, screen >= 1280x900`);
                    }
                }
                fpData = await plugin.fetch(fetchOpts);
                fs.mkdirSync(storageDir, { recursive: true });
                // fpData from plugin.fetch is already a string
                fs.writeFileSync(fingerprintPath, typeof fpData === 'string' ? fpData : JSON.stringify(fpData));
            }

            // Apply fingerprint — must be a string
            plugin.useFingerprint(typeof fpData === 'string' ? fpData : JSON.stringify(fpData));


            // ── 5. Launch ──
            // Use a separate profile dir for Bablosoft to prevent Playwright lock/corruption timeouts
            const launchPath = (storageDir || path.join(execData.profiles_dir || '', profile)) + '_bas';
            
            // Clean lock files in BOTH the original and _bas profile directories
            for (const dir of [storageDir, launchPath]) {
                for (const lf of ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'LOCK', 'lockfile']) {
                    try { fs.unlinkSync(path.join(dir, lf)); } catch (e) {}
                    try { fs.unlinkSync(path.join(dir, 'Default', lf)); } catch (e) {}
                }
            }

            if (normalizedProxy) {
                plugin.useProxy(normalizedProxy, { changeTimezone: true, changeGeolocation: true });
                log(`  ✅ Bablosoft proxy applied: ${normalizedProxy}`);
            } else {
                plugin.proxy = null;
            }

            context = await plugin.launchPersistentContext(launchPath, {
                headless,
                args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
                timeout: 120000
            });
            log('✅ Bablosoft browser launched with fingerprint.');
            process.chdir(originalCwd);
        } catch (basErr) {
            process.chdir(originalCwd);
            log('Bablosoft failed: ' + String(basErr.message).split('\n')[0] + '. Falling back to Playwright...');
            try {
                for (const lf of ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'LOCK', 'lockfile']) {
                    try { fs.unlinkSync(path.join(storageDir, lf)); } catch (e) {}
                    try { fs.unlinkSync(path.join(storageDir, 'Default', lf)); } catch (e) {}
                }
                const ctxOpts = {
                    headless, args: launchArgs,
                    ignoreDefaultArgs: ['--enable-automation'], viewport: { width: 1280, height: 800 }
                };
                if (pwProxy) ctxOpts.proxy = pwProxy;
                context = await chromium.launchPersistentContext(storageDir, ctxOpts);
            } catch (e2) {
                log('Profile also failed. Using fresh browser + cookies...');
                const brOpts = { headless, args: launchArgs, ignoreDefaultArgs: ['--enable-automation'] };
                if (pwProxy) brOpts.proxy = pwProxy;
                const browser = await chromium.launch(brOpts);
                context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
                const cookieFile = path.join(storageDir, 'cookies.json');
                if (fs.existsSync(cookieFile)) {
                    try {
                        const cookies = JSON.parse(fs.readFileSync(cookieFile, 'utf-8'));
                        const cleaned = cookies.filter(c => c.name && c.domain).map(c => {
                            const cc = { ...c };
                            if (!['Strict', 'Lax', 'None'].includes(cc.sameSite)) cc.sameSite = 'Lax';
                            return cc;
                        });
                        await context.addCookies(cleaned);
                        log('  Injected ' + cleaned.length + ' cookies.');
                    } catch (ce) {}
                }
            }
        }
    } else {
    // ── Playwright: use bundled Chromium (NOT system Chrome) for profile compatibility ──
    log(headless ? 'Launching (Playwright headless)...' : 'Launching (Playwright)...');
    if (storageDir) {
        for (const lf of ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'LOCK', 'lockfile']) {
            try { fs.unlinkSync(path.join(storageDir, lf)); } catch (e) {}
            try { fs.unlinkSync(path.join(storageDir, 'Default', lf)); } catch (e) {}
        }
        try {
            const ctxOpts = {
                headless, args: launchArgs,
                ignoreDefaultArgs: ['--enable-automation'],
                viewport: { width: 1280, height: 800 }
            };
            if (pwProxy) ctxOpts.proxy = pwProxy;
            context = await chromium.launchPersistentContext(storageDir, ctxOpts);
            log('Profile loaded with Playwright Chromium.');
        } catch (e) {
            log('PersistentContext failed: ' + String(e.message).split('\n')[0]);
            log('Falling back to fresh browser + cookie injection...');
            const brOpts = { headless, args: launchArgs, ignoreDefaultArgs: ['--enable-automation'] };
            if (pwProxy) brOpts.proxy = pwProxy;
            const browser = await chromium.launch(brOpts);
            context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
            const cookieFile = path.join(storageDir, 'cookies.json');
            if (fs.existsSync(cookieFile)) {
                try {
                    const cookies = JSON.parse(fs.readFileSync(cookieFile, 'utf-8'));
                    if (Array.isArray(cookies) && cookies.length > 0) {
                        const cleaned = cookies.map(c => {
                            const cc = { ...c };
                            if (!['Strict', 'Lax', 'None'].includes(cc.sameSite)) cc.sameSite = 'Lax';
                            return cc;
                        });
                        await context.addCookies(cleaned);
                        log('  Injected ' + cleaned.length + ' cookies from profile.');
                    }
                } catch (ce) { log('  Cookie load failed: ' + ce.message); }
            }
        }
    } else {
        const browser = await chromium.launch({ headless, args: launchArgs, ignoreDefaultArgs: ['--enable-automation'] });
        context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    }
    }
    const page = context.pages()[0] || await context.newPage();
    log('Browser launched.');

    // ── CDP WebSocket Preview: start BEFORE execution so frontend sees it live ──
    const http = require('http');
    const net = require('net');
    const { WebSocketServer } = require('ws');

    const tmpSrv = net.createServer();
    const previewPort = await new Promise(r => { tmpSrv.listen(0, () => { const p = tmpSrv.address().port; tmpSrv.close(() => r(p)); }); });

    let cdp;
    try {
        cdp = await page.context().newCDPSession(page);
    } catch (e) {
        log(`CDP session failed: ${e.message}`);
    }

    const httpServer = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (req.url === '/status') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'open', profile, ws: true }));
        } else if (req.url.startsWith('/screenshot')) {
            page.screenshot({ type: 'jpeg', quality: 60 }).then(buf => {
                res.writeHead(200, { 'Content-Type': 'image/jpeg' });
                res.end(buf);
            }).catch(() => { res.writeHead(500); res.end(); });
        } else { res.writeHead(404); res.end(); }
    });

    const wss = new WebSocketServer({ server: httpServer });
    let activeClients = new Set();

    // Broadcast current URL to all connected clients
    function broadcastUrl() {
        const url = page.url();
        const msg = JSON.stringify({ type: 'url_changed', url });
        for (const c of activeClients) {
            if (c.readyState === 1) c.send(msg);
        }
    }

    // Listen for page navigations and broadcast URL changes
    page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) broadcastUrl();
    });

    wss.on('connection', (ws) => {
        activeClients.add(ws);
        log('Preview client connected (WebSocket)');
        // Send current URL immediately on connect
        ws.send(JSON.stringify({ type: 'url_changed', url: page.url() }));

        if (cdp) {
            cdp.send('Page.startScreencast', {
                format: 'jpeg', quality: 50, maxWidth: 1280, maxHeight: 900,
                everyNthFrame: 2,
            }).catch(() => {});
        }

        ws.on('message', async (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.type === 'mouse') {
                    const { action, x, y, button } = msg;
                    if (action === 'move') await page.mouse.move(x, y);
                    else if (action === 'click') await page.mouse.click(x, y, { button: button || 'left' });
                    else if (action === 'down') await page.mouse.down();
                    else if (action === 'up') await page.mouse.up();
                } else if (msg.type === 'keyboard') {
                    if (msg.action === 'type') await page.keyboard.type(msg.text);
                    else if (msg.action === 'press') await page.keyboard.press(msg.key);
                } else if (msg.type === 'scroll') {
                    await page.mouse.wheel(msg.deltaX || 0, msg.deltaY || 0);
                } else if (msg.type === 'pick_element') {
                    const selector = await page.evaluate(({ x, y }) => {
                        const el = document.elementFromPoint(x, y);
                        if (!el) return null;
                        if (el.id) return `#${el.id}`;
                        if (el.name) return `${el.tagName.toLowerCase()}[name="${el.name}"]`;
                        if (el.getAttribute('aria-label')) return `[aria-label="${el.getAttribute('aria-label')}"]`;
                        if (el.placeholder) return `[placeholder="${el.placeholder}"]`;
                        if (el.className && typeof el.className === 'string') {
                            const cls = el.className.trim().split(/\s+/)[0];
                            if (cls) return `${el.tagName.toLowerCase()}.${cls}`;
                        }
                        const path = [];
                        let node = el;
                        while (node && node !== document.body) {
                            let seg = node.tagName.toLowerCase();
                            if (node.id) { path.unshift(`#${node.id}`); break; }
                            const parent = node.parentElement;
                            if (parent) {
                                const siblings = Array.from(parent.children).filter(c => c.tagName === node.tagName);
                                if (siblings.length > 1) seg += `:nth-child(${Array.from(parent.children).indexOf(node) + 1})`;
                            }
                            path.unshift(seg);
                            node = node.parentElement;
                        }
                        return path.join(' > ');
                    }, { x: msg.x, y: msg.y });
                    ws.send(JSON.stringify({ type: 'picked', selector }));
                } else if (msg.type === 'hover_inspect') {
                    const info = await page.evaluate(({ x, y }) => {
                        const el = document.elementFromPoint(x, y);
                        if (!el) return null;
                        const rect = el.getBoundingClientRect();
                        return {
                            tag: el.tagName.toLowerCase(),
                            id: el.id || '',
                            classes: el.className?.toString?.()?.slice(0, 60) || '',
                            text: el.innerText?.slice(0, 40) || '',
                            rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
                        };
                    }, { x: msg.x, y: msg.y }).catch(() => null);
                    if (info) ws.send(JSON.stringify({ type: 'inspect', ...info }));
                } else if (msg.type === 'navigate') {
                    // Navigate to URL
                    try {
                        await page.goto(msg.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                        broadcastUrl();
                    } catch (e) {}
                } else if (msg.type === 'nav') {
                    // Back / Forward / Reload
                    try {
                        if (msg.action === 'back') await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 });
                        else if (msg.action === 'forward') await page.goForward({ waitUntil: 'domcontentloaded', timeout: 10000 });
                        else if (msg.action === 'reload') await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
                        broadcastUrl();
                    } catch (e) {}
                }
            } catch (e) {}
        });

        ws.on('close', () => {
            activeClients.delete(ws);
            if (activeClients.size === 0 && cdp) {
                cdp.send('Page.stopScreencast').catch(() => {});
            }
        });
    });

    if (cdp) {
        cdp.on('Page.screencastFrame', (params) => {
            const vp = page.viewportSize() || { width: 1280, height: 900 };
            const frame = { type: 'frame', data: params.data, metadata: params.metadata, viewport: vp };
            const msg = JSON.stringify(frame);
            for (const ws of activeClients) {
                if (ws.readyState === 1) ws.send(msg);
            }
            cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {});
        });
    }

    // Start WS server BEFORE executing steps — emit preview_port immediately
    await new Promise(r => httpServer.listen(previewPort, r));
    console.log(JSON.stringify({
        status: 'log', exec_id,
        preview_port: previewPort,
        preview_ws: true,
        message: `Live preview ready on port ${previewPort}`,
        time: new Date().toISOString(),
    }));

    // ── Pause/resume support ──
    let paused = false;
    let stopped = false;

    function waitIfPaused() {
        return new Promise(resolve => {
            const check = () => {
                if (stopped) return resolve();
                if (!paused) return resolve();
                setTimeout(check, 500);
            };
            check();
        });
    }

    // Listen for pause/resume/stop from WS clients
    wss.on('connection', (ws2) => {
        ws2.on('message', (raw) => {
            try {
                const m = JSON.parse(raw.toString());
                if (m.type === 'pause') { paused = true; log('⏸ Script paused.'); }
                else if (m.type === 'resume') { paused = false; log('▶ Script resumed.'); }
                else if (m.type === 'stop_script') { stopped = true; paused = false; log('⏹ Script stop requested.'); }
            } catch (e) {}
        });
    });

    // ── Now execute steps (frontend is already connected and watching) ──
    let success = false;
    try {
        for (let i = 0; i < steps.length; i++) {
            await waitIfPaused();
            if (stopped) { log('Script stopped by user.'); break; }
            await executeStepWithRetry(page, steps[i], i);
        }
        log('All steps completed successfully.');
        success = true;
    } catch (err) {
        log(`Execution failed: ${err.message}`);
        process.exitCode = 1;
    }

    // Save cookies back to profile (for Playwright mode)
    if (storageDir && engine !== 'bablosoft') {
        try {
            const updatedCookies = await context.cookies();
            if (updatedCookies.length > 0) {
                fs.writeFileSync(path.join(storageDir, 'cookies.json'), JSON.stringify(updatedCookies, null, 2));
                log(`Saved ${updatedCookies.length} cookies back to profile.`);
            }
        } catch (e) {}
    }

    // Signal completion
    console.log(JSON.stringify({
        status: 'done', exec_id, success,
        preview_port: previewPort,
        preview_ws: true,
        message: success ? 'Completed! Browser kept open for preview.' : 'Failed. Browser kept open for inspection.'
    }));

    // Close when browser is closed by user
    context.on('close', () => { httpServer.close(); process.exit(0); });

    process.on('SIGTERM', async () => {
        try { if (cdp) cdp.send('Page.stopScreencast').catch(() => {}); httpServer.close(); await context.close(); } catch (e) {}
        process.exit(0);
    });
})();
/* Flower Panel Studio diagnostics — no dependencies, safe on mobile browsers. */
(function (root) {
  'use strict';
  const MAX_LOGS = 300;
  const logs = [];
  let panelOpen = false;
  let renderQueued = false;
  const startedAt = Date.now();

  function safeString(value) {
    try {
      if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
      if (typeof value === 'string') return value;
      return JSON.stringify(value, (key, val) => {
        if (val instanceof Error) return { name: val.name, message: val.message, stack: val.stack };
        if (typeof val === 'bigint') return String(val);
        return val;
      });
    } catch (_) { return String(value); }
  }
  function log(level, message, details) {
    const entry = {
      time: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
      level: String(level || 'info').toUpperCase(),
      message: String(message || ''),
      details: details === undefined ? '' : safeString(details)
    };
    logs.push(entry);
    if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
    const method = entry.level === 'ERROR' ? 'error' : entry.level === 'WARN' ? 'warn' : 'log';
    try { console[method](`[FlowerStudio ${entry.level}] ${entry.message}`, details === undefined ? '' : details); } catch (_) {}
    scheduleRender();
    return entry;
  }
  function exception(context, error) {
    const detail = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error;
    return log('ERROR', context, detail);
  }
  function snapshot() {
    return {
      generatedAt: new Date().toISOString(),
      userAgent: root.navigator ? root.navigator.userAgent : 'unknown',
      online: root.navigator && 'onLine' in root.navigator ? root.navigator.onLine : null,
      viewport: { width: root.innerWidth || null, height: root.innerHeight || null, pixelRatio: root.devicePixelRatio || 1 },
      threeVersion: root.THREE && root.THREE.REVISION ? root.THREE.REVISION : null,
      webgl: webglAvailable(),
      logs: logs.slice()
    };
  }
  function webglAvailable() {
    try {
      const canvas = document.createElement('canvas');
      return !!(root.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
    } catch (_) { return false; }
  }
  function format() {
    const info = snapshot();
    const head = [
      'Flower Panel Studio diagnostic report',
      `Generated: ${info.generatedAt}`,
      `Browser: ${info.userAgent}`,
      `Online: ${info.online}`,
      `Viewport: ${info.viewport.width}x${info.viewport.height} @${info.viewport.pixelRatio}x`,
      `Three.js revision: ${info.threeVersion || 'not loaded'}`,
      `WebGL available: ${info.webgl}`,
      '--- Logs ---'
    ];
    return head.concat(info.logs.map(e => `${e.time} +${e.elapsedMs}ms [${e.level}] ${e.message}${e.details ? '\n  ' + e.details : ''}`)).join('\n');
  }
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    const run = () => { renderQueued = false; renderPanel(); };
    if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(run);
    else setTimeout(run, 0);
  }
  function renderPanel() {
    if (typeof document === 'undefined') return;
    const output = document.getElementById('diagnosticsOutput');
    const badge = document.getElementById('diagnosticsBadge');
    const summary = document.getElementById('diagnosticsSummary');
    if (badge) badge.textContent = `${logs.length} logs`;
    if (summary) {
      const errors = logs.filter(x => x.level === 'ERROR').length;
      const warnings = logs.filter(x => x.level === 'WARN').length;
      summary.textContent = `${errors} errors · ${warnings} warnings · ${root.THREE ? 'Three.js loaded' : 'Three.js not detected'}`;
    }
    if (output && panelOpen) output.textContent = logs.length ? logs.slice(-120).map(e => `${e.time.slice(11, 23)} [${e.level}] ${e.message}${e.details ? '\n  ' + e.details : ''}`).join('\n') : 'No logs yet.';
  }
  function bindUI() {
    if (typeof document === 'undefined') return;
    const toggle = document.getElementById('diagnosticsToggle');
    const panel = document.getElementById('diagnosticsPanel');
    if (toggle && panel && !toggle.dataset.diagnosticsBound) {
      toggle.dataset.diagnosticsBound = 'true';
      toggle.addEventListener('click', () => {
        panelOpen = panel.hidden;
        panel.hidden = !panelOpen;
        toggle.setAttribute('aria-expanded', String(panelOpen));
        toggle.textContent = panelOpen ? 'Hide diagnostics' : 'Show diagnostics';
        renderPanel();
        log('INFO', `Diagnostics panel ${panelOpen ? 'opened' : 'closed'}`);
      });
    }
    const clear = document.getElementById('clearDiagnostics');
    if (clear && !clear.dataset.diagnosticsBound) {
      clear.dataset.diagnosticsBound = 'true';
      clear.addEventListener('click', () => { logs.length = 0; log('INFO', 'Log cleared by user'); renderPanel(); });
    }
    const copy = document.getElementById('copyDiagnostics');
    if (copy && !copy.dataset.diagnosticsBound) {
      copy.dataset.diagnosticsBound = 'true';
      copy.addEventListener('click', async () => {
        try {
          if (root.navigator.clipboard && root.navigator.clipboard.writeText) await root.navigator.clipboard.writeText(format());
          else {
            const box = document.createElement('textarea'); box.value = format(); box.style.position = 'fixed'; box.style.opacity = '0'; document.body.appendChild(box); box.select();
            const ok = document.execCommand('copy'); box.remove(); if (!ok) throw new Error('Clipboard permission unavailable');
          }
          log('INFO', 'Diagnostic report copied to clipboard');
        } catch (e) {
          exception('Could not copy diagnostics; use Download log instead', e);
          // Non-blocking notice instead of a modal alert (alert() stalls mobile browsers).
          copy.textContent = 'Copy failed';
          setTimeout(() => { copy.textContent = 'Copy logs'; }, 2500);
        }
      });
    }
    const download = document.getElementById('downloadDiagnostics');
    if (download && !download.dataset.diagnosticsBound) {
      download.dataset.diagnosticsBound = 'true';
      download.addEventListener('click', () => {
        try {
          const blob = new Blob([format()], { type: 'text/plain;charset=utf-8' });
          const url = URL.createObjectURL(blob); const a = document.createElement('a');
          a.href = url; a.download = `flower-panel-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
          document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1200);
          log('INFO', 'Diagnostic report downloaded');
        } catch (e) { exception('Could not download diagnostics', e); }
      });
    }
    renderPanel();
  }

  if (typeof root.addEventListener === 'function') {
    root.addEventListener('error', event => {
      // Capture-phase listener also sees failed script/style/image resources.
      if (event.target && event.target !== root && (event.target.src || event.target.href)) {
        log('ERROR', 'Resource failed to load', {
          tag: event.target.tagName || 'resource',
          url: event.target.src || event.target.href,
          online: root.navigator ? root.navigator.onLine : null
        });
        return;
      }
      const detail = { message: event.message, file: event.filename, line: event.lineno, column: event.colno, stack: event.error && event.error.stack };
      log('ERROR', 'Uncaught browser error', detail);
    }, true);
    root.addEventListener('unhandledrejection', event => exception('Unhandled promise rejection', event.reason));
    root.addEventListener('online', () => log('INFO', 'Browser reports network online'));
    root.addEventListener('offline', () => log('WARN', 'Browser reports network offline'));
    root.addEventListener('DOMContentLoaded', bindUI, { once: true });
  }
  if (typeof document !== 'undefined' && document.readyState !== 'loading') bindUI();

  const api = { log, warn: (m, d) => log('WARN', m, d), error: (m, e) => exception(m, e), snapshot, format, getLogs: () => logs.slice(), clear: () => { logs.length = 0; renderPanel(); } };
  root.FlowerDiagnostics = api;
  log('INFO', 'Diagnostics module loaded', { maxLogs: MAX_LOGS });
})(typeof globalThis !== 'undefined' ? globalThis : this);

/**
 * Copyright 2026 Esri
 *
 * Licensed under the Apache License Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

(function () {
  const TOOLTIP_SELECTOR = '[data-tooltip], [title]';
  const IGNORED_TAGS = new Set(['HTML', 'HEAD', 'TITLE', 'META', 'LINK', 'SCRIPT', 'STYLE']);
  let tooltipEl;
  let iconEl;
  let textEl;
  let activeTarget;
  let showTimer;
  let hideTimer;

  function ensureTooltipStyles() {
    if (document.getElementById('custom-tooltip-base-style')) return;
    const style = document.createElement('style');
    style.id = 'custom-tooltip-base-style';
    style.textContent = `
.custom-tooltip{position:fixed;z-index:10000;display:inline-flex;align-items:flex-start;gap:8px;max-width:min(360px,calc(100vw - 20px));padding:8px 10px;border:1px solid var(--custom-tooltip-border,var(--border-color,#404040));border-left:3px solid var(--custom-tooltip-accent,var(--button-info-bg,var(--accent-color,#17a2b8)));border-radius:6px;background:var(--custom-tooltip-bg,var(--surface-color,var(--bg-secondary,var(--status-bg,#2d2d2d))));color:var(--custom-tooltip-text,var(--text-color,var(--text-primary,#d4d4d4)));box-shadow:0 8px 24px rgba(0,0,0,.32);font-family:var(--font-family,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif);font-size:12px;line-height:1.35;pointer-events:none;opacity:0;transform:translateY(4px) scale(.98);transition:opacity .12s ease,transform .12s ease;white-space:pre-line}.custom-tooltip.visible{opacity:1;transform:translateY(0) scale(1)}.custom-tooltip-icon{flex:0 0 auto;color:var(--custom-tooltip-accent,var(--button-info-bg,var(--accent-color,#17a2b8)));font-size:14px;line-height:1.2}.custom-tooltip-text{min-width:0;overflow-wrap:anywhere}.custom-tooltip-info{--custom-tooltip-accent:var(--button-info-bg,var(--accent-color,#17a2b8))}.custom-tooltip-auth{--custom-tooltip-accent:#14b8a6}.custom-tooltip-secure{--custom-tooltip-accent:#38bdf8}.custom-tooltip-success{--custom-tooltip-accent:var(--button-success-bg,var(--success-color,#28a745))}.custom-tooltip-warning{--custom-tooltip-accent:var(--button-warning-bg,#ffc107)}.custom-tooltip-error{--custom-tooltip-accent:var(--button-danger-bg,var(--error-color,#dc3545))}`;
    document.head.appendChild(style);
  }

  function normalizeTooltipText(value) {
    return String(value || '')
      .replace(/&#10;/g, '\n')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim();
  }

  function inferTooltipIcon(text, target) {
    const explicit = target.getAttribute('data-tooltip-icon');
    if (explicit) return explicit;
    const id = target.id || '';
    const lower = `${id} ${text}`.toLowerCase();
    if (lower.includes('velocity') || lower.includes('sign in') || lower.includes('token') || lower.includes('auth')) return '🔑';
    if (lower.includes('save')) return '💾';
    if (lower.includes('clear') || lower.includes('delete')) return '🧹';
    if (lower.includes('refresh')) return '↻';
    if (lower.includes('close') || lower.includes('disconnect') || lower.includes('error')) return '✕';
    if (lower.includes('connect')) return '🔌';
    if (lower.includes('tls') || lower.includes('certificate') || lower.includes('secure')) return '🔒';
    if (lower.includes('warning') || lower.includes('unsupported') || lower.includes('cannot')) return '⚠';
    if (lower.includes('camera')) return '📷';
    if (lower.includes('microphone') || lower.includes('speech')) return '🎙';
    if (lower.includes('theme')) return '🎨';
    if (lower.includes('command line') || lower.includes('cli')) return '⌘';
    if (lower.includes('filter') || lower.includes('format') || lower.includes('mode') || lower.includes('type')) return '⌄';
    return 'ⓘ';
  }

  function inferTooltipKind(text, target) {
    const explicit = target.getAttribute('data-tooltip-kind');
    if (explicit) return explicit;
    const lower = text.toLowerCase();
    if (lower.includes('error') || lower.includes('cannot') || lower.includes('failed')) return 'error';
    if (lower.includes('warning') || lower.includes('unsupported') || lower.includes('self-signed')) return 'warning';
    if (lower.includes('connected') || lower.includes('success') || lower.includes('apply')) return 'success';
    if (lower.includes('tls') || lower.includes('certificate') || lower.includes('secure')) return 'secure';
    if (lower.includes('velocity') || lower.includes('token') || lower.includes('auth') || lower.includes('sign in')) return 'auth';
    return 'info';
  }

  function ensureTooltipElement() {
    if (tooltipEl) return;
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'custom-tooltip';
    tooltipEl.setAttribute('role', 'tooltip');
    tooltipEl.setAttribute('aria-hidden', 'true');
    iconEl = document.createElement('span');
    iconEl.className = 'custom-tooltip-icon';
    textEl = document.createElement('span');
    textEl.className = 'custom-tooltip-text';
    tooltipEl.append(iconEl, textEl);
    document.body.appendChild(tooltipEl);
  }

  function migrateTitle(target, force = false) {
    if (!target || IGNORED_TAGS.has(target.tagName)) return;
    const title = target.getAttribute('title');
    if (!title) return;
    if (force || !target.getAttribute('data-tooltip')) {
      target.setAttribute('data-tooltip', title);
    }
    if (!target.getAttribute('aria-label')) {
      target.setAttribute('aria-label', normalizeTooltipText(title).replace(/\n+/g, ' '));
    }
    target.removeAttribute('title');
  }

  function accessibleTextFor(target) {
    const aria = target.getAttribute('aria-label');
    if (aria) return aria;
    const placeholder = target.getAttribute('placeholder');
    if (placeholder) return placeholder;
    const id = target.id;
    if (id) {
      const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (label && label.textContent.trim()) return label.textContent.trim();
    }
    if (target.tagName === 'LABEL' && target.textContent.trim()) return target.textContent.trim();
    if (target.textContent && target.textContent.trim()) return target.textContent.trim();
    return '';
  }

  function ensureTooltipFallback(target) {
    if (!target || IGNORED_TAGS.has(target.tagName) || target.getAttribute('data-tooltip') || target.getAttribute('title')) return;
    if (!target.matches('button, input, select, textarea, label')) return;
    const text = accessibleTextFor(target);
    if (!text) return;
    target.setAttribute('data-tooltip', text);
    if (!target.getAttribute('aria-label') && target.tagName !== 'LABEL') {
      target.setAttribute('aria-label', text.replace(/\n+/g, ' '));
    }
  }

  function migrateAllTitles(root = document) {
    root.querySelectorAll('[title]').forEach(migrateTitle);
    root.querySelectorAll('button, input, select, textarea, label').forEach(ensureTooltipFallback);
  }

  function getTooltipTarget(node) {
    const target = node && node.closest ? node.closest(TOOLTIP_SELECTOR) : null;
    if (!target || IGNORED_TAGS.has(target.tagName)) return null;
    migrateTitle(target);
    return normalizeTooltipText(target.getAttribute('data-tooltip')) ? target : null;
  }

  function setTooltipContent(target) {
    const text = normalizeTooltipText(target.getAttribute('data-tooltip'));
    const icon = inferTooltipIcon(text, target);
    const kind = inferTooltipKind(text, target);
    tooltipEl.className = `custom-tooltip custom-tooltip-${kind}`;
    iconEl.textContent = icon;
    textEl.textContent = text;
    target.setAttribute('aria-describedby', 'custom-tooltip');
    tooltipEl.id = 'custom-tooltip';
  }

  function positionTooltip(target) {
    const rect = target.getBoundingClientRect();
    const tipRect = tooltipEl.getBoundingClientRect();
    const margin = 10;
    let top = rect.top - tipRect.height - margin;
    if (top < margin) top = rect.bottom + margin;
    let left = rect.left + (rect.width / 2) - (tipRect.width / 2);
    left = Math.max(margin, Math.min(left, window.innerWidth - tipRect.width - margin));
    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
  }

  function showTooltip(target) {
    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    ensureTooltipElement();
    activeTarget = target;
    showTimer = setTimeout(() => {
      if (!activeTarget) return;
      setTooltipContent(activeTarget);
      tooltipEl.classList.add('visible');
      tooltipEl.setAttribute('aria-hidden', 'false');
      positionTooltip(activeTarget);
    }, 240);
  }

  function hideTooltip() {
    clearTimeout(showTimer);
    hideTimer = setTimeout(() => {
      if (activeTarget) activeTarget.removeAttribute('aria-describedby');
      activeTarget = null;
      if (tooltipEl) {
        tooltipEl.classList.remove('visible');
        tooltipEl.setAttribute('aria-hidden', 'true');
      }
    }, 80);
  }

  function initCustomTooltips() {
    ensureTooltipStyles();
    migrateAllTitles();
    ensureTooltipElement();

    document.addEventListener('mouseover', (event) => {
      const target = getTooltipTarget(event.target);
      if (target) showTooltip(target);
    });

    document.addEventListener('mouseout', (event) => {
      if (activeTarget && !activeTarget.contains(event.relatedTarget)) hideTooltip();
    });

    document.addEventListener('focusin', (event) => {
      const target = getTooltipTarget(event.target);
      if (target) showTooltip(target);
    });

    document.addEventListener('focusout', hideTooltip);
    window.addEventListener('scroll', hideTooltip, true);
    window.addEventListener('resize', hideTooltip);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'title') {
          migrateTitle(mutation.target, true);
        } else if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            migrateTitle(node);
            if (node.querySelectorAll) migrateAllTitles(node);
          });
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['title'] });
  }

  window.initCustomTooltips = initCustomTooltips;
  window.addEventListener('DOMContentLoaded', initCustomTooltips, { once: true });
})();


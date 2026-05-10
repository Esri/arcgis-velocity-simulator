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
  let copyButtonEl;
  let activeTarget;
  let showTimer;
  let hideTimer;
  let activeTooltipText = '';
  let nativeTitleSuppressorInstalled = false;
  let originalSetAttribute;
  let originalRemoveAttribute;

  function ensureTooltipStyles() {
    if (document.getElementById('custom-tooltip-base-style')) return;
    const style = document.createElement('style');
    style.id = 'custom-tooltip-base-style';
    style.textContent = `
.custom-tooltip{position:fixed;z-index:10000;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:start;gap:9px;max-width:min(460px,calc(100vw - 20px));padding:10px 11px;border:1px solid var(--custom-tooltip-border,var(--border-color,#404040));border-left:4px solid var(--custom-tooltip-accent,var(--button-info-bg,var(--accent-color,#17a2b8)));border-radius:9px;background:color-mix(in srgb,var(--custom-tooltip-bg,var(--surface-color,var(--bg-secondary,var(--status-bg,#2d2d2d)))) 94%,#000 6%);color:var(--custom-tooltip-text,var(--text-color,var(--text-primary,#d4d4d4)));box-shadow:0 12px 32px rgba(0,0,0,.38),0 2px 8px rgba(0,0,0,.25);font-family:var(--font-family,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif);font-size:12px;line-height:1.42;pointer-events:none;opacity:0;transform:translateY(4px) scale(.98);transition:opacity .14s ease,transform .14s ease;user-select:text}.custom-tooltip.visible{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}.custom-tooltip-icon{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:999px;background:color-mix(in srgb,var(--custom-tooltip-accent,var(--button-info-bg,var(--accent-color,#17a2b8))) 16%,transparent);color:var(--custom-tooltip-accent,var(--button-info-bg,var(--accent-color,#17a2b8)));font-size:13px;line-height:1.2}.custom-tooltip-text{min-width:0;display:flex;flex-direction:column;gap:4px;overflow-wrap:anywhere;white-space:normal}.custom-tooltip-title{font-weight:700;color:var(--text-primary,var(--text-color,#f3f4f6));letter-spacing:.01em}.custom-tooltip-line{color:var(--text-color,var(--text-primary,#d4d4d4))}.custom-tooltip-row{display:grid;grid-template-columns:minmax(88px,max-content) minmax(0,1fr);column-gap:8px;align-items:start}.custom-tooltip-label{color:color-mix(in srgb,var(--custom-tooltip-accent,var(--accent-color,#17a2b8)) 72%,var(--text-color,#d4d4d4));font-weight:650}.custom-tooltip-value{min-width:0}.custom-tooltip-bullet{position:relative;padding-left:13px}.custom-tooltip-bullet::before{content:'•';position:absolute;left:2px;color:var(--custom-tooltip-accent,var(--accent-color,#17a2b8));font-weight:700}.custom-tooltip-separator{height:1px;margin:3px 0;background:color-mix(in srgb,var(--custom-tooltip-accent,var(--accent-color,#17a2b8)) 32%,transparent)}.custom-tooltip-copy{appearance:none;border:1px solid color-mix(in srgb,var(--custom-tooltip-accent,var(--accent-color,#17a2b8)) 36%,transparent);border-radius:6px;background:color-mix(in srgb,var(--custom-tooltip-accent,var(--accent-color,#17a2b8)) 12%,transparent);color:var(--text-color,var(--text-primary,#d4d4d4));cursor:pointer;font-size:11px;line-height:1;padding:4px 5px;opacity:.72;transition:opacity .12s ease,background-color .12s ease,border-color .12s ease}.custom-tooltip-copy:hover,.custom-tooltip-copy:focus{opacity:1;outline:none;background:color-mix(in srgb,var(--custom-tooltip-accent,var(--accent-color,#17a2b8)) 20%,transparent);border-color:color-mix(in srgb,var(--custom-tooltip-accent,var(--accent-color,#17a2b8)) 58%,transparent)}.custom-tooltip-copy.copied{--custom-tooltip-accent:var(--button-success-bg,var(--success-color,#28a745));opacity:1}.custom-tooltip-info{--custom-tooltip-accent:var(--button-info-bg,var(--accent-color,#17a2b8))}.custom-tooltip-auth{--custom-tooltip-accent:#14b8a6}.custom-tooltip-secure{--custom-tooltip-accent:#38bdf8}.custom-tooltip-success{--custom-tooltip-accent:var(--button-success-bg,var(--success-color,#28a745))}.custom-tooltip-warning{--custom-tooltip-accent:var(--button-warning-bg,#ffc107)}.custom-tooltip-error{--custom-tooltip-accent:var(--button-danger-bg,var(--error-color,#dc3545))}`;
    document.head.appendChild(style);
  }

  function normalizeTooltipText(value) {
    return String(value || '')
      .replace(/&#10;/g, '\n')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim();
  }

  function setCustomTooltipFromTitle(target, title, force = false) {
    if (!target || IGNORED_TAGS.has(target.tagName)) return;
    const text = normalizeTooltipText(title);
    if (!text) {
      if (force && originalRemoveAttribute) originalRemoveAttribute.call(target, 'data-tooltip');
      if (originalRemoveAttribute) originalRemoveAttribute.call(target, 'title');
      return;
    }
    if (force || !target.getAttribute('data-tooltip')) {
      (originalSetAttribute || Element.prototype.setAttribute).call(target, 'data-tooltip', title);
    }
    if (!target.getAttribute('aria-label')) {
      (originalSetAttribute || Element.prototype.setAttribute).call(target, 'aria-label', text.replace(/\n+/g, ' '));
    }
    if (originalRemoveAttribute) originalRemoveAttribute.call(target, 'title');
    else target.removeAttribute('title');
  }

  function installNativeTitleSuppressor() {
    if (nativeTitleSuppressorInstalled || !window.Element) return;
    nativeTitleSuppressorInstalled = true;
    originalSetAttribute = Element.prototype.setAttribute;
    originalRemoveAttribute = Element.prototype.removeAttribute;

    Element.prototype.setAttribute = function (name, value) {
      if (String(name).toLowerCase() === 'title' && !IGNORED_TAGS.has(this.tagName)) {
        setCustomTooltipFromTitle(this, value, true);
        return;
      }
      return originalSetAttribute.call(this, name, value);
    };

    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'title');
    if (descriptor && descriptor.configurable) {
      Object.defineProperty(HTMLElement.prototype, 'title', {
        configurable: true,
        enumerable: descriptor.enumerable,
        get() {
          return this.getAttribute('data-tooltip') || '';
        },
        set(value) {
          setCustomTooltipFromTitle(this, value, true);
        },
      });
    }
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
    iconEl.setAttribute('aria-hidden', 'true');
    textEl = document.createElement('div');
    textEl.className = 'custom-tooltip-text';
    copyButtonEl = document.createElement('button');
    copyButtonEl.type = 'button';
    copyButtonEl.className = 'custom-tooltip-copy';
    copyButtonEl.setAttribute('aria-label', 'Copy tooltip text');
    copyButtonEl.textContent = 'Copy';
    copyButtonEl.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      copyTooltipText();
    });
    tooltipEl.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    tooltipEl.addEventListener('mouseleave', hideTooltip);
    tooltipEl.addEventListener('focusout', (event) => {
      if (!tooltipEl.contains(event.relatedTarget) && (!activeTarget || !activeTarget.contains(event.relatedTarget))) {
        hideTooltip();
      }
    });
    tooltipEl.append(iconEl, textEl, copyButtonEl);
    document.body.appendChild(tooltipEl);
  }

  function renderTooltipText(text) {
    textEl.replaceChildren();
    const lines = text.split('\n');
    let renderedTitle = false;

    lines.forEach((line) => {
      const value = line.trim();
      if (!value) return;

      if (value === '---') {
        const separator = document.createElement('div');
        separator.className = 'custom-tooltip-separator';
        textEl.appendChild(separator);
        return;
      }

      if (!renderedTitle) {
        const title = document.createElement('div');
        title.className = 'custom-tooltip-title';
        title.textContent = value;
        textEl.appendChild(title);
        renderedTitle = true;
        return;
      }

      const bulletMatch = value.match(/^[-•]\s+(.*)$/);
      if (bulletMatch) {
        const bullet = document.createElement('div');
        bullet.className = 'custom-tooltip-bullet';
        bullet.textContent = bulletMatch[1];
        textEl.appendChild(bullet);
        return;
      }

      const rowMatch = value.match(/^([^:]{2,34}):\s*(.*)$/);
      if (rowMatch) {
        const row = document.createElement('div');
        const label = document.createElement('span');
        const rowValue = document.createElement('span');
        row.className = 'custom-tooltip-row';
        label.className = 'custom-tooltip-label';
        rowValue.className = 'custom-tooltip-value';
        label.textContent = `${rowMatch[1]}:`;
        rowValue.textContent = rowMatch[2];
        row.append(label, rowValue);
        textEl.appendChild(row);
        return;
      }

      const lineEl = document.createElement('div');
      lineEl.className = 'custom-tooltip-line';
      lineEl.textContent = value;
      textEl.appendChild(lineEl);
    });
  }

  async function copyTooltipText() {
    if (!activeTooltipText) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(activeTooltipText);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = activeTooltipText;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      copyButtonEl.textContent = 'Copied';
      copyButtonEl.classList.add('copied');
      setTimeout(() => {
        if (!copyButtonEl) return;
        copyButtonEl.textContent = 'Copy';
        copyButtonEl.classList.remove('copied');
      }, 1200);
    } catch (_err) {
      copyButtonEl.textContent = 'Select text';
      setTimeout(() => {
        if (copyButtonEl) copyButtonEl.textContent = 'Copy';
      }, 1600);
    }
  }

  function migrateTitle(target, force = false) {
    if (!target || IGNORED_TAGS.has(target.tagName)) return;
    const title = target.getAttribute('title');
    if (!title) return;
    const existingTooltip = target.getAttribute('data-tooltip');
    if (!force && existingTooltip) {
      if (!target.getAttribute('aria-label')) {
        target.setAttribute('aria-label', normalizeTooltipText(existingTooltip).replace(/\n+/g, ' '));
      }
      if (originalRemoveAttribute) originalRemoveAttribute.call(target, 'title');
      else target.removeAttribute('title');
      return;
    }
    setCustomTooltipFromTitle(target, title, force);
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
    root.querySelectorAll('[data-tooltip][title]').forEach((target) => {
      const tooltip = target.getAttribute('data-tooltip');
      if (!target.getAttribute('aria-label')) {
        target.setAttribute('aria-label', normalizeTooltipText(tooltip).replace(/\n+/g, ' '));
      }
      if (originalRemoveAttribute) originalRemoveAttribute.call(target, 'title');
      else target.removeAttribute('title');
    });
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
    const wasVisible = tooltipEl.classList.contains('visible');
    tooltipEl.className = `custom-tooltip custom-tooltip-${kind}`;
    if (wasVisible) tooltipEl.classList.add('visible');
    activeTooltipText = text;
    iconEl.textContent = icon;
    renderTooltipText(text);
    copyButtonEl.textContent = 'Copy';
    copyButtonEl.classList.remove('copied');
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

  function refreshActiveTooltip(target = activeTarget) {
    if (!tooltipEl || !activeTarget || target !== activeTarget) return;
    if (!tooltipEl.classList.contains('visible')) return;
    if (!normalizeTooltipText(activeTarget.getAttribute('data-tooltip'))) {
      hideTooltip();
      return;
    }
    setTooltipContent(activeTarget);
    positionTooltip(activeTarget);
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
    }, 500);
  }

  function hideTooltip() {
    clearTimeout(showTimer);
    hideTimer = setTimeout(() => {
      if (activeTarget) activeTarget.removeAttribute('aria-describedby');
      activeTarget = null;
      activeTooltipText = '';
      if (tooltipEl) {
        tooltipEl.classList.remove('visible');
        tooltipEl.setAttribute('aria-hidden', 'true');
      }
    }, 80);
  }

  function initCustomTooltips() {
    ensureTooltipStyles();
    installNativeTitleSuppressor();
    migrateAllTitles();
    ensureTooltipElement();

    document.addEventListener('mouseover', (event) => {
      const target = getTooltipTarget(event.target);
      if (target) showTooltip(target);
    });

    document.addEventListener('mouseout', (event) => {
      if (activeTarget && !activeTarget.contains(event.relatedTarget) && (!tooltipEl || !tooltipEl.contains(event.relatedTarget))) hideTooltip();
    });

    document.addEventListener('focusin', (event) => {
      const target = getTooltipTarget(event.target);
      if (target) showTooltip(target);
    });

    document.addEventListener('focusout', (event) => {
      if (tooltipEl && tooltipEl.contains(event.relatedTarget)) return;
      hideTooltip();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') hideTooltip();
    });
    window.addEventListener('scroll', hideTooltip, true);
    window.addEventListener('resize', hideTooltip);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'title') {
          migrateTitle(mutation.target, true);
          refreshActiveTooltip(mutation.target);
        } else if (mutation.type === 'attributes') {
          refreshActiveTooltip(mutation.target);
        } else if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            migrateTitle(node);
            if (node.querySelectorAll) migrateAllTitles(node);
          });
        }
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['title', 'data-tooltip', 'data-tooltip-icon', 'data-tooltip-kind', 'aria-label'],
    });
  }

  window.initCustomTooltips = initCustomTooltips;
  installNativeTitleSuppressor();
  window.addEventListener('DOMContentLoaded', initCustomTooltips, { once: true });
})();


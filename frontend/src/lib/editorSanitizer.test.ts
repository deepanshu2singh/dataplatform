import DOMPurify from 'dompurify';
import { describe, expect, it, vi } from 'vitest';
// Monaco does not publish declarations for this internal sanitizer module.
// @ts-expect-error The test intentionally exercises the actual editor integration.
import { sanitizeHtml } from 'monaco-editor/base/browser/domSanitize.js';

describe('the shipped editor sanitizer', () => {
  it('routes Monaco HTML sanitization through the patched dependency', () => {
    expect(DOMPurify.version).toBe('3.4.16');
    const sanitize = vi.spyOn(DOMPurify, 'sanitize');
    const result = String(sanitizeHtml('<strong>Safe content</strong>'));
    expect(sanitize).toHaveBeenCalledOnce();
    expect(result).toContain('<strong>Safe content</strong>');
  });

  it('preserves ordinary editor markup while removing scripts and event handlers', () => {
    const result = String(sanitizeHtml('<p>Editor help</p><img src="https://example.com/image.png" onerror="alert(1)"><script>alert(2)</script>'));
    const container = document.createElement('div');
    container.innerHTML = result;
    expect(container.textContent).toContain('Editor help');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')?.hasAttribute('onerror')).toBe(false);
  });

  it('rejects executable link schemes and preserves HTTPS links', () => {
    const container = document.createElement('div');
    container.innerHTML = String(sanitizeHtml('<a href="javascript:alert(1)">Unsafe</a><a href="https://example.com">Safe</a>'));
    const links = container.querySelectorAll('a');
    expect(links[0].hasAttribute('href')).toBe(false);
    expect(links[1].getAttribute('href')).toBe('https://example.com');
  });

  it('fails closed instead of returning an unsafe IN_PLACE raw-text root', () => {
    const root = document.createElement('style');
    root.textContent = '</style><img src=x onerror=alert(1)>';
    const container = document.createElement('div');
    container.append(root);
    expect(() => DOMPurify.sanitize(root, { IN_PLACE: true })).toThrow(TypeError);
  });
});

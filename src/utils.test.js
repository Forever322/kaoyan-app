import { describe, it, expect, vi } from 'vitest';
import { escapeHtml, debounce } from './utils.js';

// ==================== escapeHtml ====================
describe('escapeHtml', () => {
  it('转义 & < > " \'', () => {
    expect(escapeHtml('a&b<c>d"e\'f')).toBe('a&amp;b&lt;c&gt;d&quot;e&#39;f');
  });

  it('非字符串类型转为字符串', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('空字符串返回空字符串', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('普通文本不被修改', () => {
    expect(escapeHtml('北京大学')).toBe('北京大学');
  });

  it('转义后不含未转义的特殊字符', () => {
    const result = escapeHtml('<script>alert("xss")</script>');
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
  });
});

// ==================== debounce ====================
describe('debounce', () => {
  it('延迟调用函数', async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('重复调用只执行一次', async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    debounced();
    debounced();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('传递参数', async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 50);

    debounced('a', 'b');
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledWith('a', 'b');

    vi.useRealTimers();
  });
});

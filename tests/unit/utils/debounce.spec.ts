import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce, debounceWithError } from '@/utils/debounce';

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('延迟指定时间后执行', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('短时间内多次调用只执行最后一次', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced('a');
    debounced('b');
    debounced('c');

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('c');
  });

  it('cancel 取消待执行的调用', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    debounced.cancel();

    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
  });

  it('immediate 立即执行并取消待执行的调用', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced('delayed');
    debounced.immediate('now');

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('now');

    vi.advanceTimersByTime(200);
    // delayed 调用已被 cancel
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('延迟到期后再次调用可以正常执行', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced('first');
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledWith('first');

    debounced('second');
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledWith('second');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('debounceWithError', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('延迟指定时间后执行异步函数', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const debounced = debounceWithError(fn, 100);

    debounced();
    expect(fn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('短时间内多次调用只执行最后一次', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const debounced = debounceWithError(fn, 100);

    debounced('a');
    debounced('b');
    debounced('c');

    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('c');
  });

  it('执行失败时调用 onError 回调', async () => {
    const error = new Error('test error');
    const fn = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();
    const debounced = debounceWithError(fn, 100, onError);

    debounced();
    await vi.advanceTimersByTimeAsync(100);

    expect(onError).toHaveBeenCalledWith(error);
  });

  it('cancel 取消待执行的调用', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const debounced = debounceWithError(fn, 100);

    debounced();
    debounced.cancel();

    await vi.advanceTimersByTimeAsync(200);
    expect(fn).not.toHaveBeenCalled();
  });

  it('immediate 立即执行并取消待执行的调用', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const debounced = debounceWithError(fn, 100);

    debounced('delayed');
    await debounced.immediate('now');

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('now');

    await vi.advanceTimersByTimeAsync(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('immediate 执行失败时调用 onError 回调', async () => {
    const error = new Error('immediate error');
    const fn = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();
    const debounced = debounceWithError(fn, 100, onError);

    await debounced.immediate();

    expect(onError).toHaveBeenCalledWith(error);
  });
});

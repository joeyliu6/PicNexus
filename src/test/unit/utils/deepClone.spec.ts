import { describe, it, expect } from 'vitest';
import { deepClone, deepMerge } from '../../../utils/deepClone';

describe('deepClone', () => {
  it('原始类型直接返回', () => {
    expect(deepClone(42)).toBe(42);
    expect(deepClone('hello')).toBe('hello');
    expect(deepClone(null)).toBe(null);
    expect(deepClone(undefined)).toBe(undefined);
    expect(deepClone(true)).toBe(true);
  });

  it('深拷贝普通对象', () => {
    const obj = { a: 1, b: { c: 2 } };
    const cloned = deepClone(obj);

    expect(cloned).toEqual(obj);
    expect(cloned).not.toBe(obj);
    expect(cloned.b).not.toBe(obj.b);
  });

  it('深拷贝数组', () => {
    const arr = [1, [2, 3], { a: 4 }];
    const cloned = deepClone(arr);

    expect(cloned).toEqual(arr);
    expect(cloned).not.toBe(arr);
    expect(cloned[1]).not.toBe(arr[1]);
    expect(cloned[2]).not.toBe(arr[2]);
  });

  it('深拷贝 Date 对象', () => {
    const date = new Date('2024-01-01');
    const cloned = deepClone(date);

    expect(cloned).toEqual(date);
    expect(cloned).not.toBe(date);
    expect(cloned.getTime()).toBe(date.getTime());
  });

  it('修改拷贝不影响原对象', () => {
    const obj = { nested: { value: 'original' } };
    const cloned = deepClone(obj);

    cloned.nested.value = 'modified';
    expect(obj.nested.value).toBe('original');
  });
});

describe('deepMerge', () => {
  it('合并简单属性', () => {
    const target = { a: 1, b: 2 };
    const source = { b: 3, c: 4 };
    const result = deepMerge(target, source);

    expect(result).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('递归合并嵌套对象', () => {
    // 显式放宽字段为 optional，匹配 deepMerge 的 Partial<T> 签名。
    const target: { nested: { a?: number; b?: number; c?: number } } = {
      nested: { a: 1, b: 2 },
    };
    const source: Partial<typeof target> = { nested: { b: 3, c: 4 } };
    const result = deepMerge(target, source);

    expect(result.nested).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('数组整体替换而非合并', () => {
    const target = { arr: [1, 2, 3] };
    const source = { arr: [4, 5] };
    const result = deepMerge(target, source);

    expect(result.arr).toEqual([4, 5]);
  });

  it('不修改原始对象', () => {
    const target = { a: 1, nested: { b: 2 } };
    const source = { nested: { b: 3 } };
    deepMerge(target, source);

    expect(target.nested.b).toBe(2);
  });

  it('source 的新属性会添加到结果', () => {
    const target = { a: 1 };
    const source = { b: 2 };
    const result = deepMerge(target, source as any);

    expect(result).toEqual({ a: 1, b: 2 });
  });
});

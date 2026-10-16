import { describe, expect, it } from 'vitest';
import { splitLinkSegments } from '@/utils/linkSegments';

const url = 'https://img30.360buyimg.com/pop/a.png';

describe('splitLinkSegments', () => {
  it('colours a bare URL as one url segment', () => {
    expect(splitLinkSegments(url, url, 'a')).toEqual([{ kind: 'url', text: url }]);
  });

  it('splits Markdown into syntax, name and url', () => {
    expect(splitLinkSegments(`![截图](${url})`, url, '截图')).toEqual([
      { kind: 'syntax', text: '![' },
      { kind: 'name', text: '截图' },
      { kind: 'syntax', text: '](' },
      { kind: 'url', text: url },
      { kind: 'syntax', text: ')' },
    ]);
  });

  it('finds an HTML-escaped file name inside an img tag', () => {
    const segments = splitLinkSegments(`<img src="${url}" alt="a&amp;b">`, url, 'a&b');
    expect(segments.map((s) => s.kind)).toEqual(['syntax', 'url', 'syntax', 'name', 'syntax']);
    expect(segments[3].text).toBe('a&amp;b');
  });

  it('prefers the url when the file name also appears inside it', () => {
    expect(splitLinkSegments(`[img]${url}[/img]`, url, 'a').map((s) => s.kind)).toEqual(['syntax', 'url', 'syntax']);
    expect(splitLinkSegments(url, url, 'https')).toEqual([{ kind: 'url', text: url }]);
  });

  it('treats everything as syntax when nothing matches', () => {
    expect(splitLinkSegments('{custom}', url)).toEqual([{ kind: 'syntax', text: '{custom}' }]);
  });
});

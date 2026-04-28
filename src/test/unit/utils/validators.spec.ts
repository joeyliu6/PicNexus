import { describe, expect, it } from 'vitest';
import { hasNonEmptyFields } from '../../../utils/validators';

describe('hasNonEmptyFields', () => {
  it('requires every named field to be a non-empty trimmed string', () => {
    expect(hasNonEmptyFields(
      { token: ' abc ', owner: 'me', repo: 'pics' },
      ['token', 'owner', 'repo'],
    )).toBe(true);

    expect(hasNonEmptyFields(
      { token: 'abc', owner: '   ', repo: 'pics' },
      ['token', 'owner', 'repo'],
    )).toBe(false);

    expect(hasNonEmptyFields(
      { token: 'abc', owner: 123, repo: 'pics' },
      ['token', 'owner', 'repo'],
    )).toBe(false);
  });

  it('returns false for missing config objects', () => {
    expect(hasNonEmptyFields(null, ['token'])).toBe(false);
    expect(hasNonEmptyFields(undefined, ['token'])).toBe(false);
  });
});

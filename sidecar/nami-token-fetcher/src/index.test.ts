import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFetchTokenInput } from './index';

test('parseFetchTokenInput accepts the stdin JSON protocol', () => {
  assert.deepEqual(
    parseFetchTokenInput('{"cookie":"session=secret","authToken":"token-secret"}'),
    { cookie: 'session=secret', authToken: 'token-secret' },
  );
});

test('parseFetchTokenInput rejects malformed or incomplete input', () => {
  assert.throws(() => parseFetchTokenInput('not-json'), /Invalid stdin JSON/);
  assert.throws(() => parseFetchTokenInput('{"cookie":"ok"}'), /authToken/);
  assert.throws(() => parseFetchTokenInput('{"cookie":"","authToken":"ok"}'), /cookie/);
});

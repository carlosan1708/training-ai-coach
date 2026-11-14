import { test } from 'node:test';
import assert from 'node:assert/strict';
import { childEnvironment, runTool, resolveTool } from './process.mjs';

test('child environment removes diagnostic key logging without weakening proxy or CA trust', () => {
  const source = { PATH: 'tools', SSLKEYLOGFILE: 'private-path', NODE_EXTRA_CA_CERTS: 'trusted-ca.pem', HTTPS_PROXY: 'https://proxy.example.test' };
  const child = childEnvironment({ SSLKEYLOGFILE: 'reintroduced-path', QA_BASE_URL: 'https://qa.example.test' }, source);
  assert.equal(child.SSLKEYLOGFILE, undefined);
  assert.equal(source.SSLKEYLOGFILE, 'private-path');
  assert.equal(child.NODE_EXTRA_CA_CERTS, source.NODE_EXTRA_CA_CERTS);
  assert.equal(child.HTTPS_PROXY, source.HTTPS_PROXY);
});

test('tool execution keeps argv separate and strips key logging after merging caller env', () => {
  let captured;
  const args = ['deploy', '--config', 'C:\\workspace with spaces & literal\\firebase.qa.json'];
  runTool('firebase', args, { env: { SSLKEYLOGFILE: 'must-not-reappear' }, resolveImpl: () => ({ executable: 'node', prefix: ['firebase.js'] }), spawnImpl: (executable, argv, options) => { captured = { executable, argv, options }; return { status: 0 }; } });
  assert.deepEqual(captured.argv, ['firebase.js', ...args]);
  assert.equal(captured.options.shell, false);
  assert.equal(captured.options.env.SSLKEYLOGFILE, undefined);
});

test('secret capture never inherits stdout and does not include process output in errors', () => {
  const synthetic = '{"password":"never-log-this-synthetic-value"}';
  let captured;
  const value = runTool('gcloud', ['secrets', 'versions', 'access', 'latest'], { capture: true, resolveImpl: () => ({ executable: 'python', prefix: ['gcloud.py'] }), spawnImpl: (_executable, _argv, options) => { captured = options; return { status: 0, stdout: synthetic }; } });
  assert.equal(value, synthetic);
  assert.deepEqual(captured.stdio, ['ignore', 'pipe', 'pipe']);
  assert.throws(() => runTool('gcloud', [], { capture: true, resolveImpl: () => ({ executable: 'python', prefix: [] }), spawnImpl: () => ({ status: 1, stdout: synthetic, stderr: synthetic }) }), error => !error.message.includes('never-log'));
});

test('unsupported commands cannot turn the helper into an arbitrary shell', () => {
  assert.throws(() => resolveTool('cmd /c echo unsafe'));
});

test('a timed-out deployment is identified without leaking process output or implying it never started', () => {
  assert.throws(() => runTool('firebase', ['deploy'], { timeout: 1_200_000, capture: true,
    resolveImpl: () => ({ executable: 'node', prefix: ['firebase.js'] }),
    spawnImpl: () => ({ status: null, error: { code: 'ETIMEDOUT' }, stdout: 'private-output', stderr: 'private-output' }),
  }), error => error.message.includes('timed out after 1200000 ms') && error.message.includes('remote operation')
    && !error.message.includes('could not start') && !error.message.includes('private-output'));
});

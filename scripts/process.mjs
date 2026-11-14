import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';

export function childEnvironment(extra = {}, source = process.env) {
  const env = { ...source, ...extra };
  for (const key of Object.keys(env)) {
    if (['sslkeylogfile', 'node_sslkeylogfile'].includes(key.toLowerCase())) delete env[key];
  }
  return env;
}

function onPath(names, env) {
  const folders = (env.PATH || env.Path || '').split(delimiter).filter(Boolean);
  return folders.flatMap(folder => names.map(name => join(folder, name))).filter(path => existsSync(path));
}

export function resolveTool(tool, env = process.env) {
  if (!['npm', 'firebase', 'gcloud'].includes(tool)) throw new Error('Unsupported development tool.');
  if (tool === 'gcloud') {
    const wrappers = onPath(process.platform === 'win32' ? ['gcloud.cmd', 'gcloud.ps1'] : ['gcloud'], env);
    if (process.platform !== 'win32' && wrappers[0]) return { executable: wrappers[0], prefix: [] };
    const roots = [env.CLOUDSDK_ROOT_DIR, ...wrappers.map(path => resolve(dirname(path), '..'))].filter(Boolean);
    for (const sdk of roots) {
      const entry = join(sdk, 'lib', 'gcloud.py');
      const python = [env.CLOUDSDK_PYTHON, join(sdk, 'platform', 'bundledpython', 'python.exe')].find(path => path && existsSync(path));
      if (existsSync(entry) && python) return { executable: python, prefix: ['-S', entry] };
    }
    throw new Error('Google Cloud SDK is missing. Install it or configure CLOUDSDK_ROOT_DIR and CLOUDSDK_PYTHON.');
  }
  const relative = tool === 'npm' ? ['npm', 'bin', 'npm-cli.js'] : ['firebase-tools', 'lib', 'bin', 'firebase.js'];
  const candidates = [
    ...(tool === 'npm' && env.npm_execpath ? [env.npm_execpath] : []),
    join(dirname(process.execPath), 'node_modules', ...relative),
    env.APPDATA && join(env.APPDATA, 'npm', 'node_modules', ...relative),
    join('/usr/local/lib/node_modules', ...relative),
    join('/usr/lib/node_modules', ...relative),
    ...(tool === 'npm' ? ['/usr/share/nodejs/npm/bin/npm-cli.js'] : []),
  ];
  for (const wrapper of onPath(process.platform === 'win32' ? [`${tool}.cmd`, `${tool}.ps1`] : [tool], env)) {
    candidates.push(join(dirname(wrapper), 'node_modules', ...relative));
    const actual = realpathSync(wrapper);
    if (actual.endsWith('.js')) candidates.push(actual);
  }
  const script = candidates.find(path => path && existsSync(path));
  if (!script) throw new Error(`${tool} is missing. Install it before running this command.`);
  return { executable: process.execPath, prefix: [script] };
}

export function runTool(tool, args, { cwd, env: extra = {}, capture = false, timeout = 300_000, resolveImpl = resolveTool, spawnImpl = spawnSync } = {}) {
  const env = childEnvironment(extra);
  const command = resolveImpl(tool, env);
  // Run installed JS/Python entry points directly. No cmd.exe, PowerShell,
  // shell interpolation, or credentials in command arguments are involved.
  const result = spawnImpl(command.executable, [...command.prefix, ...args], {
    cwd, env, shell: false, windowsHide: true,
    encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    timeout, maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error?.code === 'ETIMEDOUT') throw new Error(`${tool} timed out after ${timeout} ms. A remote operation may still be running; check its status before retrying.`);
  if (result.status !== 0) throw new Error(`${tool} failed (${result.status ?? 'could not start'}). Check tool access and configuration.`);
  return capture ? result.stdout : undefined;
}

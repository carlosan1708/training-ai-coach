import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const childEnv = { ...process.env };
// Session diagnostic key logging must not write outside the workspace. This
// changes only the child environment; CA trust and proxy settings stay intact.
for (const key of Object.keys(childEnv)) {
  if (['sslkeylogfile', 'node_sslkeylogfile'].includes(key.toLowerCase())) delete childEnv[key];
}
const javaName = process.platform === 'win32' ? 'java.exe' : 'java';
const candidates = [];
const addHome = home => { if (home) candidates.push(join(home, 'bin', javaName)); };
function directories(path) {
  if (!path || !existsSync(path)) return [];
  try { return readdirSync(path, { withFileTypes: true }).filter(item => item.isDirectory()).map(item => join(path, item.name)); }
  catch { return []; }
}
addHome(childEnv.JAVA_HOME);
for (const folder of (childEnv.PATH || childEnv.Path || '').split(delimiter)) {
  if (folder && existsSync(join(folder, javaName))) candidates.push(join(folder, javaName));
}
directories(join(root, '.qa', 'tools')).filter(path => /jdk|temurin|jbr/i.test(path)).forEach(addHome);
directories(join(homedir(), '.jdks')).forEach(addHome);
if (process.platform === 'win32') {
  const programs = childEnv.ProgramFiles || 'C:\\Program Files';
  for (const vendor of ['Eclipse Adoptium', 'Java', 'Microsoft']) directories(join(programs, vendor)).forEach(addHome);
  directories(join(programs, 'JetBrains')).forEach(path => addHome(join(path, 'jbr')));
  addHome(join(programs, 'Android', 'Android Studio', 'jbr'));
}
const installations = [...new Set(candidates)].filter(path => existsSync(path)).map(path => {
  const result = spawnSync(path, ['-version'], { env: childEnv, encoding: 'utf8', timeout: 10_000, windowsHide: true });
  const major = Number(`${result.stderr || ''}${result.stdout || ''}`.match(/version\s+"(\d+)/)?.[1]);
  return { path, major };
}).filter(java => java.major >= 21).sort((a, b) => Number(b.major === 21) - Number(a.major === 21) || a.major - b.major);
if (!installations.length) {
  console.error('Security tests require Java 21+. Set JAVA_HOME or extract an official JDK into .qa/tools/jdk-21.');
  process.exit(1);
}
const selected = installations[0];
childEnv.JAVA_HOME = dirname(dirname(selected.path));
const pathKey = Object.keys(childEnv).find(key => key.toLowerCase() === 'path') || 'PATH';
childEnv[pathKey] = `${dirname(selected.path)}${delimiter}${childEnv[pathKey] || ''}`;
childEnv.GCLOUD_PROJECT = 'demo-training-coach';
childEnv.GOOGLE_CLOUD_PROJECT = 'demo-training-coach';
childEnv.FIREBASE_CLI_DISABLE_UPDATE_CHECK = 'true';
childEnv.CI = 'true';

const cliCandidates = [
  join(root, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js'),
  childEnv.APPDATA && join(childEnv.APPDATA, 'npm', 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js'),
  '/usr/local/lib/node_modules/firebase-tools/lib/bin/firebase.js',
  '/usr/lib/node_modules/firebase-tools/lib/bin/firebase.js',
];
for (const folder of (childEnv[pathKey] || '').split(delimiter)) {
  if (!folder) continue;
  cliCandidates.push(join(folder, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js'));
  const binary = join(folder, process.platform === 'win32' ? 'firebase.cmd' : 'firebase');
  if (existsSync(binary)) {
    const resolved = realpathSync(binary);
    if (resolved.endsWith('.js')) cliCandidates.push(resolved);
  }
}
const cli = cliCandidates.find(path => path && existsSync(path));
if (!cli) {
  console.error('Firebase CLI is missing. Install firebase-tools before running security tests.');
  process.exit(1);
}
console.log(`Running isolated Firebase rules tests with Java ${selected.major}.`);
const args = [cli, 'emulators:exec', '--project', 'demo-training-coach', '--config', 'firebase.emulators.json', '--only', 'auth,firestore,storage', '--non-interactive', 'node --test web/e2e-rules/security.test.mjs'];
const child = spawn(process.execPath, args, { cwd: root, env: childEnv, stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(`Could not start local security tests: ${error.code || 'spawn error'}`); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));

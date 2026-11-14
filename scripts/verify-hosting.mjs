import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { root, readEnvironment } from './environment.mjs';

const args = process.argv.slice(2);
const config = await readEnvironment(args[args.indexOf('--config') + 1], { environment: 'qa' });
const get = async path => {
  const response = await fetch(config.hostingUrl + path, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Deployment resource unavailable: ${path}`);
  return { data: Buffer.from(await response.arrayBuffer()), cache: response.headers.get('cache-control') };
};
const marker = JSON.parse((await get('/environment.json')).data.toString());
if (marker.schemaVersion !== 1 || marker.environment !== 'qa' || marker.projectId !== config.projectId
  || marker.storageBucket !== config.storageBucket || marker.region !== config.region) throw new Error('QA identity marker mismatch.');
const local = await readFile(resolve(root, 'web/dist/index.html'));
const remote = await get('/');
if (!remote.data.equals(local)) throw new Error('Published HTML does not match the candidate build.');
if (!remote.cache?.includes('no-cache')) throw new Error('The HTML shell must revalidate after releases.');
const entry = local.toString().match(/src="(\/assets\/index-[a-zA-Z0-9_-]+\.js)"/)?.[1];
if (!entry) throw new Error('The candidate has no recognized JavaScript entrypoint.');
const source = await readFile(resolve(root, 'web/dist', entry.slice(1)));
const bundle = await get(entry);
if (!bundle.data.equals(source)) throw new Error('Published JavaScript does not match the candidate build.');
const evidence = { checkedAt: new Date().toISOString(), projectId: config.projectId, hosting: config.hostingUrl,
  htmlCacheControl: remote.cache, entrypoint: entry,
  bundleSha256: createHash('sha256').update(source).digest('hex'), htmlMatches: true, bundleMatches: true };
await mkdir(resolve(root, '.qa'), { recursive: true });
await writeFile(resolve(root, '.qa/hosting-readiness.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence));

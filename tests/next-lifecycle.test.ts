import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';

const root = path.resolve(__dirname, '..');
const children: ChildProcess[] = [];
const stores: string[] = [];
async function availablePort() {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = (socket.address() as net.AddressInfo).port;
  socket.close();
  await once(socket, 'close');
  return port;
}
async function waitUntil(check: () => Promise<boolean>, milliseconds = 15000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Next lifecycle condition timed out');
}
const ready = async (port: number) => {
  try { return (await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(500) })).ok; }
  catch { return false; }
};
function configuration(): NodeJS.ProcessEnv {
  const store = mkdtempSync(path.join(tmpdir(), 'vision-lifecycle-'));
  stores.push(store);
  return { ...process.env, NODE_ENV: 'production', AUTOBIDDER_DATA_DIR: store,
    AUTOBIDDER_DATABASE_PATH: path.join(store, 'test.sqlite') };
}
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
  }
  for (const store of stores.splice(0)) rmSync(store, { recursive: true, force: true });
});

describe.runIf(process.platform === 'linux')('actual Next server lifecycle', () => {
  it('stops the real listener when the tracked child is terminated', async () => {
    const port = await availablePort();
    const child = spawn('python3', ['scripts/next-lifecycle.py', 'start', '-H', '127.0.0.1', '-p', String(port)],
      { cwd: root, env: configuration(), stdio: 'ignore' });
    children.push(child);
    await waitUntil(() => ready(port));
    const exited = once(child, 'exit');
    expect(child.kill('SIGTERM')).toBe(true);
    await exited;
    await waitUntil(async () => !(await ready(port)));
  });

  it('closes its listener when the launching runner is killed abruptly', async () => {
    const port = await availablePort();
    const parent = spawn('python3', ['-c',
      'import subprocess,sys,time; subprocess.Popen([sys.executable,"scripts/next-lifecycle.py","start","-H","127.0.0.1","-p",sys.argv[1]],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(60)', String(port)],
      { cwd: root, env: configuration(), stdio: 'ignore' });
    children.push(parent);
    await waitUntil(() => ready(port));
    const exited = once(parent, 'exit');
    expect(parent.kill('SIGKILL')).toBe(true);
    await exited;
    await waitUntil(async () => !(await ready(port)));
  });
});

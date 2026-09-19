import 'server-only';
import path from 'path';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'fs/promises';
import { getServerEnv } from '@/lib/autobidder/env/server-env';

function rootDir() {
  return path.resolve(process.cwd(), getServerEnv().AUTOBIDDER_DATA_DIR);
}

export async function ensureDataDirs() {
  await mkdir(rootDir(), { recursive: true });
  await mkdir(path.join(rootDir(), 'projects'), { recursive: true });
  await mkdir(path.join(rootDir(), 'jobs'), { recursive: true });
  await mkdir(path.join(rootDir(), 'uploads'), { recursive: true });
}

export async function writeJson(relativePath: string, value: unknown) {
  const fullPath = path.join(rootDir(), relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, JSON.stringify(value, null, 2), 'utf-8');
}

export async function readJson<T>(relativePath: string): Promise<T | null> {
  const fullPath = path.join(rootDir(), relativePath);
  try {
    const raw = await readFile(fullPath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeBinary(relativePath: string, bytes: Buffer) {
  const fullPath = path.join(rootDir(), relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, bytes);
}

export async function listFiles(relativeDir: string): Promise<string[]> {
  const full = path.join(rootDir(), relativeDir);
  try {
    const items = await readdir(full);
    return items.map((item) => path.join(relativeDir, item));
  } catch {
    return [];
  }
}

export async function readBinary(relativePath: string): Promise<Buffer> {
  const fullPath = path.join(rootDir(), relativePath);
  return readFile(fullPath);
}

export async function fileSize(relativePath: string): Promise<number> {
  const fullPath = path.join(rootDir(), relativePath);
  const info = await stat(fullPath);
  return info.size;
}

export async function removeDataRoot() {
  await rm(rootDir(), { recursive: true, force: true });
}

export function dataRootPath() {
  return rootDir();
}

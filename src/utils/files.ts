/**
 * File I/O utilities
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Read a file as string
 */
export async function readFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf-8');
}

/**
 * Write string content to a file
 */
export async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.writeFile(filePath, content, 'utf-8');
}

/**
 * Read and parse a JSON file
 */
export async function readJson<T>(filePath: string): Promise<T> {
  const content = await readFile(filePath);
  return JSON.parse(content) as T;
}

/**
 * Write object as JSON to file
 */
export async function writeJson(filePath: string, data: unknown, pretty = true): Promise<void> {
  const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  await writeFile(filePath, content);
}

/**
 * Check if a file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create directory if it doesn't exist
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * List files in a directory with optional extension filter
 */
export async function listFiles(dirPath: string, extension?: string): Promise<string[]> {
  const entries = await fs.readdir(dirPath);
  if (extension) {
    return entries.filter(f => f.endsWith(extension));
  }
  return entries;
}

/**
 * Convert a test name to a valid filename
 * e.g., "Get_Message_With_AckTimeout" -> "test_get_message_with_acktimeout.js"
 */
export function testNameToFilename(name: string): string {
  // Convert to lowercase and replace non-alphanumeric with underscores
  let sanitized = name
    .split('')
    .map(c => /[a-zA-Z0-9]/.test(c) ? c.toLowerCase() : '_')
    .join('');

  // Collapse multiple underscores
  sanitized = sanitized.replace(/_+/g, '_');

  // Trim leading/trailing underscores
  sanitized = sanitized.replace(/^_+|_+$/g, '');

  return `test_${sanitized}.js`;
}

/**
 * Resolve path relative to current working directory
 */
export function resolvePath(filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(process.cwd(), filePath);
}

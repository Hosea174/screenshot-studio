import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const MCP_TOKEN_PATH = path.resolve(process.cwd(), 'mcp/.token');

export async function getOrCreateStudioMcpToken(): Promise<string> {
  await mkdir(path.dirname(MCP_TOKEN_PATH), { recursive: true });
  try {
    return (await readFile(MCP_TOKEN_PATH, 'utf8')).trim();
  } catch {
    const token = randomBytes(32).toString('hex');
    try {
      await writeFile(MCP_TOKEN_PATH, `${token}\n`, { flag: 'wx', mode: 0o600 });
      return token;
    } catch {
      return (await readFile(MCP_TOKEN_PATH, 'utf8')).trim();
    }
  }
}

export async function studioMcpTokenMatches(candidate: string | null): Promise<boolean> {
  if (!candidate) return false;
  const expected = await getOrCreateStudioMcpToken();
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

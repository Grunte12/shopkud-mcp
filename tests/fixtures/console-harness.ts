import { spawn, type ChildProcess } from 'child_process';
import { createServer, type Server } from 'http';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { seedConsoleDb, type SeedOptions } from './console-seed.js';

export interface Harness {
  url: string;
  port: number;
  dbPath: string;
  stop: () => Promise<void>;
}

/** Stands in for Chrome's /json/version. It never speaks the real DevTools protocol. */
export function startMockChrome(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (req.url === '/json/version') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ Browser: 'MockChrome/130.0', 'Protocol-Version': '1.3' }));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function waitFor(url: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Console did not start: ${url}`);
}

export interface HarnessOptions extends SeedOptions {
  port: number;
  /** Port of the mock Chrome. Null leaves the CDP port closed. */
  chromePort: number | null;
}

/**
 * Starts the real console server (npm run console) against a throwaway sqlite file.
 * The CDP port is a mock or a closed port, never 9222 or 9333.
 */
export async function startConsole(options: HarnessOptions): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'shopkud-console-'));
  const dbPath = join(dir, 'console.db');
  seedConsoleDb(dbPath, options);
  const cdpPort = options.chromePort ?? options.port + 1000;
  const child: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'src/console/server.ts'], {
    stdio: 'ignore',
    env: {
      ...process.env,
      SHOPKUD_DB_PATH: dbPath,
      CONSOLE_PORT: String(options.port),
      SHOPKUD_CDP_PORT: String(cdpPort),
      CHROME_CDP_URL: '',
    },
  });
  await waitFor(`http://127.0.0.1:${options.port}/api/v1/tools`);
  return {
    url: `http://127.0.0.1:${options.port}`,
    port: options.port,
    dbPath,
    stop: async () => {
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 400));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根目录。所有门禁测试都从这里起子进程，不依赖 `cd` 之后的状态。 */
export const REPO_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

const PNPM_BIN = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function childEnv(extra: Record<string, string> | undefined): NodeJS.ProcessEnv {
  return { ...process.env, ...extra };
}

/** 跑一个命令并等它结束。子进程的 stdout/stderr 全量收集，失败时便于贴进断言消息。 */
export function run(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd ?? REPO_ROOT,
      env: childEnv(options.env),
      // Windows 上 pnpm 是 .cmd，不经 shell 起不来；两平台行为都对齐到「等命令结束」。
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            child.kill('SIGKILL');
          }, options.timeoutMs);

    child.on('error', reject);
    child.on('close', (code) => {
      if (timer !== undefined) clearTimeout(timer);
      resolvePromise({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** `run` 的 pnpm 快捷方式。 */
export function pnpm(args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
  return run(PNPM_BIN, args, options);
}

export interface BackgroundHandle {
  readonly pid: number | undefined;
  /** 子进程已累积的输出，用于失败诊断。 */
  output: () => string;
  /** 结束整个进程组（dev 会再拉起 vite 与 tsx 两个孙进程）。 */
  stop: () => void;
}

/** 起一个长驻进程（`pnpm dev` / `pnpm start`），返回可结束进程组的句柄。 */
export function spawnBackground(
  command: string,
  args: readonly string[],
  env: Record<string, string> = {},
): BackgroundHandle {
  const child = spawn(command, [...args], {
    cwd: REPO_ROOT,
    env: childEnv(env),
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    // 独立进程组：停的时候能一次带走 vite 与 tsx。
    detached: process.platform !== 'win32',
  });

  let output = '';
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });

  const stop = (): void => {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      return;
    }
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // 已经退出：进程组不存在属于正常收尾。
    }
  };

  return { pid: child.pid, output: () => output, stop };
}

/** 反复请求直到拿到 2xx，或超时。 */
export async function waitForHttp(url: string, timeoutMs: number): Promise<Response | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // 端口还没起来，继续等。
    }
    if (Date.now() > deadline) return null;
    await new Promise((done) => setTimeout(done, 250));
  }
}

/** `spawnBackground` 的 pnpm 快捷方式。 */
export function pnpmBackground(
  args: readonly string[],
  env: Record<string, string> = {},
): BackgroundHandle {
  return spawnBackground(PNPM_BIN, args, env);
}

/** 等待若干毫秒，用于等端口释放。 */
export function delay(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

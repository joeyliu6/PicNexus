import { fetchNamiToken, NamiDynamicHeaders } from './token-fetcher';
import { detectChromePath, BrowserInfo } from './browser-detector';
import { writeJsonResult } from './diagnostic-logger';

interface SuccessResponse<T> {
  success: true;
  data: T;
}

interface ErrorResponse {
  success: false;
  error: string;
}

interface CheckChromeData {
  installed: boolean;
  path?: string;
  name?: string;
}

type Response<T> = SuccessResponse<T> | ErrorResponse;

export interface FetchTokenInput {
  cookie: string;
  authToken: string;
}

function success<T>(data: T): Response<T> {
  return { success: true, data };
}

function error(message: string): ErrorResponse {
  return { success: false, error: message };
}

async function handleCheckChrome(): Promise<Response<CheckChromeData>> {
  const browserInfo = detectChromePath();
  if (browserInfo) {
    return success({
      installed: true,
      path: browserInfo.path,
      name: browserInfo.name
    });
  } else {
    return success({
      installed: false
    });
  }
}

async function handleFetchToken(cookie: string, authToken: string): Promise<Response<NamiDynamicHeaders>> {
  try {
    const headers = await fetchNamiToken({ cookie, authToken });
    return success(headers);
  } catch (err: any) {
    return error(err.message || 'Unknown error');
  }
}

export function parseFetchTokenInput(raw: string): FetchTokenInput {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Invalid stdin JSON');
  }
  if (!value || typeof value !== 'object') {
    throw new Error('stdin JSON must be an object');
  }

  const input = value as Record<string, unknown>;
  if (typeof input.cookie !== 'string' || input.cookie.trim().length === 0) {
    throw new Error('Missing required stdin field: cookie');
  }
  if (typeof input.authToken !== 'string' || input.authToken.trim().length === 0) {
    throw new Error('Missing required stdin field: authToken');
  }
  return { cookie: input.cookie, authToken: input.authToken };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  let result: Response<any>;

  switch (command) {
    case 'check-chrome':
      result = await handleCheckChrome();
      break;

    case 'fetch-token': {
      try {
        const { cookie, authToken } = parseFetchTokenInput(await readStdin());
        result = await handleFetchToken(cookie, authToken);
      } catch (err) {
        result = error(err instanceof Error ? err.message : 'Invalid stdin input');
        process.exitCode = 1;
      }
      break;
    }

    default:
      result = error(`Unknown command: ${command}. Available commands: check-chrome, fetch-token`);
      process.exitCode = 1;
  }

  // 输出 JSON 结果到 stdout
  writeJsonResult(result);
}

if (require.main === module) {
  main().catch((err) => {
    writeJsonResult(error(err.message || 'Unexpected error'));
    process.exitCode = 1;
  });
}

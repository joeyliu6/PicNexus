import { fetchNamiToken, NamiDynamicHeaders } from './token-fetcher';
import { detectChromePath, BrowserInfo } from './browser-detector';

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

function parseArgs(args: string[]): { [key: string]: string } {
  const result: { [key: string]: string } = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.substring(2);
      const value = args[i + 1] || '';
      if (!value.startsWith('--')) {
        result[key] = value;
        i++;
      } else {
        result[key] = '';
      }
    }
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const parsedArgs = parseArgs(args.slice(1));

  let result: Response<any>;

  switch (command) {
    case 'check-chrome':
      result = await handleCheckChrome();
      break;

    case 'fetch-token':
      const cookie = parsedArgs['cookie'] || '';
      const authToken = parsedArgs['auth-token'] || '';

      if (!cookie) {
        result = error('Missing required argument: --cookie');
        process.exitCode = 1;
        break;
      }

      if (!authToken) {
        result = error('Missing required argument: --auth-token');
        process.exitCode = 1;
        break;
      }

      result = await handleFetchToken(cookie, authToken);
      break;

    default:
      result = error(`Unknown command: ${command}. Available commands: check-chrome, fetch-token`);
      process.exitCode = 1;
  }

  // 输出 JSON 结果到 stdout
  console.log(JSON.stringify(result));
}

main().catch((err) => {
  console.log(JSON.stringify(error(err.message || 'Unexpected error')));
  process.exitCode = 1;
});

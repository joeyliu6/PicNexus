import { fetchQiyuToken, QiyuToken } from './token-fetcher';
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

async function handleFetchToken(): Promise<Response<QiyuToken>> {
  try {
    const token = await fetchQiyuToken();
    return success(token);
  } catch (err: any) {
    return error(err.message || 'Unknown error');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  let result: Response<any>;

  switch (command) {
    case 'check-chrome':
      result = await handleCheckChrome();
      break;

    case 'fetch-token':
      result = await handleFetchToken();
      break;

    default:
      result = error(`Unknown command: ${command}. Available commands: check-chrome, fetch-token`);
      process.exitCode = 1;
  }

  // 输出 JSON 结果到 stdout
  writeJsonResult(result);
}

main().catch((err) => {
  writeJsonResult(error(err.message || 'Unexpected error'));
  process.exitCode = 1;
});

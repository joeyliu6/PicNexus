export async function appDataDir(): Promise<string> {
  return '/mock/appdata';
}

export async function homeDir(): Promise<string> {
  return '/mock/home';
}

export async function resolveResource(path: string): Promise<string> {
  return `/mock/resource/${path}`;
}

export async function join(...parts: string[]): Promise<string> {
  return parts.join('/').replace(/\/+/g, '/');
}

export async function basename(path: string): Promise<string> {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? '';
}

export async function dirname(path: string): Promise<string> {
  const parts = path.split(/[\\/]/).filter(Boolean);
  parts.pop();
  return `/${parts.join('/')}`;
}

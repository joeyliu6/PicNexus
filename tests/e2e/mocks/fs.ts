import { getState, record } from './state';

export const BaseDirectory = {
  AppData: 'AppData',
  AppConfig: 'AppConfig',
} as const;

export async function exists(path: string): Promise<boolean> {
  return Object.prototype.hasOwnProperty.call(getState().files, path);
}

export async function mkdir(): Promise<void> {}

/**
 * 原始字节读取，语义对齐 readTextFile（同一份内存文件表、同样的"不存在就抛错"）。
 * TextEncoder 只产出合法 UTF-8，所以 mdTextIo 的 fatal 解码必然成功——
 * 想覆盖非 UTF-8 分支得让 files 存字节而非字符串，那是另一层改造，此处不做。
 */
export async function readFile(path: string): Promise<Uint8Array> {
  record({ type: 'fs.readFile', path });
  if (!(await exists(path))) {
    throw new Error(`file not found: ${path}`);
  }
  return new TextEncoder().encode(getState().files[path]);
}

export async function readTextFile(path: string): Promise<string> {
  record({ type: 'fs.readTextFile', path });
  if (!(await exists(path))) {
    throw new Error(`file not found: ${path}`);
  }
  return getState().files[path];
}

export async function writeTextFile(path: string, contents: string): Promise<void> {
  record({ type: 'fs.writeTextFile', path, contents });
  const failure = getState().failWriteTextFile[path];
  if (failure) {
    delete getState().failWriteTextFile[path];
    throw new Error(failure);
  }
  getState().files[path] = contents;
}

export async function remove(path: string): Promise<void> {
  delete getState().files[path];
}

export async function readDir(): Promise<unknown[]> {
  return [];
}

export async function copyFile(): Promise<void> {}

export async function stat(): Promise<{ isFile: boolean; isDirectory: boolean; size: number }> {
  return { isFile: true, isDirectory: false, size: 0 };
}

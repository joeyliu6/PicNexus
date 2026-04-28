export interface Update {
  version: string;
  date?: string;
  body?: string;
  close: () => Promise<void>;
  downloadAndInstall: (handler?: (event: unknown) => void) => Promise<void>;
}

export async function check(): Promise<Update | null> {
  return null;
}

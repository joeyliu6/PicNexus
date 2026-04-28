import { getState, record } from './state';

export async function writeText(text: string): Promise<void> {
  record({ type: 'clipboard.writeText', text });
  getState().clipboardText = text;
}

export async function readText(): Promise<string> {
  record({ type: 'clipboard.readText' });
  return getState().clipboardText;
}

export async function writeImage(): Promise<void> {}

export async function readImage(): Promise<Uint8Array | null> {
  return null;
}

import { vi } from 'vitest';
import { getClipboardMocks } from './tauriMock';

export function resetClipboardMock(): void {
  const clipboard = getClipboardMocks();

  clipboard.writeText.mockReset();
  clipboard.readText.mockReset();
  clipboard.writeImage.mockReset();
  clipboard.readImage.mockReset();

  clipboard.writeText.mockResolvedValue(undefined);
  clipboard.readText.mockResolvedValue('');
  clipboard.writeImage.mockResolvedValue(undefined);
  clipboard.readImage.mockResolvedValue(undefined as never);
}

export function mockClipboardText(text: string): void {
  getClipboardMocks().readText.mockResolvedValue(text);
}

export function mockClipboardReadError(error: unknown): void {
  getClipboardMocks().readText.mockRejectedValue(error);
}

export function mockClipboardWriteError(error: unknown): void {
  getClipboardMocks().writeText.mockRejectedValue(error);
}

export function getClipboardTextWriteMock() {
  return vi.mocked(getClipboardMocks().writeText);
}

export function getClipboardTextReadMock() {
  return vi.mocked(getClipboardMocks().readText);
}

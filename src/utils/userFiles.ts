import { invoke } from '@tauri-apps/api/core';

interface FileDialogFilter {
  name: string;
  extensions: string[];
}

export async function exportTextFile(
  defaultPath: string,
  filters: FileDialogFilter[],
  content: string,
): Promise<string | null> {
  return await invoke<string | null>('export_text_file', {
    defaultPath,
    filters,
    content,
  });
}

export async function importTextFile(filters: FileDialogFilter[]): Promise<string | null> {
  return await invoke<string | null>('import_text_file', { filters });
}

export async function cleanupOwnedTempFile(path: string): Promise<boolean> {
  return await invoke<boolean>('cleanup_owned_temp_file', { path });
}

import { getState, record } from './state';

export async function open(options?: unknown): Promise<string[] | string | null> {
  record({ type: 'dialog.open', options });
  return getState().dialogOpenResult;
}

export async function save(options?: unknown): Promise<string | null> {
  record({ type: 'dialog.save', options });
  return '/mock/export.csv';
}

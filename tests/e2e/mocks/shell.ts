export async function open(): Promise<void> {}

export class Command {
  static sidecar(): Command {
    return new Command();
  }

  async execute(): Promise<{ code: number; stdout: string; stderr: string }> {
    return { code: 0, stdout: '', stderr: '' };
  }
}

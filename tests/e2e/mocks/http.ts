export async function fetch(): Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }> {
  return {
    ok: true,
    status: 200,
    async json() {
      return {};
    },
    async text() {
      return '';
    },
  };
}

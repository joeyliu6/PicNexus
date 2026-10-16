// Node 22.5 起自带的 SQLite（node:sqlite）。项目的 @types/node 还是 20.x，没有这个模块的类型，
// 这里只声明测试用到的部分。
declare module 'node:sqlite' {
  export interface StatementSync {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  }

  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}

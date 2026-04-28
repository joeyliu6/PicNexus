import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadMock } = vi.hoisted(() => ({
  loadMock: vi.fn(),
}));

// Keep plugin-sql local: this suite needs exact load timing and connection failures.
vi.mock('@tauri-apps/plugin-sql', () => ({
  default: {
    load: loadMock,
  },
}));

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const { ConnectionManager } = await import('../../../../services/database/ConnectionManager');

function makeDb(label: string) {
  return {
    label,
    select: vi.fn().mockResolvedValue([{ v: 1 }]),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ConnectionManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the database only once when open is called repeatedly', async () => {
    const db = makeDb('primary');
    const initializer = vi.fn().mockResolvedValue(undefined);
    loadMock.mockResolvedValue(db);
    const manager = new ConnectionManager('sqlite:test.db', initializer);

    await manager.open();
    await manager.open();

    expect(loadMock).toHaveBeenCalledTimes(1);
    expect(initializer).toHaveBeenCalledTimes(1);
    expect(manager.isInitialized()).toBe(true);
  });

  it('deduplicates concurrent getDb calls while the first open is still in flight', async () => {
    const deferred = createDeferred<ReturnType<typeof makeDb>>();
    const initializer = vi.fn().mockResolvedValue(undefined);
    loadMock.mockReturnValueOnce(deferred.promise);
    const manager = new ConnectionManager('sqlite:test.db', initializer);

    const first = manager.getDb();
    const second = manager.getDb();

    expect(loadMock).toHaveBeenCalledTimes(1);
    deferred.resolve(makeDb('shared'));

    const [dbA, dbB] = await Promise.all([first, second]);

    expect(dbA).toBe(dbB);
    expect(initializer).toHaveBeenCalledTimes(1);
  });

  it('closes the current connection and can reopen a fresh one after close', async () => {
    const db1 = makeDb('first');
    const db2 = makeDb('second');
    const initializer = vi.fn().mockResolvedValue(undefined);
    loadMock.mockResolvedValueOnce(db1).mockResolvedValueOnce(db2);
    const manager = new ConnectionManager('sqlite:test.db', initializer);

    await manager.open();
    await manager.close();

    expect(db1.close).toHaveBeenCalledTimes(1);
    expect(manager.isInitialized()).toBe(false);

    const reopened = await manager.getDb();

    expect(reopened).toBe(db2);
    expect(loadMock).toHaveBeenCalledTimes(2);
    expect(initializer).toHaveBeenCalledTimes(2);
  });

  it('recovers cleanly from an initializer failure so a later retry can succeed', async () => {
    const brokenDb = makeDb('broken');
    const healthyDb = makeDb('healthy');
    const initializer = vi.fn()
      .mockRejectedValueOnce(new Error('migration failed'))
      .mockResolvedValueOnce(undefined);
    loadMock.mockResolvedValueOnce(brokenDb).mockResolvedValueOnce(healthyDb);
    const manager = new ConnectionManager('sqlite:test.db', initializer);

    await expect(manager.getDb()).rejects.toThrow('migration failed');

    expect(brokenDb.close).toHaveBeenCalledTimes(1);
    expect(manager.isInitialized()).toBe(false);

    const db = await manager.getDb();

    expect(db).toBe(healthyDb);
    expect(loadMock).toHaveBeenCalledTimes(2);
    expect(initializer).toHaveBeenCalledTimes(2);
  });

  it('throttles connection health checks and only probes again after the interval elapses', async () => {
    const db = makeDb('primary');
    const initializer = vi.fn().mockResolvedValue(undefined);
    loadMock.mockResolvedValue(db);
    const manager = new ConnectionManager('sqlite:test.db', initializer);
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    await manager.open();
    await manager.getDb();

    expect(db.select).not.toHaveBeenCalled();

    now = 40_000;
    await manager.getDb();
    expect(db.select).toHaveBeenCalledTimes(1);

    now = 50_000;
    await manager.getDb();
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('reopens the database when the periodic health check detects a broken connection', async () => {
    const staleDb = makeDb('stale');
    staleDb.select.mockRejectedValueOnce(new Error('connection lost'));
    const freshDb = makeDb('fresh');
    const initializer = vi.fn().mockResolvedValue(undefined);
    loadMock.mockResolvedValueOnce(staleDb).mockResolvedValueOnce(freshDb);
    const manager = new ConnectionManager('sqlite:test.db', initializer);
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    await manager.open();

    now = 40_000;
    const db = await manager.getDb();

    expect(staleDb.close).toHaveBeenCalledTimes(1);
    expect(loadMock).toHaveBeenCalledTimes(2);
    expect(initializer).toHaveBeenCalledTimes(2);
    expect(db).toBe(freshDb);
  });
});

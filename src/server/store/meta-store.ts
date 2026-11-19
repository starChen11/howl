/**
 * 跨对局状态的**唯一出口**（RFC-008 §2.4 / ARCH-7）。
 *
 * 接口是异步的，即使内存实现可以同步——将来换持久实现时不必改调用方签名。
 *
 * 返回**副本**：调用方改返回值不能影响存储里的那份。否则「存储」会变成一块人人可写的
 * 共享内存，而 `ARCH-9` 要求事件流是唯一权威。
 */
export interface MetaStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
}

/** v1 的内存实现。键空间前缀 `session:`。 */
export class InMemoryMetaStore implements MetaStore {
  private readonly data = new Map<string, string>();

  async get<T>(key: string): Promise<T | undefined> {
    const raw = this.data.get(key);
    return raw === undefined ? undefined : (structuredClone(JSON.parse(raw)) as T);
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async keys(prefix: string): Promise<string[]> {
    return [...this.data.keys()].filter((key) => key.startsWith(prefix)).sort();
  }
}

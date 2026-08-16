// 字段级密文的换钥匙搬运
//
// 背景：`secureStorage` 是单例、**只有一把钥匙**。整份 `.settings.dat` 的外层加密，
// 和 config 里 `passwordEncrypted` 这类内层字段密文，用的是同一个 `this.key`。
// 设置 / 修改 / 停用备份密码会换掉这把钥匙，只重写外层信封的话内层密文就成了孤儿——
// 能解开它的钥匙已经不存在了（`set_secure_key` 覆盖且无备份）。
//
// ⚠️ 不建"需要搬运的字段"登记表。登记表迟早会漏登记一个新字段，而漏了是静默的：
// 用户看到的只是密码莫名其妙没了。这里改成按加密魔数前缀深度遍历——
// `isAnyEncryptedData` 认的是 `PNXENC:` / `PNXPWD:`，遍历一遍就不可能漏。
// 因此**新增字段级密文不需要来这里登记**，只要它走 `secureStorage.encrypt` 就自动被覆盖。

import { secureStorage, isAnyEncryptedData } from './crypto';
import { createLogger } from '../utils/logger';

const log = createLogger('FieldSecrets');

/**
 * 遍历深度上限
 *
 * 快照来自 `JSON.parse`，结构上不可能有环，这个上限只是防"配置被写进了意料之外的
 * 深层嵌套"时无限递归。真实配置最深也就 4 层（config → webdav → profiles → [i]）。
 */
const MAX_DEPTH = 16;

interface SecretSlot {
  /** JSON 路径，如 `config.webdav_profiles[0].passwordEncrypted`，只用于日志与命名 */
  path: string;
  /** 密文所在的容器，写回时就地改 */
  owner: Record<string, unknown> | unknown[];
  key: string | number;
  ciphertext: string;
}

export interface RekeyReport {
  /** 成功用新钥匙重新加密的条数 */
  migrated: number;
  /**
   * 旧钥匙也解不开的（存量孤儿），原样保留未改写
   *
   * 元素是**给用户看的名字**（如 `WebDAV 图床「我的 OpenList」`），不是 JSON 路径：
   * 调用方要拿它直接进 toast 让用户去重填，路径对用户没有意义。
   * 排查用的精确路径写在 `log.warn` 里。
   */
  orphans: string[];
}

function isPlainContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === 'object' && value !== null;
}

/**
 * 深度遍历快照，找出所有带加密魔数前缀的字符串
 */
function collectSecretSlots(root: unknown, path = '', depth = 0): SecretSlot[] {
  if (depth > MAX_DEPTH || !isPlainContainer(root)) return [];

  const slots: SecretSlot[] = [];
  const entries: Array<[string | number, unknown]> = Array.isArray(root)
    ? root.map((value, index) => [index, value])
    : Object.entries(root);

  for (const [key, value] of entries) {
    const childPath = Array.isArray(root) ? `${path}[${key}]` : path ? `${path}.${key}` : String(key);

    if (typeof value === 'string') {
      if (isAnyEncryptedData(value)) {
        slots.push({ path: childPath, owner: root, key, ciphertext: value });
      }
      continue;
    }

    slots.push(...collectSecretSlots(value, childPath, depth + 1));
  }

  return slots;
}

/**
 * 给用户看的名字，如 `WebDAV 图床「我的 OpenList」`
 *
 * slot 的 `owner` 就是 profile 对象本身，直接读它的 `name`；读不到就退回路径。
 */
function describeSlot(slot: SecretSlot): string {
  const owner = slot.owner as { name?: unknown };
  const name = typeof owner.name === 'string' && owner.name ? owner.name : slot.path;

  if (slot.path.includes('webdav_profiles')) return `WebDAV 图床「${name}」`;
  if (slot.path.includes('webdav')) return `WebDAV 备份「${name}」`;
  return `配置项「${name}」`;
}

/**
 * 换钥匙 + 搬运内层密文
 *
 * ⚠️ **`swap` 由本函数调用，不要在外面先换好再进来。** 内层密文只能用旧钥匙解开，
 * 把换钥匙这一步收进来，"先解开、再换、再锁上"的顺序就从结构上不可能写反——
 * 这正是本模块存在的理由。
 *
 * @param snapshots 已解密的 store 快照（`readRawAll()` 的返回值），**会被就地修改**
 * @param swap 真正换钥匙的动作（`setBackupPassword` / `clearBackupPassword`）
 * @throws swap 本身抛出的错误，或换钥匙后重新加密失败——两种情况调用方都要回滚钥匙
 */
export async function rekeyFieldSecrets(
  snapshots: unknown[],
  swap: () => Promise<void>
): Promise<RekeyReport> {
  const slots = snapshots.flatMap(snapshot => collectSecretSlots(snapshot));

  // 1. 换钥匙**之前**用旧钥匙解开。解不开的原样留着——它已经是孤儿了，
  //    清掉只会让用户连"这里配过东西"都看不出来
  const carried: Array<{ slot: SecretSlot; plaintext: string }> = [];
  const orphanSlots: SecretSlot[] = [];

  for (const slot of slots) {
    try {
      carried.push({ slot, plaintext: await secureStorage.decrypt(slot.ciphertext) });
    } catch {
      orphanSlots.push(slot);
    }
  }

  // 2. 换钥匙
  await swap();

  // 3. 用新钥匙全部算完再统一写回：中途失败时快照不留半新半旧，
  //    调用方回滚钥匙后原样丢弃即可
  const reencrypted: Array<{ slot: SecretSlot; ciphertext: string }> = [];
  for (const { slot, plaintext } of carried) {
    reencrypted.push({ slot, ciphertext: await secureStorage.encrypt(plaintext) });
  }

  for (const { slot, ciphertext } of reencrypted) {
    (slot.owner as Record<string | number, unknown>)[slot.key] = ciphertext;
  }

  if (orphanSlots.length > 0) {
    // 日志留精确路径（排查用），返回值给用户看的名字（重填用），两边各取所需
    log.warn(`${orphanSlots.length} 处字段级密文旧钥匙也解不开，已原样保留：${orphanSlots.map(s => s.path).join('、')}`);
  }
  // 带上"共发现几处"：只报搬运数的话，「压根没找到这个字段」和
  // 「找到了但解不开」在日志里长得一样，排查时分不出来
  log.info(`✓ 字段级密文搬运完成：共发现 ${slots.length} 处，${reencrypted.length} 条已换新钥匙`);

  return { migrated: reencrypted.length, orphans: orphanSlots.map(describeSlot) };
}

/**
 * 探测并清空存量孤儿密文，返回给用户看的名字列表
 *
 * ⚠️ **调用方必须已经成功读出配置**——外层信封开得了就说明钥匙是对的，
 * 此时内层还解不开才能判定为孤儿。在钥匙未就位时调用会把一切误判成孤儿并清空。
 *
 * Why 清空而不是打标记：清空之后 `passwordEncrypted` 变空串，
 * 密码框的「已保存」芯片、设置页可用判定、服务选择器可用判定全都自动回到「未配置」，
 * 一处判定逻辑都不用改。孤儿密文本身已经是块砖头，留着也开不了。
 */
export async function purgeOrphanFieldSecrets(snapshot: unknown): Promise<string[]> {
  const cleared: string[] = [];

  for (const slot of collectSecretSlots(snapshot)) {
    try {
      await secureStorage.decrypt(slot.ciphertext);
    } catch {
      (slot.owner as Record<string | number, unknown>)[slot.key] = '';
      cleared.push(describeSlot(slot));
    }
  }

  if (cleared.length > 0) {
    log.warn(`清空 ${cleared.length} 处无法解密的字段级密文：${cleared.join('、')}`);
  }

  return cleared;
}

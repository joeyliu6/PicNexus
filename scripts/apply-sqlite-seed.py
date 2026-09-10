"""把 seed-tauri-e2e-portable.mjs 生成的 DDL + 行数据写进 SQLite。

单独拆成 Python 是因为 Node 20（本项目 CI 与类型声明的目标版本）没有内置 sqlite，
而 `tests/tauri-e2e/scan-history-fix-acceptance.tauri.e2e.cjs` 本来就依赖 PATH 里的
python，所以这里不引入新依赖。

用法：python scripts/apply-sqlite-seed.py <db_path> <payload_json_path>

payload 形状：{"ddl": ["CREATE TABLE ...", ...], "columns": [...], "rows": [[...], ...]}
行数据走参数化绑定，不拼 SQL 字符串。
"""

import json
import sqlite3
import sys


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2

    db_path, payload_path = sys.argv[1], sys.argv[2]

    with open(payload_path, "r", encoding="utf-8") as fh:
        payload = json.load(fh)

    ddl = payload["ddl"]
    columns = payload["columns"]
    rows = payload["rows"]

    if not ddl:
        print("payload 里没有 DDL，拒绝继续", file=sys.stderr)
        return 1

    con = sqlite3.connect(db_path)
    try:
        cur = con.cursor()
        for statement in ddl:
            cur.execute(statement)

        # 幂等：只清掉本脚本造的行，不碰别的
        cur.execute("DELETE FROM history_items WHERE id LIKE 'e2e-%'")

        placeholders = ", ".join("?" for _ in columns)
        cur.executemany(
            f"INSERT INTO history_items ({', '.join(columns)}) VALUES ({placeholders})",
            rows,
        )
        con.commit()

        count = cur.execute(
            "SELECT COUNT(*) FROM history_items WHERE id LIKE 'e2e-%'"
        ).fetchone()[0]
        print(count)
    finally:
        con.close()

    return 0


if __name__ == "__main__":
    sys.exit(main())

import type { Repo, Table } from '@/core/data/repo.ts';
import type { TableMap, TableName } from '@/core/types.ts';

/** Envolve o repositório e avisa a interface sempre que algo é gravado. */
export function observable(repo: Repo, onWrite: (table: TableName) => void): Repo {
  return {
    mode: repo.mode,
    userId: repo.userId,
    searchMemories: (q, l) => repo.searchMemories(q, l),
    searchConversations: (q, l) => repo.searchConversations(q, l),
    table<K extends TableName>(name: K): Table<TableMap[K]> {
      const t = repo.table(name);
      return {
        list: (q) => t.list(q),
        get: (id) => t.get(id),
        insert: async (row) => {
          const r = await t.insert(row);
          onWrite(name);
          return r;
        },
        update: async (id, patch) => {
          const r = await t.update(id, patch);
          onWrite(name);
          return r;
        },
        remove: async (id) => {
          await t.remove(id);
          onWrite(name);
        },
      };
    },
  };
}

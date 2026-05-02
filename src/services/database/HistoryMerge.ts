import type { HistoryItem } from '../../config/types';

interface FavoriteVersion {
  isFavorited: boolean;
  updatedAt: number;
  updatedBy: string;
}

export interface HistoryCollectionMergeResult {
  items: HistoryItem[];
  addedCount: number;
  updatedCount: number;
}

function normalizeFavoriteVersion(item: HistoryItem): FavoriteVersion | null {
  if (
    typeof item.favoriteUpdatedAt === 'number'
    && Number.isFinite(item.favoriteUpdatedAt)
    && item.favoriteUpdatedAt > 0
  ) {
    return {
      isFavorited: item.isFavorited === true,
      updatedAt: item.favoriteUpdatedAt,
      updatedBy: item.favoriteUpdatedBy?.trim() || 'unknown',
    };
  }

  if (item.isFavorited === true && Number.isFinite(item.timestamp) && item.timestamp > 0) {
    return {
      isFavorited: true,
      updatedAt: item.timestamp,
      updatedBy: 'legacy',
    };
  }

  return null;
}

function compareFavoriteVersion(a: FavoriteVersion, b: FavoriteVersion): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt;
  if (a.updatedBy === b.updatedBy) return 0;
  return a.updatedBy > b.updatedBy ? 1 : -1;
}

function pickFavoriteWinner(a: HistoryItem, b: HistoryItem): FavoriteVersion | null {
  const aVersion = normalizeFavoriteVersion(a);
  const bVersion = normalizeFavoriteVersion(b);

  if (aVersion && bVersion) {
    return compareFavoriteVersion(aVersion, bVersion) >= 0 ? aVersion : bVersion;
  }
  if (aVersion) return aVersion;
  if (bVersion) return bVersion;

  if (a.isFavorited === true || b.isFavorited === true) {
    return {
      isFavorited: true,
      updatedAt: 0,
      updatedBy: 'legacy',
    };
  }
  return null;
}

function applyFavorite(item: HistoryItem, favorite: FavoriteVersion | null): HistoryItem {
  if (!favorite) {
    const { favoriteUpdatedAt: _at, favoriteUpdatedBy: _by, ...rest } = item;
    return { ...rest, isFavorited: false };
  }

  return {
    ...item,
    isFavorited: favorite.isFavorited,
    favoriteUpdatedAt: favorite.updatedAt > 0 ? favorite.updatedAt : undefined,
    favoriteUpdatedBy: favorite.updatedAt > 0 ? favorite.updatedBy : undefined,
  };
}

export function mergeHistoryItem(existing: HistoryItem, incoming: HistoryItem): HistoryItem {
  const historyWinner = incoming.timestamp > existing.timestamp ? incoming : existing;
  return applyFavorite({ ...historyWinner }, pickFavoriteWinner(existing, incoming));
}

function favoriteSignature(item: HistoryItem): string {
  const normalized = normalizeFavoriteVersion(item);
  if (!normalized) return `${item.isFavorited === true}:0:`;
  return `${normalized.isFavorited}:${normalized.updatedAt}:${normalized.updatedBy}`;
}

export function hasHistoryItemChanged(before: HistoryItem, after: HistoryItem): boolean {
  return before.timestamp !== after.timestamp || favoriteSignature(before) !== favoriteSignature(after);
}

export function mergeHistoryCollections(
  baseItems: HistoryItem[],
  incomingItems: HistoryItem[],
): HistoryCollectionMergeResult {
  const itemMap = new Map<string, HistoryItem>();
  let addedCount = 0;
  let updatedCount = 0;

  for (const item of baseItems) {
    if (item.id) itemMap.set(item.id, item);
  }

  for (const item of incomingItems) {
    if (!item.id) continue;

    const existing = itemMap.get(item.id);
    if (!existing) {
      itemMap.set(item.id, item);
      addedCount += 1;
      continue;
    }

    const merged = mergeHistoryItem(existing, item);
    if (hasHistoryItemChanged(existing, merged)) {
      updatedCount += 1;
      itemMap.set(item.id, merged);
    }
  }

  const items = Array.from(itemMap.values());
  items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  return { items, addedCount, updatedCount };
}

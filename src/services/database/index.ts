/**
 * 数据库服务层统一入口
 *
 * 这里用 `export *` 而不是逐个列举导出，是有教训的：
 * 逐个列举过一次，结果 barrel 落后于实现——少了 DayStats、DayStatsFilter、
 * FavoritesMetaPageOptions、FavoritesMetaPageResult 四个类型。消费方需要它们，
 * 就绕开这里改走 src/services/HistoryDatabase.ts 那个导出更全的兼容垫片，
 * 于是同一个数据库长出了两个入口，文档指向一个、代码走另一个。
 *
 * `export *` 永远跟得上实现，不需要有人记得同步。
 */
export * from './HistoryDatabase';

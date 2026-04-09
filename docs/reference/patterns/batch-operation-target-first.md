# 批量操作 UI 模式：选目标→自动算范围

## 适用场景

当用户需要对大量数据执行"从 A 搬到 B"类型的批量操作时，比如：
- 批量迁移图片到其他图床
- 批量导出数据到其他平台
- 批量同步文件到其他存储

传统做法是让用户先"选范围"（选哪些数据），再"选目标"（搬到哪里）。这种两步流程在范围维度复杂时容易让用户困惑。

## 模式说明

### 核心思想

**让用户只做一个决策：选目标。系统自动反推范围。**

传统流程：
```
1. 选范围（哪些数据要操作？） → 用户困惑
2. 选目标（操作到哪里？）
```

新流程：
```
1. 选目标（你想让数据存到哪？）→ 系统自动计算"还没在目标上的数据数量"
```

### 为什么有效

"选范围"和"选目标"本来就不是独立的两个决策——目标确定后，范围自动确定（"不在目标上的就是要操作的"）。把它们合并可以：

1. 减少一步决策，降低认知负担
2. 避免"备份数量"等技术概念暴露给用户
3. 让数字更直观（"27784 张待迁移"比"仅 1 个图床 32738"更好理解）

### 高级筛选作为可选项

如果确实需要精细控制（比如"只迁移备份少于 3 个图床的图片"），把它放在**折叠的高级筛选**里：

```
[目标图床卡片网格]

▸ 高级筛选（按备份数量过滤）
  展开后: 仅迁移备份少于 [▾ 全部] 个图床的图片
```

默认值设为"全部"（不筛选），90% 的用户不需要展开。

## 代码示例

### Composable 层

```ts
// 选目标图床后，自动查询每个图床的待迁移数
async function applyFilter() {
  const [{ total }, existingMap] = await Promise.all([
    historyDB.getItemsByBackupCount({ maxSuccessCount: threshold, limit: 1, offset: 0 }),
    historyDB.getServiceDistribution({ maxSuccessCount: threshold }),
  ]);

  for (const svc of targetServices.value) {
    if (svc.isConfigured) {
      const existing = existingMap.get(svc.serviceId) || 0;
      svc.pendingCount = total - existing; // 自动算出待迁移数
    }
  }
}
```

### 组件层

```vue
<!-- 用户勾选卡片，底栏自动联动 -->
<div class="service-grid">
  <label v-for="svc in configuredServices" class="service-card">
    <input v-model="svc.checked" type="checkbox" />
    <span class="count">{{ svc.pendingCount }}</span>
    <span>张图片待迁移</span>
  </label>
</div>

<!-- 底栏实时反映勾选结果 -->
<div class="bottom-bar">
  {{ totalPending }} 张待迁移 → {{ checkedNames }}
  <button @click="startMigrate">开始迁移</button>
</div>
```

## 注意事项

1. **pendingCount 需要实时联动**：用户切换高级筛选门槛时，每个卡片的数字要跟着变
2. **空状态要处理好**：没有已配置图床 / 全部已备份 / 历史记录为空，三种情况
3. **自动预勾选**：如果只有 1 个已配置图床，自动勾选，减少一次点击
4. **未配置图床的处理**：不是隐藏，而是折叠为 "+N 未配置 去设置→" 的入口卡片，保持可发现性

## 设计决策记录

这个模式是在 PicNexus 批量迁移功能的设计迭代中总结出来的：

1. 最初设计：5 步流程（idle → selecting → configuring → migrating → done）
2. 发现"迁移范围"（按备份数量 1/2/全部筛选）让用户困惑——筛选维度是包含关系而非互斥
3. 用第一性原理分析：用户的真实意图是"让图片存到京东"，不是"迁移只有 1 个图床的图片"
4. 合并为 2 步：选目标 → 执行，把备份数量筛选降级为可选的高级筛选

## 相关文件

- `src/composables/useBatchMigrate.ts` — 批量迁移管理器
- `src/components/views/linkcheck/BatchMigratePanel.vue` — 批量迁移面板 UI
- `src/types/batchMigrate.ts` — 类型定义

// 聚合导出 - 所有外部导入路径 `from '../config/types'` 保持不变
//
// 拆分后的子模块：
//   serviceTypes.ts     — 图床服务相关类型、常量、工具函数
//   compressionTypes.ts — 压缩相关类型和默认预设
//   historyTypes.ts     — 历史记录、元数据、同步状态等类型
//   configInterface.ts  — UserConfig 主接口及其依赖的小型接口
//   defaults.ts         — DEFAULT_CONFIG 常量和 getActivePrefix 函数
//   validators.ts       — 验证、清洗函数

export * from './serviceTypes';
export * from './compressionTypes';
export * from './historyTypes';
export * from './configInterface';
export * from './defaults';
export * from './validators';

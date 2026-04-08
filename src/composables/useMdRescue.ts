// 向后兼容：重新导出拆分后的模块
// 所有消费方仍可从 './useMdRescue' 导入

export { useMdRescueManager } from './md-rescue/useMdRescue';

// 类型重导出
export type {
  MdImageLinkWithFile,
  RescuePhase,
  FileHealth,
  RepairStrategy,
  RepairReceipt,
} from './md-rescue/shared';

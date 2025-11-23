// util polyfill for browser compatibility
// 为浏览器环境提供 Node.js util 模块的简单实现

const debuglog = (() => {
  return () => {
    // 空函数，不执行任何操作
  };
})();

const inspect = (obj: any, _options?: any): string => {
  try {
    return JSON.stringify(obj, null, 2);
  } catch (e) {
    return String(obj);
  }
};

// 导出对象，模拟 Node.js util 模块
// 支持多种导入方式：import * as util from 'util' 或 import util from 'util'
export { debuglog, inspect };

// 默认导出，支持 import util from 'util'
export default {
  debuglog,
  inspect,
};


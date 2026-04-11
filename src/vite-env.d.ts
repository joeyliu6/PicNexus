/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Vite 官方生成的 SFC 声明模板签名，any 不可避免
  const component: DefineComponent<object, object, any>
  export default component
}


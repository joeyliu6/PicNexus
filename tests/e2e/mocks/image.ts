// @tauri-apps/api/image 的模拟：托盘图标与状态行小图标的像素不在测试范围里
export class Image {
  private constructor(readonly width: number, readonly height: number) {}

  static async new(_rgba: Uint8Array, width: number, height: number): Promise<Image> {
    return new Image(width, height);
  }

  async close(): Promise<void> {}
}

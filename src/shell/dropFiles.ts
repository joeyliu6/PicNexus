// 拖入窗口的文件分拣（HomeScreen.dc.html H07）：哪些是图片会上传，哪些会被跳过（提前说明）
import { VALID_IMAGE_EXTENSIONS } from '@/composables/upload/FileValidator';

export interface DropSummary {
  images: string[];
  skipped: string[];
  /** 「包含 1 个 .zip 文件，将被跳过」/「包含 3 个非图片文件，将被跳过」；没有跳过的为空 */
  skippedText: string;
}

function extensionOf(path: string): string {
  const name = path.split(/[\/]/).pop() ?? path;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function summarizeDrop(paths: readonly string[]): DropSummary {
  const images: string[] = [];
  const skipped: string[] = [];
  for (const path of paths) {
    if ((VALID_IMAGE_EXTENSIONS as readonly string[]).includes(extensionOf(path))) images.push(path);
    else skipped.push(path);
  }
  const exts = [...new Set(skipped.map(extensionOf))];
  const skippedText = skipped.length === 0
    ? ''
    : exts.length === 1 && exts[0]
      ? `包含 ${skipped.length} 个 .${exts[0]} 文件，将被跳过`
      : `包含 ${skipped.length} 个非图片文件，将被跳过`;
  return { images, skipped, skippedText };
}

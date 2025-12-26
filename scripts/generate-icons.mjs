/**
 * 图标生成脚本
 * 从 SVG 一键生成所有平台所需的图标格式
 *
 * 运行: node scripts/generate-icons.mjs
 */

import iconGen from 'icon-gen';
import sharp from 'sharp';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '../src-tauri/icons');
const svgPath = join(iconsDir, 'icon.svg');

async function generateIcons() {
  console.log('🎨 开始生成图标...\n');

  // 使用 icon-gen 生成 ICO 和 ICNS
  await iconGen(svgPath, iconsDir, {
    report: true,
    ico: {
      name: 'icon',
      sizes: [16, 24, 32, 48, 64, 128, 256]
    },
    icns: {
      name: 'icon',
      sizes: [16, 32, 64, 128, 256, 512, 1024]
    }
  });

  // 使用 sharp 生成 Tauri 需要的 PNG 文件
  const svgBuffer = readFileSync(svgPath);
  const pngSizes = [
    { name: '32x32.png', size: 32 },
    { name: '128x128.png', size: 128 },
    { name: '128x128@2x.png', size: 256 },
    { name: 'icon.png', size: 512 },
  ];

  for (const { name, size } of pngSizes) {
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(join(iconsDir, name));
    console.log(`✅ 生成 ${name}`);
  }

  console.log('\n🎉 所有图标生成完成！');
}

generateIcons().catch(console.error);

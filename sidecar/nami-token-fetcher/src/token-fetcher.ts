import puppeteer, { Browser, Page } from 'puppeteer-core';
import { detectChromePath } from './browser-detector';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as zlib from 'zlib';

const NAMI_PAGE_URL = 'https://www.n.cn';

export interface NamiDynamicHeaders {
  accessToken: string;
  zmToken: string;
  zmUa: string;
  timestamp: string;
  sid: string;
  mid: string;
  requestId: string;
  headerTid: string;
}

interface NamiConfig {
  cookie: string;
  authToken: string;
}

/**
 * CRC32 查找表
 */
let crc32Table: Uint32Array | null = null;

function getCrc32Table(): Uint32Array {
  if (!crc32Table) {
    crc32Table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      crc32Table[i] = c;
    }
  }
  return crc32Table;
}

/**
 * 计算 CRC32
 */
function crc32(buffer: Buffer): number {
  let crc = 0xFFFFFFFF;
  const table = getCrc32Table();
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buffer[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * 创建 PNG chunk
 */
function createPngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const crcData = Buffer.concat([typeBuffer, data]);
  const crcValue = crc32(crcData);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crcValue, 0);

  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

/**
 * 创建临时测试图片 (1x1 PNG，唯一颜色)
 */
function createTempImage(): Buffer {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 0xFFFFFF);
  const seed = (timestamp ^ random) & 0xFFFFFF;

  const r = (seed >> 16) & 0xFF;
  const g = (seed >> 8) & 0xFF;
  const b = seed & 0xFF;

  console.error(`[NamiToken] 生成唯一图片: RGB(${r}, ${g}, ${b})`);

  const chunks: Buffer[] = [];

  // PNG Signature
  chunks.push(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));

  // IHDR chunk: 1x1, 8-bit RGB
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);  // width
  ihdr.writeUInt32BE(1, 4);  // height
  ihdr.writeUInt8(8, 8);     // bit depth
  ihdr.writeUInt8(2, 9);     // color type (RGB)
  ihdr.writeUInt8(0, 10);    // compression
  ihdr.writeUInt8(0, 11);    // filter
  ihdr.writeUInt8(0, 12);    // interlace
  chunks.push(createPngChunk('IHDR', ihdr));

  // IDAT chunk
  const rawData = Buffer.from([0, r, g, b]);
  const compressedData = zlib.deflateSync(rawData);
  chunks.push(createPngChunk('IDAT', compressedData));

  // IEND chunk
  chunks.push(createPngChunk('IEND', Buffer.alloc(0)));

  return Buffer.concat(chunks);
}

/**
 * 解析 Cookie 字符串为对象数组
 */
function parseCookies(cookieString: string): Array<{ name: string; value: string; domain: string; path: string }> {
  return cookieString.split(';').map(pair => {
    const [name, ...valueParts] = pair.trim().split('=');
    return {
      name: name.trim(),
      value: valueParts.join('='),
      domain: '.n.cn',
      path: '/',
    };
  }).filter(c => c.name && c.value);
}

/**
 * 清理临时文件
 */
function cleanupTempFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.error(`[NamiToken] 已删除临时文件: ${filePath}`);
    }
  } catch (e) {
    // 忽略删除失败
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 从纳米页面获取动态 Headers
 * 通过 CDP 监听 /api/byte/assumerole 请求来捕获动态生成的 headers
 */
export async function fetchNamiToken(config: NamiConfig): Promise<NamiDynamicHeaders> {
  console.error('[NamiToken] ========== 开始获取动态 Token ==========');

  const browserInfo = detectChromePath();
  if (!browserInfo) {
    throw new Error('未检测到 Chrome 或 Edge 浏览器');
  }

  console.error(`[NamiToken] 使用浏览器: ${browserInfo.name} (${browserInfo.path})`);

  let browser: Browser | null = null;
  let tempImagePath: string | null = null;

  try {
    // 创建临时测试图片
    const tempDir = os.tmpdir();
    tempImagePath = path.join(tempDir, `nami-test-${Date.now()}.png`);
    const tempImageBuffer = createTempImage();
    fs.writeFileSync(tempImagePath, tempImageBuffer);
    console.error(`[NamiToken] 创建临时测试图片: ${tempImagePath}`);

    browser = await puppeteer.launch({
      executablePath: browserInfo.path,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',
        '--window-size=1280,720'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    // 设置 User-Agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36');

    // 注入 Cookie
    console.error('[NamiToken] 注入 Cookie...');
    const cookies = parseCookies(config.cookie);
    await page.setCookie(...cookies);

    // 创建 CDP Session 用于监听网络请求
    const client = await page.createCDPSession();
    await client.send('Network.enable');

    // 存储捕获的 Headers
    let capturedHeaders: NamiDynamicHeaders | null = null;

    // 监听请求
    const tokenPromise = new Promise<NamiDynamicHeaders>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('获取 Token 超时 (30秒)'));
      }, 30000);

      client.on('Network.requestWillBeSent', (params: any) => {
        const url = params.request.url;

        // 捕获 assumerole 请求的 headers
        if (url.includes('/api/byte/assumerole')) {
          console.error('[NamiToken] 捕获到 assumerole 请求!');

          const headers = params.request.headers;

          const result: NamiDynamicHeaders = {
            accessToken: headers['access-token'] || '',
            zmToken: headers['zm-token'] || '',
            zmUa: headers['zm-ua'] || '',
            timestamp: headers['timestamp'] || '',
            sid: headers['sid'] || '',
            mid: headers['mid'] || '',
            requestId: headers['request-id'] || '',
            headerTid: headers['header-tid'] || '',
          };

          console.error('[NamiToken] Headers 捕获成功', {
            accessToken: result.accessToken ? result.accessToken.substring(0, 20) + '...' : '(empty)',
            zmToken: result.zmToken ? result.zmToken.substring(0, 20) + '...' : '(empty)',
          });

          clearTimeout(timeout);
          resolve(result);
        }
      });
    });

    // 导航到纳米页面
    console.error(`[NamiToken] 正在打开纳米页面: ${NAMI_PAGE_URL}`);
    await page.goto(NAMI_PAGE_URL, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // 等待页面完全加载
    console.error('[NamiToken] 等待页面完全加载 (3秒)...');
    await sleep(3000);

    // 查找文件输入框并上传
    console.error('[NamiToken] 查找文件输入框...');
    const fileInputs = await page.$$('input[type="file"]');
    console.error(`[NamiToken] 找到 ${fileInputs.length} 个文件输入框`);

    if (fileInputs.length === 0) {
      // 尝试点击上传按钮触发文件选择
      console.error('[NamiToken] 尝试点击上传按钮...');
      const uploadSelectors = [
        '#Tag_UploadImgButton',
        '.upload-btn',
        '[class*="upload"]',
        'button[class*="upload"]',
        '.ant-upload',
      ];

      for (const selector of uploadSelectors) {
        const btn = await page.$(selector);
        if (btn) {
          await btn.click();
          console.error(`[NamiToken] 点击了 ${selector}`);
          await sleep(1000);
          break;
        }
      }

      // 重新查找文件输入框
      const newFileInputs = await page.$$('input[type="file"]');
      if (newFileInputs.length === 0) {
        throw new Error('未找到文件输入框');
      }
      fileInputs.push(...newFileInputs);
    }

    // 尝试每个文件输入框
    for (let i = 0; i < fileInputs.length; i++) {
      const fileInput = fileInputs[i];
      console.error(`[NamiToken] 尝试使用第 ${i + 1} 个文件输入框上传...`);

      try {
        await fileInput.uploadFile(tempImagePath);
        console.error(`[NamiToken] 已设置文件到第 ${i + 1} 个输入框`);

        // 手动触发 change 事件
        await fileInput.evaluate((el: any) => {
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        });

        await sleep(2000);
      } catch (e: any) {
        console.error(`[NamiToken] 第 ${i + 1} 个输入框失败: ${e.message}`);
      }
    }

    // 等待捕获 Headers
    console.error('[NamiToken] 等待 Headers 捕获...');

    try {
      capturedHeaders = await Promise.race([
        tokenPromise,
        new Promise<NamiDynamicHeaders>((_, reject) =>
          setTimeout(() => reject(new Error('等待超时')), 15000)
        )
      ]);
    } catch (e) {
      console.error('[NamiToken] 第一次尝试失败，重试点击上传按钮...');

      // 重试：点击上传按钮
      const uploadButton = await page.$('#Tag_UploadImgButton');
      if (uploadButton) {
        await uploadButton.click();
        await sleep(2000);
      }

      // 再次等待
      capturedHeaders = await tokenPromise;
    }

    if (!capturedHeaders) {
      throw new Error('无法捕获动态 Headers，请检查 Cookie 是否有效');
    }

    console.error('[NamiToken] ========== Token 获取成功 ==========');
    return capturedHeaders;

  } finally {
    if (browser) {
      await browser.close();
    }
    if (tempImagePath) {
      cleanupTempFile(tempImagePath);
    }
  }
}

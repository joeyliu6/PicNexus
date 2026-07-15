import * as fs from 'fs';
import * as path from 'path';

export interface BrowserInfo {
  path: string;
  name: string;
}

/**
 * 检测系统安装的 Chrome 或 Edge 浏览器
 */
export function detectChromePath(): BrowserInfo | null {
  const candidates: Array<{ path: string; name: string }> = [];

  if (process.platform === 'win32') {
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env['LOCALAPPDATA'] || '';

    candidates.push(
      // Chrome
      { path: path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), name: 'Chrome' },
      { path: path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'), name: 'Chrome' },
      { path: path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'), name: 'Chrome' },
      // Edge
      { path: path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), name: 'Edge' },
      { path: path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), name: 'Edge' }
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      // Chrome
      { path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', name: 'Chrome' },
      { path: path.join(process.env['HOME'] || '', 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'), name: 'Chrome' },
      // Edge
      { path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', name: 'Edge' },
      // Chromium
      { path: '/Applications/Chromium.app/Contents/MacOS/Chromium', name: 'Chromium' }
    );
  } else {
    // Linux
    candidates.push(
      { path: '/usr/bin/google-chrome', name: 'Chrome' },
      { path: '/usr/bin/google-chrome-stable', name: 'Chrome' },
      { path: '/usr/bin/chromium', name: 'Chromium' },
      { path: '/usr/bin/chromium-browser', name: 'Chromium' },
      { path: '/usr/bin/microsoft-edge', name: 'Edge' },
      { path: '/usr/bin/microsoft-edge-stable', name: 'Edge' },
      { path: '/snap/bin/chromium', name: 'Chromium' }
    );
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate.path)) {
      return { path: candidate.path, name: candidate.name };
    }
  }

  return null;
}

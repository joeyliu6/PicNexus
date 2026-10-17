// 线条图标：形状照抄设计源文件（*.dc.html）里的 SVG，统一 24×24 视框、currentColor 描边。
// 新图标从源文件复制形状加到这里，不从图标库里挑「差不多」的替代。

type Attrs = Record<string, string | number>;
export type IconShape = readonly [tag: 'path' | 'circle' | 'rect' | 'line' | 'polyline', attrs: Attrs];

const p = (d: string): IconShape => ['path', { d }];
const circle = (cx: number, cy: number, r: number): IconShape => ['circle', { cx, cy, r }];
const rect = (x: number, y: number, width: number, height: number, rx: number): IconShape => ['rect', { x, y, width, height, rx }];

export const ICONS = {
  // 导航
  upload: [p('M12 15V4'), p('m7 9 5-5 5 5'), p('M5 20h14')],
  gallery: [rect(3, 3, 18, 18, 2), circle(9, 9, 2), p('m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21')],
  health: [p('M22 12h-4l-3 8L9 4l-3 8H2')],
  hosts: [rect(3, 4, 18, 7, 2), rect(3, 13, 18, 7, 2), p('M7 7.5h.01M7 16.5h.01')],
  settings: [p('M4 7h10M18 7h2M4 17h4M12 17h8'), circle(16, 7, 2), circle(10, 17, 2)],
  sidebar: [rect(3, 4, 18, 16, 2), p('M9 4v16')],
  search: [circle(11, 11, 7), p('m20 20-3.5-3.5')],

  // 窗口按钮（Windows / Linux 各一套比例）
  winMinimize: [p('M4 12h16')],
  winMaximize: [rect(3, 3, 18, 18, 3)],
  winClose: [p('M19 5 5 19M5 5l14 14')],
  linuxMinimize: [p('M5 12h14')],
  linuxMaximize: [rect(4, 4, 16, 16, 2)],
  linuxClose: [p('M18 6 6 18M6 6l12 12')],

  // 通用
  chevronDown: [p('m6 9 6 6 6-6')],
  chevronRight: [p('m9 6 6 6-6 6')],
  chevronLeft: [p('m15 18-6-6 6-6')],
  check: [p('M20 6 9 17l-5-5')],
  close: [p('M18 6 6 18M6 6l12 12')],
  plus: [p('M12 5v14M5 12h14')],
  more: [circle(5, 12, 1), circle(12, 12, 1), circle(19, 12, 1)],
  warning: [p('m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z'), p('M12 9v4M12 17h.01')],
  // 失败行（HomeScreen.dc.html）：圆圈加 ✕；感叹号是「留意」
  failCircle: [circle(12, 12, 9), p('m15 9-6 6M9 9l6 6')],
  star: [p('m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9Z')],
  viewGrid: [rect(3, 3, 7, 7, 1.5), rect(14, 3, 7, 7, 1.5), rect(3, 14, 7, 7, 1.5), rect(14, 14, 7, 7, 1.5)],
  viewList: [p('M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01')],
  // 空状态（GalleryScreen.dc.html）
  imageGone: [rect(3, 3, 18, 18, 3), p('m3 3 18 18')],
  emptyGallery: [p('M3 6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3ZM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM21 15l-5-5L5 21')],
  noResults: [p('M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-3.5-3.5M8 11h6')],
  info: [circle(12, 12, 9), p('M12 8v5M12 16h.01')],
  lock: [rect(4, 11, 16, 10, 2), p('M8 11V7a4 4 0 0 1 8 0v4')],
  copy: [rect(8, 8, 12, 12, 2.5), p('M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2')],
  cloudUpload: [p('M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2'), p('M12 12v9'), p('m16 16-4-4-4 4')],
  clipboard: [p('M9 3h6v4H9zM16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2')],
  file: [p('M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9ZM14 3v6h6')],
  link: [p('M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7')],
  arrowRight: [p('M5 12h14M13 6l6 6-6 6')],
  moon: [p('M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z')],
} as const satisfies Record<string, readonly IconShape[]>;

export type IconName = keyof typeof ICONS;

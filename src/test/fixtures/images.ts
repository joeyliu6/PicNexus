export const imagePaths = {
  jpg: '/mock/images/photo.jpg',
  png: '/mock/images/photo.png',
  webp: '/mock/images/photo.webp',
};

export const imageUrls = {
  jd: 'https://img.example.com/jd/photo.jpg',
  weibo: 'https://tvax1.sinaimg.cn/large/photo.jpg',
  r2: 'https://cdn.example.com/images/photo.jpg',
  broken: 'https://img.example.com/missing.jpg',
};

export function createImageFile(
  name = 'photo.jpg',
  type = 'image/jpeg',
  content = 'mock-image',
): File {
  return new File([content], name, { type });
}
export function createImageFileList(files = [createImageFile()]): FileList {
  const transfer = new DataTransfer();
  files.forEach(file => transfer.items.add(file));
  return transfer.files;
}

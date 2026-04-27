const MAX_WARMED_IMAGES = 160;

const warmedImages = new Map<string, number>();
const warmingImages = new Set<string>();

function remember(url: string): void {
  if (warmedImages.has(url)) warmedImages.delete(url);
  warmedImages.set(url, Date.now());

  while (warmedImages.size > MAX_WARMED_IMAGES) {
    const oldest = warmedImages.keys().next().value;
    if (!oldest) break;
    warmedImages.delete(oldest);
  }
}

export function warmImage(url: string | null | undefined): void {
  if (!url || warmedImages.has(url) || warmingImages.has(url) || typeof Image === 'undefined') return;

  warmingImages.add(url);
  const img = new Image();
  img.referrerPolicy = 'no-referrer';
  img.decoding = 'async';
  img.onload = () => {
    warmingImages.delete(url);
    remember(url);
  };
  img.onerror = () => {
    warmingImages.delete(url);
  };
  img.src = url;
  if (img.complete && img.naturalWidth > 0) {
    warmingImages.delete(url);
    remember(url);
  }
}

export function warmImages(urls: Array<string | null | undefined>): void {
  for (const url of urls) warmImage(url);
}

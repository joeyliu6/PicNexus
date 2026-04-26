const MAX_WARMED_IMAGES = 160;

const warmedImages = new Map<string, number>();

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
  if (!url || warmedImages.has(url) || typeof Image === 'undefined') return;

  remember(url);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
}

export function warmImages(urls: Array<string | null | undefined>): void {
  for (const url of urls) warmImage(url);
}

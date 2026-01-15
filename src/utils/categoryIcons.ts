const iconModules = import.meta.glob<string>(
  '../assets/icons/categories/*.svg',
  { eager: true, query: '?raw', import: 'default' }
);

function extractFileName(path: string): string | null {
  const match = path.match(/\/([^/]+)\.svg$/);
  return match ? match[1] : null;
}

const categoryIconMap = Object.fromEntries(
  Object.entries(iconModules)
    .map(([path, content]) => {
      const name = extractFileName(path);
      return name ? [name, content] : null;
    })
    .filter((entry): entry is [string, string] => entry !== null)
);

export function getCategoryIcon(category: string): string | undefined {
  return categoryIconMap[category];
}

const iconModules = import.meta.glob<string>(
  '../assets/icons/illustrations/*.svg',
  { eager: true, query: '?raw', import: 'default' }
);

function extractFileName(path: string): string | null {
  const match = path.match(/\/([^/]+)\.svg$/);
  return match ? match[1] : null;
}

const illustrationMap = Object.fromEntries(
  Object.entries(iconModules)
    .map(([path, content]) => {
      const name = extractFileName(path);
      return name ? [name, content] : null;
    })
    .filter((entry): entry is [string, string] => entry !== null)
);

export function getIllustration(name: string): string | undefined {
  return illustrationMap[name];
}

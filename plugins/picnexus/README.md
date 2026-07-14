# PicNexus for Obsidian

PicNexus uploads images pasted or dropped into Obsidian through the PicNexus desktop app and inserts the resulting image link into the active note.

## Requirements

- Obsidian 1.4.0 or later on desktop.
- The PicNexus desktop app running on the same computer.
- An image hosting service selected under the Obsidian integration settings in PicNexus.

## Installation

Follow the [PicNexus Obsidian installation and setup guide](https://github.com/joeyliu6/PicNexus/blob/main/docs/reference/guides/obsidian-plugin-installation.md) for BRAT, community directory, and manual installation instructions.

## Setup

1. Open PicNexus and enable the Obsidian integration.
2. Select the image hosting service to use.
3. Keep the port in PicNexus and the Obsidian plugin settings identical. The default is `36799`.
4. Use **Test connection** in the plugin settings.

## Network and privacy disclosure

The plugin connects only to the PicNexus desktop app at `http://127.0.0.1:<port>`. It sends image bytes or local image paths to that local service when you explicitly paste, drop, or invoke an upload command. The desktop app then uploads the image to the hosting service selected by the user. The plugin contains no telemetry, advertisements, or self-update mechanism.

See the [PicNexus documentation](https://github.com/joeyliu6/PicNexus) for the desktop application's supported hosting services and privacy considerations.

## Development

```bash
npm ci
npm run typecheck
npm run build
```

The distributable files are `main.js`, `manifest.json`, and `styles.css`.

## License

Apache-2.0. See [LICENSE](LICENSE).

# Brand icons

Each build channel has two flat SVG sources:

- `logo.svg` is the full-bleed iOS, Android, Windows, and web icon.
- `logo-macos.svg` places the same artwork inside the classic 824×824 macOS safe area.

The matching `app-icon.icon` project mirrors the same background and `mark.svg` colors for native iOS builds. Keep the SVG sources and Icon Composer project in sync when changing the mark or palette.

Run `vp run icons:export` from the repository root on macOS to regenerate every tracked PNG and ICO. The command also updates the development favicon and splash assets in `apps/web/public`. Run `vp run icons:check` to verify that all generated files match their SVG sources without changing them.

The exporter uses the system `sips` renderer. macOS SVG sources must stay 1024×1024 with an opaque 824×824 body inset exactly 100 pixels on every side.

Do not edit generated PNG or ICO files directly.

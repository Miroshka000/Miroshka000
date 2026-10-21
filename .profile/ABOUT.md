# Mikan profile renderer

Personal GitHub profile for Miroshka000. Theme colors follow MikanApp;
Go and Rust are included alongside the existing technology stack.

Based on [Expressive Profile](https://github.com/metawka/expressive-profile)
at `0dacdd6b4cd8d649b71ace733afbfe1b92649955` (MIT).
The original license and the Google Sans Flex / Roboto Flex font licenses
are kept in this directory. Material Symbols are Apache 2.0; Simple Icons
are CC0. Brand names and icons belong to their respective owners.
The mandarin artwork is copied from the Mikan app.

`profile.json` configures the text, technology groups, links and both palettes.
`.profile/source/` contains the renderer source with the Mikan palette,
hero motion and mobile layouts. `renderer.mjs` is its committed Node bundle.
The scheduled refresh needs no package installation and reads public data only.

Rebuild after a renderer-source change:

```sh
npm ci --prefix .profile
npm run build --prefix .profile
node .profile/refresh.mjs
```

For local refresh, authenticate the GitHub CLI. Actions uses its built-in
repository token; no personal token or additional secrets are needed.
If fetching profile data fails, existing images are retained.

Published SVG filenames include a hash of their contents to avoid stale GitHub
image caches. The preceding image version is kept for cached README pages;
`.profile/asset-versions.json` tracks the current and preceding filenames.

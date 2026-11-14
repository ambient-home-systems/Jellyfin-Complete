# The presets' own posters

Artwork for the presets' posters (ADR-045 in `docs/DECISIONS.md`). Each file is a textless 2:3 illustration; the app sets the collection's title over its bottom third when the image is built (`src/posters/compose.ts`, run by `src/posters/build.ts`).

- `art/`: the 29 illustrations, WebP. `streaming.webp` is shared by every streaming service, tinted in the service's colour.
- `fonts/`: Archivo ExtraCondensed Black and Archivo SemiBold, under the SIL Open Font License 1.1 (`fonts/Archivo-OFL.txt`).

Which preset uses which picture, and its lettering, is in `src/posters/catalog.ts`. The brief and the prompts the art was made from are in `docs/posters/`. The artwork was made for this project and is distributed under its MIT licence.

When you change a picture or the lettering, raise `BUNDLED_POSTERS_REV` in `src/posters/catalog.ts`, so box sets get the new version.

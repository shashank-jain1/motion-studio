# Cinematic typography and your font files

The user's [Instagram reference](https://www.instagram.com/p/Dd_7sw3koFE/?img_index=3) was viewed directly on 23 October 2026. The linked slide names **Bootzy** (bold/gritty); the following specimens name **Moonscape** (sharp/editorial) and **Optizither** (elegant/romantic). These are observed labels in the post. Their font binaries have not been downloaded or installed. The relevant direction is expressive display typography with intentional scale, spacing and image relationship, rather than the same heavy sans throughout every film.

## Bring your fonts

Put files in **`/Users/shashank/motion-studio/fonts/inbox/`**. Subfolders are allowed; discovery is live without a server restart. The director calls `list_fonts`, then `import_font` with the returned relative filename. Imports copy fonts into `assets/` using a content hash and register `spec.fontFaces`. Optionally assign `role: "display"`, `"body"` or `"mono"`. Uploaded project fonts use `register_font` instead. Register every real weight/style the film uses. A new role affects layers using the matching `$display`/`$body`/`$mono` token; an explicit layer font remains an explicit choice.

TTF and OTF are preferred when typography should also become geometry. WOFF also supports outlines. WOFF2 works for browser text; this build cannot extract its outlines, so supply TTF/OTF for the same face when using morph/3D text. WOFF2 metadata uses a filename guess and accepts explicit family/weight/style overrides. Complex shaping, script joining, ligatures and advanced variable axes are not fully reproduced by the glyph-by-character outline pipeline; compare the geometry with the normal typeset text before delivery.

The browser waits for custom faces and reports a failed load instead of quietly substituting them. CSS aliases include source/project identity, preventing two Players with different same-named files from replacing each other's typeface. Outline keys include registered source identity, so importing a revised same-named font produces new geometry. Project font assets use the existing local and Lambda asset transports; Lambda deployment itself was not performed as part of this change.

## Built-in directions

| Direction | Display | Body | Treatment |
| --- | --- | --- | --- |
| Monumental | Cinzel 500 | Manrope | Spaced capitals and deliberate reveals |
| Editorial film | Cormorant Garamond 500 | Space Grotesk | Expressive serif, occasional italic emphasis |
| Fashion | Bodoni Moda 500 | Manrope | Large, high-contrast letterforms and fine rules |
| Contemporary trailer | League Gothic 400 | DM Sans | Tall condensed titles and decisive movement |
| Quiet drama | Italiana 400 | Instrument Sans | Spacious titles and longer reading holds |

These are our art-direction suggestions, not typeface claims made by the Instagram author. `list_styles` includes cinematic-editorial, cinematic-monumental, cinematic-fashion and cinematic-condensed. The existing cinematic preset remains available for older projects. UI labels and supporting copy retain readable body typography.

The design film has a separate `--cinematic` variant using Cormorant Garamond titles, Manrope labels and italic emphasis. Both variants use role tokens, making a later imported display font easy to apply. `build_design_film` defaults to cinematic typography through the agent tool; `typography: "graphic"` remains available. The standalone showcase's original default remains graphic; `--cinematic` creates separate outputs.

## Verification

`npm run test:fonts` checks metadata (including platform-grouped OpenType names), registration and role assignment, style merging, native font assets, generated morph/3D outlines, source identity, invalid paths and the WOFF2 limitation. It uses original generated test fonts and needs no font network access. `node --import tsx scripts/tests/fonts.test.ts --render` additionally renders the actual TTF as browser text, a morph and a 3D object. The normal motion verification includes the font contracts, and the cinematic film is previewed and exported separately.

# Your font library

Drop your `.ttf`, `.otf`, `.woff` or `.woff2` files in **`fonts/inbox/`**. Subfolders are supported. The director's `list_fonts` tool discovers them without restarting the server. `import_font` copies a chosen face into a project and registers it in `spec.fontFaces`, optionally assigning it as the display/body/mono font. Projects keep their own copies so previews and exports remain portable.

Prefer TTF or OTF when the same typeface should become a morph or 3D object. WOFF is also supported for outlines; WOFF2 supports normal browser text and needs a TTF/OTF counterpart for outlines. Keep different weights/styles as separate files, or provide a variable font. Family, weight and style are read from font metadata when possible; tools accept overrides.

You can also upload fonts directly to a project's Assets panel, then use `register_font`. Imported custom fonts take precedence over same-named Google fonts. Missing/broken custom files produce an explicit render error instead of silently swapping typefaces.

Shared font binaries are ignored by Git. `fonts/inbox/` is ready for your files; the fonts named in the Instagram reference have not been downloaded or installed.

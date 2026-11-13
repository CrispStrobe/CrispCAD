# Localization

English and German cover the workbench, shape library, properties, dialogs,
project/history UI, settings, diagnostics, native Mac menus/dialogs and MCP prose.
Choose **Settings → Language** or **Einstellungen → Sprache**. The host defaults to
its saved preference or the system language; unsupported languages fall back to
English. Selection flushes pending history/library writes before reloading.
The language preference is separate from models and never creates an iteration.

The core exports `t`, `getLocale`, `setLocale`, `supportedLocales` and `formatNumber`.
English source strings are message keys; tagged templates preserve interpolated
user values through numbered placeholders. Catalogs are in `packages/core/src/locales`.
An embedding host chooses the locale before mounting and remounts to change it.
Geometry worker requests carry the locale, independently of saved documents.
MCP accepts `--locale de`; its protocol keys, tool names and source grammar remain
stable. Native Mac menus follow the same selected language. Native iPad system
pickers use the device's language and the bundle declares English/German support.

User-entered names, expressions, code, file paths and numeric model values are not
translated. New generated names use the selected language; switching later retains
those names. Recognized system history labels are translated for display without
rewriting archived revisions. Unknown/custom iteration names remain verbatim.
Legal license text, compiler keywords and third-party engine/status details remain
in their original form. These are not a second set of localized model definitions.

Run `npm run check:i18n` to check static/tagged message references, matching
placeholders, nonempty translations and consistent duplicate keys. Dynamic labels
also require UI tests: the German browser workflows exercise picker/search,
parameters, sketches, code, properties, library/About, numeric axes and language
switching while preserving saved source, parameter expressions and revision IDs.

To add a language, add its catalog set and native resources, extend the supported
locale registry/normalization, and exercise those workflows. Keep identifiers and
parameter/source serialization language-neutral. English fallback is intentional;
a missing translation must never corrupt a model or reject a valid archive.

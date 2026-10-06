# Third-party notices

## DeepSeek Harness — MIT, Copyright (c) 2026 DeepSeek

`cordis.patch.yml` **restates the plugin composition of the shipped `standard` agent preset**
from DeepSeek Harness, so that "Lean mode" is a full, mountable preset rather than a
hand-written list. That composition is used under the MIT License; the full text is in
[LICENSE](LICENSE).

**What was changed:**

- the declaration's Loader row id (`preset-standard` → `preset-lean`) and its `config.id` (`standard` → `lean`);
- a `name` and `description` were added, and `order` changed from 1 to 8;
- everything under `config.plugins` is the shipped list, unmodified.

Nothing else in this repository is derived from DeepSeek Harness:

- `index.mjs` is original work. It calls documented Harness APIs
  (`ctx.on('system-prompt/assemble')`, `ctx.get('agentPresets')`) but contains no Harness source.
- The measurements in the READMEs are the author's own.

## No endorsement

This is an independent plugin. It is **not** published by, affiliated with, or endorsed by
DeepSeek.

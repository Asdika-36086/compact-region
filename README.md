# compact-region

[![tests](https://github.com/Asdika-36086/compact-region/actions/workflows/test.yml/badge.svg)](https://github.com/Asdika-36086/compact-region/actions/workflows/test.yml)

English | [中文](README.zh.md)

Pick a run of consecutive visible turns in a DSH conversation and condense them into one checkpoint card. Once applied, the card stays in the context, and the turns it replaced stay in the session log but no longer render as ordinary conversation or occupy the model's context.

## How to use

1. Open the conversation in DSH and make sure the session has a model selected.
2. Hover a normal turn and click **⤵ Compress** next to it to enter selection mode starting from that turn.
3. Click turns or checkpoint cards to choose the range. The range must be contiguous: clicking a turn beyond an edge includes everything in between. Click a chosen item again to drop it.
4. Click **Compress** in the panel. The plugin asks the session's model for a summary and shows an editable preview.
5. Review and edit the summary, then:
   - **Apply**: replace the chosen range with the checkpoint card;
   - **Regenerate**: ask for the summary again;
   - **Cancel**: discard this run and leave the conversation untouched.

Press `Esc` or click **Cancel** to leave selection mode. After applying, expand the card to read the summary; **View the conversation log** browses the replaced originals in the right-hand panel.

## Selection rules

- Only consecutive visible turns of the current conversation can be selected, including both ordinary turns and checkpoint cards.
- A single ordinary turn is a valid selection; a single checkpoint card is not. To compress a checkpoint again, select it together with a neighbouring turn.
- A turn that is still running cannot be compressed; wait for it to finish.
- The range and the summary both follow the current context. Review the summary before applying, especially facts, file paths, commands and open tasks.

## Install and enable

This plugin ships as a DSH **bundle**: `dsh.bundle.patch` in `package.json` points at `cordis.patch.yml`, and `dsh.client` declares the Web client entry. Install it through DSH's plugin manager rather than copying files by hand.

Requirements:

- A DSH build that includes the plugin manager (the **Plugins** page in the sidebar) and supports Web client plugins;
- Developed and tested on DSH 0.2.x. Other versions are unverified — if install reports an incompatible version, please open an issue with your DSH version.

### Option 1: install from the Web UI (recommended)

1. Open DSH and click **Plugins** in the left sidebar.
2. Enter either address in the install box:
   - the GitHub repository: `https://github.com/Asdika-36086/compact-region`
   - a local directory: clone or download the repository, then enter its absolute path, e.g. `D:\plugins\compact-region`
3. Confirm and wait for the dependency install to finish.
4. Check that `compact-region` is enabled in the plugin list.

If the compress button does not appear immediately, restart DSH once.

### Option 2: command line

Commands differ between DSH versions, so check your CLI first:

```sh
dsh plugin --help
```

If it lists `install`, run:

```sh
dsh plugin install https://github.com/Asdika-36086/compact-region
```

Otherwise use the Web UI above.

### Check that it loaded

Open any conversation and hover a normal turn; a **⤵ Compress** button should appear next to it. If it does not, first check whether the plugin is enabled on the Plugins page.

## Language

Every string the plugin shows and the instruction it sends to the model come from a language pack. Both are replaceable, and you switch packs on the **compact-region** card under Plugins. Two ship: English and 中文.

To add one, put a JSON file in `<DSH home>/compact-region/langs/`. The file name without `.json` is the id shown in the picker; a file whose id matches a shipped pack overrides it. The card rescans the folder each time it opens, so no restart is needed.

```json
{
  "schema": 1,
  "name": "shown in the picker",
  "prompt": {
    "template": "the instruction sent to the model; {start} is the first 128 characters of the span"
  },
  "ui": {
    "compress": "text of the button",
    "cancel": "text of the cancel button"
  }
}
```

- Both sections may be partial: missing keys fall back to English one at a time, so a half-finished pack is still usable.
- The pack decides which language the summary is written in. Nothing else says it, so state it in the template.
- The full field list, with every UI string, is [lib/langs/en.json](lib/langs/en.json). Newlines inside the template are `
`.
- The settings card's own row (its title and the Reset button) is not part of a pack: it follows the DSH interface language, so someone running DSH in English can always find the setting.

## Data and caveats

- Applying a checkpoint never deletes events from the session log. It appends a replacement checkpoint and keeps the chosen span out of later model context.
- To generate a summary the plugin sends the visible conversation up to the end of the chosen range to the model the session is using, with the summary instruction appended. Judge that against the privacy and data policy of the model service you use.
- The replaced originals remain available through the card's log entry.
- The hide layer works through client-side DOM styling, which can affect scroll height and paging. If a card's position or the scrolling looks wrong, reopen the conversation to check.
- Inactive older sessions can still be read for turns and archives; generating a summary and applying a checkpoint require a live session.

## Known limitations

- Selection works in whole visible turns / contiguous surface spans; there is no arbitrary message-level cutting.
- Hiding depends on the client render layer and does not alter the durable log itself.
- Summaries are model-generated and cannot be guaranteed complete or accurate. Review before applying, and edit or regenerate when needed.

## Development and testing

You need Node.js (ES modules; no third-party test dependencies). From the plugin directory:

```sh
npm test
```

The tests use Node's built-in `node:assert` and synthetic session events: they never start DSH, call a model, or touch a real session. They cover turn and checkpoint statistics, archive data, and nested archives. Host/client integration and UI changes still need manual verification in an isolated DSH session. Never put real conversations, credentials or API keys into test fixtures.

## License

MIT, see [LICENSE](LICENSE).

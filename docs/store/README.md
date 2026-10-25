# Chrome Web Store assets

Prepared for GhostPair's first Chrome listing. Version 0.6.5 uses the active Heroku signaling origin. Submit only after the account, privacy and real-browser gates in [Publishing](../publishing.md) are complete. Edge submission is outside this preparation.

## Screenshots

Three PNGs at 1280×800, captured from the real packaged extension with synthetic content:

| File | What it shows |
| --- | --- |
| `consent.png` | Host setup, explicit sharing consent and optional clipboard choice. |
| `collaboration.png` | Guest view of an authorized page and the shared-tab interface. |
| `controls.png` | Host interaction controls, pause/stop and optional clipboard controls. |

`metadata.json` records the capture package, generation context and image dimensions. Use it to identify what was captured; it is not a report of production deployment or multi-network validation.

To regenerate on Windows with Chrome installed, run `npm run build`, then `node scripts/export-previews.mjs --store`. The existing preview exporter also refreshes the website's static product previews. It creates a real local WebRTC session in disposable Chrome profiles, pregranting site access only in those test copies; the packaged manifest is unchanged. Consent and controls place the unmodified 398×600 product capture beside a caption on a 1280×800 canvas. Collaboration is a direct 1280×800 capture of the live viewer. No UI state or video is mocked.

Inspect every image before upload: no real browsing data, credentials, actual connection codes or personal clipboard contents. Any shown code must belong to a disposable synthetic test installation. These local captures do not verify native browser permission prompts, capture indicators, Windows clipboard behavior or sessions between separate computers/networks. Follow [Validation](../validation.md) for those checks.

Confirm the images and `metadata.json` match the submitted 0.6.5 package; regenerate captures after any visible interface change. The active signaling origin is `https://ghostpair-3c9f3903aad3.herokuapp.com`. Local screenshot generation does not establish production WebRTC connectivity, store publication or support for every network.

## Upload details

Use `apps/extension/public/icons/128.png` from the verified release as the 128×128 store icon. Upload the three screenshots in the order above. Chrome accepts one to five screenshots at 1280×800 or 640×400; these assets use the preferred larger dimensions, square corners and no outer padding. A 440×280 promo image and 1400×560 marquee are optional and omitted.

Use the listing, contact, purpose, permission rationale and data disclosures in [Publishing](../publishing.md). The public privacy URL is [GhostPair privacy](https://thomasserna.github.io/GhostPair/privacy.html). Do not replace it with a hypothetical Heroku URL.

Sources: [Chrome image requirements](https://developer.chrome.com/docs/webstore/images), [privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy), and [publication workflow](https://developer.chrome.com/docs/webstore/publish).

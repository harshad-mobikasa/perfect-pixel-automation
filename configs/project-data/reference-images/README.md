Place pixelmatch baseline PNGs in a folder that matches the audited hostname slug.

Examples:
- `configs/project-data/reference-images/lilacst-com/desktop/header-desktop.png`
- `configs/project-data/reference-images/lilacst-com/mobile/header-mobile.png`

If you only audit one storefront, you can also place shared defaults in:
- `configs/project-data/reference-images/default/desktop/`
- `configs/project-data/reference-images/default/mobile/`

The runner derives `PROJECT_DIR` from the target URL hostname, so:
- `https://lilacst.com` -> `lilacst-com`
- `https://shop.example.co.uk` -> `shop-example-co-uk`

Use file names that match `referenceImageDesktop` and `referenceImageMobile` in `configs/playwright.pages.json`.

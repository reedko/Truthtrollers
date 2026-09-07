// Pulls the canonical brand marks from backend/assets/images/brand/ into the
// extension's bundled assets before build, so swapping the file there is the
// only step needed to update both the popup logo (BrandLockup.tsx) and the
// browser toolbar icon (manifest.json icons/action.default_icon).
const path = require("path");
const sharp = require("sharp");

const BRAND_DIR = path.join(__dirname, "..", "..", "backend", "assets", "images", "brand");
const LOGO_SOURCE = path.join(BRAND_DIR, "logo.png");
const ICON_SOURCE = path.join(BRAND_DIR, "favicon.png");

const LOGO_TARGET = path.join(__dirname, "..", "src", "assets", "images", "brand", "logo8sm.png");
const LOGO_HEIGHT = 240; // rendered at up to 64px in BrandLockup; keeps the bundle small at 2x-3x for retina.

const ICON_DIR = path.join(__dirname, "..", "src", "assets", "icons");
const ICON_SIZES = [16, 48, 128];

async function run() {
  await sharp(LOGO_SOURCE).resize({ height: LOGO_HEIGHT }).toFile(LOGO_TARGET);
  console.log(`✅ Synced brand logo: ${LOGO_SOURCE} -> ${LOGO_TARGET}`);

  for (const size of ICON_SIZES) {
    const target = path.join(ICON_DIR, `icon-${size}.png`);
    await sharp(ICON_SOURCE).resize(size, size).toFile(target);
    console.log(`✅ Synced toolbar icon: ${ICON_SOURCE} -> ${target}`);
  }
}

run().catch((err) => {
  console.error(`❌ Failed to sync brand assets`);
  console.error(err);
  process.exit(1);
});

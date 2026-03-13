'use strict';

/**
 * Generates branded installer images for the OpenFork desktop app.
 * Run before packaging: npm run generate-installer-images
 *
 * Outputs:
 *   public/installerSidebar.png  — 164×314  (NSIS welcome/finish page left panel)
 *   public/installerHeader.png   — 150×57   (NSIS inner page top-right banner)
 *   public/dmgBackground.png     — 540×380  (macOS DMG window background)
 */

const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');

// Logo paths from public/logo.svg (viewBox 0 0 100 160).
// Use with: <g fill="white" transform="translate(tx,ty) scale(s)">…</g>
const LOGO_PATHS = `
  <path fill-rule="evenodd" clip-rule="evenodd"
    d="M50 160C72.0914 160 90 142.091 90 120C90 97.9086 72.0914 80 50 80
       C27.9086 80 10 97.9086 10 120C10 142.091 27.9086 160 50 160Z
       M50 142C62.1503 142 72 132.15 72 120C72 107.85 62.1503 98 50 98
       C37.8497 98 28 107.85 28 120C28 132.15 37.8497 142 50 142Z"/>
  <path d="M42 82H58V50C58 45.5817 54.4183 42 50 42
           C45.5817 42 42 45.5817 42 50V82Z"/>
  <path d="M25 45C25 49.4183 28.5817 53 33 53H67
           C71.4183 53 75 49.4183 75 45V15C75 10.5817 71.4183 7 67 7
           C62.5817 7 59 10.5817 59 15V40H41V15C41 10.5817 37.4183 7 33 7
           C28.5817 7 25 10.5817 25 15V45Z"/>
  <rect x="42" y="7" width="16" height="35" rx="8"/>
`;

// ─── SIDEBAR (164 × 314) ──────────────────────────────────────────────────────
// Logo 44×70 (scale=0.44), centered at (82, 108).
//   logo natural center = (50, 80); after scale = (22, 35.2)
//   translate(82-22=60, 108-35.2≈73)
const sidebarSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">
  <defs>
    <linearGradient id="accent" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
      <stop offset="0%"   stop-color="#fb923c"/>
      <stop offset="100%" stop-color="#fcd34d"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="164" height="314" fill="#1c1814"/>

  <!-- Right accent bar -->
  <rect x="160" y="0" width="4" height="314" fill="url(#accent)"/>

  <!-- Logo — white, 44×70, centered at (82, 108) -->
  <g fill="white" transform="translate(60,73) scale(0.44)">
    ${LOGO_PATHS}
  </g>

  <!-- App name -->
  <text x="82" y="162"
        font-family="'Segoe UI',Arial,Helvetica,sans-serif"
        font-size="20" font-weight="700"
        fill="#f5f1ed" text-anchor="middle">OpenFork</text>

  <!-- Tagline line 1 -->
  <text x="82" y="180"
        font-family="'Segoe UI',Arial,Helvetica,sans-serif"
        font-size="9" fill="#b5a99a" text-anchor="middle" letter-spacing="0.5">The Open Source AI</text>

  <!-- Tagline line 2 -->
  <text x="82" y="194"
        font-family="'Segoe UI',Arial,Helvetica,sans-serif"
        font-size="9" fill="#b5a99a" text-anchor="middle" letter-spacing="0.5">Video Platform</text>
</svg>`;

// ─── HEADER (150 × 57) ────────────────────────────────────────────────────────
// Logo 23×37 (scale=0.23), centered at (27, 28).
//   logo natural center = (50, 80); after scale = (11.5, 18.4)
//   translate(27-11.5=15.5, 28-18.4≈10)
const headerSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57" viewBox="0 0 150 57">
  <defs>
    <linearGradient id="accentH" x1="0" y1="0" x2="1" y2="0" gradientUnits="objectBoundingBox">
      <stop offset="0%"   stop-color="#fb923c"/>
      <stop offset="100%" stop-color="#fcd34d"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="150" height="57" fill="#1c1814"/>

  <!-- Bottom accent line -->
  <rect x="0" y="54" width="150" height="3" fill="url(#accentH)"/>

  <!-- Logo — white, 23×37, centered at (27, 28) -->
  <g fill="white" transform="translate(15.5,10) scale(0.23)">
    ${LOGO_PATHS}
  </g>

  <!-- Separator -->
  <line x1="50" y1="14" x2="50" y2="43" stroke="#3d3528" stroke-width="0.75"/>

  <!-- App name — vertically centred since there's no tagline -->
  <text x="60" y="33"
        font-family="'Segoe UI',Arial,Helvetica,sans-serif"
        font-size="15" font-weight="700"
        fill="#f5f1ed">OpenFork</text>
</svg>`;

// ─── Generate ─────────────────────────────────────────────────────────────────

function renderSvgToPng(svgString) {
  const resvg = new Resvg(svgString, {
    font: { loadSystemFonts: true },
  });
  return resvg.render().asPng();
}

function main() {
  console.log('Generating installer images…');

  fs.writeFileSync(path.join(publicDir, 'installerSidebar.png'), renderSvgToPng(sidebarSvg));
  console.log('  ✓ installerSidebar.png  (164×314)');

  fs.writeFileSync(path.join(publicDir, 'installerHeader.png'), renderSvgToPng(headerSvg));
  console.log('  ✓ installerHeader.png   (150×57)');

  console.log('Done.');
}

main();

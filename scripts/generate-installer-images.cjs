'use strict';

/**
 * Generates branded installer images for the OpenFork desktop app.
 * Run before packaging: npm run generate-installer-images
 *
 * Outputs:
 *   public/icon.png             — 1024×1024 app icon
 *   public/icon.ico             — multi-size Windows app/installer icon
 *   public/installerSidebar.png  — 164×314  (NSIS welcome/finish page left panel)
 *   public/installerHeader.png   — 150×57   (NSIS inner page top-right banner)
 *   public/dmgBackground.png     — 540×380  (macOS DMG window background)
 */

const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');
const logoSvgPath = path.join(publicDir, 'logo.svg');

function readLogoMarkup() {
  const logoSvg = fs.readFileSync(logoSvgPath, 'utf8');
  const match = logoSvg.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/i);

  if (!match) {
    throw new Error(`Could not read logo markup from ${logoSvgPath}`);
  }

  return match[1].replace(/currentColor/g, '#fff').trim();
}

const LOGO_MARKUP = readLogoMarkup();

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
    ${LOGO_MARKUP}
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
    ${LOGO_MARKUP}
  </g>

  <!-- Separator -->
  <line x1="50" y1="14" x2="50" y2="43" stroke="#3d3528" stroke-width="0.75"/>

  <!-- App name — vertically centred since there's no tagline -->
  <text x="60" y="33"
        font-family="'Segoe UI',Arial,Helvetica,sans-serif"
        font-size="15" font-weight="700"
        fill="#f5f1ed">OpenFork</text>
</svg>`;

// ─── APP ICON (1024 × 1024, plus ICO sizes) ─────────────────────────────────
// The title bar and installer shell use tiny 16×16/32×32 entries. A transparent
// white logo disappears there, so the Windows icon gets a dark branded tile.
function appIconSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#1c1814"/>
        <stop offset="100%" stop-color="#2a2118"/>
      </linearGradient>
      <linearGradient id="accentIcon" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#fb923c"/>
        <stop offset="100%" stop-color="#fcd34d"/>
      </linearGradient>
    </defs>

    <rect width="1024" height="1024" rx="224" fill="url(#bg)"/>
    <rect x="66" y="66" width="892" height="892" rx="180" fill="none" stroke="url(#accentIcon)" stroke-width="52"/>
    <g transform="translate(282,144) scale(4.6)" fill="#fff">
      ${LOGO_MARKUP}
    </g>
  </svg>`;
}

// ─── Generate ─────────────────────────────────────────────────────────────────

function renderSvgToPng(svgString) {
  const resvg = new Resvg(svgString, {
    font: { loadSystemFonts: true },
  });
  return resvg.render().asPng();
}

function createIcoBuffer(images) {
  const headerSize = 6;
  const entrySize = 16;
  let imageOffset = headerSize + entrySize * images.length;
  const header = Buffer.alloc(imageOffset);

  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  images.forEach(({ size, png }, index) => {
    const entryOffset = headerSize + entrySize * index;
    header.writeUInt8(size >= 256 ? 0 : size, entryOffset);
    header.writeUInt8(size >= 256 ? 0 : size, entryOffset + 1);
    header.writeUInt8(0, entryOffset + 2);
    header.writeUInt8(0, entryOffset + 3);
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(png.length, entryOffset + 8);
    header.writeUInt32LE(imageOffset, entryOffset + 12);
    imageOffset += png.length;
  });

  return Buffer.concat([header, ...images.map(({ png }) => png)]);
}

function main() {
  console.log('Generating installer assets…');

  const iconPng = renderSvgToPng(appIconSvg(1024));
  fs.writeFileSync(path.join(publicDir, 'icon.png'), iconPng);
  console.log('  ✓ icon.png             (1024×1024)');

  const iconSizes = [16, 24, 32, 48, 64, 128, 256];
  const iconImages = iconSizes.map((size) => ({
    size,
    png: renderSvgToPng(appIconSvg(size)),
  }));
  fs.writeFileSync(path.join(publicDir, 'icon.ico'), createIcoBuffer(iconImages));
  console.log('  ✓ icon.ico             (16/24/32/48/64/128/256)');

  fs.writeFileSync(path.join(publicDir, 'installerSidebar.png'), renderSvgToPng(sidebarSvg));
  console.log('  ✓ installerSidebar.png  (164×314)');

  fs.writeFileSync(path.join(publicDir, 'installerHeader.png'), renderSvgToPng(headerSvg));
  console.log('  ✓ installerHeader.png   (150×57)');

  console.log('Done.');
}

main();

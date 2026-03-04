import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourceImage = path.join(__dirname, '../public/banana-logo-1.png');
const publicDir = path.join(__dirname, '../public');

async function generateFavicons() {
  try {
    console.log('Generating favicon assets from banana-logo-1.png...');

    // First, trim any whitespace from the source image
    const trimmedBuffer = await sharp(sourceImage)
      .trim()
      .toBuffer();

    // Generate logo192.png (192x192)
    await sharp(trimmedBuffer)
      .resize(192, 192, {
        fit: 'cover',
        position: 'center'
      })
      .png()
      .toFile(path.join(publicDir, 'logo192.png'));
    console.log('✓ Created logo192.png');

    // Generate logo512.png (512x512)
    await sharp(trimmedBuffer)
      .resize(512, 512, {
        fit: 'cover',
        position: 'center'
      })
      .png()
      .toFile(path.join(publicDir, 'logo512.png'));
    console.log('✓ Created logo512.png');

    // Generate temporary PNG files for ICO conversion
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }

    const sizes = [16, 24, 32, 48, 64];
    const pngFiles = [];

    for (const size of sizes) {
      const filename = path.join(tempDir, `favicon-${size}.png`);
      await sharp(trimmedBuffer)
        .resize(size, size, {
          fit: 'cover',
          position: 'center'
        })
        .png()
        .toFile(filename);
      pngFiles.push(filename);
    }

    // Generate favicon.ico from multiple PNG sizes
    const ico = await pngToIco(pngFiles);
    fs.writeFileSync(path.join(publicDir, 'favicon.ico'), ico);
    console.log('✓ Created favicon.ico (with sizes: 16x16, 24x24, 32x32, 48x48, 64x64)');

    // Clean up temporary files
    pngFiles.forEach(file => fs.unlinkSync(file));
    fs.rmdirSync(tempDir);

    console.log('\nFavicon assets generated successfully!');
    console.log('- favicon.ico (multi-size ICO)');
    console.log('- logo192.png (for PWA)');
    console.log('- logo512.png (for PWA)');

  } catch (error) {
    console.error('Error generating favicons:', error);
    process.exit(1);
  }
}

generateFavicons();

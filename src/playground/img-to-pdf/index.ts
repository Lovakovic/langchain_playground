import fs from 'fs';
import path from 'path';
import { jsPDF } from 'jspdf';
import sharp from 'sharp';

interface ImageFile {
  path: string;
  name: string;
}

async function getImageFiles(dirPath: string): Promise<ImageFile[]> {
  const files = fs.readdirSync(dirPath);
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
  
  return files
    .filter(file => {
      const ext = path.extname(file).toLowerCase();
      return imageExtensions.includes(ext);
    })
    .map(file => ({
      path: path.join(dirPath, file),
      name: file
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function processImage(imagePath: string): Promise<{ width: number; height: number; data: Buffer }> {
  const image = sharp(imagePath);
  const metadata = await image.metadata();
  
  // OCR-optimized processing (preserve colors)
  let processedImage = image
    .normalize() // Auto-adjust contrast
    .sharpen(); // Enhance text clarity
  
  // Ensure minimum resolution for OCR (300 DPI equivalent)
  const minWidth = 2480; // ~300 DPI for 8.27" width (A4)
  if ((metadata.width || 0) < minWidth) {
    const scaleFactor = minWidth / (metadata.width || 1);
    processedImage = processedImage.resize({
      width: Math.round((metadata.width || 0) * scaleFactor),
      height: Math.round((metadata.height || 0) * scaleFactor),
      kernel: sharp.kernel.lanczos3 // High-quality upscaling
    });
  }
  
  // Use PNG for lossless compression (better for OCR)
  const buffer = await processedImage.png().toBuffer();
  const finalMetadata = await sharp(buffer).metadata();
    
  return {
    width: finalMetadata.width || 0,
    height: finalMetadata.height || 0,
    data: buffer
  };
}

async function createPdfFromImages(imageDir: string, outputPath: string): Promise<void> {
  console.log(`Reading images from: ${imageDir}`);
  
  const imageFiles = await getImageFiles(imageDir);
  
  if (imageFiles.length === 0) {
    throw new Error(`No image files found in directory: ${imageDir}`);
  }
  
  console.log(`Found ${imageFiles.length} image(s)`);
  
  const pdf = new jsPDF();
  let isFirstPage = true;
  
  for (const imageFile of imageFiles) {
    console.log(`Processing: ${imageFile.name}`);
    
    try {
      const { width, height, data } = await processImage(imageFile.path);
      
      // Calculate dimensions to fit page while maintaining aspect ratio
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const maxWidth = pageWidth - (margin * 2);
      const maxHeight = pageHeight - (margin * 2);
      
      let imgWidth = width;
      let imgHeight = height;
      
      // Scale down if image is larger than page
      if (imgWidth > maxWidth || imgHeight > maxHeight) {
        const widthRatio = maxWidth / imgWidth;
        const heightRatio = maxHeight / imgHeight;
        const ratio = Math.min(widthRatio, heightRatio);
        
        imgWidth = imgWidth * ratio;
        imgHeight = imgHeight * ratio;
      }
      
      // Center the image on the page
      const x = (pageWidth - imgWidth) / 2;
      const y = (pageHeight - imgHeight) / 2;
      
      if (!isFirstPage) {
        pdf.addPage();
      }
      
      // Convert buffer to base64 for jsPDF
      const base64 = data.toString('base64');
      pdf.addImage(`data:image/png;base64,${base64}`, 'PNG', x, y, imgWidth, imgHeight);
      
      isFirstPage = false;
      
    } catch (error) {
      console.warn(`Failed to process ${imageFile.name}:`, error);
    }
  }
  
  pdf.save(outputPath);
  console.log(`PDF created: ${outputPath}`);
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length !== 1) {
    console.error('Usage: npx ts-node src/playground/img-to-pdf/index.ts <image-directory>');
    console.error('');
    console.error('Example:');
    console.error('  npx ts-node src/playground/img-to-pdf/index.ts ./my-images');
    process.exit(1);
  }
  
  const imageDir = args[0];
  
  if (!fs.existsSync(imageDir)) {
    console.error(`Directory does not exist: ${imageDir}`);
    process.exit(1);
  }
  
  if (!fs.statSync(imageDir).isDirectory()) {
    console.error(`Path is not a directory: ${imageDir}`);
    process.exit(1);
  }
  
  const outputPath = path.join(path.dirname(imageDir), `${path.basename(imageDir)}-combined.pdf`);
  
  try {
    await createPdfFromImages(imageDir, outputPath);
  } catch (error) {
    console.error('Error creating PDF:', error);
    process.exit(1);
  }
}

// Check if this file is being run directly (ES module compatible)
if (process.argv[1]?.endsWith('index.ts')) {
  main().catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
}
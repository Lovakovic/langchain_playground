import { fromPath } from 'pdf2pic';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const outputDir = path.resolve(__dirname, 'output');

// Create output directory if it doesn't exist
if (!fs.existsSync(outputDir)){
    fs.mkdirSync(outputDir, { recursive: true });
}

// Function to get PDF dimensions using pdfinfo
function getPdfDimensions(pdfPath: string): { width: number; height: number } | null {
  try {
    const output = execSync(`pdfinfo "${pdfPath}"`, { encoding: 'utf8' });
    const sizeMatch = output.match(/Page size:\s+(\d+(?:\.\d+)?)\s+x\s+(\d+(?:\.\d+)?)\s+pts/);
    if (sizeMatch) {
      return {
        width: parseFloat(sizeMatch[1]),
        height: parseFloat(sizeMatch[2])
      };
    }
  } catch (error) {
    console.warn('Could not get PDF dimensions:', error);
  }
  return null;
}

// Calculate adaptive DPI based on PDF dimensions
function calculateAdaptiveDPI(pdfPath: string, targetPixelWidth: number = 2400): number {
  const dimensions = getPdfDimensions(pdfPath);
  if (!dimensions) {
    // Default to 200 DPI if we can't get dimensions
    return 200;
  }
  
  // Calculate DPI needed to achieve target pixel width
  // PDF dimensions are in points (1 point = 1/72 inch)
  const pdfWidthInches = dimensions.width / 72;
  const calculatedDPI = Math.round(targetPixelWidth / pdfWidthInches);
  
  // Clamp DPI between 150 and 300 for OCR quality
  const dpi = Math.max(150, Math.min(300, calculatedDPI));
  
  console.log(`PDF dimensions: ${dimensions.width} x ${dimensions.height} pts`);
  console.log(`Calculated adaptive DPI: ${dpi} (targeting ~${targetPixelWidth}px width)`);
  
  return dpi;
}

async function pdfToImages(pdfPath: string, useJpeg: boolean = false) {
  try {
    // Calculate adaptive DPI based on PDF size
    const adaptiveDPI = calculateAdaptiveDPI(pdfPath);
    
    const options: any = {
      // density: DPI (dots per inch) for rendering PDF pages
      // Now adaptive based on PDF dimensions to maintain good OCR quality
      // while avoiding excessively large files for oversized PDFs
      density: adaptiveDPI,
      
      saveFilename: 'page',
      savePath: outputDir,
      format: useJpeg ? 'jpeg' : 'png',
      
      // width & height: Set to -1 to let pdf2pic calculate dimensions automatically
      // This ensures the original PDF page dimensions are preserved
      // Setting specific values (e.g., width: 800) would force resize and could distort aspect ratio
      width: -1,
      height: -1,
      
      // preserveAspectRatio: Ensures the PDF's original proportions are maintained
      // Without this, the image might be stretched or squashed to fit specified dimensions
      preserveAspectRatio: true
    };
    
    // Add JPEG quality setting if using JPEG format
    if (useJpeg) {
      options.quality = 95; // High quality for OCR
    }
    
    const storeAsImage = fromPath(pdfPath, options);
    const outputFiles = await storeAsImage.bulk(-1);
    console.log('Successfully converted PDF to images:', outputFiles);
    console.log(`Format: ${useJpeg ? 'JPEG' : 'PNG'}`);
  } catch (error) {
    console.error('Error converting PDF to images:', error);
  }
}

const pdfFilePath = process.argv[2];
const useJpeg = process.argv[3] === '--jpeg';

if (!pdfFilePath) {
  console.error('Please provide the path to the PDF file as an argument.');
  console.error('Usage: yarn ts-node src/playground/pdf_screenshot/index.ts <pdf-path> [--jpeg]');
  process.exit(1);
}

const absolutePdfPath = path.resolve(pdfFilePath);

pdfToImages(absolutePdfPath, useJpeg);

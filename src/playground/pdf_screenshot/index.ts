import { fromPath } from 'pdf2pic';
import path from 'path';
import fs from 'fs';

const outputDir = path.resolve(__dirname, 'output');

// Create output directory if it doesn't exist
if (!fs.existsSync(outputDir)){
    fs.mkdirSync(outputDir, { recursive: true });
}

const options = {
  // density: DPI (dots per inch) for rendering PDF pages
  // Higher density = better quality but larger file size
  // 72-150: Low quality, fast rendering, small files
  // 200-300: Good quality for most use cases
  // 300+: High quality for detailed documents or OCR
  density: 300,
  
  saveFilename: 'page',
  savePath: outputDir,
  format: 'png',
  
  // width & height: Set to -1 to let pdf2pic calculate dimensions automatically
  // This ensures the original PDF page dimensions are preserved
  // Setting specific values (e.g., width: 800) would force resize and could distort aspect ratio
  width: -1,
  height: -1,
  
  // preserveAspectRatio: Ensures the PDF's original proportions are maintained
  // Without this, the image might be stretched or squashed to fit specified dimensions
  preserveAspectRatio: true
};

async function pdfToImages(pdfPath: string) {
  try {
    const storeAsImage = fromPath(pdfPath, options);
    const outputFiles = await storeAsImage.bulk(-1);
    console.log('Successfully converted PDF to images:', outputFiles);
  } catch (error) {
    console.error('Error converting PDF to images:', error);
  }
}

const pdfFilePath = process.argv[2];

if (!pdfFilePath) {
  console.error('Please provide the path to the PDF file as an argument.');
  process.exit(1);
}

const absolutePdfPath = path.resolve(pdfFilePath);

pdfToImages(absolutePdfPath);

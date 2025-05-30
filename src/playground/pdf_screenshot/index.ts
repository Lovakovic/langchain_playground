import { fromPath } from 'pdf2pic';
import path from 'path';
import fs from 'fs';

const outputDir = path.resolve(__dirname, 'output');

// Create output directory if it doesn't exist
if (!fs.existsSync(outputDir)){
    fs.mkdirSync(outputDir, { recursive: true });
}

const options = {
  density: 100,
  saveFilename: 'page',
  savePath: outputDir,
  format: 'png',
  // Removed width and height to preserve original aspect ratio
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

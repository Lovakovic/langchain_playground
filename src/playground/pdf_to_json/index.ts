import * as pdfjsLib from 'pdfjs-dist';
import pdf from 'pdf-parse';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';

interface PageData {
  pageNumber: number;
  text: string;
  imagePaths: string[];
}

interface PDFExtractionResult {
  metadata: {
    title?: string;
    author?: string;
    creator?: string;
    totalPages: number;
  };
  pages: PageData[];
}

async function extractTextFromPDF(pdfPath: string): Promise<any> {
  const dataBuffer = fs.readFileSync(pdfPath);
  return await pdf(dataBuffer);
}

async function extractImagesFromPDF(pdfPath: string, outputDir: string, totalPages: number): Promise<{ [pageNumber: number]: string[] }> {
  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    const uint8Array = new Uint8Array(dataBuffer);
    const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
    const pdfDocument = await loadingTask.promise;
    
    const imagesByPage: { [pageNumber: number]: string[] } = {};
    
    // Extract images from each page
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      try {
        const page = await pdfDocument.getPage(pageNum);
        const operatorList = await page.getOperatorList();
        const pageImages: string[] = [];
        let imageIndex = 0;
        
        // Look for image operations
        for (let i = 0; i < operatorList.fnArray.length; i++) {
          const op = operatorList.fnArray[i];
          const args = operatorList.argsArray[i];
          
          // Check for image operations
          if (op === pdfjsLib.OPS.paintImageXObject || op === pdfjsLib.OPS.paintInlineImageXObject) {
            try {
              const imgName = args[0];
              const resources = page.commonObjs;
              const pageObjs = page.objs;
              
              // Try to extract the image
              const img = await new Promise((resolve, reject) => {
                const checkCommon = () => {
                  if (resources.has(imgName)) {
                    resolve(resources.get(imgName));
                  } else {
                    setTimeout(checkCommon, 10);
                  }
                };
                
                const checkPage = () => {
                  if (pageObjs.has(imgName)) {
                    resolve(pageObjs.get(imgName));
                  } else {
                    setTimeout(checkPage, 10);
                  }
                };
                
                checkCommon();
                checkPage();
                
                // Timeout after 1 second
                setTimeout(() => reject(new Error('Timeout')), 1000);
              });
              
              if (img && (img as any).data) {
                imageIndex++;
                const fileName = `page_${pageNum}_image_${imageIndex}.png`;
                const filePath = path.join(outputDir, fileName);
                
                // Convert to PNG
                const imgData = img as any;
                if (imgData.width && imgData.height && imgData.data) {
                  try {
                    // Try different approaches to handle the image data
                    let imageBuffer = Buffer.from(imgData.data);
                    
                    // If the image data is already in a usable format (JPEG, PNG, etc.)
                    if (imgData.kind === 'JPEG_IMAGE' || imgData.kind === 'PNG_IMAGE') {
                      // Direct write of compressed image data
                      fs.writeFileSync(filePath, imageBuffer);
                    } else {
                      // Handle raw image data with proper channel calculation
                      const expectedChannels = imgData.channels || (imageBuffer.length / (imgData.width * imgData.height));
                      let actualChannels = Math.floor(expectedChannels);
                      
                      // Ensure channels is valid (1, 3, or 4)
                      if (actualChannels < 1) actualChannels = 1;
                      else if (actualChannels === 2) actualChannels = 3;
                      else if (actualChannels > 4) actualChannels = 4;
                      
                      const expectedSize = imgData.width * imgData.height * actualChannels;
                      
                      // Only proceed if we have enough data
                      if (imageBuffer.length >= expectedSize * 0.75) { // Allow 25% tolerance
                        // Pad buffer if needed
                        if (imageBuffer.length < expectedSize) {
                          const paddedBuffer = Buffer.alloc(expectedSize);
                          imageBuffer.copy(paddedBuffer);
                          imageBuffer = paddedBuffer;
                        }
                        
                        await sharp(imageBuffer, {
                          raw: {
                            width: imgData.width,
                            height: imgData.height,
                            channels: actualChannels as 1 | 3 | 4
                          }
                        }).png().toFile(filePath);
                      } else {
                        throw new Error(`Insufficient image data: expected ${expectedSize}, got ${imageBuffer.length}`);
                      }
                    }
                    
                    pageImages.push(fileName);
                  } catch (sharpError) {
                    // If Sharp fails, try to save as raw data with different extension
                    try {
                      const rawFileName = fileName.replace('.png', '.raw');
                      const rawFilePath = path.join(outputDir, rawFileName);
                      fs.writeFileSync(rawFilePath, Buffer.from(imgData.data));
                      pageImages.push(rawFileName);
                      console.log(`Saved as raw data: ${rawFileName}`);
                    } catch (rawError) {
                      throw sharpError; // Throw original Sharp error
                    }
                  }
                }
              }
            } catch (imgError) {
              console.warn(`Could not extract image ${imageIndex + 1} from page ${pageNum}:`, (imgError as Error).message);
            }
          }
        }
        
        if (pageImages.length > 0) {
          imagesByPage[pageNum] = pageImages;
          console.log(`Found ${pageImages.length} images on page ${pageNum}`);
        } else {
          console.warn(`No extractable images found on page ${pageNum}`);
        }
        
      } catch (pageError) {
        console.warn(`Error processing page ${pageNum}:`, (pageError as Error).message);
      }
    }
    
    return imagesByPage;
  } catch (error) {
    console.error('Error extracting images:', error);
    return {};
  }
}

async function pdfToJson(pdfPath: string): Promise<void> {
  try {
    const absolutePdfPath = path.resolve(pdfPath);
    const pdfName = path.basename(pdfPath, path.extname(pdfPath));
    const outputDir = path.resolve(path.dirname(absolutePdfPath), `${pdfName}_output`);
    const imagesDir = path.join(outputDir, 'images');
    
    // Create output directories
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }

    console.log('Extracting text from PDF...');
    const pdfData = await extractTextFromPDF(absolutePdfPath);
    
    const totalPages = pdfData.numpages;
    
    console.log('Extracting images from PDF...');
    const imagesByPage = await extractImagesFromPDF(absolutePdfPath, imagesDir, totalPages);
    
    // Parse text by pages - split by common page separators
    let textPages = pdfData.text.split('\f'); // Form feed character often separates pages
    
    // If no form feed characters found, try splitting by multiple line breaks
    if (textPages.length === 1) {
      textPages = pdfData.text.split(/\n\s*\n\s*\n/); // Split on multiple line breaks
    }
    
    // If still one page, distribute text evenly across known page count
    if (textPages.length === 1 && totalPages > 1) {
      const textLength = pdfData.text.length;
      const charsPerPage = Math.ceil(textLength / totalPages);
      textPages = [];
      for (let i = 0; i < totalPages; i++) {
        const start = i * charsPerPage;
        const end = Math.min(start + charsPerPage, textLength);
        textPages.push(pdfData.text.substring(start, end));
      }
    }
    
    const pages: PageData[] = [];
    
    for (let i = 0; i < totalPages; i++) {
      const pageNumber = i + 1;
      const pageText = textPages[i] || '';
      const pageImagePaths = imagesByPage[pageNumber] || [];
      
      pages.push({
        pageNumber,
        text: pageText.trim(),
        imagePaths: pageImagePaths.map(imgPath => path.join('images', imgPath))
      });
    }

    const result: PDFExtractionResult = {
      metadata: {
        title: pdfData.info?.Title,
        author: pdfData.info?.Author,
        creator: pdfData.info?.Creator,
        totalPages: totalPages
      },
      pages
    };

    // Write JSON result
    const jsonOutputPath = path.join(outputDir, `${pdfName}.json`);
    fs.writeFileSync(jsonOutputPath, JSON.stringify(result, null, 2));
    
    console.log(`Extraction complete!`);
    console.log(`JSON output: ${jsonOutputPath}`);
    console.log(`Images directory: ${imagesDir}`);
    console.log(`Total pages processed: ${totalPages}`);
    const totalImages = Object.values(imagesByPage).reduce((sum, imgs) => sum + imgs.length, 0);
    console.log(`Total embedded images extracted: ${totalImages}`);
    
  } catch (error) {
    console.error('Error processing PDF:', error);
    process.exit(1);
  }
}

// Main execution
const pdfFilePath = process.argv[2];

if (!pdfFilePath) {
  console.error('Usage: ts-node index.ts <path-to-pdf>');
  console.error('Example: ts-node index.ts /path/to/document.pdf');
  process.exit(1);
}

if (!fs.existsSync(pdfFilePath)) {
  console.error(`Error: PDF file not found at ${pdfFilePath}`);
  process.exit(1);
}

pdfToJson(pdfFilePath);
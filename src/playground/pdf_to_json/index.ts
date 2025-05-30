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
  let pdfDocument: pdfjsLib.PDFDocumentProxy | undefined;
  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    const uint8Array = new Uint8Array(dataBuffer);
    const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
    pdfDocument = await loadingTask.promise;

    const imagesByPage: { [pageNumber: number]: string[] } = {};

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      try {
        const page = await pdfDocument.getPage(pageNum);
        const operatorList = await page.getOperatorList();
        const pageImages: string[] = [];
        let imageIndex = 0;

        for (let i = 0; i < operatorList.fnArray.length; i++) {
          const op = operatorList.fnArray[i];
          const args = operatorList.argsArray[i];

          if (op === pdfjsLib.OPS.paintImageXObject || op === pdfjsLib.OPS.paintInlineImageXObject) {
            try {
              const imgName = args[0];
              const resources = page.commonObjs;
              const pageObjs = page.objs;

              const img = await new Promise((resolve, reject) => {
                let resolved = false;
                const check = () => {
                  if (resources.has(imgName)) {
                    resolved = true;
                    resolve(resources.get(imgName));
                  } else if (pageObjs.has(imgName)) {
                    resolved = true;
                    resolve(pageObjs.get(imgName));
                  } else {
                    setTimeout(check, 10);
                  }
                };

                check();

                setTimeout(() => {
                  if (!resolved) {
                    reject(new Error(`Timeout retrieving image object for ${imgName}`));
                  }
                }, 2000);
              });


              if (img && (img as any).data) {
                imageIndex++;
                const fileName = `page_${pageNum}_image_${imageIndex}.png`;
                const filePath = path.join(outputDir, fileName);

                const imgData = img as any;
                if (imgData.width && imgData.height && imgData.data) {
                  try {
                    let imageBuffer = Buffer.from(imgData.data);

                    if (imgData.kind === 'JPEG_IMAGE' || imgData.kind === 'PNG_IMAGE') {
                      fs.writeFileSync(filePath, imageBuffer);
                    } else {
                      const expectedChannels = imgData.channels || (imageBuffer.length / (imgData.width * imgData.height));
                      let actualChannels = Math.floor(expectedChannels);

                      if (actualChannels < 1) actualChannels = 1;
                      else if (actualChannels === 2) actualChannels = 3;
                      else if (actualChannels > 4) actualChannels = 4;

                      let bufferForSharp = imageBuffer;
                      let sharpChannels = actualChannels as 1 | 3 | 4;

                      const size1 = imgData.width * imgData.height * 1;
                      const size3 = imgData.width * imgData.height * 3;
                      const size4 = imgData.width * imgData.height * 4;

                      if (bufferForSharp.length === size1) {
                        sharpChannels = 1;
                      } else if (bufferForSharp.length === size3) {
                        sharpChannels = 3;
                      } else if (bufferForSharp.length === size4) {
                        sharpChannels = 4;
                      } else {
                        const requiredSize = imgData.width * imgData.height * sharpChannels;
                        if (bufferForSharp.length < requiredSize) {
                          const paddedBuffer = Buffer.alloc(requiredSize);
                          bufferForSharp.copy(paddedBuffer);
                          bufferForSharp = paddedBuffer;
                        } else if (bufferForSharp.length > requiredSize) {
                          bufferForSharp = bufferForSharp.slice(0, requiredSize);
                        }
                      }

                      // Check if bufferForSharp has enough data for the determined channels and dimensions
                      const minimumRequiredSize = imgData.width * imgData.height * (sharpChannels > 0 ? sharpChannels : 1); // At least 1 channel
                      if (bufferForSharp.length >= minimumRequiredSize * 0.9) { // Allow slight tolerance
                        await sharp(bufferForSharp, {
                          raw: {
                            width: imgData.width,
                            height: imgData.height,
                            channels: sharpChannels
                          }
                        }).png().toFile(filePath);
                      } else {
                        throw new Error(`Insufficient processed image data for sharp: expected at least ${minimumRequiredSize}, got ${bufferForSharp.length}`);
                      }
                    }

                    pageImages.push(fileName);
                  } catch (sharpError) {
                    try {
                      const rawFileName = fileName.replace('.png', '.raw');
                      const rawFilePath = path.join(outputDir, rawFileName);
                      fs.writeFileSync(rawFilePath, Buffer.from(imgData.data));
                      pageImages.push(rawFileName);
                      console.warn(`[Page ${pageNum} Image ${imageIndex}] Sharp failed, saved as raw data: ${rawFileName} - ${(sharpError as Error).message}`);
                    } catch (rawError) {
                      console.error(`[Page ${pageNum} Image ${imageIndex}] Failed to save image as PNG or raw: ${(sharpError as Error).message}, ${(rawError as Error).message}`);
                    }
                  }
                }
              }
            } catch (imgError) {
              console.warn(`[Page ${pageNum}] Could not process image operation: ${(imgError as Error).message}`);
            }
          }
        }

        if (pageImages.length > 0) {
          imagesByPage[pageNum] = pageImages;
          console.log(`Found ${pageImages.length} images on page ${pageNum}`);
        } else {
          console.log(`No images extracted on page ${pageNum}`);
        }

      } catch (pageError) {
        console.error(`Error processing page ${pageNum}:`, (pageError as Error).message);
      }
    }

    if (pdfDocument) {
      try {
        await pdfDocument.destroy();
      } catch (destroyError) {
        console.warn("Error destroying PDF document:", destroyError);
      }
    }

    return imagesByPage;
  } catch (error) {
    console.error('Error extracting images:', error);
    if (pdfDocument) {
      try {
        await pdfDocument.destroy();
      } catch (destroyError) {
        console.warn("Error destroying PDF document after error:", destroyError);
      }
    }
    return {};
  }
}

async function pdfToJson(pdfPath: string): Promise<void> {
  let processExited = false;

  try {
    const absolutePdfPath = path.resolve(pdfPath);
    const pdfName = path.basename(pdfPath, path.extname(pdfPath));

    const scriptDir = __dirname;
    const outputDir = path.join(scriptDir, `${pdfName}_output`);

    const imagesDir = path.join(outputDir, 'images');

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

    let textPages = pdfData.text.split('\f');

    if (textPages.length === 1) {
      textPages = pdfData.text.split(/\n\s*\n\s*\n/);
    }

    if (textPages.length !== totalPages && totalPages > 1) {
      console.warn(`Text parsing resulted in ${textPages.length} chunks, but PDF has ${totalPages} pages. Attempting to distribute text evenly.`);
      const textLength = pdfData.text.length;
      const charsPerPage = Math.ceil(textLength / totalPages);
      const distributedTextPages = [];
      for (let i = 0; i < totalPages; i++) {
        const start = i * charsPerPage;
        const end = Math.min(start + charsPerPage, textLength);
        distributedTextPages.push(pdfData.text.substring(start, end));
      }
      textPages = distributedTextPages; // Use the distributed text
    } else if (textPages.length > totalPages) {
      console.warn(`Text parsing resulted in ${textPages.length} chunks, which is more than the PDF's ${totalPages} pages. Truncating text chunks to match page count.`);
      textPages = textPages.slice(0, totalPages);
    } else if (textPages.length < totalPages && textPages.length > 1) {
      console.warn(`Text parsing resulted in ${textPages.length} chunks, which is less than the PDF's ${totalPages} pages. Padding with empty pages.`);
      while(textPages.length < totalPages) {
        textPages.push('');
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
        imagePaths: pageImagePaths.map(imgPath => path.join('images', path.basename(imgPath)))
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

    const jsonOutputPath = path.join(outputDir, `${pdfName}.json`);
    fs.writeFileSync(jsonOutputPath, JSON.stringify(result, null, 2));

    console.log(`Extraction complete!`);
    console.log(`JSON output: ${jsonOutputPath}`);
    console.log(`Images directory: ${imagesDir}`);
    console.log(`Total pages processed: ${totalPages}`);
    const totalImages = Object.values(imagesByPage).reduce((sum, imgs) => sum + imgs.length, 0);
    console.log(`Total embedded images extracted: ${totalImages}`);

    processExited = true;
    process.exit(0);

  } catch (error) {
    console.error('Error processing PDF:', error);
    if (!processExited) {
      process.exit(1);
    }
  }
}

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

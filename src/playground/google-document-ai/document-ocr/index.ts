import { config } from 'dotenv';
import {
  DocumentProcessorServiceClient,
  protos,
} from '@google-cloud/documentai';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, rgb, PageSizes } from 'pdf-lib';

type IProcessRequest = protos.google.cloud.documentai.v1.IProcessRequest;

/**
 * Extract bounding box information from a document element
 * @param element The element with potential bounding box data
 * @returns String representation of bounding box coordinates
 */
function getBoundingBoxInfo(element: any): string {
  if (!element) return 'No element';
  
  // Check for bounding box in layout
  if (element.layout?.boundingPoly) {
    return formatBoundingBox(element.layout.boundingPoly);
  }
  
  // Check for direct bounding box
  if (element.boundingPoly) {
    return formatBoundingBox(element.boundingPoly);
  }
  
  return 'No bounding box data';
}

/**
 * Format bounding box coordinates for display
 * @param boundingPoly The bounding polygon object
 * @returns Formatted string with coordinates
 */
function formatBoundingBox(boundingPoly: any): string {
  if (!boundingPoly) return 'No bounding box';
  
  let result = '';
  
  if (boundingPoly.vertices && boundingPoly.vertices.length > 0) {
    const vertices = boundingPoly.vertices.map((v: any) => `(${v.x || 0}, ${v.y || 0})`).join(', ');
    result += `Vertices: ${vertices}`;
  }
  
  if (boundingPoly.normalizedVertices && boundingPoly.normalizedVertices.length > 0) {
    const vertices = boundingPoly.normalizedVertices.map((v: any) => `(${(v.x || 0).toFixed(3)}, ${(v.y || 0).toFixed(3)})`).join(', ');
    if (result) result += ' | ';
    result += `Normalized: ${vertices}`;
  }
  
  return result || 'Empty bounding box';
}

/**
 * Extract text from a text anchor
 * @param fullText The complete document text
 * @param textAnchor The text anchor object
 * @returns Extracted text
 */
function getTextFromAnchor(fullText: string, textAnchor: any): string {
  if (!textAnchor?.textSegments?.[0]) return '';
  
  const segment = textAnchor.textSegments[0];
  const start = parseInt(segment.startIndex || '0');
  const end = parseInt(segment.endIndex || '0');
  
  return fullText.substring(start, end);
}

// Types for layout-aware text reconstruction
interface TextElement {
  text: string;
  boundingBox: protos.google.cloud.documentai.v1.IBoundingPoly;
}

/**
 * Reconstructs text from a page, respecting the reading order based on bounding boxes.
 * @param page The Document AI page object.
 * @param fullText The full text of the document.
 * @returns A string with the reconstructed text for the page.
 */
function reconstructTextWithLayout(page: protos.google.cloud.documentai.v1.Document.IPage, fullText: string): string {
  if (!page.lines) return '';

  const lines: TextElement[] = page.lines.map(line => ({
    text: getTextFromAnchor(fullText, line.layout?.textAnchor),
    boundingBox: line.layout?.boundingPoly!,
  }));

  // Sort lines by reading order (top-to-bottom, then left-to-right)
  lines.sort((a, b) => {
    const yA = a.boundingBox?.normalizedVertices?.[0]?.y ?? 0;
    const yB = b.boundingBox?.normalizedVertices?.[0]?.y ?? 0;
    const xA = a.boundingBox?.normalizedVertices?.[0]?.x ?? 0;
    const xB = b.boundingBox?.normalizedVertices?.[0]?.x ?? 0;

    // A small tolerance for vertical alignment to group lines that are close
    const yTolerance = 0.01;

    if (Math.abs(yA - yB) > yTolerance) {
      return yA - yB;
    }
    return xA - xB;
  });

  // Join lines into a single text block
  return lines.map(line => line.text).join('\n');
}

/**
 * Saves the reconstructed text to a file.
 * @param document The Document AI document object.
 */
function saveReconstructedText(document: protos.google.cloud.documentai.v1.IDocument) {
  if (!document.pages) return;

  let fullReconstructedText = '';
  const fullText = document.text || '';

  for (const page of document.pages) {
    fullReconstructedText += `--- Page ${page.pageNumber} ---\n`;
    fullReconstructedText += reconstructTextWithLayout(page, fullText);
    fullReconstructedText += '\n\n';
  }

  const outputFilePath = path.join(currentDir, 'document-ocr-reconstructed.txt');
  fs.writeFileSync(outputFilePath, fullReconstructedText);
  console.log(`\n📄 Reconstructed text saved to: ${outputFilePath}`);
}


// @ts-ignore
const __filename = fileURLToPath(import.meta.url);
const currentDir = path.dirname(__filename);

// Load environment variables
config();

type DocumentAIClient = DocumentProcessorServiceClient;

class DocumentAIOCRProcessor {
  private readonly client: DocumentAIClient;
  private readonly processorId: string;
  private readonly location: string;
  private readonly projectId: string;

  constructor() {
    this.client = new DocumentProcessorServiceClient({
      apiEndpoint: 'eu-documentai.googleapis.com',
    });
    this.processorId = process.env.DOCUMENT_AI_OCR_PROCESSOR_ID!;
    this.location = process.env.DOCUMENT_AI_LOCATION!;
    this.projectId = process.env.GOOGLE_CLOUD_PROJECT_ID!;

    if (!this.processorId || !this.location || !this.projectId) {
      throw new Error(
        'Missing required Document AI environment variables: DOCUMENT_AI_OCR_PROCESSOR_ID, DOCUMENT_AI_LOCATION, GOOGLE_CLOUD_PROJECT_ID'
      );
    }

    console.log(`🔧 Document AI OCR Configuration:`);
    console.log(`   Project ID: ${this.projectId}`);
    console.log(`   Location: ${this.location}`);
    console.log(`   OCR Processor ID: ${this.processorId}`);
  }

  async processPdf(filePath: string): Promise<void> {
    console.log(`\n📖 Processing PDF with OCR: ${filePath}`);

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const startTime = Date.now();
    const buffer = fs.readFileSync(filePath);
    const name = `projects/${this.projectId}/locations/${this.location}/processors/${this.processorId}`;
    const encodedContent = buffer.toString('base64');

    const request: IProcessRequest = {
      name,
      rawDocument: {
        content: encodedContent,
        mimeType: 'application/pdf',
      },
      processOptions: {
        ocrConfig: {
          enableNativePdfParsing: true,
          enableImageQualityScores: true,
          enableSymbol: true,
          premiumFeatures: {
            computeStyleInfo: true,
            enableSelectionMarkDetection: true,
          },
        },
      },
    };

    try {
      console.log(`🚀 Sending document to Google Document AI OCR...`);
      const [result] = await this.client.processDocument(request);

      console.log('\n🔍 OCR Response structure captured');

      const responseFilePath = path.join(currentDir, 'document-ai-ocr-response.json');
      fs.writeFileSync(responseFilePath, JSON.stringify(result, null, 2));
      console.log(`💾 Full OCR response saved to: ${responseFilePath}`);

      const { document } = result;

      if (!document) {
        throw new Error('Document AI returned no document object.');
      }

      const processingTime = Date.now() - startTime;
      console.log(`✅ OCR Processing completed in ${processingTime}ms`);
      console.log(`📄 Document has ${document.pages?.length || 0} pages`);

      // Extract and display text
      const fullText = document.text || '';
      console.log(`\n📝 EXTRACTED TEXT (${fullText.length} characters):`);
      console.log('=' .repeat(50));
      console.log(fullText.substring(0, 500) + (fullText.length > 500 ? '...' : ''));
      console.log('=' .repeat(50));

      // Analyze pages and their elements with bounding boxes
      if (document.pages && document.pages.length > 0) {
        console.log(`\n📄 PAGE ANALYSIS WITH BOUNDING BOXES:`);
        
        document.pages.forEach((page, pageIndex) => {
          console.log(`\n--- Page ${pageIndex + 1} ---`);
          console.log(`🔢 Page Number: ${page.pageNumber || 'N/A'}`);
          console.log(`📐 Dimensions: ${page.dimension?.width}x${page.dimension?.height} ${page.dimension?.unit || 'unknown'}`);
          
          // Analyze blocks
          if (page.blocks && page.blocks.length > 0) {
            console.log(`\n🧱 BLOCKS (${page.blocks.length}):`);
            page.blocks.slice(0, 3).forEach((block, blockIndex) => {
              const text = getTextFromAnchor(fullText, block.layout?.textAnchor);
              console.log(`  Block ${blockIndex + 1}: "${text.substring(0, 50).replace(/\n/g, ' ')}${text.length > 50 ? '...' : ''}"`);
              console.log(`    📦 ${getBoundingBoxInfo(block)}`);
              console.log(`    🎯 Confidence: ${block.layout?.confidence || 'N/A'}`);
            });
            if (page.blocks.length > 3) {
              console.log(`    ... and ${page.blocks.length - 3} more blocks`);
            }
          }
          
          // Analyze paragraphs
          if (page.paragraphs && page.paragraphs.length > 0) {
            console.log(`\n📝 PARAGRAPHS (${page.paragraphs.length}):`);
            page.paragraphs.slice(0, 3).forEach((paragraph, pIndex) => {
              const text = getTextFromAnchor(fullText, paragraph.layout?.textAnchor);
              console.log(`  Paragraph ${pIndex + 1}: "${text.substring(0, 50).replace(/\n/g, ' ')}${text.length > 50 ? '...' : ''}"`);
              console.log(`    📦 ${getBoundingBoxInfo(paragraph)}`);
            });
            if (page.paragraphs.length > 3) {
              console.log(`    ... and ${page.paragraphs.length - 3} more paragraphs`);
            }
          }
          
          // Analyze lines
          if (page.lines && page.lines.length > 0) {
            console.log(`\n📏 LINES (${page.lines.length}):`);
            page.lines.slice(0, 3).forEach((line, lIndex) => {
              const text = getTextFromAnchor(fullText, line.layout?.textAnchor);
              console.log(`  Line ${lIndex + 1}: "${text.substring(0, 30).replace(/\n/g, ' ')}${text.length > 30 ? '...' : ''}"`);
              console.log(`    📦 ${getBoundingBoxInfo(line)}`);
            });
            if (page.lines.length > 3) {
              console.log(`    ... and ${page.lines.length - 3} more lines`);
            }
          }
          
          // Analyze tokens (words)
          if (page.tokens && page.tokens.length > 0) {
            console.log(`\n🔤 TOKENS/WORDS (${page.tokens.length}):`);
            page.tokens.slice(0, 5).forEach((token, tIndex) => {
              const text = getTextFromAnchor(fullText, token.layout?.textAnchor);
              console.log(`  Token ${tIndex + 1}: "${text}"`);
              console.log(`    📦 ${getBoundingBoxInfo(token)}`);
            });
            if (page.tokens.length > 5) {
              console.log(`    ... and ${page.tokens.length - 5} more tokens`);
            }
          }

          // Analyze form fields if any
          if (page.formFields && page.formFields.length > 0) {
            console.log(`\n📋 FORM FIELDS (${page.formFields.length}):`);
            page.formFields.slice(0, 3).forEach((field, fIndex) => {
              const fieldName = getTextFromAnchor(fullText, field.fieldName?.textAnchor);
              const fieldValue = getTextFromAnchor(fullText, field.fieldValue?.textAnchor);
              console.log(`  Field ${fIndex + 1}: "${fieldName}" = "${fieldValue}"`);
              console.log(`    📦 Name: ${getBoundingBoxInfo(field.fieldName)}`);
              console.log(`    📦 Value: ${getBoundingBoxInfo(field.fieldValue)}`);
            });
          }

          // Analyze tables if any
          if (page.tables && page.tables.length > 0) {
            console.log(`\n🗂️  TABLES (${page.tables.length}):`);
            page.tables.forEach((table, tIndex) => {
              console.log(`  Table ${tIndex + 1}:`);
              console.log(`    📦 ${getBoundingBoxInfo(table)}`);
              console.log(`    🗂️  Header rows: ${table.headerRows?.length || 0}`);
              console.log(`    📊 Body rows: ${table.bodyRows?.length || 0}`);
            });
          }
        });
      }

      console.log(`\n🎉 Successfully processed ${path.basename(filePath)} with OCR`);
      console.log(`📊 Summary:`);
      console.log(`   - Processing time: ${processingTime}ms`);
      console.log(`   - Pages: ${document.pages?.length || 0}`);
      console.log(`   - Total extracted text: ${fullText.length} characters`);
      
      const totalElements = document.pages?.reduce((total, page) => {
        return total + 
          (page.blocks?.length || 0) + 
          (page.paragraphs?.length || 0) + 
          (page.lines?.length || 0) + 
          (page.tokens?.length || 0);
      }, 0) || 0;
      
      console.log(`   - Total elements with bounding boxes: ${totalElements}`);

      // Save the reconstructed text
      saveReconstructedText(document);

      // Generate annotated PDF with bounding boxes
      await this.createAnnotatedPDF(filePath, document);

    } catch (error: any) {
      console.error('💥 OCR processing error occurred:');
      if (error.details) {
        console.error('🔍 gRPC Error Details:', error.details);
      } else {
        console.error(error);
      }
      process.exit(1);
    }
  }

  /**
   * Create an annotated PDF with bounding boxes overlaid on the original document
   */
  async createAnnotatedPDF(originalPdfPath: string, document: any): Promise<void> {
    try {
      console.log('\n🎨 Creating annotated PDF with bounding boxes...');
      
      // Read the original PDF
      const originalPdfBytes = fs.readFileSync(originalPdfPath);
      const pdfDoc = await PDFDocument.load(originalPdfBytes);
      const pages = pdfDoc.getPages();

      if (!document.pages || document.pages.length === 0) {
        console.log('❌ No pages found in document to annotate');
        return;
      }

      // Color scheme for different element types
      const colors = {
        block: rgb(1, 0, 0),      // Red for blocks
        paragraph: rgb(0, 1, 0),   // Green for paragraphs  
        line: rgb(0, 0, 1),        // Blue for lines
        token: rgb(1, 0.5, 0),     // Orange for tokens/words
        formField: rgb(1, 0, 1),   // Magenta for form fields
        table: rgb(0.5, 0, 0.5),   // Purple for tables
      };

      // Process each page
      document.pages.forEach((docPage: any, pageIndex: number) => {
        if (pageIndex >= pages.length) {
          console.log(`⚠️  Skipping page ${pageIndex + 1} - not found in PDF`);
          return;
        }

        const pdfPage = pages[pageIndex];
        const { width: pageWidth, height: pageHeight } = pdfPage.getSize();
        
        console.log(`📄 Annotating page ${pageIndex + 1} (${pageWidth}x${pageHeight})`);

        let elementCount = 0;

        // Draw bounding boxes for different element types
        // Note: We'll draw tokens (words) as they're the most granular and useful
        if (docPage.tokens && docPage.tokens.length > 0) {
          docPage.tokens.forEach((token: any) => {
            if (token.layout?.boundingPoly?.normalizedVertices) {
              this.drawBoundingBox(
                pdfPage, 
                token.layout.boundingPoly.normalizedVertices,
                pageWidth,
                pageHeight,
                colors.token,
                0.5  // Line width
              );
              elementCount++;
            }
          });
        }

        // Draw paragraph boundaries (thicker lines)
        if (docPage.paragraphs && docPage.paragraphs.length > 0) {
          docPage.paragraphs.forEach((paragraph: any) => {
            if (paragraph.layout?.boundingPoly?.normalizedVertices) {
              this.drawBoundingBox(
                pdfPage,
                paragraph.layout.boundingPoly.normalizedVertices,
                pageWidth,
                pageHeight,
                colors.paragraph,
                1.5  // Thicker line for paragraphs
              );
            }
          });
        }

        // Draw form field boundaries (if any)
        if (docPage.formFields && docPage.formFields.length > 0) {
          docPage.formFields.forEach((field: any) => {
            if (field.fieldName?.boundingPoly?.normalizedVertices) {
              this.drawBoundingBox(
                pdfPage,
                field.fieldName.boundingPoly.normalizedVertices,
                pageWidth,
                pageHeight,
                colors.formField,
                2.0
              );
            }
            if (field.fieldValue?.boundingPoly?.normalizedVertices) {
              this.drawBoundingBox(
                pdfPage,
                field.fieldValue.boundingPoly.normalizedVertices,
                pageWidth,
                pageHeight,
                colors.formField,
                1.0
              );
            }
          });
        }

        // Draw table boundaries (if any)
        if (docPage.tables && docPage.tables.length > 0) {
          docPage.tables.forEach((table: any) => {
            if (table.layout?.boundingPoly?.normalizedVertices) {
              this.drawBoundingBox(
                pdfPage,
                table.layout.boundingPoly.normalizedVertices,
                pageWidth,
                pageHeight,
                colors.table,
                3.0  // Thick line for tables
              );
            }
          });
        }

        console.log(`   ✅ Drew ${elementCount} token bounding boxes on page ${pageIndex + 1}`);
      });

      // Save the annotated PDF
      const annotatedPdfBytes = await pdfDoc.save();
      const outputPath = path.join(currentDir, `annotated_${path.basename(originalPdfPath)}`);
      fs.writeFileSync(outputPath, annotatedPdfBytes);

      console.log(`\n🎉 Annotated PDF created successfully!`);
      console.log(`📁 Output file: ${outputPath}`);
      console.log(`📊 Annotation summary:`);
      console.log(`   🔶 Orange boxes: Individual words/tokens`);
      console.log(`   🟢 Green boxes: Paragraphs`);
      console.log(`   🟣 Purple boxes: Tables (if detected)`);
      console.log(`   🟪 Magenta boxes: Form fields (if detected)`);

    } catch (error) {
      console.error('💥 Error creating annotated PDF:', error);
    }
  }

  /**
   * Draw a bounding box on a PDF page using normalized coordinates
   */
  private drawBoundingBox(
    page: any,
    normalizedVertices: any[],
    pageWidth: number,
    pageHeight: number,
    color: any,
    lineWidth: number
  ): void {
    if (normalizedVertices.length < 4) return;

    try {
      // Convert normalized coordinates (0-1) to PDF coordinates
      // Document AI: (0,0) at top-left, Y increases downward
      // PDF-lib: (0,0) at bottom-left, Y increases upward
      
      // Get the top-left and bottom-right corners from normalized vertices
      const topLeft = normalizedVertices[0] || {};
      const bottomRight = normalizedVertices[2] || {};
      
      // Convert to PDF coordinates
      const x = (topLeft.x || 0) * pageWidth;
      const y = pageHeight - (bottomRight.y || 0) * pageHeight; // Bottom of box in PDF coords
      const width = ((bottomRight.x || 0) - (topLeft.x || 0)) * pageWidth;
      const height = ((bottomRight.y || 0) - (topLeft.y || 0)) * pageHeight;

      // Ensure positive dimensions
      if (width <= 0 || height <= 0) return;

      // Draw the bounding box as a rectangle
      page.drawRectangle({
        x: x,
        y: y,
        width: width,
        height: height,
        borderColor: color,
        borderWidth: lineWidth,
        opacity: 0.8,
      });
    } catch (error) {
      // Skip invalid bounding boxes
      console.debug('Skipped invalid bounding box:', normalizedVertices, error);
    }
  }
}

async function main() {
  try {
    console.log('🤖 Google Document AI OCR with Bounding Boxes Example');
    console.log('=' .repeat(60));

    const processor = new DocumentAIOCRProcessor();
    const pdfPath = path.join(currentDir, '..', 'menu.pdf');

    await processor.processPdf(pdfPath);

  } catch (error) {
    console.error('💥 Error in main:', error);
    process.exit(1);
  }
}

main();
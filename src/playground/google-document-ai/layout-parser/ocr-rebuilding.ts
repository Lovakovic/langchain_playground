import { config } from 'dotenv';
import { ChatVertexAI } from '@langchain/google-vertexai';
import { ContentBlock, HumanMessage, SystemMessage } from '@langchain/core/messages';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { fromBuffer } from 'pdf2pic';
import { v4 as uuidv4 } from 'uuid';
// @ts-ignore
import {
  formatTextWithPageDelimiters,
  processDocumentByPages,
} from './index';

// @ts-ignore
const __filename = fileURLToPath(import.meta.url);
const currentDir = path.dirname(__filename);
const execAsync = promisify(exec);

// Load environment variables
config();

/**
 * Creates the same monolithic preprocessing prompt used in monkey-ai
 * This is the exact same logic from extraction.prompts.ts
 * Updated to mention that images are also provided for context
 */
function createMonolithicPreprocessingPrompt(totalPageCount: number): string {
  return `You are an elite document layout analyst and OCR correction specialist. Your task is to process the entire raw OCR text from a multi-page menu document. You will receive both the OCR text and corresponding page images for visual context, with markers like "--- CONTENT FROM PAGE X BEGINS ---" indicating page breaks.

The images provided will help you understand the spatial layout and visual context that the OCR may have missed or misinterpreted. Use the visual information from the images to better associate items with their descriptions, prices, and allergen codes.

Your goal is to restructure this raw text into a single, clean, logically-ordered Markdown document. You MUST correct spatial ambiguities and associate item names with their descriptions, prices, and allergen codes, but you must strictly adhere to the original document's structure and content.

**PRIMARY DIRECTIVE: Reconstruct, Do Not Re-imagine.**

**CRITICAL OUTPUT FORMATTING RULES:**
1.  **MANDATORY PAGE DELIMITERS:** You MUST preserve the page structure in your output. After processing the content for a page, you MUST insert a clear, machine-readable delimiter on its own line. Use the EXACT format: \`--- PAGE_BREAK ---\`. You will insert this delimiter ${totalPageCount - 1} times.
2.  **USE MARKDOWN FOR STRUCTURE:**
    -   **Headers:** Use headers (\`#\`, \`##\`) for section and sub-section titles.
    -   **Section Notes:** Use blockquotes (\`>\`) for general text that applies to a whole section, placing it directly under the section header.
    -   **Items:** DO NOT add any bullet points (\`-\`) or other prefixes. Preserve the EXACT original formatting and prefixes as they appear in the menu.
3.  **STRUCTURE & CONTENT FIDELITY RULES:**
    -   **NO GLOBAL REORDERING:** You MUST maintain the high-level sequence of the menu. The order of major sections (e.g., "Appetizers" then "Main Courses" then "Desserts") MUST NOT be changed. The relative order of items within a section MUST be preserved.
    -   **ALLOW LOCAL REORDERING FOR COHERENCE:** You ARE PERMITTED to reorder text elements *within a single item's block* to create a logical, readable line. For example, if the OCR extracts a price before the item name due to column layout, you MUST reorder them correctly.
        -   **Example OCR Input:** "12.50 ..... 20. Pizza Salami ..... A, G"
        -   **Correct Reordered Output:** "20. Pizza Salami (A, G) - 12.50" (preserve the "20." prefix exactly as it appears)
    -   **PRESERVE ORIGINAL PREFIXES ONLY:** You MUST keep any original item prefixes exactly as they appear, such as numbers or codes (e.g., "25. Rumpsteak", "P1. Pizza Salami"). DO NOT add bullet points or other formatting prefixes that don't exist in the original.
    -   **DISTINGUISH ITEM vs CATEGORY DESCRIPTIONS:** Pay careful attention to whether descriptions apply to individual items or entire categories. Item-level descriptions should stay with their specific items. Category-level descriptions should be placed under section headers as blockquotes. DO NOT mix or move descriptions between items and categories.
    -   **PRESERVE ALL TEXT:** You MUST NOT summarize, translate, or discard any text. Every word, number, and symbol from the original OCR must be present in your final output.
4.  **ASSOCIATION & MERGING RULES (Your Core Task):**
    -   An item name, its description, its allergen codes/declarations, and its price(s) MUST be grouped into a single, cohesive unit, typically a single line or a single multi-line list item.
    -   If prices are in a separate column, you MUST correctly associate them with the corresponding item on the same horizontal line.
    -   Merge fragmented lines from the OCR into coherent sentences.
5.  **CORRECTION RULE:** You MAY correct obvious OCR errors (e.g., "Salat" instead of "Salami" if context is clear), but you MUST NOT creatively rewrite, enhance, or add information. Your role is to be a high-fidelity restorer, not a copywriter.

**EXAMPLE SCENARIO:**

--- RAW OCR INPUT ---
--- CONTENT FROM PAGE 1 BEGINS ---
STEAKS
Alle Steaks serviert mit Beilage
25. Rumpsteak
Argentinisches Rind
25,50
--- CONTENT FROM PAGE 1 ENDS ---
--- CONTENT FROM PAGE 2 BEGINS ---
26. Rib-Eye
(G, A1)
32,00
HAUPTGERICHTE
--- CONTENT FROM PAGE 2 ENDS ---

--- CORRECT MARKDOWN OUTPUT ---
# STEAKS
> Alle Steaks serviert mit Beilage

25. Rumpsteak (Argentinisches Rind) - 25,50

--- PAGE_BREAK ---

26. Rib-Eye (G, A1) - 32,00

# HAUPTGERICHTE

--- END OF EXAMPLE ---

Now, process the entire document provided and return a single, structured Markdown text block that follows all of these rules precisely.`;
}

/**
 * OCR Rebuilding Script
 * Replicates the monolithic preprocessing behavior from monkey-ai
 * Now with integrated Document AI processing AND PDF images!
 */
class OCRRebuilder {
  private model: ChatVertexAI;
  private readonly targetPixelWidth = 2400;
  private readonly minDpi = 150;
  private readonly maxDpi = 300;

  constructor() {
    // Initialize the same model used in monkey-ai
    this.model = new ChatVertexAI({
      model: 'gemini-2.5-pro',
      temperature: 0.0,
    });

    console.log('🤖 OCR Rebuilding Script - Enhanced Pipeline');
    console.log('='.repeat(60));
    console.log('📋 Pipeline: PDF → Images + Document AI → LLM (Images + Text) → Clean Text');
  }

  /**
   * Get PDF dimensions using pdfinfo (same as monkey-ai)
   */
  private async getPdfDimensions(
    pdfPath: string,
  ): Promise<{ width: number; height: number } | null> {
    try {
      const { stdout } = await execAsync(`pdfinfo "${pdfPath}"`);
      const sizeMatch = stdout.match(/Page size:\s*(\d+(?:\.\d+)?)\s+x\s+(\d+(?:\.\d+)?)\s+pts/);
      if (sizeMatch && sizeMatch[1] && sizeMatch[2]) {
        return { width: parseFloat(sizeMatch[1]), height: parseFloat(sizeMatch[2]) };
      }
    } catch (error) {
      console.warn(
        '⚠️ Could not get PDF dimensions via pdfinfo. Poppler-utils might be missing. Using fallback DPI.',
      );
    }
    return null;
  }

  /**
   * Calculate adaptive DPI (same logic as monkey-ai)
   */
  private async calculateAdaptiveDPI(pdfPath: string): Promise<number> {
    const dimensions = await this.getPdfDimensions(pdfPath);
    if (!dimensions || dimensions.width === 0) {
      return 250;
    }
    const pdfWidthInches = dimensions.width / 72;
    const calculatedDPI = Math.round(this.targetPixelWidth / pdfWidthInches);
    return Math.max(this.minDpi, Math.min(this.maxDpi, calculatedDPI));
  }

  /**
   * Convert PDF to images using exact monkey-ai settings
   */
  private async getImagesFromPdf(
    pdfBuffer: Buffer,
    tempDir: string,
    adaptiveDPI: number,
  ): Promise<Map<number, Buffer>> {
    const converter = fromBuffer(pdfBuffer, {
      density: adaptiveDPI,
      format: 'jpeg',
      quality: 95,
      saveFilename: 'page',
      savePath: tempDir,
    });
    const pageImageResults = await converter.bulk(-1, { responseType: 'buffer' });
    const imageMap = new Map<number, Buffer>();
    pageImageResults.forEach((result) => {
      if (result.buffer && result.page !== undefined) {
        imageMap.set(result.page, result.buffer);
      }
    });
    return imageMap;
  }

  /**
   * Process raw OCR text with images and rebuild using LLM
   */
  async processOCRTextWithImages(
    rawText: string,
    imageBuffersMap: Map<number, Buffer>,
  ): Promise<string> {
    console.log('🧠 Processing raw OCR text + images with LLM...');

    // Count the number of pages from the input text
    const pageMatches = rawText.match(/--- Page \d+ starts ---/g);
    const totalPageCount = pageMatches ? pageMatches.length : 1;

    console.log(`📊 Detected ${totalPageCount} pages in the document`);
    console.log(`🖼️ Available images for ${imageBuffersMap.size} pages`);

    // Convert the format from improved.ts to monkey-ai format
    const convertedText = this.convertToMonkeyAIFormat(rawText);

    // Create the enhanced prompt that mentions images
    const prompt = createMonolithicPreprocessingPrompt(totalPageCount);

    // Build message content with both images and text
    const messageContent: ContentBlock[] = [];

    // Add images first (one per page)
    for (let pageNum = 1; pageNum <= totalPageCount; pageNum++) {
      const imageBuffer = imageBuffersMap.get(pageNum);
      if (imageBuffer) {
        messageContent.push({
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}` },
        });
      }
    }

    // Add the OCR text
    messageContent.push({ type: 'text', text: convertedText });

    const messages = [new SystemMessage(prompt), new HumanMessage({ content: messageContent })];

    console.log('🚀 Calling Gemini 2.5-pro with images + OCR text...');
    const startTime = Date.now();

    try {
      const response = await this.model.invoke(messages);
      const processedText = response.content as string;

      const processingTime = Date.now() - startTime;
      console.log(`✅ LLM processing completed in ${processingTime}ms`);

      return processedText;
    } catch (error) {
      console.error('❌ Error during LLM processing:', error);
      throw error;
    }
  }

  /**
   * Convert the improved.ts format to monkey-ai expected format
   */
  private convertToMonkeyAIFormat(text: string): string {
    // Convert from "--- Page X starts ---" to "--- CONTENT FROM PAGE X BEGINS ---"
    let converted = text.replace(
      /--- Page (\d+) starts ---/g,
      '--- CONTENT FROM PAGE $1 BEGINS ---',
    );

    // Convert from "--- Page X ends ---" to "--- CONTENT FROM PAGE X ENDS ---"
    converted = converted.replace(/--- Page (\d+) ends ---/g, '--- CONTENT FROM PAGE $1 ENDS ---');

    return converted;
  }

  /**
   * Process PDF with both Document AI (OCR) and image conversion
   */
  async processWithDocumentAIAndImages(
    pdfPath: string,
  ): Promise<{ rawText: string; imageBuffersMap: Map<number, Buffer> }> {
    console.log(`📖 Processing PDF with Document AI + Images: ${pdfPath}`);

    if (!fs.existsSync(pdfPath)) {
      throw new Error(`PDF file not found: ${pdfPath}`);
    }

    const buffer = fs.readFileSync(pdfPath);
    const tempDir = path.join(os.tmpdir(), `ocr-rebuilding-${uuidv4()}`);
    await fs.promises.mkdir(tempDir, { recursive: true });

    try {
      // Step 1: Calculate adaptive DPI
      console.log('🔧 Calculating adaptive DPI...');
      const adaptiveDPI = await this.calculateAdaptiveDPI(pdfPath);
      console.log(`📐 Using DPI: ${adaptiveDPI}`);

      // Step 2: Convert PDF to images (parallel with Document AI)
      console.log('🖼️ Converting PDF to images...');
      const imageStartTime = Date.now();
      const imageBuffersMap = await this.getImagesFromPdf(buffer, tempDir, adaptiveDPI);
      const imageTime = Date.now() - imageStartTime;
      console.log(
        `✅ Image conversion completed in ${imageTime}ms (${imageBuffersMap.size} pages)`,
      );

      // Step 3: Process with Document AI
      console.log('🚀 Calling Google Document AI...');
      const docAIStartTime = Date.now();

      const processorId = process.env['DOCUMENT_AI_PROCESSOR_ID']!;
      const location = process.env['DOCUMENT_AI_LOCATION']!;
      const projectId = process.env['GOOGLE_CLOUD_PROJECT_ID']!;

      if (!processorId || !location || !projectId) {
        throw new Error(
          'Missing required Document AI environment variables: DOCUMENT_AI_PROCESSOR_ID, DOCUMENT_AI_LOCATION, GOOGLE_CLOUD_PROJECT_ID',
        );
      }

      const { DocumentProcessorServiceClient } = await import('@google-cloud/documentai');

      const client = new DocumentProcessorServiceClient({
        apiEndpoint: `${location}-documentai.googleapis.com`,
      });

      const name = `projects/${projectId}/locations/${location}/processors/${processorId}`;
      const encodedContent = buffer.toString('base64');

      const request = {
        name,
        rawDocument: {
          content: encodedContent,
          mimeType: 'application/pdf',
        },
      };

      const [result] = await client.processDocument(request);
      const { document } = result;

      if (!document?.documentLayout?.blocks) {
        throw new Error('Document AI returned an empty or invalid document object.');
      }

      const docAITime = Date.now() - docAIStartTime;
      console.log(`✅ Document AI processing completed in ${docAITime}ms`);

      // Convert Document AI response to the format that index.ts would create
      const documentResult = processDocumentByPages(document.documentLayout, docAITime);

      // Format with page delimiters
      const formattedText = formatTextWithPageDelimiters(documentResult);

      console.log(
        `📄 Extracted ${documentResult.totalPages} pages with ${formattedText.length} characters`,
      );

      return { rawText: formattedText, imageBuffersMap };
    } finally {
      // Cleanup temp directory
      await fs.promises
        .rm(tempDir, { recursive: true, force: true })
        .catch((e) => console.warn(`Failed cleanup: ${tempDir}`, e));
    }
  }

  /**
   * Main processing function - enhanced pipeline with images
   */
  async run(pdfPath: string): Promise<void> {
    try {
      console.log(`📄 Starting enhanced pipeline for: ${pdfPath}`);

      // Step 1: Process PDF with both Document AI and image conversion
      const { rawText, imageBuffersMap } = await this.processWithDocumentAIAndImages(pdfPath);

      // Step 2: Process with LLM using both OCR text and images
      const rebuiltText = await this.processOCRTextWithImages(rawText, imageBuffersMap);

      // Step 3: Save both original OCR and rebuilt text
      const baseName = path.basename(pdfPath, path.extname(pdfPath));

      // Save original OCR text that was sent to LLM
      const ocrPath = path.join(currentDir, `${baseName}-original-ocr.txt`);
      fs.writeFileSync(ocrPath, rawText);

      // Save rebuilt text as markdown
      const markdownPath = path.join(currentDir, `${baseName}-rebuilt.md`);
      fs.writeFileSync(markdownPath, rebuiltText);

      console.log('\n💾 Output files saved:');
      console.log(`   Original OCR: ${ocrPath}`);
      console.log(`   Rebuilt markdown: ${markdownPath}`);

      // Analysis
      console.log('\n🔍 ENHANCED PIPELINE ANALYSIS:');
      console.log(`📄 Raw OCR: ${rawText.length} characters`);
      console.log(`🖼️ Images processed: ${imageBuffersMap.size} pages`);
      console.log(`📄 LLM Processed: ${rebuiltText.length} characters`);

      const pageBreakCount = (rebuiltText.match(/--- PAGE_BREAK ---/g) || []).length;
      console.log(`📖 Page breaks preserved: ${pageBreakCount}`);

      console.log('\n🎉 Enhanced OCR rebuilding pipeline finished!');
      console.log('📊 Summary:');
      console.log('   - Converted PDF to high-quality images with adaptive DPI');
      console.log('   - Processed PDF with Google Document AI for OCR text');
      console.log('   - Sent both images AND OCR text to Gemini 2.5-pro');
      console.log('   - Applied monkey-ai monolithic preprocessing prompt');
      console.log('   - Used visual context from images to improve text reconstruction');
      console.log('   - Preserved page structure with PAGE_BREAK delimiters');
      console.log('   - Fixed OCR spatial issues using visual + textual information');
      console.log('   - Maintained content fidelity while improving readability');
      console.log('   - Saved original OCR text and clean markdown output');
    } catch (error) {
      console.error('💥 Error in enhanced OCR rebuilding pipeline:', error);
      process.exit(1);
    }
  }
}

async function main() {
  try {
    // Get PDF path from command line argument
    const pdfPath = process.argv[2];

    if (!pdfPath) {
      console.error('❌ Please provide a PDF file path as an argument');
      console.log('Usage: npx ts-node ocr-rebuilding.ts <path-to-pdf>');
      process.exit(1);
    }

    // Resolve path (relative or absolute)
    const resolvedPath = path.isAbsolute(pdfPath) ? pdfPath : path.resolve(currentDir, pdfPath);

    const rebuilder = new OCRRebuilder();
    await rebuilder.run(resolvedPath);
  } catch (error) {
    console.error('💥 Error in main:', error);
    process.exit(1);
  }
}

main();

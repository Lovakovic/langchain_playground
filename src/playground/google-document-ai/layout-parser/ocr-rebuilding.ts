import { config } from 'dotenv';
import { ChatVertexAI } from '@langchain/google-vertexai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
// @ts-ignore
import { DocumentAIProcessor, formatTextWithPageDelimiters, processDocumentByPages, type DocumentTextResult } from './improved.ts';

// @ts-ignore
const __filename = fileURLToPath(import.meta.url);
const currentDir = path.dirname(__filename);

// Load environment variables
config();

/**
 * Creates the same monolithic preprocessing prompt used in monkey-ai
 * This is the exact same logic from extraction.prompts.ts
 */
function createMonolithicPreprocessingPrompt(totalPageCount: number): string {
  return `You are an elite document layout analyst and OCR correction specialist. Your task is to process the entire raw OCR text from a multi-page menu document. You will receive the text concatenated together, with markers like "--- CONTENT FROM PAGE X BEGINS ---" indicating page breaks.

Your goal is to restructure this raw text into a single, clean, logically-ordered Markdown document. You MUST correct spatial ambiguities and associate item names with their descriptions, prices, and allergen codes, but you must strictly adhere to the original document's structure and content.

**PRIMARY DIRECTIVE: Reconstruct, Do Not Re-imagine.**

**CRITICAL OUTPUT FORMATTING RULES:**
1.  **MANDATORY PAGE DELIMITERS:** You MUST preserve the page structure in your output. After processing the content for a page, you MUST insert a clear, machine-readable delimiter on its own line. Use the EXACT format: \`--- PAGE_BREAK ---\`. You will insert this delimiter ${totalPageCount - 1} times.
2.  **USE MARKDOWN FOR STRUCTURE:**
    -   **Headers:** Use headers (\`#\`, \`##\`) for section and sub-section titles.
    -   **Section Notes:** Use blockquotes (\`>\`) for general text that applies to a whole section, placing it directly under the section header.
    -   **Items:** Use bullet points (\`-\`) for each distinct menu item.
3.  **STRUCTURE & CONTENT FIDELITY RULES:**
    -   **NO GLOBAL REORDERING:** You MUST maintain the high-level sequence of the menu. The order of major sections (e.g., "Appetizers" then "Main Courses" then "Desserts") MUST NOT be changed. The relative order of items within a section MUST be preserved.
    -   **ALLOW LOCAL REORDERING FOR COHERENCE:** You ARE PERMITTED to reorder text elements *within a single item's block* to create a logical, readable line. For example, if the OCR extracts a price before the item name due to column layout, you MUST reorder them correctly.
        -   **Example OCR Input:** "12.50 ..... Pizza Salami ..... A, G"
        -   **Correct Reordered Output:** "- Pizza Salami (A, G) - 12.50"
    -   **PRESERVE PREFIXES:** You MUST keep any original item prefixes, such as numbers or codes (e.g., "25. Rumpsteak", "P1. Pizza Salami").
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

- 25. Rumpsteak (Argentinisches Rind) - 25,50

--- PAGE_BREAK ---

- 26. Rib-Eye (G, A1) - 32,00

# HAUPTGERICHTE

--- END OF EXAMPLE ---

Now, process the entire document provided and return a single, structured Markdown text block that follows all of these rules precisely.`;
}

/**
 * OCR Rebuilding Script
 * Replicates the monolithic preprocessing behavior from monkey-ai
 * Now with integrated Document AI processing!
 */
class OCRRebuilder {
  private model: ChatVertexAI;
  private documentProcessor: DocumentAIProcessor;

  constructor() {
    // Initialize the same model used in monkey-ai
    this.model = new ChatVertexAI({
      model: 'gemini-2.5-pro',
      temperature: 0.0,
    });

    // Initialize Document AI processor from improved.ts
    this.documentProcessor = new DocumentAIProcessor();

    console.log('🤖 OCR Rebuilding Script - Complete Pipeline');
    console.log('=' .repeat(60));
    console.log('📋 Pipeline: PDF → Document AI → LLM Cleanup → Clean Text');
  }

  /**
   * Process raw OCR text and rebuild it using LLM
   */
  async processOCRText(rawText: string): Promise<string> {
    console.log('🧠 Processing raw OCR text with LLM...');
    
    // Count the number of pages from the input text
    const pageMatches = rawText.match(/--- Page \d+ starts ---/g);
    const totalPageCount = pageMatches ? pageMatches.length : 1;
    
    console.log(`📊 Detected ${totalPageCount} pages in the document`);

    // Convert the format from improved.ts to monkey-ai format
    const convertedText = this.convertToMonkeyAIFormat(rawText);
    
    // Create the same prompt used in monkey-ai
    const prompt = createMonolithicPreprocessingPrompt(totalPageCount);
    const messages = [
      new SystemMessage(prompt),
      new HumanMessage({ content: convertedText })
    ];

    console.log('🚀 Calling Gemini 2.5-pro to rebuild OCR text...');
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
      '--- CONTENT FROM PAGE $1 BEGINS ---'
    );
    
    // Convert from "--- Page X ends ---" to "--- CONTENT FROM PAGE X ENDS ---"
    converted = converted.replace(
      /--- Page (\d+) ends ---/g, 
      '--- CONTENT FROM PAGE $1 ENDS ---'
    );
    
    return converted;
  }

  /**
   * Process PDF with Document AI to get raw OCR text
   */
  async processWithDocumentAI(pdfPath: string): Promise<string> {
    console.log(`📖 Processing PDF with Document AI: ${pdfPath}`);
    
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`PDF file not found: ${pdfPath}`);
    }

    // Use the DocumentAIProcessor from improved.ts
    // We need to extract the processing logic from it
    const startTime = Date.now();
    const buffer = fs.readFileSync(pdfPath);
    
    console.log(`🚀 Calling Google Document AI...`);
    
    // We'll use the internal logic similar to improved.ts but return just the text
    const processorId = process.env.DOCUMENT_AI_PROCESSOR_ID!;
    const location = process.env.DOCUMENT_AI_LOCATION!;
    const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID!;

    if (!processorId || !location || !projectId) {
      throw new Error(
        'Missing required Document AI environment variables: DOCUMENT_AI_PROCESSOR_ID, DOCUMENT_AI_LOCATION, GOOGLE_CLOUD_PROJECT_ID'
      );
    }

    // Unfortunately, we need to recreate the Document AI logic here since the improved.ts method is private
    // Let's create a temporary file and call the processor method
    
    // Actually, let's take a different approach - call the processor's processPdf method
    // and read the output file it creates
    
    console.log('🔄 Running Document AI processing...');
    
    // We need to temporarily modify the current working directory or create our own processor
    // For now, let's create a simple Document AI call
    
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

    const processingTime = Date.now() - startTime;
    console.log(`✅ Document AI processing completed in ${processingTime}ms`);

    // Convert Document AI response to the format that improved.ts would create
    const documentResult = processDocumentByPages(document.documentLayout, processingTime);
    
    // Format with page delimiters
    const formattedText = formatTextWithPageDelimiters(documentResult);
    
    console.log(`📄 Extracted ${documentResult.totalPages} pages with ${formattedText.length} characters`);
    
    return formattedText;
  }

  /**
   * Main processing function - complete pipeline
   */
  async run(pdfPath: string): Promise<void> {
    try {
      console.log(`📄 Starting complete pipeline for: ${pdfPath}`);

      // Step 1: Process PDF with Document AI to get raw OCR text
      const rawText = await this.processWithDocumentAI(pdfPath);

      // Step 2: Process the raw text using the same logic as monkey-ai
      const rebuiltText = await this.processOCRText(rawText);

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
      console.log('\n🔍 PIPELINE ANALYSIS:');
      console.log(`📄 Raw OCR: ${rawText.length} characters`);
      console.log(`📄 LLM Processed: ${rebuiltText.length} characters`);
      
      const pageBreakCount = (rebuiltText.match(/--- PAGE_BREAK ---/g) || []).length;
      console.log(`📖 Page breaks preserved: ${pageBreakCount}`);
      
      console.log('\n🎉 Complete OCR rebuilding pipeline finished!');
      console.log('📊 Summary:');
      console.log('   - Processed PDF with Google Document AI');
      console.log('   - Applied monkey-ai monolithic preprocessing prompt');
      console.log('   - Called Gemini 2.5-pro for intelligent text reconstruction');
      console.log('   - Preserved page structure with PAGE_BREAK delimiters');
      console.log('   - Fixed OCR spatial issues and associated items with prices');
      console.log('   - Maintained content fidelity while improving readability');
      console.log('   - Saved original OCR text and clean markdown output');

    } catch (error) {
      console.error('💥 Error in OCR rebuilding pipeline:', error);
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
    const resolvedPath = path.isAbsolute(pdfPath) 
      ? pdfPath 
      : path.resolve(currentDir, pdfPath);

    const rebuilder = new OCRRebuilder();
    await rebuilder.run(resolvedPath);
  } catch (error) {
    console.error('💥 Error in main:', error);
    process.exit(1);
  }
}

main();

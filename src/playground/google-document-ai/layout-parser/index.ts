import { config } from 'dotenv';
import {
  DocumentProcessorServiceClient,
  protos,
} from '@google-cloud/documentai';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// --- REMOVED ALL CUSTOM INTERFACES ---

// We now use the official types directly from the library's protos.
// Creating type aliases makes the code more readable.
type IProcessRequest = protos.google.cloud.documentai.v1.IProcessRequest;
type IDocument = protos.google.cloud.documentai.v1.IDocument;
type IDocumentLayout = protos.google.cloud.documentai.v1.Document.IDocumentLayout;
type IDocumentLayoutBlock = protos.google.cloud.documentai.v1.Document.DocumentLayout.IDocumentLayoutBlock;
type ILayoutTextBlock = protos.google.cloud.documentai.v1.Document.DocumentLayout.DocumentLayoutBlock.ILayoutTextBlock;
type ILayoutTableBlock = protos.google.cloud.documentai.v1.Document.DocumentLayout.DocumentLayoutBlock.ILayoutTableBlock;

/**
 * A robust helper function to extract text from any layout element.
 * It uses the text_anchor and text_segments from the response to reconstruct the
 * text content of a given layout. This is the recommended approach.
 * @param layout The layout object from a Document AI response element.
 * @param fullText The full text of the document from the response.
 * @returns The text content of the layout element.
 */
function getTextFromLayout(layout: protos.google.cloud.documentai.v1.Document.Page.ILayout | null | undefined, fullText: string): string {
  if (!layout?.textAnchor?.textSegments) {
    return '';
  }
  return layout.textAnchor.textSegments.map(segment => {
    const startIndex = Number(segment.startIndex) || 0;
    const endIndex = Number(segment.endIndex);
    return fullText.substring(startIndex, endIndex);
  }).join('');
}

// Simplified type guard functions using the official types
function isTextBlock(block: IDocumentLayoutBlock): block is IDocumentLayoutBlock & { textBlock: ILayoutTextBlock } {
  return !!block.textBlock;
}

function isTableBlock(block: IDocumentLayoutBlock): block is IDocumentLayoutBlock & { tableBlock: ILayoutTableBlock } {
  return !!block.tableBlock;
}


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
config();

type DocumentAIClient = DocumentProcessorServiceClient;

class DocumentAIProcessor {
  private readonly client: DocumentAIClient;
  private readonly processorId: string;
  private readonly location: string;
  private readonly projectId: string;

  constructor() {
    this.client = new DocumentProcessorServiceClient({
      apiEndpoint: 'eu-documentai.googleapis.com',
    });
    this.processorId = process.env.DOCUMENT_AI_PROCESSOR_ID!;
    this.location = process.env.DOCUMENT_AI_LOCATION!;
    this.projectId = process.env.GOOGLE_CLOUD_PROJECT_ID!;

    if (!this.processorId || !this.location || !this.projectId) {
      throw new Error(
        'Missing required Document AI environment variables: DOCUMENT_AI_PROCESSOR_ID, DOCUMENT_AI_LOCATION, GOOGLE_CLOUD_PROJECT_ID'
      );
    }

    console.log(`🔧 Document AI Configuration:`);
    console.log(`   Project ID: ${this.projectId}`);
    console.log(`   Location: ${this.location}`);
    console.log(`   Processor ID: ${this.processorId}`);
  }

  async processPdf(filePath: string): Promise<void> {
    console.log(`\n📖 Processing PDF: ${filePath}`);

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
    };

    try {
      console.log(`🚀 Sending document to Google Document AI...`);
      const [result] = await this.client.processDocument(request);

      console.log('\n🔍 Response structure captured');

      const responseFilePath = path.join(__dirname, 'document-ai-response.json');
      fs.writeFileSync(responseFilePath, JSON.stringify(result, null, 2));
      console.log(`💾 Full response saved to: ${responseFilePath}`);

      // The `document` object is now correctly and strongly typed as IDocument
      const { document } = result;

      if (!document || !document.documentLayout || !document.documentLayout.blocks) {
        throw new Error('Document AI returned an empty or invalid document object.');
      }

      const processingTime = Date.now() - startTime;
      console.log(`✅ Processing completed in ${processingTime}ms`);
      console.log(`📄 Document has ${document.pages?.length} pages and ${document.documentLayout.blocks.length} layout blocks`);

      // Using the document's full text for context in our helper function
      const fullText = document.text || '';
      const allText = document.documentLayout.blocks
        .map(block => getTextFromLayout(block, fullText)) // We no longer need a complex recursive function
        .filter(text => text.trim().length > 0)
        .join('\n\n');

      console.log(`\n📝 EXTRACTED TEXT (${allText.length} characters):`);
      console.log('=' .repeat(50));
      console.log(allText);
      console.log('=' .repeat(50));

      // Analyze block structure
      console.log(`\n🔍 BLOCK ANALYSIS:`);
      document.documentLayout.blocks.forEach((block, index) => {
        // Use optional chaining `?.` as properties can be null
        console.log(`\n--- Block ${index + 1} (ID: ${block.blockId}) ---`);
        console.log(`📍 Page span: ${block.pageSpan?.pageStart}-${block.pageSpan?.pageEnd}`);

        if (isTextBlock(block)) {
          console.log(`🏷️  Type: Text Block`);
          console.log(`📄 Subtype: ${block.textBlock.type}`);
          console.log(`🧱 Nested blocks: ${block.textBlock.blocks?.length || 0}`);
          console.log(`📝 Text: "${getTextFromLayout(block, fullText).substring(0, 100).replace(/\n/g, ' ')}..."`);
        }

        if (isTableBlock(block)) {
          console.log(`🏷️  Type: Table Block`);
          console.log(`📊 Table with ${block.tableBlock.bodyRows?.length || 0} body rows`);
          console.log(`🗂️  Header rows: ${block.tableBlock.headerRows?.length || 0}`);
        }
      });

      console.log(`\n🎉 Successfully processed ${path.basename(filePath)}`);
      console.log(`📊 Summary:`);
      console.log(`   - Processing time: ${processingTime}ms`);
      console.log(`   - Layout blocks: ${document.documentLayout.blocks.length}`);
      console.log(`   - Total extracted text: ${allText.length} characters`);

    } catch (error: any) {
      console.error('💥 Top-level error occurred:');
      if (error.details) {
        console.error('🔍 gRPC Error Details:', error.details);
      } else {
        console.error(error);
      }
      process.exit(1);
    }
  }
}

async function main() {
  try {
    console.log('🤖 Google Document AI Layout Parser Example');
    console.log('=' .repeat(50));

    const processor = new DocumentAIProcessor();
    const pdfPath = path.join(__dirname, '..', 'flame-1-4.pdf');

    await processor.processPdf(pdfPath);

  } catch (error) {
    console.error('💥 Error in main:', error);
    process.exit(1);
  }
}

main();

import { config } from 'dotenv';
import {
  DocumentProcessorServiceClient,
  protos,
} from '@google-cloud/documentai';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// We now use the official types directly from the library's protos.
// Creating type aliases makes the code more readable.
type IProcessRequest = protos.google.cloud.documentai.v1.IProcessRequest;
type IDocumentLayout = protos.google.cloud.documentai.v1.Document.IDocumentLayout;
type IDocumentLayoutBlock = protos.google.cloud.documentai.v1.Document.DocumentLayout.IDocumentLayoutBlock;
type ILayoutTextBlock = protos.google.cloud.documentai.v1.Document.DocumentLayout.DocumentLayoutBlock.ILayoutTextBlock;
type ILayoutTableBlock = protos.google.cloud.documentai.v1.Document.DocumentLayout.DocumentLayoutBlock.ILayoutTableBlock;

/**
 * Extract text from a document layout block using the EXACT same logic as index.ts.
 * This provides superior text formatting with proper newlines.
 * @param block The layout block from Document AI response.
 * @returns The text content of the block.
 */
function getTextFromLayoutBlock(block: IDocumentLayoutBlock): string {
  if (block.textBlock) {
    let text = block.textBlock.text || '';
    if (block.textBlock.blocks?.length) {
      const childTexts = block.textBlock.blocks
        .map((b) => getTextFromLayoutBlock(b))
        .filter(t => t.trim().length > 0);
      if (childTexts.length > 0) {
        text = text ? `${text}\n${childTexts.join('\n')}` : childTexts.join('\n');
      }
    }
    return text;
  }

  if (block.tableBlock?.bodyRows?.length) {
    return block.tableBlock.bodyRows
      .map(
        (row) => (row.cells || [])
          .map((cell) => (cell.blocks || [])
            .map((b) => getTextFromLayoutBlock(b))
            .filter(t => t.trim().length > 0)
            .join(' '),
          )
          .join(' | '),
      )
      .join('\n');
  }

  if (block.listBlock?.listEntries?.length) {
    return block.listBlock.listEntries
      .map((entry) => (entry.blocks || [])
        .map((b) => getTextFromLayoutBlock(b))
        .filter(t => t.trim().length > 0)
        .join(' '),
      )
      .filter(t => t.trim().length > 0)
      .join('\n');
  }

  return '';
}

// Simplified type guard functions using the official types
function isTextBlock(block: IDocumentLayoutBlock): block is IDocumentLayoutBlock & { textBlock: ILayoutTextBlock } {
  return !!block.textBlock;
}

function isTableBlock(block: IDocumentLayoutBlock): block is IDocumentLayoutBlock & { tableBlock: ILayoutTableBlock } {
  return !!block.tableBlock;
}


// Enhanced content types for superior formatting
interface ContentBlock {
  id: string;
  type: 'heading' | 'paragraph' | 'list-item' | 'table' | 'section';
  level?: number; // For headings and sections
  content: string;
  metadata?: {
    pageSpan?: { pageStart: number; pageEnd: number };
    position?: { x?: number; y?: number };
    style?: string;
  };
  children?: ContentBlock[];
}

interface ProcessedPage {
  pageNumber: number;
  text: string;
  sections: ContentBlock[];
}

interface DocumentTextResult {
  pages: ProcessedPage[];
  totalPages: number;
  processingTime?: number;
}

/**
 * Analyzes text content to determine its likely type based on universal patterns
 */
function inferContentType(text: string, blockType: string, context: { prevBlock?: string; nextBlock?: string }): {
  type: ContentBlock['type'];
  level?: number;
} {
  const trimmedText = text.trim();
  
  // Empty or very short text
  if (!trimmedText || trimmedText.length < 2) {
    return { type: 'paragraph' };
  }

  // Table content
  if (blockType === 'tableBlock') {
    return { type: 'table' };
  }

  // List indicators
  if (/^[•·▪▫‣⁃]\s/.test(trimmedText) || /^\d+\.\s/.test(trimmedText) || /^[a-zA-Z]\d+\s/.test(trimmedText)) {
    return { type: 'list-item' };
  }

  // Heading patterns - universal indicators
  const headingPatterns = [
    /^[A-Z\s]{3,}$/, // ALL CAPS headings
    /^[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]+$/, // Japanese/Chinese characters only
    /^[^\w]*[A-Z][A-Z\s]+[^\w]*$/, // Mostly capitals with decorators
  ];

  const isShort = trimmedText.length < 50;
  const isAllCaps = trimmedText === trimmedText.toUpperCase() && /[A-Z]/.test(trimmedText);
  const matchesHeadingPattern = headingPatterns.some(pattern => pattern.test(trimmedText));

  if ((isShort && isAllCaps) || matchesHeadingPattern) {
    // Determine heading level based on length and context
    if (trimmedText.length < 20) {
      return { type: 'heading', level: 1 };
    } else if (trimmedText.length < 35) {
      return { type: 'heading', level: 2 };
    } else {
      return { type: 'heading', level: 3 };
    }
  }

  // Default to paragraph
  return { type: 'paragraph' };
}

/**
 * Groups related blocks based on spatial proximity and content analysis
 */
function groupRelatedBlocks(blocks: IDocumentLayoutBlock[]): ContentBlock[][] {
  const groups: ContentBlock[][] = [];
  let currentGroup: ContentBlock[] = [];
  
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const text = getTextFromLayoutBlock(block);
    
    if (!text.trim()) continue;

    const prevText = i > 0 ? getTextFromLayoutBlock(blocks[i - 1]) : undefined;
    const nextText = i < blocks.length - 1 ? getTextFromLayoutBlock(blocks[i + 1]) : undefined;
    
    const { type, level } = inferContentType(
      text, 
      isTableBlock(block) ? 'tableBlock' : 'textBlock',
      { prevBlock: prevText, nextBlock: nextText }
    );

    const contentBlock: ContentBlock = {
      id: block.blockId || `block-${i}`,
      type,
      level,
      content: text,
      metadata: {
        pageSpan: block.pageSpan ? {
          pageStart: block.pageSpan.pageStart ?? 0,
          pageEnd: block.pageSpan.pageEnd ?? 0
        } : undefined,
        style: isTextBlock(block) ? (block.textBlock?.type ?? undefined) : undefined,
      },
      children: []
    };

    // Start new group on headings or significant content breaks
    if (type === 'heading' || (type === 'table' && currentGroup.length > 0)) {
      if (currentGroup.length > 0) {
        groups.push([...currentGroup]);
        currentGroup = [];
      }
    }

    currentGroup.push(contentBlock);
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

/**
 * Builds hierarchical sections from grouped blocks
 */
function buildHierarchicalStructure(blockGroups: ContentBlock[][]): ContentBlock[] {
  const sections: ContentBlock[] = [];
  
  for (const group of blockGroups) {
    if (group.length === 0) continue;

    const firstBlock = group[0];
    
    if (firstBlock.type === 'heading') {
      // Create section with heading
      const section: ContentBlock = {
        id: `section-${firstBlock.id}`,
        type: 'section',
        level: firstBlock.level,
        content: firstBlock.content,
        metadata: firstBlock.metadata,
        children: group.slice(1) // All blocks after the heading
      };
      sections.push(section);
    } else {
      // Group without clear heading - add blocks directly
      sections.push(...group);
    }
  }

  return sections;
}

/**
 * Format content blocks with proper spacing and structure (original formatting)
 */
function formatContentBlocks(sections: ContentBlock[]): string {
  const formatBlock = (block: ContentBlock): string => {
    switch (block.type) {
      case 'heading':
        // Headings in ALL CAPS with extra spacing
        return `${block.content.toUpperCase()}\n${'='.repeat(Math.min(block.content.length, 50))}\n\n`;
        
      case 'section':
        // Section with heading and children
        let text = `${block.content.toUpperCase()}\n${'='.repeat(Math.min(block.content.length, 50))}\n\n`;
        if (block.children) {
          text += block.children.map(formatBlock).join('');
        }
        return text;
        
      case 'list-item':
        // List items with proper bullets
        return `• ${block.content}\n`;
        
      case 'table':
        // Tables with separators
        return `${block.content}\n${'─'.repeat(40)}\n\n`;
        
      case 'paragraph':
      default:
        // Regular paragraphs with spacing
        return `${block.content}\n\n`;
    }
  };

  return sections.map(formatBlock).join('');
}

/**
 * Format content blocks exactly like index.ts does - superior text layout
 */
function formatContentBlocksLikeIndex(sections: ContentBlock[]): string {
  const formatBlock = (block: ContentBlock): string => {
    switch (block.type) {
      case 'heading':
        return `${block.content}\n`;
        
      case 'section':
        let text = `${block.content}\n`;
        if (block.children) {
          text += block.children.map(formatBlock).join('');
        }
        return text;
        
      case 'list-item':
        return `${block.content}\n`;
        
      case 'table':
        return `${block.content}\n`;
        
      case 'paragraph':
      default:
        return `${block.content}\n`;
    }
  };

  return sections.map(formatBlock).join('\n');
}

/**
 * Return only top-level blocks without nested children to prevent duplication.
 * The getTextFromLayoutBlock function already handles recursive text extraction.
 */
function flattenAllBlocks(blocks: IDocumentLayoutBlock[]): IDocumentLayoutBlock[] {
  return blocks;
}

/**
 * Calculate total pages by recursively traversing all blocks
 */
function getAllPageEnds(blocks: IDocumentLayoutBlock[]): number[] {
  const pageEnds: number[] = [];

  const traverse = (block: IDocumentLayoutBlock): void => {
    if (block.pageSpan?.pageEnd) {
      pageEnds.push(block.pageSpan.pageEnd);
    }

    // Recursively check nested blocks
    if (block.textBlock?.blocks) {
      block.textBlock.blocks.forEach(traverse);
    }
    if (block.tableBlock?.bodyRows) {
      block.tableBlock.bodyRows.forEach(row => {
        row.cells?.forEach(cell => {
          cell.blocks?.forEach(traverse);
        });
      });
    }
    if (block.listBlock?.listEntries) {
      block.listBlock.listEntries.forEach(entry => {
        entry.blocks?.forEach(traverse);
      });
    }
  };

  blocks.forEach(traverse);
  return pageEnds;
}

/**
 * Process document page by page using corrected logic with superior formatting
 */
function processDocumentByPages(layout: IDocumentLayout, processingTime?: number): DocumentTextResult {
  if (!layout.blocks) {
    return {
      pages: [],
      totalPages: 0,
      processingTime
    };
  }

  // Flatten all blocks first to work with individual blocks, not hierarchy
  const allBlocks = flattenAllBlocks(layout.blocks);

  // Calculate total pages 
  const allPageEnds = getAllPageEnds(layout.blocks);
  const totalPages = allPageEnds.length > 0 ? Math.max(...allPageEnds) : 1;

  const pages: ProcessedPage[] = [];
  
  // Process each page by filtering individual blocks, not hierarchical ones
  for (let i = 1; i <= totalPages; i++) {
    const pageNum = i;
    
    // Get individual blocks that belong EXACTLY to this page
    const individualPageBlocks = allBlocks.filter((block) => {
      if (!block.pageSpan) {
        return false;
      }
      // Only include blocks that are specifically on this page
      return (block.pageSpan.pageStart ?? 0) === pageNum && (block.pageSpan.pageEnd ?? 0) === pageNum;
    });

    // Apply the superior formatting logic from index.ts to these page-specific blocks
    const blockGroups = groupRelatedBlocks(individualPageBlocks);
    const sections = buildHierarchicalStructure(blockGroups);
    
    // Format using the same logic as index.ts but for this page only
    const pageText = formatContentBlocksLikeIndex(sections);

    pages.push({
      pageNumber: pageNum,
      text: pageText.trim(),
      sections
    });
  }

  return {
    pages,
    totalPages,
    processingTime
  };
}

/**
 * Format document text with page delimiters as requested
 */
function formatTextWithPageDelimiters(result: DocumentTextResult): string {
  let output = '';
  
  for (const page of result.pages) {
    output += `--- Page ${page.pageNumber} starts ---\n`;
    output += page.text;
    output += `\n--- Page ${page.pageNumber} ends ---\n\n`;
  }
  
  return output;
}

/**
 * Enhanced document formatter with multiple output options
 */
class DocumentFormatter {
  static toJSON(result: DocumentTextResult): string {
    return JSON.stringify(result, null, 2);
  }

  static toMarkdown(result: DocumentTextResult): string {
    let markdown = `# Document Analysis\n\n`;
    markdown += `**Total Pages:** ${result.totalPages}  \n`;
    markdown += `**Processing Time:** ${result.processingTime}ms\n\n`;

    for (const page of result.pages) {
      markdown += `## Page ${page.pageNumber}\n\n`;
      
      for (const section of page.sections) {
        switch (section.type) {
          case 'heading':
          case 'section':
            const level = Math.min(section.level || 1, 4) + 2; // h3-h6
            markdown += `${'#'.repeat(level)} ${section.content}\n\n`;
            if (section.children) {
              section.children.forEach(child => {
                if (child.type === 'list-item') {
                  markdown += `- ${child.content}\n`;
                } else {
                  markdown += `${child.content}\n\n`;
                }
              });
            }
            break;
          case 'list-item':
            markdown += `- ${section.content}\n`;
            break;
          case 'table':
            markdown += `| ${section.content.replace(/\|/g, ' \\| ')} |\n|---|\n\n`;
            break;
          default:
            markdown += `${section.content}\n\n`;
        }
      }
    }

    return markdown;
  }

  static toPlainText(result: DocumentTextResult): string {
    let text = `DOCUMENT ANALYSIS\n${'='.repeat(50)}\n\n`;
    text += `Total Pages: ${result.totalPages}\n`;
    text += `Processing Time: ${result.processingTime}ms\n\n`;

    for (const page of result.pages) {
      text += `PAGE ${page.pageNumber}\n${'-'.repeat(20)}\n\n`;
      text += page.text;
      text += `\n\n`;
    }

    return text;
  }
}


// @ts-ignore
const __filename = fileURLToPath(import.meta.url);
const currentDir = path.dirname(__filename);

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

      const responseFilePath = path.join(currentDir, 'document-ai-response.json');
      fs.writeFileSync(responseFilePath, JSON.stringify(result, null, 2));
      console.log(`💾 Full response saved to: ${responseFilePath}`);

      // The `document` object is now correctly and strongly typed as IDocument
      const { document } = result;

      if (!document?.documentLayout?.blocks) {
        throw new Error('Document AI returned an empty or invalid document object.');
      }

      const processingTime = Date.now() - startTime;
      console.log(`✅ Processing completed in ${processingTime}ms`);
      console.log(`📄 Document has ${document.pages?.length} pages and ${document.documentLayout.blocks.length} layout blocks`);

      // Process document page by page using enhanced logic with superior formatting
      const documentResult = processDocumentByPages(document.documentLayout, processingTime);
      
      // Generate multiple output formats
      const outputFormats = {
        textWithDelimiters: formatTextWithPageDelimiters(documentResult),
        json: DocumentFormatter.toJSON(documentResult),
        markdown: DocumentFormatter.toMarkdown(documentResult),
        text: DocumentFormatter.toPlainText(documentResult)
      };

      // Save all formats
      const baseFilename = path.join(currentDir, 'document');
      fs.writeFileSync(`${baseFilename}-text.txt`, outputFormats.textWithDelimiters);
      fs.writeFileSync(`${baseFilename}-analysis.json`, outputFormats.json);
      fs.writeFileSync(`${baseFilename}-analysis.md`, outputFormats.markdown);
      fs.writeFileSync(`${baseFilename}-formatted.txt`, outputFormats.text);

      console.log(`📊 Enhanced outputs saved:`);
      console.log(`   Text with delimiters: ${baseFilename}-text.txt`);
      console.log(`   JSON analysis: ${baseFilename}-analysis.json`);
      console.log(`   Markdown: ${baseFilename}-analysis.md`);
      console.log(`   Formatted text: ${baseFilename}-formatted.txt`);

      // Enhanced analysis output with content structure information
      console.log(`\n🔍 DOCUMENT PROCESSING ANALYSIS:`);
      console.log(`📄 Total pages: ${documentResult.totalPages}`);
      console.log(`🧱 Total blocks: ${document.documentLayout.blocks.length}`);

      console.log(`\n📖 PAGE BREAKDOWN:`);
      documentResult.pages.forEach(page => {
        console.log(`   Page ${page.pageNumber}: ${page.text.length} characters, ${page.sections.length} sections`);
      });

      // Content type analysis across all pages
      console.log(`\n📋 CONTENT TYPE ANALYSIS:`);
      const allContentTypes: Record<string, number> = {};
      documentResult.pages.forEach(page => {
        page.sections.forEach(section => {
          allContentTypes[section.type] = (allContentTypes[section.type] || 0) + 1;
          if (section.children) {
            section.children.forEach(child => {
              allContentTypes[child.type] = (allContentTypes[child.type] || 0) + 1;
            });
          }
        });
      });

      Object.entries(allContentTypes).forEach(([type, count]) => {
        console.log(`   ${type}: ${count} blocks`);
      });

      console.log(`\n🎉 Successfully processed ${path.basename(filePath)}`);
      console.log(`📊 Summary:`);
      console.log(`   - Processing time: ${processingTime}ms`);
      console.log(`   - ${documentResult.totalPages} pages processed with superior formatting`);
      console.log(`   - Content structure analyzed (headings, paragraphs, tables, lists)`);
      console.log(`   - Multiple output formats: Text with delimiters, JSON, Markdown, Formatted text`);
      console.log(`   - Correct page separation with enhanced text layout`);

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
    
    // Get PDF path from command line argument or use default
    const pdfFileName = process.argv[2] || 'menu.pdf';
    // If the path is absolute, use it directly, otherwise join with parent directory
    const pdfPath = path.isAbsolute(pdfFileName) 
      ? pdfFileName 
      : path.join(currentDir, '..', pdfFileName);

    await processor.processPdf(pdfPath);

  } catch (error) {
    console.error('💥 Error in main:', error);
    process.exit(1);
  }
}

main();


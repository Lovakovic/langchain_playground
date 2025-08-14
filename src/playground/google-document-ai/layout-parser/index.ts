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
 * Extract text from a document layout block.
 * This function handles the recursive extraction of text from nested blocks.
 * @param block The layout block from Document AI response.
 * @returns The text content of the block.
 */
function getTextFromBlock(block: IDocumentLayoutBlock): string {
  if (block.textBlock) {
    let text = block.textBlock.text || '';
    if (block.textBlock.blocks?.length) {
      const childTexts = block.textBlock.blocks
        .map((b) => getTextFromBlock(b))
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
            .map((b) => getTextFromBlock(b))
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
        .map((b) => getTextFromBlock(b))
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


// Universal content types for any document
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

interface DocumentStructure {
  title?: string;
  sections: ContentBlock[];
  metadata: {
    pages: number;
    totalBlocks: number;
    processingTime?: number;
  };
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
    const text = getTextFromBlock(block);
    
    if (!text.trim()) continue;

    const prevText = i > 0 ? getTextFromBlock(blocks[i - 1]) : undefined;
    const nextText = i < blocks.length - 1 ? getTextFromBlock(blocks[i + 1]) : undefined;
    
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
 * Universal document structure analyzer - works with any document type
 */
function analyzeDocumentStructure(layout: IDocumentLayout, processingTime?: number): DocumentStructure {
  if (!layout.blocks) {
    return {
      sections: [],
      metadata: { pages: 0, totalBlocks: 0, processingTime }
    };
  }

  console.log(`🔍 DEBUG: Total layout blocks received: ${layout.blocks.length}`);

  // Group related blocks
  const blockGroups = groupRelatedBlocks(layout.blocks);
  
  // Build hierarchical structure
  const sections = buildHierarchicalStructure(blockGroups);
  
  // Detect document title (first heading or prominent text)
  const title = sections.find(s => s.type === 'heading' || s.type === 'section')?.content;
  
  // Calculate metadata - recursively find all page spans
  const getAllPageEnds = (blocks: IDocumentLayoutBlock[]): number[] => {
    const pageEnds: number[] = [];
    
    const traverse = (block: IDocumentLayoutBlock) => {
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
  };
  
  const allPageEnds = getAllPageEnds(layout.blocks);
  const pages = allPageEnds.length > 0 ? Math.max(...allPageEnds) : 1;
  console.log(`🔍 DEBUG: All page ends found (first 10): ${JSON.stringify(allPageEnds.slice(0, 10))}`);
  console.log(`🔍 DEBUG: Total page spans found: ${allPageEnds.length}, Maximum page: ${pages}`);
  
  return {
    title: title?.substring(0, 100), // Limit title length
    sections,
    metadata: {
      pages,
      totalBlocks: layout.blocks.length,
      processingTime
    }
  };
}

/**
 * Flexible output formatters for different use cases
 */
class DocumentFormatter {
  static toJSON(structure: DocumentStructure): string {
    return JSON.stringify(structure, null, 2);
  }

  static toYAML(structure: DocumentStructure): string {
    // Simple YAML formatter - could use a library for more complex cases
    const formatBlock = (block: ContentBlock, indent = 0): string => {
      const prefix = '  '.repeat(indent);
      let yaml = `${prefix}- id: "${block.id}"\n`;
      yaml += `${prefix}  type: "${block.type}"\n`;
      if (block.level) yaml += `${prefix}  level: ${block.level}\n`;
      yaml += `${prefix}  content: "${block.content.replace(/"/g, '\\"')}"\n`;
      
      if (block.children && block.children.length > 0) {
        yaml += `${prefix}  children:\n`;
        yaml += block.children.map(child => formatBlock(child, indent + 2)).join('');
      }
      
      return yaml;
    };

    let yaml = `title: "${structure.title || 'Untitled Document'}"\n`;
    yaml += `metadata:\n  pages: ${structure.metadata.pages}\n  totalBlocks: ${structure.metadata.totalBlocks}\n`;
    if (structure.metadata.processingTime) {
      yaml += `  processingTime: ${structure.metadata.processingTime}\n`;
    }
    yaml += `sections:\n`;
    yaml += structure.sections.map(section => formatBlock(section, 1)).join('');
    
    return yaml;
  }

  static toMarkdown(structure: DocumentStructure): string {
    const formatBlock = (block: ContentBlock): string => {
      switch (block.type) {
        case 'heading':
          const headingLevel = Math.min(block.level || 1, 6);
          return `${'#'.repeat(headingLevel)} ${block.content}\n\n`;
          
        case 'section':
          const sectionLevel = Math.min(block.level || 2, 6);
          let md = `${'#'.repeat(sectionLevel)} ${block.content}\n\n`;
          if (block.children) {
            md += block.children.map(formatBlock).join('');
          }
          return md;
          
        case 'list-item':
          return `- ${block.content}\n`;
          
        case 'table':
          // Simple table representation
          return `| ${block.content} |\n|---|\n\n`;
          
        case 'paragraph':
        default:
          return `${block.content}\n\n`;
      }
    };

    let markdown = '';
    if (structure.title) {
      markdown += `# ${structure.title}\n\n`;
    }
    
    markdown += structure.sections.map(formatBlock).join('');
    
    return markdown;
  }

  static toPlainText(structure: DocumentStructure): string {
    const formatBlock = (block: ContentBlock): string => {
      let text = block.content;
      
      if (block.type === 'heading' || block.type === 'section') {
        text = text.toUpperCase();
      }
      
      if (block.children) {
        text += '\n' + block.children.map(formatBlock).join('\n');
      }
      
      return text;
    };

    let text = '';
    if (structure.title) {
      text += `${structure.title.toUpperCase()}\n${'='.repeat(structure.title.length)}\n\n`;
    }
    
    text += structure.sections.map(formatBlock).join('\n\n');
    
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

      // Analyze document structure universally
      const documentStructure = analyzeDocumentStructure(document.documentLayout, processingTime);
      
      // Generate multiple output formats
      const outputFormats = {
        json: DocumentFormatter.toJSON(documentStructure),
        yaml: DocumentFormatter.toYAML(documentStructure),
        markdown: DocumentFormatter.toMarkdown(documentStructure),
        text: DocumentFormatter.toPlainText(documentStructure)
      };

      // Save all formats
      const baseFilename = path.join(currentDir, 'document-structure');
      fs.writeFileSync(`${baseFilename}.json`, outputFormats.json);
      fs.writeFileSync(`${baseFilename}.yaml`, outputFormats.yaml);
      fs.writeFileSync(`${baseFilename}.md`, outputFormats.markdown);
      fs.writeFileSync(`${baseFilename}.txt`, outputFormats.text);

      console.log(`📊 Structured outputs saved:`);
      console.log(`   JSON: ${baseFilename}.json`);
      console.log(`   YAML: ${baseFilename}.yaml`);
      console.log(`   Markdown: ${baseFilename}.md`);
      console.log(`   Text: ${baseFilename}.txt`);

      // Enhanced analysis output
      console.log(`\n🔍 DOCUMENT STRUCTURE ANALYSIS:`);
      console.log(`📋 Title: ${documentStructure.title || 'No title detected'}`);
      console.log(`📑 Sections: ${documentStructure.sections.length}`);
      console.log(`📄 Pages: ${documentStructure.metadata.pages}`);
      console.log(`🧱 Total blocks: ${documentStructure.metadata.totalBlocks}`);

      console.log(`\n📖 CONTENT BREAKDOWN:`);
      const contentTypes = documentStructure.sections.reduce((acc, section) => {
        acc[section.type] = (acc[section.type] || 0) + 1;
        if (section.children) {
          section.children.forEach(child => {
            acc[child.type] = (acc[child.type] || 0) + 1;
          });
        }
        return acc;
      }, {} as Record<string, number>);

      Object.entries(contentTypes).forEach(([type, count]) => {
        console.log(`   ${type}: ${count} blocks`);
      });

      console.log(`\n🎉 Successfully processed ${path.basename(filePath)}`);
      console.log(`📊 Summary:`);
      console.log(`   - Processing time: ${processingTime}ms`);
      console.log(`   - Document structure created with ${documentStructure.sections.length} sections`);
      console.log(`   - Output formats: JSON, YAML, Markdown, Plain Text`);

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


import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';

interface TableRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  rows: number;
  cols: number;
}

/**
 * Enhance PDF by adding table borders for better Document AI recognition
 */
export class PDFTableEnhancer {
  /**
   * Analyze text content to detect potential table regions
   * This is a simplified heuristic - you might need to adjust based on your PDFs
   */
  private detectTableRegions(text: string): { itemNumbers: number[], prices: string[] } {
    // Detect menu item patterns
    const itemPattern = /^\s*(\d+)\s+/gm;
    const pricePattern = /(\d+[,\.]\d{2})\s*$/gm;
    
    const itemNumbers: number[] = [];
    const prices: string[] = [];
    
    let match;
    while ((match = itemPattern.exec(text)) !== null) {
      itemNumbers.push(parseInt(match[1]));
    }
    
    while ((match = pricePattern.exec(text)) !== null) {
      prices.push(match[1]);
    }
    
    return { itemNumbers, prices };
  }

  /**
   * Add visual borders to enhance table detection
   */
  async enhancePDF(inputPath: string, outputPath: string): Promise<void> {
    console.log('📊 Enhancing PDF with table borders...');
    
    // Load the existing PDF
    const existingPdfBytes = fs.readFileSync(inputPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    
    const pages = pdfDoc.getPages();
    
    // Process each page
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const page = pages[pageIndex];
      const { width, height } = page.getSize();
      
      console.log(`  Processing page ${pageIndex + 1}...`);
      
      // For menu pages (typically page 2 onwards), add table structure hints
      if (pageIndex >= 1) {
        // Draw subtle grid lines for the menu items section
        // These are approximate positions - adjust based on your PDF layout
        
        // Main content area (adjust these values based on actual PDF)
        const contentLeft = 50;
        const contentRight = width - 50;
        const contentTop = height - 100;
        const contentBottom = 100;
        
        // Column dividers (for 3-column layout: number, description, price)
        const col1Width = 40;  // Item number column
        const col2Width = contentRight - contentLeft - col1Width - 80;  // Description column
        const col3Width = 80;  // Price column
        
        const col1X = contentLeft;
        const col2X = col1X + col1Width;
        const col3X = col2X + col2Width;
        
        // Draw vertical column lines (very light gray)
        page.drawLine({
          start: { x: col2X, y: contentTop },
          end: { x: col2X, y: contentBottom },
          thickness: 0.5,
          color: rgb(0.9, 0.9, 0.9),
          opacity: 0.3
        });
        
        page.drawLine({
          start: { x: col3X, y: contentTop },
          end: { x: col3X, y: contentBottom },
          thickness: 0.5,
          color: rgb(0.9, 0.9, 0.9),
          opacity: 0.3
        });
        
        // Draw horizontal lines for rows (estimate ~20 items with spacing)
        const estimatedRows = 20;
        const rowHeight = (contentTop - contentBottom) / estimatedRows;
        
        for (let row = 0; row <= estimatedRows; row++) {
          const y = contentTop - (row * rowHeight);
          
          // Only draw every few lines to avoid cluttering
          if (row % 5 === 0 || row === 0 || row === estimatedRows) {
            page.drawLine({
              start: { x: contentLeft, y },
              end: { x: contentRight, y },
              thickness: 0.5,
              color: rgb(0.9, 0.9, 0.9),
              opacity: 0.2
            });
          }
        }
        
        // Add invisible but OCR-readable markers for table structure
        // These help Document AI understand the layout
        const fontSize = 1; // Very small, nearly invisible
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        
        // Add table markers at corners (nearly invisible)
        page.drawText('[TABLE_START]', {
          x: contentLeft - 20,
          y: contentTop + 10,
          size: fontSize,
          font: font,
          color: rgb(1, 1, 1), // White (invisible on white background)
          opacity: 0.01
        });
        
        page.drawText('[TABLE_END]', {
          x: contentRight - 20,
          y: contentBottom - 10,
          size: fontSize,
          font: font,
          color: rgb(1, 1, 1),
          opacity: 0.01
        });
      }
    }
    
    // Save the enhanced PDF
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, pdfBytes);
    
    console.log(`✅ Enhanced PDF saved to: ${outputPath}`);
  }

  /**
   * Alternative approach: Add explicit table borders around detected content
   */
  async addExplicitTableBorders(inputPath: string, outputPath: string): Promise<void> {
    console.log('🔲 Adding explicit table borders...');
    
    const existingPdfBytes = fs.readFileSync(inputPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    
    const pages = pdfDoc.getPages();
    
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const page = pages[pageIndex];
      const { width, height } = page.getSize();
      
      // Skip the first page (usually header/intro)
      if (pageIndex === 0) continue;
      
      // Define table regions based on typical menu layout
      const tables: TableRegion[] = [
        {
          // Cold appetizers section
          x: 40,
          y: height - 300,
          width: width - 80,
          height: 200,
          rows: 6,
          cols: 3
        },
        {
          // Warm appetizers section  
          x: 40,
          y: height - 550,
          width: width - 80,
          height: 200,
          rows: 6,
          cols: 3
        }
      ];
      
      // Draw borders for each table
      for (const table of tables) {
        // Outer border
        page.drawRectangle({
          x: table.x,
          y: table.y,
          width: table.width,
          height: table.height,
          borderColor: rgb(0, 0, 0),
          borderWidth: 1,
          opacity: 0.5
        });
        
        // Column dividers
        const colWidth = table.width / table.cols;
        for (let col = 1; col < table.cols; col++) {
          const x = table.x + (col * colWidth);
          page.drawLine({
            start: { x, y: table.y },
            end: { x, y: table.y + table.height },
            thickness: 0.5,
            color: rgb(0, 0, 0),
            opacity: 0.3
          });
        }
        
        // Row dividers
        const rowHeight = table.height / table.rows;
        for (let row = 1; row < table.rows; row++) {
          const y = table.y + (row * rowHeight);
          page.drawLine({
            start: { x: table.x, y },
            end: { x: table.x + table.width, y },
            thickness: 0.5,
            color: rgb(0, 0, 0),
            opacity: 0.3
          });
        }
      }
    }
    
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, pdfBytes);
    
    console.log(`✅ PDF with explicit borders saved to: ${outputPath}`);
  }
}

// Main execution
async function main() {
  const enhancer = new PDFTableEnhancer();
  
  const inputPdf = process.argv[2];
  if (!inputPdf) {
    console.error('❌ Please provide input PDF path as argument');
    process.exit(1);
  }
  
  const inputPath = path.isAbsolute(inputPdf) ? inputPdf : path.join(process.cwd(), inputPdf);
  const outputDir = path.dirname(inputPath);
  const inputName = path.basename(inputPath, '.pdf');
  
  // Create two versions
  const enhancedPath = path.join(outputDir, `${inputName}-enhanced.pdf`);
  const borderedPath = path.join(outputDir, `${inputName}-bordered.pdf`);
  
  try {
    // Version 1: Subtle grid lines
    await enhancer.enhancePDF(inputPath, enhancedPath);
    
    // Version 2: Explicit table borders
    await enhancer.addExplicitTableBorders(inputPath, borderedPath);
    
    console.log('\n🎉 PDF preprocessing complete!');
    console.log('📄 Generated files:');
    console.log(`   - ${enhancedPath} (subtle grid)`)
    console.log(`   - ${borderedPath} (explicit borders)`);
    console.log('\n🚀 Now try processing these with Document AI to see if table detection improves!');
    
  } catch (error) {
    console.error('❌ Error enhancing PDF:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export default PDFTableEnhancer;
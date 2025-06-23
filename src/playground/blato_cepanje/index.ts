import { fromPath } from 'pdf2pic';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';

const outputDir = path.resolve(__dirname, 'output');
const pdfPath = path.resolve(__dirname, './blato_stanovi.pdf');

// Create output directory if it doesn't exist
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

/**
 * Crop regions for each section (in pixels at 300 DPI)
 * Based on A4 page dimensions: 2479x3508 pixels at 300 DPI
 * 
 * HOW TO ADJUST:
 * - Increase 'top' value to move the rectangle DOWN
 * - Decrease 'top' value to move the rectangle UP
 * - Increase 'height' value to make the rectangle TALLER
 * - Decrease 'height' value to make the rectangle SHORTER
 * - 'left' and 'width' typically don't need adjustment for centered content
 */
const CROP_REGIONS = {
    /**
     * Top section: TLOCRT UVUČENOG KATA and ISTOČNO/ZAPADNO PROČELJE
     * This captures the small floor plan overview and building elevation
     */
    topSection: {
        /** Distance from left edge of page (usually keep at 50 for margin) */
        left: 50,
        /** Distance from top of page - adjust if header is cut off or too much space above */
        top: 280,
        /** Width of crop area (2379 = full width minus margins) */
        width: 2379,
        /** Height of crop area - adjust if bottom content is cut off or includes unwanted elements */
        height: 570
    },
    
    /**
     * Middle section: Main apartment floor plan
     * This captures the detailed floor plan with room labels and orientation arrow
     */
    mainFloorPlan: {
        /** Distance from left edge of page (usually keep at 50 for margin) */
        left: 50,
        /** Distance from top of page - should include "Zapad" arrow at top of floor plan */
        top: 850,
        /** Width of crop area (2379 = full width minus margins) */
        width: 2379,
        /** Height of crop area - should stop before "ISKAZ POVRŠINA" text */
        height: 1380
    },
    
    /**
     * Bottom section: ISKAZ POVRŠINA (area calculation table)
     * This captures the table with room areas and calculations
     */
    areaTable: {
        /** Distance from left edge of page (usually keep at 50 for margin) */
        left: 50,
        /** Distance from top of page - should include "ISKAZ POVRŠINA" header text */
        top: 2265,
        /** Width of crop area (2379 = full width minus margins) */
        width: 2379,
        /** Height of crop area - should include entire table with "ukupno" row at bottom */
        height: 840
    }
};

const options = {
    density: 300, // High quality for detailed floor plans
    saveFilename: 'temp',
    savePath: outputDir,
    format: 'png',
    width: -1,
    height: -1,
    preserveAspectRatio: true
};

async function drawRectanglesOnPage(pageNumber: number) {
    try {
        console.log(`Processing page ${pageNumber} with rectangles...`);
        
        // Convert PDF page to image
        const storeAsImage = fromPath(pdfPath, options);
        const pageImage = await storeAsImage(pageNumber);
        
        if (!pageImage.path) {
            console.error(`Failed to convert page ${pageNumber}`);
            return;
        }

        // Create visualization directory
        const vizDir = path.join(outputDir, 'visualization');
        if (!fs.existsSync(vizDir)) {
            fs.mkdirSync(vizDir, { recursive: true });
        }

        // Create SVG overlay with red rectangles
        const svgRectangles = `
            <svg width="2479" height="3508">
                <!-- Top section rectangle -->
                <rect x="${CROP_REGIONS.topSection.left}" y="${CROP_REGIONS.topSection.top}" 
                      width="${CROP_REGIONS.topSection.width}" height="${CROP_REGIONS.topSection.height}" 
                      fill="none" stroke="red" stroke-width="5"/>
                <text x="${CROP_REGIONS.topSection.left + 10}" y="${CROP_REGIONS.topSection.top + 30}" 
                      font-size="30" fill="red">TLOCRT + PROČELJE</text>
                
                <!-- Main floor plan rectangle -->
                <rect x="${CROP_REGIONS.mainFloorPlan.left}" y="${CROP_REGIONS.mainFloorPlan.top}" 
                      width="${CROP_REGIONS.mainFloorPlan.width}" height="${CROP_REGIONS.mainFloorPlan.height}" 
                      fill="none" stroke="red" stroke-width="5"/>
                <text x="${CROP_REGIONS.mainFloorPlan.left + 10}" y="${CROP_REGIONS.mainFloorPlan.top + 30}" 
                      font-size="30" fill="red">FLOOR PLAN</text>
                
                <!-- Area table rectangle -->
                <rect x="${CROP_REGIONS.areaTable.left}" y="${CROP_REGIONS.areaTable.top}" 
                      width="${CROP_REGIONS.areaTable.width}" height="${CROP_REGIONS.areaTable.height}" 
                      fill="none" stroke="red" stroke-width="5"/>
                <text x="${CROP_REGIONS.areaTable.left + 10}" y="${CROP_REGIONS.areaTable.top + 30}" 
                      font-size="30" fill="red">ISKAZ POVRŠINA</text>
            </svg>
        `;

        // Composite the SVG overlay onto the image
        await sharp(pageImage.path)
            .composite([{
                input: Buffer.from(svgRectangles),
                top: 0,
                left: 0
            }])
            .toFile(path.join(vizDir, `page_${pageNumber.toString().padStart(3, '0')}_rectangles.png`));

        // Clean up temporary file
        fs.unlinkSync(pageImage.path);

        console.log(`Page ${pageNumber} with rectangles saved to visualization directory`);
    } catch (error) {
        console.error(`Error processing page ${pageNumber}:`, error);
    }
}

async function processPage(pageNumber: number) {
    try {
        console.log(`Processing page ${pageNumber}...`);
        
        // Convert PDF page to image
        const storeAsImage = fromPath(pdfPath, options);
        const pageImage = await storeAsImage(pageNumber);
        
        if (!pageImage.path) {
            console.error(`Failed to convert page ${pageNumber}`);
            return;
        }

        // Create subdirectory for this page
        const pageDir = path.join(outputDir, `page_${pageNumber.toString().padStart(3, '0')}`);
        if (!fs.existsSync(pageDir)) {
            fs.mkdirSync(pageDir, { recursive: true });
        }

        // Read the full page image
        const fullImage = sharp(pageImage.path);

        // Extract top section (TLOCRT UVUČENOG KATA and PROČELJE)
        await fullImage
            .clone()
            .extract(CROP_REGIONS.topSection)
            .toFile(path.join(pageDir, `${pageNumber.toString().padStart(3, '0')}_tlocrt_procelje.png`));

        // Extract main floor plan
        await fullImage
            .clone()
            .extract(CROP_REGIONS.mainFloorPlan)
            .toFile(path.join(pageDir, `${pageNumber.toString().padStart(3, '0')}_floor_plan.png`));

        // Extract area table (ISKAZ POVRŠINA)
        await fullImage
            .clone()
            .extract(CROP_REGIONS.areaTable)
            .toFile(path.join(pageDir, `${pageNumber.toString().padStart(3, '0')}_area_table.png`));

        // Clean up temporary file
        fs.unlinkSync(pageImage.path);

        console.log(`Page ${pageNumber} processed successfully`);
    } catch (error) {
        console.error(`Error processing page ${pageNumber}:`, error);
    }
}

async function processPDF(startPage: number = 9, endPage: number = 186) {
    console.log('Starting PDF processing...');
    console.log(`Processing pages ${startPage} to ${endPage} from ${pdfPath}`);

    // Process pages
    for (let page = startPage; page <= endPage; page++) {
        await processPage(page);
    }

    console.log(`PDF processing completed for pages ${startPage}-${endPage}!`);
}

// First, let's process just one page to test and adjust crop regions
async function testSinglePage() {
    console.log('Testing with page 9 to determine correct crop regions...');
    
    try {
        // Convert page 9 to image
        const storeAsImage = fromPath(pdfPath, options);
        const pageImage = await storeAsImage(9);
        
        if (!pageImage.path) {
            console.error('Failed to convert test page');
            return;
        }

        // Get image metadata to understand dimensions
        const metadata = await sharp(pageImage.path).metadata();
        console.log('Page dimensions:', metadata);

        // Save the full page for reference
        const testDir = path.join(outputDir, 'test');
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true });
        }
        
        fs.copyFileSync(pageImage.path, path.join(testDir, 'page_009_full.png'));
        
        console.log(`Test page saved to ${testDir}/page_009_full.png`);
        console.log('Please check the image to determine exact crop regions.');
        
        // Clean up
        fs.unlinkSync(pageImage.path);
    } catch (error) {
        console.error('Error in test:', error);
    }
}

// Check if PDF exists
if (!fs.existsSync(pdfPath)) {
    console.error(`PDF file not found at ${pdfPath}`);
    console.error('Please ensure blato_stanovi.pdf is in the project root directory.');
    process.exit(1);
}

// Run test first to check dimensions
if (process.argv[2] === '--test') {
    testSinglePage();
} else if (process.argv[2] === '--test-crop') {
    // Test crop regions on a single page
    const testPage = parseInt(process.argv[3]) || 9;
    processPage(testPage).then(() => {
        console.log(`Test crops saved in output/page_${testPage.toString().padStart(3, '0')}/`);
    });
} else if (process.argv[2] === '--visualize') {
    // Visualize crop regions with rectangles
    const testPage = parseInt(process.argv[3]) || 9;
    drawRectanglesOnPage(testPage).then(() => {
        console.log(`Visualization saved in output/visualization/`);
    });
} else if (process.argv[2] === '--process') {
    const startPage = parseInt(process.argv[3]) || 9;
    const endPage = parseInt(process.argv[4]) || 186;
    processPDF(startPage, endPage);
} else {
    console.log('Usage:');
    console.log('  npm run blato:test         - Test with single page to check crop regions');
    console.log('  npm run blato:test-crop    - Test crop regions on page 9 (or specify page number)');
    console.log('  npm run blato:visualize    - Visualize crop regions with red rectangles');
    console.log('  npm run blato:process      - Process all pages (9-186)');
}

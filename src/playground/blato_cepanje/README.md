# Blato Stanovi PDF Processor

This script extracts three specific sections from each page of the `blato_stanovi.pdf` file (pages 9-186):
1. **TLOCRT + PROČELJE** - Floor layout and building elevation view
2. **Floor Plan** - Detailed apartment floor plan
3. **ISKAZ POVRŠINA** - Area calculation table

## Prerequisites

- Node.js and npm installed
- **ImageMagick** or **GraphicsMagick** installed on your system (required by pdf2pic)
- The `blato_stanovi.pdf` file must be in the same directory as the script

### Installing ImageMagick

**On macOS:**
```bash
brew install imagemagick
```

**On Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install imagemagick
```

**On Windows:**
Download and install from: https://imagemagick.org/script/download.php#windows

### Installing GraphicsMagick (alternative)

**On macOS:**
```bash
brew install graphicsmagick
```

**On Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install graphicsmagick
```

## Installation

1. Make sure you're in the project root directory
2. Install dependencies:
```bash
npm install
# or
yarn install
```

## Usage

### Test and Visualize

Before processing all pages, you can test the crop regions:

```bash
# Test with a single page to check dimensions
npm run blato:test

# Visualize crop regions with red rectangles on page 9
npm run blato:visualize

# Visualize crop regions on a specific page (e.g., page 50)
npx ts-node src/playground/blato_cepanje/index.ts --visualize 50

# Test actual cropping on page 9
npm run blato:test-crop

# Test cropping on a specific page
npx ts-node src/playground/blato_cepanje/index.ts --test-crop 50
```

### Process All Pages

To process all pages (9-186) and extract the three sections:

```bash
npm run blato:process
```

### Process Specific Page Range

If you need to process only certain pages or continue from where it stopped:

```bash
# Process pages 50 to 100
npx ts-node src/playground/blato_cepanje/index.ts --process 50 100

# Process pages 101 to 186
npx ts-node src/playground/blato_cepanje/index.ts --process 101 186
```

## Output Structure

The script creates the following output structure:

```
src/playground/blato_cepanje/output/
├── page_009/
│   ├── 009_tlocrt_procelje.png    # Top section with floor layout and elevation
│   ├── 009_floor_plan.png         # Main apartment floor plan
│   └── 009_area_table.png         # ISKAZ POVRŠINA table
├── page_010/
│   ├── 010_tlocrt_procelje.png
│   ├── 010_floor_plan.png
│   └── 010_area_table.png
└── ... (continues for all processed pages)
```

## Crop Regions

The script uses the following crop regions (optimized for A4 pages at 300 DPI):

- **Top Section**: Captures TLOCRT UVUČENOG KATA and building elevation
  - Position: 280px from top, 570px height
  
- **Floor Plan**: Captures the main apartment layout with orientation arrow
  - Position: 850px from top, 1380px height
  
- **Area Table**: Captures the ISKAZ POVRŠINA header and full table
  - Position: 2265px from top, 840px height

## Troubleshooting

1. **"PDF file not found"**: Make sure `blato_stanovi.pdf` is in the same directory as this script (`src/playground/blato_cepanje/`)

2. **Processing takes too long**: The script processes one page at a time. For 178 pages, expect it to take several minutes. You can process in batches using the page range option.

3. **Wrong crop regions**: Use the `--visualize` option to check if the red rectangles are correctly positioned before processing.

## Technical Details

- Uses `pdf2pic` to convert PDF pages to PNG images at 300 DPI
- Uses `sharp` for image cropping
- Each page is processed sequentially to avoid memory issues
- Temporary files are cleaned up after each page is processed
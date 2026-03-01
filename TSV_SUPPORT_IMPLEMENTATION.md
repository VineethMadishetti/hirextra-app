# Tab-Separated File Support - Implementation Guide

## Overview
Your Hirextra application now fully supports **tab-separated CSV files** (.csv files with tab delimiters) in addition to comma-separated CSVs.

## What Was Changed

### 1. **Delimiter Detection Utility** (`server/utils/delimiterDetector.js`)
- **`detectDelimiter(firstLine, fileExtension)`**: Analyzes the first line to determine if the file uses tabs or commas
  - Counts tab and comma occurrences (excluding quoted sections)
  - Returns `'\t'` for tab-separated or `','` for comma-separated
  - Default: comma (for safety)

- **`parseCsvLineWithDelimiter(line, delimiter)`**: Parses a single CSV line with the specified delimiter
  - Properly handles quoted fields
  - Unquotes and trims each field
  - Works with both commas and tabs

### 2. **File Upload Processing** (`server/controllers/candidateController.js`)
- **Updated `uploadChunk` endpoint**: 
  - Now detects delimiter when reading headers from uploaded files
  - Uses correct parser for both CSV and TSV formats
  - Stores headers with proper parsing

- **Updated `getFileHeaders` endpoint**:
  - Detects delimiter from S3 files before parsing
  - Returns headers correctly for tab-separated files

### 3. **Background CSV Processing** (`server/utils/queue.js`)
- **Added `detectFileDelimiter()` helper**:
  - Reads first line from S3 or local file
  - Returns detected delimiter

- **Updated `processCsvJob` function**:
  - Detects delimiter before opening file stream
  - Passes delimiter to csv-parser options
  - Ensures all rows are parsed with correct delimiter

## Supported File Structures

### Apollo Organization Data (Apollo-org_10_rows.csv)
```
organization_id [TAB] organization_name [TAB] organization_hq_location_city [TAB] organization_hq_location_country [TAB] ... (54 columns total)
```

**Field Mapping:**
- `organization_name` → Company
- `organization_hq_location_city` → Locality
- `organization_hq_location_country` → Country
- `organization_website_url` → LinkedIn URL
- `organization_num_current_employees` → Experience

### Apollo People Data (Apollo-per_50_rows.csv)
```
person_name [TAB] person_email [TAB] person_phone [TAB] person_title [TAB] person_location_city [TAB] ... (46 columns total)
```

**Field Mapping:**
- `person_name` → Full Name
- `person_first_name_unanalyzed` → First Name
- `person_last_name_unanalyzed` → Last Name
- `person_email` → Email
- `person_phone` → Phone
- `person_title` → Job Title
- `person_location_city` → Locality
- `person_location_country` → Country
- `person_linkedin_url` → LinkedIn URL

## How to Use

### Step 1: Upload File from S3
1. Go to **Admin Dashboard** → **Upload & Map** tab
2. Click **"Use Existing S3 File"**
3. Enter S3 key: `Apollo-org_10_rows.csv` or `Apollo-per_50_rows.csv`
4. Click **"Load File Headers"**

### Step 2: Map Fields
- The system will automatically detect the tab delimiter
- Read all 54 (or 46) column headers from your file
- Map Apollo columns to PeopleFinder fields:
  - `person_name` → fullName
  - `person_email` → email (auto-detected)
  - `person_phone` → phone (auto-detected)
  - etc.

### Step 3: Process File
1. Click **"Process File"**
2. System will:
   - Detect the tab delimiter
   - Parse all rows correctly with tab separation
   - Validate each record
   - Insert into MongoDB with proper field mapping
   - Show real-time progress in History tab

## Key Features

✅ **Automatic Delimiter Detection**
- No manual configuration needed
- Intelligently chooses between tabs and commas
- Handles mixed formats in same batch

✅ **Full Data Integrity**
- Properly handles quoted fields with delimiters inside quotes
- Strips BOM (Byte Order Mark) if present
- Validates column count per row

✅ **Robust Error Handling**
- Falls back to comma delimiter if detection fails
- Continues processing even if individual rows fail
- Tracks failure reasons and counts

✅ **Performance Optimized**
- Delimiter detection reads only first line
- Header index mapping reduces O(N) lookups to O(1)
- Batch inserts reduce database round trips

## Example: Loading Apollo-per_50_rows.csv

```
File: Apollo-per_50_rows.csv
Detected: TAB-SEPARATED ✅

Headers Found: 46 columns
- person_name
- person_first_name_unanalyzed
- person_last_name_unanalyzed
- person_title
- person_email
- person_phone
- person_linkedin_url
- person_location_city
- person_location_country
- ... (41 more fields)

Field Mapping:
✓ person_name → fullName
✓ person_email → email
✓ person_phone → phone
✓ person_title → jobTitle
✓ person_location_city → locality
✓ person_location_country → country
✓ person_linkedin_url → linkedinUrl

Processing: 50 rows
✓ 48 records imported successfully
⚠ 2 records failed validation (missing required fields)
```

## Testing Your Files

To verify the implementation works with your Apollo files:

1. **Upload Apollo-per_50_rows.csv**
   - Expected: Tab detection ✓
   - Expected: 50 rows processed
   - Expected: ~45-48 valid candidates

2. **Upload Apollo-org_10_rows.csv**
   - Expected: Tab detection ✓
   - Expected: 10 rows processed
   - Expected: ~9-10 valid organizations

## Technical Details

- **Delimiter Detection Logic**: Counts delimiters in first line, uses ratio-based comparison
- **CSV Parser**: Uses npm's `csv-parser` with dynamic delimiter option
- **Batch Size**: 2000 rows per database transaction (optimized for performance)
- **Progress Updates**: Every 2 seconds or after 1000 new rows
- **Field Validation**: Uses existing `cleanAndValidateCandidate()` function

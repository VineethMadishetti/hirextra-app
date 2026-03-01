# Resume Folder Parsing - Simple Solution Guide

## Problem Summary
Your application has **4200+ resumes** in the S3 folder (`Resumes 2/`) that need RChilli parsing. The job is stuck in `PROCESSING` state and polling the status endpoint results in CORS/502 errors due to backend load.

## Quick Solution

### Option 1: Lightweight Status Check (Recommended)
Instead of polling the status endpoint (which causes CORS issues), query the MongoDB directly or use a simple health check:

```bash
# In your browser console:
fetch("https://api.stucrow.com/api/candidates/health").then(r => r.json()).then(console.log)
```

### Option 2: Force Resume Processing (No UI)
When the update from `PROCESSING` fails, use this endpoint after 30 seconds:

```javascript
// Resume the folder job (skip already-parsed files)
fetch("https://api.stucrow.com/api/candidates/699e10cc32c762de91fdff1b/resume", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ forceReparse: false }) // true to re-parse everything
}).then(r => r.json()).then(console.log)
```

**Expected Response:**
```json
{
  "message": "Resume-folder job restart triggered",
  "jobId": "699e10cc32c762de91fdff1b",
  "skipExisting": true,
  "forceReparse": false
}
```

## Understanding What's Happening

### Current Processing Logic
1. **S3 Folder Scan**: List all `.pdf`, `.docx`, `.doc` files in `Resumes 2/`
2. **Duplicate Check**: Skip files already in database (when `skipExisting=true`)
3. **RChilli Parsing**: Parse each resume asynchronously with concurrency control
4. **Database Storage**: Store parsed data (name, email, phone, skills, etc.)
5. **Job Tracking**: Update progress (successRows, failedRows)

### Why Status Polling Fails
- **High Concurrency**: 4200+ files create heavy database queries
- **Memory Pressure**: Large batches of parsed resumes in memory
- **Backend Bottleneck**: Status endpoint (`populate("uploadedBy")`) is too heavy
- **CORS During Restart**: After restart, CORS headers may not be set immediately

## Recommended Approach

### Step 1: Wait for processing to continue
The job is already running in the background. Leave it processing.

### Step 2: Check progress via MongoDB (If you have access)
```bash
# Connect to MongoDB and check:
db.uploadjobs.findOne({ _id: ObjectId("699e10cc32c762de91fdff1b") })

# Shows: { status, successRows, failedRows, totalRows }
```

### Step 3: Monitor logs
```bash
# SSH into your server and tail logs:
tail -f /path/to/app/logs/app.log | grep "Job 699e10cc32c762de91fdff1b"
```

## Expected Processing Time

For **4200 resumes** with **1 concurrent parse**:
- RChilli API: ~2-3 seconds per resume  
- Total: **2-3 hours**
- With **5 concurrent**: **24-36 minutes**

Adjust in `.env`:
```properties
RESUME_IMPORT_DIRECT_CONCURRENCY=5
RESUME_PARSE_CONCURRENCY=3
```

## If Processing is Stuck

### Force Restart (Hard)
```javascript
// This will restart from scratch with skipExisting=true
const jobId = "699e10cc32c762de91fdff1b";
const forceReparse = false; // true to re-parse everything

fetch(`https://api.stucrow.com/api/candidates/${jobId}/resume`, {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ forceReparse })
}).then(r => r.json()).then(console.log)
```

### Monitor Without Polling
Instead of constantly polling, check periodically and allow time for processing:

```javascript
// Check every 5 minutes instead of every 1 second
setInterval(async () => {
  const job = await fetch(`/api/candidates/699e10cc32c762de91fdff1b/status`).then(r => r.json());
  console.log(`Status: ${job.status}, Progress: ${job.successRows}/${job.totalRows}`);
}, 300000); // 5 min
```

## Failure Handling

### Partial Resume Records
If RChilli parsing fails for some resumes, they're stored as `PARTIAL` records with:
- `parseStatus: "PARTIAL"`
- `parseWarnings: [reason, error]`
- Basic data extracted from text fallback

**Example failure reasons:**
- `RCHILLI_PARSE_FAILED`: RChilli API returned error
- `TEXT_EXTRACTION_FAILED`: Could not read PDF/DOCX
- `PDF_TIMEOUT`: Large corrupted PDF took >15 seconds
- `S3_DOWNLOAD_ERROR`: File couldn't be downloaded

## RChilli Configuration Check

Verify your environment has:
```properties
RCHILLI_USER_KEY=<your-key>
RCHILLI_ENDPOINT=https://rest.rchilli.com/RChilliParser/Rchilli/parseResumeBinary
RCHILLI_VERSION=8.0.0
RCHILLI_MAX_ATTEMPTS=1
RCHILLI_REQUEST_TIMEOUT_MS=120000
```

## Database Schema

Parsed resumes are stored in `Candidate` collection:
```javascript
{
  fullName: "Eric Holard",
  email: "ericholard@yahoo.com",
  phone: "+33...",
  jobTitle: "Chief Executive Officer",
  company: "National Cement",
  skills: "Leadership, Strategy, Finance",
  experience: "35 Years",
  location: "Paris, Ile-de-France, France",
  sourceFile: "Resumes 2/eric-holard.pdf",
  uploadJobId: "699e10cc32c762de91fdff1b",
  parseStatus: "PARSED" | "PARTIAL",
  parseWarnings: [],
  parsedResume: { provider: "RCHILLI", ... },
  createdAt: "2026-02-28T22:55:58.747Z"
}
```

## Success Indicators

✅ Processing is working correctly when:
- Backend logs show: "📄 Processing Resume: uploads/Resumes 2/xxx.pdf"
- Database shows increasing `successRows` count
- New candidates appear in "Search" page

## Debugging Further

1. **Check Backend Logs**
   ```bash
   # Look for error patterns
   ErrorMessage: "RCHILLI_PARSE_FAILED[...]"
   ErrorMessage: "S3_DOWNLOAD_TIMEOUT[...]"
   ```

2. **View Failure Reasons**
   ```javascript
   // In MongoDB
   db.uploadjobs.findOne({ _id: ObjectId("699e10cc32c762de91fdff1b") }, { failureReasonsample })
   ```

3. **Manual Parse Test** (Single File)
   ```javascript
   const testFile = "Resumes 2/test-resume.pdf";
   // Use the resume-import endpoint to process this one file
   ```

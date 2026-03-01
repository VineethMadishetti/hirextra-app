# ✅ Resume Parsing from UI - Complete Guide

## Problem Fixed
The continuous **500 errors** on job status polling have been **FIXED** by:
- Simplifying the database query (removed complex `.select()` and `.timeout()` chaining)
- Removing conflicting manual CORS headers (relying on global middleware instead)
- Adding better error logging for debugging

## ✅ How to Use Resume Parsing from the UI

### Step 1: Go to Admin Dashboard
1. Login to your account (must be ADMIN role)
2. Click on **"Admin Dashboard"** in the sidebar

### Step 2: Switch to Resume Import Tab
In the Admin Dashboard, you should see three import modes:
- **Upload Files** (for direct CSV/TSV uploads)
- **S3 CSV Import** (for CSV/TSV files in S3)
- **Bulk Resume Import** ← **Use this one for resuming the 4,200 pending resumes**

Click on **"Bulk Resume Import"** tab to switch to it.

### Step 3: Enter S3 Folder Path
In the "Bulk Resume Import" section:
1. **S3 Folder Path**: Enter `Resumes 2/` (or your resume folder name)
2. This folder should contain PDF, DOCX, and DOC resume files

### Step 4: Click "Start Resume Import"
- Click the blue **"Start Resume Import"** button
- You'll see a toast notification: `"Import started. XXXX files queued..."`
- The dashboard will automatically switch to the **"History"** tab

### Step 5: Monitor Progress
In the **History** tab, you'll see the resume import job with:
- **Status**: PROCESSING (updates every 2 seconds)
- **Progress Bar**: Shows percentage completion
- **Rows**: Displays `X of YYYY successfully processed`
- **Failed**: Shows number of failed resumes

The status updates **every 2 seconds** automatically.

## 📊 What Happens During Import

1. **Resume Discovery**: Scans S3 folder for `.pdf`, `.docx`, `.doc` files
2. **Skip Existing**: By default, skips files already parsed (disable with `forceReparse: true`)
3. **RChilli Parsing**: Each resume is parsed using RChilli API
4. **Candidate Creation**: Successfully parsed resumes create new Candidate records
5. **Final Report**: Shows total processed, successful, and failed counts

## ⏱️ Expected Duration
- **4,200 resumes**: Approximately 40-80 minutes depending on:
  - RChilli API response time
  - Number of parallel workers (default: 5)
  - Network latency to S3 and RChilli servers

## ❌ If You See Errors

### Status Polling Returns 500
**Fixed in this update!** But if still happening:
1. Check backend logs: `tail -f server/logs/*.log`
2. Verify job ID exists in MongoDB: `db.uploadjobs.findById({jobId})`
3. Restart backend: `npm restart` or redeploy

### No Jobs Showing in History
1. Ensure you're ADMIN user
2. Refresh page (Ctrl+F5)
3. Check if import actually started
4. Look for toast error message

### Resume Import Didn't Start
1. Verify S3 folder path is correct (e.g., `Resumes 2/`)
2. Check that folder contains resume files (PDF, DOCX, DOC only)
3. Verify S3 credentials are correct in backend
4. Check backend logs for errors

### Some Files Not Processing
This is normal if:
- Files are already in the database (skip with `skipExisting: false`)
- Files are corrupted PDFs
- File extensions are not PDF/DOCX/DOC (case-insensitive)
- RChilli API fails for specific files (stored as PARTIAL records)

## 🔧 Advanced Options

### Force Reparse (Reprocess Existing Files)
If you want to **reparse files already in the database**:
1. Contact admin to set `RESUME_IMPORT_ALLOW_REPARSE=true`
2. Send API request with `forceReparse: true`:
   ```bash
   curl -X POST https://api.stucrow.com/api/candidates/import-resumes \
     -H "Authorization: Bearer {TOKEN}" \
     -H "Content-Type: application/json" \
     -d '{"folderPath": "Resumes 2/", "forceReparse": true}'
   ```

### Use Direct API (Console)
Instead of UI, you can use browser console:
```javascript
// Start resume import
fetch('https://api.stucrow.com/api/candidates/import-resumes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({ folderPath: 'Resumes 2/', skipExisting: true })
})
.then(r => r.json())
.then(console.log)

// Check job status
fetch('https://api.stucrow.com/api/candidates/job/{jobId}/status', {
  credentials: 'include'
})
.then(r => r.json())
.then(console.log)
```

## 📋 API Endpoints

### Start Resume Import
```
POST /api/candidates/import-resumes
Authorization: Bearer {token}
Content-Type: application/json

{
  "folderPath": "Resumes 2/",
  "skipExisting": true,
  "forceReparse": false
}

Response:
{
  "message": "Import started...",
  "jobId": "699e10cc32c762de91fdff1b",
  "queuedCount": 4200
}
```

### Check Job Status  
```
GET /api/candidates/job/{jobId}/status
Authorization: Bearer {token}

Response:
{
  "status": "PROCESSING",
  "totalRows": 4200,
  "successRows": 1250,
  "failedRows": 45,
  "error": null,
  "progress": {
    "percentage": 30.8,
    "processed": 1295,
    "total": 4200,
    "pending": 2905
  }
}
```

## ✅ Verification Checklist

After resume import completes, verify:
- [ ] Job status shows **"COMPLETED"**
- [ ] `successRows` count matches expected resumes
- [ ] New candidates appear in **Candidate Database**
- [ ] Search results include parsed resume data
- [ ] No CORS errors in browser console
- [ ] No 500 errors on status polling

## 🚀 Performance Tips

1. **Don't Use Old Job IDs**: Always start fresh resume import from UI
2. **Monitor the First 100**: Verify initial resumes are parsing correctly before full 4,200
3. **Check S3 Folder**: Ensure all files are properly uploaded to S3 before importing
4. **Expected Processing Speed**: ~1 resume per second (varies with RChilli API speed)

## 📞 Support

If issues persist:
1. Check browser console (F12) for detailed error messages
2. Check backend logs in Render dashboard
3. Verify MongoDB connection is active
4. Ensure RChilli API credentials are valid
5. Contact admin with job ID for debugging

---

**Last Updated**: March 1, 2026  
**Fix Applied**: Simplified getJobStatus query, removed manual CORS headers  
**Status**: ✅ Ready for production use

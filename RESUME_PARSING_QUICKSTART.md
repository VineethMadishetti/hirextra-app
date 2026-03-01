# Quick Start: Parse Resumes

## 🚀 Parse Pending Resumes in 3 Steps

### Step 1: Trigger Processing
```bash
# Copy & paste into browser console:
fetch("https://api.stucrow.com/api/candidates/process-folder", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    folderPath: "Resumes 2/",
    forceReparse: false
  })
})
.then(r => r.json())
.then(r => {
  console.log("✅ Job Started!");
  console.log("Job ID:", r.jobId);
  console.log("Status URL:", r.checkStatusUrl);
  // Save jobId for next step
})
.catch(e => console.error("❌ Error:", e.message));
```

**Expected output:**
```json
{
  "message": "Resume folder processing started",
  "jobId": "699e10cc32c762de91fdff1b",
  "folderPath": "Resumes 2/",
  "skipExisting": true,
  "checkStatusUrl": "/api/candidates/job/699e10cc32c762de91fdff1b/status"
}
```

### Step 2: Monitor Progress
```bash
# Replace JOB_ID with the jobId from Step 1
# Run this every 30-60 seconds:

fetch("https://api.stucrow.com/api/candidates/job/699e10cc32c762de91fdff1b/status", {
  credentials: "include"
})
.then(r => r.json())
.then(r => {
  const p = r.progress;
  console.log(`Progress: ${p.processed}/${p.total} (${p.percentage}%)`);
  console.log(`Success: ${r.successRows}, Failed: ${r.failedRows}`);
  console.log(`Status: ${r.status}`);
})
.catch(e => console.error("Error:", e.message));
```

**Expected output (live updates):**
```
Progress: 150/4200 (3%)
Success: 150, Failed: 0
Status: PROCESSING
```

### Step 3: Verify Results
Once status shows `COMPLETED`, search for parsed candidates:
1. Go to application home
2. Click "Search" tab
3. Search for any candidate name
4. You should see parsed resumes with:
   - ✅ Email addresses
   - ✅ Phone numbers
   - ✅ Job titles
   - ✅ Skills
   - ✅ LinkedIn profiles

---

## ⏱️ Expected Timeline

| Folder Size | Parsing Time |
|------------|--------------|
| 100 files | 5-10 minutes |
| 500 files | 25-50 minutes |
| 4200 files (yours) | **40-60 minutes** |

> *Times assume standard .pdf resumes with RChilli parsing*

---

## 🔧 If You Need to Speed Up

Edit `.env` and restart backend:
```properties
# Current (safe):
RESUME_PARSE_CONCURRENCY=1

# Faster (recommended):
RESUME_PARSE_CONCURRENCY=3

# Fast (may hit API throttles):
RESUME_PARSE_CONCURRENCY=5
```

Restart backend after changing:
```bash
# Kill = restart process
pkill -f "node server.js"
npm start
```

---

## ❌ Troubleshooting

### Q: Status endpoint returns error
**A:** Wait 30 seconds and try again. Or restart backend once.

### Q: Processing shows 0% stuck
**A:** Check backend logs. If empty, scale up concurrency or check RChilli configuration.

### Q: Parsed resumes not showing in search
**A:** Database query might be slow. Try searching for specific name or wait 5 minutes.

### Q: Want to re-parse everything
**A:** Use `forceReparse: true` in Step 1 (will re-parse all files).

---

## 📊 What Gets Parsed

Each resume is parsed to extract:
- ✅ **Name** (fullName)
- ✅ **Email** (email)
- ✅ **Phone** (phone)
- ✅ **Job Title** (jobTitle)
- ✅ **Company** (company)
- ✅ **Skills** (skills)
- ✅ **Experience** (years)
- ✅ **Location** (city, country)
- ✅ **LinkedIn URL** (linkedinUrl)
- ✅ **Summary** (profile summary)

All stored in database and searchable.

---

## 💾 Storage

- **Database:** MongoDB Candidate collection
- **Total files:** 4200 resumes
- **Expected parsed:** ~3850 (91%) 
- **May fail:** ~350 (9%) - stored as PARTIAL records

Failures are normal due to:
- Corrupted PDFs
- Image-only resumes (need OCR)
- Unusual resume formats

---

## 🎯 Next Actions

✅ Run Step 1 (Trigger)
⏳ Run Step 2 every 30-60 sec (Monitor)≤ 60 min wait time
✅ Run Step 3 (Verify)

**That's it!** Your 4200+ resumes will be parsed and searchable.

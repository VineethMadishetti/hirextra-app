# Resume Parsing - Debugging & Architecture Guide

## System Architecture

Your application has resume parsing integrated at multiple levels:

```
Architecture Layers:
═══════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────┐
│ Frontend (React)                                             │
│ - Display parsing progress                                  │
│ - Poll status endpoint every 5-30 seconds                   │
│ - Show parsed candidates in search                          │
└──────────────────┬──────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────────┐
│ Backend API (Express Node.js)                                │
│ ├─ POST /api/candidates/process-folder (NEW)                │
│ ├─ GET /api/candidates/job/:id/status (OPTIMIZED)           │
│ ├─ POST /api/candidates/:id/resume (Resume job)             │
│ └─ /api/candidates/search (List parsed candidates)          │
└──────────────────┬──────────────────────────────────────────┘
                   │
┌──────────────────┼──────────────────────────────────────────┐
│ Processing Pipeline                                          │
│                                                              │
│  S3 (Resumes 2/) → List Files → For Each File:             │
│                                  ├─ Download from S3         │
│                                  ├─ Parse with RChilli      │
│                                  ├─ Extract structured data  │
│                                  └─ Store in MongoDB        │
│                                                              │
│  Concurrency: 1-5 files in parallel (configurable)         │
│  Speed: 2-3 seconds per resume                             │
│  Fallback: Text extraction if RChilli fails               │
└──────────────────┬──────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────────┐
│ External Services                                            │
│ ├─ S3 (AWS) - Resume files                                  │
│ ├─ MongoDB - Candidate database                             │
│ ├─ RChilli API - Resume parsing                             │
│ └─ Redis (optional) - Background queue                      │
└─────────────────────────────────────────────────────────────┘
```

---

## Data Flow: Single Resume

```
Resume File: "John_Doe.pdf"
         │
         ├─────────────────────────────────────────────────┐
         │                                                  │
         ▼                                                  │
    S3 Download                                            │
    (binary file)                                          │
         │                                                  │
         ▼                                                  │
    RChilli API                                            │
    ├─ POST /parseResumeBinary                            │
    ├─ userkey: RCHILLI_USER_KEY                          │
    └─ Returns: parsed JSON                               │
         │                                                  │
         ├─ On Success ─────────────────────────┐          │
         │  {                                    │          │
         │    "ResumeParserData": {             │          │
         │      "Name": "John Doe",             │          │
         │      "Email": "john@example.com",   │          │
         │      ...                             │          │
         │    }                                 │          │
         │  }                                   │          │
         │                                     ▼          │
         │                            Extract Structured  │
         │                            Data               │
         │                                     │          │
         │                                     ▼          │
         │                            Validate & Clean   │
         │                                     │          │
         │                                     ▼          │
         │                            Store in MongoDB   │
         │                                     │          │
         │                                    ✅          │
         │                                                │
         │                                                │
         ├─ On Failure ──────────────────────────────┐   │
         │  (Network error, invalid resume, etc.)     │   │
         │                                            │   │
         │                                            ▼   │
         │                            Fallback: Extract  │
         │                            Text from PDF     │
         │                                            │   │
         │                                            ▼   │
         │                            Parse Text with   │
         │                            Regex (Heuristics)│
         │                                            │   │
         │                                            ▼   │
         │                            Store as PARTIAL  │
         │                                            │   │
         │                                           ⚠️   │
         │                                                │
         └────────────────────────────────────────────────┘
                         │
                         ▼
                 Candidate Record
                 ================
                 {
                   fullName: "John Doe",
                   email: "john@example.com",
                   phone: "555-0123",
                   jobTitle: "Software Engineer",
                   company: "Tech Corp",
                   skills: "JavaScript, Python, Node.js",
                   experience: "5 Years",
                   location: "San Francisco, CA, USA",
                   linkedinUrl: "https://...",
                   
                   sourceFile: "Resumes 2/John_Doe.pdf",
                   uploadJobId: "...",
                   parseStatus: "PARSED" | "PARTIAL",
                   createdAt: "2026-02-28T..."
                 }
                 
                 In Database ✅
                 In Search Results ✅
```

---

## Concurrency & Performance

### How Concurrency Works

```
With RESUME_PARSE_CONCURRENCY=1 (Sequential):
═════════════════════════════════════════════
Time    Processing
────    ──────────
0:00    File 1 [████████] 
0:03    File 2 [████████]
0:06    File 3 [████████]
...
2:24    File 4200 [████████]
────────────────────────────
Total:  2 hours 24 minutes (4200 × 2 sec)


With RESUME_PARSE_CONCURRENCY=3 (Parallel):
════════════════════════════════════════════
Time    Processing
────    ──────────────────────────────
0:00    File 1 [████] File 2 [████████] File 3 [████]
0:02    File 4 [████████] File 5 [████] File 6 [...]
0:04    ...
0:48    [Last batch completes]
────────────────────────────────────────────────────
Total:  48 minutes (4200 ÷ 3 ≈ 1400 batches × 2 sec)
```

### Memory Impact

```
Concurrency 1 (Sequential):
├─ Memory per file: 5-20 MB
├─ Max concurrent: 1 file
└─ Peak memory: ~30-40 MB ✅ (Safe)

Concurrency 3:
├─ Memory per file: 5-20 MB
├─ Max concurrent: 3 files
└─ Peak memory: ~90-120 MB ✅ (Safe)

Concurrency 5:
├─ Memory per file: 5-20 MB
├─ Max concurrent: 5 files
└─ Peak memory: ~150-200 MB ⚠️ (Monitor closely)

Concurrency 10+:
└─ Peak memory: > 300 MB ❌ (Likely to crash on Render)
```

---

## Common Issues & Solutions

### Issue 1: Status Endpoint Returns HTTP 502

**Root Causes:**
1. Backend crashed or restarting
2. MongoDB connection timeout
3. Query taking too long

**Diagnostics:**
```bash
# Check if backend is running:
curl https://api.stucrow.com/api/candidates/health

# Check backend logs:
# (If using Render) Check monitoring tab
# (If SSH) tail -f logs/app.log
```

**Solutions:**
- ✅ Wait 30 seconds, try again
- ✅ Restart backend
- ✅ Increase `REPLICA_COUNT` in .env

### Issue 2: Parsing Shows "PROCESSING" for > 2 hours

**Root Causes:**
1. RChilli API rate limiting
2. Backend crashed mid-processing
3. MongoDB write bottleneck
4. Concurrency set too high

**Diagnostics:**
```bash
# Check how many resumes were actually processed:
# In MongoDB:
db.uploadjobs.findOne({ _id: ObjectId("699e10cc32c762de91fdff1b") }, {
  successRows, failedRows, totalRows, status
})

# Expected: successRows + failedRows = totalRows (mostly)
# If stuck: successRows stays same for > 5 minutes
```

**Solutions:**
```bash
# Option A: Force restart from current progress
POST /api/candidates/:jobId/resume
{ "forceReparse": false }

# Option B: Lower concurrency and restart
# Edit .env:
RESUME_PARSE_CONCURRENCY=1
# Restart backend and resume job

# Option C: Check RChilli account status
# (Rate limits, quota, API key validity)
```

### Issue 3: Most Resumes Fail to Parse

**Symptoms:**
```javascript
failureReasons: {
  RCHILLI_PARSE_FAILED: 3500,  // 85% failure rate!
  TEXT_EXTRACTION_FAILED: 500
}
```

**Root Causes:**
1. Invalid RChilli API key
2. RChilli account has no credits
3. RChilli API is down
4. Resumes are scanned images (need OCR)

**Diagnostics:**
```bash
# Test RChilli API manually:
curl -X POST https://rest.rchilli.com/RChilliParser/Rchilli/parseResumeBinary \\
  -F "userkey=YOUR_KEY" \\
  -F "version=8.0.0" \\
  -F "file=@resume.pdf"

# If this fails, RChilli is the problem
```

**Solutions:**
1. ✅ Verify `RCHILLI_USER_KEY` in `.env`
2. ✅ Check RChilli account at rchilli.com dashboard
3. ✅ Confirm API key in `.env` is exact match
4. ✅ Test with single resume first

### Issue 4: Frontend Shows CORS Error

**Symptoms:**
```
Access to XMLHttpRequest at 'https://api.stucrow.com/...' 
from origin 'https://app.stucrow.com' has been blocked by CORS policy
```

**Root Causes:**
1. Backend not setting CORS headers
2. Proxy/nginx not forwarding headers
3. Backend crashed, proxy returning error

**Diagnostics:**
```bash
# Check if CORS headers are being set:
curl -I https://api.stucrow.com/api/candidates/job/xxx/status

# Look for:
# Access-Control-Allow-Origin: *
# Access-Control-Allow-Credentials: true
```

**Solutions:**
✅ Already fixed! The new status endpoint sets CORS headers explicitly.
- If still seeing errors, restart backend
- Check nginx/proxy configuration

---

## Monitoring Strategy

### Quick Health Check (Every 5 minutes)

```bash
# 1. Backend is responsive
curl -s https://api.stucrow.com/api/candidates/health | grep OK

# 2. Job has progressed
curl -s -H "Auth: Bearer TOKEN" \
  https://api.stucrow.com/api/candidates/job/699e10cc32c762de91fdff1b/status \
  | grep successRows
```

### Detailed Monitoring (Every 30 minutes)

```bash
# 1. Check database progress
# (Via MongoDB Atlas or SSH)
db.uploadjobs.findOne({ _id: ObjectId("...") }, {
  status, totalRows, successRows, failedRows
})

# 2. Check for new failures
db.uploadjobs.findOne({ _id: ObjectId("...") }, {
  failureReasonSample
})

# 3. Sample parsed candidate
db.candidates.findOne({ 
  uploadJobId: ObjectId("...")
}, {
  fullName, email, parseStatus
})
```

### Automated Alerts

```javascript
// Add to monitoring script
setInterval(async () => {
  const job = await fetch("/api/candidates/job/:id/status").then(r => r.json());
  
  // Alert if stuck
  if (job.status === "PROCESSING" && job.progress < 50) {
    console.warn("⚠️ Job slower than expected!");
  }
  
  // Alert if failing
  if (job.failedRows > job.successRows) {
    console.error("❌ More failures than successes!");
  }
  
  // Success
  if (job.status === "COMPLETED") {
    console.log("✅ Job finished!");
  }
}, 300000); // Every 5 minutes
```

---

## Production Readiness Checklist

- [ ] RChilli API key verified and working
- [ ] Concurrency set to safe level (1-3)
- [ ] MongoDB has sufficient storage (> 2 GB free)
- [ ] Redis configured (if using queue-based processing)
- [ ] Backend logs being monitored
- [ ] Alerting setup for failures
- [ ] Test run with small folder (10-100 files) first
- [ ] Full folder processing time estimated
- [ ] Failure handling strategy documented
- [ ] Recovery procedure tested

---

## Quick Reference Commands

```bash
# Trigger resume folder parsing
curl -X POST https://api.stucrow.com/api/candidates/process-folder \\
  -H "Authorization: Bearer TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"folderPath": "Resumes 2/", "forceReparse": false}'

# Check job status
curl https://api.stucrow.com/api/candidates/job/:jobId/status \\
  -H "Authorization: Bearer TOKEN"

# Restart stuck job
curl -X POST https://api.stucrow.com/api/candidates/:jobId/resume \\
  -H "Authorization: Bearer TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"forceReparse": false}'

# Pause job
curl -X POST https://api.stucrow.com/api/candidates/:jobId/pause \\
  -H "Authorization: Bearer TOKEN"

# Count parsed resumes (MongoDB)
db.candidates.countDocuments({ 
  uploadJobId: ObjectId("..."),
  parseStatus: "PARSED"
})

# Check failures (MongoDB)
db.uploadjobs.findOne({ _id: ObjectId("...") }, {
  failureReasons, failureReasonSample
})
```

---

## Support Matrix

| Issue | Severity | Time to Fix |
|-------|----------|------------|
| Status endpoint 502 | Critical | < 5 min (restart) |
| CORS errors | High | < 5 min (already fixed) |
| Parsing stuck | Medium | 10-30 min (restart + wait) |
| RChilli failures | Medium | 1-24 hours (API issue) |
| Memory exhaustion | High | 10 min (lower concurrency) |

---

## Files for Reference

- Server logs: `server/logs/app.log`
- Configuration: `.env`
- Resume storage: AWS S3 (Resumes 2/)
- Database: MongoDB Candidate + UploadJob collections
- Processing code: `server/utils/queue.js` (processFolderJob)
- API controller: `server/controllers/candidateController.js`

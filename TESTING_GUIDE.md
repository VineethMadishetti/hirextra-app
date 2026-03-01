# Testing Guide: Get Contact & AI Source Features

## Prerequisites Checklist ✅

Before testing, verify you have:

- [ ] Skrapp API Key added to `.env`
- [ ] OpenAI API Key added to `.env`
- [ ] Backend server running (`npm start` or `npm run dev`)
- [ ] MongoDB database connected
- [ ] Frontend running (`npm run dev` in client folder)
- [ ] User logged in with ADMIN or USER role
- [ ] Some candidates already in database (for Get Contact testing)

---

## Part 1: Testing "Get Contact" Feature

### Prerequisite: Add Test Candidates to Database

First, you need candidates in your database to test enrichment.

**Option A: Via File Upload (Recommended)**
1. Go to **Admin Dashboard** → **Upload & Map**
2. Upload the `Apollo-per_50_rows.csv` file (tab-separated)
3. Map fields:
   - `person_name` → Full Name
   - `person_email` → Email
   - `person_phone` → Phone
   - `person_linkedin_url` → LinkedIn URL
   - `person_title` → Job Title
   - `person_location_city` → Locality
4. Click **"Process File"** → Wait for completion
5. Should import ~45-50 candidates

**Option B: Via Database Insert**
```javascript
// In MongoDB compass or terminal:
db.candidates.insertOne({
  fullName: "Test Candidate",
  email: "test@example.com",
  linkedinUrl: "https://linkedin.com/in/test-user",
  company: "Test Company",
  jobTitle: "Senior Engineer",
  location: "San Francisco, CA",
  country: "United States",
  createdAt: new Date()
})
```

---

### Step 1: Navigate to Search Page

1. Login to application
2. Click **"Search People"** in navigation
3. Search for any candidate by name or filters
4. Click a candidate row to view details

### Step 2: Click "Get Contact" Button

1. In the candidate row or detail view, find the **"Get Contact"** button
2. Click it
3. Button should show: **"Finding..."** (loading state)

### Step 3: Expected Results

**Success Cases (Email/Phone Found):**
```
✅ Email: john.doe@company.com
✅ Phone: +1 (555) 123-4567
✅ Source: Skrapp (or PDL/Lusha)
✅ Confidence: 95%
```

**Loading State:**
```
⏳ Finding... (2-10 seconds depending on API response)
```

**Failure Cases:**
```
❌ No contact found
⚠️ Retry [button] - if enrichment fails
```

---

### Debugging "Get Contact" Issues

| Issue | Solution |
|-------|----------|
| **Button shows "Retry"** | API key may be invalid, check `/server/.env` for `SKRAPP_API_KEY` |
| **Takes >15 seconds** | API might be slow, normal behavior, check rate limits |
| **"No contact found"** | That's OK! Not all candidates have public contact info |
| **CORS error in console** | Backend not running, start with `npm start` |

---

## Part 2: Testing "AI Source" Feature

### Step 1: Open AI Source Modal

**For Admin:**
1. Click **"AI Source"** button in top navigation (Admin Dashboard)
2. Modal opens: "🤖 AI Candidate Sourcing"

**For Regular User:**
1. Click **"AI Source Candidates"** button in top right
2. Same modal opens

### Step 2: Enter Job Description

In the modal's textarea, paste a job description:

```
Senior Full-Stack Engineer (React + Node.js)

Location: San Francisco, CA (Remote OK)
Experience: 5+ years
Salary: $150-200k

Requirements:
- Expert in React.js and Node.js
- AWS/Cloud infrastructure knowledge
- SQL & NoSQL databases
- CI/CD pipelines (GitHub Actions, Jenkins)
- Team leadership experience

Nice to Have:
- Open source contributions
- Machine Learning basics
- Kubernetes experience
```

**Requirements:**
- Minimum 20 characters
- Should be realistic job description
- Clearer = better results

### Step 3: Click "Source Candidates"

1. Button changes to **"Sourcing..."** (loading)
2. Progress shows on screen
3. Takes **2-5 minutes** (normal duration)

### Expected Processing Steps

```
📋 Parsing job description...  (10-20 sec with OpenAI)
🔍 Generating search queries... (5 sec)
🌍 Determining target countries... (2 sec)
🔎 Searching for candidates...  (30-60 sec per country)
📊 Extracting candidates... (30 sec)
💎 Enriching contacts... (30-60 sec)
✅ Complete!
```

### Step 4: Review Results

Once complete, you'll see:

```
📊 Results: 30-50 candidates found

For each candidate:
├── Name: John Doe
├── Title: Senior Engineer
├── Company: TechCorp Inc.
├── LinkedIn: linkedin.com/in/jdoe
├── Email: john@techcorp.com (with source badge)
├── Phone: +1 (555) 123-4567
├── Match Score: 92%
├── Snippet: "Senior Software Engineer at TechCorp..."
└── [Save to DB] [Open LinkedIn] buttons
```

---

### Step 5: Save Candidates to Database

1. Click **"Save"** button next to any candidate
2. Button shows **"Saving..."** then **checkmark** ✓
3. Candidate saved to your database

### Step 6: Export as CSV

1. Click **"Export as CSV"** button
2. Downloads file: `sourced-candidates-2026-02-28.csv`
3. Contains all sourced candidates with contact info

---

## Debugging "AI Source" Issues

| Issue | Solution |
|-------|-----------|
| **"Job description too short"** | Minimum 20 characters, try more detailed description |
| **Takes >5 minutes** | Normal for large searches, check browser console for errors |
| **"Failed to parse job description"** | OpenAI API key may be invalid, check `/server/.env` for `OPENAI_API_KEY` |
| **No candidates found** | Job description too obscure, try more common skills/roles |
| **"Failed to source candidates"** | Google CSE might be rate limited, try again in 1 hour |
| **Button shows "Retry"** | API error occurred, check backend logs |

---

## Step-by-Step Testing Workflow

### Complete Test Flow (15-20 minutes)

**Phase 1: Data Setup (5 min)**
1. ✅ Verify candidates in database
2. ✅ Or upload Apollo CSV file

**Phase 2: Test Get Contact (3 min)**
1. ✅ Open Search page
2. ✅ Search for any candidate
3. ✅ Click "Get Contact"
4. ✅ Verify email/phone appears

**Phase 3: Test AI Source (10 min)**
1. ✅ Open AI Source modal
2. ✅ Paste job description
3. ✅ Click "Source Candidates"
4. ✅ Wait for results (2-5 min)
5. ✅ Review candidates list
6. ✅ Save 2-3 candidates
7. ✅ Export as CSV

---

## API Key Verification

### Check if Keys Are Loaded

**In Browser Console:**
```javascript
// This will NOT show keys (for security), but will indicate if system is working
fetch('/api/ai-source', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jobDescription: "Test engineer role",
    maxCandidates: 10
  })
})
.then(r => r.json())
.then(d => console.log(d))
```

**In Backend Logs:**
```bash
# Look for these messages when testing:
✅ OpenAI API initialized
✅ Skrapp API initialized
🔍 Starting AI sourcing...
📋 Parsing job description...
```

---

## Expected API Costs

### Per Test

| Component | Test 1 | Test 2 | Test 3 |
|-----------|--------|--------|--------|
| OpenAI (JD parse) | $0.01 | $0.01 | $0.01 |
| Google CSE (search) | FREE (100/day) | FREE | FREE |
| Skrapp (30 contacts) | $15-30 | - | - |
| **Total per sourcing** | **$15-31** | - | - |
| **Get Contact per person** | - | $1-2 | $1-2 |

**First Month Budget:**
- Testing Get Contact: 5 people × $1.50 = **$7.50**
- Testing AI Source: 3 rounds × $25 = **$75**
- **Total: ~$82.50 for thorough testing**

---

## Quick Sanity Check

Run these commands to verify setup:

### 1. Check Backend Is Running
```bash
curl http://localhost:5000/candidates/search -H "Authorization: Bearer YOUR_TOKEN"
```

### 2. Check Environment Variables
```bash
# In server folder:
cat .env | grep -E "SKRAPP|OPENAI"
```

Should show:
```
SKRAPP_API_KEY=sk_live_xxx
OPENAI_API_KEY=sk-xxx
```

### 3. Check MongoDB Connection
```bash
mongosh
use hirextra
db.candidates.countDocuments()  # Should show count > 0
```

---

## Troubleshooting Checklist

### "Get Contact" Not Working
- [ ] Skrapp API key is valid (test on Skrapp dashboard)
- [ ] Backend server is running
- [ ] Candidate has LinkedIn URL in database
- [ ] Check browser console for errors
- [ ] Check backend logs for API errors

### "AI Source" Not Working
- [ ] OpenAI API key is valid (check credits at openai.com)
- [ ] Google CSE is enabled (check Google Cloud Console)
- [ ] Job description is >20 characters
- [ ] Backend server is running
- [ ] Check browser console for errors
- [ ] Check backend logs for timeout errors

### Both Features Show Errors
- [ ] Restart backend: `npm start`
- [ ] Restart frontend: `npm run dev`
- [ ] Clear browser cache (Ctrl+Shift+Delete)
- [ ] Check `.env` file for syntax errors
- [ ] Verify MongoDB is running

---

## Success Indicators ✅

### Get Contact Working
- [x] Button changes to "Finding..." immediately
- [x] After 3-10 seconds, shows email and source
- [x] Results cached for 30 days
- [x] Can click email to compose new message
- [x] Can click phone to call/text

### AI Source Working
- [x] Modal opens smoothly
- [x] "Source Candidates" button enables after description
- [x] Processing shows progress steps
- [x] Results appear after 2-5 minutes
- [x] Can save candidates to database
- [x] Can export as CSV with email/phone

---

## Next Steps After Testing

If everything works:

1. **Deploy to Production:**
   - Push to GitHub
   - Deploy backend to Render
   - Deploy frontend to Vercel

2. **Monitor Costs:**
   - Set up billing alerts on OpenAI & Skrapp
   - Track API usage in respective dashboards

3. **Optimize for Users:**
   - Train team on feature usage
   - Set up API quotas if needed
   - Configure rate limits

4. **Gather Feedback:**
   - Test with actual recruiters
   - Note missing features
   - Iterate based on feedback



Also When User enters his requirements in Search People page - AI Search input box, Our Application should be able to gather requirements from that text and give to our filters automatically with atmost precesion
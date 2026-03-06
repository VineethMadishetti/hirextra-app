/**
 * PDL (People Data Labs) JSONL Bulk Importer
 *
 * Usage:
 *   node server/scripts/importPDL.js /path/to/pdl-file.json
 *
 * Optional flags:
 *   --batch=500        Records per MongoDB bulkWrite (default: 1000)
 *   --mongo=<uri>      Override MONGO_URI env var
 *   --dry-run          Parse and map only, skip DB writes (test mode)
 *
 * Example:
 *   node server/scripts/importPDL.js /data/pdl.json --batch=500
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Load .env if present
try {
  const dotenv = require('dotenv');
  const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
} catch (_) {}

// ─── Parse CLI args ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const filePath = args.find((a) => !a.startsWith('--'));
const batchArg = args.find((a) => a.startsWith('--batch='));
const mongoArg = args.find((a) => a.startsWith('--mongo='));
const dryRun = args.includes('--dry-run');
const BATCH_SIZE = batchArg ? parseInt(batchArg.split('=')[1], 10) : 1000;
const MONGO_URI = mongoArg
  ? mongoArg.split('=').slice(1).join('=')
  : process.env.MONGO_URI || process.env.MONGODB_URI;

if (!filePath) {
  console.error('❌  Usage: node server/scripts/importPDL.js /path/to/pdl-file.json');
  process.exit(1);
}
if (!fs.existsSync(filePath)) {
  console.error(`❌  File not found: ${filePath}`);
  process.exit(1);
}
if (!MONGO_URI && !dryRun) {
  console.error('❌  MONGO_URI not set. Pass --mongo=<uri> or set MONGO_URI in .env');
  process.exit(1);
}

// ─── Mongoose Candidate schema (minimal, matches existing model) ──────────────

const candidateSchema = new mongoose.Schema(
  {
    fullName: String,
    jobTitle: String,
    skills: String,
    experience: String,
    country: String,
    locality: String,
    location: String,
    email: String,
    phone: String,
    company: String,
    industry: String,
    education: String,
    linkedinUrl: String,
    source: { type: String, default: 'UPLOAD' },
    enrichmentStatus: { type: String, default: 'NEW' },
    pipelineStage: { type: String, default: 'DISCOVERED' },
    sequenceStatus: { type: String, default: 'NOT_STARTED' },
    callStatus: { type: String, default: 'NOT_SCHEDULED' },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'candidates' }
);

let Candidate;

// ─── Field mapper ─────────────────────────────────────────────────────────────

/**
 * Extract country from PDL address string.
 * "humble, texas, united states" → "united states"
 * "egypt" → "egypt"
 */
function extractCountry(address) {
  if (!address) return '';
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : '';
}

/**
 * Extract city/locality from PDL address string.
 * "humble, texas, united states" → "humble"
 * "egypt" → ""
 */
function extractLocality(address) {
  if (!address) return '';
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts[0] : '';
}

/**
 * Convert a PDL JSONL record to a Candidate document.
 * PDL fields: n (name), a (address), e (emails[]), t (phones[]), linkedin (url), liid (slug)
 */
function mapRecord(raw) {
  const name = String(raw.n || '').trim();
  if (!name || name.split(' ').length < 2) return null; // skip no-name / single-word

  const linkedinUrl = String(raw.linkedin || '').trim();
  if (!linkedinUrl || !linkedinUrl.includes('linkedin.com/in/')) return null; // must have valid LinkedIn

  const address = String(raw.a || '').toLowerCase().trim();
  const email = Array.isArray(raw.e) ? (raw.e[0] || '') : String(raw.e || '');
  const phone = Array.isArray(raw.t) ? (raw.t[0] || '') : String(raw.t || '');
  const country = extractCountry(address);
  const locality = extractLocality(address);

  const hasContact = !!(email || phone);

  return {
    fullName: name
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' '),
    location: address,
    locality,
    country,
    email: email || undefined,
    phone: phone || undefined,
    linkedinUrl,
    source: 'UPLOAD',
    enrichmentStatus: hasContact ? 'ENRICHED' : 'NEW',
    pipelineStage: hasContact ? 'CONTACT_ENRICHED' : 'DISCOVERED',
    sequenceStatus: 'NOT_STARTED',
    callStatus: 'NOT_SCHEDULED',
    isDeleted: false,
  };
}

// ─── Bulk upsert ──────────────────────────────────────────────────────────────

async function flushBatch(batch) {
  if (batch.length === 0) return { upserted: 0, modified: 0, errors: 0 };

  const ops = batch.map((doc) => ({
    updateOne: {
      filter: { linkedinUrl: doc.linkedinUrl },
      update: { $setOnInsert: doc },
      upsert: true,
    },
  }));

  try {
    const result = await Candidate.bulkWrite(ops, { ordered: false });
    return {
      upserted: result.upsertedCount || 0,
      modified: result.modifiedCount || 0,
      errors: 0,
    };
  } catch (err) {
    // BulkWriteError can be partial — extract what succeeded
    if (err.result) {
      return {
        upserted: err.result.upsertedCount || 0,
        modified: err.result.modifiedCount || 0,
        errors: (err.writeErrors || []).length,
      };
    }
    console.error('  bulkWrite error:', err.message);
    return { upserted: 0, modified: 0, errors: batch.length };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('══════════════════════════════════════════════');
  console.log('  PDL JSONL Importer');
  console.log('══════════════════════════════════════════════');
  console.log(`  File     : ${filePath}`);
  console.log(`  Batch    : ${BATCH_SIZE}`);
  console.log(`  Dry run  : ${dryRun}`);
  console.log('══════════════════════════════════════════════');
  console.log('');

  // Connect to MongoDB
  if (!dryRun) {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 15000 });
    Candidate = mongoose.model('Candidate', candidateSchema);
    console.log('✅ Connected\n');
  }

  const fileSize = fs.statSync(filePath).size;
  const fileSizeGB = (fileSize / 1e9).toFixed(2);

  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let lineNum = 0;
  let skipped = 0;
  let totalUpserted = 0;
  let totalModified = 0;
  let totalErrors = 0;
  let batch = [];
  const startTime = Date.now();

  const LOG_EVERY = 100_000;

  function printProgress() {
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = Math.round(lineNum / elapsed);
    const eta = rate > 0 ? Math.round((fileSize / (fileStream.bytesRead || 1)) * elapsed - elapsed) : '?';
    const etaMin = typeof eta === 'number' ? `${Math.floor(eta / 60)}m ${eta % 60}s` : '?';
    console.log(
      `  Lines: ${lineNum.toLocaleString()}  |  New: ${totalUpserted.toLocaleString()}  |  Skip: ${skipped.toLocaleString()}  |  Err: ${totalErrors}  |  Rate: ${rate.toLocaleString()}/s  |  ETA: ${etaMin}`
    );
  }

  // Graceful shutdown on Ctrl+C
  let shuttingDown = false;
  process.on('SIGINT', async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n⚠️  Interrupted — flushing remaining batch...');
    if (!dryRun && batch.length > 0) {
      const r = await flushBatch(batch);
      totalUpserted += r.upserted;
      totalErrors += r.errors;
    }
    printProgress();
    if (!dryRun) await mongoose.disconnect();
    process.exit(0);
  });

  for await (const line of rl) {
    if (shuttingDown) break;

    lineNum++;
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Parse JSON
    let raw;
    try {
      raw = JSON.parse(trimmed);
    } catch (_) {
      skipped++;
      continue;
    }

    // Map to candidate
    const doc = mapRecord(raw);
    if (!doc) {
      skipped++;
      continue;
    }

    batch.push(doc);

    // Flush batch when full
    if (batch.length >= BATCH_SIZE) {
      if (!dryRun) {
        const r = await flushBatch(batch);
        totalUpserted += r.upserted;
        totalModified += r.modified;
        totalErrors += r.errors;
      }
      batch = [];
    }

    // Progress log
    if (lineNum % LOG_EVERY === 0) {
      printProgress();
    }
  }

  // Flush remaining
  if (!dryRun && batch.length > 0) {
    const r = await flushBatch(batch);
    totalUpserted += r.upserted;
    totalModified += r.modified;
    totalErrors += r.errors;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('');
  console.log('══════════════════════════════════════════════');
  console.log('  Import Complete');
  console.log('══════════════════════════════════════════════');
  console.log(`  File size    : ${fileSizeGB} GB`);
  console.log(`  Lines read   : ${lineNum.toLocaleString()}`);
  console.log(`  Skipped      : ${skipped.toLocaleString()}  (no name / no LinkedIn)`);
  console.log(`  Inserted new : ${totalUpserted.toLocaleString()}`);
  console.log(`  Already exist: ${totalModified.toLocaleString()}`);
  console.log(`  Errors       : ${totalErrors}`);
  console.log(`  Time         : ${elapsed}s`);
  console.log('══════════════════════════════════════════════');

  if (!dryRun) await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});

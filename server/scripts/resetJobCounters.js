/**
 * resetJobCounters.js
 *
 * Usage:
 *   node --env-file=../.env scripts/resetJobCounters.js <uploadJobId>
 *
 * What it does:
 *   1. Counts actual Candidate documents in MongoDB for the given uploadJobId
 *   2. Prints current UploadJob counters vs real DB count
 *   3. Asks for confirmation, then updates:
 *        successRows = actual DB count
 *        totalRows   = actual DB count   (so worker resumes from the right spot)
 *        failedRows  = unchanged (kept as-is)
 *        status      = PROCESSING        (ensures worker picks it up)
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import readline from 'readline';

// ── Models (inline schemas so the script is self-contained) ──────────────────

const uploadJobSchema = new mongoose.Schema({
  fileName: String,
  originalName: String,
  status: String,
  totalRows: { type: Number, default: 0 },
  successRows: { type: Number, default: 0 },
  failedRows: { type: Number, default: 0 },
}, { timestamps: true });

const UploadJob = mongoose.model('UploadJob', uploadJobSchema);

const candidateSchema = new mongoose.Schema({
  uploadJobId: mongoose.Schema.Types.ObjectId,
}, { strict: false });

const Candidate = mongoose.model('Candidate', candidateSchema);

// ── Helpers ──────────────────────────────────────────────────────────────────

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error('Usage: node scripts/resetJobCounters.js <uploadJobId>');
    process.exit(1);
  }

  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('MONGO_URI / MONGODB_URI not set. Make sure .env is loaded.');
    process.exit(1);
  }

  console.log('Connecting to MongoDB…');
  await mongoose.connect(mongoUri);
  console.log('Connected.\n');

  // 1. Fetch the UploadJob document
  const job = await UploadJob.findById(jobId);
  if (!job) {
    console.error(`UploadJob ${jobId} not found.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log('Current UploadJob state:');
  console.log(`  fileName    : ${job.originalName || job.fileName}`);
  console.log(`  status      : ${job.status}`);
  console.log(`  totalRows   : ${job.totalRows.toLocaleString()}`);
  console.log(`  successRows : ${job.successRows.toLocaleString()}`);
  console.log(`  failedRows  : ${job.failedRows.toLocaleString()}`);
  console.log('');

  // 2. Count real candidates in DB
  console.log('Counting actual Candidate documents (this may take a moment)…');
  const actualCount = await Candidate.countDocuments({ uploadJobId: new mongoose.Types.ObjectId(jobId) });
  console.log(`  Actual candidates in DB: ${actualCount.toLocaleString()}\n`);

  if (actualCount === job.successRows) {
    console.log('✅ Counters already match the DB. No reset needed.');
    await mongoose.disconnect();
    return;
  }

  // 3. Confirm before writing
  console.log('Proposed changes:');
  console.log(`  successRows : ${job.successRows.toLocaleString()} → ${actualCount.toLocaleString()}`);
  console.log(`  totalRows   : ${job.totalRows.toLocaleString()} → ${actualCount.toLocaleString()}`);
  console.log(`  status      : ${job.status} → PROCESSING`);
  console.log('  failedRows  : unchanged');
  console.log('');

  const answer = await ask('Apply these changes? (yes/no): ');
  if (answer.trim().toLowerCase() !== 'yes') {
    console.log('Aborted. No changes made.');
    await mongoose.disconnect();
    return;
  }

  // 4. Apply the reset
  await UploadJob.findByIdAndUpdate(jobId, {
    successRows: actualCount,
    totalRows: actualCount,
    status: 'PROCESSING',
  });

  console.log('\n✅ UploadJob counters reset successfully.');
  console.log('   Restart the worker — it will now resume from line', actualCount.toLocaleString(), 'instead of', job.totalRows.toLocaleString());

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Error:', err);
  mongoose.disconnect().finally(() => process.exit(1));
});

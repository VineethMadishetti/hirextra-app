import mongoose from 'mongoose';

const importEventSchema = new mongoose.Schema({
	jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'UploadJob', index: true },
	folderId: String,
	folderPath: String,
	eventType: {
		type: String,
		enum: [
			'IMPORT_STARTED',
			'JOB_CREATED',
			'BATCH_STARTED',
			'BATCH_COMPLETED',
			'PARSE_SUCCESS',
			'PARSE_FAILED',
			'RCHILLI_CREDIT_LOW',
			'RCHILLI_CREDITS_EXHAUSTED',
			'IMPORT_PAUSED',
			'IMPORT_RESUMED',
			'IMPORT_COMPLETED',
			'IMPORT_FAILED',
			'SKIP_EXISTING',
			'DUPLICATE_DETECTED',
			'ERROR'
		],
		index: true
	},
	details: {
		message: String,
		errorCode: String,
		rchilliStatus: String,
		creditsRemaining: Number,
		resumesProcessed: Number,
		resumeFailed: Number,
		retryCount: Number,
		nextRetryAt: Date
	},
	severity: {
		type: String,
		enum: ['INFO', 'WARNING', 'ERROR', 'CRITICAL'],
		default: 'INFO'
	},
	createdAt: { type: Date, default: Date.now, expires: 2592000 }, // Auto-delete after 30 days
	updatedAt: { type: Date, default: Date.now }
}, { collection: 'importEvents' });

// Create index for quick lookup of recent errors for specific job
importEventSchema.index({ jobId: 1, createdAt: -1 });
importEventSchema.index({ eventType: 1, createdAt: -1 });

export default mongoose.model('ImportEvent', importEventSchema);

import axios from 'axios';

const RCHILLI_API_KEY = process.env.RCHILLI_API_KEY;
const RCHILLI_API_URL = 'https://api.rchilli.com/api/v2/ResumeParsing';

/**
 * RChilli Resume Parsing Service
 * Handles credit management, parsing, and error recovery
 */

// Cache for credit status (10 minute TTL)
let creditCache = {
	lastChecked: null,
	expiresAt: null,
	credits: null,
	error: null
};

/**
 * Check RChilli account credit balance
 */
export const checkRChilliCredits = async () => {
	try {
		// Return cached if still valid
		if (creditCache.expiresAt && Date.now() < creditCache.expiresAt) {
			return {
				status: 'cached',
				credits: creditCache.credits,
				lastChecked: creditCache.lastChecked
			};
		}

		// Call RChilli API to get account info
		const response = await axios.get(
			`${RCHILLI_API_URL}?api_key=${RCHILLI_API_KEY}&detail=1`,
			{ timeout: 5000 }
		);

		if (response.data && response.data.data) {
			const credits = response.data.data.totalCredits || 0;
			const usedCredits = response.data.data.usedCredits || 0;
			const remainingCredits = credits - usedCredits;

			// Update cache
			creditCache = {
				lastChecked: new Date(),
				expiresAt: Date.now() + 10 * 60 * 1000, // 10 minute TTL
				credits: {
					total: credits,
					used: usedCredits,
					remaining: remainingCredits,
					percentage: credits > 0 ? Math.round((remainingCredits / credits) * 100) : 0
				},
				error: null
			};

			return {
				status: 'success',
				...creditCache.credits
			};
		}

		throw new Error('Invalid RChilli response format');
	} catch (error) {
		console.error('[RChilli] Credit check failed:', error.message);
		
		// Cache error for 5 minutes
		creditCache = {
			lastChecked: new Date(),
			expiresAt: Date.now() + 5 * 60 * 1000,
			credits: null,
			error: error.message
		};

		return {
			status: 'error',
			error: error.message,
			message: 'Unable to check RChilli credits. Please check your API key and network connection.'
		};
	}
};

/**
 * Check if enough credits available for batch import
 */
export const hasEnoughCredits = async (estimatedResumes, minRequiredCredits = 100) => {
	try {
		const creditInfo = await checkRChilliCredits();

		if (creditInfo.status === 'error') {
			return {
				sufficient: false,
				reason: `Cannot verify credits: ${creditInfo.error}`,
				recommendAction: 'Retry after network is stable'
			};
		}

		const remaining = creditInfo.remaining || 0;
		const estimated = estimatedResumes || 1;

		// RChilli typically uses 1 credit per resume parse
		// Add 10% buffer for retries
		const requiredCredits = Math.ceil(estimated * 1.1);

		if (remaining < minRequiredCredits) {
			return {
				sufficient: false,
				remaining,
				required: minRequiredCredits,
				estimated: requiredCredits,
				reason: `Insufficient RChilli credits: ${remaining} remaining, need at least ${minRequiredCredits}`,
				recommendAction: 'Please charge RChilli account before importing'
			};
		}

		if (remaining < requiredCredits) {
			return {
				sufficient: false,
				remaining,
				estimated: requiredCredits,
				reason: `Not enough credits for full batch: ${remaining} remaining, estimated ${requiredCredits} needed for ${estimated} resumes`,
				recommendAction: 'Import in smaller batches or charge account',
				canContinuePartially: true,
				estimatedProcessable: Math.floor(remaining / 1.1)
			};
		}

		return {
			sufficient: true,
			remaining,
			estimated: requiredCredits,
			message: `Sufficient credits available (${remaining} remaining for ~${estimated} resumes)`
		};
	} catch (error) {
		console.error('[RChilli] Credit validation failed:', error.message);
		return {
			sufficient: false,
			reason: 'Error checking credits',
			error: error.message,
			recommendAction: 'Try again in a moment'
		};
	}
};

/**
 * Log RChilli parsing attempt with credit tracking
 */
export const logRChilliAttempt = async (jobId, fileName, resultStatus) => {
	try {
		// This can be stored in a RChilliLog model later
		console.log(`[RChilli] Job ${jobId} | File: ${fileName} | Status: ${resultStatus}`);
		
		// Update cache if we know status
		if (resultStatus === 'insufficient_credits') {
			creditCache.expiresAt = 0; // Invalidate cache
		}
	} catch (error) {
		console.error('[RChilli] Failed to log attempt:', error.message);
	}
};

/**
 * Format credit info for UI display
 */
export const formatCreditInfo = (creditData) => {
	if (!creditData || creditData.status === 'error') {
		return {
			display: '⚠️ Credits: Unknown',
			tooltip: creditData?.error || 'Unable to check credit balance',
			status: 'error',
			safeToImport: false
		};
	}

	const { remaining, total, percentage } = creditData;
	
	if (percentage < 10) {
		return {
			display: `🔴 Credits: ${remaining}/${total} (${percentage}%)`,
			tooltip: 'Low credits - may not complete large imports',
			status: 'critical',
			safeToImport: remaining > 50
		};
	} else if (percentage < 30) {
		return {
			display: `🟡 Credits: ${remaining}/${total} (${percentage}%)`,
			tooltip: 'Credits running low',
			status: 'warning',
			safeToImport: true
		};
	}

	return {
		display: `🟢 Credits: ${remaining}/${total} (${percentage}%)`,
		tooltip: 'Credits available',
		status: 'ok',
		safeToImport: true
	};
};

/**
 * Clear credit cache (useful after recharge)
 */
export const clearCreditCache = () => {
	creditCache = {
		lastChecked: null,
		expiresAt: null,
		credits: null,
		error: null
	};
	console.log('[RChilli] Credit cache cleared');
};

export default {
	checkRChilliCredits,
	hasEnoughCredits,
	logRChilliAttempt,
	formatCreditInfo,
	clearCreditCache
};

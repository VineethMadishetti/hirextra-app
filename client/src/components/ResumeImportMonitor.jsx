import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, AlertCircle, CheckCircle, Clock, Zap, Loader } from 'lucide-react';
import api from '../api/axios';
import toast from 'react-hot-toast';

/**
 * Enhanced Resume Import Monitor Component
 * Shows RChilli credits, detailed progress, error tracking, and recovery options
 * 
 * Usage:
 * <ResumeImportMonitor jobId={jobId} onComplete={callback} />
 */
export default function ResumeImportMonitor({ jobId, onComplete, onError }) {
	const [jobDetails, setJobDetails] = useState(null);
	const [creditStatus, setCreditStatus] = useState(null);
	const [isPolling, setIsPolling] = useState(true);
	const [showDetails, setShowDetails] = useState(false);
	const [errorHistory, setErrorHistory] = useState([]);
	const pollingRef = useRef(null);

	// Initialize component
	useEffect(() => {
		if (!jobId) return;

		// Start polling immediately
		pollJobStatus();
		checkRChilliCredits();

		// Set up polling interval (2 seconds for regular updates, 5 seconds for detailed fetch)
		pollingRef.current = setInterval(() => {
			pollJobStatus();
			// Check credits less frequently (every 10 seconds)
			if (Math.random() < 0.2) {
				checkRChilliCredits();
			}
		}, 2000);

		return () => {
			if (pollingRef.current) clearInterval(pollingRef.current);
		};
	}, [jobId]);

	// Stop polling when job completes
	useEffect(() => {
		if (jobDetails?.job?.status === 'COMPLETED' || jobDetails?.job?.status === 'FAILED') {
			setIsPolling(false);
			if (pollingRef.current) clearInterval(pollingRef.current);

			if (jobDetails?.job?.status === 'COMPLETED') {
				toast.success(`✅ Import complete! ${jobDetails.job.successRows} resumes processed.`);
				onComplete?.(jobDetails);
			} else {
				toast.error(`❌ Import failed: ${jobDetails.job.error || 'Unknown error'}`);
				onError?.(jobDetails);
			}
		}
	}, [jobDetails?.job?.status]);

	const pollJobStatus = async () => {
		try {
			const { data } = await api.get(`/candidates/job/${jobId}/details`);
			setJobDetails(data);

			// Extract and track errors
			if (data.lastError) {
				setErrorHistory(prev => {
					const isDuplicate = prev.some(e => e.message === data.lastError.message);
					if (!isDuplicate) {
						return [data.lastError, ...prev].slice(0, 5); // Keep last 5 errors
					}
					return prev;
				});
			}
		} catch (error) {
			if (error.response?.status === 404) {
				console.warn('[ResumeImportMonitor] Job not found - may have been deleted');
				toast.error('Job not found. It may have been deleted.');
				onError?.({ error: 'Job not found' });
			} else {
				console.error('[ResumeImportMonitor] Poll error:', error.message);
			}
		}
	};

	const checkRChilliCredits = async () => {
		try {
			const { data } = await api.get('/candidates/rchilli/status');
			setCreditStatus(data);

			if (!data.canImport && data.creditStatus === 'critical') {
				toast.error('⚠️ RChilli credits critically low!', { id: 'credit-low' });
			}
		} catch (error) {
			console.error('[ResumeImportMonitor] Credit check error:', error.message);
		}
	};

	const handleRetry = async () => {
		// TODO: Implement retry logic with fresh RChilli check
		toast.loading('Checking RChilli credits...', { id: 'retry' });
		await checkRChilliCredits();
		toast.remove('retry');
	};

	const handlePause = async () => {
		try {
			await api.post(`/candidates/${jobId}/pause`);
			setJobDetails(prev => ({
				...prev,
				job: { ...prev.job, status: 'PAUSED' }
			}));
			toast.success('Import paused');
		} catch (error) {
			toast.error('Failed to pause import');
		}
	};

	const handleResume = async () => {
		try {
			await api.post(`/candidates/${jobId}/resume`);
			setJobDetails(prev => ({
				...prev,
				job: { ...prev.job, status: 'PROCESSING' }
			}));
			// Restart polling so the UI updates as the resumed job progresses
			setIsPolling(true);
			if (pollingRef.current) clearInterval(pollingRef.current);
			pollingRef.current = setInterval(() => {
				pollJobStatus();
				if (Math.random() < 0.2) checkRChilliCredits();
			}, 2000);
			toast.success('Import resumed — processing remaining files');
		} catch (error) {
			toast.error('Failed to resume import');
		}
	};

	if (!jobDetails) {
		return (
			<div className="p-6 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
				<div className="flex items-center gap-3">
					<Loader className="w-5 h-5 animate-spin text-indigo-600" />
					<span className="text-slate-700 dark:text-slate-300">Loading import details...</span>
				</div>
			</div>
		);
	}

	const { job, progress, lastError, recentEvents } = jobDetails;
	const isProcessing = job.status === 'PROCESSING';
	const isPaused = job.status === 'PAUSED';
	const isCompleted = job.status === 'COMPLETED';
	const isFailed = job.status === 'FAILED';

	// Color coding for status
	const statusColor = {
		PROCESSING: 'text-blue-600 dark:text-blue-400',
		PAUSED: 'text-yellow-600 dark:text-yellow-400',
		COMPLETED: 'text-green-600 dark:text-green-400',
		FAILED: 'text-red-600 dark:text-red-400'
	};

	const statusBg = {
		PROCESSING: 'bg-blue-50 dark:bg-blue-900/20',
		PAUSED: 'bg-yellow-50 dark:bg-yellow-900/20',
		COMPLETED: 'bg-green-50 dark:bg-green-900/20',
		FAILED: 'bg-red-50 dark:bg-red-900/20'
	};

	return (
		<div className="space-y-4">
			{/* Main Status Card */}
			<div className={`p-6 rounded-lg border ${statusBg[job.status]}`}>
				<div className="flex items-start justify-between mb-4">
					<div>
						<h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
							Resume Import
						</h3>
						<p className="text-sm text-slate-600 dark:text-slate-400">{job.fileName}</p>
					</div>
					<div className={`text-2xl font-bold ${statusColor[job.status]}`}>
						{isProcessing && <Loader className="w-8 h-8 animate-spin" />}
						{isCompleted && <CheckCircle className="w-8 h-8" />}
						{isFailed && <AlertCircle className="w-8 h-8" />}
						{isPaused && <Clock className="w-8 h-8" />}
					</div>
				</div>

				{/* Progress Bar */}
				<div className="mb-4">
					<div className="flex justify-between items-center mb-2">
						<span className={`text-sm font-semibold ${statusColor[job.status]}`}>
							{job.status}
						</span>
						<span className="text-sm text-slate-600 dark:text-slate-400">
							{progress.percentage}% Complete
						</span>
					</div>
					<div className="w-full h-3 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
						<div
							className={`h-full transition-all duration-500 ${
								isCompleted
									? 'bg-green-500'
									: isFailed
									? 'bg-red-500'
									: isPaused
									? 'bg-yellow-500'
									: 'bg-indigo-500'
							}`}
							style={{ width: `${progress.percentage}%` }}
						/>
					</div>
				</div>

				{/* Stats Grid */}
				<div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
					<StatBox label="Total" value={progress.total} />
					<StatBox label="Processed" value={progress.processed} color="green" />
					<StatBox label="Pending" value={progress.pending} color="yellow" />
					<StatBox label="Failed" value={job.failedRows} color="red" />
				</div>

				{/* Time Estimate */}
				{isProcessing && progress.estimatedMinutesRemaining > 0 && (
					<div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 bg-white/50 dark:bg-slate-800/50 px-3 py-2 rounded">
						<Clock className="w-4 h-4" />
						<span>Estimated time remaining: ~{progress.estimatedMinutesRemaining} minutes</span>
					</div>
				)}
			</div>

			{/* RChilli Credit Status */}
			{creditStatus && (
				<CreditStatusCard creditStatus={creditStatus} onRetry={handleRetry} />
			)}

			{/* Error Alert */}
			{lastError && (
				<div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
					<div className="flex gap-3">
						<AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
						<div>
							<h4 className="font-semibold text-red-900 dark:text-red-300 mb-1">
								{lastError.type}
							</h4>
							<p className="text-sm text-red-800 dark:text-red-400 mb-2">{lastError.message}</p>
							{lastError.credentials !== undefined && (
								<p className="text-xs text-red-700 dark:text-red-500">
									Credits at error time: {lastError.credentials}
								</p>
							)}
{isProcessing && (
								<div className="flex gap-2 mt-3">
									<button
										onClick={handlePause}
										className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-sm rounded-md transition"
									>
										Pause Import
									</button>
									<button
										onClick={handleRetry}
										className="px-3 py-1 bg-orange-600 hover:bg-orange-700 text-white text-sm rounded-md transition"
									>
										Recharge & Retry
									</button>
								</div>
							)}
						</div>
					</div>
				</div>
			)}

			{/* Action Buttons */}
			{(isProcessing || isPaused || isFailed) && (
				<div className="flex gap-2">
					{isProcessing && (
						<button
							onClick={handlePause}
							className="flex-1 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition text-sm font-medium"
						>
							Pause Import
						</button>
					)}
					{isPaused && (
						<button
							onClick={handleResume}
							className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition text-sm font-medium"
						>
							Resume Import
						</button>
					)}
					{isFailed && (
						<button
							onClick={handleResume}
							className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition text-sm font-semibold shadow-sm"
						>
							Resume from Checkpoint
						</button>
					)}
				</div>
			)}

			{/* Event Details */}
			{showDetails && (
				<div className="mt-4 p-4 bg-slate-100 dark:bg-slate-800/60 rounded-lg border border-slate-300 dark:border-slate-700">
					<h4 className="font-semibold text-slate-900 dark:text-white mb-3">Recent Events</h4>
					<div className="space-y-2 max-h-64 overflow-y-auto">
						{recentEvents.map((event, idx) => (
							<div
								key={idx}
								className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400"
							>
								<div
									className={`w-2 h-2 rounded-full ${
										event.severity === 'ERROR'
											? 'bg-red-500'
											: event.severity === 'WARNING'
											? 'bg-yellow-500'
											: 'bg-green-500'
									}`}
								/>
								<span className="flex-1">{event.message || event.type}</span>
								<span className="text-xs text-slate-500">
									{new Date(event.timestamp).toLocaleTimeString()}
								</span>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Toggle Details */}
			{recentEvents.length > 0 && (
				<button
					onClick={() => setShowDetails(!showDetails)}
					className="w-full px-4 py-2 flex items-center justify-center gap-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition text-sm"
				>
					{showDetails ? 'Hide' : 'Show'} Event Details
					<ChevronDown className={`w-4 h-4 transition-transform ${showDetails ? 'rotate-180' : ''}`} />
				</button>
			)}
		</div>
	);
}

// Helper components
function StatBox({ label, value, color = 'slate' }) {
	const colorClasses = {
		slate: 'text-slate-700 dark:text-slate-300',
		green: 'text-green-700 dark:text-green-300',
		yellow: 'text-yellow-700 dark:text-yellow-300',
		red: 'text-red-700 dark:text-red-300'
	};

	return (
		<div className="bg-white/50 dark:bg-slate-800/50 p-3 rounded-lg">
			<p className="text-xs text-slate-600 dark:text-slate-400 mb-1">{label}</p>
			<p className={`text-2xl font-bold ${colorClasses[color]}`}>{value}</p>
		</div>
	);
}

function CreditStatusCard({ creditStatus, onRetry }) {
	const { remaining, total, percentage, canImport, creditStatus: status } = creditStatus;

	const statusColor = {
		'ok': { bg: 'bg-green-50 dark:bg-green-900/20', border: 'border-green-200 dark:border-green-800', icon: '🟢' },
		'warning': { bg: 'bg-yellow-50 dark:bg-yellow-900/20', border: 'border-yellow-200 dark:border-yellow-800', icon: '🟡' },
		'critical': { bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-red-200 dark:border-red-800', icon: '🔴' },
		'unknown': { bg: 'bg-gray-50 dark:bg-gray-900/20', border: 'border-gray-200 dark:border-gray-800', icon: '⚪' }
	};

	const colors = statusColor[status] || statusColor.unknown;

	return (
		<div className={`p-4 rounded-lg border ${colors.bg} ${colors.border}`}>
			<div className="flex items-center justify-between mb-2">
				<div className="flex items-center gap-2">
					<Zap className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
					<h4 className="font-semibold text-slate-900 dark:text-white">RChilli Credits</h4>
				</div>
				<span className="text-2xl">{colors.icon}</span>
			</div>

			<div className="space-y-2">
				<div className="flex justify-between text-sm">
					<span className="text-slate-600 dark:text-slate-400">Available Credits</span>
					<span className="font-semibold text-slate-900 dark:text-white">
						{remaining} / {total}
					</span>
				</div>

				<div className="w-full h-2 bg-slate-300 dark:bg-slate-700 rounded-full overflow-hidden">
					<div
						className={`h-full transition-all ${
							percentage >= 50
								? 'bg-green-500'
								: percentage >= 20
								? 'bg-yellow-500'
								: 'bg-red-500'
						}`}
						style={{ width: `${percentage}%` }}
					/>
				</div>

				<p className="text-xs text-slate-600 dark:text-slate-400 text-center">{percentage}% Available</p>

				{!canImport && (
					<button
						onClick={onRetry}
						className="w-full mt-2 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-sm rounded-md transition font-medium"
					>
						⚡ Recharge Now
					</button>
				)}
			</div>
		</div>
	);
}

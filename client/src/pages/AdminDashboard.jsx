import React, { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/axios";
import FileUploader from "../components/FileUploader";
import {
	FileText,
	cloudUpload,
	Trash2,
	RefreshCw,
	ShieldAlert,
	CheckCircle,
	Clock,
	Play,
	Pause,
	XCircle,
	Loader,
} from "lucide-react";
import ExistingFilesIcon from "../assets/existing-files.svg";
import HistoryIcon from "../assets/history.svg";
import toast from "react-hot-toast";

// Error Boundary Component
class ErrorBoundary extends React.Component {
	constructor(props) {
		super(props);
		this.state = { hasError: false };
	}

	static getDerivedStateFromError(error) {
		return { hasError: true };
	}

	componentDidCatch(error, errorInfo) {
		console.error("ErrorBoundary caught an error:", error, errorInfo);
	}

	render() {
		if (this.state.hasError) {
			return (
				<div className="p-8 text-center">
					<div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 mb-4">
						<ShieldAlert className="w-8 h-8 text-red-600" />
					</div>
					<h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
						Something went wrong
					</h3>
					<p className="text-slate-500 dark:text-slate-400 mb-4">Unable to load this section.</p>
					<button onClick={() => window.location.reload()} className="text-indigo-600 hover:underline">Refresh Page</button>
				</div>
			);
		}
		return this.props.children;
	}
}

const AdminDashboard = () => {
	const queryClient = useQueryClient();
	const [activeTab, setActiveTab] = useState("upload");
	const [uploadData, setUploadData] = useState(null);
	const [mapping, setMapping] = useState({});
	const [processingJobId, setProcessingJobId] = useState(null);
	const [isProcessing, setIsProcessing] = useState(false);
	const [processingProgress, setProcessingProgress] = useState({
		successRows: 0,
		totalRows: 0,
	});
	const pollingIntervalRef = useRef(null);
	const lastRefreshCountRef = useRef(0); // Use ref to avoid stale closure in setInterval
	
	// S3 File Path Mode
	const [useS3Path, setUseS3Path] = useState(false);
	const [s3FilePath, setS3FilePath] = useState("");
	const [isLoadingHeaders, setIsLoadingHeaders] = useState(false);

	// Password Modal State
	const [showPasswordModal, setShowPasswordModal] = useState(false);
	const [pendingAction, setPendingAction] = useState(null);
	const [passwordInput, setPasswordInput] = useState("");

	const { data: jobs = [], isLoading: isHistoryLoading } = useQuery({
		queryKey: ["history"],
		queryFn: async () => {
			const { data } = await api.get("/candidates/history");
			return Array.isArray(data) ? data : [];
		},
		refetchInterval: activeTab === 'history' && !processingJobId ? 60000 : false,
	});

	const { data: deleteLogs = [], isLoading: isDeleteHistoryLoading } = useQuery({
		queryKey: ["deleteHistory"],
		queryFn: async () => {
			const { data } = await api.get("/candidates/delete-history");
			return Array.isArray(data) ? data : [];
		},
		refetchInterval: activeTab === 'history' ? 60000 : false,
	});

	const { data: statsData } = useQuery({
		queryKey: ["candidateStats"],
		queryFn: async () => {
			// An empty search returns total count of non-deleted candidates
			const { data } = await api.get("/candidates/search?limit=1");
			return { totalCandidates: data.totalCount || 0 };
		},
		staleTime: 60000, // 1 minute
	});

	const fields = [
		"fullName",
		"jobTitle",
		"company",
		"industry",
		"email",
		"phone",
		"locality",
		"location",
		"skills",
		"linkedinUrl",
		"experience",
		"summary",
	];

	// --- MAPPING LOGIC ---
	const handleProcess = async () => {
		if (!uploadData?.filePath) {
			toast.error("No file selected for processing");
			return;
		}

		setIsProcessing(true);
		try {
			const { data } = await api.post("/candidates/process", {
				filePath: uploadData.filePath,
				headers: uploadData.headers, // ✅ Send the exact headers used for mapping
				mapping,
			});
			toast.success("Processing started! Check History tab for progress.");
			setUploadData(null);
			setMapping({});
			setProcessingJobId(data.jobId);
			setActiveTab("history");
			queryClient.invalidateQueries({ queryKey: ["history"] });
			queryClient.invalidateQueries({ queryKey: ["deleteHistory"] });
			// Start polling for progress updates
			startProgressPolling(data.jobId);
		} catch (e) {
			console.error("Process error:", e);
			const errorMessage =
				e.response?.data?.message || e.message || "Error processing file";
			toast.error(errorMessage);
			setIsProcessing(false);
		}
	};

	// Poll for job progress updates
	const startProgressPolling = (jobId) => {
		// Clear any existing polling
		if (pollingIntervalRef.current) {
			clearInterval(pollingIntervalRef.current);
		}

		pollingIntervalRef.current = setInterval(async () => {
			try {
				const { data } = await api.get(`/candidates/job/${jobId}/status`);
				setProcessingProgress(prev => ({
					...prev,
					successRows: data.successRows || 0,
					totalRows: data.totalRows || 0,
				}));

				// Optimistically update the job in the query cache
				queryClient.setQueryData(['history'], (oldData = []) =>
					oldData.map(job =>
						job._id === jobId ? { ...job, ...data } : job
					)
				);

				// Refresh candidates table DURING processing (every 1000 rows or every 15 seconds)
				// This ensures new rows appear in the table as they're processed
				if (data.status === "PROCESSING" && data.successRows > 0) {
					// Only refresh if we've processed new rows (avoid unnecessary refreshes)
					const lastRefreshCount = lastRefreshCountRef.current;
					const rowsSinceLastRefresh = data.successRows - lastRefreshCount;
					
					if (rowsSinceLastRefresh >= 1000) {
						// Refresh every 1000 new rows
						queryClient.invalidateQueries({ queryKey: ["candidates"] });
						queryClient.refetchQueries({ queryKey: ["candidates"] });
						// Also emit event for UserSearch page to refresh
						window.dispatchEvent(new CustomEvent("candidatesProcessing"));
						lastRefreshCountRef.current = data.successRows;
					}
				}

				if (data.status === "COMPLETED" || data.status === "FAILED") {
					clearInterval(pollingIntervalRef.current);
					pollingIntervalRef.current = null;
					setProcessingJobId(null);
					setIsProcessing(false);

					queryClient.invalidateQueries({ queryKey: ["history"] });

					if (data.status === "COMPLETED") {
						toast.success(
							`Processing completed! ${
								data.successRows || 0
							} records imported. Refreshing table...`,
						);
						// Immediately invalidate and refetch candidates table
						queryClient.invalidateQueries({ queryKey: ["candidates"] });
						queryClient.refetchQueries({ queryKey: ["candidates"] });
						window.dispatchEvent(new CustomEvent("candidatesUpdated"));
					} else {
						toast.error(`Processing failed: ${data.error || "Unknown error"}`);
					}
				}
			} catch (error) {
				console.error("Error polling job status:", error);
				// Stop polling if job not found (404)
				if (error.response && error.response.status === 404) {
					clearInterval(pollingIntervalRef.current);
					pollingIntervalRef.current = null;
					setProcessingJobId(null);
					setIsProcessing(false);
					queryClient.invalidateQueries({ queryKey: ["history"] });
				}
			}
		}, 2000); // Poll every 2 seconds
	};

	// Cleanup polling on unmount
	useEffect(() => {
		return () => {
			if (pollingIntervalRef.current) {
				clearInterval(pollingIntervalRef.current);
			}
		};
	}, []);

	useEffect(() => {
		// Check if there's a processing job on mount
		const processingJob = jobs.find(
			(j) => j.status === "PROCESSING" || j.status === "MAPPING_PENDING",
		);
		if (processingJob && !processingJobId) {
			setProcessingJobId(processingJob._id);
			startProgressPolling(processingJob._id);
		}
	}, [jobs, processingJobId]);

	const [isConfirming, setIsConfirming] = useState(false);
	const [passwordError, setPasswordError] = useState("");
	const [confirmActionType, setConfirmActionType] = useState(null);

	const handleReprocess = async (job) => {
		try {
			toast.loading("Loading file headers...", { id: "reprocess" });
			const filePath = job.fileName;
			const { data } = await api.post("/candidates/headers", { filePath });
			if (data.headers && data.headers.length > 0) {
				setUploadData({ filePath, headers: data.headers });
				setActiveTab("upload");
				toast.success("File loaded for reprocessing", { id: "reprocess" });
			} else {
				toast.error("Could not read headers from file", { id: "reprocess" });
			}
		} catch (error) {
			console.error("Reprocess error:", error);
			toast.error(
				error.response?.data?.message || "File missing from server.",
				{ id: "reprocess" },
			);
		}
	};

	const handleResume = async (job) => {
		try {
			toast.loading("Resuming job...", { id: "resume" });
			await api.post(`/candidates/${job._id}/resume`);
			toast.success("Job resumed! Check progress.", { id: "resume" });
			setProcessingJobId(job._id);
			startProgressPolling(job._id);
		} catch (error) {
			console.error("Resume error:", error);
			toast.error(error.response?.data?.message || "Failed to resume job", { id: "resume" });
		}
	};

	const handlePause = async (jobId) => {
		try {
			toast.loading("Pausing job...", { id: "pause" });
			await api.post(`/candidates/${jobId}/pause`);
			toast.success("Pause request sent. Job will stop shortly.", { id: "pause" });
			// Stop local polling immediately
			clearInterval(pollingIntervalRef.current);
			setProcessingJobId(null);
			queryClient.invalidateQueries({ queryKey: ["history"] });
		} catch (error) {
			console.error("Pause error:", error);
			toast.error(error.response?.data?.message || "Failed to pause job", { id: "pause" });
		}
	};

	// Load headers from S3 file path
	const handleLoadS3File = async () => {
		if (!s3FilePath.trim()) {
			toast.error("Please enter an S3 file path");
			return;
		}

		setIsLoadingHeaders(true);
		try {
			toast.loading("Loading file headers from S3...", { id: "s3load" });
			const { data } = await api.post("/candidates/headers", { 
				filePath: s3FilePath.trim() 
			});
			
			if (data.headers && data.headers.length > 0) {
				setUploadData({ 
					filePath: s3FilePath.trim(), 
					headers: data.headers 
				});
				toast.success("File headers loaded! Map your columns below.", { id: "s3load" });
				setS3FilePath("");
				setUseS3Path(false);
			} else {
				toast.error("Could not read headers from file", { id: "s3load" });
			}
		} catch (error) {
			console.error("S3 file load error:", error);
			const errorMessage = error.response?.data?.message || 
				error.response?.data?.error || 
				"Failed to load file from S3. Check if the file path is correct.";
			toast.error(errorMessage, { id: "s3load" });
		} finally {
			setIsLoadingHeaders(false);
		}
	};

	// --- SECURITY ACTIONS ---
	const initiateAction = (type, payload) => {
		setPendingAction({ type, payload });
		setConfirmActionType(type === "reset" ? "RESET" : "DELETE");
		setPasswordInput("");
		setPasswordError("");
		setShowPasswordModal(true);
	};

	const confirmAction = async () => {
		if (!passwordInput.trim()) {
			setPasswordError("Password is required");
			return;
		}

		try {
			setPasswordError("");
			setIsConfirming(true);

			// First verify the password
			await api.post("/auth/verify-password", {
				password: passwordInput,
			});

			// If password is correct, proceed with the action
			if (confirmActionType === "RESET") {
				await api.post("/admin/reset-database");
				toast.success("Database reset successfully");
				queryClient.invalidateQueries({ queryKey: ["history"] });
				queryClient.invalidateQueries({ queryKey: ["deleteHistory"] });
			} else if (pendingAction?.type === "deleteJob") {
				await api.delete(`/admin/jobs/${pendingAction.payload}`);
				toast.success("Job deleted successfully");
				queryClient.invalidateQueries({ queryKey: ["history"] });
				queryClient.invalidateQueries({ queryKey: ["candidates"] });
				queryClient.invalidateQueries({ queryKey: ["deleteHistory"] });
			}

			// Clean up
			setShowPasswordModal(false);
			setPasswordInput("");
			setPasswordError("");
			setPendingAction(null);
			setConfirmActionType(null);
		} catch (err) {
			setPasswordError(
				err.response?.data?.message || "Incorrect password or operation failed",
			);
		} finally {
			setIsConfirming(false);
		}
	};

	const formatDate = (dateString) => {
		if (!dateString) return "N/A";
		const date = new Date(dateString);
		const day = String(date.getDate()).padStart(2, "0");
		const month = String(date.getMonth() + 1).padStart(2, "0");
		const year = date.getFullYear();
		return `${day}/${month}/${year}`;
	};

	return (
		<ErrorBoundary>
		<div className="min-h-full bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 md:p-6">
			<div className="max-w-7xl mx-auto h-full flex flex-col">
				{/* Header & Tabs */}
				<div className="bg-white dark:bg-slate-900/80 backdrop-blur rounded-2xl p-5 mb-6 shadow-lg border border-slate-200 dark:border-transparent">
					<div className="flex flex-col sm:flex-row justify-between gap-4">
						<div className="flex gap-1 bg-slate-100 dark:bg-slate-800/70 p-1 rounded-xl">
							<button
								onClick={() => setActiveTab("upload")}
								className={`px-5 py-2 rounded-lg text-sm font-medium cursor-pointer transition-all
          ${
						activeTab === "upload"
							? "bg-white dark:bg-slate-900 text-slate-800 dark:text-white shadow"
							: "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700/60"
					}`}>
								Upload & Map
							</button>

							<button
								onClick={() => setActiveTab("history")}
								className={`px-5 py-2 rounded-lg text-sm font-medium cursor-pointer transition-all
          ${
						activeTab === "history"
							? "bg-white dark:bg-slate-900 text-slate-800 dark:text-white shadow"
							: "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700/60"
					}`}>
								History
							</button>
						</div>

						<button
							onClick={() => {
								setConfirmActionType("RESET");
								setPasswordInput(""); // 🔹 clears old password
								setPasswordError(""); // 🔹 clears old error
								setPendingAction(null); // 🔹 reset unrelated delete state
								setShowPasswordModal(true);
							}}
							className="flex items-center gap-2 px-4 py-2
             bg-red-700 hover:bg-red-600
             text-white rounded-xl
             font-medium shadow
             transition cursor-pointer">
							<ShieldAlert size={16} />
							Reset Database
						</button>
					</div>
				</div>

				{activeTab === "upload" && (
					<div className="bg-white dark:bg-slate-900 rounded-2xl p-8 shadow-xl border border-slate-200 dark:border-transparent">
						{/* AFTER UPLOAD → ONLY COLUMN MAPPING */}
						{uploadData ? (
							<div className="max-w-4xl mx-auto animate-fade-in">
								<div className="mb-6 flex items-center justify-between">
									<div>
										<h3 className="text-xl font-semibold text-slate-900 dark:text-white">
											Column Mapping
										</h3>
										<p className="text-sm text-slate-400">
											Map CSV headers to PeopleFinder fields
										</p>
										<p className="text-xs text-slate-500 mt-1">
											File: {uploadData.filePath}
										</p>
									</div>
									<button
										onClick={() => {
											setUploadData(null);
											setMapping({});
											setUseS3Path(false);
											setS3FilePath("");
										}}
										className="px-4 py-2 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white bg-slate-100 dark:bg-slate-800/50 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition">
										Change File
									</button>
								</div>

								<div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
									{fields.map((field) => (
										<div key={field} className="space-y-1">
											<label className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">
												{field}
											</label>

											<select
												className="w-full bg-slate-100 dark:bg-slate-800/70 border border-slate-300 dark:border-slate-700
                           rounded-xl px-3 py-2 text-sm text-slate-800 dark:text-white
                           focus:ring-2 focus:ring-indigo-500/40
                           cursor-pointer transition"
												onChange={(e) =>
													setMapping({ ...mapping, [field]: e.target.value })
												}>
												<option value="">Ignore</option>
												{uploadData.headers.map((h, i) => (
													<option key={i} value={h}>
														{h}
													</option>
												))}
											</select>
										</div>
									))}
								</div>

								<button
									onClick={handleProcess}
									disabled={isProcessing}
									className={`mt-8 w-full text-white py-3 rounded-xl font-medium
            shadow-lg transition ${
							isProcessing
								? "bg-indigo-400 cursor-not-allowed"
								: "bg-indigo-600 hover:bg-indigo-500 hover:shadow-indigo-500/30 cursor-pointer"
						}`}>
									{isProcessing ? (
										<span className="flex items-center justify-center gap-2">
											<RefreshCw className="w-4 h-4 animate-spin" />
											Processing...
										</span>
									) : (
										"Process File"
									)}
								</button>
							</div>
						) : (
							/* BEFORE UPLOAD → FILE UPLOADER OR S3 PATH */
							<div className="w-full">
								<div className="mb-6 flex gap-2 bg-slate-100 dark:bg-slate-800/50 p-1 rounded-xl">
									<button
										onClick={() => {
											setUseS3Path(false);
											setS3FilePath("");
										}}
										className={`cursor-pointer flex-1 px-4 py-2 rounded-lg text-sm font-medium transition ${
											!useS3Path
												? "bg-indigo-600 text-white"
												: "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"
										}`}>
										Upload New File
									</button>
									<button
										onClick={() => {
											setUseS3Path(true);
											setUploadData(null);
										}}
										className={`cursor-pointer flex-1 px-4 py-2 rounded-lg text-sm font-medium transition ${
											useS3Path
												? "bg-indigo-600 text-white"
												: "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"
										}`}>
										Use Existing S3 File
									</button>
								</div>

								{useS3Path ? (
									<div className="bg-white dark:bg-slate-800/50 rounded-xl p-6 border border-slate-200 dark:border-slate-700">
										<div className="flex flex-col md:flex-row items-center gap-8">
											{/* Left: Image */}
											<div className="w-full md:w-1/3 flex justify-center">
												<img
													src={ExistingFilesIcon}
													alt="Process existing file"
													className="w-48 md:w-full max-w-xs dark:invert-[.85]"
												/>
											</div>

											{/* Right: Content */}
											<div className="w-full md:w-2/3 space-y-4">
												<div>
													<h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
														Process File from S3
													</h3>
													<p className="text-sm text-slate-500 dark:text-slate-400">
														Enter the S3 key of your CSV file (e.g., "India.csv")
													</p>
												</div>

												<div className="space-y-2">
													<label className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">
														S3 File Path / Key
													</label>
													<input
														type="text"
														value={s3FilePath}
														onChange={(e) => setS3FilePath(e.target.value)}
														placeholder="India.csv"
														className="w-full bg-white dark:bg-slate-800/70 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-800 dark:text-white placeholder-slate-500 focus:ring-2 focus:ring-indigo-500/40 focus:outline-none transition"
														onKeyPress={(e) => {
															if (e.key === "Enter" && !isLoadingHeaders) {
																handleLoadS3File();
															}
														}}
													/>
													<p className="text-xs text-slate-500">
														💡 Use just the S3 key (e.g., "India.csv"), not the full URL.
													</p>
												</div>

												<button
													onClick={handleLoadS3File}
													disabled={isLoadingHeaders || !s3FilePath.trim()}
													className={`w-full text-white py-3 rounded-xl font-medium shadow-lg transition ${
														isLoadingHeaders || !s3FilePath.trim()
															? "bg-indigo-400 cursor-not-allowed"
															: "bg-indigo-600 hover:bg-indigo-500 hover:shadow-indigo-500/30 cursor-pointer"
													}`}>
													{isLoadingHeaders ? (
														<span className="flex items-center justify-center gap-2">
															<RefreshCw className="w-4 h-4 animate-spin" />
															Loading Headers...
														</span>
													) : (
														"Load File Headers"
													)}
												</button>
											</div>
										</div>
									</div>
								) : (
									/* REGULAR FILE UPLOADER */
									<FileUploader onUploadComplete={setUploadData} />
								)}
							</div>
						)}
					</div>
				)}

				{/* HISTORY TAB */}
				{activeTab === "history" && (
					<div className="space-y-8">
					<div className="bg-white dark:bg-slate-900/80 backdrop-blur rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 animate-fade-in">
						{/* Header */}
						<div className="p-6 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
							<div>
								<h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
									<cloudUpload className="w-5 h-5 text-blue-600" />
									Upload History
								</h3>
								<p className="text-sm text-slate-400 mt-1">
									View and manage processed files
								</p>
							</div>
							{statsData && (
								<div className="text-right">
									<p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
										{(statsData.totalCandidates || 0).toLocaleString()}
									</p>
									<p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
										Total Candidates
									</p>
								</div>
							)}
						</div>

						{isHistoryLoading ? (
							<div className="p-12 text-center">
								<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mx-auto"></div>
							</div>
						) : jobs.length === 0 ? (
							<div className="p-12 text-center">
								<img
									src={HistoryIcon}
									alt="No history"
									className="w-24 h-24 mx-auto mb-4 opacity-50 dark:invert-[.75]"
								/>
								<p className="text-slate-500 dark:text-slate-400 font-medium">
									No upload history found
								</p>
							</div>
						) : (
							<div className="p-4 space-y-3">
								{jobs.map((job) => {
									const getStatusStyle = () => {
										switch (job.status) {
											case "COMPLETED":
												return "bg-emerald-500/10 text-emerald-400";
											case "PROCESSING":
											case "MAPPING_PENDING":
												return "bg-amber-500/10 text-amber-400";
											case "FAILED":
												return "bg-rose-500/10 text-rose-400";
											case "DELETED":
												return "bg-slate-800 text-slate-500 border border-slate-700";
											default:
												return "bg-slate-700 text-slate-300";
										}
									};

									const isCurrentlyProcessing = job.status === 'PROCESSING' && processingJobId === job._id;

									return (
										<div
											key={job._id}
											className="bg-white dark:bg-slate-800/60 rounded-xl p-4 border border-slate-200 dark:border-slate-700
                         flex flex-col lg:flex-row lg:items-center lg:justify-between
                         gap-4 hover:bg-slate-50 dark:hover:bg-slate-800 transition">
											{/* File Info */}
											<div className="flex items-center gap-4 min-w-0">
												<div className="bg-indigo-100 dark:bg-indigo-500/10 p-2 rounded-lg">
													<FileText className="w-5 h-5 text-indigo-500 dark:text-indigo-400" />
												</div>

												<div className="min-w-0">
													<p className="font-medium text-slate-800 dark:text-slate-100 truncate">
														{job.originalName || job.fileName}
													</p>
													<p className="text-xs text-slate-500 dark:text-slate-400">
														{formatDate(job.createdAt)}
													</p>
												</div>
											</div>

											{/* Status */}
											<div className="flex items-center gap-4">
												<span
													className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusStyle()}`}>
													{job.status}
												</span>

												{/* Records */}
												<div className="text-sm text-slate-700 dark:text-slate-300 min-w-[110px] text-right">
													{(job.status === "PROCESSING" ||
														job.status === "MAPPING_PENDING") &&
													processingJobId === job._id ? (
														<div className="flex flex-col items-end w-full">
															<div className="flex items-center gap-2 justify-end w-full">
																<Loader className="w-3 h-3 animate-spin text-indigo-400" />
															<span className="font-semibold">
																{(processingProgress?.successRows || 0).toLocaleString()}
															</span>
															<span className="text-xs text-slate-500 dark:text-slate-400">
																/{" "}
																{(processingProgress?.totalRows || 0).toLocaleString()}
															</span>
															</div>
															<div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 mt-1">
																<div
																	className="bg-indigo-500 h-1.5 rounded-full transition-all"
																	style={{
																		width: `${
																			(processingProgress?.totalRows || 0) > 0
																				? ((processingProgress?.successRows || 0) /
																						(processingProgress?.totalRows || 1)) *
																				  100
																				: 0
																		}%`,
																	}}
																/>
															</div>
														</div>
													) : (
														<>
															<span className="font-semibold">
																{job.successRows?.toLocaleString() || "0"}
															</span>
															<span className="text-xs text-slate-500 dark:text-slate-400">
																{" "}
																records
															</span>
														</>
													)}
												</div>

												{/* Actions */}
												<div className="flex gap-2">
													{isCurrentlyProcessing ? (
														<button onClick={() => handlePause(job._id)} className="p-2 rounded-lg bg-slate-700/40 hover:bg-amber-500/20 text-amber-400 transition cursor-pointer" title="Pause Job">
															<Pause size={16} />
														</button>
													) : (
														(job.status === "PAUSED" || job.status === "FAILED" || job.status === "COMPLETED") && (
															<button
																onClick={() => handleResume(job)}
																className="p-2 rounded-lg bg-slate-700/40 hover:bg-emerald-500/20 text-emerald-400 transition cursor-pointer"
																title="Resume / Retry Upload">
																<Play size={16} />
															</button>
														)
													)}

													{/* <button
														onClick={() => handleReprocess(job)}
														className="p-2 rounded-lg bg-slate-700/40
                               hover:bg-indigo-500/20 text-indigo-400
                               transition cursor-pointer">
														<RefreshCw size={16} />
													</button> */}

													<button
														onClick={() => initiateAction("deleteJob", job._id)}
														className="p-2 rounded-lg bg-slate-200 dark:bg-slate-700/40
                               hover:bg-rose-100 dark:hover:bg-rose-500/20 text-rose-500 dark:text-rose-400
                               transition cursor-pointer">
														<Trash2 size={16} />
													</button>
												</div>
											</div>
										</div>
									);
								})}
							</div>
						)}
					</div>

					{/* DELETE HISTORY TABLE */}
					<div className="bg-white dark:bg-slate-900/80 backdrop-blur rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 animate-fade-in">
						<div className="p-6 border-b border-slate-200 dark:border-slate-800">
							<h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
								<Trash2 className="w-5 h-5 text-rose-500" />
								Delete History
							</h3>
							<p className="text-sm text-slate-400 mt-1">
								Audit log of deleted files and database resets
							</p>
						</div>

						{isDeleteHistoryLoading ? (
							<div className="p-12 text-center">
								<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-rose-500 mx-auto"></div>
							</div>
						) : deleteLogs.length === 0 ? (
							<div className="p-8 text-center text-slate-500 dark:text-slate-400">
								No deletion records found
							</div>
						) : (
							<div className="overflow-x-auto">
								<table className="w-full text-left border-collapse">
									<thead className="bg-slate-50 dark:bg-slate-800/50 text-xs uppercase text-slate-500 dark:text-slate-400 font-semibold">
										<tr>
											<th className="px-6 py-4">Entity Name</th>
											<th className="px-6 py-4">Type</th>
											<th className="px-6 py-4">Deleted By</th>
											<th className="px-6 py-4">Deleted At</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-slate-100 dark:divide-slate-800">
										{deleteLogs.map((log) => (
											<tr key={log._id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
												<td className="px-6 py-4 font-medium text-slate-800 dark:text-slate-200">
													{log.entityName}
												</td>
												<td className="px-6 py-4">
													<span className={`px-2 py-1 rounded text-xs font-bold ${
														log.entityType === 'DATABASE' 
															? 'bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400' 
															: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
													}`}>
														{log.entityType}
													</span>
												</td>
												<td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">
													{log.deletedBy?.name || 'Unknown'}
												</td>
												<td className="px-6 py-4 text-sm text-slate-500 dark:text-slate-400">
													{formatDate(log.deletedAt)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
					</div>
					</div>
				)}

				{/* PASSWORD CONFIRMATION MODAL */}
				{/* PASSWORD CONFIRMATION MODAL */}
				{showPasswordModal && (
					<div
						className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm
                  flex items-center justify-center transition-all">
						<div
							className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md p-6 shadow-2xl border border-slate-200 dark:border-transparent
                    animate-in fade-in zoom-in-95 duration-200">
							<h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
								{confirmActionType === "RESET"
									? "Reset Database"
									: "Confirm Action"}
							</h3>

							<p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
								{confirmActionType === "RESET"
									? "This will permanently erase all data"
									: "Enter admin password to continue"}
							</p>

							<input
								type="password"
								className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700
                   rounded-xl px-4 py-2 text-slate-800 dark:text-white
                   focus:ring-2 focus:ring-rose-500/40
                   outline-none transition"
								value={passwordInput}
								onChange={(e) => {
									setPasswordInput(e.target.value);
									if (passwordError) setPasswordError("");
								}}
								autoFocus
							/>

							{passwordError && (
								<p className="mt-2 text-sm text-rose-400">{passwordError}</p>
							)}

							<div className="flex justify-end gap-3 mt-6">
								<button
									onClick={() => setShowPasswordModal(false)}
									className="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition cursor-pointer">
									Cancel
								</button>

								<button
									onClick={confirmAction}
									disabled={isConfirming}
									className={`px-5 py-2 rounded-xl text-white transition
    ${
			isConfirming
				? "cursor-not-allowed bg-red-400"
				: confirmActionType === "RESET"
				? "bg-red-700 hover:bg-red-600"
				: "bg-rose-600 hover:bg-rose-500"
		}`}>
									{isConfirming
										? confirmActionType === "RESET"
											? "Resetting..."
											: "Deleting..."
										: "Confirm"}
								</button>
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
		</ErrorBoundary>
	);
};
export default AdminDashboard;

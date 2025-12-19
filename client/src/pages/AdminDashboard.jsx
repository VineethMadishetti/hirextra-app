import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import api from "../api/axios";
import FileUploader from "../components/FileUploader";
import {
	FileText,
	Trash2,
	RefreshCw,
	ShieldAlert,
	CheckCircle,
	Clock,
	XCircle,
	Loader,
} from "lucide-react";
import toast from "react-hot-toast";

const AdminDashboard = () => {
	const queryClient = useQueryClient();
	const [activeTab, setActiveTab] = useState("upload");
	const [jobs, setJobs] = useState([]);
	const [uploadData, setUploadData] = useState(null);
	const [mapping, setMapping] = useState({});
	const [processingJobId, setProcessingJobId] = useState(null);
	const [isProcessing, setIsProcessing] = useState(false);
	const [processingProgress, setProcessingProgress] = useState({
		successRows: 0,
		totalRows: 0,
	});
	const pollingIntervalRef = useRef(null);

	// Password Modal State
	const [showPasswordModal, setShowPasswordModal] = useState(false);
	const [pendingAction, setPendingAction] = useState(null);
	const [passwordInput, setPasswordInput] = useState("");

	const fetchHistory = async () => {
		try {
			const { data } = await api.get("/candidates/history");
			setJobs(data);
		} catch (e) {
			toast.error("Failed to load history");
		}
	};

	useEffect(() => {
		if (activeTab === "history") {
			fetchHistory();
		}
	}, [activeTab]);

	// Also fetch history when processing starts to show the new job
	useEffect(() => {
		if (processingJobId && activeTab === "history") {
			fetchHistory();
		}
	}, [processingJobId, activeTab]);

	// Auto-refresh history every minute
	useEffect(() => {
		let interval;
		if (activeTab === "history" && !processingJobId) {
			interval = setInterval(fetchHistory, 60000);
		}
		return () => clearInterval(interval);
	}, [activeTab, processingJobId]);

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
				mapping,
			});
			toast.success("Processing started! Check History tab for progress.");
			setUploadData(null);
			setMapping({});
			setProcessingJobId(data.jobId);
			setActiveTab("history");
			// Fetch history immediately to show the new job
			fetchHistory();
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
				setProcessingProgress({
					successRows: data.successRows || 0,
					totalRows: data.totalRows || 0,
				});

				// Refresh history to show updated progress
				if (activeTab === "history") {
					fetchHistory();
				}

				if (data.status === "COMPLETED" || data.status === "FAILED") {
					clearInterval(pollingIntervalRef.current);
					pollingIntervalRef.current = null;
					setProcessingJobId(null);
					setIsProcessing(false);
					fetchHistory(); // Refresh history

					if (data.status === "COMPLETED") {
						toast.success(
							`Processing completed! ${
								data.successRows || 0
							} records imported.`,
						);
						// Trigger a custom event to refresh the candidates table
						queryClient.invalidateQueries({ queryKey: ["candidates"] });
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
					fetchHistory();
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
	}, [jobs.length]);

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
				fetchHistory(); // Refresh the history after reset
			} else if (pendingAction?.type === "deleteJob") {
				await api.delete(`/admin/jobs/${pendingAction.payload}`);
				toast.success("Job deleted successfully");
				fetchHistory();
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

	return (
		<div className="min-h-screen bg-slate-950 text-slate-100 p-6">
			<div className="max-w-7xl mx-auto">
				{/* Header & Tabs */}
				<div className="bg-slate-900/80 backdrop-blur rounded-2xl p-5 mb-6 shadow-lg">
					<div className="flex flex-col sm:flex-row justify-between gap-4">
						<div className="flex gap-1 bg-slate-800/70 p-1 rounded-xl">
							<button
								onClick={() => setActiveTab("upload")}
								className={`px-5 py-2 rounded-lg text-sm font-medium cursor-pointer transition-all
          ${
						activeTab === "upload"
							? "bg-slate-900 text-white shadow"
							: "text-slate-400 hover:text-white hover:bg-slate-700/60"
					}`}>
								Upload & Map
							</button>

							<button
								onClick={() => setActiveTab("history")}
								className={`px-5 py-2 rounded-lg text-sm font-medium cursor-pointer transition-all
          ${
						activeTab === "history"
							? "bg-slate-900 text-white shadow"
							: "text-slate-400 hover:text-white hover:bg-slate-700/60"
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
					<div className="bg-slate-900 rounded-2xl p-8 shadow-xl">
						{/* AFTER UPLOAD → ONLY COLUMN MAPPING */}
						{uploadData ? (
							<div className="max-w-4xl mx-auto animate-fade-in">
								<div className="mb-6">
									<h3 className="text-xl font-semibold text-white">
										Column Mapping
									</h3>
									<p className="text-sm text-slate-400">
										Map CSV headers to PeopleFinder fields
									</p>
								</div>

								<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
									{fields.map((field) => (
										<div key={field} className="space-y-1">
											<label className="text-xs text-slate-400 uppercase tracking-wide">
												{field}
											</label>

											<select
												className="w-full bg-slate-800/70 border border-slate-700
                           rounded-xl px-3 py-2 text-sm text-white
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
							/* BEFORE UPLOAD → ONLY FILE UPLOADER */
							<div className="w-full">
								<FileUploader onUploadComplete={setUploadData} />
							</div>
						)}
					</div>
				)}

				{/* HISTORY TAB */}
				{activeTab === "history" && (
					<div className="bg-slate-900/80 backdrop-blur rounded-2xl shadow-xl border border-slate-800 animate-fade-in">
						{/* Header */}
						<div className="p-6 border-b border-slate-800">
							<h3 className="text-xl font-semibold text-slate-100">
								Upload History
							</h3>
							<p className="text-sm text-slate-400 mt-1">
								View and manage processed files
							</p>
						</div>

						{jobs.length === 0 ? (
							<div className="p-12 text-center">
								<FileText className="w-14 h-14 text-slate-600 mx-auto mb-4" />
								<p className="text-slate-300 font-medium">
									No upload history yet
								</p>
								<p className="text-sm text-slate-500 mt-1">
									Upload a CSV file to get started
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
											default:
												return "bg-slate-700 text-slate-300";
										}
									};

									return (
										<div
											key={job._id}
											className="bg-slate-800/60 rounded-xl p-4
                         flex flex-col lg:flex-row lg:items-center lg:justify-between
                         gap-4 hover:bg-slate-800 transition cursor-pointer">
											{/* File Info */}
											<div className="flex items-center gap-4 min-w-0">
												<div className="bg-indigo-500/10 p-2 rounded-lg">
													<FileText className="w-5 h-5 text-indigo-400" />
												</div>

												<div className="min-w-0">
													<p className="font-medium text-slate-100 truncate">
														{job.originalName || job.fileName}
													</p>
													<p className="text-xs text-slate-400">
														{job.createdAt
															? new Date(job.createdAt).toLocaleString()
															: "N/A"}
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
												<div className="text-sm text-slate-300 min-w-[110px] text-right">
													{(job.status === "PROCESSING" ||
														job.status === "MAPPING_PENDING") &&
													processingJobId === job._id ? (
														<div className="flex flex-col items-end w-full">
															<div className="flex items-center gap-2 justify-end w-full">
																<Loader className="w-3 h-3 animate-spin text-indigo-400" />
															<span className="font-semibold">
																{processingProgress.successRows.toLocaleString()}
															</span>
															<span className="text-xs text-slate-400">
																/{" "}
																{processingProgress.totalRows.toLocaleString()}
															</span>
															</div>
															<div className="w-full bg-slate-700 rounded-full h-1.5 mt-1">
																<div
																	className="bg-indigo-500 h-1.5 rounded-full transition-all"
																	style={{
																		width: `${
																			processingProgress.totalRows > 0
																				? (processingProgress.successRows /
																						processingProgress.totalRows) *
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
															<span className="text-xs text-slate-400">
																{" "}
																records
															</span>
														</>
													)}
												</div>

												{/* Actions */}
												<div className="flex gap-2">
													<button
														onClick={() => handleReprocess(job)}
														className="p-2 rounded-lg bg-slate-700/40
                               hover:bg-indigo-500/20 text-indigo-400
                               transition cursor-pointer">
														<RefreshCw size={16} />
													</button>

													<button
														onClick={() => initiateAction("deleteJob", job._id)}
														className="p-2 rounded-lg bg-slate-700/40
                               hover:bg-rose-500/20 text-rose-400
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
				)}

				{/* PASSWORD CONFIRMATION MODAL */}
				{/* PASSWORD CONFIRMATION MODAL */}
				{showPasswordModal && (
					<div
						className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm
                  flex items-center justify-center transition-all">
						<div
							className="bg-slate-900 rounded-2xl w-full max-w-md p-6 shadow-2xl
                    animate-in fade-in zoom-in-95 duration-200">
							<h3 className="text-lg font-semibold text-white mb-1">
								{confirmActionType === "RESET"
									? "Reset Database"
									: "Confirm Action"}
							</h3>

							<p className="text-sm text-slate-400 mb-4">
								{confirmActionType === "RESET"
									? "This will permanently erase all data"
									: "Enter admin password to continue"}
							</p>

							<input
								type="password"
								className="w-full bg-slate-800 border border-slate-700
                   rounded-xl px-4 py-2 text-white
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
									className="text-slate-400 hover:text-white transition cursor-pointer">
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
	);
};
export default AdminDashboard;

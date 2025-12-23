import React, {
	useState,
	useContext,
	useCallback,
	useMemo,
	useRef,
	useEffect,
} from "react";
import { useInView } from "react-intersection-observer";
import {
	useInfiniteQuery,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import api from "../api/axios";
import { AuthContext } from "../context/AuthContext";
import {
	Search,
	Eye,
	X,
	Filter,
	Download,
	ChevronDown,
	ChevronUp,
	Trash2,
	Loader,
	ExternalLink,
	Phone,
	Mail,
	MapPin,
	Briefcase,
	Building,
	Award,
	Calendar,
	Linkedin,
	AlertTriangle,
} from "lucide-react";
import toast from "react-hot-toast";

const PAGE_SIZE = 60; // Increased page size for better initial load

// Helper to format location (Capitalize & Deduplicate)
const formatLocation = (locality, location) => {
	const raw = [locality, location].filter(Boolean).join(", ");
	const parts = raw
		.split(",")
		.map((p) => p.trim())
		.filter(Boolean);
	const unique = [];
	const seen = new Set();

	for (const part of parts) {
		const lower = part.toLowerCase();
		if (!seen.has(lower)) {
			seen.add(lower);
			// Capitalize first letter of each word
			let formatted = part.toLowerCase().replace(/(?:^|\s)\S/g, (a) => a.toUpperCase());

			// Fix specific data quality issues
			if (formatted === "Hyderbd") formatted = "Hyderabad";

			unique.push(formatted);
		}
	}
	return unique.join(", ");
};

// Debounce hook
const useDebounce = (value, delay) => {
	const [debouncedValue, setDebouncedValue] = useState(value);
	useEffect(() => {
		const handler = setTimeout(() => setDebouncedValue(value), delay);
		return () => clearTimeout(handler);
	}, [value, delay]);
	return debouncedValue;
};

// Error Boundary Component for graceful failure
class ErrorBoundary extends React.Component {
	constructor(props) {
		super(props);
		this.state = { hasError: false };
	}

	static getDerivedStateFromError(error) {
		return { hasError: true };
	}

	componentDidCatch(error, errorInfo) {
		console.error("ErrorBoundary caught an error", error, errorInfo);
	}

	render() {
		if (this.state.hasError) {
			return (
				<div className="p-6 bg-red-50 border border-red-100 rounded-xl text-center m-4">
					<h3 className="text-red-800 font-semibold">
						Something went wrong displaying this section.
					</h3>
					<button
						onClick={() => window.location.reload()}
						className="mt-2 text-sm text-red-600 underline hover:text-red-800">
						Refresh Page
					</button>
				</div>
			);
		}
		return this.props.children;
	}
}

const UserSearch = () => {
	const { user } = useContext(AuthContext);
	const queryClient = useQueryClient();
	const [selectedProfile, setSelectedProfile] = useState(null);

	// --- STATE PERSISTENCE & RESTORATION ---
	// Initialize state from localStorage to recover from crashes/refresh
	const [selectedIds, setSelectedIds] = useState(() => {
		try {
			const saved = localStorage.getItem("hirextra_selectedIds");
			return saved ? new Set(JSON.parse(saved)) : new Set();
		} catch (e) {
			return new Set();
		}
	});

	const [searchInput, setSearchInput] = useState(
		() => localStorage.getItem("hirextra_searchInput") || "",
	);

	const [filters, setFilters] = useState(() => {
		try {
			const saved = localStorage.getItem("hirextra_filters");
			return saved
				? JSON.parse(saved)
				: {
						location: "",
						jobTitle: "",
						skills: "",
						hasEmail: false,
						hasPhone: false,
						hasLinkedin: false,
				  };
		} catch (e) {
			return {
				location: "",
				jobTitle: "",
				skills: "",
				hasEmail: false,
				hasPhone: false,
				hasLinkedin: false,
			};
		}
	});

	// Save state to localStorage whenever it changes
	useEffect(() => {
		localStorage.setItem(
			"hirextra_selectedIds",
			JSON.stringify(Array.from(selectedIds)),
		);
	}, [selectedIds]);

	useEffect(() => {
		localStorage.setItem("hirextra_searchInput", searchInput);
	}, [searchInput]);

	useEffect(() => {
		localStorage.setItem("hirextra_filters", JSON.stringify(filters));
	}, [filters]);

	// Prevent accidental tab closure if candidates are selected
	useEffect(() => {
		const handleBeforeUnload = (e) => {
			if (selectedIds.size > 0) {
				e.preventDefault();
				e.returnValue = ""; // Standard for Chrome/Firefox
			}
		};
		window.addEventListener("beforeunload", handleBeforeUnload);
		return () => window.removeEventListener("beforeunload", handleBeforeUnload);
	}, [selectedIds]);

	const debouncedSearch = useDebounce(searchInput, 500);

	const queryFilters = useMemo(
		() => ({
			q: debouncedSearch,
			locality: filters.location,
			jobTitle: filters.jobTitle,
			skills: filters.skills,
			hasEmail: filters.hasEmail,
			hasPhone: filters.hasPhone,
			hasLinkedin: filters.hasLinkedin,
		}),
		[debouncedSearch, filters],
	);

	const queryKey = useMemo(() => ["candidates", queryFilters], [queryFilters]);

	const { ref: loadMoreRef, inView } = useInView({
		threshold: 0.1,
		triggerOnce: false,
		rootMargin: "100px", // Start loading 100px before the element is visible
	});

	const {
		data,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
		status,
		error,
		refetch,
		isLoading,
		isFetching,
	} = useInfiniteQuery({
		queryKey,
		queryFn: async ({ pageParam = 1 }) => {
			const params = new URLSearchParams({
				page: pageParam,
				limit: PAGE_SIZE,
				...Object.fromEntries(
					Object.entries(queryFilters).filter(
						([_, v]) =>
							v !== "" && v !== false && v !== undefined && v !== null,
					),
				),
			});

			const response = await api.get(`/candidates/search?${params}`);
			return { ...response.data, currentPage: pageParam };
		},
		getNextPageParam: (lastPage) => {
			if (lastPage.currentPage < lastPage.totalPages) {
				return lastPage.currentPage + 1;
			}
			return undefined;
		},
		initialPageParam: 1,
		staleTime: 10 * 1000, // Consider data stale after 10 seconds (shorter for live updates)
		gcTime: 30 * 60 * 1000,
		refetchOnWindowFocus: true,
		refetchOnReconnect: true,
		refetchInterval: 15000, // Auto-refresh every 15 seconds during processing
	});

	// Simplified scroll loading logic
	useEffect(() => {
		if (inView && hasNextPage && !isFetchingNextPage) {
			fetchNextPage();
		}
	}, [inView, hasNextPage, isFetchingNextPage, fetchNextPage]);

	// Listen for candidates updated event (when processing completes)
	useEffect(() => {
		const handleCandidatesUpdated = () => {
			// Immediately refetch to show new data
			queryClient.invalidateQueries({ queryKey: ["candidates"] });
			refetch(); // Trigger immediate refetch
			toast.success("New candidates available! Refreshing table...", {
				duration: 2000,
			});
		};

		window.addEventListener("candidatesUpdated", handleCandidatesUpdated);
		return () => {
			window.removeEventListener("candidatesUpdated", handleCandidatesUpdated);
		};
	}, [queryClient, refetch]);

	const candidates = useMemo(() => {
		if (!data?.pages) return [];
		return data.pages.flatMap((page) => page.candidates || []);
		// const allCandidates = data.pages.flatMap((page) => page.candidates || []);

		// Sort candidates: Rows with all columns filled appear first
		// return allCandidates.sort((a, b) => {
		// 	const getScore = (c) => {
		// 		let score = 0;
		// 		if (c.fullName) score++;
		// 		if (c.jobTitle) score++;
		// 		if (c.skills) score++;
		// 		if (c.company) score++;
		// 		if (c.experience) score++;
		// 		if (c.phone || c.email || c.linkedinUrl || c.locality || c.location) score++;
		// 		return score;
		// 	};
		// 	return getScore(b) - getScore(a);
		// });
	}, [data?.pages]);

	const totalCount = useMemo(() => {
		return data?.pages?.[0]?.totalCount || 0;
	}, [data?.pages]);

	const handleFilterChange = useCallback((key, value) => {
		setFilters((prev) => {
			if (prev[key] === value) return prev;
			return { ...prev, [key]: value };
		});
		setSelectedIds(new Set());
	}, []);

	const handleSearchChange = useCallback((e) => {
		setSearchInput(e.target.value);
		setSelectedIds(new Set());
	}, []);

	const clearAllFilters = useCallback(() => {
		setSearchInput("");
		setFilters({
			location: "",
			jobTitle: "",
			skills: "",
			hasEmail: false,
			hasPhone: false,
			hasLinkedin: false,
		});
		setSelectedIds(new Set());
	}, []);

	// Bulk delete mutation
	const bulkDeleteMutation = useMutation({
		mutationFn: async (ids) => {
			const idsArray = Array.from(ids);
			await Promise.all(idsArray.map((id) => api.delete(`/candidates/${id}`)));
			return idsArray;
		},
		onMutate: async (ids) => {
			await queryClient.cancelQueries({ queryKey });
			const previousData = queryClient.getQueryData(queryKey);
			const idsArray = Array.from(ids);

			queryClient.setQueryData(queryKey, (old) => {
				if (!old) return old;
				return {
					...old,
					pages: old.pages.map((page) => ({
						...page,
						candidates: page.candidates.filter(
							(c) => !idsArray.includes(c._id),
						),
						totalCount: Math.max(0, (page.totalCount || 0) - idsArray.length),
					})),
				};
			});

			return { previousData };
		},
		onError: (err, ids, context) => {
			queryClient.setQueryData(queryKey, context.previousData);
			toast.error("Failed to delete candidates");
		},
		onSuccess: (ids) => {
			toast.success(
				`Successfully deleted ${ids.length} candidate${
					ids.length > 1 ? "s" : ""
				}`,
			);
			setSelectedIds(new Set());
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey });
		},
	});

	// Single delete mutation
	const deleteCandidate = useMutation({
		mutationFn: async (id) => {
			await api.delete(`/candidates/${id}`);
			return id;
		},
		onMutate: async (id) => {
			await queryClient.cancelQueries({ queryKey });
			const previousData = queryClient.getQueryData(queryKey);

			queryClient.setQueryData(queryKey, (old) => {
				if (!old) return old;
				return {
					...old,
					pages: old.pages.map((page) => ({
						...page,
						candidates: page.candidates.filter((c) => c._id !== id),
						totalCount: Math.max(0, (page.totalCount || 0) - 1),
					})),
				};
			});

			return { previousData };
		},
		onError: (err, id, context) => {
			queryClient.setQueryData(queryKey, context.previousData);
			toast.error("Failed to delete candidate");
		},
		onSuccess: () => {
			toast.success("Candidate deleted");
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey });
		},
	});

	const handleBulkDelete = useCallback(() => {
		if (selectedIds.size === 0) return;

		const confirmed = window.confirm(
			`Are you sure you want to delete ${selectedIds.size} candidate${
				selectedIds.size > 1 ? "s" : ""
			}?`,
		);

		if (confirmed) {
			bulkDeleteMutation.mutate(selectedIds);
		}
	}, [selectedIds, bulkDeleteMutation]);

	const handleDeleteRow = useCallback(
		(id, e) => {
			e?.stopPropagation();
			if (window.confirm("Are you sure you want to delete this candidate?")) {
				deleteCandidate.mutate(id);
			}
		},
		[deleteCandidate],
	);

	const handleSelectAll = useCallback(
		(checked) => {
			if (checked) {
				setSelectedIds(new Set(candidates.map((c) => c._id)));
			} else {
				setSelectedIds(new Set());
			}
		},
		[candidates],
	);

	const handleSelectOne = useCallback((id, checked) => {
		setSelectedIds((prev) => {
			const newSet = new Set(prev);
			if (checked) {
				newSet.add(id);
			} else {
				newSet.delete(id);
			}
			return newSet;
		});
	}, []);

	const handleCancelSelection = useCallback(() => {
		setSelectedIds(new Set());
	}, []);

	const handleQuickView = useCallback((candidate, e) => {
		e?.stopPropagation();
		setSelectedProfile(candidate);
	}, []);

	const handleExport = useCallback(async () => {
		if (selectedIds.size === 0) {
			toast.error("Please select candidates to export");
			return;
		}

		try {
			toast.success(`Exporting ${selectedIds.size} candidates...`);

			const response = await api.post(
				"/candidates/export",
				{
					ids: Array.from(selectedIds),
				},
				{
					responseType: "blob",
				},
			);

			const url = window.URL.createObjectURL(new Blob([response.data]));
			const link = document.createElement("a");
			link.href = url;
			link.setAttribute(
				"download",
				`candidates_export_${new Date().toISOString().split("T")[0]}.csv`,
			);
			document.body.appendChild(link);
			link.click();
			link.remove();
			window.URL.revokeObjectURL(url);

			toast.success("Export completed successfully");
		} catch (error) {
			console.error("Export error:", error);
			toast.error("Export failed");
		}
	}, [selectedIds]);

	const handleDownload = useCallback(async (candidateId, e) => {
		e?.stopPropagation();
		try {
			const response = await api.get(`/candidates/${candidateId}/download`, {
				responseType: "blob",
			});

			const url = window.URL.createObjectURL(new Blob([response.data]));
			const link = document.createElement("a");
			link.href = url;
			link.setAttribute("download", `candidate_${candidateId}.docx`);
			document.body.appendChild(link);
			link.click();
			link.remove();
			window.URL.revokeObjectURL(url);

			toast.success("Profile downloaded");
		} catch (error) {
			toast.error("Download failed");
		}
	}, []);

	if (status === "error") {
		return (
			<div className="flex flex-col items-center justify-center h-[calc(100vh-65px)] p-4 bg-slate-50">
				<div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 text-center max-w-md">
					<div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mb-4">
						<AlertTriangle className="w-6 h-6 text-red-600" />
					</div>
					<h3 className="text-lg font-semibold text-slate-900 mb-2">
						Unable to load candidates
					</h3>
					<p className="text-slate-500 mb-6 text-sm">
						{error?.response?.status === 500
							? "Server error. If searching, try simpler keywords."
							: error?.message || "Something went wrong."}
					</p>
					<button
						onClick={() => refetch()}
						className="px-5 py-2.5 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-colors font-medium text-sm">
						Try Again
					</button>
				</div>
			</div>
		);
	}

	const hasActiveFilters =
		searchInput ||
		Object.values(filters).some((v) => v && v !== false && v !== "");

	return (
		<ErrorBoundary>
			<div className="flex flex-col h-[calc(100vh-64px)] bg-slate-950 text-slate-100 font-sans">
				{/* Fixed Filters Header - Stays below admin header */}
				<div className="sticky top-0 z-40 bg-slate-900 border-b border-slate-800 shadow-md">
					<div className="flex items-center justify-between px-4 py-3 gap-4">
						{/* Filters Row (Scrollable) */}
						<div className="flex items-center gap-2 flex-1 overflow-x-auto scrollbar-hide">
							{/* Search Bar */}
							<div className="relative min-w-[240px]">
								<Search
									className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
									size={15}
								/>
								<input
									placeholder="Search candidates..."
									className="w-full pl-9 pr-8 py-2 bg-slate-800 border border-slate-700 hover:border-slate-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg text-sm text-slate-200 placeholder-slate-500 outline-none transition-all"
									value={searchInput}
									onChange={handleSearchChange}
								/>
								{searchInput && (
									<button
										onClick={() => setSearchInput("")}
										className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-0.5 rounded-full transition-colors">
										<X size={14} />
									</button>
								)}
							</div>

							{/* Job Title */}
							<input
								placeholder="Job Title"
								className="min-w-[140px] px-3 py-2 bg-slate-800 border border-slate-700 hover:border-slate-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg text-sm text-slate-200 placeholder-slate-500 outline-none transition-all"
								value={filters.jobTitle}
								onChange={(e) => handleFilterChange("jobTitle", e.target.value)}
							/>

							{/* Location */}
							<input
								placeholder="Location"
								className="min-w-[140px] px-3 py-2 bg-slate-800 border border-slate-700 hover:border-slate-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg text-sm text-slate-200 placeholder-slate-500 outline-none transition-all"
								value={filters.location}
								onChange={(e) => handleFilterChange("location", e.target.value)}
							/>

							{/* Skills */}
							<input
								placeholder="Skills"
								className="min-w-[140px] px-3 py-2 bg-slate-800 border border-slate-700 hover:border-slate-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg text-sm text-slate-200 placeholder-slate-500 outline-none transition-all"
								value={filters.skills}
								onChange={(e) => handleFilterChange("skills", e.target.value)}
							/>

							{/* Divider */}
							<div className="h-6 w-px bg-slate-700 mx-1" />

							<div className="flex items-center gap-1">
								<span className="text-xs font-medium text-slate-500 px-1">
									Contact:
								</span>

								{/* Email Filter */}
								<button
									onClick={() =>
										handleFilterChange("hasEmail", !filters.hasEmail)
									}
									title="Has Email"
									className={`p-2 rounded-lg transition-all border ${
										filters.hasEmail
											? "bg-indigo-600 text-white border-indigo-500 shadow-sm"
											: "bg-transparent text-slate-400 border-transparent hover:bg-slate-800 hover:text-slate-200"
									}`}>
									<Mail size={16} />
								</button>

								{/* Phone Filter */}
								<button
									onClick={() =>
										handleFilterChange("hasPhone", !filters.hasPhone)
									}
									title="Has Phone"
									className={`p-2 rounded-lg transition-all border ${
										filters.hasPhone
											? "bg-indigo-600 text-white border-indigo-500 shadow-sm"
											: "bg-transparent text-slate-400 border-transparent hover:bg-slate-800 hover:text-slate-200"
									}`}>
									<Phone size={16} />
								</button>

								{/* LinkedIn Filter */}
								<button
									onClick={() =>
										handleFilterChange("hasLinkedin", !filters.hasLinkedin)
									}
									title="Has LinkedIn"
									className={`p-2 rounded-lg transition-all border ${
										filters.hasLinkedin
											? "bg-indigo-600 text-white border-indigo-500 shadow-sm"
											: "bg-transparent text-slate-400 border-transparent hover:bg-slate-800 hover:text-slate-200"
									}`}>
									<Linkedin size={16} />
								</button>
							</div>

							{/* Clear Filters */}
							{hasActiveFilters && (
								<button
									onClick={clearAllFilters}
									className="ml-2 text-xs font-medium text-slate-500 hover:text-rose-400 whitespace-nowrap transition-colors px-2">
									Clear
								</button>
							)}
						</div>

						{/* Count Display */}
						<div className="flex-shrink-0 pl-4 border-l border-slate-800">
							<span className="text-xs font-medium text-slate-400 bg-slate-800/50 px-3 py-1.5 rounded-full border border-slate-700/50">
								Showing{" "}
								<span className="text-slate-400 font-bold">
									{candidates.length}
								</span>
								<span className="mx-1 text-slate-600">/</span>
								<span className="text-slate-400 font-bold">{totalCount}</span>
							</span>
						</div>
					</div>

					{/* Bulk Actions Bar */}
					{selectedIds.size > 0 && (
						<div className="flex items-center justify-between px-4 py-2.5 bg-indigo-900/30 border border-indigo-500/30 rounded-b-xl animate-in fade-in slide-in-from-top-2 duration-200 mx-4 shadow-sm">
							<span className="text-sm font-semibold text-indigo-200 flex items-center gap-2">
								<div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
								{selectedIds.size} candidate{selectedIds.size > 1 ? "s" : ""}{" "}
								selected
							</span>
							<div className="flex gap-2">
								<button
									onClick={handleCancelSelection}
									className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition-colors shadow-sm">
									<X size={16} />
									Cancel
								</button>
								<button
									onClick={handleExport}
									className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition-colors shadow-sm shadow-emerald-200">
									<Download size={16} />
									Export
								</button>
								{user?.role === "ADMIN" && (
									<button
										onClick={handleBulkDelete}
										disabled={bulkDeleteMutation.isPending}
										className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold transition-colors shadow-sm shadow-rose-200 disabled:opacity-50">
										{bulkDeleteMutation.isPending ? (
											<Loader className="animate-spin" size={16} />
										) : (
											<Trash2 size={16} />
										)}
										Delete
									</button>
								)}
							</div>
						</div>
					)}
				</div>

				{/* Table Container - Scrollable area starting below filters and table head */}
				<div className="flex-1 overflow-hidden flex flex-col">
					{isLoading && !data ? (
						<div className="flex items-center justify-center h-[calc(100vh-180px)]">
							<div className="text-center">
								<Loader className="animate-spin h-10 w-10 text-indigo-600 mx-auto mb-4 opacity-80" />
								<p className="text-slate-400 font-medium">
									Loading candidates...
								</p>
							</div>
						</div>
					) : candidates.length === 0 ? (
						<div className="flex flex-col items-center justify-center h-[calc(100vh-200px)] space-y-4">
							<div className="bg-slate-100 p-4 rounded-full">
								<Search className="h-8 w-8 text-slate-400" />
							</div>
							<p className="text-slate-600 text-lg font-medium">
								No candidates found
							</p>
							<p className="text-slate-400 text-sm">
								Try adjusting your search or filters
							</p>
						</div>
					) : (
						<div className="mx-4 mt-3 mb-2">
							{/* Table with fixed header and scrollable body */}
							<div className="bg-slate-900 rounded-2xl shadow-xl border border-slate-800 overflow-hidden">
								{/* Single table with sticky header */}
								<div
									className="overflow-y-scroll [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-slate-900 [&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-600 [scrollbar-width:thin] [scrollbar-color:#334155_#0f172a]"
									style={{ maxHeight: "calc(100vh - 170px)" }}>
									<table className="w-full table-fixed">
										<thead className="bg-slate-900 border-b border-slate-700 sticky top-0 z-30">
											<tr>
												<th className="w-12 px-3 py-4 text-left">
													<input
														type="checkbox"
														className="h-4 w-4 text-indigo-600 border-slate-600 bg-slate-800 rounded focus:ring-indigo-500 cursor-pointer transition"
														checked={
															selectedIds.size > 0 &&
															selectedIds.size === candidates.length
														}
														onChange={(e) => handleSelectAll(e.target.checked)}
													/>
												</th>
												<th className="w-48 px-3 py-4 text-left text-xs font-bold text-indigo-400 uppercase tracking-wider">
													Full Name
												</th>
												<th className="w-40 px-6 py-4 text-left text-xs font-bold text-indigo-400 uppercase tracking-wider">
													Job Title
												</th>
												<th className="w-48 px-6 py-4 text-left text-xs font-bold text-indigo-400 uppercase tracking-wider">
													Skills
												</th>
												<th className="w-40 px-6 py-4 text-left text-xs font-bold text-indigo-400 uppercase tracking-wider">
													Company Name
												</th>
												<th className="w-32 px-6 py-4 text-left text-xs font-bold text-indigo-400 uppercase tracking-wider">
													Experience
												</th>
												<th className="w-40 px-6 py-4 text-left text-xs font-bold text-indigo-400 uppercase tracking-wider">
													Contact
												</th>
												<th className="w-32 px-6 py-4 text-left text-xs font-bold text-indigo-400 uppercase tracking-wider">
													Actions
												</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-slate-800 bg-slate-900">
											{candidates.map((candidate, index) => (
												<CandidateRow
													key={`${candidate._id}-${index}`}
													candidate={candidate}
													isSelected={selectedIds.has(candidate._id)}
													onSelect={handleSelectOne}
													onQuickView={handleQuickView}
													onDownload={handleDownload}
													onDelete={handleDeleteRow}
													isAdmin={user?.role === "ADMIN"}
													isDeleting={
														deleteCandidate.isPending &&
														deleteCandidate.variables === candidate._id
													}
												/>
											))}

											{/* Load More Trigger Row */}
											<tr>
												<td colSpan="7" className="p-0">
													<div
														ref={loadMoreRef}
														className="h-20 flex items-center justify-center">
														{isFetchingNextPage ? (
															<div className="flex items-center gap-2">
																<Loader className="animate-spin h-4 w-4 text-indigo-600" />
																<span className="text-sm text-slate-500">
																	Loading more candidates...
																</span>
															</div>
														) : hasNextPage ? (
															<span className="text-sm text-slate-400">
																Scroll down to load more
															</span>
														) : candidates.length > 0 ? (
															<span className="text-sm text-slate-400 py-4">
																No more candidates to load
															</span>
														) : null}
													</div>
												</td>
											</tr>
										</tbody>
									</table>
								</div>
							</div>

							{/* Loading indicator for initial load */}
							{isFetching && !isFetchingNextPage && (
								<div className="flex items-center justify-center mt-4">
									<Loader className="animate-spin h-6 w-6 text-indigo-600 mr-2" />
									<span className="text-sm text-slate-500">Loading...</span>
								</div>
							)}
						</div>
					)}
				</div>

				{selectedProfile && (
					<ProfileModal
						profile={selectedProfile}
						onClose={() => setSelectedProfile(null)}
						onDownload={handleDownload}
					/>
				)}
			</div>
		</ErrorBoundary>
	);
};

// Memoized Row with consistent cell sizes
const CandidateRow = React.memo(
	({
		candidate,
		isSelected,
		onSelect,
		onQuickView,
		onDownload,
		onDelete,
		isAdmin,
		isDeleting,
	}) => {
		const val = (v) => (v && v.trim() !== "" ? v : "-");

		return (
			<tr
				className={`group hover:bg-slate-800 transition-all duration-200 border-b border-slate-800 last:border-none ${
					isSelected ? "bg-indigo-900/20" : ""
				}`}>
				{/* Checkbox */}
				<td className="px-3 py-4 align-top">
					<input
						type="checkbox"
						className="h-4 w-4 text-indigo-600 border-slate-600 bg-slate-800 rounded focus:ring-indigo-500 cursor-pointer transition mt-1"
						checked={isSelected}
						onChange={(e) => onSelect(candidate._id, e.target.checked)}
					/>
				</td>

				{/* Name */}
				<td className="w-48 px-3 py-4 align-top">
					<div className="font-semibold text-slate-200 break-words leading-tight">
						{val(candidate.fullName)}
					</div>
				</td>

				{/* Job Title */}
				<td className="w-40 px-6 py-4 align-top">
					<div className="text-slate-300 font-medium break-words text-sm leading-snug">
						{val(candidate.jobTitle)}
					</div>
				</td>

				{/* Skills with Scrollable Container */}
				<td className="w-48 px-6 py-4 align-top">
					<div className="h-16 overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-600 [scrollbar-width:thin] [scrollbar-color:#334155_transparent]">
						<p className="text-sm text-slate-300 leading-relaxed">
							{candidate.skills
								? candidate.skills
										.split(",")
										.map((s) =>
											s.trim().replace(/\b\w/g, (l) => l.toUpperCase()),
										)
										.join(", ")
								: "-"}
						</p>
					</div>
				</td>

				{/* Company Name */}
				<td className="w-40 px-6 py-4 align-top">
					<div className="text-slate-300 text-sm break-words">
						{val(candidate.company)}
					</div>
				</td>

				{/* Experience */}
				<td className="w-32 px-6 py-4 align-top">
					<div className="text-slate-400 text-sm break-words">
						{val(candidate.experience)}
					</div>
				</td>

				{/* Contact with Icons */}
				<td className="w-40 px-6 py-4 align-top">
					<div className="flex gap-1.5 flex-wrap">
						{candidate.phone && (
							<div className="relative group/icon">
								<button
									onClick={() =>
										window.open(`tel:${candidate.phone}`, "_blank")
									}
									className="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-slate-800 hover:scale-110 rounded-lg transition-all duration-200">
									<Phone size={16} />
								</button>
								<div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover/icon:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
									{candidate.phone}
								</div>
							</div>
						)}
						{candidate.email && (
							<div className="relative group/icon">
								<button
									onClick={() =>
										window.open(`mailto:${candidate.email}`, "_blank")
									}
									className="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-slate-800 hover:scale-110 rounded-lg transition-all duration-200">
									<Mail size={16} />
								</button>
								<div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover/icon:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
									{candidate.email}
								</div>
							</div>
						)}
						{candidate.linkedinUrl && (
							<div className="relative group/icon">
								<button
									onClick={() => {
										let url = candidate.linkedinUrl;
										if (!url.startsWith("http")) url = "https://" + url;
										window.open(url, "_blank");
									}}
									className="p-1.5 text-slate-400 hover:text-[#0077b5] hover:bg-slate-800 hover:scale-110 rounded-lg transition-all duration-200">
									<Linkedin size={16} />
								</button>
								<div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover/icon:opacity-100 transition-opacity pointer-events-none whitespace-nowrap max-w-xs truncate z-50">
									{candidate.linkedinUrl.replace(/^https?:\/\//, "")}
								</div>
							</div>
						)}

						{/* Location */}
						{(candidate.locality || candidate.location) && (
							<div className="relative group/icon">
								<button
									className="p-1.5 rounded-lg text-slate-400 
						hover:text-rose-500 hover:bg-slate-800 hover:scale-110
						transition-all duration-200">
									<MapPin size={15} />
								</button>
								<div
									className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2
					max-w-xs truncate
					px-2 py-1 rounded bg-slate-900 text-white text-[11px]
					opacity-0 group-hover/icon:opacity-100 transition-opacity
					pointer-events-none shadow-lg z-50">
									{formatLocation(candidate.locality, candidate.location)}
								</div>
							</div>
						)}
					</div>
				</td>

				{/* Actions */}
				<td className="w-32 px-6 py-4 align-top">
					<div className="flex justify-end gap-1">
						<button
							onClick={(e) => onQuickView(candidate, e)}
							className="p-2 text-slate-400 hover:text-indigo-400 hover:bg-slate-800 hover:scale-110 rounded-lg transition-all duration-200"
							title="View">
							<Eye size={16} />
						</button>
						<button
							onClick={(e) => onDownload(candidate._id, e)}
							className="p-2 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 hover:scale-110 rounded-lg transition-all duration-200"
							title="Download Resume">
							<Download size={16} />
						</button>
						{isAdmin && (
							<button
								onClick={(e) => onDelete(candidate._id, e)}
								disabled={isDeleting}
								className="p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-800 hover:scale-110 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
								title="Delete">
								{isDeleting ? (
									<Loader className="animate-spin" size={16} />
								) : (
									<Trash2 size={16} />
								)}
							</button>
						)}
					</div>
				</td>
			</tr>
		);
	},
);

// Professional Personal Card Design Modal
const ProfileModal = React.memo(({ profile, onClose, onDownload }) => (
	<div
		className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 transition-opacity duration-300"
		onClick={onClose}>
		<div
			className="w-full max-w-4xl max-h-[90vh] bg-slate-900 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden animate-slide-up flex flex-col border border-slate-800"
			onClick={(e) => e.stopPropagation()}>
			{/* Header */}
			<div className="bg-slate-900 border-b border-slate-800 p-8 relative">
				<div className="flex justify-between items-start">
					<div>
						<h1 className="text-3xl font-bold text-white mb-2 tracking-tight">
							{profile.fullName}
						</h1>
						<div className="flex items-center gap-4 text-slate-300 font-medium">
							{profile.jobTitle && (
								<div className="flex items-center gap-2">
									<Briefcase size={18} className="text-slate-200" />
									<span>{profile.jobTitle}</span>
								</div>
							)}
							{profile.company && (
								<div className="flex items-center gap-2">
									<Building size={18} className="text-slate-200" />
									<span>{profile.company}</span>
								</div>
							)}
							{profile.experience && (
								<div className="flex items-center gap-2">
									<Calendar size={18} className="text-slate-200" />
									<span>Expereince: {profile.experience}</span>
								</div>
							)}
						</div>
					</div>
					<button
						onClick={onClose}
						className="text-slate-400 hover:text-white p-2 rounded-full hover:bg-slate-800 transition-colors absolute top-6 right-6">
						<X size={24} />
					</button>
				</div>
			</div>

			{/* Body */}
			<div className="p-8 overflow-y-auto flex-1 bg-slate-950/50 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-slate-900 [&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-600 [scrollbar-width:thin] [scrollbar-color:#334155_#0f172a]">
				<div className="grid grid-cols-1 lg:grid-cols-3 gap-8 min-h-0">
					{/* Left Column - Contact Info */}
					<div className="lg:col-span-1 space-y-6">
						{/* Contact Card */}
						<div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5 shadow-sm">
							<h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2 mb-4">
								{/* <span className="bg-blue-100 p-2 rounded-lg">
									<Mail className="text-blue-600" size={20} />
								</span> */}
								Contact Information
							</h3>
							<div className="space-y-3">
								{profile.email && (
									<div className="flex items-start gap-3">
										<Mail
											className="text-slate-400 mt-0.5 flex-shrink-0"
											size={18}
										/>
										<div>
											<p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-0.5">
												Email
											</p>
											<a
												href={`mailto:${profile.email}`}
												className="text-indigo-400 hover:text-indigo-300 break-all font-medium">
												{profile.email}
											</a>
										</div>
									</div>
								)}
								{profile.phone && (
									<div className="flex items-start gap-3">
										<Phone
											className="text-slate-400 mt-0.5 flex-shrink-0"
											size={18}
										/>
										<div>
											<p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-0.5">
												Phone
											</p>
											<a
												href={`tel:${profile.phone}`}
												className="text-slate-300 hover:text-indigo-400 font-medium">
												{profile.phone}
											</a>
										</div>
									</div>
								)}
								{(profile.locality || profile.location) && (
									<div className="flex items-start gap-3">
										<MapPin
											className="text-slate-400 mt-0.5 flex-shrink-0"
											size={18}
										/>
										<div>
											<p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-0.5">
												Location
											</p>
											<p className="text-slate-300 font-medium">
												{formatLocation(profile.locality, profile.location)}
											</p>
										</div>
									</div>
								)}
							</div>
						</div>

						{/* Experience & Industry */}
						<div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-sm">
							<h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2 mb-4">
								<span className="bg-indigo-900/50 p-1.5 rounded-lg">
									<Award className="text-indigo-600" size={16} />
								</span>
								Professional Details
							</h3>
							<div className="space-y-3">
								{profile.experience && (
									<div className="flex items-start gap-3">
										<div>
											<p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-0.5">
												Experience
											</p>
											<p className="text-slate-300 font-medium">
												{profile.experience}
											</p>
										</div>
									</div>
								)}
								{profile.industry && (
									<div>
										<p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-0.5">
											Industry
										</p>
										<p className="text-slate-300 font-medium capitalize">
											{profile.industry.toLowerCase()}
										</p>
									</div>
								)}
								{profile.gender && (
									<div>
										<p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-0.5">
											Gender
										</p>
										<p className="text-slate-300 font-medium">
											{profile.gender}
										</p>
									</div>
								)}
							</div>
						</div>
					</div>

					{/* Right Column - Skills */}
					<div className="lg:col-span-2">
						<div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 h-full flex flex-col shadow-sm">
							<h3 className="text-lg font-bold text-slate-200 mb-6 flex items-center gap-3 flex-shrink-0">
								<span className="bg-emerald-900/30 p-2 rounded-xl">
									<Award className="text-emerald-600" size={24} />
								</span>
								Skills & Expertise
							</h3>
							<div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-slate-900 [&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-600 [scrollbar-width:thin] [scrollbar-color:#334155_#0f172a]">
								{profile.skills ? (
									<div className="flex flex-wrap gap-2">
										{profile.skills.split(",").map((skill, i) => (
											<span
												key={i}
												className="inline-flex items-center px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-sm font-medium hover:bg-slate-700 hover:border-indigo-500 hover:text-indigo-400 transition-all duration-200 cursor-default">
												{skill.trim().replace(/\b\w/g, (l) => l.toUpperCase())}
											</span>
										))}
									</div>
								) : (
									<p className="text-slate-400 italic">No skills listed</p>
								)}
							</div>

							{/* Download Button */}
							<div className="mt-8 pt-6 border-t border-slate-800 flex-shrink-0">
								<button
									onClick={(e) => {
										e.stopPropagation();
										onDownload(profile._id, e);
									}}
									className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-4 rounded-xl font-bold shadow-lg shadow-indigo-900/20 hover:shadow-xl hover:shadow-indigo-900/30 transition-all flex items-center justify-center gap-3 transform active:scale-[0.99]">
									<Download size={20} />
									Download Full Profile
									<ExternalLink size={18} />
								</button>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
));

export default UserSearch;

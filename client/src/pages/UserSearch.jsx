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
import axios from "axios";
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
} from "lucide-react";
import toast from "react-hot-toast";

const PAGE_SIZE = 60; // Increased page size for better initial load

// Helper to format location (Capitalize & Deduplicate)
const formatLocation = (locality, location) => {
	const raw = [locality, location].filter(Boolean).join(", ");
	const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
	const unique = [];
	const seen = new Set();

	for (const part of parts) {
		const lower = part.toLowerCase();
		if (!seen.has(lower)) {
			seen.add(lower);
			// Capitalize first letter of each word
			unique.push(
				part.toLowerCase().replace(/(?:^|\s)\S/g, (a) => a.toUpperCase())
			);
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

const UserSearch = () => {
	const { user } = useContext(AuthContext);
	const queryClient = useQueryClient();
	const [selectedProfile, setSelectedProfile] = useState(null);
	const [selectedIds, setSelectedIds] = useState(new Set());
	const [searchInput, setSearchInput] = useState("");
	const [filters, setFilters] = useState({
		location: "",
		jobTitle: "",
		skills: "",
		hasEmail: false,
		hasPhone: false,
	});
	const [filtersVisible, setFiltersVisible] = useState(true);

	const debouncedSearch = useDebounce(searchInput, 500);

	const queryFilters = useMemo(
		() => ({
			q: debouncedSearch,
			locality: filters.location,
			jobTitle: filters.jobTitle,
			skills: filters.skills,
			hasEmail: filters.hasEmail,
			hasPhone: filters.hasPhone,
		}),
		[debouncedSearch, filters],
	);

	const queryKey = useMemo(() => ["candidates", queryFilters], [queryFilters]);

	const { ref: loadMoreRef, inView } = useInView({
		threshold: 0.1,
		triggerOnce: false,
		rootMargin: '100px', // Start loading 100px before the element is visible
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

			const response = await axios.get(`/candidates/search?${params}`);
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

		window.addEventListener('candidatesUpdated', handleCandidatesUpdated);
		return () => {
			window.removeEventListener('candidatesUpdated', handleCandidatesUpdated);
		};
	}, [queryClient, refetch]);

	const candidates = useMemo(() => {
		if (!data?.pages) return [];
		return data.pages.flatMap((page) => page.candidates || []);
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
		});
		setSelectedIds(new Set());
	}, []);

	// Bulk delete mutation
	const bulkDeleteMutation = useMutation({
		mutationFn: async (ids) => {
			const idsArray = Array.from(ids);
			await Promise.all(
				idsArray.map((id) => axios.delete(`/candidates/${id}`)),
			);
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
			await axios.delete(`/candidates/${id}`);
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
			
			const response = await axios.post('/candidates/export', {
				ids: Array.from(selectedIds)
			}, {
				responseType: 'blob'
			});

			const url = window.URL.createObjectURL(new Blob([response.data]));
			const link = document.createElement('a');
			link.href = url;
			link.setAttribute('download', `candidates_export_${new Date().toISOString().split('T')[0]}.csv`);
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
			const response = await axios.get(`/candidates/${candidateId}/download`, {
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
			<div className="flex flex-col items-center justify-center h-[calc(100vh-65px)] p-4">
				<div className="text-red-500 text-lg mb-4">
					Error: {error?.message || "Failed to load candidates"}
				</div>
				<button
					onClick={() => refetch()}
					className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
					Retry
				</button>
			</div>
		);
	}

	const hasActiveFilters =
		searchInput ||
		Object.values(filters).some((v) => v && v !== false && v !== "");

	return (
		<div className="flex flex-col h-[calc(100vh-64px)] bg-gray-50 text-gray-800">

			{/* Fixed Filters Header - Stays below admin header */}
			<div className="sticky top-0 z-40 bg-white border-b border-gray-200">
	<div className="px-4 py-1.5 space-y-2">

					{/* Filters Toggle */}
					<div className="flex items-center justify-between h-9">

						<div className="flex items-center gap-2 text-sm font-semibold text-gray-700 uppercase tracking-wide">
							<Filter size={16} />
							<span>Search & Filters</span>
						</div>
						<div className="flex items-center gap-4">
							<span className="text-sm text-gray-600">
								Showing{" "}
								<span className="font-semibold">{candidates.length}</span> of{" "}
								<span className="font-semibold">{totalCount}</span> candidates
							</span>
							<button
								onClick={() => setFiltersVisible(!filtersVisible)}
								className="text-gray-500 hover:text-gray-700">
								{filtersVisible ? (
									<ChevronUp size={18} />
								) : (
									<ChevronDown size={18} />
								)}
							</button>
						</div>
					</div>

					{/* Collapsible Filters */}
{filtersVisible && (
	<div className="flex items-center gap-2 w-full overflow-x-auto bg-white border border-gray-200 rounded-xl px-4 py-3 scrollbar-hide shadow-sm">

		{/* Search Bar */}
		<div className="relative min-w-[260px]">
			<Search
				className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
				size={18}
			/>
			<input
				placeholder="Search by name, keywords..."
				className="w-full pl-10 pr-9 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 placeholder-gray-400 focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 outline-none transition-all"
				value={searchInput}
				onChange={handleSearchChange}
			/>
			{searchInput && (
				<button
					onClick={() => setSearchInput("")}
					className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
					<X size={16} />
				</button>
			)}
		</div>

		{/* Job Title */}
		<input
			placeholder="Job Title"
			className="min-w-[160px] px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 placeholder-gray-400 focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 outline-none transition-all"
			value={filters.jobTitle}
			onChange={(e) =>
				handleFilterChange("jobTitle", e.target.value)
			}
		/>

		{/* Location */}
		<input
			placeholder="Location"
			className="min-w-[160px] px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 placeholder-gray-400 focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 outline-none transition-all"
			value={filters.location}
			onChange={(e) =>
				handleFilterChange("location", e.target.value)
			}
		/>

		{/* Skills */}
		<input
			placeholder="Skills"
			className="min-w-[160px] px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 placeholder-gray-400 focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 outline-none transition-all"
			value={filters.skills}
			onChange={(e) =>
				handleFilterChange("skills", e.target.value)
			}
		/>

		{/* Divider */}
		<div className="h-8 w-px bg-gray-200 mx-2" />

		{/* Email Filter */}
		<button
			onClick={() =>
				handleFilterChange("hasEmail", !filters.hasEmail)
			}
			className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap border ${
				filters.hasEmail
					? "bg-slate-900 text-white border-slate-900 shadow-md"
					: "bg-white text-gray-600 border-gray-200 hover:bg-gray-50 hover:border-gray-300"
			}`}>
			@ Email
		</button>

		{/* Phone Filter */}
		<button
			onClick={() =>
				handleFilterChange("hasPhone", !filters.hasPhone)
			}
			className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap border ${
				filters.hasPhone
					? "bg-slate-900 text-white border-slate-900 shadow-md"
					: "bg-white text-gray-600 border-gray-200 hover:bg-gray-50 hover:border-gray-300"
			}`}>
			📞 Phone
		</button>

		{/* Clear Filters */}
		{hasActiveFilters && (
			<button
				onClick={clearAllFilters}
				className="ml-auto text-xs text-slate-400 hover:text-red-400 whitespace-nowrap">
				Clear all filters
			</button>
		)}
	</div>
)}


					{/* Bulk Actions Bar */}
					{selectedIds.size > 0 && (
						<div className="flex items-center justify-between px-3 py-2 bg-blue-50 border border-blue-200 rounded-md mt-1">

							<span className="text-sm font-medium text-blue-900">
								{selectedIds.size} candidate{selectedIds.size > 1 ? "s" : ""}{" "}
								selected
							</span>
							<div className="flex gap-2">
								<button
									onClick={handleCancelSelection}
									className="flex items-center gap-1 px-4 py-1.5 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors">
									<X size={16} />
									Cancel
								</button>
								<button
									onClick={handleExport}
									className="flex items-center gap-1 px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors">
									<Download size={16} />
									Export
								</button>
								{user?.role === "ADMIN" && (
									<button
										onClick={handleBulkDelete}
										disabled={bulkDeleteMutation.isPending}
										className="flex items-center gap-1 px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
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
			</div>

			{/* Table Container - Scrollable area starting below filters and table head */}
			<div className="flex-1 overflow-auto">
				{isLoading && !data ? (
					<div className="flex items-center justify-center h-[calc(100vh-180px)]">
						<div className="text-center">
							<Loader className="animate-spin h-12 w-12 text-blue-600 mx-auto mb-4" />
							<p className="text-gray-500">Loading candidates...</p>
						</div>
					</div>
				) : candidates.length === 0 ? (
					<div className="flex flex-col items-center justify-center h-[calc(100vh-200px)] space-y-4">
						<p className="text-gray-500 text-lg">No candidates found</p>
						<p className="text-gray-400 text-sm">Try adjusting your filters</p>
					</div>
				) : (
					<div className="mx-4 mt-2 mb-1">

						{/* Table with fixed header and scrollable body */}
						<div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
							{/* Single table with sticky header */}
							<div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 170px)' }}>

								<table className="w-full table-fixed">
									<thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-30">
										<tr>
											<th className="w-12 px-6 py-4 text-left bg-gray-50 border-b border-gray-200">
												<input
													type="checkbox"
													className="h-4 w-4 text-slate-900 border-gray-300 rounded focus:ring-slate-900 cursor-pointer transition"
													checked={
														selectedIds.size > 0 &&
														selectedIds.size === candidates.length
													}
													onChange={(e) => handleSelectAll(e.target.checked)}
												/>
											</th>
											<th className="w-48 px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">
												Full Name
											</th>
											<th className="w-40 px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">
												Job Title
											</th>
											<th className="w-48 px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">
												Skills
											</th>
											<th className="w-40 px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">
												Company Name
											</th>
											<th className="w-32 px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">
												Experience
											</th>
											<th className="w-40 px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">
												Contact
											</th>
											<th className="w-32 px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">
												Actions
											</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-gray-200 bg-white">
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
															<Loader className="animate-spin h-4 w-4 text-blue-600" />
															<span className="text-sm text-gray-500">
																Loading more candidates...
															</span>
														</div>
													) : hasNextPage ? (
														<span className="text-sm text-gray-400">
															Scroll down to load more
														</span>
													) : candidates.length > 0 ? (
														<span className="text-sm text-gray-400 py-4">
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
								<Loader className="animate-spin h-6 w-6 text-blue-600 mr-2" />
								<span className="text-sm text-gray-500">Loading...</span>
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
				className={`group hover:bg-gray-50 transition-all duration-200 border-b border-gray-100 last:border-none ${
					isSelected ? "bg-slate-50" : ""
				}`}>
				{/* Checkbox */}
				<td className="px-6 py-4">
					<input
						type="checkbox"
						className="h-4 w-4 text-slate-900 border-gray-300 rounded focus:ring-slate-900 cursor-pointer transition"
						checked={isSelected}
						onChange={(e) => onSelect(candidate._id, e.target.checked)}
					/>
				</td>

				{/* Name */}
				<td className="w-48 px-6 py-4">
					<div className="font-semibold text-gray-900 break-words">
						{val(candidate.fullName)}
					</div>
				</td>

				{/* Job Title */}
				<td className="w-40 px-6 py-4">
					<div className="text-gray-600 font-medium break-words">
						{val(candidate.jobTitle)}
					</div>
				</td>

				{/* Skills with Scrollable Container */}
				<td className="w-48 px-6 py-4">
					<div className="max-h-10 overflow-y-auto">
						<div className="flex flex-wrap gap-1.5">
							{candidate.skills
								? candidate.skills
										.split(",")
										.slice(0, 3)
										.map((skill, i) => (
											<span
												key={i}
												className="inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-medium bg-white border border-gray-200 text-gray-600 shadow-sm">
												{skill.trim()}
											</span>
										))
								: "-"}
							{candidate.skills && candidate.skills.split(",").length > 3 && (
								<span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-gray-50 text-gray-500 border border-gray-200">
									+{candidate.skills.split(",").length - 3}
								</span>
							)}
						</div>
					</div>
				</td>

				{/* Company Name */}
				<td className="w-40 px-6 py-4">
					<div className="text-gray-900 font-medium break-words">
						{val(candidate.company)}
					</div>
				</td>

				{/* Experience */}
				<td className="w-32 px-6 py-4">
					<div className="text-gray-600 break-words">
						{val(candidate.experience)}
					</div>
				</td>

				{/* Contact with Icons */}
				<td className="w-40 px-6 py-4">
					<div className="flex gap-1 flex-wrap">
						{candidate.phone && (
							<div className="relative group">
								<button
									onClick={() => window.open(`tel:${candidate.phone}`, '_blank')}
									className="p-1.5 text-gray-400 hover:text-slate-900 hover:bg-gray-100 rounded-lg transition-all"
									>
									<Phone size={16} />
								</button>
								<div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
									 {candidate.phone}
								</div>
							</div>
						)}
						{candidate.email && (
							<div className="relative group">
								<button
									onClick={() => window.open(`mailto:${candidate.email}`, '_blank')}
									className="p-1.5 text-gray-400 hover:text-slate-900 hover:bg-gray-100 rounded-lg transition-all"
									>
									<Mail size={16} />
								</button>
								<div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
									 {candidate.email}
								</div>
							</div>
						)}
						{candidate.linkedinUrl && (
							<div className="relative group">
								<button
									onClick={() => {
										let url = candidate.linkedinUrl;
										if (!url.startsWith('http')) url = 'https://' + url;
										window.open(url, '_blank');
									}}
									className="p-1.5 text-gray-400 hover:text-[#0077b5] hover:bg-blue-50 rounded-lg transition-all"
									>
									<Linkedin size={16} />
								</button>
								<div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap max-w-xs truncate">
									{candidate.linkedinUrl.replace(/^https?:\/\//, '')}
								</div>
							</div>
						)}

						{/* Location */}
		{(candidate.locality || candidate.location) && (
			<div className="relative group">
				<button
					className="p-1.5 rounded-lg text-gray-400 
						hover:text-slate-900 hover:bg-gray-100 
						transition-colors"
				>
					<MapPin size={15} />
				</button>
				<div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2
					max-w-xs truncate
					px-2 py-1 rounded bg-slate-900 text-white text-[11px]
					opacity-0 group-hover:opacity-100 transition-opacity
					pointer-events-none shadow-lg">
					{formatLocation(candidate.locality, candidate.location)}
				</div>
			</div>
		)}
					</div>
				</td>

				{/* Actions */}
				<td className="w-32 px-6 py-4">
					<div className="flex justify-end gap-2">
						<button
							onClick={(e) => onQuickView(candidate, e)}
							className="p-1.5 text-gray-400 hover:text-slate-900 hover:bg-gray-100 rounded-lg transition-all"
							title="View">
							<Eye size={16} />
						</button>
						<button
							onClick={(e) => onDownload(candidate._id, e)}
							className="p-1.5 text-gray-400 hover:text-slate-900 hover:bg-gray-100 rounded-lg transition-all"
							title="Download Resume">
							<Download size={16} />
						</button>
						{isAdmin && (
							<button
								onClick={(e) => onDelete(candidate._id, e)}
								disabled={isDeleting}
								className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
		className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
		onClick={onClose}>
		<div
			className="w-full max-w-4xl max-h-[90vh] bg-white rounded-2xl shadow-2xl overflow-hidden animate-slide-up flex flex-col"
			onClick={(e) => e.stopPropagation()}>
			{/* Header */}
			<div className="bg-white border-b border-gray-100 p-8">
				<div className="flex justify-between items-start">
					<div>
						<h1 className="text-3xl font-bold text-gray-900 mb-2">
							{profile.fullName}
						</h1>
						<div className="flex items-center gap-4 text-gray-600">
							{profile.jobTitle && (
								<div className="flex items-center gap-2">
									<Briefcase size={16} />
									<span>{profile.jobTitle}</span>
								</div>
							)}
							{profile.company && (
								<div className="flex items-center gap-2">
									<Building size={16} />
									<span>{profile.company}</span>
								</div>
							)}
							{profile.experience && (
								<div className="flex items-center gap-2">
									<span>Expereince: {profile.experience}</span>
								</div>
							)}
						</div>
					</div>
					<button
						onClick={onClose}
						className="text-gray-400 hover:text-gray-900 p-2 rounded-full hover:bg-gray-100 transition-colors">
						<X size={24} />
					</button>
				</div>
			</div>

			{/* Body */}
			<div className="p-8 overflow-y-auto flex-1">
				<div className="grid grid-cols-1 lg:grid-cols-3 gap-8 min-h-0">
					{/* Left Column - Contact Info */}
					<div className="lg:col-span-1 space-y-6">
						{/* Contact Card */}
						<div className="bg-gray-50 rounded-xl p-6 space-y-4">
							<h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
								{/* <span className="bg-blue-100 p-2 rounded-lg">
									<Mail className="text-blue-600" size={20} />
								</span> */}
								Contact Information
							</h3>
							<div className="space-y-3">
								{profile.email && (
									<div className="flex items-start gap-3">
										<Mail
											className="text-gray-400 mt-1 flex-shrink-0"
											size={18}
										/>
										<div>
											<p className="text-sm text-gray-500">Email</p>
											<a
												href={`mailto:${profile.email}`}
												className="text-blue-600 hover:text-blue-800 break-all">
												{profile.email}
											</a>
										</div>
									</div>
								)}
								{profile.phone && (
									<div className="flex items-start gap-3">
										<Phone
											className="text-gray-400 mt-1 flex-shrink-0"
											size={18}
										/>
										<div>
											<p className="text-sm text-gray-500">Phone</p>
											<a
												href={`tel:${profile.phone}`}
												className="text-gray-900 hover:text-blue-600">
												{profile.phone}
											</a>
										</div>
									</div>
								)}
								{(profile.locality || profile.location) && (
									<div className="flex items-start gap-3">
										<MapPin
											className="text-gray-400 mt-1 flex-shrink-0"
											size={18}
										/>
										<div>
											<p className="text-sm text-gray-500">Location</p>
											<p className="text-gray-900">
												{formatLocation(profile.locality, profile.location)}
											</p>
										</div>
									</div>
								)}
							</div>
						</div>

						{/* Experience & Industry */}
						<div className="bg-gray-50 rounded-xl p-6 space-y-4">
							<h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
								<span className="bg-indigo-100 p-2 rounded-lg">
									<Award className="text-indigo-600" size={20} />
								</span>
								Professional Details
							</h3>
							<div className="space-y-3">
								{profile.experience && (
									<div className="flex items-start gap-3">
										<Calendar
											className="text-gray-400 mt-1 flex-shrink-0"
											size={18}
										/>
										<div>
											<p className="text-sm text-gray-500">Experience</p>
											<p className="text-gray-900">
												{profile.experience} years
											</p>
										</div>
									</div>
								)}
								{profile.industry && (
									<div>
										<p className="text-sm text-gray-500">Industry</p>
										<p className="text-gray-900 capitalize">{profile.industry.toLowerCase()}</p>
									</div>
								)}
								{profile.gender && (
									<div>
										<p className="text-sm text-gray-500">Gender</p>
										<p className="text-gray-900">{profile.gender}</p>
									</div>
								)}

							</div>
						</div>
					</div>

					{/* Right Column - Skills */}
					<div className="lg:col-span-2">
						<div className="bg-gray-50 rounded-xl p-6 h-full flex flex-col">
							<h3 className="text-lg font-semibold text-gray-900 mb-6 flex items-center gap-2 flex-shrink-0">
								<span className="bg-green-100 p-2 rounded-lg">
									<Award className="text-green-600" size={20} />
								</span>
								Skills & Expertise
							</h3>
							<div className="flex-1 overflow-y-auto">
								{profile.skills ? (
									<div className="flex flex-wrap gap-3">
										{profile.skills.split(",").map((skill, i) => (
											<span
												key={i}
												className="inline-flex items-center px-4 py-1.5 rounded-full bg-white border border-gray-200 text-gray-700 text-sm font-medium shadow-sm hover:border-gray-300 transition-colors">
												{skill.trim()}
											</span>
										))}
									</div>
								) : (
									<p className="text-gray-500 italic">No skills listed</p>
								)}
							</div>

							{/* Download Button */}
							<div className="mt-8 pt-6 border-t border-gray-200 flex-shrink-0">
								<button
									onClick={(e) => {
										e.stopPropagation();
										onDownload(profile._id, e);
									}}
									className="w-full bg-slate-900 hover:bg-black text-white py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-3">
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
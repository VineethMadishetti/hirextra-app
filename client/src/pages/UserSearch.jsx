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
		staleTime: 10 * 60 * 1000,
		gcTime: 30 * 60 * 1000,
		refetchOnWindowFocus: false,
		refetchOnMount: false,
		refetchOnReconnect: false,
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
			// Invalidate all candidate queries to refresh the table
			queryClient.invalidateQueries({ queryKey: ["candidates"] });
			toast.success("New candidates available! Refreshing...");
		};

		window.addEventListener('candidatesUpdated', handleCandidatesUpdated);
		return () => {
			window.removeEventListener('candidatesUpdated', handleCandidatesUpdated);
		};
	}, [queryClient]);

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
		<div className="flex flex-col h-[calc(100vh-72px)] bg-gray-50 text-gray-800">
			{/* Fixed Filters Header - Stays below admin header */}
			<div className="sticky z-40 bg-white border-b border-gray-200">
				<div className="p-4 space-y-3">
					{/* Filters Toggle */}
					<div className="flex items-center justify-between">
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
						<>
							{/* Search Bar */}
							<div className="relative">
								<Search
									className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
									size={18}
								/>
								<input
									placeholder="Search by name, keywords..."
									className="w-full pl-10 pr-10 py-3 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
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

							{/* Quick Filters */}
							<div className="flex flex-wrap items-center gap-2">
								<input
									placeholder="Job Title"
									className="flex-1 min-w-[140px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
									value={filters.jobTitle}
									onChange={(e) =>
										handleFilterChange("jobTitle", e.target.value)
									}
								/>
								<input
									placeholder="Location"
									className="flex-1 min-w-[140px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
									value={filters.location}
									onChange={(e) =>
										handleFilterChange("location", e.target.value)
									}
								/>
								<input
									placeholder="Skills"
									className="flex-1 min-w-[140px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
									value={filters.skills}
									onChange={(e) => handleFilterChange("skills", e.target.value)}
								/>

								<div className="flex gap-2 border-l border-gray-300 pl-3">
									<button
										onClick={() =>
											handleFilterChange("hasEmail", !filters.hasEmail)
										}
										className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
											filters.hasEmail
												? "bg-blue-600 text-white shadow-md"
												: "bg-gray-100 text-gray-600 hover:bg-gray-200"
										}`}>
										@ Email
									</button>
									<button
										onClick={() =>
											handleFilterChange("hasPhone", !filters.hasPhone)
										}
										className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
											filters.hasPhone
												? "bg-blue-600 text-white shadow-md"
												: "bg-gray-100 text-gray-600 hover:bg-gray-200"
										}`}>
										📞 Phone
									</button>
								</div>

								{hasActiveFilters && (
									<button
										onClick={clearAllFilters}
										className="px-3 py-2 text-xs text-gray-600 hover:text-gray-800 underline">
										Clear all filters
									</button>
								)}
							</div>
						</>
					)}

					{/* Bulk Actions Bar */}
					{selectedIds.size > 0 && (
						<div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg mt-2">
							<span className="text-sm font-medium text-blue-900">
								{selectedIds.size} candidate{selectedIds.size > 1 ? "s" : ""}{" "}
								selected
							</span>
							<div className="flex gap-2">
								<button
									onClick={handleCancelSelection}
									className="flex items-center gap-1 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors">
									<X size={16} />
									Cancel
								</button>
								<button
									onClick={handleExport}
									className="flex items-center gap-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors">
									<Download size={16} />
									Export
								</button>
								{user?.role === "ADMIN" && (
									<button
										onClick={handleBulkDelete}
										disabled={bulkDeleteMutation.isPending}
										className="flex items-center gap-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
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
					<div className="flex items-center justify-center h-[calc(100vh-200px)]">
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
					<div className="mx-4 my-4">
						{/* Table with fixed header and scrollable body */}
						<div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
							{/* Single table with sticky header */}
							<div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 250px)' }}>
								<table className="w-full table-fixed">
									<thead className="bg-slate-900 sticky top-0 z-30">
										<tr>
											<th className="w-12 px-4 py-3 text-left bg-slate-900">
												<input
													type="checkbox"
													className="h-4 w-4 text-blue-600 rounded cursor-pointer"
													checked={
														selectedIds.size > 0 &&
														selectedIds.size === candidates.length
													}
													onChange={(e) => handleSelectAll(e.target.checked)}
												/>
											</th>
											<th className="w-48 px-4 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
												Name
											</th>
											<th className="w-40 px-4 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
												Job Title
											</th>
											<th className="w-48 px-4 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
												Skills
											</th>
											<th className="w-32 px-4 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
												Location
											</th>
											<th className="w-32 px-4 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
												Contact
											</th>
											<th className="w-32 px-4 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
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
				className={`hover:bg-gray-50 transition-colors ${
					isSelected ? "bg-blue-50" : ""
				}`}>
				{/* Checkbox */}
				<td className="px-4 py-3">
					<input
						type="checkbox"
						className="h-4 w-4 text-blue-600 rounded cursor-pointer"
						checked={isSelected}
						onChange={(e) => onSelect(candidate._id, e.target.checked)}
					/>
				</td>

				{/* Name */}
				<td className="w-48 px-4 py-3">
					<div className="font-medium text-gray-900 break-words">
						{val(candidate.fullName)}
					</div>
				</td>

				{/* Job Title */}
				<td className="w-40 px-4 py-3">
					<div className="text-gray-700 break-words">
						{val(candidate.jobTitle)}
					</div>
				</td>

				{/* Skills with Scrollable Container */}
				<td className="w-48 px-4 py-3">
					<div className="max-h-10 overflow-y-auto">
						<div className="flex flex-wrap gap-1">
							{candidate.skills
								? candidate.skills
										.split(",")
										.slice(0, 3)
										.map((skill, i) => (
											<span
												key={i}
												className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
												{skill.trim()}
											</span>
										))
								: "-"}
							{candidate.skills && candidate.skills.split(",").length > 3 && (
								<span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
									+{candidate.skills.split(",").length - 3}
								</span>
							)}
						</div>
					</div>
				</td>

				{/* Location */}
				<td className="w-32 px-4 py-3">
					<div className="text-gray-700 break-words">
						{val(candidate.location) || [val(candidate.locality), val(candidate.country)].filter(Boolean).join(', ') || "-"}
					</div>
				</td>

				{/* Contact */}
				<td className="w-32 px-4 py-3">
					<div className="flex gap-2">
						{candidate.email && (
							<div className="relative group">
								<button
									onClick={() => window.open(`mailto:${candidate.email}`, '_blank')}
									className="p-1 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-md transition-colors">
									<Mail size={16} />
								</button>
								<div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
									{candidate.email}
								</div>
							</div>
						)}
						{candidate.phone && (
							<div className="relative group">
								<button
									onClick={() => window.open(`tel:${candidate.phone}`, '_blank')}
									className="p-1 text-gray-400 hover:text-green-500 hover:bg-green-50 rounded-md transition-colors">
									<Phone size={16} />
								</button>
								<div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
									{candidate.phone}
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
									className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors">
									<Linkedin size={16} />
								</button>
								<div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap max-w-xs truncate">
									{candidate.linkedinUrl}
								</div>
							</div>
						)}
					</div>
				</td>

				{/* Actions with Proper Hover Colors */}
				<td className="w-32 px-4 py-3">
					<div className="flex justify-end gap-3">
						<button
							onClick={(e) => onQuickView(candidate, e)}
							className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-md transition-colors"
							title="Quick View">
							<Eye size={16} />
						</button>
						<button
							onClick={(e) => onDownload(candidate._id, e)}
							className="p-1.5 text-gray-400 hover:text-green-500 hover:bg-green-50 rounded-md transition-colors"
							title="Download">
							<Download size={16} />
						</button>
						{isAdmin && (
							<button
								onClick={(e) => onDelete(candidate._id, e)}
								disabled={isDeleting}
								className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
			<div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 p-8">
				<div className="flex justify-between items-start">
					<div>
						<h1 className="text-3xl font-bold text-white mb-2">
							{profile.fullName}
						</h1>
						<div className="flex items-center gap-4 text-white/90">
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
						</div>
					</div>
					<button
						onClick={onClose}
						className="text-white/80 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors">
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
								<span className="bg-blue-100 p-2 rounded-lg">
									<Mail className="text-blue-600" size={20} />
								</span>
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
								{(profile.locality || profile.country || profile.location) && (
									<div className="flex items-start gap-3">
										<MapPin
											className="text-gray-400 mt-1 flex-shrink-0"
											size={18}
										/>
										<div>
											<p className="text-sm text-gray-500">Location</p>
											<p className="text-gray-900">
												{profile.location || [profile.locality, profile.country].filter(Boolean).join(', ')}
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
										<p className="text-gray-900">{profile.industry}</p>
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
												className="inline-flex items-center px-4 py-1.5 rounded-full bg-slate-800 text-slate-100 text-sm font-medium hover:bg-slate-900 transition-colors">
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
									className="w-full bg-gradient-to-r from-blue-800 to-indigo-900 hover:from-blue-900 hover:to-indigo-900 text-white py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-3">
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
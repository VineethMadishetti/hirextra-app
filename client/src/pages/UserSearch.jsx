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
	keepPreviousData,
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
	RefreshCw,
	Sparkles,
} from "lucide-react";
import toast from "react-hot-toast";
import FilterImage from "../assets/filtering.svg";

const PAGE_SIZE = 100; // Increased to load more data at once

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

const normalizeLocationFilterForApi = (value) => {
	if (!value) return "";

	const terms = String(value)
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean)
		.filter((t) => t.length >= 2)
		.slice(0, 30);

	const unique = [];
	const seen = new Set();
	for (const term of terms) {
		const key = term.toLowerCase();
		if (!seen.has(key)) {
			seen.add(key);
			unique.push(term);
		}
	}

	return unique.join(",");
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

// Skeleton Row Component for loading state
const SkeletonRow = () => (
	<tr className="block md:table-row p-4 mb-3 rounded-2xl bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 md:p-0 md:mb-0 md:border-b md:border-slate-200 dark:border-slate-800 md:rounded-none md:bg-transparent animate-pulse">
		{/* Checkbox */}
		<td className="px-3 py-4 hidden md:table-cell">
			<div className="h-4 w-4 bg-slate-200 dark:bg-slate-700 rounded"></div>
		</td>

		{/* Mobile View Skeleton */}
		<td className="block md:hidden w-full">
			<div className="flex justify-between items-start">
				<div className="flex gap-3 w-full">
					<div className="h-4 w-4 bg-slate-200 dark:bg-slate-700 rounded mt-1"></div>
					<div className="space-y-2 w-3/4">
						<div className="h-4 w-3/4 bg-slate-200 dark:bg-slate-700 rounded"></div>
						<div className="h-3 w-1/2 bg-slate-200 dark:bg-slate-700 rounded"></div>
					</div>
				</div>
			</div>
		</td>

		{/* Desktop Columns */}
		<td className="w-48 px-3 py-4 hidden md:table-cell">
			<div className="h-4 w-32 bg-slate-200 dark:bg-slate-700 rounded"></div>
		</td>
		<td className="w-40 px-6 py-4 hidden md:table-cell">
			<div className="h-4 w-24 bg-slate-200 dark:bg-slate-700 rounded"></div>
		</td>
		<td className="w-48 px-6 py-4 hidden md:table-cell">
			<div className="h-4 w-32 bg-slate-200 dark:bg-slate-700 rounded"></div>
		</td>
		<td className="w-40 px-6 py-4 hidden md:table-cell">
			<div className="h-4 w-24 bg-slate-200 dark:bg-slate-700 rounded"></div>
		</td>
		<td className="w-32 px-6 py-4 hidden lg:table-cell">
			<div className="h-4 w-16 bg-slate-200 dark:bg-slate-700 rounded"></div>
		</td>
		<td className="w-40 px-3 py-4 hidden sm:table-cell">
			<div className="flex gap-2">
				<div className="h-6 w-6 bg-slate-200 dark:bg-slate-700 rounded"></div>
				<div className="h-6 w-6 bg-slate-200 dark:bg-slate-700 rounded"></div>
				<div className="h-6 w-6 bg-slate-200 dark:bg-slate-700 rounded"></div>
			</div>
		</td>
		<td className="w-32 px-4 py-4 hidden md:table-cell">
			<div className="flex justify-end gap-2">
				<div className="h-6 w-6 bg-slate-200 dark:bg-slate-700 rounded"></div>
				<div className="h-6 w-6 bg-slate-200 dark:bg-slate-700 rounded"></div>
			</div>
		</td>
	</tr>
);

// Search Loading Component with Illustration
const SearchLoading = () => (
	<div className="flex flex-col items-center justify-center h-[calc(100vh-200px)] p-8 animate-in fade-in zoom-in duration-500">
		<div className="relative mt-3 mb-8">
			<div className="absolute inset-0 bg-indigo-100 dark:bg-indigo-900/20 rounded-full blur-3xl animate-pulse"></div>
			<img src={FilterImage} alt="Searching..." className="relative w-40 h-40 md:w-56 md:h-56 object-contain animate-pulse" />
		</div>
		<h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-2 text-center">
			Searching Database...
		</h3>
		<p className="text-slate-500 dark:text-slate-400 text-center max-w-md mb-8 text-base leading-relaxed">
			Finding your perfect match, <br />
			Filtering through "Millions" of professionals... <br/>
			Quality take few seconds
		</p>
		
		<div className="flex gap-2">
			<div className="w-3 h-3 bg-indigo-600 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
			<div className="w-3 h-3 bg-indigo-600 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
			<div className="w-3 h-3 bg-indigo-600 rounded-full animate-bounce"></div>
		</div>
	</div>
);

const UserSearch = () => {
	const { user } = useContext(AuthContext);
	const queryClient = useQueryClient();
	const [selectedProfile, setSelectedProfile] = useState(null);
	const tableContainerRef = useRef(null);
	const searchInputRef = useRef(null);
	const [showBackToTop, setShowBackToTop] = useState(false);
	const [aiQuery, setAiQuery] = useState("");
	const [isAiProcessing, setIsAiProcessing] = useState(false);

	// Scroll handler for Back to Top button
	const handleScroll = useCallback((e) => {
		setShowBackToTop(e.target.scrollTop > 400);
	}, []);

	const scrollToTop = () => {
		tableContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
	};

	// Keyboard shortcut for search focus (Ctrl/Cmd + K)
	useEffect(() => {
		const handleGlobalKeyDown = (e) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "k") {
				e.preventDefault();
				searchInputRef.current?.focus();
			}
		};
		window.addEventListener("keydown", handleGlobalKeyDown);
		return () => window.removeEventListener("keydown", handleGlobalKeyDown);
	}, []);

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
		const defaultFilters = {
			location: "",
			jobTitle: "",
			skills: "",
			experience: "",
			hasEmail: false,
			hasPhone: false,
			hasLinkedin: false,
		};
		try {
			const saved = localStorage.getItem("hirextra_filters");
			return saved ? { ...defaultFilters, ...JSON.parse(saved) } : defaultFilters;
		} catch (e) {
			return defaultFilters;
		}
	});

	// --- APPLIED STATE (For Manual Search) ---
	// These states are what the API query actually listens to.
	// They only update when the user clicks "Search" or presses Enter.
	const [appliedSearchInput, setAppliedSearchInput] = useState(searchInput);
	const [appliedFilters, setAppliedFilters] = useState(filters);

	// Track if search has been explicitly applied (or restored from storage)
	const [isSearchApplied, setIsSearchApplied] = useState(() => {
		const hasFilters = Object.values(filters).some((v) => v && v !== false && v !== "");
		return !!(searchInput || hasFilters);
	});

	// Ensure applied state syncs with initial localStorage load
	useEffect(() => {
		setAppliedSearchInput(searchInput);
		setAppliedFilters(filters);
	}, []); // Run once on mount

	const hasActiveFilters =
		searchInput ||
		Object.values(filters).some((v) => v && v !== false && v !== "");

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

	// --- PRE-FETCHING LOGIC ---
	// Satisfies: "filtering should happen backend right from typing... but display after entering search"
	const debouncedSearchInput = useDebounce(searchInput, 500);
	const debouncedFilters = useDebounce(filters, 500);
	const debouncedLocationForApi = useMemo(
		() => normalizeLocationFilterForApi(debouncedFilters.location),
		[debouncedFilters.location],
	);

	// Background query to pre-fetch data while typing
	// This handles cancellation automatically unlike the previous useEffect approach
	useInfiniteQuery({
		queryKey: ["candidates", {
			q: debouncedSearchInput,
			locality: debouncedLocationForApi,
			jobTitle: debouncedFilters.jobTitle,
			skills: debouncedFilters.skills,
			minExperience: debouncedFilters.experience,
			hasEmail: debouncedFilters.hasEmail,
			hasPhone: debouncedFilters.hasPhone,
			hasLinkedin: debouncedFilters.hasLinkedin,
		}],
		queryFn: async ({ pageParam = 1 }) => {
			const params = new URLSearchParams({
				page: pageParam,
				limit: PAGE_SIZE,
				...Object.fromEntries(
					Object.entries({
						q: debouncedSearchInput,
						locality: debouncedLocationForApi,
						jobTitle: debouncedFilters.jobTitle,
						skills: debouncedFilters.skills,
						minExperience: debouncedFilters.experience,
						hasEmail: debouncedFilters.hasEmail,
						hasPhone: debouncedFilters.hasPhone,
						hasLinkedin: debouncedFilters.hasLinkedin,
					}).filter(
						([_, v]) => v !== "" && v !== false && v !== undefined && v !== null
					)
				),
			});
			const response = await api.get(`/candidates/search?${params}`);
			return { ...response.data, currentPage: pageParam };
		},
		getNextPageParam: (lastPage, allPages) => {
			if (lastPage.hasMore) {
				return lastPage.currentPage + 1;
			}
			return undefined;
		},
		initialPageParam: 1,
		enabled: !!(debouncedSearchInput || Object.values(debouncedFilters).some(v => v && v !== false && v !== "")),
		staleTime: 60 * 1000,
		notifyOnChangeProps: [], // Prevent re-renders from this background fetch
	});

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

	// Trigger Search Action
	const handleTriggerSearch = useCallback(() => {
		setAppliedSearchInput(searchInput);
		setAppliedFilters(filters);
		setSelectedIds(new Set());
		setIsSearchApplied(true);
	}, [searchInput, filters]);

	// Handle AI Search
	const handleAiSearch = async (e) => {
		e?.preventDefault();
		if (!aiQuery.trim()) return;
		
		setIsAiProcessing(true);
		const toastId = toast.loading("AI is analyzing your requirements...");

		try {
			const { data: extracted } = await api.post("/candidates/analyze-search", { query: aiQuery });
			
			if (extracted) {
				setSearchInput(extracted.q || "");
				setFilters(prev => ({
					...prev,
					jobTitle: extracted.jobTitle || "",
					location: extracted.location || "",
					skills: extracted.skills || "",
					experience: extracted.experience || "",
					hasEmail: extracted.hasEmail || false,
					hasPhone: extracted.hasPhone || false,
					hasLinkedin: extracted.hasLinkedin || false
				}));

				// Apply search immediately
				setAppliedSearchInput(extracted.q || "");
				setAppliedFilters(extracted); // extracted matches structure mostly, but let's be safe if we pass extra keys it's fine or we can map explicitly
				setSelectedIds(new Set());
				setIsSearchApplied(true);
				toast.success("Filters applied!", { id: toastId });
			}
		} catch (err) {
			const errorMessage = err.response?.data?.message || err.message || "AI Search failed";
			toast.error(errorMessage, { id: toastId });
		} finally {
			setIsAiProcessing(false);
		}
	};

	// Handle Enter key in inputs
	const handleKeyDown = (e) => {
		if (e.key === "Enter") {
			handleTriggerSearch();
		}
	};
	const appliedLocationForApi = useMemo(
		() => normalizeLocationFilterForApi(appliedFilters.location),
		[appliedFilters.location],
	);

	const queryFilters = useMemo(
		() => ({
			q: appliedSearchInput,
			locality: appliedLocationForApi,
			jobTitle: appliedFilters.jobTitle,
			skills: appliedFilters.skills,
			minExperience: appliedFilters.experience,
			hasEmail: appliedFilters.hasEmail,
			hasPhone: appliedFilters.hasPhone,
			hasLinkedin: appliedFilters.hasLinkedin,
		}),
		[appliedSearchInput, appliedFilters, appliedLocationForApi],
	);

	const queryKey = useMemo(() => ["candidates", queryFilters], [queryFilters]);

	const { ref: loadMoreRef, inView } = useInView({
		threshold: 0,
		triggerOnce: false,
		rootMargin: "1000px", // Start loading much earlier (approx 2 screens ahead)
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
		getNextPageParam: (lastPage, allPages) => {
			if (lastPage.hasMore) {
				return lastPage.currentPage + 1;
			}
			return undefined;
		},
		initialPageParam: 1,
		enabled: isSearchApplied,
		staleTime: 60 * 1000, // Increased to 60s to prevent UI flickering/unnecessary fetches
		gcTime: 5 * 60 * 1000, // Reduced GC time to free up memory faster
		refetchOnWindowFocus: true,
		refetchOnReconnect: true,
		refetchInterval: false, // Disabled aggressive polling to prevent unnecessary load and 401s
		// placeholderData: keepPreviousData, // Removed to prevent displaying old data while searching
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
		let allCandidates = data.pages.flatMap((page) => page.candidates || []);

		// Client-side filtering for experience to ensure accuracy
		if (appliedFilters.experience) {
			const minExp = parseInt(appliedFilters.experience, 10);
			if (!isNaN(minExp)) {
				allCandidates = allCandidates.filter((c) => {
					const expStr = String(c.experience || "");
					const match = expStr.match(/(\d+)/);
					const exp = match ? parseInt(match[1], 10) : 0;
					return exp >= minExp;
				});
			}
		}

		return allCandidates;
	}, [data?.pages, appliedFilters.experience]);

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
			experience: "",
			hasEmail: false,
			hasPhone: false,
			hasLinkedin: false,
		});
		setAppliedSearchInput("");
		setAppliedFilters({ location: "", jobTitle: "", skills: "", experience: "", hasEmail: false, hasPhone: false, hasLinkedin: false });
		setSelectedIds(new Set());
		setIsSearchApplied(false);
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

	const handleQuickView = useCallback(async (candidate, e) => {
		e?.stopPropagation();
		setSelectedProfile({ ...candidate, _loadingDetails: true });
		try {
			const { data } = await api.get(`/candidates/${candidate._id}`);
			setSelectedProfile(data);
		} catch (error) {
			console.error("Quick view load failed:", error);
			toast.error("Could not load full profile details");
			setSelectedProfile(candidate);
		}
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
			const today = new Date();
			const day = String(today.getDate()).padStart(2, "0");
			const month = String(today.getMonth() + 1).padStart(2, "0");
			const year = today.getFullYear();
			const dateString = `${day}-${month}-${year}`;
			link.href = url;
			link.setAttribute("download", `candidates_export_${dateString}.csv`);
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

			// Extract filename from Content-Disposition header
			const customFileName = response.headers["x-filename"];
			const contentDisposition = response.headers["content-disposition"];
			let fileName = `candidate_${candidateId}.docx`; // Fallback

			if (customFileName) {
				// Prioritize the custom header as it's more reliable
				fileName = customFileName;
			} else if (contentDisposition) {
				// Fallback to standard header
				const fileNameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
				if (fileNameMatch && fileNameMatch.length > 1) {
					fileName = fileNameMatch[1];
				}
			}

			const url = window.URL.createObjectURL(new Blob([response.data]));
			const link = document.createElement("a");
			link.href = url;
			link.setAttribute("download", fileName);
			document.body.appendChild(link);
			link.click();
			link.remove();
			window.URL.revokeObjectURL(url);

			toast.success("Profile downloaded");
		} catch (error) {
			toast.error("Download failed");
		}
	}, []);

	// Effect to notify user of errors without hiding data
	useEffect(() => {
		if (status === "error") {
			toast.error("Try Again...", {
				id: "search-error", // Prevent duplicates
			});
		}
	}, [status]);

	if (status === "error" && !candidates.length) {
		return (
			<div className="flex flex-col items-center justify-center h-[calc(100vh-200px)] space-y-6 text-center p-8 animate-in fade-in zoom-in duration-300">
				<div className="relative">
					<div className="absolute inset-0 bg-rose-50 dark:bg-rose-900/20 rounded-full blur-2xl"></div>
					<div className="relative bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-lg shadow-slate-200/50 dark:shadow-none border border-slate-100 dark:border-slate-700">
						<RefreshCw
							className="h-12 w-12 text-rose-500 dark:text-rose-400"
							strokeWidth={1.5}
						/>
					</div>
				</div>

				<div className="max-w-sm space-y-2">
					<h3 className="text-lg font-semibold text-slate-900 dark:text-white">
						We couldn't find what you searched for
					</h3>
					<p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">
						Try again with correct keywords.
					</p>
				</div>

				<button
					onClick={clearAllFilters}
					className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-xl transition-colors shadow-sm shadow-indigo-200 dark:shadow-none flex items-center gap-2">
					<Filter size={16} />
					Clear Filters & Try Again
				</button>
			</div>
		);
	}

	return (
		<ErrorBoundary>
			<div className="flex flex-col h-[calc(100vh-64px)] bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans">
				{/* Fixed Filters Header - Stays below admin header */}
				<div className="sticky top-0 z-40 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200/60 dark:border-slate-800/60 shadow-sm transition-all duration-300 supports-[backdrop-filter]:bg-white/60">
					
					{/* AI Smart Search Bar */}
					<div className="px-2 pt-3 md:px-4">
						<div className="relative group w-full">
							<div className="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 rounded-xl opacity-30 group-hover:opacity-100 focus-within:opacity-100 blur transition duration-500"></div>
							<div className="relative flex items-center bg-white dark:bg-slate-900 rounded-xl shadow-sm h-full">
								<div className="pl-4 pr-2 text-indigo-500">
									<Sparkles size={16} className={isAiProcessing ? "animate-spin" : ""} />
								</div>
								<input 
									type="text"
									placeholder="Ask AI: 'Java dev in Hyderabad...'"
									className="w-full bg-transparent border-none focus:ring-0 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 py-2.5"
									value={aiQuery}
									onChange={(e) => setAiQuery(e.target.value)}
									onKeyDown={(e) => e.key === 'Enter' && handleAiSearch(e)}
								/>
								<button 
									onClick={handleAiSearch}
									disabled={isAiProcessing || !aiQuery.trim()}
									className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 rounded-r-xl text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 self-stretch">
									{isAiProcessing ? 'Thinking...' : 'AI Search'}
								</button>
							</div>
						</div>
					</div>

					<div className="flex flex-col md:flex-row items-center justify-between px-2 py-2 md:px-4 md:py-3 gap-2 md:gap-3">
						{/* Filters Row (Scrollable) */}
						<div className="grid grid-cols-3 gap-2 w-full md:flex md:items-center md:gap-2 md:flex-1 md:overflow-x-auto md:scrollbar-hide">
							{/* Search Bar */}
							<div className="relative col-span-1 md:min-w-[240px]">
								<Search
									className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none w-3 h-3 md:w-4 md:h-4"
									size={14}
								/>
								<input
									ref={searchInputRef}
									placeholder="Search..."
									className="w-full pl-7 pr-6 py-1.5 md:pl-9 md:pr-8 md:py-2 bg-slate-100/50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 rounded-xl text-xs md:text-sm text-slate-800 dark:text-slate-200 placeholder-slate-400 outline-none transition-all h-9 md:h-auto shadow-sm"
									value={searchInput}
									onChange={handleSearchChange}
									onKeyDown={handleKeyDown}
								/>
								{searchInput && (
									<button
										onClick={() => setSearchInput("")}
										className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-0.5 rounded-full transition-colors">
										<X size={12} className="md:w-[14px] md:h-[14px]" />
									</button>
								)}
							</div>

							{/* Job Title */}
							<div className="relative col-span-1 min-w-0 md:min-w-[140px]">
								<input
									placeholder="Job Title"
									className="w-full px-3 py-1.5 md:py-2 pr-7 bg-slate-100/50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 rounded-xl text-xs md:text-sm text-slate-800 dark:text-slate-200 placeholder-slate-400 outline-none transition-all h-9 md:h-auto shadow-sm"
									value={filters.jobTitle}
									onChange={(e) => handleFilterChange("jobTitle", e.target.value)}
									onKeyDown={handleKeyDown}
								/>
								{filters.jobTitle && (
									<button
										onClick={() => handleFilterChange("jobTitle", "")}
										className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-0.5 rounded-full transition-colors">
										<X size={12} className="md:w-[14px] md:h-[14px]" />
									</button>
								)}
							</div>

							{/* Location */}
							<div className="relative col-span-1 min-w-0 md:min-w-[140px]">
								<input
									placeholder="Location (comma separated)"
									className="w-full px-3 py-1.5 md:py-2 pr-7 bg-slate-100/50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 rounded-xl text-xs md:text-sm text-slate-800 dark:text-slate-200 placeholder-slate-400 outline-none transition-all h-9 md:h-auto shadow-sm"
									value={filters.location}
									onChange={(e) => handleFilterChange("location", e.target.value)}
									onKeyDown={handleKeyDown}
								/>
								{filters.location && (
									<button
										onClick={() => handleFilterChange("location", "")}
										className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-0.5 rounded-full transition-colors">
										<X size={12} className="md:w-[14px] md:h-[14px]" />
									</button>
								)}
							</div>

							{/* Skills */}
							<div className="relative col-span-1 min-w-0 md:min-w-[140px]">
								<input
									placeholder="Skills"
									className="w-full px-3 py-1.5 md:py-2 pr-7 bg-slate-100/50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 rounded-xl text-xs md:text-sm text-slate-800 dark:text-slate-200 placeholder-slate-400 outline-none transition-all h-9 md:h-auto shadow-sm"
									value={filters.skills}
									onChange={(e) => handleFilterChange("skills", e.target.value)}
									onKeyDown={handleKeyDown}
								/>
								{filters.skills && (
									<button
										onClick={() => handleFilterChange("skills", "")}
										className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-0.5 rounded-full transition-colors">
										<X size={12} className="md:w-[14px] md:h-[14px]" />
									</button>
								)}
							</div>

							{/* Experience */}
							<div className="relative col-span-1 min-w-0 md:min-w-[120px]">
								<input
									type="number"
									placeholder="Min Exp (Yrs)"
									className="w-full px-3 py-1.5 md:py-2 pr-7 bg-slate-100/50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 rounded-xl text-xs md:text-sm text-slate-800 dark:text-slate-200 placeholder-slate-400 outline-none transition-all h-9 md:h-auto shadow-sm"
									value={filters.experience}
									onChange={(e) => handleFilterChange("experience", e.target.value)}
									onKeyDown={handleKeyDown}
								/>
								{filters.experience && (
									<button
										onClick={() => handleFilterChange("experience", "")}
										className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-0.5 rounded-full transition-colors">
										<X size={12} className="md:w-[14px] md:h-[14px]" />
									</button>
								)}
							</div>

							{/* Divider */}
							<div className="hidden md:block h-6 w-px bg-slate-300 dark:bg-slate-700 mx-1" />

							<div className="col-span-1 flex items-center justify-center gap-1 md:gap-1">

								{/* Email Filter */}
								<button
									onClick={() =>
										handleFilterChange("hasEmail", !filters.hasEmail)
									}
									title="Has Email"
									className={`p-1.5 md:p-2 rounded-xl transition-all border h-9 w-9 md:h-auto md:w-auto flex items-center justify-center ${
										filters.hasEmail
											? "bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-200 dark:shadow-none"
											: "bg-transparent text-slate-500 dark:text-slate-400 border-transparent hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200"
									}`}>
									<Mail size={14} className="md:w-4 md:h-4" />
								</button>

								{/* Phone Filter */}
								<button
									onClick={() =>
										handleFilterChange("hasPhone", !filters.hasPhone)
									}
									title="Has Phone"
									className={`p-1.5 md:p-2 rounded-xl transition-all border h-9 w-9 md:h-auto md:w-auto flex items-center justify-center ${
										filters.hasPhone
											? "bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-200 dark:shadow-none"
											: "bg-transparent text-slate-500 dark:text-slate-400 border-transparent hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200"
									}`}>
									<Phone size={14} className="md:w-4 md:h-4" />
								</button>

								{/* LinkedIn Filter */}
								<button
									onClick={() =>
										handleFilterChange("hasLinkedin", !filters.hasLinkedin)
									}
									title="Has LinkedIn"
									className={`p-1.5 md:p-2 rounded-xl transition-all border h-9 w-9 md:h-auto md:w-auto flex items-center justify-center ${
										filters.hasLinkedin
											? "bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-200 dark:shadow-none"
											: "bg-transparent text-slate-500 dark:text-slate-400 border-transparent hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200"
									}`}>
									<Linkedin size={14} className="md:w-4 md:h-4" />
								</button>
							</div>

							{/* Mobile Showing Count (Row 2, Col 3) */}
							<div className="col-span-1 flex items-center justify-end md:hidden">
								{isSearchApplied && (
									<span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/50 px-2 py-1 rounded-full border border-slate-200 dark:border-slate-700/50 whitespace-nowrap">
										{candidates.length} / {totalCount}
									</span>
								)}
							</div>

							{/* Search Button */}
							<button
								onClick={handleTriggerSearch}
								disabled={!hasActiveFilters}
								className={`col-span-1 md:w-auto px-6 py-2 text-white text-sm font-medium rounded-xl flex items-center justify-center gap-2 shadow-md transition-all duration-300 ease-out ${
									!hasActiveFilters
										? "bg-indigo-400 cursor-not-allowed opacity-50"
										: "bg-indigo-600 hover:bg-indigo-800 cursor-pointer"
								}`}s
							>
								<Search size={16} />
								<span className="hidden md:inline">Search</span>
							</button>

							{/* Clear Filters */}
							<button
								onClick={clearAllFilters}
								className="hidden md:block ml-2 text-xs font-medium whitespace-nowrap transition-colors px-3 py-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/20 text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer"
							>
								Clear
							</button>
						</div>

						{/* Count Display */}
						<div className="hidden md:block w-full md:w-auto md:pl-4 md:border-l border-slate-200 dark:border-slate-800">
							{isSearchApplied && (
								(isLoading || (isFetching && !data)) ? (
									<div className="flex items-center justify-center px-3 py-1.5 h-[30px] w-[120px]">
										<Loader className="animate-spin h-5 w-5 text-indigo-500" />
									</div>
								) : (
									<span className="w-full text-center block md:inline-block text-xs font-medium text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-800 px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 shadow-sm">
										Showing{" "}
										<span className="text-indigo-600 dark:text-indigo-400 font-bold">
											{candidates.length}
										</span>
										{totalCount !== -1 ? (
											<>
												<span className="mx-1 text-slate-400 dark:text-slate-600">/</span>
												<span className="text-slate-700 dark:text-slate-300 font-bold">
													{totalCount}
												</span>
											</>
										) : (
											<span className="ml-1 text-slate-500 dark:text-slate-400">
												Results
											</span>
										)}
									</span>
								)
							)}
						</div>
					</div>

					{/* Bulk Actions Bar */}
					{selectedIds.size > 0 && (
						<div className="flex items-center justify-between px-2 sm:px-4 py-2.5 bg-indigo-50 dark:bg-indigo-900/30 border-t border-indigo-100 dark:border-indigo-500/30 animate-in fade-in duration-200">
							<span className="text-sm font-semibold text-indigo-800 dark:text-indigo-200 flex items-center gap-2">
								<div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
								{selectedIds.size} candidate{selectedIds.size > 1 ? "s" : ""}{" "}
								selected
							</span>
							<div className="flex items-center gap-2">
								<button
									onClick={handleCancelSelection}
									className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg text-xs font-semibold transition-colors shadow-sm">
									<X size={16} />
									<span className="hidden sm:inline">Cancel</span>
								</button>
								<button
									onClick={handleExport}
									className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition-colors shadow-sm shadow-emerald-200 cursor-pointer">
									<Download size={16} />
									<span className="hidden sm:inline">Export</span>
								</button>
								{user?.role === "ADMIN" && (
									<button
										onClick={handleBulkDelete}
										disabled={bulkDeleteMutation.isPending}
										className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold transition-colors shadow-sm shadow-rose-200 disabled:opacity-50 cursor-pointer">
										{bulkDeleteMutation.isPending ? (
											<Loader className="animate-spin" size={16} />
										) : (
											<Trash2 size={16} />
										)}
										<span className="hidden sm:inline">Delete</span>
									</button>
								)}
							</div>
						</div>
					)}
				</div>

				{/* Table Container - Scrollable area starting below filters and table head */}
				<div className="flex-1 overflow-hidden flex flex-col">
					{isSearchApplied && isFetching && !data ? (
						<SearchLoading />
					) : isSearchApplied && candidates.length > 0 ? (
						<div className="mx-4 mt-3 mb-2 flex-1 overflow-hidden">
							{/* Table with fixed header and scrollable body */}
							<div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl shadow-slate-200/40 dark:shadow-none border border-slate-200 dark:border-slate-800 overflow-hidden h-full">
								<div
									ref={tableContainerRef}
									onScroll={handleScroll}
									className="overflow-x-hidden overflow-y-scroll h-full [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-track]:bg-slate-950 [&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-600 [scrollbar-width:thin] [scrollbar-color:#334155_#020617]">
									<table className="w-full md:table-fixed">
										<thead className="hidden md:table-header-group bg-slate-50/80 dark:bg-slate-900/80 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700 sticky top-0 z-30">
											<tr>
												<th className="w-12 px-4 py-4 text-left">
													<input
														type="checkbox"
														className="h-4 w-4 text-indigo-600 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 rounded focus:ring-indigo-500 transition"
														checked={
															candidates.length > 0 &&
															selectedIds.size > 0 &&
															selectedIds.size === candidates.length
														}
														onChange={(e) => handleSelectAll(e.target.checked)}
														disabled={isFetching && !data}
													/>
												</th>
												<th className="w-48 px-3 py-4 text-left text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
													Full Name
												</th>
												<th className="w-40 px-6 py-4 text-left text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
													Job Title
												</th>
												<th className="w-48 px-6 py-4 text-left text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
													Skills
												</th>
												<th className="w-40 px-6 py-4 text-left text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider hidden md:table-cell">
													Company Name
												</th>
												<th className="w-32 px-6 py-4 text-left text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider hidden lg:table-cell">
													Experience
												</th>
												<th className="w-40 px-3 py-4 text-left text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider hidden sm:table-cell">
													Contact
												</th>
												<th className="w-32 px-4 py-4 text-left text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider sticky right-0 bg-slate-50/80 dark:bg-slate-900/80 backdrop-blur-sm border-l border-slate-200 dark:border-slate-800">
													Actions
												</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900 block md:table-row-group">
											<>
												{/* Spacer Row for visual gap */}
												<tr className="hidden md:table-row h-2"></tr>
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
												<tr className="block md:table-row">
													<td colSpan="7" className="p-0">
														<div
															ref={loadMoreRef}
															className="h-20 flex items-center justify-center">
															{isFetchingNextPage ? (
																<div className="flex items-center gap-2">
																	<Loader className="animate-spin h-4 w-4 text-indigo-600" />
																	<span className="text-sm text-slate-500 dark:text-slate-400">
																		Loading more candidates...
																	</span>
																</div>
															) : hasNextPage ? (
																<span className="text-sm text-slate-500 dark:text-slate-400">
																	Scroll down to load more
																</span>
															) : candidates.length > 0 ? (
																<span className="text-sm text-slate-500 dark:text-slate-400 py-4">
																	No more candidates to load
																</span>
															) : null}
														</div>
													</td>
												</tr>
											</>
										</tbody>
									</table>
								</div>
							</div>
						</div>
					) : (
						// Empty State Logic
						!isSearchApplied ? (
							<div className="flex items-center justify-center h-[calc(100vh-200px)] p-8">
								<div className="flex flex-col md:flex-row items-center justify-center gap-12 text-center md:text-left">
									<img src={FilterImage} alt="Start searching for candidates" className="w-full max-w-[250px] md:max-w-xs dark:invert-[.85] mt-3" />
									<div>
										<h2 className="text-2xl font-semibold text-slate-700 dark:text-slate-300 mb-2">
											Begin Your Search...
										</h2>
										<p className="text-slate-500 dark:text-slate-400 max-w-xs">
											Use the filters above to find candidates by name, job title, location, or skills and Enter Search.
										</p>
									</div>
								</div>
							</div>
						) : (
							<div className="flex flex-col items-center justify-center h-[calc(100vh-200px)] space-y-6 text-center p-8 animate-in fade-in zoom-in duration-300">
								<div className="relative">
									<div className="absolute inset-0 bg-indigo-50 dark:bg-indigo-900/20 rounded-full blur-2xl"></div>
									<div className="relative bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-lg shadow-slate-200/50 dark:shadow-none border border-slate-100 dark:border-slate-700">
										<Search
											className="h-12 w-12 text-slate-400 dark:text-slate-500"
											strokeWidth={1.5}
										/>
									</div>
								</div>

								<div className="max-w-sm space-y-2">
									<h3 className="text-lg font-semibold text-slate-900 dark:text-white">
										No matches found
									</h3>
									<p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">
										Sorry, there is no suitable data found based on your search, Try another.
									</p>
								</div>

								<button
									onClick={clearAllFilters}
									className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-xl transition-colors shadow-sm shadow-indigo-200 dark:shadow-none flex items-center gap-2">
									<Filter size={16} />
									Clear Filters
								</button>
							</div>
						)
					)}
				</div>

				{/* Back to Top Button */}
				{showBackToTop && (
					<button
						onClick={scrollToTop}
						className="fixed bottom-8 right-8 p-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-lg shadow-indigo-500/30 transition-all duration-300 z-50 animate-in fade-in slide-in-from-bottom-4 hover:scale-110 active:scale-95"
						title="Back to Top">
						<ChevronUp size={24} />
					</button>
				)}

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
				className={`group block md:table-row p-4 mb-3 rounded-2xl bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 md:p-0 md:mb-0 md:border-b md:border-slate-100 dark:border-slate-800 md:rounded-none md:bg-transparent 
				hover:bg-white dark:hover:bg-slate-800 hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.1)] dark:hover:shadow-none hover:border-indigo-200 dark:hover:border-indigo-900 hover:scale-[1.005] hover:z-10 hover:relative
				transition-all duration-300 ease-out last:border-none animate-in fade-in slide-in-from-bottom-2 duration-500 ${
					isSelected ? "bg-indigo-50 dark:bg-indigo-900/20" : ""
				}`}>
				{/* Checkbox */}
				<td className="px-3 py-4 align-top hidden md:table-cell">
					<input
						type="checkbox"
						className="h-4 w-4 text-indigo-600 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 rounded focus:ring-indigo-500 cursor-pointer transition mt-1"
						checked={isSelected}
						onChange={(e) => onSelect(candidate._id, e.target.checked)}
					/>
				</td>


				{/* --- MOBILE CARD HEADER --- */}
				<td className="block md:hidden">
					<div className="flex items-start justify-between">
						<div className="flex items-start gap-3">
							<input
								type="checkbox"
								className="h-4 w-4 text-indigo-600 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 rounded focus:ring-indigo-500 cursor-pointer transition mt-1"
								checked={isSelected}
								onChange={(e) => onSelect(candidate._id, e.target.checked)}
							/>
							<div>
								<div className="font-semibold text-slate-800 dark:text-slate-200 break-words leading-tight">
									{val(candidate.fullName)}
								</div>
								<div className="text-slate-500 dark:text-slate-400 font-medium text-sm leading-snug">
									{val(candidate.jobTitle)}
								</div>
							</div>
						</div>
						<div className="flex justify-end gap-0 -mr-2">
							<button
								className="p-2 text-slate-400 hover:text-amber-400 hover:bg-slate-800 hover:scale-110 rounded-lg transition-all duration-200"
								title="Enrich">
								<Sparkles size={16} />
							</button>
							
							<button
								onClick={(e) => onQuickView(candidate, e)}
								className="p-2 text-slate-500 dark:text-slate-400 hover:text-indigo-500 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:scale-110 rounded-lg transition-all duration-200"
								title="View">
								<Eye size={16} />
							</button>
							
							<button
								onClick={(e) => onDownload(candidate._id, e)}
								className="p-2 text-slate-500 dark:text-slate-400 hover:text-emerald-500 dark:hover:text-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:scale-110 rounded-lg transition-all duration-200"
								title="Download Resume">
								<Download size={16} />
							</button>
						</div>
					</div>
				</td>

				{/* Name (Desktop) */}
				<td className="w-48 px-3 py-4 align-top hidden md:table-cell">
					<div className="font-semibold text-slate-900 dark:text-slate-100 break-words leading-tight">{val(candidate.fullName)}</div>
				</td>

				{/* Job Title (Desktop) */}
				<td className="w-40 px-6 py-4 align-top hidden md:table-cell">
					<div className="text-slate-600 dark:text-slate-300 font-medium break-words text-sm leading-snug">{val(candidate.jobTitle)}</div>
				</td>

				{/* Skills with Scrollable Container */}
				<td className="hidden md:table-cell w-auto md:w-48 px-0 md:px-6 py-2 md:py-4 align-top">
					<div className="h-16 overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-600 [scrollbar-width:thin] [scrollbar-color:#334155_transparent]">
						<p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
							{candidate.skills
								? candidate.skills
										.split(/,|;/)
										.map((s) =>
											s.trim().replace(/\b\w/g, (l) => l.toUpperCase()),
										)
										.join(", ")
								: "-"}
						</p>
					</div>
				</td>

				{/* Company Name */}
				<td className="w-40 px-6 py-4 align-top hidden md:table-cell">
					<div className="text-slate-600 dark:text-slate-300 text-sm break-words">
						{val(candidate.company)}
					</div>
				</td>

				{/* Experience */}
				<td className="w-32 px-6 py-4 align-top hidden lg:table-cell">
					<div className="text-slate-500 dark:text-slate-400 text-sm break-words">
						{val(candidate.experience)}
					</div>
				</td>

				{/* Contact with Icons */}
				<td className="w-40 px-3 py-4 align-top hidden sm:table-cell ">
					<div className="flex gap-0.5 flex-wrap">
						{candidate.phone && (
							<div className="relative group/icon">
								<button
									onClick={() =>
										window.open(`tel:${candidate.phone}`, "_blank")
									}
									className="p-1 text-slate-500 dark:text-slate-400 hover:text-indigo-500 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:scale-110 rounded-lg transition-all duration-200">
									<Phone size={16} />
								</button>
								<div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover/icon:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 shadow-lg">
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
									className="p-1 text-slate-500 dark:text-slate-400 hover:text-indigo-500 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:scale-110 rounded-lg transition-all duration-200">
									<Mail size={16} />
								</button>
								<div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover/icon:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 shadow-lg">
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
										const win = window.open(url, "_blank");
										if (win) win.opener = null; // Security: Prevent reverse tabnabbing
									}}
									className="p-1 text-slate-500 dark:text-slate-400 hover:text-[#0077b5] hover:bg-slate-100 dark:hover:bg-slate-800 hover:scale-110 rounded-lg transition-all duration-200">
									<Linkedin size={16} />
								</button>
								<div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover/icon:opacity-100 transition-opacity pointer-events-none whitespace-nowrap max-w-xs truncate z-50 shadow-lg">
									{candidate.linkedinUrl.replace(/^https?:\/\//, "")}
								</div>
							</div>
						)}

						{/* Location */}
						{(candidate.locality || candidate.location) && (
							<div className="relative group/icon">
								<button
									className="p-1 rounded-lg text-slate-500 dark:text-slate-400 
						hover:text-rose-500 dark:hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:scale-110
						transition-all duration-200">
									<MapPin size={15} />
								</button>
								<div
									className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50
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
				<td className="w-32 px-4 py-4 align-top sticky right-0 bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800/50 transition-colors duration-200 hidden md:table-cell border-l border-slate-200 dark:border-slate-800">
					<div className="flex justify-end gap-0.5">
						<button
								className="p-1 text-slate-500 dark:text-slate-400 hover:text-amber-500 dark:hover:text-amber-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:scale-110 rounded-lg transition-all duration-200"
								title="Enrich">
								<Sparkles size={16} />
							</button>
						<button
							onClick={(e) => onQuickView(candidate, e)}
							className="p-1 text-slate-500 dark:text-slate-400 hover:text-indigo-500 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:scale-110 rounded-lg transition-all duration-200"
							title="View">
							<Eye size={16} />
						</button>
							
						<button
							onClick={(e) => onDownload(candidate._id, e)}
							className="p-1 text-slate-500 dark:text-slate-400 hover:text-emerald-500 dark:hover:text-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:scale-110 rounded-lg transition-all duration-200"
							title="Download Resume">
							<Download size={16} />
						</button>
						{isAdmin && (
							<button
								onClick={(e) => onDelete(candidate._id, e)}
								disabled={isDeleting}
								className="p-1 text-slate-500 dark:text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:scale-110 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
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

const parseRchilliDate = (value) => {
	const input = String(value || "").trim();
	const match = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
	if (!match) return 0;
	const day = Number(match[1]);
	const month = Number(match[2]) - 1;
	const year = Number(match[3]);
	const ts = new Date(year, month, day).getTime();
	return Number.isFinite(ts) ? ts : 0;
};

const getProfileSkillItems = (profile) => {
	const parserData = profile?.parsedResume?.raw?.ResumeParserData || {};
	const segregated = Array.isArray(parserData.SegregatedSkill)
		? parserData.SegregatedSkill
		: [];

	if (segregated.length > 0) {
		const seen = new Set();
		return segregated
			.map((item) => {
				const name = (item?.FormattedName || item?.Skill || "").trim();
				if (!name) return null;
				return {
					name,
					lastUsed: String(item?.LastUsed || "").trim(),
					experienceInMonths: Number(item?.ExperienceInMonths || 0),
					lastUsedTs: parseRchilliDate(item?.LastUsed),
				};
			})
			.filter(Boolean)
			.sort((a, b) => {
				if (b.lastUsedTs !== a.lastUsedTs) return b.lastUsedTs - a.lastUsedTs;
				if (b.experienceInMonths !== a.experienceInMonths) return b.experienceInMonths - a.experienceInMonths;
				return a.name.localeCompare(b.name);
			})
			.filter((item) => {
				const key = item.name.toLowerCase();
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			});
	}

	return (profile?.skills || "")
		.split(",")
		.map((skill) => skill.trim())
		.filter(Boolean)
		.map((name) => ({ name, lastUsed: "", experienceInMonths: 0, lastUsedTs: 0 }));
};

const getEducationItems = (profile) => {
	const parserData = profile?.parsedResume?.raw?.ResumeParserData || {};
	const items = Array.isArray(parserData.SegregatedQualification)
		? parserData.SegregatedQualification
		: [];

	return items
		.map((edu) => ({
			degree: (edu?.Degree?.DegreeName || edu?.Degree?.NormalizeDegree || "").trim(),
			institution: (edu?.Institution?.Name || "").trim(),
			period: (edu?.FormattedDegreePeriod || [edu?.StartDate, edu?.EndDate].filter(Boolean).join(" - ")).trim(),
			location: [edu?.Institution?.Location?.City, edu?.Institution?.Location?.State, edu?.Institution?.Location?.Country]
				.filter(Boolean)
				.join(", "),
		}))
		.filter((edu) => edu.degree || edu.institution || edu.period || edu.location);
};

// Professional Personal Card Design Modal
const ProfileModal = React.memo(({ profile, onClose, onDownload }) => {
	const parserData = profile?.parsedResume?.raw?.ResumeParserData || {};
	const skillItems = getProfileSkillItems(profile);
	const educationItems = getEducationItems(profile);
	const workedPeriod = parserData?.WorkedPeriod || {};
	const profileMetrics = [
		{ label: "Total Experience", value: workedPeriod?.TotalExperienceInYear ? `${workedPeriod.TotalExperienceInYear} years` : "" },
		{ label: "Average Stay", value: parserData?.AverageStay ? `${parserData.AverageStay} months` : "" },
		{ label: "Longest Stay", value: parserData?.LongestStay ? `${parserData.LongestStay} months` : "" },
		{ label: "Current Employer", value: parserData?.CurrentEmployer || profile?.company || "" },
		{ label: "Current Role", value: parserData?.JobProfile || profile?.jobTitle || "" },
	].filter((item) => item.value);

	return (
		<div
			className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 transition-opacity duration-300"
			onClick={onClose}>
			<div // Main modal container
				className="w-full max-w-xl lg:max-w-6xl max-h-[90vh] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden animate-slide-up flex flex-col border border-slate-200 dark:border-slate-800"
				onClick={(e) => e.stopPropagation()}>
				{/* Header */}
				<div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-4 md:p-8 relative">
					<div className="flex justify-between items-start">
						<div>
							<h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white mb-2 tracking-tight">
								{profile.fullName}
							</h1>
							<div className="flex flex-col md:flex-row items-start md:items-center gap-2 md:gap-4 text-slate-600 dark:text-slate-300 font-medium text-sm md:text-base">
								{profile.jobTitle && (
									<div className="flex items-center gap-2">
										<Briefcase size={18} className="text-slate-500 dark:text-slate-200" />
										<span>{profile.jobTitle}</span>
									</div>
								)}
								{profile.company && (
									<div className="flex items-center gap-2">
										<Building size={18} className="text-slate-500 dark:text-slate-200" />
										<span>{profile.company}</span>
									</div>
								)}
								{profile.experience && (
									<div className="flex items-center gap-2">
										<Calendar size={18} className="text-slate-500 dark:text-slate-200" />
										<span>Experience: {profile.experience}</span>
									</div>
								)}
							</div>
							{profile._loadingDetails && (
								<div className="mt-3 inline-flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-400">
									<Loader className="animate-spin" size={16} />
									Loading full parsed profile...
								</div>
							)}
						</div>
						<button
							onClick={onClose}
							className="text-slate-400 dark:hover:text-white p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors absolute top-6 right-6">
							<X size={24} />
						</button>
					</div>
				</div>

				{/* Body */}
				<div className="p-4 md:p-8 overflow-y-auto flex-1 bg-slate-50 dark:bg-slate-950/50 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-slate-950 [&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-600 [scrollbar-width:thin] [scrollbar-color:#334155_#020617]">
					<div className="grid grid-cols-1 gap-8 min-h-0 lg:[grid-template-columns:30%_70%]">
						{/* Left Column - Contact Info */}
						<div className="lg:col-span-1 space-y-6">
							{/* Contact Card */}
							<div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 md:p-6 space-y-5 shadow-sm">
								<h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2 mb-4">
									Contact Information
								</h3>
								<div className="space-y-3">
									{profile.email && (
										<div className="flex items-start gap-3">
											<Mail
												className="text-slate-500 dark:text-slate-400 mt-0.5 flex-shrink-0"
												size={18}
											/>
											<div>
												<p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">
													Email
												</p>
												<a
													href={`mailto:${profile.email}`}
													className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 break-all font-medium">
													{profile.email}
												</a>
											</div>
										</div>
									)}
									{profile.phone && (
										<div className="flex items-start gap-3">
											<Phone
												className="text-slate-500 dark:text-slate-400 mt-0.5 flex-shrink-0"
												size={18}
											/>
											<div>
												<p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">
													Phone
												</p>
												<a
													href={`tel:${profile.phone}`}
													className="text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 font-medium">
													{profile.phone}
												</a>
											</div>
										</div>
									)}
									{(profile.locality || profile.location) && (
										<div className="flex items-start gap-3">
											<MapPin
												className="text-slate-500 dark:text-slate-400 mt-0.5 flex-shrink-0"
												size={18}
											/>
											<div>
												<p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">
													Location
												</p>
												<p className="text-slate-700 dark:text-slate-300 font-medium">
													{formatLocation(profile.locality, profile.location)}
												</p>
											</div>
										</div>
									)}
								</div>
							</div>

							<div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 md:p-6 space-y-4 shadow-sm">
								<h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2 mb-4">
									<span className="bg-indigo-100 dark:bg-indigo-900/50 p-1.5 rounded-lg">
										<Award className="text-indigo-600 dark:text-indigo-500" size={16} />
									</span>
									Professional Details
								</h3>
								<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
									{profileMetrics.map((item) => (
										<div key={item.label}>
											<p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">
												{item.label}
											</p>
											<p className="text-slate-700 dark:text-slate-300 font-medium">
												{item.value}
											</p>
										</div>
									))}
									{profile.industry && (
										<div>
											<p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">
												Industry
											</p>
											<p className="text-slate-700 dark:text-slate-300 font-medium capitalize">
												{profile.industry.toLowerCase()}
											</p>
										</div>
									)}
								</div>
							</div>

							<div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 md:p-6 shadow-sm">
								<h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2 mb-4">
									<span className="bg-blue-100 dark:bg-blue-900/30 p-1.5 rounded-lg">
										<Award className="text-blue-600 dark:text-blue-500" size={16} />
									</span>
									Education
								</h3>
								{educationItems.length > 0 ? (
									<div className="space-y-3">
										{educationItems.map((edu, idx) => (
											<div key={`${edu.degree}-${idx}`} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
												<p className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
													{edu.degree || "Qualification"}
												</p>
												{edu.institution && (
													<p className="text-slate-700 dark:text-slate-300 text-xs mt-1">{edu.institution}</p>
												)}
												<div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
													{edu.period && <span>{edu.period}</span>}
													{edu.location && <span>{edu.location}</span>}
												</div>
											</div>
										))}
									</div>
								) : (
									<p className="text-slate-400 italic text-sm">No education data available</p>
								)}
							</div>

						</div>

						{/* Right Column - Skills */}
						<div className="lg:col-span-1 space-y-6">
							<div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 md:p-8 shadow-sm">
								<h3 className="text-base md:text-lg font-bold text-slate-800 dark:text-slate-200 mb-4 md:mb-6 flex items-center gap-3">
									<span className="bg-emerald-100 dark:bg-emerald-900/30 p-2 rounded-xl">
										<Award className="text-emerald-600 dark:text-emerald-500" size={24} />
									</span>
									Skills & Expertise
								</h3>
								{skillItems.length > 0 ? (
									<div className="flex flex-wrap gap-2">
										{skillItems.map((skill, i) => (
											<span
												key={`${skill.name}-${i}`}
												title={
													skill.lastUsed
														? `Last used: ${skill.lastUsed}${skill.experienceInMonths ? ` | Experience: ${skill.experienceInMonths} months` : ""}`
														: "Last used: Not available"
												}
												className="inline-flex items-center px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-sm font-medium hover:bg-white dark:hover:bg-slate-700 hover:border-indigo-300 dark:hover:border-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-400 transition-all duration-200 cursor-default">
												{skill.name.replace(/\b\w/g, (l) => l.toUpperCase())}
											</span>
										))}
									</div>
								) : (
									<p className="text-slate-400 italic">No skills listed</p>
								)}
								<div className="mt-8 pt-6 border-t border-slate-200 dark:border-slate-800">
									<button
										onClick={(e) => {
											e.stopPropagation();
											onDownload(profile._id, e);
										}}
										className="w-full bg-slate-900 dark:bg-indigo-600 hover:bg-slate-800 dark:hover:bg-indigo-500 text-white py-3 md:py-4 rounded-xl font-bold shadow-lg shadow-slate-200 dark:shadow-indigo-900/20 hover:shadow-xl hover:shadow-slate-300 dark:hover:shadow-indigo-900/30 transition-all flex items-center justify-center gap-3 transform active:scale-[0.99]">
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
	);
});

export default UserSearch;

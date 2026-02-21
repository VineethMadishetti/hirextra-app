import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, RefreshCw, Search, Sparkles, XCircle } from "lucide-react";
import toast from "react-hot-toast";
import api from "../api/axios";

const PAGE_SIZE = 20;

const MANUAL_FIELDS = [
	{ key: "email", label: "Email" },
	{ key: "phone", label: "Phone" },
	{ key: "linkedinUrl", label: "LinkedIn URL" },
	{ key: "jobTitle", label: "Job Title" },
	{ key: "company", label: "Company" },
	{ key: "location", label: "Location" },
	{ key: "skills", label: "Skills" },
];

const formatDateTime = (value) => {
	if (!value) return "NA";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "NA";
	return date.toLocaleString();
};

const getDefaultSuggestionFields = (suggestions) =>
	new Set((suggestions || []).map((item) => String(item.field || "")).filter(Boolean));

const Enrich = () => {
	const queryClient = useQueryClient();
	const manualFormRef = useRef(null);
	const [page, setPage] = useState(1);
	const [searchTerm, setSearchTerm] = useState("");
	const [needsOnly, setNeedsOnly] = useState(true);
	const [activeCandidateId, setActiveCandidateId] = useState("");
	const [selectedFieldsByCandidate, setSelectedFieldsByCandidate] = useState({});

	const queueQuery = useQuery({
		queryKey: ["enrichmentQueue", page, searchTerm, needsOnly],
		queryFn: async () => {
			const params = new URLSearchParams({
				page: String(page),
				limit: String(PAGE_SIZE),
				needsOnly: String(needsOnly),
			});
			if (searchTerm.trim()) params.set("q", searchTerm.trim());
			const { data } = await api.get(`/candidates/enrich/queue?${params.toString()}`);
			return data;
		},
	});

	const queueItems = queueQuery.data?.items || [];
	const totalCount = Number(queueQuery.data?.totalCount || 0);
	const hasMore = !!queueQuery.data?.hasMore;
	const summary = queueQuery.data?.summary || {};
	const resolvedActiveCandidateId = queueItems.some(
		(item) => String(item._id) === String(activeCandidateId)
	)
		? String(activeCandidateId)
		: queueItems[0]
			? String(queueItems[0]._id)
			: "";

	const detailQuery = useQuery({
		queryKey: ["enrichmentDetail", resolvedActiveCandidateId],
		queryFn: async () => {
			const { data } = await api.get(`/candidates/enrich/${resolvedActiveCandidateId}`);
			return data;
		},
		enabled: !!resolvedActiveCandidateId,
	});

	const runEnrichMutation = useMutation({
		mutationFn: async (candidateId) => {
			const { data } = await api.post("/candidates/enrich/run", {
				candidateIds: [candidateId],
			});
			return data;
		},
		onSuccess: (data) => {
			toast.success(data?.message || "Enrichment completed");
			queryClient.invalidateQueries({ queryKey: ["enrichmentQueue"] });
			queryClient.invalidateQueries({ queryKey: ["enrichmentDetail"] });
		},
		onError: (err) => {
			toast.error(err?.response?.data?.message || "Failed to run enrichment");
		},
	});

	const reviewMutation = useMutation({
		mutationFn: async ({ action, selectedFields, manual }) => {
			const payload = { action };
			if (selectedFields) payload.selectedFields = selectedFields;
			if (manual) payload.manualUpdates = manual;
			const { data } = await api.post(
				`/candidates/enrich/${resolvedActiveCandidateId}/review`,
				payload
			);
			return data;
		},
		onSuccess: (data) => {
			toast.success(data?.message || "Review saved");
			queryClient.invalidateQueries({ queryKey: ["enrichmentQueue"] });
			queryClient.invalidateQueries({ queryKey: ["enrichmentDetail"] });
		},
		onError: (err) => {
			toast.error(err?.response?.data?.message || "Failed to save review");
		},
	});

	const activeCandidate = detailQuery.data?.candidate;
	const suggestions = detailQuery.data?.suggestions || [];
	const meta = detailQuery.data?.meta || {};
	const isBusy = runEnrichMutation.isPending || reviewMutation.isPending;
	const selectedSuggestionFields = (() => {
		const stored = selectedFieldsByCandidate[resolvedActiveCandidateId];
		if (!Array.isArray(stored)) return getDefaultSuggestionFields(suggestions);
		return new Set(stored);
	})();

	const toggleSuggestionField = (field) => {
		if (!resolvedActiveCandidateId) return;
		setSelectedFieldsByCandidate((prev) => {
			const fallback = getDefaultSuggestionFields(suggestions);
			const current = new Set(
				Array.isArray(prev[resolvedActiveCandidateId])
					? prev[resolvedActiveCandidateId]
					: Array.from(fallback)
			);
			const next = new Set(current);
			if (next.has(field)) next.delete(field);
			else next.add(field);
			return {
				...prev,
				[resolvedActiveCandidateId]: Array.from(next),
			};
		});
	};

	const onApproveSelected = () => {
		const selectedFields = Array.from(selectedSuggestionFields);
		if (selectedFields.length === 0) {
			toast.error("Select at least one suggestion");
			return;
		}
		reviewMutation.mutate({ action: "APPROVE", selectedFields });
	};

	const onRejectAll = () => {
		reviewMutation.mutate({ action: "REJECT" });
	};

	const onSaveManual = () => {
		if (!activeCandidate || !manualFormRef.current) return;
		const formData = new FormData(manualFormRef.current);
		const changed = {};
		for (const field of MANUAL_FIELDS) {
			const key = field.key;
			const nextValue = String(formData.get(key) || "").trim();
			const prevValue = String(activeCandidate[key] || "").trim();
			if (nextValue !== prevValue) changed[key] = nextValue;
		}
		if (Object.keys(changed).length === 0) {
			toast.error("No manual changes to save");
			return;
		}
		reviewMutation.mutate({ action: "EDIT", manual: changed });
	};

	return (
		<div className="h-[calc(100vh-64px)] overflow-auto bg-slate-50 px-3 py-4 md:px-6 md:py-6">
			<div className="mx-auto max-w-[1400px] space-y-4">
				<div className="rounded-2xl border border-slate-200 bg-white p-4">
					<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
						<div>
							<h1 className="text-2xl font-bold text-slate-900">Candidate Enrichment</h1>
							<p className="text-sm text-slate-600">
								Simple review flow for missing or stale candidate profiles.
							</p>
						</div>
						<div className="flex flex-col gap-2 md:flex-row md:items-center">
							<div className="relative min-w-[250px]">
								<Search
									size={15}
									className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
								/>
								<input
									value={searchTerm}
									onChange={(e) => {
										setPage(1);
										setSearchTerm(e.target.value);
									}}
									placeholder="Search candidates"
									className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none ring-cyan-200 focus:ring-2"
								/>
							</div>
							<button
								onClick={() => {
									setPage(1);
									setNeedsOnly((prev) => !prev);
								}}
								className={`rounded-lg border px-3 py-2 text-sm font-medium ${
									needsOnly
										? "border-cyan-200 bg-cyan-50 text-cyan-700"
										: "border-slate-200 bg-white text-slate-700"
								}`}>
								Needs Enrichment Only
							</button>
							<button
								onClick={() => {
									queryClient.invalidateQueries({ queryKey: ["enrichmentQueue"] });
									queryClient.invalidateQueries({ queryKey: ["enrichmentDetail"] });
								}}
								className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
								<RefreshCw size={14} />
								Refresh
							</button>
						</div>
					</div>
					<div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
						<span className="rounded-full bg-slate-100 px-2 py-1">
							Total in queue: {totalCount.toLocaleString()}
						</span>
						<span className="rounded-full bg-slate-100 px-2 py-1">
							Need enrichment: {Number(summary.needEnrichment || 0).toLocaleString()}
						</span>
						<span className="rounded-full bg-slate-100 px-2 py-1">
							Ready: {Number(summary.readyToSubmit || 0).toLocaleString()}
						</span>
					</div>
				</div>

				<div className="grid grid-cols-1 gap-4 xl:grid-cols-[55%_45%]">
					<div className="rounded-2xl border border-slate-200 bg-white p-4">
						<div className="mb-3 text-sm font-semibold text-slate-700">
							Queue ({queueItems.length} shown)
						</div>
						<div className="max-h-[620px] overflow-auto rounded-xl border border-slate-200">
							<table className="w-full min-w-[700px] text-left text-sm">
								<thead className="sticky top-0 bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
									<tr>
										<th className="px-3 py-3">Candidate</th>
										<th className="px-3 py-3">Completeness</th>
										<th className="px-3 py-3">Missing</th>
										<th className="px-3 py-3">Status</th>
										<th className="px-3 py-3 text-right">Action</th>
									</tr>
								</thead>
								<tbody>
									{queueQuery.isLoading ? (
										<tr>
											<td colSpan={5} className="px-3 py-10 text-center text-slate-500">
												<Loader2 size={18} className="mx-auto mb-2 animate-spin" />
												Loading queue...
											</td>
										</tr>
									) : queueItems.length === 0 ? (
										<tr>
											<td colSpan={5} className="px-3 py-10 text-center text-slate-500">
												No candidates found.
											</td>
										</tr>
									) : (
										queueItems.map((item) => {
											const id = String(item._id);
											const isActive = id === String(resolvedActiveCandidateId);
											return (
												<tr
													key={id}
													className={`border-t border-slate-100 ${
														isActive ? "bg-cyan-50/70" : "hover:bg-slate-50"
													}`}>
													<td
														onClick={() => setActiveCandidateId(id)}
														className="cursor-pointer px-3 py-3 align-top">
														<div className="font-semibold text-slate-900">{item.fullName}</div>
														<div className="text-xs text-slate-600">
															{item.jobTitle || "NA"}
															{item.company ? ` | ${item.company}` : ""}
														</div>
													</td>
													<td className="px-3 py-3 align-top font-medium text-slate-700">
														{item.completenessScore || 0}%
													</td>
													<td className="px-3 py-3 align-top text-xs text-slate-600">
														{(item.missingFields || []).slice(0, 2).join(", ") || "NA"}
														{(item.missingFields || []).length > 2
															? ` +${item.missingFields.length - 2}`
															: ""}
													</td>
													<td className="px-3 py-3 align-top">
														<span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700">
															{item.suggestionStatus || "NONE"}
														</span>
													</td>
													<td className="px-3 py-3 text-right align-top">
														<button
															onClick={() => {
																setActiveCandidateId(id);
																runEnrichMutation.mutate(id);
															}}
															disabled={isBusy}
															className="inline-flex items-center gap-1 rounded-md bg-cyan-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-cyan-700 disabled:opacity-50">
															{runEnrichMutation.isPending &&
															String(resolvedActiveCandidateId) === id ? (
																<Loader2 size={12} className="animate-spin" />
															) : (
																<Sparkles size={12} />
															)}
															Enrich
														</button>
													</td>
												</tr>
											);
										})
									)}
								</tbody>
							</table>
						</div>
						<div className="mt-3 flex items-center justify-between">
							<button
								onClick={() => setPage((prev) => Math.max(1, prev - 1))}
								disabled={page === 1}
								className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-40">
								Previous
							</button>
							<div className="text-xs font-semibold text-slate-600">Page {page}</div>
							<button
								onClick={() => setPage((prev) => prev + 1)}
								disabled={!hasMore}
								className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-40">
								Next
							</button>
						</div>
					</div>

					<div className="rounded-2xl border border-slate-200 bg-white p-4">
						<div className="mb-3 flex items-center justify-between">
							<h2 className="text-base font-bold text-slate-900">Review Panel</h2>
							{meta.suggestionStatus && (
								<span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700">
									{meta.suggestionStatus}
								</span>
							)}
						</div>

						{detailQuery.isLoading ? (
							<div className="py-12 text-center text-slate-500">
								<Loader2 size={18} className="mx-auto mb-2 animate-spin" />
								Loading candidate...
							</div>
						) : !activeCandidate ? (
							<div className="py-12 text-center text-slate-500">Select a candidate from queue.</div>
						) : (
							<div className="space-y-4">
								<div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
									<div className="text-sm font-semibold text-slate-900">{activeCandidate.fullName}</div>
									<div className="mt-1 text-xs text-slate-600">
										{activeCandidate.jobTitle || "NA"}
										{activeCandidate.company ? ` | ${activeCandidate.company}` : ""}
									</div>
									<div className="mt-2 grid grid-cols-1 gap-1 text-xs text-slate-600 md:grid-cols-2">
										<div>Email: {activeCandidate.email || "NA"}</div>
										<div>Phone: {activeCandidate.phone || "NA"}</div>
										<div className="md:col-span-2">
											LinkedIn: {activeCandidate.linkedinUrl || "NA"}
										</div>
										<div>Completeness: {meta.completenessScore || 0}%</div>
										<div>Last Enriched: {formatDateTime(meta.lastEnrichedAt)}</div>
									</div>
									<button
										onClick={() => runEnrichMutation.mutate(String(activeCandidate._id))}
										disabled={isBusy}
										className="mt-3 inline-flex items-center gap-2 rounded-md bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-700 disabled:opacity-50">
										{runEnrichMutation.isPending ? (
											<Loader2 size={14} className="animate-spin" />
										) : (
											<Sparkles size={14} />
										)}
										Run Enrichment
									</button>
								</div>

								<div className="rounded-xl border border-slate-200 p-3">
									<div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
										Suggested Updates
									</div>
									<div className="max-h-[260px] space-y-2 overflow-auto">
										{suggestions.length === 0 ? (
											<div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
												No suggestions yet. Run enrichment first.
											</div>
										) : (
											suggestions.map((item, index) => {
												const field = String(item.field || "");
												const checked = selectedSuggestionFields.has(field);
												return (
													<label
														key={`${field}-${index}`}
														className="block cursor-pointer rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
														<div className="flex items-center justify-between gap-2">
															<div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800">
																<input
																	type="checkbox"
																	checked={checked}
																	onChange={() => toggleSuggestionField(field)}
																	className="h-4 w-4 rounded border-slate-300 text-cyan-600"
																/>
																{field || "Unknown field"}
															</div>
															<span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700">
																{Number(item.confidence || 0)}%
															</span>
														</div>
														<div className="mt-1 text-xs text-slate-500">
															Current: {item.currentValue || "NA"}
														</div>
														<div className="mt-1 text-sm text-slate-800">
															Suggested: {item.suggestedValue || "NA"}
														</div>
														<div className="mt-1 text-[11px] text-slate-500">
															Source: {item.source || "NA"}
														</div>
													</label>
												);
											})
										)}
									</div>
									<div className="mt-3 flex flex-wrap gap-2">
										<button
											onClick={onApproveSelected}
											disabled={isBusy || suggestions.length === 0}
											className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
											<CheckCircle2 size={13} />
											Approve Selected
										</button>
										<button
											onClick={onRejectAll}
											disabled={isBusy || suggestions.length === 0}
											className="inline-flex items-center gap-2 rounded-md bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
											<XCircle size={13} />
											Reject All
										</button>
									</div>
								</div>

								<form
									key={resolvedActiveCandidateId}
									ref={manualFormRef}
									onSubmit={(e) => {
										e.preventDefault();
										onSaveManual();
									}}
									className="rounded-xl border border-slate-200 bg-slate-50 p-3">
									<div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
										Manual Updates
									</div>
									<div className="grid grid-cols-1 gap-2 md:grid-cols-2">
										{MANUAL_FIELDS.map((field) => (
											<div key={field.key} className="space-y-1">
												<label className="text-xs font-medium text-slate-600">{field.label}</label>
												<input
													name={field.key}
													defaultValue={String(
														(field.key === "location"
															? activeCandidate.location || activeCandidate.locality
															: activeCandidate[field.key]) || ""
													)}
													placeholder={field.label}
													className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs outline-none ring-cyan-200 focus:ring-2"
												/>
											</div>
										))}
									</div>
									<button
										type="submit"
										disabled={isBusy}
										className="mt-3 inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50">
										{reviewMutation.isPending ? (
											<Loader2 size={14} className="animate-spin" />
										) : (
											<CheckCircle2 size={14} />
										)}
										Save Manual Changes
									</button>
								</form>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
};

export default Enrich;

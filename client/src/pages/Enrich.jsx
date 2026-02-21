import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CheckCircle2,
	CircleDashed,
	Clock3,
	Database,
	Loader2,
	Mail,
	Phone,
	RefreshCw,
	Search,
	Sparkles,
	UserCheck,
	XCircle,
} from "lucide-react";
import toast from "react-hot-toast";
import api from "../api/axios";

const PAGE_SIZE = 20;

const formatDateTime = (value) => {
	if (!value) return "NA";
	const d = new Date(value);
	if (Number.isNaN(d.getTime())) return "NA";
	return d.toLocaleString();
};

const confidenceClass = (confidence) => {
	if (confidence >= 85) return "text-emerald-600 bg-emerald-50 border-emerald-200";
	if (confidence >= 70) return "text-amber-700 bg-amber-50 border-amber-200";
	return "text-rose-700 bg-rose-50 border-rose-200";
};

const Enrich = () => {
	const queryClient = useQueryClient();
	const [page, setPage] = useState(1);
	const [searchTerm, setSearchTerm] = useState("");
	const [needsOnly, setNeedsOnly] = useState(true);
	const [selectedIds, setSelectedIds] = useState(new Set());
	const [activeCandidateId, setActiveCandidateId] = useState("");
	const [selectedSuggestionFields, setSelectedSuggestionFields] = useState(new Set());
	const [manualUpdates, setManualUpdates] = useState({
		email: "",
		phone: "",
		linkedinUrl: "",
		jobTitle: "",
		company: "",
		location: "",
		skills: "",
	});

	const queueQuery = useQuery({
		queryKey: ["enrichmentQueue", page, searchTerm, needsOnly],
		queryFn: async () => {
			const params = new URLSearchParams({
				page: String(page),
				limit: String(PAGE_SIZE),
				needsOnly: String(needsOnly),
			});
			if (searchTerm.trim()) params.set("q", searchTerm.trim());
			const { data } = await api.get(`/candidates/enrich/queue?${params}`);
			return data;
		},
	});

	const queueItems = queueQuery.data?.items || [];
	const summary = queueQuery.data?.summary || {};
	const totalCount = Number(queueQuery.data?.totalCount || 0);
	const hasMore = !!queueQuery.data?.hasMore;

	useEffect(() => {
		if (queueItems.length === 0) {
			setActiveCandidateId("");
			return;
		}
		const exists = queueItems.some((item) => String(item._id) === String(activeCandidateId));
		if (!activeCandidateId || !exists) {
			setActiveCandidateId(String(queueItems[0]._id));
		}
	}, [queueItems, activeCandidateId]);

	const detailQuery = useQuery({
		queryKey: ["enrichmentDetail", activeCandidateId],
		queryFn: async () => {
			const { data } = await api.get(`/candidates/enrich/${activeCandidateId}`);
			return data;
		},
		enabled: !!activeCandidateId,
	});

	const auditQuery = useQuery({
		queryKey: ["enrichmentAudit"],
		queryFn: async () => {
			const { data } = await api.get("/candidates/enrich/audit?limit=12&page=1");
			return data;
		},
	});

	useEffect(() => {
		const candidate = detailQuery.data?.candidate;
		const suggestions = detailQuery.data?.suggestions || [];
		if (!candidate) return;
		setManualUpdates({
			email: candidate.email || "",
			phone: candidate.phone || "",
			linkedinUrl: candidate.linkedinUrl || "",
			jobTitle: candidate.jobTitle || "",
			company: candidate.company || "",
			location: candidate.location || candidate.locality || "",
			skills: candidate.skills || "",
		});
		setSelectedSuggestionFields(new Set(suggestions.map((s) => String(s.field))));
	}, [detailQuery.data]);

	const runEnrichMutation = useMutation({
		mutationFn: async (candidateIds) => {
			const { data } = await api.post("/candidates/enrich/run", { candidateIds });
			return data;
		},
		onSuccess: (data) => {
			toast.success(data?.message || "Enrichment completed");
			setSelectedIds(new Set());
			queryClient.invalidateQueries({ queryKey: ["enrichmentQueue"] });
			queryClient.invalidateQueries({ queryKey: ["enrichmentDetail"] });
			queryClient.invalidateQueries({ queryKey: ["enrichmentAudit"] });
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
			const { data } = await api.post(`/candidates/enrich/${activeCandidateId}/review`, payload);
			return data;
		},
		onSuccess: (data) => {
			toast.success(data?.message || "Review saved");
			queryClient.invalidateQueries({ queryKey: ["enrichmentQueue"] });
			queryClient.invalidateQueries({ queryKey: ["enrichmentDetail"] });
			queryClient.invalidateQueries({ queryKey: ["enrichmentAudit"] });
		},
		onError: (err) => {
			toast.error(err?.response?.data?.message || "Failed to save review");
		},
	});

	const selectedCount = selectedIds.size;

	const canBulkEnrich = selectedCount > 0 && !runEnrichMutation.isPending;
	const isBusy = runEnrichMutation.isPending || reviewMutation.isPending;
	const suggestions = detailQuery.data?.suggestions || [];
	const activeCandidate = detailQuery.data?.candidate;
	const activeMeta = detailQuery.data?.meta;

	const toggleSelect = (candidateId) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(candidateId)) next.delete(candidateId);
			else next.add(candidateId);
			return next;
		});
	};

	const toggleSelectAllCurrentPage = () => {
		const currentIds = queueItems.map((item) => String(item._id));
		const allSelected = currentIds.length > 0 && currentIds.every((id) => selectedIds.has(id));
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (allSelected) currentIds.forEach((id) => next.delete(id));
			else currentIds.forEach((id) => next.add(id));
			return next;
		});
	};

	const onApproveSelected = () => {
		const selectedFields = Array.from(selectedSuggestionFields);
		if (selectedFields.length === 0) {
			toast.error("Select at least one suggestion to approve");
			return;
		}
		reviewMutation.mutate({ action: "APPROVE", selectedFields });
	};

	const onRejectSuggestions = () => {
		reviewMutation.mutate({ action: "REJECT" });
	};

	const onSaveManual = () => {
		if (!activeCandidate) return;
		const changed = {};
		for (const [field, value] of Object.entries(manualUpdates)) {
			if (String(value || "").trim() !== String(activeCandidate[field] || "").trim()) {
				changed[field] = value;
			}
		}
		if (Object.keys(changed).length === 0) {
			toast.error("No manual changes to save");
			return;
		}
		reviewMutation.mutate({ action: "EDIT", manual: changed });
	};

	const statCards = useMemo(
		() => [
			{
				label: "Need Enrichment",
				value: Number(summary.needEnrichment || 0).toLocaleString(),
				icon: <Sparkles size={18} className="text-cyan-600" />,
			},
			{
				label: "Ready To Submit",
				value: Number(summary.readyToSubmit || 0).toLocaleString(),
				icon: <UserCheck size={18} className="text-emerald-600" />,
			},
			{
				label: "Missing Contact",
				value: Number(summary.missingContact || 0).toLocaleString(),
				icon: <Phone size={18} className="text-amber-600" />,
			},
			{
				label: "Stale Profiles",
				value: Number(summary.staleProfiles || 0).toLocaleString(),
				icon: <Clock3 size={18} className="text-rose-600" />,
			},
			{
				label: "Avg Completeness",
				value: `${Number(summary.avgCompleteness || 0)}%`,
				icon: <Database size={18} className="text-slate-700" />,
			},
		],
		[summary]
	);

	return (
		<div className="h-[calc(100vh-64px)] overflow-auto bg-[radial-gradient(circle_at_20%_20%,rgba(56,189,248,0.12),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(16,185,129,0.10),transparent_32%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] px-3 py-4 md:px-6 md:py-6">
			<div className="mx-auto max-w-[1600px] space-y-5">
				<div className="rounded-3xl border border-slate-200 bg-white/85 p-4 shadow-xl shadow-slate-200/70 backdrop-blur md:p-6">
					<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
						<div>
							<h1 className="text-2xl font-black tracking-tight text-slate-900 md:text-3xl">
								Enrichment Workbench
							</h1>
							<p className="mt-1 text-sm text-slate-600">
								Review and upgrade candidate profiles before submission.
							</p>
						</div>
						<div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center">
							<div className="relative min-w-[260px]">
								<Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
								<input
									value={searchTerm}
									onChange={(e) => {
										setPage(1);
										setSearchTerm(e.target.value);
									}}
									placeholder="Search queue..."
									className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-800 outline-none ring-cyan-200 transition focus:ring-2"
								/>
							</div>
							<button
								onClick={() => {
									setNeedsOnly((prev) => !prev);
									setPage(1);
								}}
								className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
									needsOnly
										? "border-cyan-200 bg-cyan-50 text-cyan-700"
										: "border-slate-200 bg-white text-slate-600"
								}`}>
								Needs Enrichment Only
							</button>
							<button
								onClick={() => {
									queryClient.invalidateQueries({ queryKey: ["enrichmentQueue"] });
									queryClient.invalidateQueries({ queryKey: ["enrichmentDetail"] });
									queryClient.invalidateQueries({ queryKey: ["enrichmentAudit"] });
								}}
								className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
								<RefreshCw size={14} />
								Refresh
							</button>
						</div>
					</div>
					<div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
						{statCards.map((item) => (
							<div
								key={item.label}
								className="rounded-2xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 px-4 py-3">
								<div className="flex items-center justify-between">
									<p className="text-xs font-bold uppercase tracking-wider text-slate-500">
										{item.label}
									</p>
									{item.icon}
								</div>
								<p className="mt-2 text-xl font-black text-slate-900">{item.value}</p>
							</div>
						))}
					</div>
				</div>

				<div className="grid grid-cols-1 gap-4 xl:grid-cols-[58%_42%]">
					<div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-lg md:p-5">
						<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
							<div className="text-sm font-semibold text-slate-700">
								Queue: {totalCount.toLocaleString()} candidates
							</div>
							<div className="flex items-center gap-2">
								<button
									onClick={toggleSelectAllCurrentPage}
									className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
									Toggle Page Selection
								</button>
								<button
									disabled={!canBulkEnrich}
									onClick={() => runEnrichMutation.mutate(Array.from(selectedIds))}
									className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition ${
										canBulkEnrich
											? "bg-cyan-600 hover:bg-cyan-700"
											: "cursor-not-allowed bg-cyan-300"
									}`}>
									{runEnrichMutation.isPending ? (
										<Loader2 size={14} className="animate-spin" />
									) : (
										<Sparkles size={14} />
									)}
									Enrich Selected ({selectedCount})
								</button>
							</div>
						</div>

						<div className="max-h-[560px] overflow-auto rounded-2xl border border-slate-200">
							<table className="w-full min-w-[760px] text-left text-sm">
								<thead className="sticky top-0 bg-slate-100/90 text-xs uppercase tracking-wide text-slate-600">
									<tr>
										<th className="px-3 py-3">#</th>
										<th className="px-3 py-3">Candidate</th>
										<th className="px-3 py-3">Completeness</th>
										<th className="px-3 py-3">Missing</th>
										<th className="px-3 py-3">Stale</th>
										<th className="px-3 py-3">Status</th>
										<th className="px-3 py-3 text-right">Action</th>
									</tr>
								</thead>
								<tbody>
									{queueQuery.isLoading ? (
										<tr>
											<td colSpan={7} className="px-3 py-10 text-center text-slate-500">
												<Loader2 className="mx-auto mb-2 animate-spin" size={18} />
												Loading enrichment queue...
											</td>
										</tr>
									) : queueItems.length === 0 ? (
										<tr>
											<td colSpan={7} className="px-3 py-10 text-center text-slate-500">
												No candidates in queue.
											</td>
										</tr>
									) : (
										queueItems.map((item, index) => {
											const id = String(item._id);
											const isSelected = selectedIds.has(id);
											const isActive = String(activeCandidateId) === id;
											return (
												<tr
													key={id}
													className={`border-t border-slate-100 transition ${
														isActive ? "bg-cyan-50/60" : "hover:bg-slate-50"
													}`}>
													<td className="px-3 py-3 align-top">
														<input
															type="checkbox"
															checked={isSelected}
															onChange={() => toggleSelect(id)}
															className="h-4 w-4 rounded border-slate-300 text-cyan-600"
														/>
													</td>
													<td
														className="cursor-pointer px-3 py-3 align-top"
														onClick={() => setActiveCandidateId(id)}>
														<div className="font-semibold text-slate-900">{item.fullName}</div>
														<div className="text-xs text-slate-600">
															{item.jobTitle || "NA"}{item.company ? ` | ${item.company}` : ""}
														</div>
													</td>
													<td className="px-3 py-3 align-top">
														<div className="w-32">
															<div className="h-2 overflow-hidden rounded-full bg-slate-200">
																<div
																	className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500"
																	style={{ width: `${Math.min(100, Number(item.completenessScore || 0))}%` }}
																/>
															</div>
															<div className="mt-1 text-xs font-semibold text-slate-700">
																{item.completenessScore}%
															</div>
														</div>
													</td>
													<td className="px-3 py-3 align-top">
														<div className="flex max-w-[220px] flex-wrap gap-1">
															{(item.missingFields || []).slice(0, 3).map((field) => (
																<span
																	key={`${id}-${field}`}
																	className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
																	{field}
																</span>
															))}
															{(item.missingFields || []).length > 3 && (
																<span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
																	+{item.missingFields.length - 3}
																</span>
															)}
														</div>
													</td>
													<td className="px-3 py-3 align-top text-xs font-semibold text-slate-700">
														{item.staleDays}d
													</td>
													<td className="px-3 py-3 align-top">
														<span
															className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
																item.suggestionStatus === "PENDING"
																	? "border-cyan-200 bg-cyan-50 text-cyan-700"
																	: item.suggestionStatus === "APPLIED"
																		? "border-emerald-200 bg-emerald-50 text-emerald-700"
																		: item.suggestionStatus === "REJECTED"
																			? "border-rose-200 bg-rose-50 text-rose-700"
																			: "border-slate-200 bg-slate-50 text-slate-600"
															}`}>
															{item.suggestionStatus}
														</span>
													</td>
													<td className="px-3 py-3 text-right align-top">
														<button
															onClick={() => {
																setActiveCandidateId(id);
																runEnrichMutation.mutate([id]);
															}}
															disabled={runEnrichMutation.isPending}
															className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-700 disabled:opacity-50">
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
								onClick={() => setPage((p) => Math.max(1, p - 1))}
								disabled={page === 1}
								className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-40">
								Previous
							</button>
							<div className="text-xs font-semibold text-slate-600">
								Page {page}
							</div>
							<button
								onClick={() => setPage((p) => p + 1)}
								disabled={!hasMore}
								className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-40">
								Next
							</button>
						</div>
					</div>

					<div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-lg md:p-5">
						<div className="mb-3 flex items-center justify-between">
							<h2 className="text-base font-black tracking-tight text-slate-900">Enrichment Panel</h2>
							{activeMeta?.suggestionStatus && (
								<span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
									{activeMeta.suggestionStatus}
								</span>
							)}
						</div>

						{detailQuery.isLoading ? (
							<div className="py-12 text-center text-slate-500">
								<Loader2 className="mx-auto mb-2 animate-spin" size={18} />
								Loading candidate...
							</div>
						) : !activeCandidate ? (
							<div className="py-12 text-center text-slate-500">Select a candidate from queue.</div>
						) : (
							<div className="space-y-4">
								<div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
									<div className="text-sm font-bold text-slate-900">{activeCandidate.fullName}</div>
									<div className="mt-1 text-xs text-slate-600">
										{activeCandidate.jobTitle || "NA"}{activeCandidate.company ? ` | ${activeCandidate.company}` : ""}
									</div>
									<div className="mt-2 flex flex-wrap gap-2 text-[11px]">
										<span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
											Completeness: {activeMeta?.completenessScore || 0}%
										</span>
										<span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
											Stale: {activeMeta?.staleDays || 0} days
										</span>
									</div>
								</div>

								<div>
									<div className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
										Suggested Updates
									</div>
									<div className="max-h-[250px] space-y-2 overflow-auto pr-1">
										{suggestions.length === 0 ? (
											<div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
												No pending suggestions. Run enrichment first.
											</div>
										) : (
											suggestions.map((item, idx) => {
												const key = `${item.field}-${idx}`;
												const checked = selectedSuggestionFields.has(String(item.field));
												return (
													<div key={key} className="rounded-xl border border-slate-200 bg-white p-3">
														<div className="mb-1 flex items-center justify-between">
															<label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800">
																<input
																	type="checkbox"
																	checked={checked}
																	onChange={(e) => {
																		setSelectedSuggestionFields((prev) => {
																			const next = new Set(prev);
																			if (e.target.checked) next.add(String(item.field));
																			else next.delete(String(item.field));
																			return next;
																		});
																	}}
																	className="h-4 w-4 rounded border-slate-300 text-cyan-600"
																/>
																{item.field}
															</label>
															<span
																className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${confidenceClass(
																	Number(item.confidence || 0)
																)}`}>
																{item.confidence || 0}%
															</span>
														</div>
														<div className="text-xs text-slate-500">Current: {item.currentValue || "NA"}</div>
														<div className="mt-1 text-sm font-semibold text-slate-800">
															Suggested: {item.suggestedValue || "NA"}
														</div>
														<div className="mt-1 text-[11px] text-slate-500">
															Source: {item.source || "NA"} | {item.reason || "No reason"}
														</div>
													</div>
												);
											})
										)}
									</div>
								</div>

								<div className="flex flex-wrap gap-2">
									<button
										onClick={onApproveSelected}
										disabled={isBusy || suggestions.length === 0}
										className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
										<CheckCircle2 size={14} />
										Approve Selected
									</button>
									<button
										onClick={onRejectSuggestions}
										disabled={isBusy || suggestions.length === 0}
										className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
										<XCircle size={14} />
										Reject Suggestions
									</button>
								</div>

								<div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
									<div className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
										Manual Updates
									</div>
									<div className="grid grid-cols-1 gap-2 md:grid-cols-2">
										{Object.entries(manualUpdates).map(([field, value]) => (
											<input
												key={field}
												value={value}
												onChange={(e) =>
													setManualUpdates((prev) => ({ ...prev, [field]: e.target.value }))
												}
												placeholder={field}
												className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none ring-cyan-200 focus:ring-2"
											/>
										))}
									</div>
									<button
										onClick={onSaveManual}
										disabled={isBusy}
										className="mt-3 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50">
										{reviewMutation.isPending ? (
											<Loader2 size={14} className="animate-spin" />
										) : (
											<CircleDashed size={14} />
										)}
										Save Manual Changes
									</button>
								</div>
							</div>
						)}
					</div>
				</div>

				<div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-lg md:p-5">
					<div className="mb-3 flex items-center justify-between">
						<h2 className="text-base font-black tracking-tight text-slate-900">Enrichment Audit Log</h2>
						<button
							onClick={() => queryClient.invalidateQueries({ queryKey: ["enrichmentAudit"] })}
							className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
							<RefreshCw size={12} />
							Refresh
						</button>
					</div>
					<div className="space-y-2">
						{auditQuery.isLoading ? (
							<div className="py-6 text-center text-sm text-slate-500">
								<Loader2 className="mx-auto mb-2 animate-spin" size={16} />
								Loading audit logs...
							</div>
						) : (auditQuery.data?.items || []).length === 0 ? (
							<div className="py-6 text-center text-sm text-slate-500">No audit activity yet.</div>
						) : (
							(auditQuery.data?.items || []).map((log) => (
								<div
									key={String(log._id)}
									className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
									<div className="flex flex-wrap items-center justify-between gap-2">
										<div className="font-semibold text-slate-800">
											{log?.candidate?.fullName || "Unknown Candidate"} | {log.action}
										</div>
										<div className="text-slate-500">{formatDateTime(log.createdAt)}</div>
									</div>
									<div className="mt-1 flex flex-wrap gap-2 text-slate-600">
										<span>By: {log?.performedBy?.name || "NA"}</span>
										<span>Provider: {log.provider || "NA"}</span>
										<span>Changes: {(log.changes || []).length}</span>
										<span className="inline-flex items-center gap-1">
											<Mail size={12} />
											{(log.changes || []).slice(0, 1).map((c) => c.field).join(", ") || "NA"}
										</span>
									</div>
								</div>
							))
						)}
					</div>
				</div>
			</div>
		</div>
	);
};

export default Enrich;

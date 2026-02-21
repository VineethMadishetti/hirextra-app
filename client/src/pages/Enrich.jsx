import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	Building2,
	CalendarClock,
	ClipboardList,
	Download,
	FileText,
	Filter,
	History,
	Loader2,
	Mail,
	MapPin,
	PencilLine,
	Phone,
	RefreshCw,
	Save,
	Search,
	ShieldAlert,
	ShieldCheck,
	ShieldX,
	Tags,
	UserCircle2,
	Users,
	X,
} from "lucide-react";
import toast from "react-hot-toast";
import api from "../api/axios";

const PAGE_SIZE = 20;

const VERIFICATION_OPTIONS = [
	{ value: "NEEDS_REVIEW", label: "Needs Review" },
	{ value: "VERIFIED", label: "Verified" },
	{ value: "NOT_VERIFIED", label: "Not Verified" },
];

const fieldInputClass =
	"w-full rounded-xl border border-slate-700 bg-slate-800/70 px-3 py-2 text-sm text-slate-100 placeholder-slate-400 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30";

const sectionCardClass =
	"rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl shadow-slate-950/40";

const formatDateTime = (value) => {
	if (!value) return "NA";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "NA";
	return date.toLocaleString();
};

const toSkillsArray = (value) => {
	const seen = new Set();
	return String(value || "")
		.split(/[;,]/g)
		.map((item) => item.trim())
		.filter(Boolean)
		.filter((item) => {
			const key = item.toLowerCase();
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
};

const VerificationBadge = ({ value }) => {
	if (value === "VERIFIED") {
		return (
			<span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-1 text-[11px] font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
				<ShieldCheck size={12} />
				Verified
			</span>
		);
	}
	if (value === "NOT_VERIFIED") {
		return (
			<span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-1 text-[11px] font-semibold text-rose-300 ring-1 ring-rose-500/30">
				<ShieldX size={12} />
				Not Verified
			</span>
		);
	}
	return (
		<span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-1 text-[11px] font-semibold text-amber-300 ring-1 ring-amber-500/30">
			<ShieldAlert size={12} />
			Needs Review
		</span>
	);
};

const CandidateEditor = ({ candidate, meta, onSave, isSaving, onDownloadProfile }) => {
	const [form, setForm] = useState(() => ({
		fullName: candidate.fullName || "",
		jobTitle: candidate.jobTitle || "",
		experience: candidate.experience || "",
		company: candidate.company || "",
		locality: candidate.locality || "",
		location: candidate.location || "",
		country: candidate.country || "",
		email: candidate.email || "",
		phone: candidate.phone || "",
		linkedinUrl: candidate.linkedinUrl || "",
		summary: candidate.summary || "",
	}));
	const [skills, setSkills] = useState(() => toSkillsArray(candidate.skills));
	const [skillInput, setSkillInput] = useState("");
	const [verificationStatus, setVerificationStatus] = useState(
		meta.verificationStatus || "NEEDS_REVIEW"
	);

	const addSkillsFromInput = () => {
		const incoming = toSkillsArray(skillInput);
		if (incoming.length === 0) return;
		setSkills((prev) => toSkillsArray([...prev, ...incoming].join(", ")));
		setSkillInput("");
	};

	const removeSkill = (skillToRemove) => {
		setSkills((prev) => prev.filter((item) => item !== skillToRemove));
	};

	const missingInfo = [];
	if (!String(form.phone || "").trim()) missingInfo.push("Phone");
	if (!String(form.email || "").trim()) missingInfo.push("Email");
	if (!String(form.jobTitle || "").trim()) missingInfo.push("Job Title");
	if (!String(form.company || "").trim()) missingInfo.push("Company Name");
	if (skills.length === 0) missingInfo.push("Skills");

	return (
		<div className="space-y-4">
			<div className="rounded-xl border border-slate-800 bg-slate-800/55 p-4">
				<div className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-indigo-300">
					<Users size={15} />
					Candidate Profile Overview
				</div>
				<div className="grid grid-cols-1 gap-2 text-sm text-slate-200 md:grid-cols-2">
					<div className="inline-flex items-center gap-2">
						<UserCircle2 size={14} className="text-slate-400" />
						<span>Full Name: {candidate.fullName || "NA"}</span>
					</div>
					<div className="inline-flex items-center gap-2">
						<PencilLine size={14} className="text-slate-400" />
						<span>Job Title: {candidate.jobTitle || "NA"}</span>
					</div>
					<div className="inline-flex items-center gap-2">
						<Building2 size={14} className="text-slate-400" />
						<span>Company: {candidate.company || "NA"}</span>
					</div>
					<div className="inline-flex items-center gap-2">
						<MapPin size={14} className="text-slate-400" />
						<span>
							Location:{" "}
							{[candidate.locality, candidate.location, candidate.country]
								.filter(Boolean)
								.join(", ") || "NA"}
						</span>
					</div>
					<div className="inline-flex items-center gap-2">
						<Mail size={14} className="text-slate-400" />
						<span>Email: {candidate.email || "NA"}</span>
					</div>
					<div className="inline-flex items-center gap-2">
						<Phone size={14} className="text-slate-400" />
						<span>Phone: {candidate.phone || "NA"}</span>
					</div>
					<div className="md:col-span-2 inline-flex items-center gap-2">
						<FileText size={14} className="text-slate-400" />
						<span>LinkedIn: {candidate.linkedinUrl || "NA"}</span>
					</div>
					<div className="md:col-span-2 inline-flex items-center gap-2">
						<CalendarClock size={14} className="text-slate-400" />
						<span>Last Updated: {formatDateTime(candidate.updatedAt)}</span>
					</div>
				</div>
			</div>

			<div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
				<div className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-indigo-300">
					<PencilLine size={15} />
					Editable Fields
				</div>
				<div className="grid grid-cols-1 gap-2 md:grid-cols-2">
					<input
						value={form.fullName}
						onChange={(e) => setForm((prev) => ({ ...prev, fullName: e.target.value }))}
						placeholder="Name"
						className={fieldInputClass}
					/>
					<input
						value={form.jobTitle}
						onChange={(e) => setForm((prev) => ({ ...prev, jobTitle: e.target.value }))}
						placeholder="Job Title"
						className={fieldInputClass}
					/>
					<input
						value={form.experience}
						onChange={(e) => setForm((prev) => ({ ...prev, experience: e.target.value }))}
						placeholder="Experience"
						className={fieldInputClass}
					/>
					<input
						value={form.company}
						onChange={(e) => setForm((prev) => ({ ...prev, company: e.target.value }))}
						placeholder="Company"
						className={fieldInputClass}
					/>
					<input
						value={form.locality}
						onChange={(e) => setForm((prev) => ({ ...prev, locality: e.target.value }))}
						placeholder="City"
						className={fieldInputClass}
					/>
					<input
						value={form.location}
						onChange={(e) => setForm((prev) => ({ ...prev, location: e.target.value }))}
						placeholder="State / Location"
						className={fieldInputClass}
					/>
					<input
						value={form.country}
						onChange={(e) => setForm((prev) => ({ ...prev, country: e.target.value }))}
						placeholder="Country"
						className={fieldInputClass}
					/>
					<input
						value={form.email}
						onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
						placeholder="Email"
						className={fieldInputClass}
					/>
					<input
						value={form.phone}
						onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
						placeholder="Phone"
						className={fieldInputClass}
					/>
					<input
						value={form.linkedinUrl}
						onChange={(e) => setForm((prev) => ({ ...prev, linkedinUrl: e.target.value }))}
						placeholder="LinkedIn URL"
						className={fieldInputClass}
					/>
					<textarea
						value={form.summary}
						onChange={(e) => setForm((prev) => ({ ...prev, summary: e.target.value }))}
						placeholder="Notes"
						rows={3}
						className={`md:col-span-2 ${fieldInputClass}`}
					/>
				</div>
			</div>

			<div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
				<div className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-indigo-300">
					<Tags size={15} />
					Skills (Tag Editor)
				</div>
				<div className="flex flex-wrap gap-2">
					{skills.length === 0 ? (
						<span className="text-xs text-slate-400">No skills added.</span>
					) : (
						skills.map((skill) => (
							<span
								key={skill}
								className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200">
								{skill}
								<button
									onClick={() => removeSkill(skill)}
									className="rounded p-0.5 text-slate-400 transition hover:bg-slate-700 hover:text-slate-200">
									<X size={12} />
								</button>
							</span>
						))
					)}
				</div>
				<div className="mt-2 flex gap-2">
					<input
						value={skillInput}
						onChange={(e) => setSkillInput(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								addSkillsFromInput();
							}
						}}
						placeholder="Add skill (comma separated supported)"
						className={fieldInputClass}
					/>
					<button
						onClick={addSkillsFromInput}
						className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500">
						Add
					</button>
				</div>
			</div>

			<div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
				<div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
					<div className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-indigo-300">
						<FileText size={15} />
						Resume Preview
					</div>
					<div className="space-y-1 text-xs text-slate-300">
						<div>Parse Status: {candidate.parseStatus || "NA"}</div>
						<div className="line-clamp-4">
							Summary: {candidate.summary || "No parsed summary available."}
						</div>
					</div>
					<button
						onClick={onDownloadProfile}
						className="mt-3 inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700">
						<Download size={13} />
						View Resume / Profile
					</button>
				</div>

				<div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
					<div className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-indigo-300">
						<AlertTriangle size={15} />
						Missing Information
					</div>
					{missingInfo.length === 0 ? (
						<div className="text-xs font-semibold text-emerald-300">No critical fields missing.</div>
					) : (
						<ul className="list-disc pl-4 text-xs text-slate-300">
							{missingInfo.map((item) => (
								<li key={item}>{item}</li>
							))}
						</ul>
					)}
				</div>
			</div>

			<div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
				<div className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-indigo-300">
					<ShieldCheck size={15} />
					Verification Status
				</div>
				<div className="flex flex-wrap gap-2">
					{VERIFICATION_OPTIONS.map((option) => (
						<button
							key={option.value}
							onClick={() => setVerificationStatus(option.value)}
							className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
								verificationStatus === option.value
									? "border-indigo-400 bg-indigo-500/20 text-indigo-200"
									: "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
							}`}>
							{option.label}
						</button>
					))}
				</div>
			</div>

			<button
				onClick={() =>
					onSave({
						updates: {
							fullName: form.fullName,
							jobTitle: form.jobTitle,
							experience: form.experience,
							company: form.company,
							locality: form.locality,
							location: form.location,
							country: form.country,
							email: form.email,
							phone: form.phone,
							linkedinUrl: form.linkedinUrl,
							skills: skills.join(", "),
							summary: form.summary,
						},
						verificationStatus,
					})
				}
				disabled={isSaving}
				className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50">
				{isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
				Save Changes
			</button>
		</div>
	);
};

const Enrich = () => {
	const queryClient = useQueryClient();
	const [page, setPage] = useState(1);
	const [searchTerm, setSearchTerm] = useState("");
	const [needsOnly, setNeedsOnly] = useState(true);
	const [activeCandidateId, setActiveCandidateId] = useState("");
	const [isDownloading, setIsDownloading] = useState(false);

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

	const activityQuery = useQuery({
		queryKey: ["enrichmentActivity", resolvedActiveCandidateId],
		queryFn: async () => {
			const { data } = await api.get(
				`/candidates/enrich/${resolvedActiveCandidateId}/activity?limit=15&page=1`
			);
			return data;
		},
		enabled: !!resolvedActiveCandidateId,
	});

	const saveMutation = useMutation({
		mutationFn: async (payload) => {
			const { data } = await api.put(
				`/candidates/enrich/${resolvedActiveCandidateId}/manual`,
				payload
			);
			return data;
		},
		onSuccess: (data) => {
			toast.success(data?.message || "Candidate updated");
			queryClient.invalidateQueries({ queryKey: ["enrichmentQueue"] });
			queryClient.invalidateQueries({ queryKey: ["enrichmentDetail"] });
			queryClient.invalidateQueries({ queryKey: ["enrichmentActivity"] });
		},
		onError: (err) => {
			toast.error(err?.response?.data?.message || "Failed to save changes");
		},
	});

	const activeCandidate = detailQuery.data?.candidate || null;
	const activeMeta = detailQuery.data?.meta || {};

	const onDownloadProfile = async () => {
		if (!resolvedActiveCandidateId || isDownloading) return;
		try {
			setIsDownloading(true);
			const response = await api.get(`/candidates/${resolvedActiveCandidateId}/download`, {
				responseType: "blob",
			});
			const contentDisposition = response.headers["content-disposition"] || "";
			const nameMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
			const filename = nameMatch?.[1] || `candidate-${resolvedActiveCandidateId}.docx`;
			const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
			const link = document.createElement("a");
			link.href = blobUrl;
			link.setAttribute("download", filename);
			document.body.appendChild(link);
			link.click();
			link.remove();
			window.URL.revokeObjectURL(blobUrl);
		} catch (err) {
			toast.error(err?.response?.data?.message || "Failed to download profile");
		} finally {
			setIsDownloading(false);
		}
	};

	return (
		<div className="h-[calc(100vh-64px)] overflow-auto bg-slate-950 px-3 py-4 text-slate-100 md:px-6 md:py-6">
			<div className="mx-auto max-w-[1500px] space-y-4">
				<div className={sectionCardClass}>
					<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
						<div>
							<h1 className="inline-flex items-center gap-2 text-2xl font-bold text-white">
								<ClipboardList size={22} className="text-indigo-400" />
								Enrich (Manual - DB Only)
							</h1>
							<p className="mt-1 text-sm text-slate-300">
								Update candidate data directly from your internal database.
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
									className={`${fieldInputClass} py-2 pl-9`}
								/>
							</div>
							<button
								onClick={() => {
									setPage(1);
									setNeedsOnly((prev) => !prev);
								}}
								className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition ${
									needsOnly
										? "border-indigo-400 bg-indigo-500/20 text-indigo-200"
										: "border-slate-700 bg-slate-800 text-slate-300"
								}`}>
								<Filter size={14} />
								Only Incomplete
							</button>
							<button
								onClick={() => {
									queryClient.invalidateQueries({ queryKey: ["enrichmentQueue"] });
									queryClient.invalidateQueries({ queryKey: ["enrichmentDetail"] });
									queryClient.invalidateQueries({ queryKey: ["enrichmentActivity"] });
								}}
								className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-700">
								<RefreshCw size={14} />
								Refresh
							</button>
						</div>
					</div>
					<div className="mt-3 text-xs text-slate-300">
						Queue Count: <span className="font-semibold text-indigo-300">{totalCount.toLocaleString()}</span>
					</div>
				</div>

				<div className="grid grid-cols-1 gap-4 xl:grid-cols-[34%_66%]">
					<div className={sectionCardClass}>
						<div className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-indigo-300">
							<Users size={15} />
							Candidates
						</div>
						<div className="max-h-[760px] overflow-auto rounded-xl border border-slate-800">
							<table className="w-full text-left text-sm">
								<thead className="sticky top-0 bg-slate-900 text-xs uppercase tracking-wide text-slate-400">
									<tr>
										<th className="px-3 py-3">Candidate</th>
										<th className="px-3 py-3">Missing</th>
									</tr>
								</thead>
								<tbody className="bg-slate-900/70">
									{queueQuery.isLoading ? (
										<tr>
											<td colSpan={2} className="px-3 py-10 text-center text-slate-400">
												<Loader2 size={18} className="mx-auto mb-2 animate-spin" />
												Loading...
											</td>
										</tr>
									) : queueItems.length === 0 ? (
										<tr>
											<td colSpan={2} className="px-3 py-10 text-center text-slate-400">
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
													onClick={() => setActiveCandidateId(id)}
													className={`cursor-pointer border-t border-slate-800 transition ${
														isActive
															? "bg-indigo-500/10 ring-1 ring-indigo-500/40"
															: "hover:bg-slate-800/70"
													}`}>
													<td className="px-3 py-3 align-top">
														<div className="inline-flex items-center gap-1 font-semibold text-slate-100">
															<UserCircle2 size={14} className="text-slate-400" />
															{item.fullName}
														</div>
														<div className="text-xs text-slate-400">
															{item.jobTitle || "NA"}
															{item.company ? ` | ${item.company}` : ""}
														</div>
														<div className="mt-1">
															<VerificationBadge
																value={item.verificationStatus || "NEEDS_REVIEW"}
															/>
														</div>
													</td>
													<td className="px-3 py-3 align-top text-xs text-slate-300">
														{(item.missingFields || []).slice(0, 2).join(", ") || "None"}
														{(item.missingFields || []).length > 2
															? ` +${item.missingFields.length - 2}`
															: ""}
														<div className="mt-1 text-[11px] text-slate-500">
															Updated: {formatDateTime(item.updatedAt)}
														</div>
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
								className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 disabled:opacity-40">
								Previous
							</button>
							<div className="text-xs font-semibold text-slate-400">Page {page}</div>
							<button
								onClick={() => setPage((prev) => prev + 1)}
								disabled={!hasMore}
								className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 disabled:opacity-40">
								Next
							</button>
						</div>
					</div>

					<div className="space-y-4">
						<div className={sectionCardClass}>
							{detailQuery.isLoading ? (
								<div className="py-12 text-center text-slate-400">
									<Loader2 size={18} className="mx-auto mb-2 animate-spin" />
									Loading candidate...
								</div>
							) : !activeCandidate ? (
								<div className="py-12 text-center text-slate-400">
									Select a candidate from queue.
								</div>
							) : (
								<CandidateEditor
									key={resolvedActiveCandidateId}
									candidate={activeCandidate}
									meta={activeMeta}
									onDownloadProfile={onDownloadProfile}
									isSaving={saveMutation.isPending || isDownloading}
									onSave={(payload) => saveMutation.mutate(payload)}
								/>
							)}
						</div>

						<div className={sectionCardClass}>
							<div className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-indigo-300">
								<History size={15} />
								Activity Log
							</div>
							{activityQuery.isLoading ? (
								<div className="text-sm text-slate-400">Loading activity...</div>
							) : (activityQuery.data?.items || []).length === 0 ? (
								<div className="text-sm text-slate-400">No activity yet for this candidate.</div>
							) : (
								<div className="space-y-2">
									{(activityQuery.data?.items || []).map((log) => (
										<div
											key={String(log._id)}
											className="rounded-xl border border-slate-800 bg-slate-800/60 p-3 text-xs">
											<div className="flex flex-wrap items-center justify-between gap-2">
												<div className="font-semibold text-slate-100">{log.action}</div>
												<div className="text-slate-500">{formatDateTime(log.createdAt)}</div>
											</div>
											<div className="mt-1 text-slate-400">
												By: {log?.performedBy?.name || log?.performedBy?.email || "Unknown"}
											</div>
											<div className="mt-1 space-y-1 text-slate-300">
												{(log.changes || []).length === 0 ? (
													<div>No field-level changes</div>
												) : (
													(log.changes || []).map((change, idx) => (
														<div key={`${log._id}-${idx}`}>
															{change.field}: "{change.oldValue || ""}" -&gt; "
															{change.newValue || ""}"
														</div>
													))
												)}
											</div>
										</div>
									))}
								</div>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};

export default Enrich;

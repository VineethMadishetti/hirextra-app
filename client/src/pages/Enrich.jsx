import { useContext, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Briefcase,
	Building2,
	CalendarClock,
	CheckCircle2,
	CircleSlash2,
	ClipboardList,
	Download,
	FileText,
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
	Tag,
	Trash2,
	Upload,
	User2,
	Users,
	X,
} from "lucide-react";
import toast from "react-hot-toast";
import api from "../api/axios";
import { AuthContext } from "../context/AuthContext";

const PAGE_SIZE = 20;
const card = "rounded-2xl border border-slate-800 bg-slate-900/85 p-4";
const input =
	"w-full rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-2 text-sm text-slate-100 placeholder-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-60";

const VERIFY_OPTIONS = [
	{ value: "NEEDS_REVIEW", label: "Needs Review" },
	{ value: "VERIFIED", label: "Verified" },
	{ value: "NOT_VERIFIED", label: "Not Verified" },
];
const AVAILABILITY_OPTIONS = [
	{ value: "IMMEDIATE", label: "Immediate" },
	{ value: "15_DAYS", label: "15 Days" },
	{ value: "30_DAYS", label: "30 Days" },
	{ value: "UNKNOWN", label: "Unknown" },
];
const STATUS_OPTIONS = [
	{ value: "ACTIVE", label: "Active" },
	{ value: "PASSIVE", label: "Passive" },
	{ value: "NOT_AVAILABLE", label: "Not Available" },
];

const fmt = (v) => {
	if (!v) return "NA";
	const d = new Date(v);
	return Number.isNaN(d.getTime()) ? "NA" : d.toLocaleString();
};
const splitName = (fullName) => {
	const p = String(fullName || "").trim().split(/\s+/).filter(Boolean);
	return { first: p[0] || "", last: p.slice(1).join(" ") };
};
const joinName = (first, last) => `${String(first || "").trim()} ${String(last || "").trim()}`.trim();
const tagsFrom = (v) => {
	const seen = new Set();
	return String(v || "")
		.split(/[;,]/g)
		.map((x) => x.trim())
		.filter(Boolean)
		.filter((x) => {
			const k = x.toLowerCase();
			if (seen.has(k)) return false;
			seen.add(k);
			return true;
		});
};

const VerificationBadge = ({ value }) => {
	if (value === "VERIFIED") {
		return (
			<span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-1 text-[11px] font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
				<ShieldCheck size={12} /> Verified
			</span>
		);
	}
	if (value === "NOT_VERIFIED") {
		return (
			<span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-1 text-[11px] font-semibold text-rose-300 ring-1 ring-rose-500/30">
				<ShieldX size={12} /> Not Verified
			</span>
		);
	}
	return (
		<span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-1 text-[11px] font-semibold text-amber-300 ring-1 ring-amber-500/30">
			<ShieldAlert size={12} /> Needs Review
		</span>
	);
};

const EnrichEditor = ({
	candidate,
	meta,
	activity,
	activityLoading,
	onSave,
	saving,
	onDelete,
	deleting,
	canDelete,
	onViewResume,
	onReparse,
	onUploadResume,
}) => {
	const name = splitName(candidate.fullName);
	const [editing, setEditing] = useState(false);
	const [first, setFirst] = useState(name.first);
	const [last, setLast] = useState(name.last);
	const [email, setEmail] = useState(candidate.email || "");
	const [phone, setPhone] = useState(candidate.phone || "");
	const [location, setLocation] = useState(candidate.location || "");
	const [linkedinUrl, setLinkedinUrl] = useState(candidate.linkedinUrl || "");
	const [jobTitle, setJobTitle] = useState(candidate.jobTitle || "");
	const [company, setCompany] = useState(candidate.company || "");
	const [experience, setExperience] = useState(candidate.experience || "");
	const [availability, setAvailability] = useState(candidate.availability || "UNKNOWN");
	const [candidateStatus, setCandidateStatus] = useState(candidate.candidateStatus || "ACTIVE");
	const [skills, setSkills] = useState(tagsFrom(candidate.skills));
	const [tags, setTags] = useState(tagsFrom(candidate.internalTags));
	const [notes, setNotes] = useState(candidate.recruiterNotes || "");
	const [skillInput, setSkillInput] = useState("");
	const [tagInput, setTagInput] = useState("");
	const [verificationStatus, setVerificationStatus] = useState(meta.verificationStatus || "NEEDS_REVIEW");

	const reset = () => {
		const n = splitName(candidate.fullName);
		setFirst(n.first);
		setLast(n.last);
		setEmail(candidate.email || "");
		setPhone(candidate.phone || "");
		setLocation(candidate.location || "");
		setLinkedinUrl(candidate.linkedinUrl || "");
		setJobTitle(candidate.jobTitle || "");
		setCompany(candidate.company || "");
		setExperience(candidate.experience || "");
		setAvailability(candidate.availability || "UNKNOWN");
		setCandidateStatus(candidate.candidateStatus || "ACTIVE");
		setSkills(tagsFrom(candidate.skills));
		setTags(tagsFrom(candidate.internalTags));
		setNotes(candidate.recruiterNotes || "");
		setSkillInput("");
		setTagInput("");
		setVerificationStatus(meta.verificationStatus || "NEEDS_REVIEW");
		setEditing(false);
	};

	const addTag = (setter, source, value, clear) => {
		const incoming = tagsFrom(value);
		if (incoming.length === 0) return;
		setter(tagsFrom([...source, ...incoming].join(", ")));
		clear("");
	};

	const save = async () => {
		const fullName = joinName(first, last);
		if (!fullName) return toast.error("Candidate name is required");
		await onSave({
			updates: {
				fullName,
				email,
				phone,
				location,
				linkedinUrl,
				jobTitle,
				company,
				experience,
				availability,
				candidateStatus,
				skills: skills.join(", "),
				internalTags: tags.join(", "),
				recruiterNotes: notes,
			},
			verificationStatus,
		});
		setEditing(false);
	};

	const timeline = Array.isArray(candidate.experienceTimeline) ? candidate.experienceTimeline : [];
	const missing = Array.isArray(meta.missingFields) ? meta.missingFields : [];
	const completeness = Number(meta.completenessScore || 0);

	return (
		<div className="space-y-4">
			<div className={card}>
				<div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
					<div>
						<div className="flex flex-wrap items-center gap-2">
							<h2 className="inline-flex items-center gap-2 text-xl font-bold text-white">
								<User2 size={18} className="text-indigo-300" />
								{joinName(first, last) || "Unnamed Candidate"}
							</h2>
							<span className="rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-300 ring-1 ring-slate-700">
								{jobTitle || "No Job Title"}
							</span>
							<VerificationBadge value={verificationStatus} />
						</div>
						<div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300">
							<span className="inline-flex items-center gap-1"><FileText size={12} />{linkedinUrl || "No LinkedIn"}</span>
							<span className="inline-flex items-center gap-1"><Mail size={12} />{email || "No Email"}</span>
							<span className="inline-flex items-center gap-1"><Phone size={12} />{phone || "No Phone"}</span>
							<span className="inline-flex items-center gap-1"><MapPin size={12} />{location || "No Location"}</span>
						</div>
					</div>
					<div className="flex gap-2">
						{!editing ? (
							<button onClick={() => setEditing(true)} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"><PencilLine size={13} />Edit</button>
						) : (
							<>
								<button onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">{saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}Save Changes</button>
								<button onClick={reset} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"><CircleSlash2 size={13} />Cancel</button>
							</>
						)}
					</div>
				</div>
			</div>

			<div className={card}>
				<div className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-indigo-300"><ClipboardList size={15} />Data Completeness Summary</div>
				<div className="text-sm text-slate-200">Profile Completeness: <span className="font-semibold">{completeness}%</span></div>
				<div className="mt-2 h-2 rounded-full bg-slate-800"><div className="h-2 rounded-full bg-emerald-500" style={{ width: `${Math.max(0, Math.min(100, completeness))}%` }} /></div>
				<div className="mt-3 text-xs text-slate-300">
					<div className="mb-1 font-semibold">Missing:</div>
					{missing.length === 0 ? <div className="text-emerald-300">No critical fields missing.</div> : <ul className="list-disc pl-4">{missing.map((m) => <li key={m}>{m}</li>)}</ul>}
				</div>
			</div>

			<div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
				<div className={card}>
					<div className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-indigo-300"><User2 size={15} />Personal Details</div>
					<div className="space-y-2">
						<input value={first} onChange={(e) => setFirst(e.target.value)} disabled={!editing} placeholder="First Name" className={input} />
						<input value={last} onChange={(e) => setLast(e.target.value)} disabled={!editing} placeholder="Last Name" className={input} />
						<input value={email} onChange={(e) => setEmail(e.target.value)} disabled={!editing} placeholder="Email" className={input} />
						<input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!editing} placeholder="Phone" className={input} />
						<input value={location} onChange={(e) => setLocation(e.target.value)} disabled={!editing} placeholder="Location" className={input} />
						<input value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} disabled={!editing} placeholder="LinkedIn URL" className={input} />
					</div>
				</div>
				<div className={card}>
					<div className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-indigo-300"><Briefcase size={15} />Professional Details</div>
					<div className="space-y-2">
						<input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} disabled={!editing} placeholder="Current Job Title" className={input} />
						<input value={company} onChange={(e) => setCompany(e.target.value)} disabled={!editing} placeholder="Current Company" className={input} />
						<input value={experience} onChange={(e) => setExperience(e.target.value)} disabled={!editing} placeholder="Experience (Years)" className={input} />
						<select value={availability} onChange={(e) => setAvailability(e.target.value)} disabled={!editing} className={input}>{AVAILABILITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
						<select value={candidateStatus} onChange={(e) => setCandidateStatus(e.target.value)} disabled={!editing} className={input}>{STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
						<div className="rounded-xl border border-slate-700 bg-slate-800/70 p-2">
							<div className="mb-1 text-xs font-semibold text-slate-300">Verification</div>
							<div className="flex flex-wrap gap-2">
								{VERIFY_OPTIONS.map((o) => (
									<button key={o.value} onClick={() => editing && setVerificationStatus(o.value)} disabled={!editing} className={`rounded-lg border px-2 py-1 text-[11px] font-semibold ${verificationStatus === o.value ? "border-indigo-400 bg-indigo-500/25 text-indigo-200" : "border-slate-700 bg-slate-800 text-slate-300"} disabled:opacity-60`}>{o.label}</button>
								))}
							</div>
						</div>
					</div>
				</div>
			</div>

			<div className={card}>
				<div className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-indigo-300"><Tag size={15} />Skills</div>
				<div className="flex flex-wrap gap-2">{skills.length === 0 ? <span className="text-xs text-slate-400">No skills</span> : skills.map((s) => <span key={s} className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200">{s}{editing && <button onClick={() => setSkills((p) => p.filter((x) => x !== s))}><X size={12} /></button>}</span>)}</div>
				<div className="mt-2 flex gap-2">
					<input value={skillInput} onChange={(e) => setSkillInput(e.target.value)} disabled={!editing} placeholder="Add skill" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(setSkills, skills, skillInput, setSkillInput); } }} className={input} />
					<button onClick={() => addTag(setSkills, skills, skillInput, setSkillInput)} disabled={!editing} className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Add</button>
				</div>
			</div>

			<div className={card}>
				<div className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-indigo-300"><Building2 size={15} />Experience Timeline</div>
				{timeline.length === 0 ? <div className="text-sm text-slate-400">No parsed experience timeline available.</div> : <div className="space-y-3">{timeline.map((t, i) => <div key={`${t.company || "exp"}-${i}`} className="rounded-xl border border-slate-800 bg-slate-800/60 p-3"><div className="text-sm font-semibold text-slate-100">{i + 1}. {t.company || "Company"}</div><div className="text-xs text-slate-300">Role: {t.role || "NA"}</div><div className="text-xs text-slate-400">{t.period || "Period NA"}</div>{Array.isArray(t.highlights) && t.highlights.length > 0 && <ul className="mt-2 list-disc pl-4 text-xs text-slate-300">{t.highlights.map((h, idx) => <li key={`${i}-${idx}`}>{h}</li>)}</ul>}</div>)}</div>}
			</div>

			<div className={card}>
				<div className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-indigo-300"><FileText size={15} />Resume</div>
				{candidate.hasResume ? (
					<div className="flex flex-wrap gap-2">
						<button onClick={onViewResume} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"><Download size={13} />View Resume PDF</button>
						<button onClick={onReparse} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"><RefreshCw size={13} />Re-Parse Resume</button>
					</div>
				) : (
					<div className="space-y-2">
						<div className="text-sm text-slate-400">No resume uploaded.</div>
						<div className="flex flex-wrap gap-2">
							<button onClick={onUploadResume} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"><Upload size={13} />Upload Resume</button>
							<button onClick={onReparse} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"><RefreshCw size={13} />Parse Resume</button>
						</div>
					</div>
				)}
			</div>

			<div className={card}>
				<div className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-indigo-300"><Tag size={15} />Internal Tags</div>
				<div className="flex flex-wrap gap-2">{tags.length === 0 ? <span className="text-xs text-slate-400">No internal tags</span> : tags.map((t) => <span key={t} className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200">{t}{editing && <button onClick={() => setTags((p) => p.filter((x) => x !== t))}><X size={12} /></button>}</span>)}</div>
				<div className="mt-2 flex gap-2">
					<input value={tagInput} onChange={(e) => setTagInput(e.target.value)} disabled={!editing} placeholder="Add tag" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(setTags, tags, tagInput, setTagInput); } }} className={input} />
					<button onClick={() => addTag(setTags, tags, tagInput, setTagInput)} disabled={!editing} className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Add</button>
				</div>
				<div className="mt-4 mb-2 inline-flex items-center gap-2 text-sm font-semibold text-indigo-300"><ClipboardList size={15} />Recruiter Notes</div>
				<textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!editing} rows={4} placeholder="Add recruiter notes..." className={input} />
			</div>

			<div className={card}>
				<div className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-indigo-300"><CalendarClock size={15} />Activity Log</div>
				{activityLoading ? <div className="text-sm text-slate-400">Loading activity...</div> : activity.length === 0 ? <div className="text-sm text-slate-400">No activity yet.</div> : <div className="space-y-2">{activity.map((log) => <div key={String(log._id)} className="rounded-xl border border-slate-800 bg-slate-800/60 p-3 text-xs"><div className="flex flex-wrap items-center justify-between gap-2"><div className="font-semibold text-slate-100">{log.action}</div><div className="text-slate-500">{fmt(log.createdAt)}</div></div><div className="mt-1 text-slate-400">By: {log?.performedBy?.name || log?.performedBy?.email || "Unknown"}</div><div className="mt-1 space-y-1 text-slate-300">{(log.changes || []).length === 0 ? <div>Updated record</div> : (log.changes || []).map((c, idx) => <div key={`${log._id}-${idx}`} className="inline-flex items-center gap-1"><CheckCircle2 size={12} className="text-emerald-400" /><span>{c.field}: \"{c.oldValue || ""}\" -&gt; \"{c.newValue || ""}\"</span></div>)}</div></div>)}</div>}
			</div>

			<div className={card}>
				<div className="flex flex-wrap items-center gap-2">
					<button onClick={save} disabled={!editing || saving} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}Save Changes</button>
					<button onClick={reset} disabled={!editing} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50"><CircleSlash2 size={14} />Cancel</button>
					{canDelete && <button onClick={onDelete} disabled={deleting} className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-50">{deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}Delete Candidate</button>}
				</div>
			</div>
		</div>
	);
};

const Enrich = () => {
	const { user } = useContext(AuthContext);
	const queryClient = useQueryClient();
	const [page, setPage] = useState(1);
	const [searchTerm, setSearchTerm] = useState("");
	const [needsOnly, setNeedsOnly] = useState(true);
	const [activeCandidateId, setActiveCandidateId] = useState("");
	const [isDownloading, setIsDownloading] = useState(false);
	const isAdmin = user?.role === "ADMIN";

	const queueQuery = useQuery({
		queryKey: ["enrichmentQueue", page, searchTerm, needsOnly],
		queryFn: async () => {
			const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), needsOnly: String(needsOnly) });
			if (searchTerm.trim()) params.set("q", searchTerm.trim());
			const { data } = await api.get(`/candidates/enrich/queue?${params.toString()}`);
			return data;
		},
	});

	const queueItems = queueQuery.data?.items || [];
	const totalCount = Number(queueQuery.data?.totalCount || 0);
	const hasMore = !!queueQuery.data?.hasMore;
	const resolvedId = queueItems.some((i) => String(i._id) === String(activeCandidateId))
		? String(activeCandidateId)
		: queueItems[0]
			? String(queueItems[0]._id)
			: "";

	const detailQuery = useQuery({
		queryKey: ["enrichmentDetail", resolvedId],
		queryFn: async () => (await api.get(`/candidates/enrich/${resolvedId}`)).data,
		enabled: !!resolvedId,
	});
	const activityQuery = useQuery({
		queryKey: ["enrichmentActivity", resolvedId],
		queryFn: async () => (await api.get(`/candidates/enrich/${resolvedId}/activity?limit=15&page=1`)).data,
		enabled: !!resolvedId,
	});

	const saveMutation = useMutation({
		mutationFn: async (payload) => (await api.put(`/candidates/enrich/${resolvedId}/manual`, payload)).data,
		onSuccess: (d) => {
			toast.success(d?.message || "Candidate updated");
			queryClient.invalidateQueries({ queryKey: ["enrichmentQueue"] });
			queryClient.invalidateQueries({ queryKey: ["enrichmentDetail"] });
			queryClient.invalidateQueries({ queryKey: ["enrichmentActivity"] });
		},
		onError: (e) => toast.error(e?.response?.data?.message || "Failed to save changes"),
	});
	const deleteMutation = useMutation({
		mutationFn: async () => (await api.delete(`/candidates/${resolvedId}`)).data,
		onSuccess: (d) => {
			toast.success(d?.message || "Candidate deleted");
			setActiveCandidateId("");
			queryClient.invalidateQueries({ queryKey: ["enrichmentQueue"] });
			queryClient.invalidateQueries({ queryKey: ["enrichmentDetail"] });
			queryClient.invalidateQueries({ queryKey: ["enrichmentActivity"] });
		},
		onError: (e) => toast.error(e?.response?.data?.message || "Failed to delete candidate"),
	});

	const onViewResume = async () => {
		if (!resolvedId || isDownloading) return;
		try {
			setIsDownloading(true);
			const response = await api.get(`/candidates/${resolvedId}/download`, { responseType: "blob" });
			const cd = response.headers["content-disposition"] || "";
			const m = cd.match(/filename="?([^"]+)"?/i);
			const filename = m?.[1] || `candidate-${resolvedId}.docx`;
			const url = window.URL.createObjectURL(new Blob([response.data]));
			const a = document.createElement("a");
			a.href = url;
			a.setAttribute("download", filename);
			document.body.appendChild(a);
			a.click();
			a.remove();
			window.URL.revokeObjectURL(url);
		} catch (e) {
			toast.error(e?.response?.data?.message || "Failed to download profile");
		} finally {
			setIsDownloading(false);
		}
	};

	return (
		<div className="h-[calc(100vh-64px)] overflow-auto bg-slate-950 px-3 py-4 text-slate-100 md:px-6 md:py-6">
			<div className="mx-auto max-w-[1500px] space-y-4">
				<div className={card}>
					<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
						<div>
							<h1 className="inline-flex items-center gap-2 text-2xl font-bold text-white"><ClipboardList size={22} className="text-indigo-300" />Enrich</h1>
							<p className="mt-1 text-sm text-slate-300">Manual recruiter curation for staffing-ready profiles.</p>
						</div>
						<div className="flex flex-col gap-2 md:flex-row md:items-center">
							<div className="relative min-w-[250px]">
								<Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
								<input value={searchTerm} onChange={(e) => { setPage(1); setSearchTerm(e.target.value); }} placeholder="Search candidates" className={`${input} py-2 pl-9`} />
							</div>
							<button onClick={() => { setPage(1); setNeedsOnly((p) => !p); }} className={`rounded-xl border px-3 py-2 text-sm font-semibold ${needsOnly ? "border-indigo-400 bg-indigo-500/25 text-indigo-200" : "border-slate-700 bg-slate-800 text-slate-300"}`}>Only Incomplete</button>
							<button onClick={() => { queryClient.invalidateQueries({ queryKey: ["enrichmentQueue"] }); queryClient.invalidateQueries({ queryKey: ["enrichmentDetail"] }); queryClient.invalidateQueries({ queryKey: ["enrichmentActivity"] }); }} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700"><RefreshCw size={14} />Refresh</button>
						</div>
					</div>
					<div className="mt-2 text-xs text-slate-400">Queue Count: <span className="font-semibold text-indigo-300">{totalCount.toLocaleString()}</span></div>
				</div>

				<div className="grid grid-cols-1 gap-4 xl:grid-cols-[30%_70%]">
					<div className={card}>
						<div className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-indigo-300"><Users size={15} />Candidates</div>
						<div className="max-h-[840px] overflow-auto rounded-xl border border-slate-800">
							<table className="w-full text-left text-sm">
								<thead className="sticky top-0 bg-slate-900 text-xs uppercase tracking-wide text-slate-400"><tr><th className="px-3 py-3">Profile</th><th className="px-3 py-3">Completeness</th></tr></thead>
								<tbody className="bg-slate-900/70">
									{queueQuery.isLoading ? <tr><td colSpan={2} className="px-3 py-10 text-center text-slate-400"><Loader2 size={18} className="mx-auto mb-2 animate-spin" />Loading...</td></tr> : queueItems.length === 0 ? <tr><td colSpan={2} className="px-3 py-10 text-center text-slate-400">No candidates found.</td></tr> : queueItems.map((item) => { const id = String(item._id); const active = id === String(resolvedId); return <tr key={id} onClick={() => setActiveCandidateId(id)} className={`cursor-pointer border-t border-slate-800 ${active ? "bg-indigo-500/10 ring-1 ring-indigo-500/40" : "hover:bg-slate-800/70"}`}><td className="px-3 py-3 align-top"><div className="font-semibold text-slate-100">{item.fullName}</div><div className="text-xs text-slate-400">{item.jobTitle || "NA"}{item.company ? ` | ${item.company}` : ""}</div><div className="mt-1"><VerificationBadge value={item.verificationStatus || "NEEDS_REVIEW"} /></div></td><td className="px-3 py-3 align-top text-xs text-slate-300"><div>{Number(item.completenessScore || 0)}%</div><div className="mt-1 text-slate-500">Updated: {fmt(item.updatedAt)}</div></td></tr>; })}
								</tbody>
							</table>
						</div>
						<div className="mt-3 flex items-center justify-between">
							<button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 disabled:opacity-40">Previous</button>
							<div className="text-xs font-semibold text-slate-400">Page {page}</div>
							<button onClick={() => setPage((p) => p + 1)} disabled={!hasMore} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 disabled:opacity-40">Next</button>
						</div>
					</div>

					<div className={card}>
						{detailQuery.isLoading ? <div className="py-16 text-center text-slate-400"><Loader2 size={18} className="mx-auto mb-2 animate-spin" />Loading candidate details...</div> : !detailQuery.data?.candidate ? <div className="py-16 text-center text-slate-400">Select a candidate from queue.</div> : <EnrichEditor key={resolvedId} candidate={detailQuery.data.candidate} meta={detailQuery.data.meta || {}} activity={Array.isArray(activityQuery.data?.items) ? activityQuery.data.items : []} activityLoading={activityQuery.isLoading} onSave={async (payload) => saveMutation.mutateAsync(payload)} saving={saveMutation.isPending || isDownloading} onDelete={() => { if (!isAdmin) return; if (window.confirm("Delete this candidate from active records?")) deleteMutation.mutate(); }} deleting={deleteMutation.isPending} canDelete={isAdmin} onViewResume={onViewResume} onReparse={() => toast("Resume re-parse is managed in Admin import pipeline today.")} onUploadResume={() => toast("Resume upload is available in Admin panel import flow.")} />}
					</div>
				</div>
			</div>
		</div>
	);
};

export default Enrich;

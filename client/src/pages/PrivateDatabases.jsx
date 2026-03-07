import { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/axios';
import toast from 'react-hot-toast';
import {
  Database,
  Plus,
  Trash2,
  Upload,
  Search,
  X,
  FileText,
  Loader2,
  Users,
  ArrowLeft,
  CheckCircle,
  AlertCircle,
  CloudUpload,
  ChevronRight,
  Calendar,
  Sparkles,
  Eye,
  Download,
} from 'lucide-react';

// ─── API helpers ─────────────────────────────────────────────────────────────
const fetchDatabases = () => api.get('/private-db').then((r) => r.data);
const createDb = (name) => api.post('/private-db', { name }).then((r) => r.data);
const deleteDb = (id) => api.delete(`/private-db/${id}`).then((r) => r.data);
const uploadResume = (dbId, file) => {
  const fd = new FormData();
  fd.append('resume', file);
  return api.post(`/private-db/${dbId}/upload`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then((r) => r.data);
};
const searchDb = (dbId, q, page) =>
  api.get(`/private-db/${dbId}/search`, { params: { q, page, limit: 50 } }).then((r) => r.data);

// ─── DropZone ────────────────────────────────────────────────────────────────
function DropZone({ dbId, onSuccess }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'doc', 'docx', 'txt'].includes(ext)) {
      toast.error('Only PDF, DOC, DOCX, TXT files are supported');
      return;
    }
    setUploading(true);
    setResult(null);
    try {
      const data = await uploadResume(dbId, file);
      setResult({ ok: true, candidate: data.candidate });
      onSuccess?.();
      toast.success(`Added: ${data.candidate?.fullName || file.name}`);
    } catch (err) {
      const msg = err.response?.data?.message || 'Upload failed';
      setResult({ ok: false, message: msg });
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  }, [dbId, onSuccess]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  }, [handleFile]);

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !uploading && inputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center gap-3 py-10 px-6 rounded-2xl border-2 border-dashed cursor-pointer transition-all duration-200 overflow-hidden
          ${dragging
            ? 'border-indigo-400 bg-indigo-50/80 dark:bg-indigo-500/10 scale-[1.01]'
            : 'border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-600/70 bg-slate-50/50 dark:bg-slate-800/30'}
          ${uploading ? 'pointer-events-none' : ''}`}
      >
        {/* subtle bg pattern */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(99,102,241,0.04),transparent_70%)] pointer-events-none" />
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.doc,.docx,.txt"
          className="hidden"
          onChange={(e) => handleFile(e.target.files[0])}
        />
        {uploading ? (
          <>
            <div className="w-14 h-14 rounded-2xl bg-indigo-100 dark:bg-indigo-500/15 flex items-center justify-center">
              <Loader2 size={24} className="text-indigo-500 animate-spin" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Parsing resume…</p>
              <p className="text-xs text-slate-400 mt-0.5">Extracting candidate details</p>
            </div>
          </>
        ) : (
          <>
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-colors ${dragging ? 'bg-indigo-100 dark:bg-indigo-500/20' : 'bg-slate-100 dark:bg-slate-700/60'}`}>
              <CloudUpload size={24} className={dragging ? 'text-indigo-500' : 'text-slate-400'} />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                Drop resume here or{' '}
                <span className="text-indigo-600 dark:text-indigo-400">browse files</span>
              </p>
              <p className="text-xs text-slate-400 mt-1">PDF · DOC · DOCX · TXT &nbsp;·&nbsp; Max 20 MB</p>
            </div>
          </>
        )}
      </div>

      {result && (
        <div className={`flex items-start gap-3 p-4 rounded-xl border text-sm ${
          result.ok
            ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20 text-emerald-800 dark:text-emerald-300'
            : 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20 text-red-800 dark:text-red-300'
        }`}>
          {result.ok
            ? <CheckCircle size={16} className="shrink-0 mt-0.5 text-emerald-500" />
            : <AlertCircle size={16} className="shrink-0 mt-0.5 text-red-500" />}
          <div>
            {result.ok ? (
              <>
                <p className="font-semibold">Successfully parsed &amp; added</p>
                {result.candidate?.fullName && (
                  <p className="text-xs opacity-80 mt-0.5">
                    {result.candidate.fullName}
                    {result.candidate.jobTitle && <> · {result.candidate.jobTitle}</>}
                  </p>
                )}
              </>
            ) : (
              <p className="font-semibold">{result.message}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── DatabaseView ─────────────────────────────────────────────────────────────
function CandidateViewModal({ candidate, onClose }) {
  if (!candidate) return null;
  const fields = [
    { label: 'Full Name', value: candidate.fullName },
    { label: 'Job Title', value: candidate.jobTitle },
    { label: 'Company', value: candidate.company },
    { label: 'Location', value: candidate.location },
    { label: 'Experience', value: candidate.experience },
    { label: 'Skills', value: candidate.skills },
    { label: 'Education', value: candidate.education },
    { label: 'Email', value: candidate.email },
    { label: 'Phone', value: candidate.phone },
    { label: 'LinkedIn', value: candidate.linkedinUrl },
    { label: 'Parse Status', value: candidate.parseStatus },
  ].filter((f) => f.value);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-100 to-purple-100 dark:from-indigo-500/15 dark:to-purple-500/15 flex items-center justify-center">
              <span className="text-base font-bold text-indigo-600 dark:text-indigo-400">
                {(candidate.fullName || '?').charAt(0).toUpperCase()}
              </span>
            </div>
            <div>
              <p className="font-bold text-slate-900 dark:text-white">{candidate.fullName || 'Unknown'}</p>
              <p className="text-xs text-slate-400">{candidate.jobTitle || 'No title'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-4 space-y-3">
          {fields.map(({ label, value }) => (
            <div key={label} className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</span>
              <span className="text-sm text-slate-800 dark:text-slate-100 break-words">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function downloadCandidate(candidate) {
  const lines = [
    `Name: ${candidate.fullName || ''}`,
    `Job Title: ${candidate.jobTitle || ''}`,
    `Company: ${candidate.company || ''}`,
    `Location: ${candidate.location || ''}`,
    `Experience: ${candidate.experience || ''}`,
    `Skills: ${candidate.skills || ''}`,
    `Education: ${candidate.education || ''}`,
    `Email: ${candidate.email || ''}`,
    `Phone: ${candidate.phone || ''}`,
    `LinkedIn: ${candidate.linkedinUrl || ''}`,
    `Parse Status: ${candidate.parseStatus || ''}`,
  ].filter((l) => !l.endsWith(': '));
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(candidate.fullName || 'candidate').replace(/\s+/g, '_')}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function DatabaseView({ db, onBack }) {
  const [searchQ, setSearchQ] = useState('');
  const [page, setPage] = useState(1);
  const [viewingCandidate, setViewingCandidate] = useState(null);
  const qc = useQueryClient();

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['private-db-search', db._id, searchQ, page],
    queryFn: () => searchDb(db._id, searchQ, page),
    keepPreviousData: true,
  });

  const onUploadSuccess = () => {
    qc.invalidateQueries(['private-databases']);
    refetch();
  };

  const candidates = data?.candidates || [];
  const total = data?.totalCount || 0;

  return (
    <div className="flex flex-col h-full">
      <CandidateViewModal candidate={viewingCandidate} onClose={() => setViewingCandidate(null)} />
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={onBack}
          className="p-2 rounded-xl text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-md shadow-indigo-500/20 shrink-0">
            <Database size={20} className="text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white truncate">{db.name}</h2>
            <p className="text-sm text-slate-400 flex items-center gap-1.5 mt-0.5">
              <Users size={13} className="text-indigo-400" />
              {db.candidateCount ?? total} resume{(db.candidateCount ?? total) !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Upload Resume — full width row */}
      <div className="mb-6">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">Upload Resume</p>
        <DropZone dbId={db._id} onSuccess={onUploadSuccess} />
      </div>

      {/* Candidates — full width */}
      <div className="flex items-center gap-3 mb-4">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Candidates</span>
        <div className="flex-1 h-px bg-slate-100 dark:bg-slate-800" />
        {total > 0 && <span className="text-xs text-slate-400 tabular-nums shrink-0">{total} total</span>}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/60 text-slate-800 dark:text-slate-100 placeholder-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/10 transition-all"
          placeholder="Search by name, title, skills…"
          value={searchQ}
          onChange={(e) => { setSearchQ(e.target.value); setPage(1); }}
        />
        {searchQ && (
          <button onClick={() => setSearchQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Candidate list */}
      <div className="flex-1 overflow-y-auto space-y-2 pb-4">
        {isFetching && !data && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="animate-spin text-indigo-500" size={24} />
            <p className="text-sm text-slate-400">Loading candidates…</p>
          </div>
        )}

        {!isFetching && candidates.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <FileText size={28} className="text-slate-300 dark:text-slate-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                {searchQ ? 'No matches found' : 'No resumes yet'}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {searchQ ? 'Try a different keyword' : 'Upload your first resume above'}
              </p>
            </div>
          </div>
        )}

        {candidates.map((c) => (
          <div key={c._id} className="group flex items-center gap-4 px-5 py-4 rounded-xl bg-white dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700/60 hover:border-indigo-200 dark:hover:border-indigo-700/50 hover:shadow-sm transition-all">
            {/* Avatar */}
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-100 to-purple-100 dark:from-indigo-500/15 dark:to-purple-500/15 flex items-center justify-center shrink-0">
              <span className="text-base font-bold text-indigo-600 dark:text-indigo-400">
                {(c.fullName || '?').charAt(0).toUpperCase()}
              </span>
            </div>
            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="font-bold text-base text-slate-900 dark:text-white truncate">{c.fullName || 'Unknown'}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400 truncate mt-0.5">
                {[c.jobTitle, c.company].filter(Boolean).join(' · ') || 'No title'}
              </p>
              {c.skills && (
                <p className="text-xs text-slate-400 dark:text-slate-500 truncate mt-1">{c.skills.slice(0, 120)}</p>
              )}
            </div>
            {/* Right badges + actions */}
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              {c.experience && (
                <span className="text-sm font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700/70 px-3 py-1 rounded-full">
                  {c.experience}
                </span>
              )}
              <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                c.parseStatus === 'PARSED'
                  ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                  : 'bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400'
              }`}>
                {c.parseStatus}
              </span>
              <div className="flex items-center gap-1.5 mt-1">
                <button
                  onClick={() => setViewingCandidate(c)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors"
                  title="View parsed resume">
                  <Eye size={12} />
                  View
                </button>
                <button
                  onClick={() => downloadCandidate(c)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700/70 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                  title="Download candidate info">
                  <Download size={12} />
                  Download
                </button>
              </div>
            </div>
          </div>
        ))}

        {/* Pagination */}
        {total > 50 && (
          <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-800">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className="text-sm text-slate-500 hover:text-indigo-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors px-3 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
            >← Prev</button>
            <span className="text-xs text-slate-400">Page {page} · {total} total</span>
            <button
              disabled={candidates.length < 50}
              onClick={() => setPage(p => p + 1)}
              className="text-sm text-slate-500 hover:text-indigo-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors px-3 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
            >Next →</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
const PrivateDatabases = () => {
  const [newDbName, setNewDbName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [activeDb, setActiveDb] = useState(null);
  const qc = useQueryClient();

  const { data: databases = [], isLoading } = useQuery({
    queryKey: ['private-databases'],
    queryFn: fetchDatabases,
  });

  const createMutation = useMutation({
    mutationFn: createDb,
    onSuccess: () => {
      qc.invalidateQueries(['private-databases']);
      setNewDbName('');
      setShowCreate(false);
      toast.success('Database created');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to create'),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteDb,
    onSuccess: () => {
      qc.invalidateQueries(['private-databases']);
      toast.success('Database deleted');
    },
    onError: () => toast.error('Failed to delete database'),
  });

  const handleCreate = (e) => {
    e.preventDefault();
    if (!newDbName.trim()) return;
    createMutation.mutate(newDbName.trim());
  };

  if (activeDb) {
    const db = databases.find((d) => d._id === activeDb) || activeDb;
    return (
      <div className="flex-1 overflow-y-auto p-5 md:p-8 max-w-6xl mx-auto w-full">
        <DatabaseView db={db} onBack={() => setActiveDb(null)} />
      </div>
    );
  }

  const totalResumes = databases.reduce((s, d) => s + (d.candidateCount || 0), 0);

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Page Header — matches AI Sourcing Agent gradient */}
      <div className="bg-[linear-gradient(110deg,#1a1440,#432DD7)] px-5 md:px-10 py-6 border-b border-slate-800/30">
        <div className="flex items-start justify-between gap-5 max-w-5xl mx-auto">
          {/* Left: icon + title + subtitle */}
          <div className="flex items-center gap-5">
            <div className="bg-white/5 p-3.5 rounded-2xl border border-white/10 shadow-lg shrink-0">
              <Database size={36} className="text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-300 font-medium">Private Database</p>
              <h1 className="text-2xl md:text-3xl font-bold text-white mt-1 tracking-tight">My Databases</h1>
              <p className="text-sm text-slate-300 mt-1 leading-relaxed">Build private talent pools from your own resume collection.</p>
            </div>
          </div>
          {/* Right: button stacked above stats */}
          <div className="flex flex-col items-end gap-2.5 shrink-0">
            <button
              onClick={() => setShowCreate((v) => !v)}
              className={`cursor-pointer flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                showCreate
                  ? 'bg-white/10 border border-white/20 text-white hover:bg-white/20 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20'
                  : 'bg-white text-[#1a1440] hover:bg-slate-100 shadow-md hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/25'
              }`}
            >
              {showCreate ? <X size={15} /> : <Plus size={15} />}
              {showCreate ? 'Cancel' : 'New Database'}
            </button>
            {databases.length > 0 && (
              <div className="flex items-center gap-3 text-sm text-slate-300">
                <span className="flex items-center gap-1.5">
                  <Database size={12} className="text-indigo-300" />
                  <span className="font-semibold text-white">{databases.length}</span>
                  <span className="text-slate-400">DB{databases.length !== 1 ? 's' : ''}</span>
                </span>
                <span className="text-slate-600">·</span>
                <span className="flex items-center gap-1.5">
                  <Users size={12} className="text-emerald-400" />
                  <span className="font-semibold text-white">{totalResumes}</span>
                  <span className="text-slate-400">Resume{totalResumes !== 1 ? 's' : ''}</span>
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="px-5 md:px-10 py-6 max-w-5xl mx-auto w-full">
        {/* Create form */}
        {showCreate && (
          <form
            onSubmit={handleCreate}
            className="mb-6 p-5 rounded-2xl border border-indigo-200/70 dark:border-indigo-500/20 bg-gradient-to-br from-indigo-50/60 to-purple-50/30 dark:from-indigo-500/5 dark:to-purple-500/5"
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-indigo-500 dark:text-indigo-400 mb-3">New Database</p>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-500/15 flex items-center justify-center shrink-0">
                <Database size={16} className="text-indigo-500" />
              </div>
              <input
                autoFocus
                maxLength={25}
                className="flex-1 py-2.5 bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-xl px-3.5 text-sm font-medium text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/10 transition-all"
                placeholder="Database name (max 25 chars)"
                value={newDbName}
                onChange={(e) => setNewDbName(e.target.value)}
              />
              <span className="text-xs text-slate-400 shrink-0 tabular-nums w-8 text-center">{newDbName.length}/25</span>
              <button
                type="submit"
                disabled={!newDbName.trim() || createMutation.isPending}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm shadow-indigo-500/20 shrink-0"
              >
                {createMutation.isPending ? 'Creating…' : 'Create'}
              </button>
            </div>
          </form>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Loader2 className="animate-spin text-indigo-500" size={28} />
            <p className="text-sm text-slate-400">Loading databases…</p>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && databases.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
            <div className="relative">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 dark:from-indigo-500/10 dark:to-purple-500/10 flex items-center justify-center shadow-inner">
                <Database size={36} className="text-indigo-300 dark:text-indigo-500" />
              </div>
              <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center shadow-md">
                <Plus size={12} className="text-white" />
              </div>
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-700 dark:text-slate-200 mb-1">No databases yet</h3>
              <p className="text-sm text-slate-400 max-w-xs leading-relaxed">
                Create your first private resume database to start building your own talent pool.
              </p>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-2 flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow-sm shadow-indigo-500/20 transition-colors"
            >
              <Plus size={15} />
              Create First Database
            </button>
          </div>
        )}

        {/* Database list — nav-card style with database container icon */}
        {!isLoading && databases.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {databases.map((db) => (
              <button
                key={db._id}
                onClick={() => setActiveDb(db._id)}
                className="group relative flex flex-col items-start gap-4 p-6 rounded-2xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-800/60 shadow-sm hover:shadow-xl hover:shadow-indigo-100/60 dark:hover:shadow-indigo-900/20 hover:border-indigo-300 dark:hover:border-indigo-600/50 hover:-translate-y-0.5 transition-all duration-300 cursor-pointer text-left overflow-hidden"
              >
                {/* Subtle corner gradient accent */}
                <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-indigo-100/70 dark:from-indigo-500/8 to-transparent rounded-bl-full pointer-events-none" />

                {/* Top row: stacked-layer database icon + delete */}
                <div className="flex items-start justify-between w-full gap-2">
                  {/* Database container icon — stacked layers = database drum */}
                  <div className="relative shrink-0">
                    {/* Layer 3 (back) */}
                    <div className="absolute top-1.5 left-1.5 w-11 h-11 rounded-xl bg-indigo-200/50 dark:bg-indigo-600/20" />
                    {/* Layer 2 (middle) */}
                    <div className="absolute top-0.5 left-0.5 w-11 h-11 rounded-xl bg-indigo-300/40 dark:bg-indigo-500/25" />
                    {/* Layer 1 (front) */}
                    <div className="relative w-11 h-11 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center group-hover:bg-indigo-100 dark:group-hover:bg-indigo-500/20 transition-colors border border-indigo-100/80 dark:border-indigo-500/20">
                      <Database size={20} className="text-indigo-600 dark:text-indigo-400" />
                    </div>
                  </div>

                  {/* Delete button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete "${db.name}" and all its resumes?`)) deleteMutation.mutate(db._id);
                    }}
                    className="p-1.5 rounded-lg text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all shrink-0 relative z-10"
                    title="Delete database"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {/* Body: name + meta */}
                <div className="flex-1 w-full mt-1">
                  <h3 className="font-bold text-slate-900 dark:text-white text-base mb-1.5 truncate">{db.name}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                    <span className="flex items-center gap-1.5 flex-wrap">
                      <span className="flex items-center gap-1">
                        <Users size={12} className="text-indigo-400 shrink-0" />
                        <span className="font-medium text-slate-600 dark:text-slate-300">{db.candidateCount}</span>
                        <span>resume{db.candidateCount !== 1 ? 's' : ''}</span>
                      </span>
                      <span className="text-slate-300 dark:text-slate-600">·</span>
                      <span className="flex items-center gap-1">
                        <Calendar size={11} className="text-slate-400 shrink-0" />
                        {new Date(db.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    </span>
                  </p>
                </div>

                {/* Footer: status + arrow */}
                <div className="flex items-center justify-between w-full">
                  {db.candidateCount > 0 ? (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-2.5 py-1 rounded-full">
                      <Sparkles size={9} />Active
                    </span>
                  ) : (
                    <span className="text-[11px] font-medium text-slate-400 bg-slate-100 dark:bg-slate-700/60 px-2.5 py-1 rounded-full">
                      Empty
                    </span>
                  )}
                  <ChevronRight size={16} className="text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-0.5 transition-all" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default PrivateDatabases;

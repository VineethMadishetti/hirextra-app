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
  ChevronRight,
  FileText,
  Loader2,
  Users,
  ArrowLeft,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';

// ─── API helpers ────────────────────────────────────────────────────────────
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

// ─── Sub-components ──────────────────────────────────────────────────────────

function DropZone({ dbId, onSuccess }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null); // { ok, message, candidate }
  const inputRef = useRef(null);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    const allowed = ['pdf', 'doc', 'docx', 'txt'];
    const ext = file.name.split('.').pop().toLowerCase();
    if (!allowed.includes(ext)) {
      toast.error('Only PDF, DOC, DOCX, TXT files are supported');
      return;
    }
    setUploading(true);
    setResult(null);
    try {
      const data = await uploadResume(dbId, file);
      setResult({ ok: true, message: 'Resume parsed & added', candidate: data.candidate });
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
        className={`relative flex flex-col items-center justify-center gap-3 p-8 rounded-xl border-2 border-dashed cursor-pointer transition-all
          ${dragging ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10' : 'border-slate-300 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-600 bg-slate-50 dark:bg-slate-800/40'}
          ${uploading ? 'pointer-events-none opacity-70' : ''}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.doc,.docx,.txt"
          className="hidden"
          onChange={(e) => handleFile(e.target.files[0])}
        />
        {uploading ? (
          <>
            <Loader2 size={28} className="text-indigo-500 animate-spin" />
            <p className="text-sm text-slate-500 dark:text-slate-400">Parsing resume…</p>
          </>
        ) : (
          <>
            <Upload size={28} className="text-slate-400" />
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                Drop a resume here or <span className="text-indigo-600">browse</span>
              </p>
              <p className="text-xs text-slate-400 mt-0.5">PDF, DOC, DOCX, TXT · max 20 MB</p>
            </div>
          </>
        )}
      </div>

      {result && (
        <div className={`flex items-start gap-2.5 p-3 rounded-lg text-sm ${result.ok ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300'}`}>
          {result.ok ? <CheckCircle size={16} className="shrink-0 mt-0.5" /> : <AlertCircle size={16} className="shrink-0 mt-0.5" />}
          <div>
            <p className="font-medium">{result.message}</p>
            {result.candidate?.fullName && (
              <p className="text-xs opacity-75 mt-0.5">{result.candidate.fullName} · {result.candidate.jobTitle || 'N/A'}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DatabaseView({ db, onBack }) {
  const [searchQ, setSearchQ] = useState('');
  const [page, setPage] = useState(1);
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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={onBack}
          className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">{db.name}</h2>
          <p className="text-xs text-slate-400">{db.candidateCount} resume{db.candidateCount !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {/* Upload zone */}
      <div className="mb-6">
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Upload a resume</p>
        <DropZone dbId={db._id} onSuccess={onUploadSuccess} />
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/30"
            placeholder="Search by name, title, skills…"
            value={searchQ}
            onChange={(e) => { setSearchQ(e.target.value); setPage(1); }}
          />
          {searchQ && (
            <button onClick={() => setSearchQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto space-y-2">
        {isFetching && !data && (
          <div className="flex justify-center py-12">
            <Loader2 className="animate-spin text-indigo-500" size={24} />
          </div>
        )}

        {data?.candidates?.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            <FileText size={36} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm">{searchQ ? 'No matches found' : 'No resumes yet — upload one above'}</p>
          </div>
        )}

        {data?.candidates?.map((c) => (
          <div key={c._id} className="flex items-start gap-3 p-4 rounded-xl bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors">
            <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-500/15 flex items-center justify-center shrink-0">
              <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                {(c.fullName || '?').charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-slate-900 dark:text-white truncate">{c.fullName || 'Unknown'}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{[c.jobTitle, c.company].filter(Boolean).join(' · ') || 'No title'}</p>
              {c.skills && (
                <p className="text-xs text-slate-400 dark:text-slate-500 truncate mt-0.5">{c.skills.slice(0, 80)}</p>
              )}
            </div>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${c.parseStatus === 'PARSED' ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400'}`}>
              {c.parseStatus}
            </span>
          </div>
        ))}

        {/* Pagination */}
        {data && data.totalCount > 50 && (
          <div className="flex items-center justify-between pt-4">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="text-sm text-slate-500 disabled:opacity-40">← Prev</button>
            <span className="text-xs text-slate-400">Page {page}</span>
            <button disabled={data.candidates.length < 50} onClick={() => setPage(p => p + 1)} className="text-sm text-slate-500 disabled:opacity-40">Next →</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────
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

  // If a database is open, show its view
  if (activeDb) {
    const db = databases.find((d) => d._id === activeDb) || activeDb;
    return (
      <div className="flex-1 overflow-y-auto p-6 md:p-8">
        <DatabaseView db={db} onBack={() => setActiveDb(null)} />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 md:p-8 max-w-3xl mx-auto w-full">
      {/* Page header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">My Databases</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Create private resume databases and upload individual resumes
          </p>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold shadow transition-all"
        >
          <Plus size={16} />
          New Database
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="mb-6 p-5 rounded-2xl border border-indigo-200 dark:border-indigo-800/60 bg-indigo-50/50 dark:bg-indigo-500/5 flex items-center gap-3"
        >
          <Database size={18} className="text-indigo-500 shrink-0" />
          <input
            autoFocus
            maxLength={25}
            className="flex-1 bg-transparent text-sm font-medium text-slate-900 dark:text-white outline-none placeholder-slate-400"
            placeholder="Database name (max 25 chars)"
            value={newDbName}
            onChange={(e) => setNewDbName(e.target.value)}
          />
          <span className="text-xs text-slate-400 shrink-0">{newDbName.length}/25</span>
          <button
            type="submit"
            disabled={!newDbName.trim() || createMutation.isPending}
            className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
          >
            {createMutation.isPending ? 'Creating…' : 'Create'}
          </button>
          <button type="button" onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-slate-600">
            <X size={16} />
          </button>
        </form>
      )}

      {/* Database list */}
      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="animate-spin text-indigo-500" size={28} />
        </div>
      ) : databases.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          <Database size={48} className="mx-auto mb-4 opacity-30" />
          <p className="font-medium text-slate-600 dark:text-slate-300 mb-1">No databases yet</p>
          <p className="text-sm">Create your first private resume database above</p>
        </div>
      ) : (
        <div className="space-y-3">
          {databases.map((db) => (
            <div
              key={db._id}
              className="group flex items-center gap-4 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-800/60 hover:border-indigo-300 dark:hover:border-indigo-700 hover:shadow-md transition-all cursor-pointer"
              onClick={() => setActiveDb(db._id)}
            >
              <div className="w-11 h-11 rounded-xl bg-indigo-100 dark:bg-indigo-500/15 flex items-center justify-center shrink-0">
                <Database size={20} className="text-indigo-600 dark:text-indigo-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-slate-900 dark:text-white text-sm">{db.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1.5">
                  <Users size={11} />
                  {db.candidateCount} resume{db.candidateCount !== 1 ? 's' : ''}
                  <span className="opacity-40">·</span>
                  {new Date(db.createdAt).toLocaleDateString()}
                </p>
              </div>
              <ChevronRight size={16} className="text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-1 transition-all shrink-0" />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete "${db.name}" and all its resumes?`)) deleteMutation.mutate(db._id);
                }}
                className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                title="Delete database"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PrivateDatabases;

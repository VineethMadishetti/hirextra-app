import { useMemo, useState } from 'react';
import {
  AlertCircle,
  Briefcase,
  Clipboard,
  Download,
  FileSearch,
  Globe2,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Save,
  Search,
  UploadCloud,
  UserRoundCheck,
  X,
} from 'lucide-react';
import api from '../api/axios';
import toast from 'react-hot-toast';

const CARD_FONT = { fontFamily: '"Plus Jakarta Sans","Segoe UI",sans-serif' };

function StatCard({ label, value, icon, tone = 'blue' }) {
  const tones = {
    blue: 'bg-blue-50 border-blue-200 text-blue-900',
    teal: 'bg-teal-50 border-teal-200 text-teal-900',
    amber: 'bg-amber-50 border-amber-200 text-amber-900',
    slate: 'bg-slate-50 border-slate-200 text-slate-900',
  };
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.12em] font-semibold opacity-75">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}

function Chip({ text, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700 border-slate-200',
    blue: 'bg-blue-100 text-blue-700 border-blue-200',
    teal: 'bg-teal-100 text-teal-700 border-teal-200',
    emerald: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold border ${tones[tone]}`}>
      {text}
    </span>
  );
}

const stageMeta = {
  DISCOVERED: { label: 'Discovered', className: 'bg-slate-100 text-slate-700 border-slate-200' },
  CONTACT_ENRICHED: { label: 'Contact Enriched', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  SEQUENCED: { label: 'Sequenced', className: 'bg-teal-100 text-teal-700 border-teal-200' },
  CALL_QUEUED: { label: 'Call Queued', className: 'bg-amber-100 text-amber-700 border-amber-200' },
  SHORTLISTED: { label: 'Shortlisted', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
};

export default function SourcingAgentModal({ isOpen, onClose }) {
  const [view, setView] = useState('compose'); // compose | sourcing | results
  const [jobDescription, setJobDescription] = useState('');
  const [jdFile, setJdFile] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [sourcing, setSourcing] = useState(false);
  const [bundle, setBundle] = useState(null);
  const [responseData, setResponseData] = useState(null);
  const [error, setError] = useState('');
  const [savingCandidateUrl, setSavingCandidateUrl] = useState(null);
  const [savedCandidates, setSavedCandidates] = useState(new Set());
  const [stageUpdatingUrl, setStageUpdatingUrl] = useState(null);

  const parsedRequirements = bundle?.parsedRequirements || responseData?.parsedRequirements || null;
  const candidates = useMemo(
    () => responseData?.candidates || responseData?.results || [],
    [responseData]
  );
  const parseOnly = Boolean(responseData?.parseOnly);
  const summary = responseData?.summary || {};

  const shortlistedCount = useMemo(
    () => candidates.filter((c) => c.pipelineStage === 'SHORTLISTED').length,
    [candidates]
  );

  const handleClose = () => {
    setView('compose');
    setJobDescription('');
    setJdFile(null);
    setExtracting(false);
    setSourcing(false);
    setBundle(null);
    setResponseData(null);
    setError('');
    setSavedCandidates(new Set());
    setStageUpdatingUrl(null);
    onClose();
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0] || null;
    setJdFile(file);
    if (file) {
      setError('');
      toast.success(`Attached: ${file.name}`);
    }
  };

  const handleCopyBoolean = async (value) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Boolean query copied.');
    } catch {
      toast.error('Failed to copy query.');
    }
  };

  const handleExtractRequirements = async () => {
    setError('');
    if (!jobDescription.trim() && !jdFile) {
      setError('Paste JD text or upload a file.');
      return;
    }

    setExtracting(true);
    try {
      const formData = new FormData();
      if (jobDescription.trim()) formData.append('jobDescription', jobDescription.trim());
      if (jdFile) formData.append('jdFile', jdFile);

      const { data } = await api.post('/ai-source/requirements', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setBundle(data);
      toast.success('Structured requirements extracted.');
    } catch (err) {
      const message = err.response?.data?.error || 'Failed to extract requirements.';
      setError(message);
      toast.error(message);
    } finally {
      setExtracting(false);
    }
  };

  const handleStartSourcing = async () => {
    setError('');
    if (!parsedRequirements && !jobDescription.trim()) {
      setError('Extract requirements first, or paste a valid job description.');
      return;
    }

    setSourcing(true);
    setView('sourcing');
    try {
      const { data } = await api.post('/ai-source', {
        jobDescription: jobDescription.trim() || undefined,
        parsedRequirements: parsedRequirements || undefined,
        maxCandidates: 60,
        maxQueries: 6,
        resultsPerCountry: 3,
        enrichContacts: true,
        enrichTopN: 20,
        autoSave: true,
      });

      setResponseData(data);
      const preSaved = new Set(
        (data?.candidates || [])
          .filter((c) => c.savedToDatabase && (c.linkedinUrl || c.linkedInUrl))
          .map((c) => c.linkedinUrl || c.linkedInUrl)
      );
      setSavedCandidates(preSaved);
      setView('results');

      if (data?.parseOnly) {
        toast('Requirements parsed. Add GOOGLE_CSE_API_KEY to enable candidate discovery.', { icon: 'i' });
      } else {
        toast.success(`Sourcing complete. ${data?.summary?.totalExtracted || 0} candidates found.`);
      }
    } catch (err) {
      const message = err.response?.data?.error || 'Failed to source candidates.';
      setError(message);
      setView('compose');
      toast.error(message);
    } finally {
      setSourcing(false);
    }
  };

  const handleSaveCandidate = async (candidate) => {
    const linkedInUrl = candidate.linkedinUrl || candidate.linkedInUrl;
    if (!linkedInUrl) return;

    setSavingCandidateUrl(linkedInUrl);
    try {
      const { data } = await api.post('/ai-source/save-candidate', candidate);
      if (data?.success) {
        setSavedCandidates((prev) => new Set([...prev, linkedInUrl]));
        toast.success(`${candidate.name || candidate.fullName || 'Candidate'} saved.`);
      } else {
        toast.error(data?.error || 'Could not save candidate.');
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save candidate');
    } finally {
      setSavingCandidateUrl(null);
    }
  };

  const handleStageUpdate = async (candidate, stage) => {
    const linkedInUrl = candidate.linkedinUrl || candidate.linkedInUrl;
    if (!linkedInUrl) return;
    setStageUpdatingUrl(linkedInUrl);

    try {
      const { data } = await api.post('/ai-source/candidate-stage', {
        linkedInUrl,
        stage,
        name: candidate.name,
        company: candidate.company,
        title: candidate.title || candidate.jobTitle,
        location: candidate.location,
        sourceCountry: candidate.sourceCountry,
      });

      if (data?.success) {
        setResponseData((prev) => {
          if (!prev) return prev;
          const nextCandidates = (prev.candidates || prev.results || []).map((row) => {
            const rowLinkedin = row.linkedinUrl || row.linkedInUrl;
            if (rowLinkedin !== linkedInUrl) return row;
            return {
              ...row,
              pipelineStage: data.stage,
              sequenceStatus: data.sequenceStatus,
              callStatus: data.callStatus,
            };
          });
          return {
            ...prev,
            candidates: nextCandidates,
            results: nextCandidates,
          };
        });
        toast.success(`Updated: ${stageMeta[data.stage]?.label || data.stage}`);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update candidate stage.');
    } finally {
      setStageUpdatingUrl(null);
    }
  };

  const handleExportCSV = async () => {
    if (!candidates.length) return;
    try {
      toast.loading('Generating CSV...', { id: 'csv-export' });
      const response = await api.post('/ai-source/export/csv', { candidates }, { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `sourced-candidates-${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success('CSV downloaded.', { id: 'csv-export' });
    } catch {
      toast.error('Failed to export CSV', { id: 'csv-export' });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-sm p-3 md:p-6" style={CARD_FONT}>
      <div className="mx-auto h-full max-w-7xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_30px_90px_-35px_rgba(15,23,42,0.55)]">
        <div className="bg-[linear-gradient(110deg,#0f172a,#1e3a8a,#0f766e)] text-white px-6 py-5 flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-blue-100">Recruitment AI</p>
            <h2 className="text-2xl md:text-3xl font-bold mt-1">AI Sourcing Agent</h2>
            <p className="text-sm text-blue-100 mt-1">JD upload, structured extraction, CSE sourcing, enrichment, and shortlist workflow.</p>
          </div>
          <button onClick={handleClose} className="p-2 rounded-lg hover:bg-white/10 transition-colors">
            <X size={22} />
          </button>
        </div>

        <div className="h-[calc(100%-102px)] overflow-y-auto p-5 md:p-6 bg-[radial-gradient(circle_at_88%_10%,rgba(30,64,175,0.08),transparent_40%),radial-gradient(circle_at_10%_95%,rgba(15,118,110,0.1),transparent_35%)]">
          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {view === 'compose' && (
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.12fr] gap-5">
              <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white p-5 md:p-6 shadow-[0_16px_40px_-24px_rgba(15,23,42,0.5)]">
                <div className="pointer-events-none absolute -top-20 -right-20 h-56 w-56 rounded-full bg-blue-100/40 blur-3xl" />
                <div className="relative">
                  <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-slate-500">Job Input</p>
                  <h3 className="mt-1 text-xl font-bold text-slate-900">Describe Your Hiring Need</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Paste a JD or upload a file. We will convert it into structured filters and search-ready queries.
                  </p>

                  <textarea
                    value={jobDescription}
                    onChange={(e) => setJobDescription(e.target.value)}
                    placeholder="Paste JD text with role overview, must-have skills, location, years of experience, and hiring preferences."
                    className="mt-4 h-56 w-full rounded-2xl border border-slate-300 bg-white p-4 text-sm text-slate-800 leading-relaxed shadow-inner focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />

                  <div className="my-4 text-center text-[11px] uppercase tracking-[0.2em] text-slate-400">or upload</div>

                  <label className="group block rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 p-4 text-center cursor-pointer transition-all hover:border-blue-400 hover:bg-blue-50/70">
                    <UploadCloud size={20} className="mx-auto text-slate-500 group-hover:text-blue-600 transition-colors" />
                    <p className="text-sm font-semibold text-slate-700 mt-2">
                      {jdFile ? jdFile.name : 'Upload Job Description'}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">PDF, DOCX, TXT</p>
                    <input
                      type="file"
                      accept=".pdf,.docx,.txt"
                      className="hidden"
                      onChange={handleFileChange}
                    />
                  </label>

                  <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <button
                      onClick={handleExtractRequirements}
                      disabled={extracting}
                      className="rounded-xl bg-slate-900 hover:bg-slate-800 text-white px-4 py-3 text-sm font-semibold transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-2"
                    >
                      {extracting ? <Loader2 size={16} className="animate-spin" /> : <FileSearch size={16} />}
                      Extract Requirements
                    </button>
                    <button
                      onClick={handleStartSourcing}
                      disabled={sourcing || extracting}
                      className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 text-sm font-semibold transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-2"
                    >
                      {sourcing ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                      Start Sourcing
                    </button>
                  </div>
                </div>
              </div>

              <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white p-5 md:p-6 shadow-[0_16px_40px_-24px_rgba(15,23,42,0.5)]">
                <div className="pointer-events-none absolute -bottom-16 -left-10 h-52 w-52 rounded-full bg-teal-100/40 blur-3xl" />
                <div className="relative">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-slate-500">AI Parsing</p>
                      <h3 className="mt-1 text-xl font-bold text-slate-900">Structured Hiring Brief</h3>
                    </div>
                    {parsedRequirements?.jobTitle ? (
                      <Chip text={parsedRequirements.jobTitle} tone="blue" />
                    ) : null}
                  </div>

                  {!parsedRequirements ? (
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center">
                      <Briefcase size={22} className="mx-auto text-slate-400" />
                      <p className="mt-3 text-sm font-semibold text-slate-700">No parsed brief yet</p>
                      <p className="mt-1 text-xs text-slate-500">
                        Click <span className="font-semibold text-slate-700">Extract Requirements</span> to generate structured fields.
                      </p>
                    </div>
                  ) : (
                    <div className="mt-4 space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                          <p className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Industry</p>
                          <p className="text-sm font-bold text-slate-900 mt-1">{parsedRequirements.industry || 'Not Specified'}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                          <p className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Location</p>
                          <p className="text-sm font-bold text-slate-900 mt-1">{parsedRequirements.location || 'Not Specified'}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                          <p className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Experience</p>
                          <p className="text-sm font-bold text-slate-900 mt-1">{parsedRequirements.experienceYears || 0}+ years</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                          <p className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Availability</p>
                          <p className="text-sm font-bold text-slate-900 mt-1">{parsedRequirements.dosa?.availability || 'Not Specified'}</p>
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-200 p-3">
                        <p className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Required Skills</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {(parsedRequirements.requiredSkills || []).length ? (
                            (parsedRequirements.requiredSkills || []).map((skill) => (
                              <Chip key={`req-${skill}`} text={skill} tone="teal" />
                            ))
                          ) : (
                            <span className="text-xs text-slate-500">No required skills detected.</span>
                          )}
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-200 p-3">
                        <p className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Preferred Skills</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {(parsedRequirements.preferredSkills || []).length ? (
                            (parsedRequirements.preferredSkills || []).map((skill) => (
                              <Chip key={`pref-${skill}`} text={skill} tone="emerald" />
                            ))
                          ) : (
                            <span className="text-xs text-slate-500">No preferred skills detected.</span>
                          )}
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-200 p-3">
                        <p className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Boolean Query Preview</p>
                        <div className="mt-2 grid grid-cols-1 gap-2">
                          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                            {parsedRequirements?.booleanQueries?.requiredBoolean || 'Required query not generated yet.'}
                          </div>
                          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                            {parsedRequirements?.booleanQueries?.preferredBoolean || 'Preferred query not generated yet.'}
                          </div>
                        </div>
                        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                          <button
                            onClick={() => handleCopyBoolean(parsedRequirements?.booleanQueries?.requiredBoolean)}
                            className="rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold px-3 py-2 inline-flex items-center justify-center gap-1"
                          >
                            <Clipboard size={14} /> Copy Required Boolean
                          </button>
                          <button
                            onClick={() => handleCopyBoolean(parsedRequirements?.booleanQueries?.preferredBoolean)}
                            className="rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold px-3 py-2 inline-flex items-center justify-center gap-1"
                          >
                            <Clipboard size={14} /> Copy Preferred Boolean
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {view === 'sourcing' && (
            <div className="py-20 text-center">
              <Loader2 size={44} className="animate-spin mx-auto text-blue-600" />
              <p className="mt-4 text-lg font-semibold text-slate-900">Sourcing Pipeline Running</p>
              <p className="text-sm text-slate-500 mt-1">
                Parsing aliases, generating CSE queries, extracting profiles, enriching contacts, and saving results.
              </p>
            </div>
          )}

          {view === 'results' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <StatCard label="Extracted" value={summary.totalExtracted || 0} icon={<Search size={14} />} tone="blue" />
                <StatCard label="With Contact" value={summary.totalEnriched || 0} icon={<Mail size={14} />} tone="teal" />
                <StatCard label="Saved" value={summary.totalSaved || 0} icon={<Save size={14} />} tone="amber" />
                <StatCard label="Shortlisted" value={shortlistedCount} icon={<UserRoundCheck size={14} />} tone="slate" />
                <StatCard label="Countries" value={summary.countriesSearched || 0} icon={<Globe2 size={14} />} tone="slate" />
              </div>

              {parseOnly && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                  Candidate discovery is paused because `GOOGLE_CSE_API_KEY` is missing. Requirement extraction is complete.
                </div>
              )}

              {!parseOnly && candidates.length > 0 && (
                <div className="space-y-3">
                  {candidates.map((candidate, index) => {
                    const linkedInUrl = candidate.linkedinUrl || candidate.linkedInUrl;
                    const isSaving = savingCandidateUrl === linkedInUrl;
                    const isSaved = savedCandidates.has(linkedInUrl) || candidate.savedToDatabase;
                    const stage = candidate.pipelineStage || 'DISCOVERED';
                    const stageStyle = stageMeta[stage] || stageMeta.DISCOVERED;
                    const isUpdatingStage = stageUpdatingUrl === linkedInUrl;

                    return (
                      <div key={`${linkedInUrl || candidate.name || 'candidate'}-${index}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="text-base font-bold text-slate-900">
                                {candidate.name || candidate.fullName || 'Unknown'}
                              </h4>
                              <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${stageStyle.className}`}>
                                {stageStyle.label}
                              </span>
                            </div>
                            <p className="text-sm text-slate-600 mt-1 inline-flex items-center gap-2">
                              <Briefcase size={14} />
                              {(candidate.title || candidate.jobTitle || 'Unknown role')}
                              {candidate.company ? ` @ ${candidate.company}` : ''}
                            </p>
                            <p className="text-sm text-slate-500 mt-1 inline-flex items-center gap-2">
                              <MapPin size={14} />
                              {candidate.location || 'Location N/A'}
                              {candidate.sourceCountry ? ` | ${candidate.sourceCountry.toUpperCase()}` : ''}
                            </p>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {candidate.email && (
                              <span className="inline-flex items-center gap-1 text-xs rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 px-2 py-1">
                                <Mail size={12} /> {candidate.email}
                              </span>
                            )}
                            {candidate.phone && (
                              <span className="inline-flex items-center gap-1 text-xs rounded-lg border border-blue-200 bg-blue-50 text-blue-700 px-2 py-1">
                                <Phone size={12} /> {candidate.phone}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {linkedInUrl ? (
                            <a href={linkedInUrl} target="_blank" rel="noreferrer" className="text-sm text-blue-700 hover:underline">
                              View LinkedIn
                            </a>
                          ) : (
                            <span className="text-sm text-slate-500">LinkedIn unavailable</span>
                          )}

                          <button
                            onClick={() => handleSaveCandidate(candidate)}
                            disabled={!linkedInUrl || isSaving || isSaved}
                            className={`ml-auto rounded-lg px-3 py-1.5 text-xs font-semibold border transition-colors ${
                              isSaved
                                ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                            } disabled:opacity-60`}
                          >
                            {isSaving ? <Loader2 size={13} className="animate-spin inline mr-1" /> : <Save size={13} className="inline mr-1" />}
                            {isSaved ? 'Saved' : 'Save'}
                          </button>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            onClick={() => handleStageUpdate(candidate, 'SEQUENCED')}
                            disabled={isUpdatingStage}
                            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                          >
                            {isUpdatingStage ? <Loader2 size={12} className="animate-spin inline mr-1" /> : null}
                            Add to Sequence
                          </button>
                          <button
                            onClick={() => handleStageUpdate(candidate, 'CALL_QUEUED')}
                            disabled={isUpdatingStage}
                            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                          >
                            Queue for Call
                          </button>
                          <button
                            onClick={() => handleStageUpdate(candidate, 'SHORTLISTED')}
                            disabled={isUpdatingStage}
                            className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                          >
                            Shortlist
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {!parseOnly && candidates.length === 0 && (
                <div className="py-8 text-center text-slate-500">No candidates found for this requirement set.</div>
              )}

              <div className="pt-4 border-t border-slate-200 flex flex-col md:flex-row gap-3">
                <button
                  onClick={() => setView('compose')}
                  className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Update Requirements
                </button>
                <button
                  onClick={handleExportCSV}
                  disabled={!candidates.length}
                  className="flex-1 rounded-xl border border-blue-300 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50 inline-flex items-center justify-center gap-2"
                >
                  <Download size={15} /> Export CSV
                </button>
                <button
                  onClick={handleClose}
                  className="flex-1 rounded-xl bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 text-sm font-semibold"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

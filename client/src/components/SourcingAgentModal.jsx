import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Briefcase,
  Bot,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSearch,
  GraduationCap,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Search,
  UploadCloud,
} from 'lucide-react';
import api from '../api/axios';
import toast from 'react-hot-toast';

// ── Snippet extraction helpers ──────────────────────────────────────────────
const SKILL_RE = /\b(React|Angular|Vue|Node\.js|Python|Java(?:Script)?|TypeScript|AWS|Azure|GCP|Docker|Kubernetes|SQL|MongoDB|PostgreSQL|MySQL|Redis|Git|Linux|REST|GraphQL|Spring|Django|FastAPI|TensorFlow|PyTorch|Scala|Go|Rust|Swift|Kotlin|Flutter|React Native|HTML|CSS|Next\.js|Express|NestJS|Machine Learning|Deep Learning|NLP|DevOps|CI\/CD|Agile|Scrum|C\+\+|C#|\.NET|PHP|Ruby|Rails|Terraform|Spark|Power BI|Tableau|Salesforce|SAP)\b/gi;

function extractSkillsFromSnippet(snippet, jobTitle) {
  const text = `${snippet || ''} ${jobTitle || ''}`;
  return [...new Set((text.match(SKILL_RE) || []).map(s => s.trim()))].slice(0, 6);
}

function extractExperienceFromSnippet(snippet) {
  if (!snippet) return null;
  const m = snippet.match(/(\d+\+?)\s*(?:-|to)?\s*(?:\d+)?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:experience|exp)?/i);
  return m ? m[0].trim() : null;
}

function extractEducationFromSnippet(snippet) {
  if (!snippet) return null;
  const m = snippet.match(/\b(Ph\.?D\.?|M\.?Tech\.?|B\.?Tech\.?|MBA|M\.?S\.?|B\.?E\.?|Bachelor'?s?|Master'?s?|Computer Science|Information Technology|IIT|IIM|NIT)\b/i);
  return m ? m[0] : null;
}

function extractAvailabilityFromSnippet(snippet) {
  if (!snippet) return null;
  const l = snippet.toLowerCase();
  if (l.includes('open to work') || l.includes('open to opportunities') || l.includes('#opentowork')) return 'Open to Work';
  if (l.includes('actively seek') || l.includes('actively look') || l.includes('job seeker')) return 'Actively Seeking';
  if (l.includes('available for') || l.includes('available from')) return 'Available';
  return null;
}
// ────────────────────────────────────────────────────────────────────────────


const CARD_FONT = { fontFamily: '"Plus Jakarta Sans","Segoe UI",sans-serif' };

function StatCard({ label, value, icon, tone = 'blue' }) {
  const tones = {
    blue: 'bg-[#432DD7]/30 border-[#6B5AF0]/40 text-[#E3DEFF]',
    teal: 'bg-teal-950/35 border-teal-700/40 text-teal-100',
    amber: 'bg-amber-950/35 border-amber-700/40 text-amber-100',
    slate: 'bg-slate-900/80 border-slate-700 text-slate-100',
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

const stageMeta = {
  DISCOVERED: { label: 'Discovered', className: 'bg-slate-800 text-slate-200 border-slate-700' },
  CONTACT_ENRICHED: { label: 'Contact Enriched', className: 'bg-[#432DD7]/25 text-[#E3DEFF] border-[#6B5AF0]/50' },
  SEQUENCED: { label: 'Sequenced', className: 'bg-teal-950/45 text-teal-200 border-teal-700/50' },
  CALL_QUEUED: { label: 'Call Queued', className: 'bg-amber-950/45 text-amber-200 border-amber-700/50' },
  SHORTLISTED: { label: 'Shortlisted', className: 'bg-emerald-950/45 text-emerald-200 border-emerald-700/50' },
};

const AI_SOURCE_STATE_KEY = 'hirextra_ai_source_state';

export default function SourcingAgentModal({ isOpen = true, onClose = () => {}, inline = false }) {
  const [view, setView] = useState('compose'); // compose | sourcing | results
  const [composeStep, setComposeStep] = useState('input'); // input | parsed
  const [jobDescription, setJobDescription] = useState('');
  const [jdFile, setJdFile] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [sourcing, setSourcing] = useState(false);
  const [bundle, setBundle] = useState(null);
  const [parsedDraft, setParsedDraft] = useState(null);
  const [responseData, setResponseData] = useState(null);
  const [error, setError] = useState('');
  const [savingCandidateUrl, setSavingCandidateUrl] = useState(null);
  const [contactLoadingUrl, setContactLoadingUrl] = useState(null);
  const [savedCandidates, setSavedCandidates] = useState(new Set());

  const parsedRequirements = parsedDraft || bundle?.parsedRequirements || responseData?.parsedRequirements || null;
  const canExtractRequirements = Boolean(jobDescription.trim());
  const hasParsedDraft = Boolean(parsedDraft);
  const candidates = useMemo(
    () => responseData?.candidates || responseData?.results || [],
    [responseData]
  );
  const parseOnly = Boolean(responseData?.parseOnly);
  const summary = responseData?.summary || {};

  useEffect(() => {
    try {
      const raw = localStorage.getItem(AI_SOURCE_STATE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);

      if (parsed?.view) {
        // Never re-enter a stale loading screen on restore
        setView(parsed.view === 'sourcing' ? 'results' : parsed.view);
      }
      if (parsed?.composeStep) setComposeStep(parsed.composeStep);
      if (typeof parsed?.jobDescription === 'string') setJobDescription(parsed.jobDescription);
      if (parsed?.bundle) setBundle(parsed.bundle);
      if (parsed?.parsedDraft) setParsedDraft(parsed.parsedDraft);
      if (parsed?.responseData) setResponseData(parsed.responseData);
      if (Array.isArray(parsed?.savedCandidates)) {
        setSavedCandidates(new Set(parsed.savedCandidates));
      }
    } catch {
      // Ignore restore errors; start fresh
    }
  }, []);

  useEffect(() => {
    try {
      const snapshot = {
        view,
        composeStep,
        jobDescription,
        bundle,
        parsedDraft,
        responseData,
        savedCandidates: Array.from(savedCandidates),
      };
      localStorage.setItem(AI_SOURCE_STATE_KEY, JSON.stringify(snapshot));
    } catch {
      // Ignore persistence errors
    }
  }, [view, composeStep, jobDescription, bundle, parsedDraft, responseData, savedCandidates]);

  const handleClose = () => {
    setView('compose');
    setJobDescription('');
    setJdFile(null);
    setComposeStep('input');
    setExtracting(false);
    setSourcing(false);
    setBundle(null);
    setParsedDraft(null);
    setResponseData(null);
    setError('');
    setSavedCandidates(new Set());
    setContactLoadingUrl(null);
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

  const parseSkillsText = (value) =>
    String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

  const handleExtractRequirements = async () => {
    setError('');
    if (!jobDescription.trim()) {
      setError('Enter job description to extract requirements.');
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
      const extractedRequirements = data?.parsedRequirements || {};
      setParsedDraft({
        ...extractedRequirements,
        experienceYears: Number(extractedRequirements.experienceYears || 0),
        requiredSkills: Array.isArray(extractedRequirements.requiredSkills) ? extractedRequirements.requiredSkills : [],
        preferredSkills: Array.isArray(extractedRequirements.preferredSkills) ? extractedRequirements.preferredSkills : [],
        dosa: {
          ...(extractedRequirements.dosa || {}),
        },
        availability: extractedRequirements.availability || extractedRequirements.dosa?.availability || '',
        jobType: extractedRequirements.durationType || '',
        salaryRange: extractedRequirements.salaryPackage || '',
        education: extractedRequirements.education || '',
      });
      setComposeStep('parsed');
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
    if (!parsedRequirements) {
      setError('Extract requirements first.');
      return;
    }

    setSourcing(true);
    setView('sourcing');
    try {
      const { data } = await api.post('/ai-source', {
        jobDescription: jobDescription.trim() || undefined,
        parsedRequirements: parsedRequirements,
        maxCandidates: 60,
        maxQueries: 6,
        resultsPerCountry: 10,
        enrichContacts: false,
        enrichTopN: 0,
        autoSave: false,
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
        toast('Requirements parsed. Add SERPER_API_KEY to enable candidate discovery.', { icon: 'i' });
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
    if (!linkedInUrl) return null;

    setSavingCandidateUrl(linkedInUrl);
    try {
      const { data } = await api.post('/ai-source/save-candidate', candidate);
      if (data?.success) {
        const savedId = data?.candidateId || data?.candidate?._id || null;
        setSavedCandidates((prev) => new Set([...prev, linkedInUrl]));
        setResponseData((prev) => {
          if (!prev) return prev;
          const nextCandidates = (prev.candidates || prev.results || []).map((row) => {
            const rowLinkedin = row.linkedinUrl || row.linkedInUrl;
            if (rowLinkedin !== linkedInUrl) return row;
            return {
              ...row,
              savedToDatabase: true,
              savedCandidateId: savedId || row.savedCandidateId || null,
            };
          });
          return {
            ...prev,
            candidates: nextCandidates,
            results: nextCandidates,
          };
        });
        toast.success(`${candidate.name || candidate.fullName || 'Candidate'} saved.`);
        return savedId;
      } else {
        toast.error(data?.error || 'Could not save candidate.');
        return null;
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save candidate');
      return null;
    } finally {
      setSavingCandidateUrl(null);
    }
  };

  const handleGetContact = async (candidate) => {
    const linkedInUrl = candidate.linkedinUrl || candidate.linkedInUrl;
    if (!linkedInUrl) {
      toast.error('LinkedIn URL missing for this candidate.');
      return;
    }

    setContactLoadingUrl(linkedInUrl);
    try {
      let candidateId = candidate.savedCandidateId || null;
      if (!candidateId) {
        candidateId = await handleSaveCandidate(candidate);
      }

      if (!candidateId) {
        toast.error('Could not prepare candidate for enrichment.');
        return;
      }

      const { data } = await api.get(`/enrich-contact/${candidateId}`);
      const enriched = data?.data || null;
      const hasContact = Boolean(enriched?.email || enriched?.phone);

      if (!data?.success || !hasContact) {
        toast.error(enriched?.error || 'No contact found for this candidate.');
        return;
      }

      setResponseData((prev) => {
        if (!prev) return prev;
        const nextCandidates = (prev.candidates || prev.results || []).map((row) => {
          const rowLinkedin = row.linkedinUrl || row.linkedInUrl;
          if (rowLinkedin !== linkedInUrl) return row;
          return {
            ...row,
            savedCandidateId: candidateId,
            savedToDatabase: true,
            email: enriched.email || row.email || null,
            phone: enriched.phone || row.phone || null,
            enrichmentSource: enriched.source || row.enrichmentSource || null,
            enrichmentConfidence:
              Number.isFinite(Number(enriched.confidence))
                ? Number(enriched.confidence)
                : row.enrichmentConfidence || null,
            pipelineStage: 'CONTACT_ENRICHED',
          };
        });
        return {
          ...prev,
          candidates: nextCandidates,
          results: nextCandidates,
        };
      });
      toast.success('Contact enriched successfully.');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to fetch contact.');
    } finally {
      setContactLoadingUrl(null);
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

  if (!inline && !isOpen) return null;

  const outerShellClass = inline
    ? 'h-full w-full bg-transparent px-4 pt-4 pb-4 overflow-y-auto'
    : 'fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-[2px]';

  const contentShellClass = inline
    ? 'mx-auto max-w-7xl overflow-hidden rounded-2xl border border-slate-800 bg-slate-950'
    : 'mx-auto h-full max-w-7xl overflow-hidden rounded-t-2xl border border-slate-800 bg-slate-950';

  return (
    <div className={outerShellClass} style={CARD_FONT}>
      <div className={contentShellClass}>
        <div className="bg-[linear-gradient(110deg,#1a1440,#432DD7)] border-b border-slate-800 text-white px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <div className="bg-white/5 p-3 rounded-2xl border border-white/10 shadow-lg shrink-0">
              <Bot size={36} className="text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-300">Recruitment AI</p>
              <h2 className="text-2xl md:text-3xl font-bold mt-1">
                AI Sourcing Agent
              </h2>
              <p className="text-sm text-slate-300 mt-1">Fast candidate discovery from JD with immediate results.</p>
            </div>
          </div>
        </div>

        <div className="h-[calc(100%-102px)] overflow-y-auto p-5 md:p-6 bg-[radial-gradient(circle_at_88%_10%,rgba(67,45,215,0.24),transparent_40%),radial-gradient(circle_at_10%_95%,rgba(130,113,255,0.18),transparent_35%)]">
          {error && (
            <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200 flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {view === 'compose' && (
            <div className="mx-auto max-w-6xl">
              {hasParsedDraft && (
                <div className="mb-6 flex items-center justify-between px-1">
                  {composeStep === 'parsed' ? (
                    <button
                      onClick={() => setComposeStep('input')}
                      className="inline-flex items-center gap-2 rounded-xl bg-slate-800 border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-all hover:border-slate-600 shadow-sm cursor-pointer"
                    >
                      <ChevronLeft size={16} />
                      Back
                    </button>
                  ) : (
                    <div className="w-20" />
                  )}

                  <h3 className="text-xl font-bold tracking-tight uppercase text-[#5A45E5]">
                    {composeStep === 'input' ? 'Requirements Input' : 'Structured Filters'}
                  </h3>

                  {composeStep === 'input' ? (
                    <button
                      onClick={() => setComposeStep('parsed')}
                      className="inline-flex items-center gap-2 rounded-xl bg-slate-800 border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-all hover:border-slate-600 shadow-sm cursor-pointer"
                    >
                      Next
                      <ChevronRight size={16} />
                    </button>
                  ) : responseData ? (
                    <button
                      onClick={() => setView('results')}
                      className="inline-flex items-center gap-2 rounded-xl bg-slate-800 border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-all hover:border-slate-600 shadow-sm cursor-pointer"
                    >
                      Results
                      <ChevronRight size={16} />
                    </button>
                  ) : (
                    <div className="w-20" />
                  )}
                </div>
              )}

              {composeStep === 'input' ? (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                    <div className="rounded-2xl border border-slate-700 bg-slate-900/80 p-5 transition-all duration-200 hover:border-[#6B5AF0]/70 hover:shadow-[0_0_0_1px_rgba(67,45,215,0.25)]">
                      <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-slate-400">Input</p>
                      <h3 className="mt-1 text-xl font-bold text-slate-100 inline-flex items-center gap-2">
                        <FileSearch size={18} className="text-[#A99BFF]" />
                        Describe Your Hiring Need
                      </h3>
                      <textarea
                        value={jobDescription}
                        onChange={(e) => setJobDescription(e.target.value)}
                        placeholder="Paste JD text with role overview, must-have skills, location, years of experience, and hiring preferences."
                        className="mt-4 h-64 w-full rounded-xl border border-slate-700 bg-slate-950 p-4 text-sm text-slate-100 placeholder:text-slate-500 leading-relaxed transition-colors hover:border-[#6B5AF0]/70 focus:outline-none focus:ring-2 focus:ring-[#432DD7]"
                      />
                    </div>

                    <div className="rounded-2xl border border-slate-700 bg-slate-900/80 p-5 flex flex-col transition-all duration-200 hover:border-[#6B5AF0]/70 hover:shadow-[0_0_0_1px_rgba(67,45,215,0.25)]">
                      <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-slate-400">Document</p>
                      <h3 className="mt-1 text-xl font-bold text-slate-100 inline-flex items-center gap-2">
                        <UploadCloud size={18} className="text-[#A99BFF]" />
                        Upload Job Description
                      </h3>
                      <label className="mt-4 flex-1 group block rounded-xl border border-dashed border-slate-600 bg-slate-950/60 p-6 text-center cursor-pointer transition-all hover:border-[#6B5AF0] hover:bg-slate-900">
                        <UploadCloud size={22} className="mx-auto text-slate-400 group-hover:text-[#A99BFF] transition-colors" />
                        <p className="text-sm font-semibold text-slate-200 mt-3">
                          {jdFile ? jdFile.name : 'Click to upload'}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">PDF, DOCX, TXT</p>
                        <input
                          type="file"
                          accept=".pdf,.docx,.txt"
                          className="hidden"
                          onChange={handleFileChange}
                        />
                      </label>

                      <div className="mt-4 text-xs text-slate-400 space-y-1.5">
                        <p className="font-semibold text-slate-300">How it works:</p>
                        <p>AI parses your job description</p>
                        <p>Generates LinkedIn search queries</p>
                        <p>Searches across 50+ countries</p>
                        <p>Extracts candidates immediately (contact enrichment can be run later)</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-center">
                    <button
                      onClick={handleExtractRequirements}
                      disabled={extracting || !canExtractRequirements}
                      className="min-w-[260px] rounded-xl bg-[#432DD7] hover:bg-[#5A45E5] disabled:bg-slate-700 disabled:text-slate-400 text-white px-6 py-3 text-sm font-semibold transition-colors inline-flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                    >
                      {extracting ? <Loader2 size={16} className="animate-spin" /> : <FileSearch size={16} />}
                      Extract Requirements
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-700 bg-slate-900/80 p-5 md:p-6">
                  <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-slate-400">AI Parsing</p>
                  <h3 className="mt-1 text-xl font-bold text-slate-100">Structured Hiring Brief</h3>

                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Job Title</label>
                      <input
                        value={parsedDraft?.jobTitle || ''}
                        onChange={(e) => setParsedDraft((prev) => ({ ...(prev || {}), jobTitle: e.target.value }))}
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 transition-colors hover:border-[#6B5AF0]/70 focus:outline-none focus:ring-2 focus:ring-[#432DD7]"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Industry</label>
                      <input
                        value={parsedDraft?.industry || ''}
                        onChange={(e) => setParsedDraft((prev) => ({ ...(prev || {}), industry: e.target.value }))}
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 transition-colors hover:border-[#6B5AF0]/70 focus:outline-none focus:ring-2 focus:ring-[#432DD7]"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Location</label>
                      <input
                        value={parsedDraft?.location || ''}
                        onChange={(e) => setParsedDraft((prev) => ({ ...(prev || {}), location: e.target.value }))}
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 transition-colors hover:border-[#6B5AF0]/70 focus:outline-none focus:ring-2 focus:ring-[#432DD7]"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Experience (Years)</label>
                      <input
                        type="number"
                        min="0"
                        value={parsedDraft?.experienceYears ?? 0}
                        onChange={(e) =>
                          setParsedDraft((prev) => ({ ...(prev || {}), experienceYears: Math.max(0, Number(e.target.value) || 0) }))
                        }
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 transition-colors hover:border-[#6B5AF0]/70 focus:outline-none focus:ring-2 focus:ring-[#432DD7]"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Job Type / Duration</label>
                      <input
                        value={parsedDraft?.jobType || ''}
                        onChange={(e) => setParsedDraft((prev) => ({ ...(prev || {}), jobType: e.target.value }))}
                        placeholder="e.g. Full-time, Contract"
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 transition-colors hover:border-[#6B5AF0]/70 focus:outline-none focus:ring-2 focus:ring-[#432DD7]"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Salary Range</label>
                      <input
                        value={parsedDraft?.salaryRange || ''}
                        onChange={(e) => setParsedDraft((prev) => ({ ...(prev || {}), salaryRange: e.target.value }))}
                        placeholder="e.g. $100k - $130k"
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 transition-colors hover:border-[#6B5AF0]/70 focus:outline-none focus:ring-2 focus:ring-[#432DD7]"
                      />
                    </div>
                    <div className="md:col-span-2 grid md:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Education</label>
                        <input
                          value={parsedDraft?.education || ''}
                          onChange={(e) => setParsedDraft((prev) => ({ ...(prev || {}), education: e.target.value }))}
                          placeholder="e.g. Bachelor's in CS"
                          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 transition-colors hover:border-[#6B5AF0]/70 focus:outline-none focus:ring-2 focus:ring-[#432DD7]"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Availability</label>
                        <input
                          value={parsedDraft?.availability || ''}
                          onChange={(e) =>
                            setParsedDraft((prev) => ({
                              ...(prev || {}),
                              availability: e.target.value,
                            }))
                          }
                          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 transition-colors hover:border-[#6B5AF0]/70 focus:outline-none focus:ring-2 focus:ring-[#432DD7]"
                        />
                      </div>
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Required Skills (comma separated)</label>
                      <textarea
                        value={(parsedDraft?.requiredSkills || []).join(', ')}
                        onChange={(e) =>
                          setParsedDraft((prev) => ({ ...(prev || {}), requiredSkills: parseSkillsText(e.target.value) }))
                        }
                        className="mt-1 h-20 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 transition-colors hover:border-[#6B5AF0]/70 focus:outline-none focus:ring-2 focus:ring-[#432DD7]"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Preferred Skills (comma separated)</label>
                      <textarea
                        value={(parsedDraft?.preferredSkills || []).join(', ')}
                        onChange={(e) =>
                          setParsedDraft((prev) => ({ ...(prev || {}), preferredSkills: parseSkillsText(e.target.value) }))
                        }
                        className="mt-1 h-20 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 transition-colors hover:border-[#6B5AF0]/70 focus:outline-none focus:ring-2 focus:ring-[#432DD7]"
                      />
                    </div>
                  </div>

                  <div className="mt-6 flex justify-center">
                    <button
                      onClick={handleStartSourcing}
                      disabled={sourcing || extracting || !parsedRequirements}
                      className="min-w-[260px] rounded-xl bg-[#432DD7] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#5A45E5] disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed"
                    >
                      Find Candidate
                    </button>
                  </div>

                </div>
              )}
            </div>
          )}

          {view === 'sourcing' && (
            <div className="py-20 text-center">
              <Loader2 size={44} className="animate-spin mx-auto text-[#A99BFF]" />
              <p className="mt-4 text-lg font-semibold text-slate-100">Sourcing Pipeline Running</p>
              <p className="text-sm text-slate-400 mt-1">
                Generating search queries, extracting profiles, and returning candidates.
              </p>
            </div>
          )}

          {view === 'results' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between px-1">
                <button
                  onClick={() => setView('compose')}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-800 border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-all hover:border-slate-600 shadow-sm cursor-pointer"
                >
                  <ChevronLeft size={16} />
                  Back
                </button>
                <p className="text-sm font-semibold text-slate-300">{candidates.length} candidates found</p>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                <StatCard label="Extracted" value={summary.totalExtracted || 0} icon={<Search size={14} />} tone="blue" />
                <StatCard label="With Contact" value={summary.totalEnriched || 0} icon={<Mail size={14} />} tone="teal" />
              </div>

              {parseOnly && (
                <div className="rounded-xl border border-amber-700/50 bg-amber-950/30 p-3 text-sm text-amber-200">
                  Candidate discovery is paused because `GOOGLE_CSE_API_KEY` is missing. Requirement extraction is complete.
                </div>
              )}

              {!parseOnly && candidates.length > 0 && (
                <div className="space-y-3">
                  {candidates.map((candidate, index) => {
                    const linkedInUrl = candidate.linkedinUrl || candidate.linkedInUrl;
                    const isContactLoading = contactLoadingUrl === linkedInUrl;

                    const skills = extractSkillsFromSnippet(candidate.snippet, candidate.title || candidate.jobTitle);
                    const experience = extractExperienceFromSnippet(candidate.snippet);
                    const education = extractEducationFromSnippet(candidate.snippet);
                    const availability = extractAvailabilityFromSnippet(candidate.snippet);

                    return (
                      <div key={`${linkedInUrl || candidate.name || 'candidate'}-${index}`} className="rounded-2xl border border-slate-700 bg-slate-900/80 p-4 transition-all duration-200 hover:border-[#6B5AF0]/70 hover:shadow-[0_0_0_1px_rgba(67,45,215,0.22)]">
                        {/* Row 1: Name + contact badges */}
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="text-base font-bold text-slate-100">
                                {candidate.name || candidate.fullName || 'Unknown'}
                              </h4>
                              {availability && (
                                <span className="inline-flex items-center gap-1 text-[10px] rounded-full border border-emerald-700/50 bg-emerald-950/35 text-emerald-300 px-2 py-0.5 font-semibold">
                                  {availability}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-slate-300 mt-0.5 flex items-center gap-1.5 flex-wrap">
                              <Briefcase size={13} className="shrink-0" />
                              <span>{candidate.title || candidate.jobTitle || 'Unknown role'}</span>
                              {candidate.company && <span className="text-slate-400">@ {candidate.company}</span>}
                            </p>
                            <div className="flex flex-wrap items-center gap-3 mt-0.5 text-xs text-slate-400">
                              {(candidate.location || candidate.sourceCountry) && (
                                <span className="flex items-center gap-1">
                                  <MapPin size={11} />
                                  {candidate.location || ''}
                                  {candidate.sourceCountry ? ` (${candidate.sourceCountry.toUpperCase()})` : ''}
                                </span>
                              )}
                              {experience && (
                                <span className="flex items-center gap-1">
                                  <Briefcase size={11} />
                                  {experience}
                                </span>
                              )}
                              {education && (
                                <span className="flex items-center gap-1">
                                  <GraduationCap size={11} />
                                  {education}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1.5 shrink-0">
                            {candidate.email && (
                              <span className="inline-flex items-center gap-1 text-xs rounded-lg border border-emerald-700/50 bg-emerald-950/35 text-emerald-200 px-2 py-1">
                                <Mail size={11} /> {candidate.email}
                              </span>
                            )}
                            {candidate.phone && (
                              <span className="inline-flex items-center gap-1 text-xs rounded-lg border border-[#6B5AF0]/50 bg-[#432DD7]/25 text-[#E3DEFF] px-2 py-1">
                                <Phone size={11} /> {candidate.phone}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Skills row */}
                        {skills.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {skills.map((skill) => (
                              <span key={skill} className="text-[11px] rounded-md border border-slate-600 bg-slate-800 text-slate-300 px-2 py-0.5">
                                {skill}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Bottom row: LinkedIn URL + Get Contact */}
                        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-700/50 pt-2.5">
                          {linkedInUrl ? (
                            <a href={linkedInUrl} target="_blank" rel="noreferrer" className="text-xs text-[#B9AEFF] hover:text-white hover:underline font-medium">
                              🔗 View Profile
                            </a>
                          ) : (
                            <span className="text-xs text-slate-500">Profile URL unavailable</span>
                          )}

                          {!candidate.email && !candidate.phone && (
                            <button
                              onClick={() => handleGetContact(candidate)}
                              disabled={!linkedInUrl || isContactLoading}
                              className="ml-auto rounded-lg border border-indigo-700/50 bg-indigo-950/40 px-3 py-1.5 text-xs font-semibold text-indigo-200 hover:bg-indigo-900/50 disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed"
                            >
                              {isContactLoading ? <Loader2 size={13} className="animate-spin inline mr-1" /> : <Mail size={13} className="inline mr-1" />}
                              Get Contact
                            </button>
                          )}
                        </div>

                      </div>
                    );
                  })}
                </div>
              )}

              {!parseOnly && candidates.length === 0 && (
                <div className="py-8 text-center text-slate-400">No candidates found for this requirement set.</div>
              )}

              <div className="pt-4 border-t border-slate-700 flex flex-col md:flex-row gap-3">
                <button
                  onClick={() => setView('compose')}
                  className="flex-1 rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-800 cursor-pointer"
                >
                  Update Requirements
                </button>
                <button
                  onClick={handleExportCSV}
                  disabled={!candidates.length}
                  className="flex-1 rounded-xl border border-[#6B5AF0]/50 bg-[#432DD7]/25 px-4 py-2.5 text-sm font-semibold text-[#E3DEFF] hover:bg-[#432DD7]/40 disabled:opacity-50 inline-flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                >
                  <Download size={15} /> Export CSV
                </button>
                <button
                  onClick={handleClose}
                  className="flex-1 rounded-xl bg-slate-100 hover:bg-white text-slate-900 px-4 py-2.5 text-sm font-semibold cursor-pointer"
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


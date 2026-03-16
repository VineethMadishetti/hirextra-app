import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Briefcase,
  Building2,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Database,
  Download,
  FileSearch,
  Globe,
  GraduationCap,
  Loader2,
  Mail,
  MapPin,
  Phone,
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

// Returns education text; flags premium institutes (IIT/IIM/NIT/BITS/IISC)
// Used as a client-side fallback when the server didn't extract education.
function extractEducationFromSnippet(snippet) {
  if (!snippet) return null;
  // Priority 1: Premium institutes (no separator required — just find the name)
  const premiumMatch = snippet.match(
    /\b(IIT(?:\s+(?:Bombay|Delhi|Madras|Kanpur|Kharagpur|Roorkee|Guwahati|Hyderabad|Varanasi|BHU|ISM|Jodhpur|Indore|Mandi|Patna|Bhubaneswar|Tirupati|Jammu|Palakkad|Dharwad|Bhilai|Dhanbad))?|IIM(?:\s+(?:Ahmedabad|Bangalore|Calcutta|Lucknow|Kozhikode|Indore|Shillong|Udaipur|Raipur|Rohtak|Trichy|Kashipur|Amritsar|Nagpur))?|IISC(?:\s+Bangalore)?|BITS(?:\s+(?:Pilani|Goa|Hyderabad))?|NIT(?:\s+(?:Trichy|Warangal|Surathkal|Calicut|Allahabad|Rourkela|Durgapur|Jamshedpur|Silchar|Kurukshetra|Hamirpur|Srinagar|Jalandhar|Patna|Raipur|Goa|Delhi|Puducherry))?|IIIT(?:\s+(?:Hyderabad|Allahabad|Delhi|Bangalore|Gwalior))?)\b/i
  );
  if (premiumMatch?.[0]) return premiumMatch[0].trim().replace(/\s+/g, ' ');
  // Priority 2: Degree keywords
  const degreeMatch = snippet.match(/\b(Ph\.?D\.?|M\.?Tech\.?|B\.?Tech\.?|MBA|M\.?S\.?\b|B\.?E\.?\b|Bachelor(?:'s)?|Master(?:'s)?)\b/i);
  return degreeMatch ? degreeMatch[0].trim() : null;
}

const PREMIUM_INSTITUTES = /^(IIT|IIM|IISC|BITS|NIT)/i;
const isPremiumInstitute = (edu) => edu && PREMIUM_INSTITUTES.test(edu.trim());

/**
 * Returns array of status/availability badges from snippet.
 * Each badge: { label: string, type: 'availability'|'immediate'|'fresher' }
 */
function extractBadgesFromSnippet(snippet) {
  if (!snippet) return [];
  const badges = [];
  const l = snippet.toLowerCase();

  if (l.includes('open to work') || l.includes('#opentowork') || l.includes('open to opportunities')) {
    badges.push({ label: 'Open to Work', type: 'availability' });
  } else if (/immediate\s*joiner|immediately\s*available|can\s*join\s*immediately|notice.*?immediate|available\s*immediately|joining\s*immediately/i.test(snippet)) {
    badges.push({ label: 'Immediate Joiner', type: 'immediate' });
  } else if (l.includes('actively seek') || l.includes('actively look') || l.includes('job seeker')) {
    badges.push({ label: 'Actively Seeking', type: 'availability' });
  } else if (l.includes('available for') || l.includes('currently available')) {
    badges.push({ label: 'Available', type: 'availability' });
  }

  if (/\bfresher\b|fresh\s*graduate|recent\s*graduate/i.test(snippet)) {
    badges.push({ label: 'Fresher', type: 'fresher' });
  }

  return badges;
}
// ────────────────────────────────────────────────────────────────────────────


const CARD_FONT = { fontFamily: '"Plus Jakarta Sans","Segoe UI",sans-serif' };


const stageMeta = {
  DISCOVERED: { label: 'Discovered', className: 'bg-slate-800 text-slate-200 border-slate-700' },
  CONTACT_ENRICHED: { label: 'Contact Enriched', className: 'bg-[#432DD7]/25 text-[#E3DEFF] border-[#6B5AF0]/50' },
  SEQUENCED: { label: 'Sequenced', className: 'bg-teal-950/45 text-teal-200 border-teal-700/50' },
  CALL_QUEUED: { label: 'Call Queued', className: 'bg-amber-950/45 text-amber-200 border-amber-700/50' },
  SHORTLISTED: { label: 'Shortlisted', className: 'bg-emerald-950/45 text-emerald-200 border-emerald-700/50' },
};

const AI_SOURCE_STATE_KEY = 'hirextra_ai_source_state';

// ── Per-candidate inline Get Contact component ──────────────────────────────
function CandidateGetContact({ candidate, onSaveCandidate, onContactFound }) {
  const [loading, setLoading] = useState(false);
  const [contact, setContact] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const linkedInUrl = candidate.linkedinUrl || candidate.linkedInUrl;

  const handleClick = async () => {
    if (!linkedInUrl) return;
    setLoading(true);
    setNotFound(false);
    try {
      let candidateId = candidate.savedCandidateId;
      if (!candidateId) candidateId = await onSaveCandidate(candidate, { silent: true });
      if (!candidateId) { setNotFound(true); return; }
      const { data } = await api.get(`/enrich-contact/${candidateId}`);
      const enriched = data?.data;
      if (data?.success && (enriched?.email || enriched?.phone)) {
        setContact(enriched);
        onContactFound?.(linkedInUrl, enriched, candidateId);
      } else {
        setNotFound(true);
        const errMsg = enriched?.error || data?.error || 'No contact found for this candidate.';
        // Only toast config errors once; suppress repetitive "not found" toasts
        if (errMsg.toLowerCase().includes('not configured') || errMsg.toLowerCase().includes('api_key')) {
          toast.error('Enrichment API keys not configured. Check server .env', { id: 'enrich-config', duration: 5000 });
        } else {
          toast('No contact found.', { icon: '🔍', duration: 2000 });
        }
      }
    } catch (err) {
      setNotFound(true);
      const msg = err.response?.data?.error || err.response?.data?.message || 'Failed to fetch contact.';
      toast.error(msg, { id: 'enrich-err', duration: 4000 });
    } finally {
      setLoading(false);
    }
  };

  if (loading) return (
    <div className="ml-auto flex items-center gap-1.5 text-xs text-slate-400">
      <Loader2 size={13} className="animate-spin" />
      Looking up contact…
    </div>
  );

  if (contact && (contact.email || contact.phone)) return (
    <div className="ml-auto flex flex-wrap gap-x-3 gap-y-1">
      {contact.email && (
        <a href={`mailto:${contact.email}`} className="flex items-center gap-1 text-xs text-emerald-300 hover:text-emerald-200 break-all">
          <Mail size={11} className="shrink-0" />{contact.email}
        </a>
      )}
      {contact.phone && (
        <a href={`tel:${contact.phone}`} className="flex items-center gap-1 text-xs text-[#C4B8FF] hover:text-white">
          <Phone size={11} className="shrink-0" />{contact.phone}
        </a>
      )}
    </div>
  );

  if (notFound) return (
    <span className="ml-auto text-xs text-slate-500 italic">Not found</span>
  );

  return (
    <button
      onClick={handleClick}
      disabled={!linkedInUrl}
      className="ml-auto rounded-lg border border-indigo-700/50 bg-indigo-950/40 px-3 py-1.5 text-xs font-semibold text-indigo-200 hover:bg-indigo-900/50 disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed"
    >
      <Mail size={13} className="inline mr-1" />
      Get Contact
    </button>
  );
}

// ── Match category styling ────────────────────────────────────────────────────
const MATCH_CATEGORY_STYLE = {
  PERFECT:  { label: '100% Match', className: 'border-emerald-600/60 bg-emerald-950/40 text-emerald-300' },
  STRONG:   { label: '~80% Match', className: 'border-[#6B5AF0]/60 bg-[#432DD7]/20 text-[#B9AEFF]' },
  GOOD:     { label: '~60% Match', className: 'border-amber-600/50 bg-amber-950/30 text-amber-300' },
  PARTIAL:  { label: '~40% Match', className: 'border-slate-600/60 bg-slate-800/40 text-slate-400' },
  WEAK:     { label: 'Weak',       className: 'border-slate-700/50 bg-slate-800/30 text-slate-500' },
};

function MatchBadge({ score, category }) {
  const meta = MATCH_CATEGORY_STYLE[category] || MATCH_CATEGORY_STYLE.WEAK;
  if (score == null) return null;
  return (
    <span className={`shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full border ${meta.className}`}>
      {score}% · {meta.label}
    </span>
  );
}

function BucketSummary({ bucketCounts }) {
  if (!bucketCounts) return null;
  const items = [
    { key: 'perfect', label: '100%', color: 'text-emerald-400' },
    { key: 'strong',  label: '~80%', color: 'text-[#B9AEFF]' },
    { key: 'good',    label: '~60%', color: 'text-amber-400' },
    { key: 'partial', label: '~40%', color: 'text-slate-400' },
  ].filter(item => bucketCounts[item.key] > 0);
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {items.map(({ key, label, color }) => (
        <span key={key} className={`font-semibold ${color}`}>
          {bucketCounts[key]} {label}
        </span>
      ))}
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

export default function SourcingAgentModal({ isOpen = true, onClose = () => {}, inline = false }) {
  const [view, setView] = useState('compose'); // compose | sourcing | results
  const [composeStep, setComposeStep] = useState('input'); // input | parsed
  const [activeTab, setActiveTab] = useState('internet'); // internet | internal
  const [jobDescription, setJobDescription] = useState('');
  const [jdFile, setJdFile] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [searchingInternet, setSearchingInternet] = useState(false);
  const [searchingInternal, setSearchingInternal] = useState(false);
  const [bundle, setBundle] = useState(null);
  const [parsedDraft, setParsedDraft] = useState(null);
  const [internetData, setInternetData] = useState(null);
  const [internalData, setInternalData] = useState(null);
  const [error, setError] = useState('');
  const [savingCandidateUrl, setSavingCandidateUrl] = useState(null);
  const [savedCandidates, setSavedCandidates] = useState(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedCards, setExpandedCards] = useState(new Set());
  const toggleCard = (key) => setExpandedCards((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  // Active tab data helpers
  const activeData = activeTab === 'internet' ? internetData : internalData;
  const sourcing = searchingInternet || searchingInternal;

  const parsedRequirements = parsedDraft || bundle?.parsedRequirements || activeData?.parsedRequirements || null;
  const canExtractRequirements = Boolean(jobDescription.trim()) || Boolean(jdFile);
  const hasParsedDraft = Boolean(parsedDraft);
  const candidates = useMemo(
    () => activeData?.candidates || activeData?.results || [],
    [activeData]
  );
  const parseOnly = Boolean(activeData?.parseOnly);

  const CANDIDATES_PER_PAGE = 10;
  const totalPages = Math.max(1, Math.ceil(candidates.length / CANDIDATES_PER_PAGE));
  const pageCandidates = candidates.slice(
    (currentPage - 1) * CANDIDATES_PER_PAGE,
    currentPage * CANDIDATES_PER_PAGE
  );

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
      if (parsed?.activeTab) setActiveTab(parsed.activeTab);
      if (typeof parsed?.jobDescription === 'string') setJobDescription(parsed.jobDescription);
      if (parsed?.bundle) setBundle(parsed.bundle);
      if (parsed?.parsedDraft) setParsedDraft(parsed.parsedDraft);
      if (parsed?.internetData) setInternetData(parsed.internetData);
      if (parsed?.internalData) setInternalData(parsed.internalData);
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
        activeTab,
        jobDescription,
        bundle,
        parsedDraft,
        internetData,
        internalData,
        savedCandidates: Array.from(savedCandidates),
      };
      localStorage.setItem(AI_SOURCE_STATE_KEY, JSON.stringify(snapshot));
    } catch {
      // Ignore persistence errors
    }
  }, [view, composeStep, activeTab, jobDescription, bundle, parsedDraft, internetData, internalData, savedCandidates]);

  const handleClose = () => {
    setView('compose');
    setJobDescription('');
    setJdFile(null);
    setComposeStep('input');
    setActiveTab('internet');
    setExtracting(false);
    setSearchingInternet(false);
    setSearchingInternal(false);
    setBundle(null);
    setParsedDraft(null);
    setInternetData(null);
    setInternalData(null);
    setError('');
    setSavedCandidates(new Set());
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
    if (!jobDescription.trim() && !jdFile) {
      setError('Enter job description or upload a file to extract requirements.');
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

  // ── Internet sourcing (Google CSE → LinkedIn profiles) ───────────────────
  const handleSearchInternet = async () => {
    setError('');
    if (!parsedRequirements) { setError('Extract requirements first.'); return; }
    setSearchingInternet(true);
    setActiveTab('internet');
    setView('sourcing');
    try {
      const { data } = await api.post('/ai-source', {
        jobDescription: jobDescription.trim() || undefined,
        parsedRequirements,
        maxCandidates: 60,
        maxQueries: 6,
        resultsPerCountry: 10,
        enrichContacts: false,
        enrichTopN: 0,
        autoSave: false,
      });
      setInternetData(data);
      setCurrentPage(1);
      const preSaved = new Set(
        (data?.candidates || [])
          .filter((c) => c.savedToDatabase && (c.linkedinUrl || c.linkedInUrl))
          .map((c) => c.linkedinUrl || c.linkedInUrl)
      );
      setSavedCandidates(preSaved);
      setView('results');
      // Background-save all internet candidates so Get Contact is instant
      const toSave = (data?.candidates || []).filter(
        (c) => !c.savedCandidateId && (c.linkedinUrl || c.linkedInUrl)
      );
      if (toSave.length > 0) {
        (async () => {
          const BATCH = 4;
          for (let i = 0; i < toSave.length; i += BATCH) {
            const batch = toSave.slice(i, i + BATCH);
            await Promise.allSettled(
              batch.map(async (c) => {
                try {
                  const { data: saved } = await api.post('/ai-source/save-candidate', c);
                  if (saved?.success) {
                    const savedId = saved?.candidateId || saved?.candidate?._id;
                    const url = c.linkedinUrl || c.linkedInUrl;
                    if (savedId && url) {
                      setInternetData((prev) => {
                        if (!prev) return prev;
                        const next = (prev.candidates || prev.results || []).map((row) =>
                          (row.linkedinUrl || row.linkedInUrl) === url
                            ? { ...row, savedCandidateId: savedId, savedToDatabase: true }
                            : row
                        );
                        return { ...prev, candidates: next, results: next };
                      });
                    }
                  }
                } catch { /* ignore */ }
              })
            );
          }
        })();
      }
      if (data?.parseOnly) {
        toast('Requirements parsed. Add SERPER_API_KEY to enable candidate discovery.', { icon: 'ℹ️' });
      } else {
        toast.success(`Internet search complete. ${data?.summary?.totalExtracted || 0} candidates found.`);
      }
    } catch (err) {
      const message = err.response?.data?.error || 'Failed to source candidates from internet.';
      setError(message);
      setView('compose');
      toast.error(message);
    } finally {
      setSearchingInternet(false);
    }
  };

  // ── Internal DB sourcing (Boolean match scoring against MongoDB) ───────────
  const handleSearchInternalDb = async () => {
    setError('');
    if (!parsedRequirements) { setError('Extract requirements first.'); return; }
    setSearchingInternal(true);
    setActiveTab('internal');
    setView('sourcing');
    try {
      const { data } = await api.post('/ai-source/internal-db', {
        jobDescription: jobDescription.trim() || undefined,
        parsedRequirements,
        maxResults: 100,
        minScore: 30,
        includeWeak: false,
      });
      setInternalData(data);
      setCurrentPage(1);
      setView('results');
      toast.success(`Internal DB search complete. ${data?.totalReturned || 0} candidates matched.`);
    } catch (err) {
      const message = err.response?.data?.error || 'Failed to search internal database.';
      setError(message);
      setView('compose');
      toast.error(message);
    } finally {
      setSearchingInternal(false);
    }
  };

  const handleSaveCandidate = async (candidate, { silent = false } = {}) => {
    const linkedInUrl = candidate.linkedinUrl || candidate.linkedInUrl;
    if (!linkedInUrl) return null;

    setSavingCandidateUrl(linkedInUrl);
    try {
      const { data } = await api.post('/ai-source/save-candidate', candidate);
      if (data?.success) {
        const savedId = data?.candidateId || data?.candidate?._id || null;
        setSavedCandidates((prev) => new Set([...prev, linkedInUrl]));
        // Update whichever dataset the candidate belongs to
        const updater = (prev) => {
          if (!prev) return prev;
          const nextCandidates = (prev.candidates || prev.results || []).map((row) => {
            const rowLinkedin = row.linkedinUrl || row.linkedInUrl;
            if (rowLinkedin !== linkedInUrl) return row;
            return { ...row, savedToDatabase: true, savedCandidateId: savedId || row.savedCandidateId || null };
          });
          return { ...prev, candidates: nextCandidates, results: nextCandidates };
        };
        setInternetData(updater);
        setInternalData(updater);
        if (!silent) toast.success(`${candidate.name || candidate.fullName || 'Candidate'} saved.`);
        return savedId;
      } else {
        if (!silent) toast.error(data?.error || 'Could not save candidate.');
        return null;
      }
    } catch (err) {
      if (!silent) toast.error(err.response?.data?.error || 'Failed to save candidate');
      return null;
    } finally {
      setSavingCandidateUrl(null);
    }
  };

  const handleExportCSV = () => {
    if (!candidates.length) return;
    const escape = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const headers = ['Name', 'Job Title', 'Company', 'Location', 'Skills', 'Education', 'Total Experience', 'LinkedIn URL', 'Email', 'Phone', 'Source Country', 'Pipeline Stage'];
    const rows = candidates.map((c) => [
      escape(c.name),
      escape(c.jobTitle || c.title),
      escape(c.company),
      escape(c.location),
      escape(Array.isArray(c.skills) ? c.skills.join(', ') : (c.skills || '')),
      escape(c.education),
      escape(c.totalExperience),
      escape(c.linkedInUrl || c.linkedinUrl),
      escape(c.email),
      escape(c.phone),
      escape(c.sourceCountry),
      escape(c.pipelineStage),
    ].join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `sourced-candidates-${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    toast.success('CSV downloaded.');
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
                  ) : (internetData || internalData) ? (
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

                  <div className="mt-6 flex flex-col sm:flex-row justify-center gap-3">
                    {/* Internet sourcing — Google CSE / LinkedIn */}
                    <button
                      onClick={handleSearchInternet}
                      disabled={searchingInternet || searchingInternal || extracting || !parsedRequirements}
                      className="flex-1 max-w-xs rounded-xl bg-[#432DD7] hover:bg-[#5A45E5] disabled:opacity-60 text-white px-5 py-3 text-sm font-semibold transition-colors inline-flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                    >
                      {searchingInternet
                        ? <><Loader2 size={15} className="animate-spin" /> Searching Internet…</>
                        : <><Globe size={15} /> Search Internet</>
                      }
                    </button>
                    {/* Internal DB sourcing — Boolean match scoring */}
                    <button
                      onClick={handleSearchInternalDb}
                      disabled={searchingInternet || searchingInternal || extracting || !parsedRequirements}
                      className="flex-1 max-w-xs rounded-xl border border-[#6B5AF0]/60 bg-[#432DD7]/15 hover:bg-[#432DD7]/30 disabled:opacity-60 text-[#C4B8FF] px-5 py-3 text-sm font-semibold transition-colors inline-flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                    >
                      {searchingInternal
                        ? <><Loader2 size={15} className="animate-spin" /> Searching DB…</>
                        : <><Database size={15} /> Search Internal DB</>
                      }
                    </button>
                  </div>

                </div>
              )}
            </div>
          )}

          {view === 'sourcing' && (
            <div className="py-20 text-center">
              <Loader2 size={44} className="animate-spin mx-auto text-[#A99BFF]" />
              {searchingInternet ? (
                <>
                  <p className="mt-4 text-lg font-semibold text-slate-100">Searching Internet</p>
                  <p className="text-sm text-slate-400 mt-1">Generating LinkedIn queries and extracting profiles across countries.</p>
                </>
              ) : (
                <>
                  <p className="mt-4 text-lg font-semibold text-slate-100">Searching Internal Database</p>
                  <p className="text-sm text-slate-400 mt-1">Scoring candidates with Boolean match logic against your requirements.</p>
                </>
              )}
            </div>
          )}

          {view === 'results' && (
            <div className="space-y-5">
              {/* Top bar: Back + Source tabs */}
              <div className="flex items-center justify-between gap-3 px-1 flex-wrap">
                <button
                  onClick={() => setView('compose')}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-800 border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-all hover:border-slate-600 shadow-sm cursor-pointer"
                >
                  <ChevronLeft size={16} />
                  Back
                </button>

                {/* Source tabs */}
                <div className="flex items-center rounded-xl border border-slate-700 bg-slate-900/70 p-1 gap-1">
                  <button
                    onClick={() => { setActiveTab('internet'); setCurrentPage(1); }}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                      activeTab === 'internet'
                        ? 'bg-[#432DD7] text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Globe size={13} />
                    Internet
                    {internetData && (
                      <span className="ml-1 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px]">
                        {(internetData.candidates || internetData.results || []).length}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => { setActiveTab('internal'); setCurrentPage(1); }}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                      activeTab === 'internal'
                        ? 'bg-[#432DD7] text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Database size={13} />
                    Internal DB
                    {internalData && (
                      <span className="ml-1 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px]">
                        {internalData.totalReturned || 0}
                      </span>
                    )}
                  </button>
                </div>

                <p className="text-sm font-semibold text-slate-300">{candidates.length} candidates</p>
              </div>

              {/* Bucket summary bar */}
              {activeData?.bucketCounts && (
                <div className="flex items-center gap-3 rounded-xl border border-slate-700/60 bg-slate-900/50 px-4 py-2.5">
                  <span className="text-xs text-slate-500 font-medium uppercase tracking-wide shrink-0">Match</span>
                  <BucketSummary bucketCounts={activeData.bucketCounts} />
                </div>
              )}

              {parseOnly && (
                <div className="rounded-xl border border-amber-700/50 bg-amber-950/30 p-3 text-sm text-amber-200">
                  Candidate discovery is paused because `GOOGLE_CSE_API_KEY` is missing. Requirement extraction is complete.
                </div>
              )}

              {!parseOnly && candidates.length > 0 && (
                <div className="space-y-3">
                  {pageCandidates.map((candidate, index) => {
                    const linkedInUrl = candidate.linkedinUrl || candidate.linkedInUrl;
                    const globalIndex = (currentPage - 1) * CANDIDATES_PER_PAGE + index + 1;
                    // Prefer server-extracted skills (AI); fall back to client-side regex
                    const skills = (candidate.skills?.length > 0)
                      ? candidate.skills
                      : extractSkillsFromSnippet(candidate.snippet, candidate.title || candidate.jobTitle);
                    // Prefer server-extracted education (AI); fall back to client-side snippet parse
                    const education = candidate.education || extractEducationFromSnippet(candidate.snippet);
                    const totalExperience = candidate.totalExperience || null;
                    const badges = extractBadgesFromSnippet(candidate.snippet);
                    return (
                      <div key={`${linkedInUrl || candidate.name || 'candidate'}-${index}`} className="rounded-2xl border border-slate-700 bg-slate-900/80 p-4 transition-all duration-200 hover:border-[#6B5AF0]/70 hover:shadow-[0_0_0_1px_rgba(67,45,215,0.22)]">

                        {/* Row 1: Rank + Name + Badges + Match Badge */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-2.5 min-w-0 flex-1">
                            <span className="shrink-0 mt-0.5 w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[11px] font-bold text-slate-400">
                              {globalIndex}
                            </span>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <h4 className="text-base font-bold text-slate-100 leading-tight">
                                  {candidate.name || candidate.fullName || 'Unknown'}
                                </h4>
                                {badges.map((b) => (
                                  <span key={b.label} className={`inline-flex items-center text-[10px] rounded-full border px-2 py-0.5 font-semibold ${
                                    b.type === 'immediate'    ? 'border-sky-700/50 bg-sky-950/35 text-sky-300' :
                                    b.type === 'availability' ? 'border-emerald-700/50 bg-emerald-950/35 text-emerald-300' :
                                    b.type === 'fresher'      ? 'border-blue-700/40 bg-blue-950/30 text-blue-300' :
                                                                 'border-slate-600 bg-slate-800 text-slate-300'
                                  }`}>
                                    {b.label}
                                  </span>
                                ))}
                                {candidate.level && (
                                  <span className="inline-flex items-center text-[10px] rounded-full border border-amber-700/40 bg-amber-950/30 text-amber-300 px-2 py-0.5 font-semibold capitalize">
                                    {candidate.level}
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                                <span className="flex items-center gap-1 text-sm text-slate-200 font-medium">
                                  <Briefcase size={11} className="text-[#8B7FE8] shrink-0" />
                                  {candidate.title || candidate.jobTitle || 'Unknown role'}
                                </span>
                                {candidate.company && (
                                  <span className="flex items-center gap-1 text-sm text-slate-400">
                                    <Building2 size={11} className="text-slate-500 shrink-0" />
                                    {candidate.company}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <MatchBadge score={candidate.matchScore} category={candidate.matchCategory} />
                        </div>

                        {/* Row 2: Location · Experience · Education */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 ml-8.5 text-xs text-slate-400">
                          {candidate.location && (
                            <span className="flex items-center gap-1">
                              <MapPin size={11} className="text-slate-500" />
                              {candidate.location}
                            </span>
                          )}
                          {totalExperience && (
                            <span className="flex items-center gap-1">
                              <Clock size={11} className="text-slate-500" />
                              {totalExperience}
                            </span>
                          )}
                          {education && (
                            isPremiumInstitute(education) ? (
                              <span className="inline-flex items-center gap-1 text-[10px] rounded-full border border-amber-600/50 bg-amber-950/40 text-amber-300 px-2 py-0.5 font-bold">
                                <GraduationCap size={10} />
                                {education}
                              </span>
                            ) : (
                              <span className="flex items-center gap-1">
                                <GraduationCap size={11} />
                                {education}
                              </span>
                            )
                          )}
                        </div>

                        {/* Skills */}
                        {skills.length > 0 && (
                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            {skills.map((skill) => {
                              const isMatched = candidate.matchedSkills?.some(
                                (m) => m.toLowerCase() === skill.toLowerCase()
                              );
                              const isMissing = candidate.missingSkills?.some(
                                (m) => m.toLowerCase() === skill.toLowerCase()
                              );
                              return (
                                <span key={skill} className={`text-[11px] rounded-md border px-2 py-0.5 ${
                                  isMatched ? 'border-emerald-600/50 bg-emerald-950/30 text-emerald-300' :
                                  isMissing ? 'border-red-700/40 bg-red-950/20 text-red-400' :
                                  'border-[#6B5AF0]/40 bg-[#432DD7]/15 text-[#C4B8FF]'
                                }`}>
                                  {skill}
                                </span>
                              );
                            })}
                          </div>
                        )}
                        {/* Missing required skills (shown only when scorer data is present) */}
                        {candidate.missingSkills?.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {candidate.missingSkills.map((skill) => (
                              <span key={skill} className="text-[10px] rounded-md border border-red-700/40 bg-red-950/20 text-red-400 px-2 py-0.5 italic">
                                missing: {skill}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Full profile — expandable */}
                        {(candidate.about || candidate.languages?.length > 0) && (() => {
                          const cardKey = linkedInUrl || candidate.name;
                          const isExpanded = expandedCards.has(cardKey);
                          const aboutText = candidate.about || null;
                          return (
                            <div className="mt-2.5">
                              <button
                                onClick={() => toggleCard(cardKey)}
                                className="flex items-center gap-1 text-[11px] text-[#9B8FEF] hover:text-[#C4B8FF] font-medium cursor-pointer"
                              >
                                <ChevronDown size={13} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                {isExpanded ? 'Hide full profile' : 'View full profile'}
                              </button>
                              {isExpanded && (
                                <div className="mt-2 space-y-3 border-t border-slate-700/40 pt-2.5 text-xs text-slate-300">
                                  {/* About / Snippet */}
                                  {aboutText && (
                                    <div>
                                      <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">About</p>
                                      <p className="text-slate-400 leading-relaxed whitespace-pre-line">{aboutText}</p>
                                    </div>
                                  )}
                                  {/* Languages */}
                                  {candidate.languages?.length > 0 && (
                                    <div>
                                      <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">Languages</p>
                                      <div className="flex flex-wrap gap-1.5">
                                        {candidate.languages.map((lang, i) => (
                                          <span key={i} className="text-[11px] rounded-md border border-slate-600 bg-slate-800 text-slate-300 px-2 py-0.5">{lang}</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* Footer: LinkedIn | contact (fetched) or Get Contact button */}
                        <div className="mt-3 border-t border-slate-700/50 pt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                          {linkedInUrl ? (
                            <a href={linkedInUrl} target="_blank" rel="noreferrer" className="text-xs text-[#B9AEFF] hover:text-white hover:underline font-medium shrink-0">
                              🔗 View LinkedIn
                            </a>
                          ) : (
                            <span className="text-xs text-slate-600">No profile URL</span>
                          )}
                          {/* Separator dot */}
                          {linkedInUrl && <span className="text-slate-600 text-xs">·</span>}
                          {/* If contact already fetched, show inline; otherwise show Get Contact button */}
                          {candidate.email || candidate.phone ? (
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              {candidate.email && (
                                <a href={`mailto:${candidate.email}`} className="flex items-center gap-1 text-xs text-emerald-300 hover:text-emerald-200 min-w-0">
                                  <Mail size={11} className="shrink-0" />
                                  <span className="truncate max-w-55">{candidate.email}</span>
                                </a>
                              )}
                              {candidate.phone && (
                                <a href={`tel:${candidate.phone}`} className="flex items-center gap-1 text-xs text-emerald-300 hover:text-emerald-200 shrink-0">
                                  <Phone size={11} />{candidate.phone}
                                </a>
                              )}
                            </div>
                          ) : (
                            <CandidateGetContact
                              candidate={candidate}
                              onSaveCandidate={handleSaveCandidate}
                              onContactFound={(linkedInUrl, enriched, candidateId) => {
                                const updater = (prev) => {
                                  if (!prev) return prev;
                                  const nextCandidates = (prev.candidates || prev.results || []).map((row) => {
                                    if ((row.linkedinUrl || row.linkedInUrl) !== linkedInUrl) return row;
                                    return { ...row, savedCandidateId: candidateId, savedToDatabase: true, email: enriched.email || null, phone: enriched.phone || null };
                                  });
                                  return { ...prev, candidates: nextCandidates, results: nextCandidates };
                                };
                                setInternetData(updater);
                                setInternalData(updater);
                              }}
                            />
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

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2">
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <ChevronLeft size={15} />
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                    .reduce((acc, p, idx, arr) => {
                      if (idx > 0 && p - arr[idx - 1] > 1) acc.push('…');
                      acc.push(p);
                      return acc;
                    }, [])
                    .map((item, idx) =>
                      item === '…' ? (
                        <span key={`ellipsis-${idx}`} className="px-1 text-slate-500 text-sm">…</span>
                      ) : (
                        <button
                          key={item}
                          onClick={() => setCurrentPage(item)}
                          className={`min-w-[32px] rounded-lg border px-2.5 py-1.5 text-sm font-semibold cursor-pointer transition-colors ${
                            currentPage === item
                              ? 'border-[#6B5AF0] bg-[#432DD7] text-white'
                              : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                          }`}
                        >
                          {item}
                        </button>
                      )
                    )}
                  <button
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <ChevronRight size={15} />
                  </button>
                  <span className="text-xs text-slate-500 ml-1">Page {currentPage} of {totalPages}</span>
                </div>
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


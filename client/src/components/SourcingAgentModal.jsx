import { useMemo, useState } from 'react';
import {
  X,
  Loader2,
  AlertCircle,
  Check,
  Save,
  Download,
  Search,
  Mail,
  Phone,
  Globe2,
  FileSearch,
} from 'lucide-react';
import api from '../api/axios';
import toast from 'react-hot-toast';

const StatCard = ({ label, value, icon: Icon, color }) => {
  const colors = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800/50 text-blue-800 dark:text-blue-300',
    green:
      'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/50 text-emerald-800 dark:text-emerald-300',
    amber:
      'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-300',
    slate:
      'bg-slate-50 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-300',
  };

  return (
    <div className={`p-4 rounded-lg border ${colors[color]}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon size={16} className="opacity-70" />
        <span className="text-xs uppercase tracking-wider opacity-80 font-semibold">{label}</span>
      </div>
      <div className="text-2xl font-bold text-slate-900 dark:text-white">{value}</div>
    </div>
  );
};

export default function SourcingAgentModal({ isOpen, onClose }) {
  const [step, setStep] = useState('input'); // input | processing | results
  const [jobDescription, setJobDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [responseData, setResponseData] = useState(null);
  const [error, setError] = useState(null);
  const [savingCandidateUrl, setSavingCandidateUrl] = useState(null);
  const [savedCandidates, setSavedCandidates] = useState(new Set());

  const candidates = useMemo(
    () => responseData?.candidates || responseData?.results || [],
    [responseData]
  );
  const parsedRequirements = responseData?.parsedRequirements || {};
  const parseOnly = Boolean(responseData?.parseOnly);
  const summary = responseData?.summary || {};

  const handleStartSourcing = async (e) => {
    e.preventDefault();
    setError(null);

    if (jobDescription.trim().length < 20) {
      setError('Job description must be at least 20 characters');
      return;
    }

    setLoading(true);
    setStep('processing');

    try {
      const { data } = await api.post('/ai-source', {
        jobDescription: jobDescription.trim(),
        maxCandidates: 50,
        maxQueries: 6,
        resultsPerCountry: 3,
        enrichContacts: true,
        enrichTopN: 15,
        autoSave: true,
      });

      setResponseData(data);
      const preSaved = new Set(
        (data?.candidates || [])
          .filter((c) => c.savedToDatabase && (c.linkedinUrl || c.linkedInUrl))
          .map((c) => c.linkedinUrl || c.linkedInUrl)
      );
      setSavedCandidates(preSaved);
      setStep('results');

      if (data?.parseOnly) {
        toast('JD parsed. Add GOOGLE_CSE_API_KEY to enable candidate discovery.', { icon: 'i' });
      } else {
        toast.success(`Sourcing complete. ${data?.summary?.totalExtracted || 0} candidates found.`);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to source candidates. Please try again.');
      setStep('input');
      toast.error(err.response?.data?.error || 'Failed to source candidates. Please try again.');
    } finally {
      setLoading(false);
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

  const handleExportCSV = async () => {
    if (!candidates.length) return;

    try {
      toast.loading('Generating CSV...', { id: 'csv-export' });
      const response = await api.post(
        '/ai-source/export/csv',
        { candidates },
        { responseType: 'blob' }
      );

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
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to export CSV', { id: 'csv-export' });
    }
  };

  const handleClose = () => {
    setStep('input');
    setJobDescription('');
    setResponseData(null);
    setError(null);
    setSavedCandidates(new Set());
    setLoading(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-y-auto border border-slate-200 dark:border-slate-800">
        <div className="sticky top-0 bg-gradient-to-r from-indigo-600 to-blue-600 text-white p-6 flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold">AI Candidate Sourcing</h2>
            <p className="text-indigo-100 text-sm mt-1">
              Parse JD, generate queries, discover profiles, enrich contacts, and save automatically.
            </p>
          </div>
          <button onClick={handleClose} className="p-2 hover:bg-indigo-500 rounded-lg transition-all duration-200">
            <X size={24} />
          </button>
        </div>

        <div className="p-6">
          {step === 'input' && (
            <form onSubmit={handleStartSourcing} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
                  Job Description
                </label>
                <textarea
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                  placeholder="Paste complete JD including title, must-have skills, experience, and location."
                  className="w-full h-48 p-4 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none transition-all duration-200"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                  Minimum 20 characters. Better JD quality improves sourcing quality.
                </p>
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-lg">
                  <AlertCircle size={20} className="text-red-600 dark:text-red-400 flex-shrink-0" />
                  <p className="text-red-700 dark:text-red-200 text-sm">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={jobDescription.trim().length < 20 || loading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white font-semibold py-3 rounded-lg transition-all duration-200 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" /> Sourcing...
                  </>
                ) : (
                  <>
                    <Search size={18} /> Find Candidates
                  </>
                )}
              </button>
            </form>
          )}

          {step === 'processing' && (
            <div className="flex flex-col items-center justify-center py-14 space-y-4">
              <Loader2 size={48} className="text-indigo-600 dark:text-indigo-400 animate-spin" />
              <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">AI sourcing in progress</p>
              <p className="text-sm text-slate-500 dark:text-slate-400 text-center">
                Parsing JD, generating Boolean queries, searching CSE, extracting profiles, and enriching contacts.
              </p>
            </div>
          )}

          {step === 'results' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Extracted" value={summary.totalExtracted || 0} icon={Search} color="blue" />
                <StatCard label="With Contact" value={summary.totalEnriched || 0} icon={Mail} color="green" />
                <StatCard label="Saved to DB" value={summary.totalSaved || 0} icon={Save} color="amber" />
                <StatCard label="Countries" value={summary.countriesSearched || 0} icon={Globe2} color="slate" />
              </div>

              <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-slate-50 dark:bg-slate-800/50">
                <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2 flex items-center gap-2">
                  <FileSearch size={16} />
                  Parsed Requirements
                </h3>
                <div className="grid sm:grid-cols-2 gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <p>
                    <span className="font-semibold">Job Title:</span> {parsedRequirements.jobTitle || '-'}
                  </p>
                  <p>
                    <span className="font-semibold">Experience:</span>{' '}
                    {parsedRequirements.experienceLevel || '-'} ({parsedRequirements.experienceYears || 0}+ yrs)
                  </p>
                  <p>
                    <span className="font-semibold">Location:</span> {parsedRequirements.location || '-'}
                  </p>
                  <p>
                    <span className="font-semibold">Remote:</span> {parsedRequirements.remote ? 'Yes' : 'No'}
                  </p>
                  <p className="sm:col-span-2">
                    <span className="font-semibold">Must-have skills:</span>{' '}
                    {Array.isArray(parsedRequirements.mustHaveSkills) &&
                    parsedRequirements.mustHaveSkills.length > 0
                      ? parsedRequirements.mustHaveSkills.join(', ')
                      : '-'}
                  </p>
                </div>
              </div>

              {parseOnly && (
                <div className="p-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 text-sm">
                  Candidate discovery is paused because `GOOGLE_CSE_API_KEY` is not configured. JD parsing and query planning are complete.
                </div>
              )}

              {!parseOnly && candidates.length > 0 && (
                <div className="space-y-3">
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                    {candidates.length} Candidates
                  </h3>
                  {candidates.map((candidate, index) => {
                    const linkedInUrl = candidate.linkedinUrl || candidate.linkedInUrl;
                    const isSaved = savedCandidates.has(linkedInUrl) || candidate.savedToDatabase;
                    const isSaving = savingCandidateUrl === linkedInUrl;

                    return (
                      <div
                        key={`${linkedInUrl || candidate.name || 'candidate'}-${index}`}
                        className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-slate-50 dark:bg-slate-800/50"
                      >
                        <div className="flex flex-col md:flex-row md:justify-between gap-2 mb-2">
                          <div>
                            <h4 className="font-semibold text-slate-900 dark:text-slate-100">
                              {candidate.name || candidate.fullName || 'Unknown'}
                            </h4>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                              {(candidate.title || candidate.jobTitle || 'Unknown role')}
                              {candidate.company ? ` @ ${candidate.company}` : ''}
                            </p>
                          </div>
                          <div className="text-sm text-slate-600 dark:text-slate-300">
                            {candidate.location || 'Location N/A'}
                            {candidate.sourceCountry ? ` • ${candidate.sourceCountry.toUpperCase()}` : ''}
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-4 text-sm mb-3">
                          {candidate.email && (
                            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                              <Mail size={14} /> {candidate.email}
                            </span>
                          )}
                          {candidate.phone && (
                            <span className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-400">
                              <Phone size={14} /> {candidate.phone}
                            </span>
                          )}
                        </div>

                        <div className="flex gap-2 items-center">
                          {linkedInUrl ? (
                            <a
                              href={linkedInUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
                            >
                              View LinkedIn
                            </a>
                          ) : (
                            <span className="text-sm text-slate-500">LinkedIn unavailable</span>
                          )}

                          <button
                            onClick={() => handleSaveCandidate(candidate)}
                            disabled={isSaving || isSaved || !linkedInUrl}
                            className={`ml-auto flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition-all duration-200 ${
                              isSaved
                                ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                                : 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-900/50'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                          >
                            {isSaving ? (
                              <>
                                <Loader2 size={16} className="animate-spin" /> Saving...
                              </>
                            ) : isSaved ? (
                              <>
                                <Check size={16} /> Saved
                              </>
                            ) : (
                              <>
                                <Save size={16} /> Save to DB
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {!parseOnly && candidates.length === 0 && (
                <div className="py-6 text-center text-slate-600 dark:text-slate-400">
                  No candidates found for the provided JD.
                </div>
              )}

              <div className="flex gap-3 mt-6 pt-6 border-t border-slate-200 dark:border-slate-700">
                <button
                  onClick={() => setStep('input')}
                  className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-all duration-200"
                >
                  Search Again
                </button>
                <button
                  onClick={handleExportCSV}
                  disabled={!candidates.length}
                  className="flex-1 px-4 py-2 border border-emerald-300 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-300 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Download size={16} />
                  Export CSV
                </button>
                <button
                  onClick={handleClose}
                  className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-all duration-200"
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

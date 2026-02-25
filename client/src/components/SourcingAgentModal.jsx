import { useState } from 'react';
import { X, Loader2, AlertCircle, Check, Save, Download } from 'lucide-react';
import axios from '../api/axios';

/**
 * AI Sourcing Modal Component
 * Allows users to input a job description and get candidate sourcing results
 */

export default function SourcingAgentModal({ isOpen, onClose }) {
  const [step, setStep] = useState('input'); // input, processing, results
  const [jobDescription, setJobDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [metadata, setMetadata] = useState(null);
  const [error, setError] = useState(null);
  const [savingCandidateId, setSavingCandidateId] = useState(null);
  const [savedCandidates, setSavedCandidates] = useState(new Set());

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
      const response = await axios.post('/api/ai-source', {
        jobDescription: jobDescription.trim(),
        maxCandidates: 50,
        enrichContacts: true,
      });

      setCandidates(response.data.candidates || []);
      setMetadata(response.data.metadata);
      setStep('results');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to source candidates. Please try again.');
      setStep('input');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCandidate = async (candidate, index) => {
    setSavingCandidateId(index);

    try {
      await axios.post('/api/ai-source/save-candidate', {
        name: candidate.name,
        linkedInUrl: candidate.linkedInUrl,
        jobTitle: candidate.jobTitle,
        company: candidate.company,
        location: candidate.snippet.substring(0, 100),
        contact: candidate.contact,
      });

      setSavedCandidates((prev) => new Set([...prev, candidate.linkedInUrl]));
    } catch (err) {
      if (err.response?.status === 409) {
        setError('This candidate already exists in your database');
      } else {
        setError(err.response?.data?.error || 'Failed to save candidate');
      }
    } finally {
      setSavingCandidateId(null);
    }
  };

  const handleExportCSV = async () => {
    try {
      // Send candidates to backend for CSV conversion
      const response = await axios.post('/api/ai-source/export/csv', {
        candidates: candidates.map((c) => ({
          name: c.name,
          linkedInUrl: c.linkedInUrl,
          jobTitle: c.jobTitle,
          company: c.company,
          level: c.level,
          email: c.contact?.email || null,
          phone: c.contact?.phone || null,
          foundIn: c.sources?.[0]?.country || 'Unknown',
          snippet: c.snippet,
          enrichmentMetadata: c.contact ? { source: c.contact.source, confidence: c.contact.confidence } : null,
        })),
      });

      // Create blob and download
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `sourced-candidates-${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to export CSV');
    }
  };

  const handleClose = () => {
    setStep('input');
    setJobDescription('');
    setCandidates([]);
    setMetadata(null);
    setError(null);
    setSavedCandidates(new Set());
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto border border-slate-200 dark:border-slate-800">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-indigo-600 to-blue-600 dark:from-indigo-700 dark:to-blue-700 text-white p-6 flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold">🤖 AI Candidate Sourcing</h2>
            <p className="text-indigo-100 text-sm mt-1">
              Paste a job description and let AI find matching candidates
            </p>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-indigo-500 rounded-lg transition-all duration-200"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Step 1: Input */}
          {step === 'input' && (
            <div className="space-y-4">
              <form onSubmit={handleStartSourcing}>
                {/* Job Description Textarea */}
                <div>
                  <label className="block text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
                    Job Description
                  </label>
                  <textarea
                    value={jobDescription}
                    onChange={(e) => setJobDescription(e.target.value)}
                    placeholder="Paste the complete job description here...
                    Include job title, required skills, experience level, location, and any other relevant details."
                    className="w-full h-48 p-4 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none transition-all duration-200"
                  />
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                    Minimum 20 characters • The more detailed, the better the results
                  </p>
                </div>

                {/* Error Display */}
                {error && (
                  <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-lg">
                    <AlertCircle size={20} className="text-red-600 dark:text-red-400 flex-shrink-0" />
                    <p className="text-red-700 dark:text-red-200 text-sm">{error}</p>
                  </div>
                )}

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={jobDescription.trim().length < 20}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white font-semibold py-3 rounded-lg transition-all duration-200 disabled:cursor-not-allowed"
                >
                  🔍 Find Candidates
                </button>

                {/* Info */}
                <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg border border-indigo-200 dark:border-indigo-800/50">
                  <p className="text-sm text-slate-900 dark:text-slate-100 font-semibold">
                    How it works:
                  </p>
                  <ul className="text-sm text-slate-700 dark:text-slate-300 mt-2 space-y-1">
                    <li>✓ AI parses your job description</li>
                    <li>✓ Generates LinkedIn search queries</li>
                    <li>✓ Searches across 50+ countries</li>
                    <li>✓ Extracts & enriches candidates with contact info</li>
                  </ul>
                </div>
              </form>
            </div>
          )}

          {/* Step 2: Processing */}
          {step === 'processing' && (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <Loader2 size={48} className="text-indigo-600 dark:text-indigo-400 animate-spin" />
              <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">Finding candidates...</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Parsing JD • Generating queries • Searching globally • Enriching contacts
              </p>
            </div>
          )}

          {/* Step 3: Results */}
          {step === 'results' && (
            <div className="space-y-4">
              {/* Metadata */}
              {metadata && (
                <div className="grid grid-cols-4 gap-4">
                  <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg border border-indigo-200 dark:border-indigo-800/50">
                    <p className="text-xs text-slate-600 dark:text-slate-400">Job Title</p>
                    <p className="font-semibold text-slate-900 dark:text-slate-100 mt-1">{metadata.jobTitle}</p>
                  </div>
                  <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800/50">
                    <p className="text-xs text-slate-600 dark:text-slate-400">Candidates Found</p>
                    <p className="font-semibold text-slate-900 dark:text-slate-100 mt-1">{metadata.totalExtracted}</p>
                  </div>
                  <div className="p-4 bg-violet-50 dark:bg-violet-900/20 rounded-lg border border-violet-200 dark:border-violet-800/50">
                    <p className="text-xs text-slate-600 dark:text-slate-400">Contacts Enriched</p>
                    <p className="font-semibold text-slate-900 dark:text-slate-100 mt-1">{metadata.contactsEnriched}</p>
                  </div>
                  <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800/50">
                    <p className="text-xs text-slate-600 dark:text-slate-400">Time Taken</p>
                    <p className="font-semibold text-slate-900 dark:text-slate-100 mt-1">
                      {(metadata.timeMs / 1000).toFixed(1)}s
                    </p>
                  </div>
                </div>
              )}

              {/* Candidates List */}
              {candidates.length > 0 ? (
                <div className="space-y-3">
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                    {candidates.length} Candidates
                  </h3>
                  {candidates.map((candidate, index) => (
                    <div
                      key={index}
                      className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 hover:shadow-md dark:hover:shadow-xl transition-all duration-200 bg-slate-50 dark:bg-slate-800/50 hover:bg-white dark:hover:bg-slate-800"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex-1">
                          <h4 className="font-semibold text-slate-900 dark:text-slate-100">{candidate.name}</h4>
                          <p className="text-sm text-slate-600 dark:text-slate-400">
                            {candidate.jobTitle} {candidate.company && `@ ${candidate.company}`}
                          </p>
                          {candidate.level && (
                            <span className="inline-block mt-2 px-2 py-1 bg-slate-200 dark:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 rounded">
                              {candidate.level.toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div className="text-right">
                          {candidate.relevanceScore && (
                            <div className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 mb-2">
                              Score: {candidate.relevanceScore}
                            </div>
                          )}
                          {candidate.contact && (
                            <div className="mb-2">
                              {candidate.contact.email && (
                                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                                  ✓ Email found
                                </p>
                              )}
                              {candidate.contact.phone && (
                                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                                  ✓ Phone found
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                        {candidate.snippet.substring(0, 120)}...
                      </p>

                      <div className="flex gap-2 items-center">
                        <a
                          href={candidate.linkedInUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 underline transition-colors"
                        >
                          View LinkedIn
                        </a>
                        <button
                          onClick={() => handleSaveCandidate(candidate, index)}
                          disabled={
                            savingCandidateId === index || savedCandidates.has(candidate.linkedInUrl)
                          }
                          className={`flex items-center gap-2 ml-auto px-3 py-2 rounded text-sm font-medium transition-all duration-200 ${
                            savedCandidates.has(candidate.linkedInUrl)
                              ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                              : 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-900/50'
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                          {savingCandidateId === index ? (
                            <>
                              <Loader2 size={16} className="animate-spin" />
                              Saving...
                            </>
                          ) : savedCandidates.has(candidate.linkedInUrl) ? (
                            <>
                              <Check size={16} />
                              Saved
                            </>
                          ) : (
                            <>
                              <Save size={16} />
                              Save to DB
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center">
                  <p className="text-slate-600 dark:text-slate-400">No candidates found matching your criteria</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 mt-6 pt-6 border-t border-slate-200 dark:border-slate-700">
                <button
                  onClick={() => setStep('input')}
                  className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-all duration-200">
                  Search Again
                </button>
                <button
                  onClick={handleExportCSV}
                  className="flex-1 px-4 py-2 border border-emerald-300 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-300 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-all duration-200 flex items-center justify-center gap-2">
                  <Download size={16} />
                  Export CSV
                </button>
                <button
                  onClick={handleClose}
                  className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-700 dark:hover:bg-indigo-600 text-white rounded-lg transition-all duration-200">
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

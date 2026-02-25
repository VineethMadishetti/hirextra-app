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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-blue-700 text-white p-6 flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold">🤖 AI Candidate Sourcing</h2>
            <p className="text-blue-100 text-sm mt-1">
              Paste a job description and let AI find matching candidates
            </p>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-blue-500 rounded-lg transition"
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
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Job Description
                  </label>
                  <textarea
                    value={jobDescription}
                    onChange={(e) => setJobDescription(e.target.value)}
                    placeholder="Paste the complete job description here...
                    Include job title, required skills, experience level, location, and any other relevant details."
                    className="w-full h-48 p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                  />
                  <p className="text-xs text-gray-500 mt-2">
                    Minimum 20 characters • The more detailed, the better the results
                  </p>
                </div>

                {/* Error Display */}
                {error && (
                  <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <AlertCircle size={20} className="text-red-600" />
                    <p className="text-red-700 text-sm">{error}</p>
                  </div>
                )}

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={jobDescription.trim().length < 20}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold py-3 rounded-lg transition"
                >
                  🔍 Find Candidates
                </button>

                {/* Info */}
                <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <p className="text-sm text-gray-700">
                    <strong>How it works:</strong>
                  </p>
                  <ul className="text-sm text-gray-600 mt-2 space-y-1">
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
              <Loader2 size={48} className="text-blue-600 animate-spin" />
              <p className="text-lg font-semibold text-gray-700">Finding candidates...</p>
              <p className="text-sm text-gray-500">
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
                  <div className="p-4 bg-blue-50 rounded-lg">
                    <p className="text-xs text-gray-600">Job Title</p>
                    <p className="font-semibold text-gray-900">{metadata.jobTitle}</p>
                  </div>
                  <div className="p-4 bg-green-50 rounded-lg">
                    <p className="text-xs text-gray-600">Candidates Found</p>
                    <p className="font-semibold text-gray-900">{metadata.totalExtracted}</p>
                  </div>
                  <div className="p-4 bg-purple-50 rounded-lg">
                    <p className="text-xs text-gray-600">Contacts Enriched</p>
                    <p className="font-semibold text-gray-900">{metadata.contactsEnriched}</p>
                  </div>
                  <div className="p-4 bg-orange-50 rounded-lg">
                    <p className="text-xs text-gray-600">Time Taken</p>
                    <p className="font-semibold text-gray-900">
                      {(metadata.timeMs / 1000).toFixed(1)}s
                    </p>
                  </div>
                </div>
              )}

              {/* Candidates List */}
              {candidates.length > 0 ? (
                <div className="space-y-3">
                  <h3 className="font-semibold text-gray-900">
                    {candidates.length} Candidates
                  </h3>
                  {candidates.map((candidate, index) => (
                    <div
                      key={index}
                      className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex-1">
                          <h4 className="font-semibold text-gray-900">{candidate.name}</h4>
                          <p className="text-sm text-gray-600">
                            {candidate.jobTitle} {candidate.company && `@ ${candidate.company}`}
                          </p>
                          {candidate.level && (
                            <span className="inline-block mt-2 px-2 py-1 bg-gray-100 text-xs font-medium text-gray-700 rounded">
                              {candidate.level.toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div className="text-right">
                          {candidate.relevanceScore && (
                            <div className="text-xs font-semibold text-blue-600 mb-2">
                              Score: {candidate.relevanceScore}
                            </div>
                          )}
                          {candidate.contact && (
                            <div className="mb-2">
                              {candidate.contact.email && (
                                <p className="text-xs text-green-600">
                                  ✓ Email found
                                </p>
                              )}
                              {candidate.contact.phone && (
                                <p className="text-xs text-green-600">
                                  ✓ Phone found
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <p className="text-sm text-gray-600 mb-3">
                        {candidate.snippet.substring(0, 120)}...
                      </p>

                      <div className="flex gap-2 items-center">
                        <a
                          href={candidate.linkedInUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:underline"
                        >
                          View LinkedIn
                        </a>
                        <button
                          onClick={() => handleSaveCandidate(candidate, index)}
                          disabled={
                            savingCandidateId === index || savedCandidates.has(candidate.linkedInUrl)
                          }
                          className={`flex items-center gap-2 ml-auto px-3 py-2 rounded text-sm font-medium transition ${
                            savedCandidates.has(candidate.linkedInUrl)
                              ? 'bg-green-100 text-green-700'
                              : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                          } disabled:opacity-50`}
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
                  <p className="text-gray-600">No candidates found matching your criteria</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 mt-6 pt-6 border-t">
                <button
                  onClick={() => setStep('input')}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition">
                  Search Again
                </button>
                <button
                  onClick={handleExportCSV}
                  className="flex-1 px-4 py-2 border border-green-300 text-green-700 rounded-lg hover:bg-green-50 transition flex items-center justify-center gap-2">
                  <Download size={16} />
                  Export CSV
                </button>
                <button
                  onClick={handleClose}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
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

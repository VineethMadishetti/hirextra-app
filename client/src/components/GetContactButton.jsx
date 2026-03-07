import { useState, useCallback } from 'react';
import { Mail, Phone, Loader, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import api from '../api/axios';
import toast from 'react-hot-toast';

const GetContactButton = ({ candidateId, candidate, onContactFound }) => {
  const [loading, setLoading] = useState(false);
  const [contact, setContact] = useState(candidate?.enrichedContact || null);
  const [notFound, setNotFound] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const handleEnrich = useCallback(async (forceRefresh = false) => {
    if (!candidateId) return;

    setLoading(true);
    setNotFound(false);
    setErrorMsg(null);

    try {
      const qs = forceRefresh ? '?force=true' : '';
      const response = await api.get(`/enrich-contact/${candidateId}${qs}`);
      const enrichedData = response.data?.data;

      if (response.data?.success && enrichedData && (enrichedData.email || enrichedData.phone)) {
        setContact(enrichedData);
        setNotFound(false);
        if (onContactFound) onContactFound(enrichedData);
        toast.success(`Contact found via ${enrichedData.source}!`, { duration: 3000 });
      } else {
        setContact(null);
        setNotFound(true);
        const msg = enrichedData?.error || 'No contact found for this candidate.';
        setErrorMsg(msg);
        toast.error(msg, { duration: 3000 });
      }
    } catch (err) {
      setContact(null);
      setNotFound(false);
      const msg = err.response?.data?.message || 'Failed to fetch contact. Check server logs.';
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [candidateId, onContactFound]);

  // Loading
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
        <Loader size={16} className="animate-spin" />
        <span className="text-xs whitespace-nowrap">Looking up...</span>
      </div>
    );
  }

  // Has contact — display email/phone
  if (contact && (contact.email || contact.phone)) {
    return (
      <div className="flex flex-col gap-1.5 max-w-[220px]">
        {contact.email && (
          <a
            href={`mailto:${contact.email}`}
            className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 text-xs no-underline"
            title={contact.email}>
            <Mail size={12} className="flex-shrink-0" />
            <span className="truncate">{contact.email}</span>
          </a>
        )}
        {contact.phone && (
          <a
            href={`tel:${contact.phone}`}
            className="flex items-center gap-1.5 text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 text-xs no-underline"
            title={contact.phone}>
            <Phone size={12} className="flex-shrink-0" />
            <span className="truncate">{contact.phone}</span>
          </a>
        )}
        <div className="flex items-center justify-between pt-0.5">
          <div className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
            <CheckCircle2 size={10} className="text-green-500 flex-shrink-0" />
            <span className="capitalize">{contact.source}</span>
          </div>
          <button
            onClick={() => handleEnrich(true)}
            className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex items-center gap-0.5 transition-colors"
            title="Refresh contact">
            <RefreshCw size={10} />
            Refresh
          </button>
        </div>
      </div>
    );
  }

  // Not found after attempt
  if (notFound) {
    return (
      <div className="flex items-center gap-1.5">
        <div className="group relative">
          <AlertCircle size={14} className="text-slate-400" />
          {errorMsg && (
            <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block bg-slate-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-50 max-w-[200px] break-words">
              {errorMsg}
            </div>
          )}
        </div>
        <span className="text-xs text-slate-400">Not found</span>
        <button
          onClick={() => handleEnrich(false)}
          className="text-xs text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors">
          Retry
        </button>
      </div>
    );
  }

  // Default — show Get Contact button
  return (
    <button
      onClick={() => handleEnrich(false)}
      className="inline-flex items-center gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white px-2.5 py-1.5 rounded-lg transition-all duration-200 shadow-sm hover:shadow-md font-medium whitespace-nowrap"
      title="Find email & phone via Skrapp">
      <span>Get Contact</span>
    </button>
  );
};

export default GetContactButton;

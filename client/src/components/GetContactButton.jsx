import React, { useState, useCallback } from 'react';
import { Mail, Phone, Linkedin, Loader, AlertCircle, CheckCircle2 } from 'lucide-react';
import api from '../api/axios';
import toast from 'react-hot-toast';

/**
 * GetContactButton Component
 * Enriches candidate contact info (email/phone) using cascade APIs
 * Shows contact details when found, caches results for 30 days
 */
const GetContactButton = ({ candidateId, candidate, onContactFound }) => {
  const [loading, setLoading] = useState(false);
  const [contact, setContact] = useState(candidate?.enrichedContact || null);
  const [error, setError] = useState(null);

  const handleEnrich = useCallback(async () => {
    if (!candidateId) return;

    setLoading(true);
    setError(null);

    try {
      const response = await api.get(`/enrich-contact/${candidateId}`);

      if (response.data.success && response.data.data) {
        const enrichedData = response.data.data;
        
        // Update local state
        setContact(enrichedData);
        
        // Notify parent if callback provided
        if (onContactFound) {
          onContactFound(enrichedData);
        }

        // Show success message
        if (enrichedData.email || enrichedData.phone) {
          toast.success(`Contact found via ${enrichedData.source}!`, {
            duration: 3000,
          });
        } else {
          toast.error('No contact information found for this candidate.');
        }
      } else {
        setError('Enrichment failed');
        toast.error('Failed to enrich contact information.');
      }
    } catch (err) {
      console.error('Enrichment error:', err);
      setError(err.response?.data?.error || 'Enrichment failed');
      toast.error(err.response?.data?.message || 'Failed to fetch contact information.');
    } finally {
      setLoading(false);
    }
  }, [candidateId, onContactFound]);

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
        <Loader size={16} className="animate-spin" />
        <span className="text-xs whitespace-nowrap">Finding...</span>
      </div>
    );
  }

  // Error state
  if (error && !contact) {
    return (
      <div className="flex items-center gap-2">
        <div className="group relative">
          <AlertCircle size={16} className="text-amber-500" />
          <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block bg-slate-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-50">
            {error}
          </div>
        </div>
        <button
          onClick={handleEnrich}
          className="text-xs bg-amber-600 hover:bg-amber-700 text-white px-2 py-1 rounded transition-colors">
          Retry
        </button>
      </div>
    );
  }

  // Has contact data - display it
  if (contact && (contact.email || contact.phone)) {
    return (
      <div className="flex flex-col gap-1.5 max-w-[220px]">
        {/* Email */}
        {contact.email && (
          <a
            href={`mailto:${contact.email}`}
            className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 text-xs no-underline group"
            title={contact.email}>
            <Mail size={12} className="flex-shrink-0" />
            <span className="truncate">{contact.email}</span>
          </a>
        )}

        {/* Phone */}
        {contact.phone && (
          <a
            href={`tel:${contact.phone}`}
            className="flex items-center gap-1.5 text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 text-xs no-underline group"
            title={contact.phone}>
            <Phone size={12} className="flex-shrink-0" />
            <span className="truncate">{contact.phone}</span>
          </a>
        )}

        {/* Source & Confidence Badge */}
        <div className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400 pt-0.5">
          <CheckCircle2 size={10} className="text-green-500 flex-shrink-0" />
          <span className="capitalize">{contact.source}</span>
          <span className="opacity-70">
            {contact.confidence ? `${Math.round(contact.confidence * 100)}%` : ''}
          </span>
        </div>
      </div>
    );
  }

  // No contact found - show button
  return (
    <button
      onClick={handleEnrich}
      className="inline-flex items-center gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white px-2.5 py-1.5 rounded-lg transition-all duration-200 shadow-sm hover:shadow-md font-medium group whitespace-nowrap"
      title="Enrich contact information (email/phone) using Skrapp, PDL, or Lusha APIs"
      disabled={loading}>
      {/* <Linkedin size={12} className="flex-shrink-0" /> */}
      <span>Get Contact</span>
    </button>
  );
};

export default GetContactButton;

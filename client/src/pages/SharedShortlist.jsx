import React from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../api/axios';
import { Briefcase, MapPin, Award, Loader, Users } from 'lucide-react';

const SharedShortlist = () => {
  const { token } = useParams();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['shortlist-public', token],
    queryFn: async () => {
      const { data } = await api.get(`/shortlists/public/${token}`);
      return data;
    },
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader size={32} className="animate-spin text-indigo-500"/>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 text-center px-4">
        <div className="w-16 h-16 rounded-2xl bg-rose-50 flex items-center justify-center mb-4">
          <Users size={28} className="text-rose-400"/>
        </div>
        <h1 className="text-2xl font-bold text-slate-800 mb-2">Shortlist Not Found</h1>
        <p className="text-slate-500">This shortlist link may have expired or been removed.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50/30 py-12 px-4">
      {/* Header */}
      <div className="max-w-5xl mx-auto mb-10 text-center">
        <div className="inline-flex items-center gap-2 bg-indigo-600 text-white px-4 py-1.5 rounded-full text-sm font-semibold mb-4">
          <Users size={14}/>
          Candidate Shortlist
        </div>
        <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900 mb-2">{data.name}</h1>
        <p className="text-slate-500 text-sm">
          {data.candidates.length} candidate{data.candidates.length !== 1 ? 's' : ''} · Shared on {new Date(data.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Candidate Cards */}
      <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {data.candidates.map(c => {
          const skillList = (c.skills || '').split(',').map(s => s.trim()).filter(Boolean);
          return (
            <div key={c._id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
              {/* Name + Title */}
              <div className="mb-3">
                <h2 className="text-lg font-bold text-slate-900 leading-tight">{c.fullName || 'Candidate'}</h2>
                {c.jobTitle && (
                  <p className="text-sm text-indigo-600 font-medium flex items-center gap-1 mt-0.5">
                    <Briefcase size={13} className="shrink-0"/>{c.jobTitle}
                  </p>
                )}
                {c.company && <p className="text-sm text-slate-500 mt-0.5">{c.company}</p>}
              </div>

              {/* Meta */}
              <div className="space-y-1 mb-3">
                {(c.locality || c.location) && (
                  <p className="text-xs text-slate-500 flex items-center gap-1">
                    <MapPin size={11} className="text-slate-400 shrink-0"/>{c.locality || c.location}
                  </p>
                )}
                {c.experience && (
                  <p className="text-xs text-slate-500 flex items-center gap-1">
                    <Award size={11} className="text-slate-400 shrink-0"/>{c.experience} experience
                  </p>
                )}
                {c.education && (
                  <p className="text-xs text-slate-500 truncate">{c.education}</p>
                )}
              </div>

              {/* Skills */}
              {skillList.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {skillList.slice(0, 8).map(skill => (
                    <span key={skill} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs font-medium rounded-md">{skill}</span>
                  ))}
                  {skillList.length > 8 && <span className="text-xs text-slate-400">+{skillList.length - 8} more</span>}
                </div>
              )}

              {/* Summary */}
              {c.summary && (
                <p className="text-xs text-slate-500 leading-relaxed line-clamp-3 border-t border-slate-100 pt-3">{c.summary}</p>
              )}

              {/* LinkedIn */}
              {c.linkedinUrl && (
                <a href={c.linkedinUrl} target="_blank" rel="noreferrer"
                  className="mt-3 block text-center text-xs font-semibold text-indigo-600 hover:text-indigo-800 border border-indigo-200 hover:border-indigo-400 rounded-xl py-2 transition">
                  View LinkedIn Profile
                </a>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="max-w-5xl mx-auto mt-12 text-center">
        <p className="text-xs text-slate-400">Powered by HireXtra · Candidate contact details are not shared publicly</p>
      </div>
    </div>
  );
};

export default SharedShortlist;

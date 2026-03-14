import React, { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/axios';
import toast from 'react-hot-toast';
import { Loader, User, Briefcase, MapPin, Mail, Phone, ChevronRight, RefreshCw } from 'lucide-react';

const STAGES = [
  { key: 'DISCOVERED',       label: 'Discovered',        color: 'bg-slate-500',   light: 'bg-slate-100 dark:bg-slate-800/60',   border: 'border-slate-300 dark:border-slate-700',   badge: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
  { key: 'CONTACT_ENRICHED', label: 'Contact Enriched',  color: 'bg-blue-500',    light: 'bg-blue-50 dark:bg-blue-900/20',      border: 'border-blue-200 dark:border-blue-700/50',  badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  { key: 'SEQUENCED',        label: 'Sequenced',         color: 'bg-violet-500',  light: 'bg-violet-50 dark:bg-violet-900/20',  border: 'border-violet-200 dark:border-violet-700/50', badge: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
  { key: 'CALL_QUEUED',      label: 'Call Queued',       color: 'bg-amber-500',   light: 'bg-amber-50 dark:bg-amber-900/20',    border: 'border-amber-200 dark:border-amber-700/50',  badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  { key: 'SHORTLISTED',      label: 'Shortlisted',       color: 'bg-emerald-500', light: 'bg-emerald-50 dark:bg-emerald-900/20',border: 'border-emerald-200 dark:border-emerald-700/50', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
];

const stageIndex = (key) => STAGES.findIndex(s => s.key === key);

const fetchByStage = async (stage) => {
  const { data } = await api.get('/candidates/search', {
    params: { pipelineStage: stage, limit: 200, sortBy: 'updatedAt', sortOrder: 'desc' },
  });
  return data.candidates || [];
};

const PipelineCard = ({ candidate, stage, onAdvance, isAdvancing }) => {
  const stageIdx = stageIndex(stage.key);
  const isLast = stageIdx === STAGES.length - 1;
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 shadow-sm hover:shadow-md transition-shadow group">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-900 dark:text-white text-sm truncate">{candidate.fullName || 'Unknown'}</p>
          {candidate.jobTitle && (
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate flex items-center gap-1 mt-0.5">
              <Briefcase size={10} className="shrink-0"/>{candidate.jobTitle}
            </p>
          )}
          {(candidate.locality || candidate.location) && (
            <p className="text-xs text-slate-400 dark:text-slate-500 truncate flex items-center gap-1">
              <MapPin size={10} className="shrink-0"/>{candidate.locality || candidate.location}
            </p>
          )}
        </div>
        {!isLast && (
          <button
            onClick={() => onAdvance(candidate._id, STAGES[stageIdx + 1].key)}
            disabled={isAdvancing}
            title={`Move to ${STAGES[stageIdx + 1].label}`}
            className="shrink-0 p-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition opacity-0 group-hover:opacity-100 cursor-pointer disabled:opacity-50">
            {isAdvancing ? <Loader size={14} className="animate-spin"/> : <ChevronRight size={14}/>}
          </button>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        {candidate.email && <Mail size={11} className="text-emerald-500 shrink-0" title={candidate.email}/>}
        {candidate.phone && <Phone size={11} className="text-blue-500 shrink-0" title={candidate.phone}/>}
        {candidate.linkedinUrl && (
          <a href={candidate.linkedinUrl} target="_blank" rel="noreferrer" className="text-[10px] text-indigo-500 hover:underline truncate" onClick={e => e.stopPropagation()}>LinkedIn</a>
        )}
      </div>
    </div>
  );
};

const Pipeline = () => {
  const queryClient = useQueryClient();
  const [advancingId, setAdvancingId] = useState(null);

  // Fetch all stages in parallel
  const queries = STAGES.map(stage =>
    useQuery({
      queryKey: ['pipeline', stage.key],
      queryFn: () => fetchByStage(stage.key),
      staleTime: 60 * 1000,
    })
  );

  const advanceMutation = useMutation({
    mutationFn: ({ candidateId, newStage }) =>
      api.post('/ai-source/candidate-stage', { candidateId, stage: newStage }),
    onSuccess: (_, { newStage }) => {
      // Invalidate current and next stage
      STAGES.forEach(s => queryClient.invalidateQueries({ queryKey: ['pipeline', s.key] }));
      toast.success(`Moved to ${STAGES.find(s => s.key === newStage)?.label}`);
    },
    onError: () => toast.error('Failed to update stage'),
    onSettled: () => setAdvancingId(null),
  });

  const handleAdvance = useCallback((candidateId, newStage) => {
    setAdvancingId(candidateId);
    advanceMutation.mutate({ candidateId, newStage });
  }, [advanceMutation]);

  const totalCandidates = queries.reduce((sum, q) => sum + (q.data?.length || 0), 0);
  const isLoading = queries.some(q => q.isLoading);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Candidate Pipeline</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {totalCandidates} candidates across {STAGES.length} stages
          </p>
        </div>
        <button
          onClick={() => STAGES.forEach(s => queryClient.invalidateQueries({ queryKey: ['pipeline', s.key] }))}
          className="p-2 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition cursor-pointer"
          title="Refresh">
          <RefreshCw size={18}/>
        </button>
      </div>

      {/* Kanban Board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-4 p-4 h-full min-w-max">
          {STAGES.map((stage, idx) => {
            const { data: candidates = [], isLoading: loading } = queries[idx];
            return (
              <div key={stage.key} className={`flex flex-col w-72 rounded-2xl border ${stage.border} ${stage.light} overflow-hidden`}>
                {/* Column header */}
                <div className="px-4 py-3 flex items-center justify-between shrink-0 border-b border-inherit">
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${stage.color}`}/>
                    <span className="font-semibold text-sm text-slate-800 dark:text-slate-200">{stage.label}</span>
                  </div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${stage.badge}`}>
                    {loading ? '…' : candidates.length}
                  </span>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-3 space-y-2.5 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700 [scrollbar-width:thin]">
                  {loading ? (
                    <div className="flex justify-center pt-8"><Loader size={20} className="animate-spin text-slate-400"/></div>
                  ) : candidates.length === 0 ? (
                    <div className="flex flex-col items-center justify-center pt-8 text-center">
                      <User size={28} className="text-slate-300 dark:text-slate-600 mb-2"/>
                      <p className="text-xs text-slate-400 dark:text-slate-500">No candidates here</p>
                    </div>
                  ) : (
                    candidates.map(c => (
                      <PipelineCard
                        key={c._id}
                        candidate={c}
                        stage={stage}
                        onAdvance={handleAdvance}
                        isAdvancing={advancingId === c._id}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Pipeline;

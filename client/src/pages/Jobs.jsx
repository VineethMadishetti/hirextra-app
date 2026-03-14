import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/axios';
import toast from 'react-hot-toast';
import { Plus, Briefcase, MapPin, Building, X, Loader, Trash2, Edit2, ChevronDown } from 'lucide-react';

const STATUS_OPTS = ['OPEN', 'ON_HOLD', 'CLOSED'];
const PRIORITY_OPTS = ['LOW', 'MEDIUM', 'HIGH'];

const STATUS_STYLES = {
  OPEN:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  ON_HOLD: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  CLOSED:  'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400',
};

const PRIORITY_STYLES = {
  HIGH:   'bg-rose-50 text-rose-600 dark:bg-rose-900/20 dark:text-rose-400 border border-rose-200 dark:border-rose-700/50',
  MEDIUM: 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 border border-amber-200 dark:border-amber-700/50',
  LOW:    'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700',
};

const EMPTY_FORM = { title: '', client: '', location: '', skills: '', description: '', status: 'OPEN', priority: 'MEDIUM' };

const JobFormModal = ({ initial, onSave, onClose, isSaving }) => {
  const [form, setForm] = useState(initial || EMPTY_FORM);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg p-6 shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">{initial?._id ? 'Edit Job' : 'New Job Requisition'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-white transition cursor-pointer"><X size={20}/></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Job Title *</label>
            <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Senior Java Developer" className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-sm"/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Client / Company</label>
              <input value={form.client} onChange={e => set('client', e.target.value)} placeholder="Client name" className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-sm"/>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Location</label>
              <input value={form.location} onChange={e => set('location', e.target.value)} placeholder="City / Remote" className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-sm"/>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Required Skills</label>
            <input value={form.skills} onChange={e => set('skills', e.target.value)} placeholder="e.g. Java, Spring Boot, AWS" className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-sm"/>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Job Description</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)} placeholder="Brief description of the role..." rows={3} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-sm resize-none"/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-400 text-sm">
                {STATUS_OPTS.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Priority</label>
              <select value={form.priority} onChange={e => set('priority', e.target.value)} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-400 text-sm">
                {PRIORITY_OPTS.map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-white transition cursor-pointer">Cancel</button>
          <button
            onClick={() => onSave(form)}
            disabled={isSaving || !form.title.trim()}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-400 text-white rounded-xl text-sm font-semibold transition cursor-pointer shadow-md">
            {isSaving ? 'Saving...' : (initial?._id ? 'Update Job' : 'Create Job')}
          </button>
        </div>
      </div>
    </div>
  );
};

const Jobs = () => {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingJob, setEditingJob] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['jobs', statusFilter],
    queryFn: async () => {
      const { data } = await api.get('/jobs', { params: statusFilter ? { status: statusFilter } : {} });
      return data;
    },
    staleTime: 30 * 1000,
  });

  const createMutation = useMutation({
    mutationFn: (form) => api.post('/jobs', form),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['jobs'] }); toast.success('Job created'); setShowForm(false); },
    onError: () => toast.error('Failed to create job'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, form }) => api.patch(`/jobs/${id}`, form),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['jobs'] }); toast.success('Job updated'); setEditingJob(null); },
    onError: () => toast.error('Failed to update job'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/jobs/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['jobs'] }); toast.success('Job deleted'); },
    onError: () => toast.error('Failed to delete job'),
  });

  const openCount = jobs.filter(j => j.status === 'OPEN').length;
  const holdCount = jobs.filter(j => j.status === 'ON_HOLD').length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Briefcase size={22} className="text-indigo-500"/>
              Job Requisitions
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {openCount} open · {holdCount} on hold · {jobs.length} total
            </p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold transition shadow-md cursor-pointer">
            <Plus size={16}/>
            New Job
          </button>
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-2 mt-3">
          {['', ...STATUS_OPTS].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition cursor-pointer ${statusFilter === s ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}`}>
              {s || 'All'}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex justify-center pt-16"><Loader size={28} className="animate-spin text-indigo-500"/></div>
        ) : jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center pt-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center mb-4">
              <Briefcase size={28} className="text-indigo-500"/>
            </div>
            <p className="text-lg font-semibold text-slate-700 dark:text-slate-200 mb-1">No job requisitions yet</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Create your first job to start tracking candidates by role.</p>
            <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-semibold transition cursor-pointer">
              <Plus size={16}/>Create Job
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {jobs.map(job => (
              <div key={job._id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-bold text-slate-900 dark:text-white text-base leading-tight">{job.title}</h3>
                  <span className={`shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full ${STATUS_STYLES[job.status]}`}>{job.status}</span>
                </div>

                <div className="space-y-1.5 text-sm text-slate-600 dark:text-slate-400">
                  {job.client && <p className="flex items-center gap-1.5"><Building size={13} className="text-slate-400 shrink-0"/>{job.client}</p>}
                  {job.location && <p className="flex items-center gap-1.5"><MapPin size={13} className="text-slate-400 shrink-0"/>{job.location}</p>}
                  {job.skills && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {job.skills.split(',').map(s => s.trim()).filter(Boolean).slice(0, 6).map(skill => (
                        <span key={skill} className="px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-xs font-medium">{skill}</span>
                      ))}
                    </div>
                  )}
                </div>

                {job.description && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">{job.description}</p>
                )}

                <div className="flex items-center justify-between mt-auto pt-3 border-t border-slate-100 dark:border-slate-800">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${PRIORITY_STYLES[job.priority]}`}>{job.priority}</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setEditingJob(job)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition cursor-pointer"
                      title="Edit">
                      <Edit2 size={14}/>
                    </button>
                    <button
                      onClick={() => { if (window.confirm('Delete this job?')) deleteMutation.mutate(job._id); }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition cursor-pointer"
                      title="Delete">
                      <Trash2 size={14}/>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {showForm && (
        <JobFormModal
          onSave={(form) => createMutation.mutate(form)}
          onClose={() => setShowForm(false)}
          isSaving={createMutation.isPending}
        />
      )}
      {editingJob && (
        <JobFormModal
          initial={editingJob}
          onSave={(form) => updateMutation.mutate({ id: editingJob._id, form })}
          onClose={() => setEditingJob(null)}
          isSaving={updateMutation.isPending}
        />
      )}
    </div>
  );
};

export default Jobs;

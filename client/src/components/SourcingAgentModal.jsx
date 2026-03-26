import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  AlertCircle,
  Award,
  BadgeCheck,
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
  FileText,
  Globe,
  X,
  GraduationCap,
  History,
  Linkedin,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Star,
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


/** Extract seniority label from job title string */
function extractSeniority(title) {
  if (!title) return null;
  const t = title.toLowerCase();
  if (/\b(vp|vice president|director|head of|chief|cto|ceo|cfo|coo)\b/.test(t)) return 'Director+';
  if (/\b(principal|staff|architect)\b/.test(t)) return 'Principal';
  if (/\blead\b/.test(t)) return 'Lead';
  if (/\bsenior\b|\bsr\.?\b/.test(t)) return 'Senior';
  if (/\bjunior\b|\bjr\.?\b/.test(t)) return 'Junior';
  if (/\bmid[- ]?level\b/.test(t)) return 'Mid-level';
  return null;
}

/** Map DB availability enum to display badge */
function availabilityBadge(availability) {
  switch (availability) {
    case 'IMMEDIATE': return { label: 'Immediate Joiner', type: 'immediate' };
    case '15_DAYS':   return { label: '15 Days Notice',   type: 'availability' };
    case '30_DAYS':   return { label: '30 Days Notice',   type: 'availability' };
    default:          return null;
  }
}

// ── Animated loading steps component ────────────────────────────────────────
function LoadingSteps({ steps, stepIdx, onSetStepIdx, onCancel }) {
  useEffect(() => {
    if (stepIdx >= steps.length - 1) return;
    const timer = setTimeout(() => onSetStepIdx(stepIdx + 1), steps[stepIdx].duration);
    return () => clearTimeout(timer);
  }, [stepIdx, steps, onSetStepIdx]);

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      {/* Spinner */}
      <div className="relative mb-8">
        <div className="w-16 h-16 rounded-full border-2 border-[#432DD7]/20 flex items-center justify-center">
          <Loader2 size={32} className="animate-spin text-[#A99BFF]" />
        </div>
        <div className="absolute inset-0 rounded-full bg-[#432DD7]/10 animate-ping" style={{ animationDuration: '2s' }} />
      </div>

      {/* Current step */}
      <p className="text-xl font-bold text-slate-100 text-center">{steps[stepIdx]?.label}</p>
      <p className="text-sm text-slate-400 mt-1.5 text-center max-w-sm">{steps[stepIdx]?.sub}</p>

      {/* Step progress dots */}
      <div className="flex items-center gap-2 mt-8">
        {steps.map((s, i) => (
          <div
            key={i}
            className={`rounded-full transition-all duration-500 ${
              i < stepIdx  ? 'w-2 h-2 bg-[#432DD7]' :
              i === stepIdx ? 'w-4 h-2 bg-[#A99BFF]' :
                              'w-2 h-2 bg-slate-700'
            }`}
          />
        ))}
      </div>

      {/* Step list */}
      <div className="mt-8 w-full max-w-sm space-y-2">
        {steps.slice(0, -1).map((s, i) => (
          <div key={i} className={`flex items-center gap-3 text-sm transition-all duration-300 ${
            i < stepIdx  ? 'text-slate-500' :
            i === stepIdx ? 'text-slate-100 font-medium' :
                            'text-slate-700'
          }`}>
            <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-all ${
              i < stepIdx  ? 'border-[#432DD7] bg-[#432DD7]' :
              i === stepIdx ? 'border-[#A99BFF] bg-transparent' :
                              'border-slate-700 bg-transparent'
            }`}>
              {i < stepIdx
                ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2.5 2.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                : i === stepIdx
                  ? <div className="w-1.5 h-1.5 rounded-full bg-[#A99BFF] animate-pulse" />
                  : null
              }
            </div>
            {s.label}
          </div>
        ))}
      </div>

      <button
        onClick={onCancel}
        className="mt-8 inline-flex items-center gap-2 rounded-xl bg-slate-800 border border-slate-700 px-4 py-2 text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-700 transition-all cursor-pointer"
      >
        <ChevronLeft size={16} /> Cancel
      </button>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

const CARD_FONT = { fontFamily: '"Plus Jakarta Sans","Segoe UI",sans-serif' };



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
      const { data } = await api.get(`/enrich-contact/${candidateId}`, { timeout: 15000 });
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

// ── Match category styling ──────────────���─────────────────────────────────────
const MATCH_CATEGORY_STYLE = {
  PERFECT:  { label: '-80% Match', className: 'border-emerald-600/60 bg-emerald-950/40 text-emerald-300' },
  STRONG:   { label: '-80% Match', className: 'border-emerald-600/60 bg-emerald-950/40 text-emerald-300' },
  GOOD:     { label: '-60% Match', className: 'border-blue-600/60 bg-blue-950/40 text-blue-300' },
  PARTIAL:  { label: '-40% Match', className: 'border-yellow-600/50 bg-yellow-950/30 text-yellow-300' },
  WEAK:     { label: 'Weak',       className: 'border-slate-700/50 bg-slate-800/30 text-slate-500' },
};

function MatchBadge({ score, category }) {
  const meta = MATCH_CATEGORY_STYLE[category] || MATCH_CATEGORY_STYLE.WEAK;
  if (score == null) return null;
  return (
    <span className={`shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full border ${meta.className}`}>
      {score}% Match
    </span>
  );
}

function BucketSummary({ bucketCounts }) {
  if (!bucketCounts) return null;
  const count80 = (bucketCounts.perfect || 0) + (bucketCounts.strong || 0);
  const count60 = bucketCounts.good    || 0;
  const count40 = bucketCounts.partial || 0;
  const items = [
    { count: count80, label: '80%', color: 'text-emerald-400' },
    { count: count60, label: '60%', color: 'text-blue-400' },
    { count: count40, label: '40%', color: 'text-yellow-400' },
  ].filter(i => i.count > 0);
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-300">
      {items.map(({ count, label, color }, idx) => (
        <span key={label} className="flex items-center gap-1">
          {idx > 0 && <span className="text-slate-600 mr-2">|</span>}
          <span className={`font-bold ${color}`}>{label}</span>
          <span className="text-slate-400">- {count} {count === 1 ? 'Candidate' : 'Candidates'}</span>
        </span>
      ))}
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

// ── Resume HTML generator ─────────────────────────────────────────────────────
function buildResumeHTML(c) {
  const name = c.name || c.fullName || 'Candidate';
  const title = c.jobTitle || c.title || '';
  const company = c.company || '';
  const location = c.location || '';
  const email = c.email || '';
  const phone = c.phone || '';
  const linkedin = c.linkedInUrl || c.linkedinUrl || '';
  const github = c.githubUrl || '';
  const about = c.about || '';
  const skills = Array.isArray(c.skills) ? c.skills : [];
  const experience = Array.isArray(c.experienceTimeline) ? c.experienceTimeline : [];
  const certifications = Array.isArray(c.certifications) ? c.certifications : [];
  const languages = Array.isArray(c.languages) ? c.languages : [];
  const edu = c.education || '';
  const eduGrade = c.educationGrade || '';
  const eduYear = c.educationYear || '';
  const totalExp = c.totalExperience || (c.experienceYears ? `${c.experienceYears} years` : '');

  const section = (title, content) => content ? `
    <div class="section">
      <div class="section-title">${title}</div>
      <div class="section-body">${content}</div>
    </div>` : '';

  const expHTML = experience.map(e => {
    const dateStr = e.startDateText ? `${e.startDateText} – ${e.endDateText || 'Present'}` : '';
    const meta = [e.employmentType, e.workplaceType].filter(Boolean).join(' · ');
    return `
      <div class="exp-item">
        <div class="exp-header">
          ${e.companyLogo ? `<img src="${e.companyLogo}" class="company-logo" alt="${e.company||''}" />` : '<div class="company-logo-placeholder"></div>'}
          <div class="exp-info">
            <div class="exp-title">${e.title || ''}</div>
            <div class="exp-company">${e.company || ''}</div>
          </div>
          <div class="exp-dates">
            <span class="exp-date">${dateStr}</span>${e.duration ? `<span class="exp-duration"> · ${e.duration}</span>` : ''}
            ${meta ? `<div class="exp-meta">${meta}</div>` : ''}
          </div>
        </div>
        ${e.description ? `<div class="exp-desc">${e.description}</div>` : ''}
      </div>`;
  }).join('');

  const skillsHTML = skills.map(s => `<span class="skill-chip">${s}</span>`).join('');

  const certsHTML = certifications.map(cert => `
    <div class="cert-item">
      <span class="cert-title">${cert.title || ''}</span>
      ${cert.issuedBy ? `<span class="cert-issuer"> — ${cert.issuedBy}${cert.issuedAt ? ` (${cert.issuedAt})` : ''}</span>` : ''}
    </div>`).join('');

  const langHTML = languages.length ? languages.join(', ') : '';

  const contactParts = [
    email ? `<a href="mailto:${email}">${email}</a>` : '',
    phone ? `<a href="tel:${phone}">${phone}</a>` : '',
    location ? `<span>📍 ${location}</span>` : '',
    linkedin ? `<a href="${linkedin}" target="_blank">LinkedIn</a>` : '',
    github ? `<a href="${github}" target="_blank">GitHub</a>` : '',
  ].filter(Boolean).join('<span class="sep">|</span>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${name} — Resume</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#1a1a2e;background:#fff;padding:0}
  .page{max-width:820px;margin:0 auto;padding:40px 48px 48px}
  .header{border-bottom:3px solid #432DD7;padding-bottom:18px;margin-bottom:22px}
  .header-top{display:flex;align-items:flex-start;gap:20px}
  .avatar{width:80px;height:80px;border-radius:10px;object-fit:cover;border:2px solid #e5e7eb;flex-shrink:0}
  .avatar-placeholder{width:80px;height:80px;border-radius:10px;background:linear-gradient(135deg,#432DD7,#7c3aed);display:flex;align-items:center;justify-content:center;color:#fff;font-size:26px;font-weight:700;flex-shrink:0}
  .header-info{flex:1}
  .name{font-size:26px;font-weight:800;color:#1a1a2e;letter-spacing:-0.3px;line-height:1.1}
  .headline{font-size:14px;color:#432DD7;font-weight:600;margin-top:4px}
  .sub-headline{font-size:12px;color:#64748b;margin-top:2px}
  .contact-row{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:10px;font-size:11.5px;color:#475569}
  .contact-row a{color:#432DD7;text-decoration:none}
  .sep{color:#cbd5e1;margin:0 2px}
  .total-exp{display:inline-block;margin-top:8px;background:#eef2ff;border:1px solid #c7d2fe;border-radius:6px;padding:2px 10px;font-size:11px;color:#3730a3;font-weight:600}
  .section{margin-bottom:20px}
  .section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#432DD7;border-bottom:1px solid #e0e7ff;padding-bottom:5px;margin-bottom:12px}
  .section-body{font-size:13px;color:#374151;line-height:1.65}
  .exp-item{margin-bottom:14px}
  .exp-header{display:flex;align-items:flex-start;gap:12px}
  .company-logo{width:36px;height:36px;object-fit:contain;border-radius:5px;border:1px solid #e5e7eb;background:#f9fafb;flex-shrink:0}
  .company-logo-placeholder{width:36px;height:36px;border-radius:5px;border:1px solid #e5e7eb;background:#f1f5f9;flex-shrink:0}
  .exp-info{flex:1}
  .exp-title{font-weight:700;font-size:13.5px;color:#111827}
  .exp-company{color:#6b7280;font-size:12.5px;margin-top:1px}
  .exp-dates{text-align:right;flex-shrink:0;font-size:11.5px;color:#6b7280}
  .exp-duration{color:#9ca3af}
  .exp-meta{font-size:11px;color:#9ca3af;margin-top:2px}
  .exp-desc{font-size:12px;color:#6b7280;margin-top:6px;padding-left:48px;line-height:1.55}
  .skills-wrap{display:flex;flex-wrap:wrap;gap:6px}
  .skill-chip{background:#eef2ff;border:1px solid #c7d2fe;border-radius:5px;padding:3px 10px;font-size:11.5px;color:#3730a3;font-weight:500}
  .edu-item{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:4px}
  .edu-degree{font-weight:600;color:#111827;font-size:13px}
  .edu-meta{font-size:11.5px;color:#6b7280}
  .edu-grade{background:#d1fae5;border:1px solid #6ee7b7;border-radius:4px;padding:1px 7px;font-size:11px;color:#065f46;font-weight:600;margin-left:8px}
  .cert-item{margin-bottom:5px;font-size:12.5px}
  .cert-title{font-weight:600;color:#111827}
  .cert-issuer{color:#6b7280}
  @media print{
    body{background:#fff}
    .page{padding:20px 28px 28px;max-width:100%}
    .no-print{display:none!important}
    a{color:inherit;text-decoration:none}
  }
</style>
</head>
<body>
<div class="page">
  <!-- Print / Download buttons -->
  <div class="no-print" style="display:flex;gap:10px;justify-content:flex-end;margin-bottom:20px">
    <button onclick="window.print()" style="background:#432DD7;color:#fff;border:none;border-radius:8px;padding:8px 20px;font-size:13px;font-weight:600;cursor:pointer">⬇ Download PDF</button>
    <button onclick="window.close()" style="background:#f1f5f9;color:#374151;border:1px solid #cbd5e1;border-radius:8px;padding:8px 16px;font-size:13px;cursor:pointer">Close</button>
  </div>

  <div class="header">
    <div class="header-top">
      ${c.profilePic
        ? `<img src="${c.profilePic}" class="avatar" alt="${name}" />`
        : `<div class="avatar-placeholder">${name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}</div>`}
      <div class="header-info">
        <div class="name">${name}</div>
        ${title ? `<div class="headline">${title}${company ? ` · ${company}` : ''}</div>` : ''}
        ${c.headline && c.headline !== title ? `<div class="sub-headline">${c.headline}</div>` : ''}
        <div class="contact-row">${contactParts}</div>
        ${totalExp ? `<span class="total-exp">⏱ ${totalExp} experience</span>` : ''}
      </div>
    </div>
  </div>

  ${section('Professional Summary', about ? `<p>${about}</p>` : '')}

  ${experience.length ? section('Work Experience', expHTML) : ''}

  ${edu ? section('Education', `
    <div class="edu-item">
      <div>
        <span class="edu-degree">${edu}</span>
        ${eduGrade ? `<span class="edu-grade">${eduGrade}</span>` : ''}
      </div>
      <span class="edu-meta">${eduYear || ''}</span>
    </div>`) : ''}

  ${skills.length ? section('Skills', `<div class="skills-wrap">${skillsHTML}</div>`) : ''}

  ${certifications.length ? section('Certifications', certsHTML) : ''}

  ${langHTML ? section('Languages', langHTML) : ''}
</div>
</body>
</html>`;
}

function ResumeModal({ candidate, onClose }) {
  const iframeRef = useRef(null);

  useEffect(() => {
    const html = buildResumeHTML(candidate);
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    if (iframeRef.current) iframeRef.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [candidate]);

  const handleDownload = useCallback(() => {
    const html = buildResumeHTML(candidate);
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (win) {
      win.onload = () => {
        setTimeout(() => { win.print(); URL.revokeObjectURL(url); }, 400);
      };
    }
  }, [candidate]);

  const name = candidate.name || candidate.fullName || 'Candidate';

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50 shrink-0">
          <div className="flex items-center gap-2.5">
            <FileText size={17} className="text-[#432DD7]" />
            <span className="font-bold text-slate-800 text-sm">{name} — Resume Preview</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 rounded-lg bg-[#432DD7] text-white px-4 py-1.5 text-xs font-semibold hover:bg-[#3621c0] transition-colors cursor-pointer"
            >
              <Download size={13} /> Download PDF
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer text-slate-500">
              <X size={16} />
            </button>
          </div>
        </div>
        {/* Preview */}
        <iframe ref={iframeRef} title="Resume Preview" className="flex-1 w-full border-0 bg-white" style={{ minHeight: '75vh' }} />
      </div>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

export default function SourcingAgentModal({ isOpen = true, onClose = () => {}, inline = false }) {
  const [view, setView] = useState('compose'); // compose | sourcing | results | recent
  const [composeStep, setComposeStep] = useState('input'); // input | parsed
  const [jobDescription, setJobDescription] = useState('');
  const [jdFile, setJdFile] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [searchingInternet, setSearchingInternet] = useState(false);
  const [bundle, setBundle] = useState(null);
  const [parsedDraft, setParsedDraft] = useState(null);
  // Raw text for skill textareas — allows typing commas freely without re-parse on every keystroke
  const [mustHaveRaw,  setMustHaveRaw]  = useState('');
  const [requiredRaw,  setRequiredRaw]  = useState('');
  const [preferredRaw, setPreferredRaw] = useState('');
  const [internetData, setInternetData] = useState(null);
  const [error, setError] = useState('');
  const [loadingStepIdx, setLoadingStepIdx] = useState(0);
  const [savedCandidates, setSavedCandidates] = useState(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedCards, setExpandedCards] = useState(new Set());
  const toggleCard = (key) => setExpandedCards((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const [resumeCandidate, setResumeCandidate] = useState(null);
  const searchAbortRef = useRef(null);

  // ── Recent Sessions ───────────────────────────────────────────────────────
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);

  const loadSessions = async () => {
    setSessionsLoading(true);
    try {
      const { data } = await api.get('/ai-source/sessions?limit=20');
      setSessions(data?.sessions || []);
    } catch {
      toast.error('Could not load recent searches.');
    } finally {
      setSessionsLoading(false);
    }
  };

  const openRecentView = () => {
    setView('recent');
    loadSessions();
  };

  const restoreSession = async (sessionId) => {
    setSessionLoading(true);
    try {
      const { data } = await api.get(`/ai-source/sessions/${sessionId}`);
      const session = data?.session;
      if (!session) return;
      const restoredData = {
        success: true,
        parseOnly: false,
        candidates: session.candidates || [],
        results:    session.candidates || [],
        parsedRequirements: session.parsedRequirements,
        dataSource: session.dataSource,
        summary: { totalExtracted: session.candidateCount },
      };
      setInternetData(restoredData);
      setCurrentPage(1);
      setView('results');
      toast.success(`Restored: ${session.jobTitle || 'Search session'}`);
    } catch {
      toast.error('Failed to load session.');
    } finally {
      setSessionLoading(false);
    }
  };

  const activeData = internetData;

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
      if (typeof parsed?.jobDescription === 'string') setJobDescription(parsed.jobDescription);
      if (parsed?.bundle) setBundle(parsed.bundle);
      if (parsed?.parsedDraft) setParsedDraft(parsed.parsedDraft);
      if (parsed?.internetData) setInternetData(parsed.internetData);
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
        internetData,
        savedCandidates: Array.from(savedCandidates),
      };
      localStorage.setItem(AI_SOURCE_STATE_KEY, JSON.stringify(snapshot));
    } catch {
      // Ignore persistence errors
    }
  }, [view, composeStep, jobDescription, bundle, parsedDraft, internetData, savedCandidates]);

  const handleClose = () => {
    setView('compose');
    setJobDescription('');
    setJdFile(null);
    setComposeStep('input');
    setExtracting(false);
    setSearchingInternet(false);
    setBundle(null);
    setParsedDraft(null);
    setInternetData(null);
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

  // Skip AI — initialise an empty form so the user can type skills directly
  const handleManualMode = () => {
    setParsedDraft({
      jobTitle: '', industry: '', location: '', experienceYears: 0,
      mustHaveSkills: [], requiredSkills: [], preferredSkills: [],
      jobType: '', salaryRange: '', education: '', availability: '',
    });
    setMustHaveRaw('');
    setRequiredRaw('');
    setPreferredRaw('');
    setComposeStep('parsed');
  };

  // canSearch: true when parsedDraft has at least one required or preferred skill
  const canSearch = Boolean(
    parsedDraft && (
      parsedDraft.requiredSkills?.length  > 0 ||
      parsedDraft.preferredSkills?.length > 0
    )
  );

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
      const er = data?.parsedRequirements || {};
      const mh = Array.isArray(er.mustHaveSkills)  ? er.mustHaveSkills  :
                 Array.isArray(er.must_have_skills) ? er.must_have_skills : [];
      const rq = Array.isArray(er.requiredSkills)  ? er.requiredSkills  :
                 Array.isArray(er.required_skills)  ? er.required_skills  : [];
      const pf = Array.isArray(er.preferredSkills) ? er.preferredSkills :
                 Array.isArray(er.preferred_skills) ? er.preferred_skills : [];
      setParsedDraft({
        ...er,
        experienceYears: Number(er.experienceYears || 0),
        mustHaveSkills: mh, requiredSkills: rq, preferredSkills: pf,
        dosa: { ...(er.dosa || {}) },
        availability: er.availability || er.dosa?.availability || '',
        jobType: er.durationType || '', salaryRange: er.salaryPackage || '', education: er.education || '',
      });
      // Sync raw textarea display
      setMustHaveRaw(mh.join(', '));
      setRequiredRaw(rq.join(', '));
      setPreferredRaw(pf.join(', '));
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
    if (!canSearch) { setError('Add at least one skill in Required Skills.'); return; }

    // Cancel any previous in-flight search
    if (searchAbortRef.current) searchAbortRef.current.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    setSearchingInternet(true);
    setLoadingStepIdx(0);
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
      }, { signal: controller.signal });
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
        toast('Requirements parsed. Add APOLLO_API_KEY or APIFY_API_KEY to enable candidate discovery.', { icon: 'ℹ️' });
      } else {
        toast.success(`Internet search complete. ${data?.summary?.totalExtracted || 0} candidates found.`);
      }
    } catch (err) {
      if (err.name === 'AbortError' || err.code === 'ERR_CANCELED') {
        // User navigated back — silently stop
        return;
      }
      const message = err.response?.data?.error || 'Failed to source candidates from internet.';
      setError(message);
      setView('compose');
      toast.error(message);
    } finally {
      setSearchingInternet(false);
      searchAbortRef.current = null;
    }
  };


  const handleSaveCandidate = async (candidate, { silent = false } = {}) => {
    const linkedInUrl = candidate.linkedinUrl || candidate.linkedInUrl;
    if (!linkedInUrl) return null;

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
        if (!silent) toast.success(`${candidate.name || candidate.fullName || 'Candidate'} saved.`);
        return savedId;
      } else {
        if (!silent) toast.error(data?.error || 'Could not save candidate.');
        return null;
      }
    } catch (err) {
      if (!silent) toast.error(err.response?.data?.error || 'Failed to save candidate');
      return null;
    }
  };

  const handleExportCSV = () => {
    if (!candidates.length) return;
    const escape = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const headers = ['Name', 'Job Title', 'Company', 'Location', 'Skills', 'Education', 'Total Experience', 'Match Score', 'About', 'LinkedIn URL', 'Email', 'Phone', 'Source Country', 'Pipeline Stage'];
    const rows = candidates.map((c) => [
      escape(c.name),
      escape(c.jobTitle || c.title),
      escape(c.company),
      escape(c.location),
      escape(Array.isArray(c.skills) ? c.skills.join(', ') : (c.skills || '')),
      escape(c.education),
      escape(c.totalExperience),
      escape(c.matchScore),
      escape(c.about || c.snippet || ''),
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
          <button
            onClick={view === 'recent' ? () => setView('compose') : openRecentView}
            className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/20 transition-all cursor-pointer shrink-0"
          >
            <History size={15} />
            {view === 'recent' ? 'Back' : 'Recent Searches'}
          </button>
        </div>

        <div className="h-[calc(100%-102px)] overflow-y-auto p-5 md:p-6 bg-[radial-gradient(circle_at_88%_10%,rgba(67,45,215,0.24),transparent_40%),radial-gradient(circle_at_10%_95%,rgba(130,113,255,0.18),transparent_35%)]">
          {error && (
            <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200 flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {view === 'recent' && (
            <div className="mx-auto max-w-4xl">
              <h3 className="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2">
                <History size={18} className="text-[#A99BFF]" />
                Recent Searches
              </h3>

              {sessionsLoading && (
                <div className="flex items-center justify-center py-16 text-slate-400">
                  <Loader2 size={22} className="animate-spin mr-3" />
                  Loading…
                </div>
              )}

              {!sessionsLoading && sessions.length === 0 && (
                <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-10 text-center text-slate-400">
                  <Clock size={32} className="mx-auto mb-3 opacity-40" />
                  <p className="text-sm">No recent searches yet. Run a sourcing search to see it here.</p>
                </div>
              )}

              {!sessionsLoading && sessions.length > 0 && (
                <div className="space-y-3">
                  {sessions.map((s) => (
                    <button
                      key={s._id}
                      onClick={() => restoreSession(s._id)}
                      disabled={sessionLoading}
                      className="w-full text-left rounded-2xl border border-slate-700 bg-slate-900/70 p-4 hover:border-[#6B5AF0]/70 hover:bg-slate-800/80 transition-all cursor-pointer disabled:opacity-60 group"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-100 truncate group-hover:text-[#A99BFF] transition-colors">
                            {s.jobTitle || 'Untitled Search'}
                          </p>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-slate-400">
                            {s.location && (
                              <span className="flex items-center gap-1">
                                <MapPin size={11} />
                                {s.location}
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <Globe size={11} />
                              {s.dataSource || 'unknown'}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock size={11} />
                              {new Date(s.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                        <span className="shrink-0 rounded-full bg-indigo-950/60 border border-indigo-700/40 px-3 py-1 text-xs font-semibold text-indigo-300">
                          {s.candidateCount} candidate{s.candidateCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {sessionLoading && (
                <div className="flex items-center justify-center py-6 text-slate-400 text-sm gap-2">
                  <Loader2 size={16} className="animate-spin" />
                  Loading session…
                </div>
              )}
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
                  ) : internetData ? (
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

                  <div className="flex flex-col sm:flex-row justify-center gap-3">
                    <button
                      onClick={handleExtractRequirements}
                      disabled={extracting || !canExtractRequirements}
                      className="min-w-[220px] rounded-xl bg-[#432DD7] hover:bg-[#5A45E5] disabled:bg-slate-700 disabled:text-slate-400 text-white px-6 py-3 text-sm font-semibold transition-colors inline-flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                    >
                      {extracting ? <Loader2 size={16} className="animate-spin" /> : <FileSearch size={16} />}
                      {extracting ? 'Extracting…' : 'Extract via AI'}
                    </button>
                    <button
                      onClick={handleManualMode}
                      disabled={extracting}
                      className="min-w-[220px] rounded-xl border border-slate-600 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 px-6 py-3 text-sm font-semibold transition-colors inline-flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                    >
                      <Database size={16} />
                      Enter Skills Manually
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
                      <label className="text-[11px] uppercase tracking-[0.16em] text-red-400">Must Have Skills <span className="text-slate-500 normal-case font-normal">(candidate rejected if ANY of these is missing)</span></label>
                      <textarea
                        value={mustHaveRaw}
                        onChange={(e) => setMustHaveRaw(e.target.value)}
                        onBlur={() => setParsedDraft((prev) => ({ ...(prev || {}), mustHaveSkills: parseSkillsText(mustHaveRaw) }))}
                        placeholder="e.g. Node.js, Python, React"
                        className="mt-1 h-16 w-full rounded-lg border border-red-800/50 bg-slate-950 px-3 py-2 text-sm text-slate-100 transition-colors hover:border-red-600/60 focus:outline-none focus:ring-2 focus:ring-red-700/50"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Required Skills <span className="text-slate-500 normal-case font-normal">(at least 30% match required to show candidate)</span></label>
                      <textarea
                        value={requiredRaw}
                        onChange={(e) => setRequiredRaw(e.target.value)}
                        onBlur={() => setParsedDraft((prev) => ({ ...(prev || {}), requiredSkills: parseSkillsText(requiredRaw) }))}
                        placeholder="e.g. Python, AWS, Docker"
                        className="mt-1 h-16 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 transition-colors hover:border-[#6B5AF0]/70 focus:outline-none focus:ring-2 focus:ring-[#432DD7]"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Preferred Skills <span className="text-slate-500 normal-case font-normal">(nice-to-have — 5 pts each)</span></label>
                      <textarea
                        value={preferredRaw}
                        onChange={(e) => setPreferredRaw(e.target.value)}
                        onBlur={() => setParsedDraft((prev) => ({ ...(prev || {}), preferredSkills: parseSkillsText(preferredRaw) }))}
                        placeholder="e.g. GraphQL, Redis, Kubernetes"
                        className="mt-1 h-16 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 transition-colors hover:border-[#6B5AF0]/70 focus:outline-none focus:ring-2 focus:ring-[#432DD7]"
                      />
                    </div>
                  </div>

                  <div className="mt-6 flex flex-col sm:flex-row justify-center gap-3">
                    {/* Internet sourcing — Google CSE / LinkedIn */}
                    <button
                      onClick={handleSearchInternet}
                      disabled={searchingInternet || extracting || !canSearch}
                      className="flex-1 max-w-xs rounded-xl bg-[#432DD7] hover:bg-[#5A45E5] disabled:opacity-60 text-white px-5 py-3 text-sm font-semibold transition-colors inline-flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                    >
                      {searchingInternet
                        ? <><Loader2 size={15} className="animate-spin" /> Searching Internet…</>
                        : <><Globe size={15} /> Search Internet</>
                      }
                    </button>
                  </div>

                </div>
              )}
            </div>
          )}

          {view === 'sourcing' && (() => {
            const LOADING_STEPS = [
              { label: 'Parsing job requirements',     sub: 'Extracting skills, location and seniority from your JD…',          duration: 6000  },
              { label: 'Searching LinkedIn profiles',  sub: 'Sending search to HarvestAPI with job title filters…',              duration: 10000 },
              { label: 'Fetching candidate profiles',  sub: 'Waiting for LinkedIn to return matching profiles…',                 duration: 22000 },
              { label: 'Running OSINT enrichment',     sub: 'Scanning GitHub and Stack Overflow for matching profiles…',         duration: 20000 },
              { label: 'AI enriching candidates',      sub: 'Using OpenAI to normalise and fill missing profile fields…',        duration: 12000 },
              { label: 'Scoring & matching',           sub: 'Ranking candidates by skill match, location and experience…',       duration: 8000  },
              { label: 'Finalising results',           sub: 'Saving to database and preparing your candidate list…',             duration: 99999 },
            ];
            return (
              <LoadingSteps
                steps={LOADING_STEPS}
                stepIdx={loadingStepIdx}
                onSetStepIdx={setLoadingStepIdx}
                onCancel={() => {
                  if (searchAbortRef.current) { searchAbortRef.current.abort(); searchAbortRef.current = null; }
                  setSearchingInternet(false);
                  setView('compose');
                }}
              />
            );
          })()}

          {view === 'results' && (
            <div className="space-y-5">
              {/* Top bar: Back + count */}
              <div className="flex items-center justify-between gap-3 px-1 flex-wrap">
                <button
                  onClick={() => setView('compose')}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-800 border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-all hover:border-slate-600 shadow-sm cursor-pointer"
                >
                  <ChevronLeft size={16} />
                  Back
                </button>

                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-slate-300">{candidates.length} candidates</p>
                  {activeData?.servedFromPool && (
                    <span className="inline-flex items-center gap-1 text-[11px] rounded-full border border-emerald-700/50 bg-emerald-950/40 text-emerald-300 px-2.5 py-0.5 font-semibold">
                      <Database size={10} /> Served from cache · 0 credits used
                    </span>
                  )}
                </div>
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
                  Candidate discovery is paused because no internet sourcing provider is configured. Add `APOLLO_API_KEY` or `APIFY_API_KEY`.
                </div>
              )}

              {!parseOnly && candidates.length > 0 && (
                <div className="space-y-3">
                  {pageCandidates.map((candidate, index) => {
                    const linkedInUrl = candidate.linkedinUrl || candidate.linkedInUrl;
                    const globalIndex = (currentPage - 1) * CANDIDATES_PER_PAGE + index + 1;

                    // ── Field resolution (handles both internet-sourced & internal DB) ──
                    const fullName    = candidate.fullName || candidate.name || 'Unknown';
                    const jobTitle    = candidate.jobTitle || candidate.title || '';
                    const company     = candidate.company || '';
                    const experience  = candidate.experience || candidate.totalExperience || (candidate.experienceYears ? `${candidate.experienceYears}+ years` : '');
                    const education   = candidate.education || extractEducationFromSnippet(candidate.snippet);
                    const location    = candidate.location || candidate.locality || '';

                    // Skills: DB candidates have a comma string; internet candidates have an array
                    const rawSkills = candidate.skills;
                    const skills = Array.isArray(rawSkills) && rawSkills.length > 0
                      ? rawSkills
                      : typeof rawSkills === 'string' && rawSkills.trim().length > 0
                        ? rawSkills.split(/[,;|·]+/).map(s => s.trim()).filter(Boolean)
                        : extractSkillsFromSnippet(candidate.snippet, jobTitle);

                    // Seniority label: prefer explicit field, else extract from title
                    const seniority = candidate.level || extractSeniority(jobTitle);

                    // Availability badges: prefer DB enum field, else parse snippet
                    const dbAvail = availabilityBadge(candidate.availability);
                    const snippetBadges = extractBadgesFromSnippet(candidate.snippet);
                    const badges = dbAvail ? [dbAvail, ...snippetBadges.filter(b => b.type === 'fresher')] : snippetBadges;

                    const initials = fullName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
                    const cardKey = linkedInUrl || fullName;
                    const isExpanded = expandedCards.has(cardKey);
                    const hasExpandable = candidate.about || candidate.headline || candidate.languages?.length > 0 || candidate.certifications?.length > 0 || candidate.experienceTimeline?.length > 0;

                    return (
                      <div key={`${linkedInUrl || fullName}-${index}`} className="rounded-2xl border border-slate-700/80 bg-slate-900/80 overflow-hidden transition-all duration-200 hover:border-[#6B5AF0]/60 hover:shadow-[0_0_0_1px_rgba(67,45,215,0.18)]">

                        {/* ── Card body ─────────────────────────────────── */}
                        <div className="p-4">

                          {/* Top section: avatar left + identity right */}
                          <div className="flex items-start gap-4">

                            {/* Avatar — larger */}
                            <div className="shrink-0 w-16 h-16 rounded-xl overflow-hidden border border-slate-700 bg-gradient-to-br from-indigo-700 to-purple-800 flex items-center justify-center text-white font-bold text-xl select-none">
                              {candidate.profilePic
                                ? <img src={candidate.profilePic} alt={fullName} className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                                : <span>{initials}</span>
                              }
                            </div>

                            {/* Identity: name, title, company, badges */}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">

                                  {/* Full name */}
                                  <h4 className="text-base font-bold text-slate-100 leading-tight">{fullName}</h4>

                                  {/* Job title · Company */}
                                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-0.5">
                                    {jobTitle && (
                                      <span className="flex items-center gap-1 text-sm text-slate-200 font-medium">
                                        <Briefcase size={12} className="text-[#8B7FE8] shrink-0" />{jobTitle}
                                      </span>
                                    )}
                                    {company && (
                                      <>
                                        {jobTitle && <span className="text-slate-600 text-xs">·</span>}
                                        <span className="flex items-center gap-1 text-sm text-slate-400">
                                          <Building2 size={12} className="text-slate-500 shrink-0" />{company}
                                        </span>
                                      </>
                                    )}
                                  </div>

                                  {/* Badges row */}
                                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                    {candidate.openToWork && (
                                      <span className="inline-flex items-center text-[10px] rounded-full border border-emerald-600/50 bg-emerald-950/40 text-emerald-300 px-2 py-0.5 font-semibold">#OpenToWork</span>
                                    )}
                                    {seniority && (
                                      <span className="inline-flex items-center text-[10px] rounded-full border border-amber-700/40 bg-amber-950/30 text-amber-300 px-2 py-0.5 font-semibold">{seniority}</span>
                                    )}
                                    {candidate.premium && (
                                      <span className="inline-flex items-center gap-0.5 text-[10px] rounded-full border border-yellow-600/60 bg-yellow-950/40 text-yellow-300 px-2 py-0.5 font-bold">
                                        <Star size={9} className="fill-yellow-400 text-yellow-400" />Premium
                                      </span>
                                    )}
                                    {candidate.verified && (
                                      <span className="inline-flex items-center gap-0.5 text-[10px] rounded-full border border-sky-600/50 bg-sky-950/30 text-sky-300 px-2 py-0.5 font-bold">
                                        <BadgeCheck size={10} />Verified
                                      </span>
                                    )}
                                    {badges.filter(b => !(b.type === 'availability' && candidate.openToWork)).map((b) => (
                                      <span key={b.label} className={`inline-flex items-center text-[10px] rounded-full border px-2 py-0.5 font-semibold ${
                                        b.type === 'immediate'    ? 'border-sky-700/50 bg-sky-950/35 text-sky-300' :
                                        b.type === 'availability' ? 'border-emerald-700/50 bg-emerald-950/35 text-emerald-300' :
                                        b.type === 'fresher'      ? 'border-blue-700/40 bg-blue-950/30 text-blue-300' :
                                                                     'border-slate-600 bg-slate-800 text-slate-300'
                                      }`}>{b.label}</span>
                                    ))}
                                    {isPremiumInstitute(education) && (
                                      <span className="inline-flex items-center gap-1 text-[10px] rounded-full border border-amber-500/50 bg-amber-950/40 text-amber-300 px-2 py-0.5 font-bold">
                                        <GraduationCap size={9} />{education}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <MatchBadge score={candidate.matchScore} category={candidate.matchCategory} />
                              </div>
                            </div>
                          </div>

                          {/* Meta rows — below image, full width, left-aligned */}
                          <div className="flex flex-col gap-y-1.5 mt-3 text-xs text-slate-400">
                            {/* Education */}
                            {education && !isPremiumInstitute(education) && (
                              <span className="flex items-center gap-1.5 flex-wrap">
                                <GraduationCap size={13} className="text-[#A99BFF] shrink-0" />
                                <span>{education}</span>
                                {candidate.educationYear && <span className="text-slate-500">· {candidate.educationYear}</span>}
                                {candidate.educationGrade && <span className="text-emerald-400 font-medium">{candidate.educationGrade}</span>}
                              </span>
                            )}
                            {/* Experience + Connections */}
                            {(experience || candidate.connectionsCount > 0) && (
                              <div className="flex items-center gap-x-4 flex-wrap gap-y-1">
                                {experience && (
                                  <span className="flex items-center gap-1.5">
                                    <Clock size={13} className="text-emerald-400 shrink-0" />
                                    <span className="text-slate-500 font-medium">Total Experience:</span>
                                    <span className="text-slate-300">{experience}</span>
                                  </span>
                                )}
                                {candidate.connectionsCount > 0 && (
                                  <span className="flex items-center gap-1.5">
                                    <Linkedin size={13} className="text-[#0A66C2] shrink-0" />
                                    <span className="text-slate-300">{candidate.connectionsCount.toLocaleString()} connections</span>
                                    {candidate.followerCount > 0 && <span className="text-slate-500">· {candidate.followerCount.toLocaleString()} followers</span>}
                                  </span>
                                )}
                              </div>
                            )}
                            {/* Location */}
                            {location && (
                              <span className={`flex items-center gap-1.5 ${candidate.locationUnverified ? 'text-amber-500/80' : ''}`}>
                                <MapPin size={13} className={candidate.locationUnverified ? 'text-amber-400 shrink-0' : 'text-rose-400 shrink-0'} />
                                <span className={candidate.locationUnverified ? '' : 'text-slate-300'}>{location}</span>
                                {candidate.locationUnverified && <span className="italic text-[10px] text-amber-500/60">(unverified)</span>}
                              </span>
                            )}
                          </div>

                          {/* Skills */}
                          {skills.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {skills.map((skill) => {
                                const isMatched = candidate.matchedSkills?.some(m => m.toLowerCase() === skill.toLowerCase());
                                return (
                                  <span key={skill} className={`text-[11px] rounded-md border px-2 py-0.5 ${
                                    isMatched
                                      ? 'border-[#A89EFF] bg-[#432DD7]/30 text-white font-semibold'
                                      : 'border-[#6B5AF0]/40 bg-[#432DD7]/15 text-[#C4B8FF]'
                                  }`}>{skill}</span>
                                );
                              })}
                            </div>
                          )}
                          {candidate.missingSkills?.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {candidate.missingSkills.map((skill) => (
                                <span key={skill} className="text-[10px] rounded-md border border-red-700/40 bg-red-950/20 text-red-400 px-2 py-0.5 italic">missing: {skill}</span>
                              ))}
                            </div>
                          )}

                          {/* Expandable: Headline · About · Languages */}
                          {hasExpandable && (
                            <div className="mt-2.5">
                              <button
                                onClick={() => toggleCard(cardKey)}
                                className="flex items-center gap-1 text-[11px] text-[#9B8FEF] hover:text-[#C4B8FF] font-medium cursor-pointer"
                              >
                                <ChevronDown size={13} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                {isExpanded ? 'Hide full profile' : 'View full profile'}
                              </button>
                              {isExpanded && (
                                <div className="mt-2 space-y-4 border-t border-slate-700/40 pt-3">
                                  {candidate.headline && (
                                    <div>
                                      <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-1">Headline</p>
                                      <p className="text-sm text-slate-300 leading-relaxed">{candidate.headline}</p>
                                    </div>
                                  )}
                                  {candidate.about && (
                                    <div>
                                      <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-1">About</p>
                                      <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">{candidate.about}</p>
                                    </div>
                                  )}
                                  {candidate.languages?.length > 0 && (
                                    <div>
                                      <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-1.5">Languages</p>
                                      <div className="flex flex-wrap gap-1.5">
                                        {candidate.languages.map((lang, i) => (
                                          <span key={i} className="text-xs rounded-md border border-slate-600 bg-slate-800 text-slate-300 px-2 py-0.5">{lang}</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {candidate.experienceTimeline?.length > 0 && (
                                    <div>
                                      <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Experience</p>
                                      <div className="space-y-0">
                                        {candidate.experienceTimeline.map((exp, i) => {
                                          const dateRange = exp.startDateText
                                            ? `${exp.startDateText} – ${exp.endDateText || 'Present'}`
                                            : null;
                                          const timeLabel = [dateRange, exp.duration].filter(Boolean).join(' · ');
                                          return (
                                            <div key={i} className="flex gap-3">
                                              {/* Timeline spine */}
                                              <div className="flex flex-col items-center shrink-0 pt-1">
                                                <div className={`w-2.5 h-2.5 rounded-full border-2 ${exp.isCurrent ? 'border-indigo-400 bg-indigo-500' : 'border-slate-500 bg-slate-700'}`} />
                                                {i < candidate.experienceTimeline.length - 1 && <div className="w-px flex-1 bg-slate-700/50 my-1" style={{ minHeight: '20px' }} />}
                                              </div>
                                              {/* Company logo */}
                                              {exp.companyLogo && (
                                                <img src={exp.companyLogo} alt={exp.company || ''} className="w-8 h-8 rounded object-contain bg-white/5 border border-slate-700 shrink-0 mt-0.5" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                                              )}
                                              {/* Content */}
                                              <div className="pb-3 min-w-0 flex-1">
                                                <p className="text-sm text-slate-100 font-semibold leading-tight">{exp.title || '—'}</p>
                                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                                                  {exp.company && <p className="text-sm text-slate-400">{exp.company}</p>}
                                                  {exp.employmentType && <span className="text-[11px] text-slate-500">· {exp.employmentType}</span>}
                                                </div>
                                                {timeLabel && <p className="text-xs text-slate-500 mt-0.5">{timeLabel}</p>}
                                                {exp.workplaceType && (
                                                  <span className="mt-1 inline-block text-[11px] border border-slate-700 rounded px-1.5 py-0.5 text-slate-500">{exp.workplaceType}</span>
                                                )}
                                                {exp.description && (
                                                  <p className="mt-1 text-xs text-slate-500 leading-relaxed">{exp.description}</p>
                                                )}
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                  {candidate.certifications?.length > 0 && (
                                    <div>
                                      <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Certifications</p>
                                      <div className="space-y-2">
                                        {candidate.certifications.map((cert, i) => (
                                          <div key={i} className="flex items-start gap-2">
                                            <Award size={13} className="text-amber-400 shrink-0 mt-0.5" />
                                            <div className="min-w-0">
                                              <p className="text-sm text-slate-300 font-medium leading-tight">{cert.title || '—'}</p>
                                              {cert.issuedBy && <p className="text-xs text-slate-500 mt-0.5">{cert.issuedBy}{cert.issuedAt ? ` · ${cert.issuedAt}` : ''}</p>}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* ── Footer ──────────────────────────────────── */}
                        <div className="px-4 py-2.5 border-t border-slate-800 bg-slate-950/50 flex flex-wrap items-center gap-x-3 gap-y-2">
                          {/* Left: LinkedIn + GitHub + Resume */}
                          <div className="flex items-center gap-3">
                            {linkedInUrl ? (
                              <a href={linkedInUrl} target="_blank" rel="noreferrer" className="text-xs text-[#B9AEFF] hover:text-white hover:underline font-medium shrink-0">
                                🔗 LinkedIn
                              </a>
                            ) : (
                              <span className="text-xs text-slate-600">No profile URL</span>
                            )}
                            {candidate.githubUrl && (
                              <>
                                <span className="text-slate-700 text-xs">·</span>
                                <a href={candidate.githubUrl} target="_blank" rel="noreferrer" className="text-xs text-slate-400 hover:text-white hover:underline font-medium">
                                  GitHub
                                </a>
                              </>
                            )}
                            <span className="text-slate-700 text-xs">·</span>
                            <button
                              onClick={() => setResumeCandidate(candidate)}
                              className="flex items-center gap-1 text-xs text-violet-300 hover:text-white font-medium cursor-pointer transition-colors"
                            >
                              <FileText size={12} /> Resume
                            </button>
                          </div>

                          {/* Right: contact */}
                          {candidate.email || candidate.phone ? (
                            <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
                              {candidate.email && (
                                <a href={`mailto:${candidate.email}`} className="flex items-center gap-1 text-xs text-emerald-300 hover:text-emerald-200 min-w-0">
                                  <Mail size={11} className="shrink-0" />
                                  <span className="truncate max-w-[200px]">{candidate.email}</span>
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

    {/* Resume preview modal */}
    {resumeCandidate && (
      <ResumeModal candidate={resumeCandidate} onClose={() => setResumeCandidate(null)} />
    )}
  );
}

import { useState } from "react";
import { Search, Save, Edit2, Loader, User, Linkedin, Mail, Phone, MapPin, Briefcase, Building } from "lucide-react";
import api from "../api/axios";
import toast from "react-hot-toast";

const Enrich = () => {
    const [inputs, setInputs] = useState({
        fullName: "",
        email: "",
        linkedinUrl: "",
        phone: ""
    });
    const [loading, setLoading] = useState(false);
    const [candidate, setCandidate] = useState(null);
    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState({});

    const handleInputChange = (e) => {
        setInputs({ ...inputs, [e.target.name]: e.target.value });
    };

    const handleSearch = async (e) => {
        e.preventDefault();
        
        // Prioritize search terms: Email > LinkedIn > Phone > Name
        const query = inputs.email || inputs.linkedinUrl || inputs.phone || inputs.fullName;

        if (!query) {
            toast.error("Please enter at least one detail to search");
            return;
        }

        setLoading(true);
        setCandidate(null);
        setIsEditing(false);

        try {
            const { data } = await api.get('/candidates/search', {
                params: { q: query, limit: 1 }
            });

            if (data.candidates && data.candidates.length > 0) {
                setCandidate(data.candidates[0]);
                setFormData(data.candidates[0]);
                toast.success("Candidate found");
            } else {
                toast.error("No candidate found matching your criteria");
            }
        } catch (error) {
            console.error("Search error:", error);
            toast.error("Failed to search candidate");
        } finally {
            setLoading(false);
        }
    };

    const handleEditChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSave = async () => {
        if (!candidate?._id) return;
        
        setLoading(true);
        try {
            const { data } = await api.put(`/candidates/${candidate._id}`, formData);
            setCandidate(data);
            setFormData(data);
            setIsEditing(false);
            toast.success("Candidate details updated");
        } catch (error) {
            console.error("Update error:", error);
            toast.error("Failed to update candidate");
        } finally {
            setLoading(false);
        }
    };

    const renderField = (label, name, icon) => (
        <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-1">
                {icon} {label}
            </label>
            {isEditing ? (
                <input
                    type="text"
                    name={name}
                    value={formData[name] || ""}
                    onChange={handleEditChange}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
            ) : (
                <div className="text-slate-900 dark:text-slate-100 text-sm font-medium py-2 border-b border-slate-100 dark:border-slate-800 break-words">
                    {candidate[name] || <span className="text-slate-400 italic">Not provided</span>}
                </div>
            )}
        </div>
    );

    return (
        <div className="p-6 max-w-5xl mx-auto animate-in fade-in duration-500">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Enrich Candidate</h1>
                <p className="text-slate-500 dark:text-slate-400">Search for a candidate in your database to view or update their details.</p>
            </div>

            {/* Search Section */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-800 mb-8">
                <form onSubmit={handleSearch} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Full Name</label>
                        <input
                            name="fullName"
                            placeholder="e.g. John Doe"
                            value={inputs.fullName}
                            onChange={handleInputChange}
                            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Email Address</label>
                        <input
                            name="email"
                            placeholder="e.g. john@example.com"
                            value={inputs.email}
                            onChange={handleInputChange}
                            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">LinkedIn URL</label>
                        <input
                            name="linkedinUrl"
                            placeholder="e.g. linkedin.com/in/johndoe"
                            value={inputs.linkedinUrl}
                            onChange={handleInputChange}
                            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Phone Number</label>
                        <input
                            name="phone"
                            placeholder="e.g. +1 234 567 890"
                            value={inputs.phone}
                            onChange={handleInputChange}
                            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                    </div>
                    <div className="md:col-span-2 flex justify-end mt-2">
                        <button
                            type="submit"
                            disabled={loading}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-xl font-semibold transition-all shadow-lg shadow-indigo-500/20 flex items-center gap-2 disabled:opacity-70 active:scale-95"
                        >
                            {loading ? <Loader className="animate-spin" size={20} /> : <Search size={20} />}
                            Search Database
                        </button>
                    </div>
                </form>
            </div>

            {/* Result Section */}
            {candidate && (
                <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden animate-in slide-in-from-bottom-4 duration-500">
                    <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-950/50">
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Candidate Details</h2>
                        {!isEditing ? (
                            <button
                                onClick={() => setIsEditing(true)}
                                className="text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                            >
                                <Edit2 size={16} /> Edit Details
                            </button>
                        ) : (
                            <div className="flex gap-2">
                                <button
                                    onClick={() => {
                                        setIsEditing(false);
                                        setFormData(candidate);
                                    }}
                                    className="text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={loading}
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 shadow-md shadow-emerald-500/20"
                                >
                                    {loading ? <Loader className="animate-spin" size={16} /> : <Save size={16} />}
                                    Save Changes
                                </button>
                            </div>
                        )}
                    </div>
                    
                    <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                        {renderField("Full Name", "fullName", <User size={14} />)}
                        {renderField("Job Title", "jobTitle", <Briefcase size={14} />)}
                        {renderField("Company", "company", <Building size={14} />)}
                        {renderField("Location", "location", <MapPin size={14} />)}
                        {renderField("Email", "email", <Mail size={14} />)}
                        {renderField("Phone", "phone", <Phone size={14} />)}
                        {renderField("LinkedIn URL", "linkedinUrl", <Linkedin size={14} />)}
                        
                        <div className="md:col-span-2 space-y-1">
                            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Skills</label>
                            {isEditing ? (
                                <textarea
                                    name="skills"
                                    value={formData.skills || ""}
                                    onChange={handleEditChange}
                                    rows={3}
                                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                                />
                            ) : (
                                <div className="text-slate-900 dark:text-slate-100 text-sm font-medium py-2 border-b border-slate-100 dark:border-slate-800 leading-relaxed">
                                    {candidate.skills || <span className="text-slate-400 italic">Not provided</span>}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Enrich;

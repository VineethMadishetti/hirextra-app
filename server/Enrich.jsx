import { useState } from "react";
import { Search, Save, X, Edit2, Loader } from "lucide-react";
import api from "../api/axios";

const Enrich = () => {
	const [inputs, setInputs] = useState({
		fullName: "",
		linkedInUrl: "",
		uniqueKey: "",
	});
	const [loading, setLoading] = useState(false);
	const [data, setData] = useState(null);
	const [isEditing, setIsEditing] = useState(false);
	const [formData, setFormData] = useState({});
	const [error, setError] = useState("");

	const handleInputChange = (e) => {
		const { name, value } = e.target;
		setInputs((prev) => ({
			...prev,
			[name]: value,
		}));
	};

	const handleSearch = async () => {
		if (!inputs.fullName && !inputs.linkedInUrl && !inputs.uniqueKey) {
			setError("Please enter at least one field to search.");
			return;
		}

		setLoading(true);
		setError("");
		setData(null);

		try {
			// Construct query params
			const params = {};
			if (inputs.fullName) params.name = inputs.fullName;
			if (inputs.linkedInUrl) params.linkedin = inputs.linkedInUrl;
			if (inputs.uniqueKey) params.id = inputs.uniqueKey;

			// Using the existing search endpoint structure
			const response = await api.get("/candidates/search", { params });
			
			// Handle response structure (assuming array or single object)
			const candidates = response.data.candidates || response.data;
			const result = Array.isArray(candidates) ? candidates[0] : candidates;

			if (result) {
				setData(result);
				setFormData(result);
			} else {
				setError("No candidate found with these details.");
			}
		} catch (err) {
			console.error("Search error:", err);
			setError("An error occurred while searching. Please try again.");
		} finally {
			setLoading(false);
		}
	};

	const handleEditChange = (e) => {
		const { name, value } = e.target;
		setFormData((prev) => ({
			...prev,
			[name]: value,
		}));
	};

	const handleSave = async () => {
		setLoading(true);
		try {
			// Update endpoint
			await api.put(`/candidates/${data._id || data.id}`, formData);
			setData(formData);
			setIsEditing(false);
			setError("");
		} catch (err) {
			console.error("Update error:", err);
			setError("Failed to save changes.");
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="p-6 max-w-5xl mx-auto animate-in fade-in duration-500">
			<div className="mb-8">
				<h2 className="text-3xl font-bold text-slate-800 dark:text-white mb-2">
					Enrich Candidate Data
				</h2>
				<p className="text-slate-500 dark:text-slate-400">
					Search for a candidate in the database and update their details.
				</p>
			</div>

			{/* Search Card */}
			<div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 p-6 mb-8">
				<div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
					<div className="space-y-2">
						<label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
							Full Name
						</label>
						<input
							type="text"
							name="fullName"
							value={inputs.fullName}
							onChange={handleInputChange}
							placeholder="e.g. John Doe"
							className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
						/>
					</div>
					<div className="space-y-2">
						<label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
							LinkedIn URL
						</label>
						<input
							type="text"
							name="linkedInUrl"
							value={inputs.linkedInUrl}
							onChange={handleInputChange}
							placeholder="e.g. linkedin.com/in/johndoe"
							className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
						/>
					</div>
					<div className="space-y-2">
						<label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
							Unique Key / ID
						</label>
						<input
							type="text"
							name="uniqueKey"
							value={inputs.uniqueKey}
							onChange={handleInputChange}
							placeholder="Candidate ID"
							className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
						/>
					</div>
				</div>

				<div className="flex justify-end">
					<button
						onClick={handleSearch}
						disabled={loading}
						className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl shadow-lg shadow-indigo-500/20 transition-all disabled:opacity-70 disabled:cursor-not-allowed active:scale-95"
					>
						{loading ? <Loader className="animate-spin" size={20} /> : <Search size={20} />}
						Search Database
					</button>
				</div>
			</div>

			{/* Error Message */}
			{error && (
				<div className="p-4 mb-8 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl border border-red-200 dark:border-red-800 flex items-center gap-3">
					<div className="w-2 h-2 rounded-full bg-red-500" />
					{error}
				</div>
			)}

			{/* Results Section */}
			{data && (
				<div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden animate-in slide-in-from-bottom-4 duration-500">
					<div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-950/50">
						<h3 className="font-bold text-lg text-slate-800 dark:text-white">Candidate Details</h3>
						{!isEditing ? (
							<button onClick={() => setIsEditing(true)} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 rounded-lg transition-colors">
								<Edit2 size={16} /> Edit Details
							</button>
						) : (
							<div className="flex gap-3">
								<button onClick={() => { setIsEditing(false); setFormData(data); setError(""); }} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
									<X size={16} /> Cancel
								</button>
								<button onClick={handleSave} disabled={loading} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 rounded-lg shadow-md shadow-green-500/20 transition-all">
									{loading ? <Loader className="animate-spin" size={16} /> : <Save size={16} />} Save Changes
								</button>
							</div>
						)}
					</div>
					<div className="p-8">
						<div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
							{Object.keys(formData).map((key) => {
								if (["_id", "__v", "createdAt", "updatedAt"].includes(key) || typeof formData[key] === "object") return null;
								return (
									<div key={key} className="group">
										<label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">{key.replace(/([A-Z])/g, " $1").trim()}</label>
										{isEditing ? (
											<input type="text" name={key} value={formData[key] || ""} onChange={handleEditChange} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all" />
										) : (
											<div className="text-slate-900 dark:text-slate-100 font-medium text-base break-words py-1 border-b border-transparent group-hover:border-slate-100 dark:group-hover:border-slate-800 transition-colors">
												{data[key] || <span className="text-slate-400 italic text-sm">Not provided</span>}
											</div>
										)}
									</div>
								);
							})}
						</div>
					</div>
				</div>
			)}
		</div>
	);
};

export default Enrich;
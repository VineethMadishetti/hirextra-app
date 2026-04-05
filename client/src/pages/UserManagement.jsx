import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/axios";
import {
	UserPlus,
	Trash2,
	Mail,
	User,
	Shield,
	X,
	CheckCircle,
	Eye,
	EyeOff,
	ChevronDown,
	Database,
	Lock,
	Unlock,
	Users,
	Upload,
	Clock,
	CircleDollarSign,
	PlusCircle,
	Loader,
	Zap,
	ZapOff,
	RotateCcw,
	AlertTriangle,
	UserCheck,
	UserX,
} from "lucide-react";
import toast from 'react-hot-toast';

// Custom Select Component for Role
const RoleSelect = ({ value, onChange }) => {
	const [isOpen, setIsOpen] = useState(false);
	const ref = useRef(null);

	useEffect(() => {
		const handleClickOutside = (event) => {
			if (ref.current && !ref.current.contains(event.target)) {
				setIsOpen(false);
			}
		};
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	const options = [
		{ value: "USER", label: "User (View & Export Only)" },
		{ value: "ADMIN", label: "Admin (Full Access)" },
	];

	const selectedLabel = options.find((o) => o.value === value)?.label || "Select Role";

	return (
		<div className="relative" ref={ref}>
			<div
				onClick={() => setIsOpen(!isOpen)}
				className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-700
                       rounded-xl px-4 py-2.5 text-slate-800 dark:text-white
                       focus:ring-2 focus:ring-indigo-500/40
                       outline-none transition cursor-pointer flex justify-between items-center"
			>
				<span className="truncate">{selectedLabel}</span>
				<ChevronDown
					size={16}
					className={`text-slate-500 dark:text-slate-400 transition-transform duration-200 ${
						isOpen ? "rotate-180" : ""
					}`}
				/>
			</div>
			{isOpen && (
				<div className="absolute z-50 mt-1 w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-100">
					{options.map((option) => (
						<div
							key={option.value}
							className={`px-4 py-2.5 text-sm cursor-pointer transition-colors ${
								value === option.value
									? "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 font-medium"
									: "text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50"
							}`}
							onClick={() => {
								onChange({ target: { value: option.value } });
								setIsOpen(false);
							}}
						>
							{option.label}
						</div>
					))}
				</div>
			)}
		</div>
	);
};

const UserManagement = () => {
	const queryClient = useQueryClient();
	const { data: users = [], isLoading: loading } = useQuery({
		queryKey: ["users"],
		queryFn: async () => {
			const { data } = await api.get("/auth/users");
			return Array.isArray(data) ? data : [];
		},
		staleTime: 0,
	});
	const { data: userStats = {}, isLoading: statsLoading } = useQuery({
		queryKey: ["user-stats"],
		queryFn: async () => {
			const { data } = await api.get("/admin/user-stats");
			return data;
		},
		staleTime: 0,
	});
	const [showCreateModal, setShowCreateModal] = useState(false);
	const [showPasswordModal, setShowPasswordModal] = useState(false);
	const [showCreditsModal, setShowCreditsModal] = useState(false);
	const [creditsTarget, setCreditsTarget] = useState(null);
	const [creditsAmount, setCreditsAmount] = useState('');
	const [creditsDesc, setCreditsDesc] = useState('');
	const [creditsError, setCreditsError] = useState('');
	const [creditsLoading, setCreditsLoading] = useState(false);
	const [historyPage, setHistoryPage] = useState(1);
	const [historyTypeFilter, setHistoryTypeFilter] = useState('');
	const [showResetConfirm, setShowResetConfirm] = useState(false);
	const [resetting, setResetting] = useState(false);

	const { data: creditHistoryData, isLoading: historyLoading } = useQuery({
		queryKey: ['credit-all-history', historyPage, historyTypeFilter],
		queryFn: async () => {
			const params = new URLSearchParams({ page: historyPage, limit: 50 });
			if (historyTypeFilter) params.set('type', historyTypeFilter);
			const { data } = await api.get(`/credits/all-history?${params}`);
			return data;
		},
		staleTime: 30 * 1000,
	});
const [passwordInput, setPasswordInput] = useState("");
const [passwordError, setPasswordError] = useState("");
const [isConfirming, setIsConfirming] = useState(false);
const [userToDelete, setUserToDelete] = useState(null);

	const [formData, setFormData] = useState({
		name: "",
		email: "",
		password: "",
		confirmPassword: "",
		role: "USER",
	});

	const [showPassword, setShowPassword] = useState(false);
	const [showConfirmPassword, setShowConfirmPassword] = useState(false);

	const handleCreateUser = async (e) => {
		e.preventDefault();
		if (!formData.name || !formData.email || !formData.password) {
			return toast.error("Please fill all required fields");
		}

		if (formData.password !== formData.confirmPassword) {
			return toast.error("Passwords do not match");
		}

		try {
			const { confirmPassword, ...submitData } = formData;
			const { data } = await api.post("/auth/users", submitData);
			toast.success("User created successfully");
			setShowCreateModal(false);
			setFormData({ name: "", email: "", password: "", confirmPassword: "", role: "USER" });
			setShowPassword(false);
			setShowConfirmPassword(false);
			queryClient.invalidateQueries({ queryKey: ["users"] });
		} catch (error) {
			toast.error(error.response?.data?.message || "Failed to create user");
		}
	};

	const confirmDeleteUser = async () => {
		if (!passwordInput.trim()) {
			setPasswordError("Password is required");
			return;
		}

		try {
			setIsConfirming(true);
			setPasswordError("");

			// First verify the password
			await api.post("/auth/verify-password", { password: passwordInput });

			// If password is correct, proceed with deletion
			await api.delete(`/auth/users/${userToDelete._id}`, {
				headers: {
					'Content-Type': 'application/json'
				}
			});

			toast.success("User deleted successfully");
			setShowPasswordModal(false);
			setUserToDelete(null);
			setPasswordInput("");
			queryClient.invalidateQueries({ queryKey: ["users"] });
		} catch (err) {
			setPasswordError(err.response?.data?.message || "Incorrect password");
		} finally {
			setIsConfirming(false);
		}
	};

	const getRoleBadge = (role) => {
		const colors = {
			SUPER_ADMIN: "bg-rose-500/10 text-rose-400",
			ADMIN: "bg-purple-500/10 text-purple-400",
			USER: "bg-blue-500/10 text-blue-400",
		};
		return colors[role] || "bg-slate-500/10 text-slate-400";
	};

	const formatDate = (dateString) => {
		if (!dateString) return "—";
		const date = new Date(dateString);
		const day = String(date.getDate()).padStart(2, '0');
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const year = date.getFullYear();
		return `${day}-${month}-${year}`;
	};

	const formatLastLogin = (dateString) => {
		if (!dateString) return { display: "Never", tooltip: null };
		const date = new Date(dateString);
		const now = new Date();
		const diffMs = now - date;
		const diffMins = Math.floor(diffMs / 60000);

		// Exact datetime: "2 Apr 2026, 3:45 PM"
		const display = date.toLocaleString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			hour12: true,
		});

		// Relative time for tooltip
		let relative;
		if (diffMins < 1) relative = "Just now";
		else if (diffMins < 60) relative = `${diffMins}m ago`;
		else {
			const diffHrs = Math.floor(diffMins / 60);
			if (diffHrs < 24) relative = `${diffHrs}h ago`;
			else {
				const diffDays = Math.floor(diffHrs / 24);
				relative = `${diffDays}d ago`;
			}
		}

		return { display, tooltip: relative };
	};

	return (
		<div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white p-4 md:p-6">
			<div className="max-w-7xl mx-auto h-full flex flex-col">
				{/* Header */}
				<div className="bg-white dark:bg-slate-800 backdrop-blur rounded-2xl p-5 mb-6 shadow-xl border border-slate-200 dark:border-slate-700">
					<div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
						<div>
							<h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-1">
								User Management
							</h2>
							<p className="text-sm text-slate-500 dark:text-slate-400">
								Manage system users and permissions
							</p>
						</div>

						<div className="flex items-center gap-3 w-full sm:w-auto">
							<button
								onClick={() => setShowResetConfirm(true)}
								className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-rose-200 dark:border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 text-sm font-medium transition cursor-pointer">
								<RotateCcw size={15} />
								Reset Credits
							</button>
							<button
								onClick={() => setShowCreateModal(true)}
								className="flex-1 sm:flex-none bg-indigo-600 hover:bg-indigo-500
                 text-white px-5 py-2.5 rounded-xl
                 font-medium shadow-lg
                 hover:shadow-indigo-500/30
                 transition cursor-pointer
                 flex items-center gap-2">
								<UserPlus size={18} />
								Create User
							</button>
						</div>
					</div>
				</div>

				<div className="flex-1 flex flex-col overflow-hidden">
					<div className="w-full flex flex-col flex-1">
						<div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xl flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-slate-950 [&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-600 [scrollbar-width:thin] [scrollbar-color:#334155_#020617]">
							<div className="hidden md:grid grid-cols-12 gap-4 px-5 py-3 border-b border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
								<div className="col-span-2">User</div>
								<div className="col-span-2">Last Active</div>
								<div className="col-span-1">Credits</div>
								<div className="col-span-1 text-center">Status</div>
								<div className="col-span-1 text-center">Databases</div>
								<div className="col-span-1 text-center">Uploads</div>
								<div className="col-span-1">Joined</div>
								<div className="col-span-1 text-center">Role</div>
								<div className="col-span-2 text-center">Action</div>
							</div>
							{loading ? (
								<div className="p-12 text-center">
									<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mx-auto"></div>
								</div>
							) : !Array.isArray(users) || users.length === 0 ? (
								<div className="p-12 text-center">
									<User className="w-14 h-14 text-slate-400 dark:text-slate-500 mx-auto mb-4" />
									<p className="text-slate-500 dark:text-slate-400 font-medium">No users found</p>
								</div>
							) : (
								<div className="divide-y divide-slate-100 dark:divide-slate-700/50">
									{users.map((user) => {
										const uid = String(user._id);
										const dbCount = statsLoading ? null : (userStats?.databases?.[uid] ?? 0);
										const uploadCount = statsLoading ? null : (userStats?.uploads?.[uid] ?? 0);
										return (
											<div
												key={user._id}
												className={`grid grid-cols-1 md:grid-cols-12 gap-2 px-5 py-4 items-center transition ${
													user.status === 'pending'
														? 'hover:bg-amber-50/40 dark:hover:bg-amber-500/5 border-l-2 border-amber-400'
														: 'hover:bg-slate-50 dark:hover:bg-slate-700/30'
												}`}>
												{/* User Info */}
												<div className="md:col-span-2 flex items-center gap-3 min-w-0">
													<div className="bg-indigo-100 dark:bg-indigo-500/20 p-2 rounded-lg shrink-0">
														<User size={16} className="text-indigo-500 dark:text-indigo-400" />
													</div>
													<div className="min-w-0">
														<p className="font-medium text-slate-800 dark:text-white truncate">{user.name}</p>
														<p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 truncate">
															<Mail size={11} />
															<span className="truncate">{user.email}</span>
														</p>
													</div>
												</div>
												{/* Last Login */}
												<div className="md:col-span-2 flex items-center gap-1.5 text-sm">
													<Clock size={13} className="text-slate-400 shrink-0" />
													{(() => {
														const { display, tooltip } = formatLastLogin(user.lastLoginAt);
														return (
															<span
																className={user.lastLoginAt ? "text-slate-700 dark:text-slate-300" : "text-slate-400 dark:text-slate-500"}
																title={tooltip || undefined}
															>
																{display}
															</span>
														);
													})()}
												</div>
												{/* Credits */}
												<div className="md:col-span-1 flex items-center gap-1">
													{user.creditFree ? (
														<span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5">
															<Zap size={9} />FREE
														</span>
													) : (
														<>
															<CircleDollarSign size={13} className="text-amber-500 shrink-0" />
															<span className="text-sm font-medium text-slate-700 dark:text-slate-300">{user.credits ?? 0}</span>
															<button
																onClick={() => { setCreditsTarget(user); setCreditsAmount(''); setCreditsDesc(''); setCreditsError(''); setShowCreditsModal(true); }}
																title={user.status === 'active' ? 'Add credits' : 'Account must be active to add credits'}
																disabled={user.status !== 'active'}
																className="ml-0.5 text-indigo-400 hover:text-indigo-600 transition disabled:opacity-30 disabled:cursor-not-allowed">
																<PlusCircle size={13} />
															</button>
														</>
													)}
												</div>
												{/* Status */}
												<div className="md:col-span-1 flex justify-center">
													{user.status === 'pending' ? (
														<span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400 uppercase tracking-wide">
															Waiting
														</span>
													) : user.status === 'rejected' ? (
														<span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 dark:bg-rose-500/15 text-rose-600 dark:text-rose-400 uppercase tracking-wide">
															Rejected
														</span>
													) : (
														<span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">
															Active
														</span>
													)}
												</div>
												{/* Databases */}
												<div className="md:col-span-1 flex flex-col items-center">
													<span className="text-sm font-medium text-slate-500 dark:text-slate-300">{dbCount === null ? <span className="text-slate-400 dark:text-slate-500 text-base">—</span> : dbCount}</span>
												</div>
												{/* Uploads */}
												<div className="md:col-span-1 flex flex-col items-center">
													<span className="text-sm font-medium text-slate-500 dark:text-slate-300">{uploadCount === null ? <span className="text-slate-400 dark:text-slate-500 text-base">—</span> : uploadCount}</span>
												</div>
												{/* Joined */}
												<div className="md:col-span-1 text-sm text-slate-500 dark:text-slate-400">
													<p className="text-slate-700 dark:text-slate-300">{formatDate(user.createdAt)}</p>
													<p className="text-xs">by {user.createdBy?.name || "System"}</p>
												</div>
												{/* Role */}
												<div className="md:col-span-1 flex justify-center">
													<span className={`px-2.5 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1 ${getRoleBadge(user.role)}`}>
														<Shield size={11} />
														{user.role}
													</span>
												</div>
												{/* Action */}
												<div className="md:col-span-2 flex justify-center items-center gap-1.5">
													{user.status === 'pending' ? (
														/* Pending: show approve / reject only */
														<>
															<button
																onClick={async () => {
																	try {
																		const { data } = await api.patch(`/auth/users/${user._id}/approve`);
																		toast.success(data.message);
																		queryClient.invalidateQueries({ queryKey: ['users'] });
																	} catch (err) {
																		toast.error(err.response?.data?.message || 'Failed to approve');
																	}
																}}
																title="Approve user"
																className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 text-xs font-semibold transition cursor-pointer">
																<UserCheck size={13} /> Approve
															</button>
															<button
																onClick={async () => {
																	try {
																		const { data } = await api.patch(`/auth/users/${user._id}/reject`);
																		toast(data.message, { icon: '🚫' });
																		queryClient.invalidateQueries({ queryKey: ['users'] });
																	} catch (err) {
																		toast.error(err.response?.data?.message || 'Failed to reject');
																	}
																}}
																title="Reject user"
																className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-500/20 text-xs font-semibold transition cursor-pointer">
																<UserX size={13} /> Reject
															</button>
														</>
													) : (
														/* Active / Rejected: normal action buttons */
														<>
															<button
																onClick={async () => {
																	try {
																		const { data } = await api.patch(`/auth/users/${user._id}/credit-free`);
																		toast.success(data.message);
																		queryClient.invalidateQueries({ queryKey: ['users'] });
																	} catch (err) {
																		toast.error(err.response?.data?.message || 'Failed to update credit-free status');
																	}
																}}
																title={user.creditFree ? 'Disable credit-free (re-enable billing)' : 'Enable credit-free (employee / unlimited)'}
																className={`p-2 rounded-lg transition cursor-pointer ${user.creditFree
																	? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-500 hover:bg-emerald-100 dark:hover:bg-emerald-500/20'
																	: 'bg-slate-100 dark:bg-slate-700/40 text-slate-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 hover:text-emerald-500'
																}`}>
																{user.creditFree ? <Zap size={15} /> : <ZapOff size={15} />}
															</button>
															<button
																onClick={async () => {
																	try {
																		const { data } = await api.patch(`/auth/users/${user._id}/lock`);
																		toast.success(data.message);
																		queryClient.invalidateQueries({ queryKey: ['users'] });
																	} catch (err) {
																		toast.error(err.response?.data?.message || 'Failed to update lock status');
																	}
																}}
																title={user.isLocked ? 'Unlock user' : 'Lock user'}
																className={`p-2 rounded-lg transition cursor-pointer ${user.isLocked
																	? 'bg-amber-50 dark:bg-amber-500/10 text-amber-500 hover:bg-amber-100 dark:hover:bg-amber-500/20'
																	: 'bg-slate-100 dark:bg-slate-700/40 text-slate-400 hover:bg-amber-50 dark:hover:bg-amber-500/10 hover:text-amber-500'
																}`}>
																{user.isLocked ? <Unlock size={15} /> : <Lock size={15} />}
															</button>
															<button
																onClick={() => {
																	setUserToDelete(user);
																	setPasswordInput("");
																	setPasswordError("");
																	setShowPasswordModal(true);
																}}
																className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700/40 hover:bg-rose-100 dark:hover:bg-rose-500/10 text-rose-500 transition cursor-pointer">
																<Trash2 size={15} />
															</button>
														</>
													)}
												</div>
											</div>
										);
									})}
								</div>
							)}
						</div>
					</div>
				</div>

			{/* ── Credit History Section ─────────────────────────────────────── */}
			<div className="mt-8">
				<div className="flex items-center justify-between mb-4">
					<div>
						<h2 className="text-lg font-bold text-slate-900 dark:text-white">Credit History</h2>
						<p className="text-xs text-slate-400 mt-0.5">All credit additions and deductions across users</p>
					</div>
					<select
						value={historyTypeFilter}
						onChange={e => { setHistoryTypeFilter(e.target.value); setHistoryPage(1); }}
						className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500">
						<option value="">All types</option>
						<option value="ADD">Added only</option>
						<option value="DEDUCT">Deducted only</option>
					</select>
				</div>

				<div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xl overflow-hidden">
					<div className="hidden md:grid grid-cols-12 gap-3 px-5 py-3 border-b border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
						<div className="col-span-2">User</div>
						<div className="col-span-2">Type / Reason</div>
						<div className="col-span-1 text-center">Credits</div>
						<div className="col-span-1 text-center">Balance After</div>
						<div className="col-span-3">Description</div>
						<div className="col-span-2">By / Source</div>
						<div className="col-span-1">When</div>
					</div>

					{historyLoading ? (
						<div className="p-10 flex justify-center">
							<Loader size={20} className="animate-spin text-indigo-500" />
						</div>
					) : !creditHistoryData?.transactions?.length ? (
						<div className="p-10 text-center text-slate-400 dark:text-slate-500 text-sm">No credit transactions yet.</div>
					) : (
						<div className="divide-y divide-slate-100 dark:divide-slate-700/50">
							{creditHistoryData.transactions.map((tx) => {
								const isAdd = tx.type === 'ADD';
								const reasonColors = {
									ADMIN_ADD:       'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
									MOCK_PURCHASE:   'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
									STRIPE_PURCHASE: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
									SIGNUP_BONUS:    'bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400',
									SEARCH:          'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400',
									ENRICH:          'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400',
									AI_SOURCE:       'bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400',
								};
								const reasonLabel = {
									ADMIN_ADD: 'Admin Add', MOCK_PURCHASE: 'Purchase', STRIPE_PURCHASE: 'Stripe',
									SIGNUP_BONUS: 'Signup', SEARCH: 'Search', ENRICH: 'Enrich', AI_SOURCE: 'AI Source',
								};
								const when = new Date(tx.createdAt).toLocaleString('en-GB', {
									day: 'numeric', month: 'short', year: 'numeric',
									hour: '2-digit', minute: '2-digit', hour12: true,
								});
								return (
									<div key={tx._id} className="grid grid-cols-1 md:grid-cols-12 gap-2 px-5 py-3 items-center text-sm hover:bg-slate-50 dark:hover:bg-slate-700/30 transition">
										<div className="md:col-span-2 min-w-0">
											<p className="font-medium text-slate-800 dark:text-white truncate">{tx.userId?.name || '—'}</p>
											<p className="text-xs text-slate-400 truncate">{tx.userId?.email || ''}</p>
										</div>
										<div className="md:col-span-2 flex items-center gap-1.5 flex-wrap">
											<span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isAdd ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-50 dark:bg-rose-500/10 text-rose-500'}`}>
												{isAdd ? '+ ADD' : '− DEDUCT'}
											</span>
											<span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${reasonColors[tx.reason] || 'bg-slate-100 dark:bg-slate-700 text-slate-500'}`}>
												{reasonLabel[tx.reason] || tx.reason}
											</span>
										</div>
										<div className="md:col-span-1 text-center">
											<span className={`font-bold ${isAdd ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>
												{isAdd ? '+' : '−'}{tx.amount}
											</span>
										</div>
										<div className="md:col-span-1 text-center flex items-center justify-center gap-0.5 text-slate-600 dark:text-slate-300 font-medium">
											<CircleDollarSign size={12} className="text-amber-500" />
											{tx.balanceAfter}
										</div>
										<div className="md:col-span-3 text-xs text-slate-500 dark:text-slate-400 truncate">
											{tx.description || '—'}
										</div>
										<div className="md:col-span-2 text-xs text-slate-500 dark:text-slate-400 min-w-0">
											{tx.createdBy ? (
												<span className="text-indigo-500 font-medium truncate block">{tx.createdBy.name}</span>
											) : (
												<span className="text-slate-400">System</span>
											)}
											{tx.stripeSessionId && <span className="text-slate-400 block text-[10px]">Stripe</span>}
										</div>
										<div className="md:col-span-1 text-xs text-slate-400 whitespace-nowrap">{when}</div>
									</div>
								);
							})}
						</div>
					)}

					{creditHistoryData?.pages > 1 && (
						<div className="px-5 py-3 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
							<span className="text-slate-400 text-xs">Page {creditHistoryData.page} of {creditHistoryData.pages} · {creditHistoryData.total} total</span>
							<div className="flex gap-2">
								<button onClick={() => setHistoryPage(p => Math.max(1, p - 1))} disabled={historyPage === 1}
									className="px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-700 transition text-xs">
									Prev
								</button>
								<button onClick={() => setHistoryPage(p => Math.min(creditHistoryData.pages, p + 1))} disabled={historyPage === creditHistoryData.pages}
									className="px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-700 transition text-xs">
									Next
								</button>
							</div>
						</div>
					)}
				</div>
			</div>

			{/* Create User Modal */}
				{showCreateModal && (
					<div
						className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm
               flex items-center justify-center p-4"
						onClick={() => setShowCreateModal(false)}>
						<div
							onClick={(e) => e.stopPropagation()}
							className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md
                 shadow-2xl border border-slate-200 dark:border-slate-700
                 animate-in fade-in zoom-in-95 duration-200">
							{/* Header */}
							<div className="p-6 border-b border-slate-200 dark:border-slate-700">
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-3">
										<div className="bg-indigo-100 dark:bg-indigo-500/20 p-2 rounded-lg">
											<UserPlus className="w-5 h-5 text-indigo-400" />
										</div>
										<h3 className="text-lg font-semibold text-slate-900 dark:text-white">
											Create New User
										</h3>
									</div>

									<button
										onClick={() => setShowCreateModal(false)}
										className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition cursor-pointer">
										<X size={20} />
									</button>
								</div>
							</div>

							{/* Form */}
							<form onSubmit={handleCreateUser} className="p-6 space-y-4">
								{/* Name */}
								<div>
									<label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
										Full Name
									</label>
									<input
										type="text"
										required
										className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-700
                       rounded-xl px-4 py-2.5 text-slate-800 dark:text-white
                       focus:ring-2 focus:ring-indigo-500/40
                       outline-none transition"
										value={formData.name}
										onChange={(e) =>
											setFormData({ ...formData, name: e.target.value })
										}
									/>
								</div>

								{/* Email */}
								<div>
									<label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
										Email Address
									</label>
									<input
										type="email"
										required
										className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-700
                       rounded-xl px-4 py-2.5 text-slate-800 dark:text-white
                       focus:ring-2 focus:ring-indigo-500/40
                       outline-none transition"
										value={formData.email}
										onChange={(e) =>
											setFormData({ ...formData, email: e.target.value })
										}
									/>
								</div>

								{/* Password */}
								<div>
									<label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
										Password
									</label>
									<div className="relative">
										<input
											type={showPassword ? "text" : "password"}
											required
											className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-700
							rounded-xl px-4 py-2.5 text-slate-800 dark:text-white pr-10
							focus:ring-2 focus:ring-indigo-500/40
							outline-none transition"
											value={formData.password}
											onChange={(e) =>
												setFormData({ ...formData, password: e.target.value })
											}
										/>
										<button
											type="button"
											onClick={() => setShowPassword(!showPassword)}
											className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition">
											{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
										</button>
									</div>
								</div>

								{/* Confirm Password */}
								<div>
									<label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
										Confirm Password
									</label>
									<div className="relative">
										<input
											type={showConfirmPassword ? "text" : "password"}
											required
											className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-700
							rounded-xl px-4 py-2.5 text-slate-800 dark:text-white pr-10
							focus:ring-2 focus:ring-indigo-500/40
							outline-none transition"
											value={formData.confirmPassword}
											onChange={(e) =>
												setFormData({ ...formData, confirmPassword: e.target.value })
											}
										/>
										<button
											type="button"
											onClick={() => setShowConfirmPassword(!showConfirmPassword)}
											className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition">
											{showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
										</button>
									</div>
								</div>

								{/* Role */}
								<div>
									<label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
										Role
									</label>
									<RoleSelect
										value={formData.role}
										onChange={(e) =>
											setFormData({ ...formData, role: e.target.value })
										}
									/>
								</div>

								{/* Actions */}
								<div className="flex justify-end gap-3 pt-4">
									<button
										type="button"
										onClick={() => setShowCreateModal(false)}
										className="px-5 py-2.5 rounded-xl text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition cursor-pointer">
										Cancel
									</button>

									<button
										type="submit"
										className="px-5 py-2.5 rounded-xl
                       bg-indigo-600 hover:bg-indigo-500
                       text-white font-medium
                       shadow-lg hover:shadow-indigo-500/30
                       transition cursor-pointer
                       flex items-center gap-2">
										<CheckCircle size={16} />
										Create User
									</button>
								</div>
							</form>
						</div>
					</div>
				)}
			</div>

			{/* 🔐 PASSWORD CONFIRMATION MODAL */}
			{showPasswordModal && (
				<div
					className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm
                        flex items-center justify-center p-4">
					<div onClick={(e) => e.stopPropagation()}
						className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl border border-slate-200 dark:border-slate-700">
						<h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
							Delete User
						</h3>

						<p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
							Enter admin password to confirm deletion
						</p>

						<input
							type="password"
							value={passwordInput}
							onChange={(e) => {
								setPasswordInput(e.target.value);
								if (passwordError) setPasswordError("");
							}}
							className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-700
                         rounded-xl px-4 py-2 text-slate-800 dark:text-white
                         focus:ring-2 focus:ring-rose-500/40
                         outline-none"
							autoFocus
						/>

						{passwordError && (
							<p className="mt-2 text-sm text-rose-400">{passwordError}</p>
						)}

						<div className="flex justify-end gap-3 mt-6">
							<button
								onClick={() => setShowPasswordModal(false)}
								className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition">
								Cancel
							</button>

							<button
								onClick={confirmDeleteUser}
								disabled={isConfirming}
								className={`px-5 py-2 rounded-xl text-white transition
                  ${
										isConfirming
											? "bg-rose-400 cursor-not-allowed"
											: "bg-rose-600 hover:bg-rose-500"
									}`}>
								{isConfirming ? "Deleting..." : "Confirm"}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Reset Credits Confirm Modal */}
			{showResetConfirm && (
				<div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
					<div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-sm p-6 shadow-2xl border border-rose-200 dark:border-rose-500/30">
						<div className="flex items-start gap-3 mb-4">
							<div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-500/10 shrink-0">
								<AlertTriangle size={20} className="text-rose-500" />
							</div>
							<div>
								<h3 className="text-lg font-semibold text-slate-900 dark:text-white">Reset All Credits</h3>
								<p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
									This will set <strong>every user's credits to 0</strong> and permanently delete all credit transaction history. This cannot be undone.
								</p>
							</div>
						</div>
						<div className="flex gap-3 mt-6">
							<button
								onClick={() => setShowResetConfirm(false)}
								className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition text-sm font-medium">
								Cancel
							</button>
							<button
								onClick={async () => {
									setResetting(true);
									try {
										const { data } = await api.post('/credits/reset-all');
										toast.success(data.message);
										queryClient.invalidateQueries({ queryKey: ['users'] });
										queryClient.invalidateQueries({ queryKey: ['credit-all-history'] });
										setShowResetConfirm(false);
									} catch (err) {
										toast.error(err.response?.data?.message || 'Reset failed');
									} finally {
										setResetting(false);
									}
								}}
								disabled={resetting}
								className="flex-1 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white text-sm font-semibold shadow transition flex items-center justify-center gap-2">
								{resetting ? <Loader size={15} className="animate-spin" /> : <><RotateCcw size={15} />Yes, Reset All</>}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Add Credits Modal */}
			{showCreditsModal && creditsTarget && (
				<div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
					<div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-sm p-6 shadow-2xl border border-slate-200 dark:border-slate-800">
						<div className="flex items-center justify-between mb-5">
							<h3 className="text-lg font-semibold text-slate-900 dark:text-white">
								Add Credits — <span className="text-indigo-500">{creditsTarget.name}</span>
							</h3>
							<button onClick={() => setShowCreditsModal(false)} className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white transition">
								<X size={18} />
							</button>
						</div>

						<div className="space-y-4">
							<div>
								<label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Amount (credits)</label>
								<input
									type="number"
									min="1"
									value={creditsAmount}
									onChange={e => setCreditsAmount(e.target.value)}
									placeholder="e.g. 100"
									className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
								/>
							</div>
							<div>
								<label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Description (optional)</label>
								<input
									type="text"
									value={creditsDesc}
									onChange={e => setCreditsDesc(e.target.value)}
									placeholder="e.g. Trial bonus"
									className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
								/>
							</div>
							<div className="rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-4 py-3 flex items-center justify-between text-sm">
								<span className="text-slate-500 dark:text-slate-400">Current balance</span>
								<span className="font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1">
									<CircleDollarSign size={14} className="text-amber-500" />
									{creditsTarget.credits ?? 0}
								</span>
							</div>
							{creditsAmount && parseInt(creditsAmount) > 0 && (
								<div className="rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/20 px-4 py-3 flex items-center justify-between text-sm">
									<span className="text-slate-600 dark:text-slate-300">After adding</span>
									<span className="font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1">
										<CircleDollarSign size={14} />
										{(creditsTarget.credits ?? 0) + parseInt(creditsAmount)}
									</span>
								</div>
							)}
							{creditsError && <p className="text-sm text-red-500">{creditsError}</p>}
						</div>

						<div className="flex gap-3 mt-6">
							<button onClick={() => setShowCreditsModal(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition text-sm font-medium">
								Cancel
							</button>
							<button
								onClick={async () => {
									const amt = parseInt(creditsAmount);
									if (!amt || amt <= 0) { setCreditsError('Enter a positive amount'); return; }
									setCreditsLoading(true);
									setCreditsError('');
									try {
										const { data } = await api.post('/credits/add', {
											userId: creditsTarget._id,
											amount: amt,
											description: creditsDesc || undefined,
										});
										toast.success(data.message);
										queryClient.invalidateQueries({ queryKey: ['users'] });
										queryClient.invalidateQueries({ queryKey: ['credit-all-history'] });
										setShowCreditsModal(false);
									} catch (err) {
										setCreditsError(err.response?.data?.message || 'Failed to add credits');
									} finally {
										setCreditsLoading(false);
									}
								}}
								disabled={creditsLoading || !creditsAmount || parseInt(creditsAmount) <= 0}
								className="flex-1 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold shadow transition flex items-center justify-center gap-2">
								{creditsLoading ? <Loader size={15} className="animate-spin" /> : <><PlusCircle size={15} />Add Credits</>}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
};

export default UserManagement;
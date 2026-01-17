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
} from "lucide-react";
import UserManagementImage from "../assets/user-management2.svg";
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
	});
	const [showCreateModal, setShowCreateModal] = useState(false);
	const [showPasswordModal, setShowPasswordModal] = useState(false);
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

						<button
							onClick={() => setShowCreateModal(true)}
							className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-500
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

				<div className="flex-1 flex flex-row gap-8 overflow-hidden ">
					{/* Users Table */}
					<div className="w-full lg:w-2/3 flex flex-col">
						<div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xl flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-slate-950 [&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-600 [scrollbar-width:thin] [scrollbar-color:#334155_#020617]">
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
								<div className="p-4 space-y-3">
									{users.map((user) => (
										<div
											key={user._id}
											className="bg-white dark:bg-slate-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center gap-x-6 gap-y-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition border border-slate-200 dark:border-slate-700">
											{/* User Info */}
											<div className="flex items-center gap-4 md:w-2/5">
												<div className="bg-indigo-100 dark:bg-indigo-500/20 p-2 rounded-lg">
													<User size={18} className="text-indigo-500 dark:text-indigo-400" />
												</div>
												<div className="flex-1 min-w-0">
													<p className="font-medium text-slate-800 dark:text-white">{user.name}</p>
													<p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 truncate">
														<Mail size={12} />
														<span className="truncate">{user.email}</span>
													</p>
													<p className="md:hidden text-xs text-slate-500 dark:text-slate-400 mt-1">
														Created {formatDate(user.createdAt)}
														{" • "} by {user.createdBy?.name || "System"}
													</p>
												</div>
											</div>

											{/* Created At - Desktop */}
											<div className="hidden md:block text-sm text-slate-500 dark:text-slate-400 md:w-2/5">
												<p className="text-slate-700 dark:text-slate-300">
													Created {formatDate(user.createdAt)}
												</p>
												<p className="text-xs text-slate-500 dark:text-slate-400">
													by {user.createdBy?.name || "System"}
												</p>
											</div>

											{/* Role & Actions */}
											<div className="w-full md:w-1/5 flex items-center justify-between md:justify-end gap-4 pt-4 md:pt-0 border-t border-slate-200 dark:border-slate-700 md:border-none">
												<span
													className={`px-3 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1 ${getRoleBadge(user.role)}`}>
													<Shield size={12} />
													{user.role}
												</span>
												<button
													onClick={() => {
														setUserToDelete(user);
														setPasswordInput("");
														setPasswordError("");
														setShowPasswordModal(true);
													}}
													className="p-2 rounded-lg
                       bg-slate-200 dark:bg-slate-700/40
                       hover:bg-rose-100 
                       text-rose-500 
											transition cursor-pointer">
													<Trash2 size={16} />
												</button>
											</div>
										</div>
									))}
								</div>
							)}
						</div>
					</div>

					{/* Right side static image */}
					<div className="hidden lg:flex w-1/3 items-center justify-center p-4">
						<img src={UserManagementImage} alt="User Management" className="w-48 md:w-full max-w-[10rem] dark:invert-[.85]" />
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
		</div>
	);
};

export default UserManagement;
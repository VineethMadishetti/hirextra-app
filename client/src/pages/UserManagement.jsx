import { useState, useEffect } from "react";
import axios from "axios";
import {
	UserPlus,
	Trash2,
	Mail,
	User,
	Shield,
	X,
	CheckCircle,
} from "lucide-react";
import toast from "react-hot-toast";


const UserManagement = () => {
	const [users, setUsers] = useState([]);
	const [loading, setLoading] = useState(false);
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
		role: "USER",
	});

	useEffect(() => {
		fetchUsers();
	}, []);

	const fetchUsers = async () => {
		setLoading(true);
		try {
			const { data } = await axios.get("/auth/users");
			setUsers(data);
		} catch (error) {
			toast.error("Failed to load users");
		}
		setLoading(false);
	};

	const handleCreateUser = async (e) => {
		e.preventDefault();
		if (!formData.name || !formData.email || !formData.password) {
			return toast.error("Please fill all required fields");
		}

		try {
			const { data } = await axios.post("/auth/users", formData);
			toast.success("User created successfully");
			setShowCreateModal(false);
			setFormData({ name: "", email: "", password: "", role: "USER" });
			fetchUsers();
		} catch (error) {
			toast.error(error.response?.data?.message || "Failed to create user");
		}
	};

	// const handleDeleteUser = async (id) => {
	//   if (!window.confirm('Are you sure you want to delete this user?')) return;

	//   try {
	//     await axios.delete(`/auth/users/${id}`);
	//     toast.success('User deleted');
	//     fetchUsers();
	//   } catch (error) {
	//     toast.error(error.response?.data?.message || 'Failed to delete user');
	//   }
	// };

	const confirmDeleteUser = async () => {
		if (!passwordInput.trim()) {
			setPasswordError("Password is required");
			return;
		}

		try {
			setIsConfirming(true);
			setPasswordError("");

			// First verify the password
			await axios.post("/auth/verify-password", { password: passwordInput });

			// If password is correct, proceed with deletion
			await axios.delete(`/auth/users/${userToDelete._id}`, {
				headers: {
					'Content-Type': 'application/json'
				}
			});

			toast.success("User deleted successfully");
			setShowPasswordModal(false);
			setUserToDelete(null);
			setPasswordInput("");
			fetchUsers();
		} catch (err) {
			setPasswordError(err.response?.data?.message || "Incorrect password");
		} finally {
			setIsConfirming(false);
		}
	};

	const getRoleBadge = (role) => {
		const colors = {
			ADMIN: "bg-purple-100 text-purple-700 border-purple-200",
			SUPER_ADMIN: "bg-red-100 text-red-700 border-red-200",
			USER: "bg-blue-100 text-blue-700 border-blue-200",
		};
		return colors[role] || "bg-gray-100 text-gray-700 border-gray-200";
	};

	return (
		<div className="min-h-screen bg-slate-950 text-slate-100 p-6">
			<div className="max-w-7xl mx-auto">
				{/* Header */}
				<div className="bg-slate-900/80 backdrop-blur rounded-2xl p-6 mb-6 shadow-xl border border-slate-800">
					<div className="flex justify-between items-center">
						<div>
							<h2 className="text-2xl font-semibold text-white mb-1">
								User Management
							</h2>
							<p className="text-sm text-slate-400">
								Manage system users and permissions
							</p>
						</div>

						<button
							onClick={() => setShowCreateModal(true)}
							className="bg-indigo-600 hover:bg-indigo-500
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

				{/* Users Table */}
				<div className="bg-slate-900/80 rounded-2xl border border-slate-800 shadow-xl">
					{loading ? (
						<div className="p-12 text-center">
							<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mx-auto"></div>
						</div>
					) : users.length === 0 ? (
						<div className="p-12 text-center">
							<User className="w-14 h-14 text-slate-600 mx-auto mb-4" />
							<p className="text-slate-400 font-medium">No users found</p>
						</div>
					) : (
						<div className="p-4 space-y-3">
							{users.map((user) => (
								<div
									key={user._id}
									className="bg-slate-800/60 rounded-xl p-4
             grid grid-cols-[1fr_160px_220px_80px]
             items-center gap-4
             hover:bg-slate-800 transition">
									{/* User Info */}
									<div className="flex items-center gap-4">
										<div className="bg-indigo-500/10 p-2 rounded-lg">
											<User size={18} className="text-indigo-400" />
										</div>
										<div>
  <p className="font-medium text-white">{user.name}</p>

  <p className="text-xs text-slate-400 flex items-center gap-1">
    <Mail size={12} />
    {user.email}
  </p>

  {/* ✅ Created At & Created By */}
  <p className="text-xs text-slate-500">
    Created {user.createdAt
      ? new Date(user.createdAt).toLocaleString()
      : "—"}
    {" • "}
    by {user.createdBy?.name || "System"}
  </p>
</div>

									</div>

									{/* Role */}
									<div className="w-40 flex justify-center">
										<span
											className={`px-3 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1
      ${
				user.role === "SUPER_ADMIN"
					? "bg-rose-500/10 text-rose-400"
					: user.role === "ADMIN"
					? "bg-purple-500/10 text-purple-400"
					: "bg-blue-500/10 text-blue-400"
			}`}>
											<Shield size={12} />
											{user.role}
										</span>
									</div>

									<div className="text-sm text-slate-400">
										<p className="text-slate-300">
											{user.createdAt
												? new Date(user.createdAt).toLocaleString()
												: "—"}
										</p>
										<p className="text-xs text-slate-500">
											by {user.createdBy?.name || "System"}
										</p>
									</div>

									{/* Actions */}
									<button
										onClick={() => {
											setUserToDelete(user);
											setPasswordInput("");
											setPasswordError("");
											setShowPasswordModal(true);
										}}
										className="p-2 rounded-lg
                       bg-slate-700/40
                       hover:bg-rose-500/20
                       text-rose-400
                       transition cursor-pointer">
										<Trash2 size={16} /> 
									</button>
								</div>
							))}
						</div>
					)}
				</div>

				{/* Create User Modal */}
				{showCreateModal && (
					<div
						className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm
               flex items-center justify-center p-4"
						onClick={() => setShowCreateModal(false)}>
						<div
							onClick={(e) => e.stopPropagation()}
							className="bg-slate-900 rounded-2xl w-full max-w-md
                 shadow-2xl border border-slate-800
                 animate-in fade-in zoom-in-95 duration-200">
							{/* Header */}
							<div className="p-6 border-b border-slate-800">
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-3">
										<div className="bg-indigo-500/10 p-2 rounded-lg">
											<UserPlus className="w-5 h-5 text-indigo-400" />
										</div>
										<h3 className="text-lg font-semibold text-white">
											Create New User
										</h3>
									</div>

									<button
										onClick={() => setShowCreateModal(false)}
										className="text-slate-400 hover:text-white transition cursor-pointer">
										<X size={20} />
									</button>
								</div>
							</div>

							{/* Form */}
							<form onSubmit={handleCreateUser} className="p-6 space-y-4">
								{/* Name */}
								<div>
									<label className="block text-xs font-medium text-slate-400 mb-1">
										Full Name
									</label>
									<input
										type="text"
										required
										className="w-full bg-slate-800 border border-slate-700
                       rounded-xl px-4 py-2.5 text-white
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
									<label className="block text-xs font-medium text-slate-400 mb-1">
										Email Address
									</label>
									<input
										type="email"
										required
										className="w-full bg-slate-800 border border-slate-700
                       rounded-xl px-4 py-2.5 text-white
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
									<label className="block text-xs font-medium text-slate-400 mb-1">
										Password
									</label>
									<input
										type="password"
										required
										className="w-full bg-slate-800 border border-slate-700
                       rounded-xl px-4 py-2.5 text-white
                       focus:ring-2 focus:ring-indigo-500/40
                       outline-none transition"
										value={formData.password}
										onChange={(e) =>
											setFormData({ ...formData, password: e.target.value })
										}
									/>
								</div>

								{/* Role */}
								<div>
									<label className="block text-xs font-medium text-slate-400 mb-1">
										Role
									</label>
									<select
										className="w-full bg-slate-800 border border-slate-700
                       rounded-xl px-4 py-2.5 text-white
                       focus:ring-2 focus:ring-indigo-500/40
                       outline-none transition cursor-pointer"
										value={formData.role}
										onChange={(e) =>
											setFormData({ ...formData, role: e.target.value })
										}>
										<option value="USER">User (View & Export Only)</option>
										<option value="ADMIN">Admin (Full Access)</option>
									</select>
								</div>

								{/* Actions */}
								<div className="flex justify-end gap-3 pt-4">
									<button
										type="button"
										onClick={() => setShowCreateModal(false)}
										className="px-5 py-2.5 rounded-xl
                       text-slate-400 hover:text-white
                       hover:bg-slate-800 transition cursor-pointer">
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
					<div
						onClick={(e) => e.stopPropagation()}
						className="bg-slate-900 rounded-2xl w-full max-w-md p-6
                       shadow-2xl border border-slate-800">
						<h3 className="text-lg font-semibold text-white mb-1">
							Delete User
						</h3>

						<p className="text-sm text-slate-400 mb-4">
							Enter admin password to confirm deletion
						</p>

						<input
							type="password"
							value={passwordInput}
							onChange={(e) => {
								setPasswordInput(e.target.value);
								if (passwordError) setPasswordError("");
							}}
							className="w-full bg-slate-800 border border-slate-700
                         rounded-xl px-4 py-2 text-white
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
								className="text-slate-400 hover:text-white transition">
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
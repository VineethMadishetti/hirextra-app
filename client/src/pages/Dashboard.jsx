import { useContext, useState, useEffect } from "react";
import { AuthContext } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import AdminDashboard from "./AdminDashboard"; // Assuming you have this component
import UserSearch from "./UserSearch";
import UserManagement from "./UserManagement"; // Corrected casing
import { useTheme } from '../context/ThemeContext';
import {
	LayoutDashboard,
	Search,
	LogOut,
	User,
	Users,
	CircleDollarSign,
	Plus,
	Moon,
	Sun,
} from "lucide-react";

const Dashboard = () => {
	const { user, logout } = useContext(AuthContext);
	const navigate = useNavigate();
	
	// Theme state - load from localStorage or default to light
	const { theme, toggleTheme } = useTheme();

	// State to control which view is shown
	// If user is ADMIN, default to 'admin', else 'search'
	const [currentView, setCurrentView] = useState(
		() => user?.role === "ADMIN" ? "admin" : "search"
	);

	useEffect(() => {
		if (user && user.role === "ADMIN") {
			setCurrentView("admin");
		} else {
			setCurrentView("search");
		}
	}, [user]);

	const [showLogoutModal, setShowLogoutModal] = useState(false);

	const handleLogout = () => {
		setShowLogoutModal(true);
	};

	const confirmLogout = () => {
		// Clear persisted search data on explicit logout
		localStorage.removeItem("hirextra_selectedIds");
		localStorage.removeItem("hirextra_searchInput");
		localStorage.removeItem("hirextra_filters");
		logout();
		navigate("/");
	};

	return (
		<div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 font-sans text-slate-900 dark:text-slate-100">
			{/* --- Top Navigation Bar --- */}
			<nav
				className="fixed top-0 left-0 right-0 z-50
  bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800
  px-6 h-16 flex justify-between items-center">
				{/* Left: Logo & Admin Navigation */}
				<div className="flex items-center gap-10">
					<h1 className="text-xl font-extrabold tracking-tight select-none leading-none">
						<span className="bg-gradient-to-r from-blue-500 to-indigo-600 bg-clip-text text-transparent">
							People
						</span>
						<span className="text-slate-900 dark:text-slate-200">Finder</span>
					</h1>

					{/* Only Admins see these buttons */}
					{/* Admin Navigation */}
					{user?.role === "ADMIN" && (
						<div className="hidden md:flex items-center bg-slate-100 dark:bg-slate-800 rounded-full p-1 shadow-inner">
							<button
								onClick={() => setCurrentView("admin")}
								className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all
            ${
							currentView === "admin"
								? "bg-white dark:bg-slate-900 text-blue-800 dark:text-slate-100 shadow ring-1 ring-slate-200 dark:ring-slate-700"
								: "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
						}`}>
								<LayoutDashboard size={16} />
								Admin Panel
							</button>


							<button
								onClick={() => setCurrentView("users")}
								className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all
            ${
							currentView === "users"
								? "bg-white dark:bg-slate-900 text-blue-600 dark:text-slate-100 shadow ring-1 ring-slate-200 dark:ring-slate-700"
								: "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
						}`}>
								<Users size={16} />
								User Management
							</button>

							<button
								onClick={() => setCurrentView("search")}
								className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all
            ${
							currentView === "search"
								? "bg-white dark:bg-slate-900 text-blue-600 dark:text-slate-100 shadow ring-1 ring-slate-200 dark:ring-slate-700"
								: "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
						}`}>
								<Search size={16} />
								Search People
							</button>
						</div>
					)}
				</div>

				{/* Right: User Profile & Logout */}
				<div className="flex items-center gap-4">
					{/* <button
						onClick={toggleTheme}
						className="p-2 rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
						title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}>
						{theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
					</button> */}

					{/* <div
						className="h-8 w-px bg-slate-200/80 dark:bg-slate-700/80 mx-1 hidden sm:block"
						aria-hidden="true"
					/> */}

					{/* Credits Display */}
					{user?.role === "USER" && (
					<div className="hidden sm:flex items-center gap-2 bg-slate-100/80 dark:bg-slate-800/50 p-1 rounded-full shadow-inner">
						<div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200 px-2">
							<CircleDollarSign size={16} className="text-amber-500" />
							<span>1,250</span>
							<span className="font-normal text-slate-500 dark:text-slate-400">
								Credits
							</span>
						</div>
						<button className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-green-500 rounded-full shadow-md transition-all cursor-pointer">
							<Plus size={14} />
							BUY
						</button>
					</div>
					)}

					<div
						className="h-8 w-px bg-slate-200/80 dark:bg-slate-700/80 mx-1 hidden sm:block"
						aria-hidden="true"
					/>

					<div className="hidden sm:flex flex-col items-end leading-tight">
						<span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
							{user?.name}
						</span>
						<span
							className="text-[10px] font-semibold tracking-wider uppercase
        text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 px-2 py-0.5 rounded-full">
							{user?.role}
						</span>
					</div>

					<div
						className="h-9 w-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600
      flex items-center justify-center text-white shadow">
						<User size={18} />
					</div>

					<button
						onClick={handleLogout}
						title="Logout"
						className="ml-1 p-2 rounded-full text-slate-500 dark:text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all cursor-pointer">
						<LogOut size={18} />
					</button>
				</div>
			</nav>

			{/* --- Mobile Nav (Only for Admin) --- */}
			{user?.role === "ADMIN" && (
				<div className="md:hidden flex border-b bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-slate-200 dark:border-slate-800 fixed top-16 left-0 right-0 z-40">
					<button
						onClick={() => setCurrentView("admin")}
						className={`flex-1 py-3 text-sm font-medium text-center ${
							currentView === "admin"
								? "text-indigo-600 border-b-2 border-indigo-600"
								: "text-gray-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
						}`}>
						Admin Panel
					</button>
					<button
						onClick={() => setCurrentView("users")}
						className={`flex-1 py-3 text-sm font-medium text-center ${
							currentView === "users"
								? "text-indigo-600 border-b-2 border-indigo-600"
								: "text-gray-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
						}`}>
						User Management
					</button>
					<button
						onClick={() => setCurrentView("search")}
						className={`flex-1 py-3 text-sm font-medium text-center ${
							currentView === "search"
								? "text-indigo-600 border-b-2 border-indigo-600"
								: "text-gray-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
						}`}>
						Search
					</button>
				</div>
			)}

			{/* --- Main Content Area --- */}
			<main
				className={`flex-1 flex flex-col overflow-hidden ${
					user?.role === "ADMIN" ? "pt-[112px] md:pt-16" : "pt-16"
				}`}>
				{user?.role === "ADMIN" && currentView === "admin" ? (
					<AdminDashboard />
				) : currentView === "users" ? (
					<UserManagement />
				) : (
					<UserSearch />
				)}
			</main>

			{/* Logout Confirmation Modal */}
			{showLogoutModal && (
				<div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 transition-all">
					<div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md p-6 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95 duration-200">
						<h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
							Confirm Logout
						</h3>
						<p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
							Are you sure you want to end your session?
						</p>

						<div className="flex justify-end gap-3">
							<button
								onClick={() => setShowLogoutModal(false)}
								className="px-4 py-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition cursor-pointer">
								Cancel
							</button>
							<button
								onClick={confirmLogout}
								className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-medium shadow-lg hover:shadow-rose-500/20 transition cursor-pointer flex items-center gap-2">
								<LogOut size={16} />
								Logout
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
};

export default Dashboard;

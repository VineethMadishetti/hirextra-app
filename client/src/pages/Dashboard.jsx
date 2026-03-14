import { useContext, useState, useEffect, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../api/axios";
import { AuthContext } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";
import {
	LayoutDashboard,
	Search,
	Sparkles,
	LogOut,
	User,
	Users,
	CircleDollarSign,
	Plus,
	Moon,
	Sun,
	Loader,
	Zap,
	ArrowRight,
	Database,
} from "lucide-react";
import LoadingScreen from "../components/LoadingScreen";
import SourcingAgentModal from "../components/SourcingAgentModal";

// Welcome page shown to USER role after login
const WelcomePage = ({ user, onNavigate }) => (
	<div className="flex-1 flex flex-col items-center justify-center px-6 py-16 min-h-full">
		{/* Subtitle */}
		<p className="text-slate-500 dark:text-slate-400 text-lg leading-relaxed text-center mb-10">
			Your AI-powered talent finder is ready. Discover the right people faster than ever.
		</p>

		{/* Action Cards */}
		<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 w-full max-w-5xl">
			{/* Search People Card */}
			<button
				onClick={() => onNavigate("search")}
				className="group relative flex flex-col items-start gap-4 p-6 rounded-2xl border border-slate-200 dark:border-slate-700/60
				bg-white dark:bg-slate-800/60 shadow-sm hover:shadow-xl hover:shadow-blue-100/50 dark:hover:shadow-blue-900/20
				hover:border-blue-300 dark:hover:border-blue-600/50 transition-all duration-300 text-left cursor-pointer">
				<div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center group-hover:bg-blue-100 dark:group-hover:bg-blue-500/20 transition-colors">
					<Search size={22} className="text-blue-600 dark:text-blue-400" />
				</div>
				<div className="flex-1">
					<h3 className="font-bold text-slate-900 dark:text-white text-base mb-1">Search People</h3>
					<p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">Filter by skills, location, title & more from our global talent database.</p>
				</div>
				<ArrowRight size={18} className="text-slate-300 group-hover:text-blue-500 group-hover:translate-x-1 transition-all" />
			</button>

			{/* AI Search Card */}
			<button
				onClick={() => onNavigate("ai-search")}
				className="group relative flex flex-col items-start gap-4 p-6 rounded-2xl border border-slate-200 dark:border-slate-700/60
				bg-white dark:bg-slate-800/60 shadow-sm hover:shadow-xl hover:shadow-violet-100/50 dark:hover:shadow-violet-900/20
				hover:border-violet-300 dark:hover:border-violet-600/50 transition-all duration-300 text-left cursor-pointer overflow-hidden">
				<div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-violet-100/60 dark:from-violet-500/10 to-transparent rounded-bl-full pointer-events-none" />
				<div className="w-12 h-12 rounded-xl bg-violet-50 dark:bg-violet-500/10 flex items-center justify-center group-hover:bg-violet-100 dark:group-hover:bg-violet-500/20 transition-colors">
					<Sparkles size={22} className="text-violet-600 dark:text-violet-400" />
				</div>
				<div className="flex-1">
					<h3 className="font-bold text-slate-900 dark:text-white text-base mb-1">AI Search</h3>
					<p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">Ask AI to find candidates by describing what you need in plain English.</p>
				</div>
				<ArrowRight size={18} className="text-slate-300 group-hover:text-violet-500 group-hover:translate-x-1 transition-all" />
			</button>

			{/* AI Sourcing Agent Card */}
			<button
				onClick={() => onNavigate("ai-source")}
				className="group relative flex flex-col items-start gap-4 p-6 rounded-2xl border border-slate-200 dark:border-slate-700/60
				bg-white dark:bg-slate-800/60 shadow-sm hover:shadow-xl hover:shadow-indigo-100/50 dark:hover:shadow-indigo-900/20
				hover:border-indigo-300 dark:hover:border-indigo-600/50 transition-all duration-300 text-left cursor-pointer overflow-hidden">
				<div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-indigo-100/60 dark:from-indigo-500/10 to-transparent rounded-bl-full pointer-events-none" />
				<div className="w-12 h-12 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center group-hover:bg-indigo-100 dark:group-hover:bg-indigo-500/20 transition-colors">
					<Zap size={22} className="text-indigo-600 dark:text-indigo-400" />
				</div>
				<div className="flex-1">
					<div className="flex items-center gap-2 mb-1">
						<h3 className="font-bold text-slate-900 dark:text-white text-base">AI Sourcing Agent</h3>
						<span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 px-2 py-0.5 rounded-full">New</span>
					</div>
					<p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">Paste a job description — let AI discover matching candidates globally.</p>
				</div>
				<ArrowRight size={18} className="text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-1 transition-all" />
			</button>

			{/* My Databases Card */}
			<button
				onClick={() => onNavigate("my-databases")}
				className="group relative flex flex-col items-start gap-4 p-6 rounded-2xl border border-slate-200 dark:border-slate-700/60
				bg-white dark:bg-slate-800/60 shadow-sm hover:shadow-xl hover:shadow-emerald-100/50 dark:hover:shadow-emerald-900/20
				hover:border-emerald-300 dark:hover:border-emerald-600/50 transition-all duration-300 text-left cursor-pointer">
				<div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center group-hover:bg-emerald-100 dark:group-hover:bg-emerald-500/20 transition-colors">
					<Database size={22} className="text-emerald-600 dark:text-emerald-400" />
				</div>
				<div className="flex-1">
					<h3 className="font-bold text-slate-900 dark:text-white text-base mb-1">My Databases</h3>
					<p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">Upload resumes into your private database and search them anytime.</p>
				</div>
				<ArrowRight size={18} className="text-slate-300 group-hover:text-emerald-500 group-hover:translate-x-1 transition-all" />
			</button>
		</div>

		{/* Footer hint */}
		<p className="mt-10 text-xs text-slate-400 dark:text-slate-600">
			Use the navigation above to switch between tools anytime
		</p>
	</div>
);

// Lazy load components to reduce initial bundle size
const AdminDashboard = lazy(() => import("./AdminDashboard"));
const UserSearch = lazy(() => import("./UserSearch"));
const UserManagement = lazy(() => import("./UserManagement"));
// const Enrich = lazy(() => import("./Enrich")); // hidden for now
const PrivateDatabases = lazy(() => import("./PrivateDatabases"));

const Dashboard = () => {
	const { user, logout } = useContext(AuthContext);
	const navigate = useNavigate();

	// Theme state - load from localStorage or default to light
	const { theme, toggleTheme } = useTheme();

	// State to control which view is shown
	// If user is ADMIN, default to 'admin', else 'welcome'
	const [currentView, setCurrentView] = useState(
		() => (user?.role === "ADMIN" ? "admin" : "welcome"),
	);

	const { data: statsData } = useQuery({
		queryKey: ["candidateStats"],
		queryFn: async () => {
			// An empty search returns total count of non-deleted candidates
			const { data } = await api.get("/candidates/search?limit=1");
			return { totalCandidates: data.totalCount || 0 };
		},
		staleTime: 5 * 60 * 1000, // 5 minutes
		enabled: user?.role === "USER", // Only fetch for USER role
	});

	// Heartbeat to keep session active while user is using the website
	useQuery({
		queryKey: ["heartbeat"],
		queryFn: async () => {
			await api.get("/candidates/search?limit=1"); // Lightweight call to keep token alive
			return null;
		},
		refetchInterval: 45 * 1000, // Ping every 45 seconds to ensure token stays alive
		retry: false,
	});

	useEffect(() => {
		if (user && user.role === "ADMIN") {
			setCurrentView("admin");
		} else {
			setCurrentView("welcome");
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
		localStorage.removeItem("hirextra_ai_source_state");
		logout();
		navigate("/");
	};

	return (
		<div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 font-sans text-slate-900 dark:text-slate-100">
			{/* --- Top Navigation Bar --- */}
			<nav
				className="fixed top-0 left-0 right-0 z-50
  bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200/60 dark:border-slate-800/60
  px-6 h-16 flex justify-between items-center transition-all duration-300">
				{/* Left: Logo & Navigation */}
				<div className="flex items-center gap-10">
					<button
						onClick={() => user?.role === "USER" && setCurrentView("welcome")}
						className={`text-xl font-extrabold tracking-tight leading-none select-none ${user?.role === "USER" ? "cursor-pointer hover:opacity-80 transition-opacity" : "cursor-default"}`}>
						<span className="bg-gradient-to-r from-blue-500 to-indigo-600 bg-clip-text text-transparent">
							People
						</span>
						<span className="text-slate-900 dark:text-slate-200">Finder</span>
					</button>

					{/* USER Navigation: Search People, AI Search, My Databases */}
					{user?.role === "USER" && (
						<div className="hidden md:flex items-center bg-slate-100 dark:bg-slate-800 rounded-full p-1 shadow-inner">
							<button
								onClick={() => setCurrentView("search")}
								className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all
								${currentView === "search"
									? "bg-white dark:bg-slate-900 text-blue-600 dark:text-slate-100 shadow ring-1 ring-slate-200 dark:ring-slate-700"
									: "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
								}`}>
								<Search size={16} />
								Search People
							</button>
							<button
								onClick={() => setCurrentView("ai-search")}
								className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all ${currentView === "ai-search" ? "bg-white dark:bg-slate-900 text-violet-600 dark:text-slate-100 shadow ring-1 ring-slate-200 dark:ring-slate-700" : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"}`}>
								<Sparkles size={16} />
								AI Search
							</button>
							<button
								onClick={() => setCurrentView("ai-source")}
								className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all
								${currentView === "ai-source"
									? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-slate-100 shadow ring-1 ring-slate-200 dark:ring-slate-700"
									: "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
								}`}>
								<Zap size={16} />
								AI Sourcing Agent
							</button>
							<button
								onClick={() => setCurrentView("my-databases")}
								className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all
								${currentView === "my-databases"
									? "bg-white dark:bg-slate-900 text-emerald-600 dark:text-slate-100 shadow ring-1 ring-slate-200 dark:ring-slate-700"
									: "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
								}`}>
								<Database size={16} />
								My Databases
							</button>
						<button
							onClick={() => setCurrentView("pipeline")}
							className={[`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all`,
								currentView === "pipeline" ? "bg-white dark:bg-slate-900 text-violet-600 dark:text-slate-100 shadow ring-1 ring-slate-200 dark:ring-slate-700" : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"].join(" ")}>
							<KanbanSquare size={16} />
							Pipeline
						</button>
						<button
							onClick={() => setCurrentView("jobs")}
							className={[`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all`,
								currentView === "jobs" ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-slate-100 shadow ring-1 ring-slate-200 dark:ring-slate-700" : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"].join(" ")}>
							<Briefcase size={16} />
							Jobs
						</button>
						</div>
					)}

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
					{/* Enrich nav — hidden for now
						<button
							onClick={() => setCurrentView("enrich")}
							className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all
            ${
							currentView === "enrich"
								? "bg-white dark:bg-slate-900 text-blue-600 dark:text-slate-100 shadow ring-1 ring-slate-200 dark:ring-slate-700"
								: "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
							}`}>
							<Sparkles size={16} />
							Enrich
						</button>
					*/}

						<button
							onClick={() => setCurrentView("ai-source")}
							className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all
            ${
							currentView === "ai-source"
								? "bg-white dark:bg-slate-900 text-blue-600 dark:text-slate-100 shadow ring-1 ring-slate-200 dark:ring-slate-700"
								: "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800"
						}`}>
							<Zap size={16} />
							AI Source
						</button>
					<button
						onClick={() => setCurrentView("pipeline")}
						className={["flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all",
							currentView === "pipeline" ? "bg-white dark:bg-slate-900 text-violet-600 dark:text-slate-100 shadow ring-1 ring-slate-200 dark:ring-slate-700" : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"].join(" ")}>
						<KanbanSquare size={16} />
						Pipeline
					</button>
					<button
						onClick={() => setCurrentView("jobs")}
						className={["flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all",
							currentView === "jobs" ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-slate-100 shadow ring-1 ring-slate-200 dark:ring-slate-700" : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"].join(" ")}>
						<Briefcase size={16} />
						Jobs
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

				{/* Candidate Count */}
				{/* {user?.role === "USER" && statsData && (
					<div className="hidden sm:flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200 pr-2">
						<Users size={16} className="text-indigo-500" />
						<span>{(statsData.totalCandidates || 0).toLocaleString()}</span>
						<span className="font-normal text-slate-500 dark:text-slate-400">
							Candidates
						</span>
					</div>
				)} */}

	
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

		{/* --- Mobile Nav (USER role) --- */}
		{user?.role === "USER" && (
			<div className="md:hidden flex border-b bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-slate-200 dark:border-slate-800 fixed top-16 left-0 right-0 z-40">
				<button
					onClick={() => setCurrentView("search")}
					className={`flex-1 py-3 text-sm font-medium text-center flex items-center justify-center gap-1.5 ${
						currentView === "search"
							? "text-blue-600 border-b-2 border-blue-600"
							: "text-gray-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
					}`}>
					<Search size={14} />
					Search People
				</button>
				<button
					onClick={() => setCurrentView("ai-search")}
					className={`flex-1 py-3 text-sm font-medium text-center flex items-center justify-center gap-1.5 ${currentView === "ai-search" ? "text-violet-600 border-b-2 border-violet-600" : "text-gray-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"}`}>
					<Sparkles size={14} />
					AI Search
				</button>
				<button
					onClick={() => setCurrentView("ai-source")}
					className={`flex-1 py-3 text-sm font-medium text-center flex items-center justify-center gap-1.5 ${
						currentView === "ai-source"
							? "text-indigo-600 border-b-2 border-indigo-600"
							: "text-gray-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
					}`}>
					<Zap size={14} />
					Sourcing Agent
				</button>
				<button
					onClick={() => setCurrentView("my-databases")}
					className={`flex-1 py-3 text-sm font-medium text-center flex items-center justify-center gap-1.5 ${
						currentView === "my-databases"
							? "text-emerald-600 border-b-2 border-emerald-600"
							: "text-gray-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
					}`}>
					<Database size={14} />
					My DB
				</button>
			</div>
		)}

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
    className={`flex-1 py-3 text-sm font-medium text-center transition-all duration-75 active:translate-y-1 ${
        currentView === "search"
            ? "text-indigo-600 border-b-2 border-indigo-600"
            : "text-gray-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 shadow-[0_4px_0_0_rgba(0,0,0,0.1)] hover:shadow-[0_2px_0_0_rgba(0,0,0,0.1)] hover:translate-y-[2px] active:shadow-none"
    }`}
>
    Search
</button>
					{/* Enrich mobile nav — hidden for now
					<button
						onClick={() => setCurrentView("enrich")}
						className={`flex-1 py-3 text-sm font-medium text-center transition-all duration-75 active:translate-y-1 ${
							currentView === "enrich"
								? "text-indigo-600 border-b-2 border-indigo-600"
								: "text-gray-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 shadow-[0_4px_0_0_rgba(0,0,0,0.1)] hover:shadow-[0_2px_0_0_rgba(0,0,0,0.1)] hover:translate-y-[2px] active:shadow-none"
						}`}>
						Enrich
					</button>
					*/}
				</div>
			)}

			{/* --- Main Content Area --- */}
			<main
				className={`flex-1 flex flex-col overflow-hidden ${
					user?.role === "ADMIN" || user?.role === "USER" ? "pt-[112px] md:pt-16" : "pt-16"
				}`}>
				<Suspense
					fallback={
						<LoadingScreen />
					}>
					{currentView === "welcome" ? (
						<WelcomePage user={user} onNavigate={setCurrentView} />
					) : currentView === "my-databases" ? (
						<PrivateDatabases />
					) : user?.role === "ADMIN" && currentView === "admin" ? (
						<AdminDashboard />
					) : currentView === "users" ? (
						<UserManagement />
					) : currentView === "enrich" ? (
						<Enrich />
					) : currentView === "ai-source" ? (
						<SourcingAgentModal inline={true} onClose={() => setCurrentView(user?.role === "ADMIN" ? "admin" : "welcome")} />
					) : currentView === "pipeline" ? (
					<Pipeline />
				) : currentView === "jobs" ? (
					<Jobs />
				) : currentView === "ai-search" ? (
						<UserSearch focusAiSearch={true} />
					) : (
						<UserSearch />
					)}
				</Suspense>
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

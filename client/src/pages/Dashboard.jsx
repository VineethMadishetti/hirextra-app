import { useContext, useEffect, useState } from "react";
import { AuthContext } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";

import AdminDashboard from "./AdminDashboard";
import UserSearch from "./UserSearch";
import UserManagement from "./UserManagement";

import {
  LayoutDashboard,
  Search,
  Users,
  LogOut,
  User,
  CircleDollarSign,
  Plus,
  Moon,
  Sun,
} from "lucide-react";

const Dashboard = () => {
  const { user, logout } = useContext(AuthContext);
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const [currentView, setCurrentView] = useState(
    user?.role === "ADMIN" ? "admin" : "search"
  );
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  useEffect(() => {
    setCurrentView(user?.role === "ADMIN" ? "admin" : "search");
  }, [user]);

  const confirmLogout = () => {
    localStorage.removeItem("hirextra_selectedIds");
    localStorage.removeItem("hirextra_searchInput");
    localStorage.removeItem("hirextra_filters");
    logout();
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      
      {/* ================= TOP NAV ================= */}
      <header className="fixed top-0 inset-x-0 z-50 h-16 bg-white/80 dark:bg-slate-900/80 backdrop-blur border-b border-slate-200 dark:border-slate-800">
        <div className="h-full px-6 flex items-center justify-between">

          {/* Left */}
          <div className="flex items-center gap-10">
            <h1 className="text-xl font-extrabold tracking-tight select-none">
              <span className="bg-gradient-to-r from-blue-500 to-indigo-600 bg-clip-text text-transparent">
                People
              </span>
              <span className="ml-1">Finder</span>
            </h1>

            {user?.role === "ADMIN" && (
              <nav className="hidden md:flex items-center bg-slate-100 dark:bg-slate-800 rounded-full p-1">
                <NavButton
                  active={currentView === "admin"}
                  onClick={() => setCurrentView("admin")}
                  icon={<LayoutDashboard size={16} />}
                  label="Admin"
                />
                <NavButton
                  active={currentView === "users"}
                  onClick={() => setCurrentView("users")}
                  icon={<Users size={16} />}
                  label="Users"
                />
                <NavButton
                  active={currentView === "search"}
                  onClick={() => setCurrentView("search")}
                  icon={<Search size={16} />}
                  label="Search"
                />
              </nav>
            )}
          </div>

          {/* Right */}
          <div className="flex items-center gap-4">
            <IconButton onClick={toggleTheme} title="Toggle theme">
              {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
            </IconButton>

            <div className="hidden sm:flex items-center gap-2 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-full text-sm shadow-inner">
              <CircleDollarSign size={16} className="text-amber-500" />
              <span className="font-semibold">1,250</span>
              <span className="text-slate-500 dark:text-slate-400">Credits</span>
              <button className="ml-2 bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-0.5 rounded-full text-xs flex items-center gap-1">
                <Plus size={12} />
                Buy
              </button>
            </div>

            <div className="flex items-center gap-2">
              <div className="hidden sm:block text-right leading-tight">
                <div className="text-sm font-semibold">{user?.name}</div>
                <div className="text-[10px] uppercase tracking-wide text-blue-600 dark:text-blue-400">
                  {user?.role}
                </div>
              </div>
              <div className="h-9 w-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow">
                <User size={18} />
              </div>
            </div>

            <IconButton
              onClick={() => setShowLogoutModal(true)}
              className="hover:text-red-600"
              title="Logout"
            >
              <LogOut size={18} />
            </IconButton>
          </div>
        </div>
      </header>

      {/* ================= MOBILE NAV ================= */}
      {user?.role === "ADMIN" && (
        <div className="md:hidden fixed top-16 inset-x-0 z-40 flex border-b bg-white/90 dark:bg-slate-900/90 backdrop-blur border-slate-200 dark:border-slate-800">
          <MobileTab label="Admin" active={currentView === "admin"} onClick={() => setCurrentView("admin")} />
          <MobileTab label="Users" active={currentView === "users"} onClick={() => setCurrentView("users")} />
          <MobileTab label="Search" active={currentView === "search"} onClick={() => setCurrentView("search")} />
        </div>
      )}

      {/* ================= CONTENT ================= */}
      <main
        className={`pt-16 ${
          user?.role === "ADMIN" ? "md:pt-16 pt-[112px]" : ""
        }`}
      >
        {currentView === "admin" && <AdminDashboard />}
        {currentView === "users" && <UserManagement />}
        {currentView === "search" && <UserSearch />}
      </main>

      {/* ================= LOGOUT MODAL ================= */}
      {showLogoutModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-xl animate-fade-in">
            <h3 className="text-lg font-semibold mb-1">Confirm Logout</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
              Are you sure you want to end your session?
            </p>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowLogoutModal(false)}
                className="px-4 py-2 text-slate-500 hover:text-slate-900 dark:hover:text-white transition"
              >
                Cancel
              </button>
              <button
                onClick={confirmLogout}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-medium shadow flex items-center gap-2"
              >
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

/* ================== SMALL REUSABLE COMPONENTS ================== */

const NavButton = ({ active, onClick, icon, label }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all
      ${
        active
          ? "bg-white dark:bg-slate-900 text-blue-600 dark:text-white shadow ring-1 ring-slate-200 dark:ring-slate-700"
          : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
      }`}
  >
    {icon}
    {label}
  </button>
);

const IconButton = ({ children, className = "", ...props }) => (
  <button
    {...props}
    className={`p-2 rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition ${className}`}
  >
    {children}
  </button>
);

const MobileTab = ({ label, active, onClick }) => (
  <button
    onClick={onClick}
    className={`flex-1 py-3 text-sm font-medium text-center transition
      ${
        active
          ? "text-indigo-600 border-b-2 border-indigo-600"
          : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
      }`}
  >
    {label}
  </button>
);

import { useContext, useState, useEffect } from 'react';
import { AuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import AdminDashboard from './AdminDashboard';
import UserSearch from './UserSearch';
import UserManagement from './UserManagement';
import { LayoutDashboard, Search, LogOut, User, Users } from 'lucide-react'; // Icons

const Dashboard = () => {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();

  // State to control which view is shown
  // If user is ADMIN, default to 'admin', else 'search'
  const getInitialView = (user) => {
    return user?.role === 'ADMIN' ? 'admin' : 'search';
  };

  const [currentView, setCurrentView] = useState(() => getInitialView(user));

  useEffect(() => {
    const newView = getInitialView(user);
    if (currentView !== newView) {
      setCurrentView(newView);
    }
  }, [user, currentView]);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 font-sans text-slate-800">
      
      {/* --- Top Navigation Bar --- */}
      <nav className="fixed top-0 left-0 right-0 z-50
                bg-white border-b border-gray-200
                px-6 py-3 flex justify-between items-center shadow-sm">

        {/* Left: Logo & Admin Navigation */}
        <div className="flex items-center gap-8">
          <h1 className="text-2xl font-extrabold text-primary tracking-tight">
            People<span className="text-accent">Finder</span>
          </h1>

          {/* Only Admins see these buttons */}
          {user?.role === 'ADMIN' && (
            <div className="hidden md:flex bg-gray-100 p-1 rounded-lg">
              <button 
                onClick={() => setCurrentView('admin')}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold transition-all duration-200 ${
                  currentView === 'admin' 
                    ? 'bg-white text-accent shadow-sm ring-1 ring-gray-200' 
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                <LayoutDashboard size={18} />
                Admin Panel
              </button>
              
              <button 
                onClick={() => setCurrentView('users')}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold transition-all duration-200 ${
                  currentView === 'users' 
                    ? 'bg-white text-accent shadow-sm ring-1 ring-gray-200' 
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                <Users size={18} />
                User Management
              </button>
              
              <button 
                onClick={() => setCurrentView('search')}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold transition-all duration-200 ${
                  currentView === 'search' 
                    ? 'bg-white text-accent shadow-sm ring-1 ring-gray-200' 
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                <Search size={18} />
                Search Database
              </button>
            </div>
          )}
        </div>

        {/* Right: User Profile & Logout */}
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex flex-col items-end">
             <span className="text-sm font-bold text-gray-800">{user?.name}</span>
             <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider border border-gray-200 px-1 rounded bg-gray-50">
               {user?.role}
             </span>
          </div>
          
          <div className="h-8 w-8 bg-gray-200 rounded-full flex items-center justify-center text-gray-500">
             <User size={20} />
          </div>

          <button 
            onClick={handleLogout} 
            className="ml-2 p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-full transition"
            title="Logout"
          >
            <LogOut size={20} />
          </button>
        </div>
      </nav>

      {/* --- Mobile Nav (Only for Admin) --- */}
      {user?.role === 'ADMIN' && (
        <div className="md:hidden flex border-b bg-white">
          <button 
            onClick={() => setCurrentView('admin')}
            className={`flex-1 py-3 text-sm font-medium text-center ${currentView === 'admin' ? 'text-accent border-b-2 border-accent' : 'text-gray-500'}`}
          >
            Uploads
          </button>
          <button 
            onClick={() => setCurrentView('users')}
            className={`flex-1 py-3 text-sm font-medium text-center ${currentView === 'users' ? 'text-accent border-b-2 border-accent' : 'text-gray-500'}`}
          >
            Users
          </button>
          <button 
            onClick={() => setCurrentView('search')}
            className={`flex-1 py-3 text-sm font-medium text-center ${currentView === 'search' ? 'text-accent border-b-2 border-accent' : 'text-gray-500'}`}
          >
            Search
          </button>
        </div>
      )}

      {/* --- Main Content Area --- */}
      <main className="flex-1 flex flex-col overflow-hidden pt-18">

        {currentView === 'admin' ? (
          <AdminDashboard />
        ) : currentView === 'users' ? (
          <UserManagement />
        ) : (
          <UserSearch />
        )}
      </main>

    </div>
  );
};

export default Dashboard;
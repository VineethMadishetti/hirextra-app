import { useState, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useContext(AuthContext);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      const result = await login(email, password);

      if (result.success) {
        navigate('/dashboard');
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-[#0b0f1a] font-sans">

      {/* LEFT — IMAGE / BRAND */}
      <div className="hidden lg:flex w-1/2 relative">
        <img
          src="https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=1472&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D"
          alt="Global Intelligence Network"
          className="absolute inset-0 w-full h-full object-cover"
        />

        {/* Subtle dark overlay */}
        <div className="absolute inset-0 bg-black/60" />

        <div className="relative z-10 p-12 flex flex-col justify-between text-white">
          <div>
  <h1 className="text-6xl font-semibold tracking-tight">
    <span className="text-white">People</span>
    <span className="text-gray-300">Finder</span>
  </h1>

  <p className="mt-6 text-gray-300 max-w-lg leading-relaxed text-base">
    <span className="block text-white font-medium mb-2">
      AI-powered talent intelligence.
    </span>
    PeopleFinder unifies LinkedIn, your internal databases, and global data
    sources to deliver ranked candidate shortlists in minutes.
  </p>

  <p className="mt-4 text-sm text-gray-400 tracking-wide">
    Source smarter. Shortlist faster. Hire with confidence.
  </p>
</div>


          <p className="text-xs text-gray-400">
            © {new Date().getFullYear()} PeopleFinder
          </p>
        </div>
      </div>

      {/* RIGHT — LOGIN */}
      <div className="w-full lg:w-1/2 flex items-center justify-center px-6">
        <div className="w-full max-w-md bg-white rounded-xl shadow-xl p-8">

          {/* Header */}
          <div className="mb-8 text-center">
            <h2 className="text-3xl font-semibold text-gray-900 tracking-tight">
              Welcome back
            </h2>
            <p className="text-gray-500 mt-2 text-sm">
              Sign in to continue
            </p>
          </div>

          {error && (
            <div className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 text-center">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email address
              </label>
              <input
                type="email"
                required
                placeholder="admin@test.com"
                className="w-full rounded-md border border-gray-300 px-4 py-3 text-sm focus:border-gray-900 focus:ring-1 focus:ring-gray-900 outline-none transition"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                type="password"
                required
                placeholder="••••••••"
                className="w-full rounded-md border border-gray-300 px-4 py-3 text-sm focus:border-gray-900 focus:ring-1 focus:ring-gray-900 outline-none transition"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center rounded-md bg-gray-900 px-4 py-3 text-white font-medium transition disabled:bg-gray-500 disabled:cursor-not-allowed hover:bg-gray-800 cursor-pointer"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Signing In...
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-gray-400">
            Enterprise-grade authentication
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;

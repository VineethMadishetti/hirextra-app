import { useState, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('USER');
  const [error, setError] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const { login, register } = useContext(AuthContext);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const result = isRegister 
      ? await register(name, email, password, role)
      : await login(email, password);

    if (result.success) {
      navigate('/dashboard');
    } else {
      setError(result.message);
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

            <p className="mt-4 text-gray-300 max-w-md leading-relaxed">
              <span className="font-medium text-white">
                Find people. Know more. Decide faster.
              </span>
              <br />
              Secure. Fast. Global.
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
              {isRegister ? 'Create Account' : 'Welcome back'}
            </h2>
            <p className="text-gray-500 mt-2 text-sm">
              {isRegister ? 'Sign up to get started' : 'Sign in to continue'}
            </p>
          </div>

          {error && (
            <div className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 text-center">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {isRegister && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="John Doe"
                  className="w-full rounded-md border border-gray-300 px-4 py-3 text-sm focus:border-gray-900 focus:ring-1 focus:ring-gray-900 outline-none transition"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            )}
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
              />
            </div>

            {isRegister && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Role
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-4 py-3 text-sm focus:border-gray-900 focus:ring-1 focus:ring-gray-900 outline-none transition"
                >
                  <option value="USER">User</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </div>
            )}

            <button
              type="submit"
              className="w-full rounded-md bg-gray-900 px-4 py-3 text-white font-medium hover:bg-gray-800 transition"
            >
              {isRegister ? 'Create Account' : 'Sign in'}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-gray-400">
            {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              type="button"
              onClick={() => setIsRegister(!isRegister)}
              className="text-gray-600 hover:text-gray-900 font-medium"
            >
              {isRegister ? 'Sign in' : 'Sign up'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;

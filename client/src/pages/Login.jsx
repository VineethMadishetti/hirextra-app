import { useState, useContext } from "react";
import { AuthContext } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";

const Login = () => {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const { login } = useContext(AuthContext);
	const navigate = useNavigate();

	const handleSubmit = async (e) => {
		e.preventDefault();
		setError("");
		setIsLoading(true);
		try {
			const result = await login(email, password);

			if (result.success) {
				navigate("/dashboard");
			} else {
				setError(result.message);
			}
		} catch (err) {
			setError("An unexpected error occurred. Please try again.");
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div className="min-h-screen flex bg-[#0b0f1a] font-sans">
			{/* LEFT — IMAGE / BRAND */}
<div className="hidden lg:flex w-1/2 relative overflow-hidden">

	{/* Background Image */}
	<img
		src="https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=1472&auto=format&fit=crop"
		alt="Global Intelligence Network"
		className="absolute inset-0 w-full h-full object-cover scale-105"
	/>

	{/* Gradient + Dark Overlay */}
	<div className="absolute inset-0 bg-gradient-to-br from-black/70 via-black/60 to-black/80" />

	{/* Subtle animated glow */}
	<div className="absolute -top-32 -left-32 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl animate-pulse" />

	<div className="relative z-10 p-14 flex flex-col justify-between text-white">

		{/* Brand */}
		<div>
			<h1 className="text-6xl font-extrabold tracking-tight leading-none">
				<span className="bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">
					People
				</span>
				<span className="text-slate-100">Finder</span>
			</h1>

			{/* Accent line */}
			<div className="mt-4 h-1 w-16 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full" />

			{/* Main positioning */}
			<p className="mt-8 max-w-lg text-gray-200 text-base leading-relaxed">
				<span className="block text-white font-semibold mb-3 flex items-center gap-2">
					<span className="inline-block h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
					AI-powered talent intelligence platform
				</span>

				Search across LinkedIn, your internal databases, and global data
				sources — instantly ranked, decision-ready, and bias-aware.
			</p>

			{/* Tagline */}
			<p className="mt-5 text-sm text-gray-400 tracking-wide">
				<span className="text-gray-200 font-medium">
					From signal to shortlist —
				</span>{" "}
				in minutes, not weeks.
			</p>
		</div>

		{/* Footer */}
		<p className="text-xs text-gray-500 tracking-wide">
			© {new Date().getFullYear()} PeopleFinder · Talent Intelligence
		</p>
	</div>
</div>

			{/* RIGHT — LOGIN */}
<div className="w-full lg:w-1/2 flex items-center justify-center px-6">
	<div className="w-full max-w-md bg-white rounded-2xl shadow-xl px-8 py-10">

		{/* Header */}
		<div className="mb-8 text-center">
			<h2 className="text-3xl font-semibold text-slate-900 tracking-tight">
				Welcome Recruiter
			</h2>
			<p className="text-slate-500 mt-2 text-sm">
				Sign in to your account
			</p>
		</div>

		{error && (
			<div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 text-center">
				{error}
			</div>
		)}

		<form onSubmit={handleSubmit} className="space-y-5">

			{/* Email */}
			<div>
				<label className="block text-xs font-semibold text-slate-600 mb-1 tracking-wide uppercase">
					Email address
				</label>
				<input
					type="email"
					required
					placeholder="user@email.com"
					className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm
						text-slate-900 placeholder-slate-400
						focus:border-slate-900 focus:ring-1 focus:ring-slate-900
						outline-none transition"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					disabled={isLoading}
				/>
			</div>

			{/* Password */}
			<div>
				<label className="block text-xs font-semibold text-slate-600 mb-1 tracking-wide uppercase">
					Password
				</label>
				<input
					type="password"
					required
					placeholder="••••••••"
					className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm
						text-slate-900 placeholder-slate-400
						focus:border-slate-900 focus:ring-1 focus:ring-slate-900
						outline-none transition"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					disabled={isLoading}
				/>
			</div>

			{/* Submit */}
			<button
				type="submit"
				disabled={isLoading}
				className="w-full flex items-center justify-center rounded-lg
					bg-slate-900 px-4 py-3 text-white font-semibold
					hover:bg-slate-800
					focus:ring-2 focus:ring-slate-900/30
					transition disabled:opacity-60 disabled:cursor-not-allowed">

				{isLoading ? (
					<>
						<svg
							className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
							xmlns="http://www.w3.org/2000/svg"
							fill="none"
							viewBox="0 0 24 24">
							<circle
								className="opacity-25"
								cx="12"
								cy="12"
								r="10"
								stroke="currentColor"
								strokeWidth="4" />
							<path
								className="opacity-75"
								fill="currentColor"
								d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
						</svg>
						Signing in…
					</>
				) : (
					"Sign In"
				)}
			</button>
		</form>

		{/* Footer */}
		<p className="mt-8 text-center text-xs text-slate-400 tracking-wide">
			Search. Evaluate. Decide.
		</p>
	</div>
</div>

		</div>
	);
};

export default Login;

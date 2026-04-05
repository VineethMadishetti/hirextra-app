import { useState, useContext, useEffect, useRef } from "react";
import { AuthContext } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import LoadingScreen from "../components/LoadingScreen";
import api from "../api/axios";

const EyeIcon = () => (
	<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
		<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
	</svg>
);
const EyeOffIcon = () => (
	<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
		<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
		<line x1="1" y1="1" x2="23" y2="23"/>
	</svg>
);

const PasswordInput = ({ value, onChange, placeholder = "••••••••", autoComplete = "new-password" }) => {
	const [show, setShow] = useState(false);
	return (
		<div className="relative">
			<input
				type={show ? "text" : "password"}
				autoComplete={autoComplete}
				required
				placeholder={placeholder}
				className="w-full rounded-lg border border-white/20 bg-white/10 px-4 py-3 pr-11 text-sm text-white placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition"
				value={value}
				onChange={onChange}
			/>
			<button
				type="button"
				onClick={() => setShow(s => !s)}
				className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition cursor-pointer">
				{show ? <EyeOffIcon /> : <EyeIcon />}
			</button>
		</div>
	);
};

// Password strength checker
function getPasswordStrength(pwd) {
	if (!pwd) return null;
	let score = 0;
	if (pwd.length >= 8) score++;
	if (/[A-Z]/.test(pwd)) score++;
	if (/[0-9]/.test(pwd)) score++;
	if (/[^A-Za-z0-9]/.test(pwd)) score++;
	if (score <= 1) return { label: 'Weak', color: 'bg-rose-500', width: 'w-1/4' };
	if (score === 2) return { label: 'Fair', color: 'bg-amber-500', width: 'w-2/4' };
	if (score === 3) return { label: 'Good', color: 'bg-blue-500', width: 'w-3/4' };
	return { label: 'Strong', color: 'bg-emerald-500', width: 'w-full' };
}

const RESEND_COOLDOWN = 60; // seconds

const Login = () => {
	const [mode, setMode] = useState("login");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [name, setName] = useState("");
	const [error, setError] = useState("");
	const [info, setInfo] = useState("");
	const [isLoading, setIsLoading] = useState(false);

	// Resend cooldown
	const [resendCooldown, setResendCooldown] = useState(0);
	const cooldownRef = useRef(null);

	const startCooldown = () => {
		setResendCooldown(RESEND_COOLDOWN);
		clearInterval(cooldownRef.current);
		cooldownRef.current = setInterval(() => {
			setResendCooldown(prev => {
				if (prev <= 1) { clearInterval(cooldownRef.current); return 0; }
				return prev - 1;
			});
		}, 1000);
	};

	useEffect(() => () => clearInterval(cooldownRef.current), []);

	const { login } = useContext(AuthContext);
	const navigate = useNavigate();

	const switchMode = (m) => { setMode(m); setError(""); setInfo(""); };

	const handleLogin = async (e) => {
		e.preventDefault();
		setError(""); setInfo("");
		setIsLoading(true);
		try {
			const result = await login(email, password);
			if (result.success) {
				navigate("/dashboard");
			} else if (result.code === "EMAIL_NOT_VERIFIED") {
				setInfo("Please verify your email first.");
				switchMode("verify-otp");
			} else if (result.code === "PENDING_APPROVAL") {
				setError("Your account is pending admin approval. You'll receive an email once approved.");
			} else if (result.code === "ACCOUNT_REJECTED") {
				setError("Your account request was not approved. Please contact support.");
			} else {
				setError(result.message || "Invalid email or password");
			}
		} catch {
			setError("An unexpected error occurred. Please try again.");
		} finally {
			setIsLoading(false);
		}
	};

	const handleRegister = async (e) => {
		e.preventDefault();
		setError(""); setInfo("");
		if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
		if (!/[A-Z]/.test(password)) { setError("Password must contain at least one uppercase letter"); return; }
		if (!/[0-9]/.test(password)) { setError("Password must contain at least one number"); return; }
		if (password !== confirmPassword) { setError("Passwords do not match"); return; }
		setIsLoading(true);
		try {
			await api.post("/auth/register", { name, email, password });
			switchMode("pending");
		} catch (err) {
			setError(err.response?.data?.message || "Registration failed. Please try again.");
		} finally {
			setIsLoading(false);
		}
	};

	if (isLoading) return <LoadingScreen message={mode === "login" ? "Verifying credentials..." : "Creating account..."} />;

	const inputCls = "w-full rounded-lg border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition";
	const labelCls = "block text-xs font-semibold text-gray-300 mb-2 tracking-wide uppercase";
	const btnPrimary = "w-full flex items-center justify-center rounded-lg bg-blue-600 px-4 py-3 text-white font-semibold hover:bg-blue-500 focus:ring-2 focus:ring-blue-500/50 transition cursor-pointer";

	return (
		<div className="min-h-screen flex relative overflow-hidden font-sans">
			<img
				src="https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=1472&auto=format&fit=crop"
				alt="Background"
				className="absolute inset-0 w-full h-full object-cover"
			/>
			<div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

			<div className="relative z-10 w-full flex flex-col lg:flex-row">
				{/* LEFT: Branding */}
				<div className="lg:w-1/2 flex flex-col justify-center px-6 sm:px-12 lg:px-24 py-16 sm:py-12 text-white">
					<h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-none mb-6 text-center lg:text-left">
						<span className="bg-linear-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">People</span>
						<span className="text-white">Finder</span>
					</h1>
					<p className="text-lg sm:text-xl text-gray-200 mb-8 max-w-lg leading-relaxed text-center lg:text-left">
						<span className="block font-medium text-white">AI-powered talent intelligence.</span>
						<span className="block mt-1 text-gray-300">Search global data. Get decision-ready candidates, instantly.</span>
					</p>
					<div className="hidden lg:flex items-center gap-4 text-sm text-gray-400">
						<div className="h-1 w-12 bg-blue-500 rounded-full" />
						<span>Search. Evaluate. Decide.</span>
					</div>
				</div>

				{/* RIGHT: Form */}
				<div className="lg:w-1/2 flex items-center justify-center px-6 sm:px-12 py-12">
					<div className="w-full max-w-md">

						{/* ── LOGIN ── */}
						{mode === "login" && (
							<>
								<div className="mb-10 text-center lg:text-left">
									<h2 className="text-3xl font-bold text-white tracking-tight">Welcome back</h2>
									<p className="text-gray-400 mt-2 text-sm">Sign in to your account</p>
								</div>

								{error && <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 text-center">{error}</div>}
								{info  && <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 text-center">{info}</div>}

								<form onSubmit={handleLogin} className="space-y-5">
									<div>
										<label className={labelCls}>Email address</label>
										<input type="email" autoComplete="email" required placeholder="user@email.com"
											className={inputCls} value={email} onChange={e => setEmail(e.target.value)} />
									</div>
									<div>
										<label className={labelCls}>Password</label>
										<PasswordInput value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
									</div>
									<button type="submit" className={btnPrimary}>Sign In</button>
								</form>

								<p className="mt-6 text-center text-sm text-gray-400">
									Don't have an account?{" "}
									<button onClick={() => switchMode("register")} className="text-blue-400 hover:text-blue-300 font-medium transition cursor-pointer">
										Create account
									</button>
								</p>
							</>
						)}

						{/* ── REGISTER ── */}
						{mode === "register" && (
							<>
								<div className="mb-8 text-center lg:text-left">
									<h2 className="text-3xl font-bold text-white tracking-tight">Create account</h2>
									<p className="text-gray-400 mt-2 text-sm">Fill in your details to get started</p>
								</div>

								{error && <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 text-center">{error}</div>}
								{info  && <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 text-center">{info}</div>}

								<form onSubmit={handleRegister} className="space-y-4">
									<div>
										<label className={labelCls}>Full Name</label>
										<input type="text" required placeholder="John Doe"
											className={inputCls} value={name} onChange={e => setName(e.target.value)} />
									</div>
									<div>
										<label className={labelCls}>Email address</label>
										<input type="email" required placeholder="user@email.com"
											className={inputCls} value={email} onChange={e => setEmail(e.target.value)} />
									</div>
									<div>
										<label className={labelCls}>Password</label>
										<PasswordInput value={password} onChange={e => setPassword(e.target.value)} placeholder="Min. 8 chars, 1 uppercase, 1 number" />
										{(() => {
											const s = getPasswordStrength(password);
											return s ? (
												<div className="mt-2">
													<div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
														<div className={`h-full rounded-full transition-all duration-300 ${s.color} ${s.width}`} />
													</div>
													<p className={`text-xs mt-1 font-medium ${s.color.replace('bg-', 'text-')}`}>{s.label}</p>
												</div>
											) : null;
										})()}
									</div>
									<div>
										<label className={labelCls}>Confirm Password</label>
										<PasswordInput value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Re-enter password" />
									</div>
									<button type="submit" className={`${btnPrimary} mt-2`}>
										Sign Up
									</button>
								</form>

								<p className="mt-6 text-center text-sm text-gray-400">
									Already have an account?{" "}
									<button onClick={() => switchMode("login")} className="text-blue-400 hover:text-blue-300 font-medium transition cursor-pointer">
										Sign in
									</button>
								</p>
							</>
						)}

						{/* ── PENDING APPROVAL ── */}
						{mode === "pending" && (
							<div className="text-center">
								<div className="flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/15 border border-emerald-500/30 mx-auto mb-6">
									<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
										<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
									</svg>
								</div>
								<h2 className="text-2xl font-bold text-white mb-3">Account Created!</h2>
								<p className="text-gray-300 mb-2 leading-relaxed">
									Your account is <span className="text-amber-400 font-semibold">pending admin approval</span>.
								</p>
								<p className="text-gray-400 text-sm mb-8 leading-relaxed">
									You'll receive an email at <span className="text-white font-medium">{email}</span> once your account is approved and ready to use.
								</p>
								<button
									onClick={() => switchMode("login")}
									className="text-blue-400 hover:text-blue-300 text-sm font-medium transition cursor-pointer">
									← Back to sign in
								</button>
							</div>
						)}

					</div>
				</div>
			</div>
		</div>
	);
};

export default Login;

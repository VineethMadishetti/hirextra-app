import { useContext, useState, useEffect, lazy, Suspense } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import toast from "react-hot-toast";
import LoadingScreen from "../components/LoadingScreen";
import SourcingAgentModal from "../components/SourcingAgentModal";

// Home page shown to ADMIN role after login
const AdminHomePage = ({ user, onNavigate }) => (
	<div className="flex-1 flex flex-col items-center justify-center px-6 py-16 min-h-full">
		<h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
			Welcome back, {user?.name?.split(' ')[0] || 'Admin'}!
		</h1>
		<p className="text-slate-500 dark:text-slate-400 text-lg leading-relaxed text-center mb-10">
			Your AI-powered talent platform is ready. Manage users, search talent, and source candidates.
		</p>

		<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 w-full max-w-5xl">
			{/* Admin Panel Card */}
			<button
				onClick={() => onNavigate("admin")}
				className="group relative flex flex-col items-start gap-4 p-6 rounded-2xl border border-slate-200 dark:border-slate-700/60
				bg-white dark:bg-slate-800/60 shadow-sm hover:shadow-xl hover:shadow-blue-100/50 dark:hover:shadow-blue-900/20
				hover:border-blue-300 dark:hover:border-blue-600/50 transition-all duration-300 text-left cursor-pointer">
				<div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center group-hover:bg-blue-100 dark:group-hover:bg-blue-500/20 transition-colors">
					<LayoutDashboard size={22} className="text-blue-600 dark:text-blue-400" />
				</div>
				<div className="flex-1">
					<h3 className="font-bold text-slate-900 dark:text-white text-base mb-1">Admin Panel</h3>
					<p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">Upload resumes, manage candidate databases and track import history.</p>
				</div>
				<ArrowRight size={18} className="text-slate-300 group-hover:text-blue-500 group-hover:translate-x-1 transition-all" />
			</button>

			{/* User Management Card */}
			<button
				onClick={() => onNavigate("users")}
				className="group relative flex flex-col items-start gap-4 p-6 rounded-2xl border border-slate-200 dark:border-slate-700/60
				bg-white dark:bg-slate-800/60 shadow-sm hover:shadow-xl hover:shadow-violet-100/50 dark:hover:shadow-violet-900/20
				hover:border-violet-300 dark:hover:border-violet-600/50 transition-all duration-300 text-left cursor-pointer overflow-hidden">
				<div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-violet-100/60 dark:from-violet-500/10 to-transparent rounded-bl-full pointer-events-none" />
				<div className="w-12 h-12 rounded-xl bg-violet-50 dark:bg-violet-500/10 flex items-center justify-center group-hover:bg-violet-100 dark:group-hover:bg-violet-500/20 transition-colors">
					<Users size={22} className="text-violet-600 dark:text-violet-400" />
				</div>
				<div className="flex-1">
					<h3 className="font-bold text-slate-900 dark:text-white text-base mb-1">User Management</h3>
					<p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">Create, manage and monitor user accounts and permissions.</p>
				</div>
				<ArrowRight size={18} className="text-slate-300 group-hover:text-violet-500 group-hover:translate-x-1 transition-all" />
			</button>

			{/* AI Talent Search Card */}
			<button
				onClick={() => onNavigate("search")}
				className="group relative flex flex-col items-start gap-4 p-6 rounded-2xl border border-slate-200 dark:border-slate-700/60
				bg-white dark:bg-slate-800/60 shadow-sm hover:shadow-xl hover:shadow-indigo-100/50 dark:hover:shadow-indigo-900/20
				hover:border-indigo-300 dark:hover:border-indigo-600/50 transition-all duration-300 text-left cursor-pointer overflow-hidden">
				<div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-indigo-100/60 dark:from-indigo-500/10 to-transparent rounded-bl-full pointer-events-none" />
				<div className="w-12 h-12 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center group-hover:bg-indigo-100 dark:group-hover:bg-indigo-500/20 transition-colors">
					<Search size={22} className="text-indigo-600 dark:text-indigo-400" />
				</div>
				<div className="flex-1">
					<h3 className="font-bold text-slate-900 dark:text-white text-base mb-1">AI Talent Search</h3>
					<p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">Filter by skills, location, title & more from our global talent database.</p>
				</div>
				<ArrowRight size={18} className="text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-1 transition-all" />
			</button>

			{/* AI Talent Source Card */}
			<button
				onClick={() => onNavigate("ai-source")}
				className="group relative flex flex-col items-start gap-4 p-6 rounded-2xl border border-slate-200 dark:border-slate-700/60
				bg-white dark:bg-slate-800/60 shadow-sm hover:shadow-xl hover:shadow-emerald-100/50 dark:hover:shadow-emerald-900/20
				hover:border-emerald-300 dark:hover:border-emerald-600/50 transition-all duration-300 text-left cursor-pointer">
				<div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center group-hover:bg-emerald-100 dark:group-hover:bg-emerald-500/20 transition-colors">
					<Zap size={22} className="text-emerald-600 dark:text-emerald-400" />
				</div>
				<div className="flex-1">
					<div className="flex items-center gap-2 mb-1">
						<h3 className="font-bold text-slate-900 dark:text-white text-base">AI Talent Source</h3>
						<span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 rounded-full">New</span>
					</div>
					<p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">Paste a job description — let AI discover matching candidates globally.</p>
				</div>
				<ArrowRight size={18} className="text-slate-300 group-hover:text-emerald-500 group-hover:translate-x-1 transition-all" />
			</button>
		</div>

		<p className="mt-10 text-xs text-slate-400 dark:text-slate-600">
			Use the navigation above to switch between tools anytime
		</p>
	</div>
);

// Welcome page shown to USER role after login
const WelcomePage = ({ user, onNavigate }) => (
	<div className="flex-1 flex flex-col items-center justify-center px-6 py-16 min-h-full">
		<h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
			Welcome, {user?.name?.split(' ')[0] || 'there'}!
		</h1>
		{/* Subtitle */}
		<p className="text-slate-500 dark:text-slate-400 text-lg leading-relaxed text-center mb-10">
			Your AI-powered talent finder is ready. Discover the right people faster than ever.
		</p>

		{/* Action Cards */}
		<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 w-full max-w-5xl">
			{/* Search Database Card */}
			<button
				onClick={() => onNavigate("search")}
				className="group relative flex flex-col items-start gap-4 p-6 rounded-2xl border border-slate-200 dark:border-slate-700/60
				bg-white dark:bg-slate-800/60 shadow-sm hover:shadow-xl hover:shadow-blue-100/50 dark:hover:shadow-blue-900/20
				hover:border-blue-300 dark:hover:border-blue-600/50 transition-all duration-300 text-left cursor-pointer">
				<div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center group-hover:bg-blue-100 dark:group-hover:bg-blue-500/20 transition-colors">
					<Search size={22} className="text-blue-600 dark:text-blue-400" />
				</div>
				<div className="flex-1">
					<h3 className="font-bold text-slate-900 dark:text-white text-base mb-1">AI Talent Search</h3>
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

// Payment method icons
const CardIcon = () => (
	<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
		<rect x="2" y="5" width="20" height="14" rx="2"/>
		<line x1="2" y1="10" x2="22" y2="10"/>
		<line x1="6" y1="15" x2="10" y2="15"/>
	</svg>
);
const NetbankingIcon = () => (
	<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
		<path d="M3 9l9-7 9 7v11a1 1 0 01-1 1H4a1 1 0 01-1-1z"/>
		<polyline points="9 22 9 12 15 12 15 22"/>
	</svg>
);
const UPIIcon = () => (
	<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
		<path d="M12 2L2 7l10 5 10-5-10-5z"/>
		<path d="M2 17l10 5 10-5"/>
		<path d="M2 12l10 5 10-5"/>
	</svg>
);

// Modal for buying credits via Stripe Checkout — two-step: amount → review + payment method
const BuyCreditsModal = ({ onClose, user }) => {
	const [step, setStep] = useState('amount'); // 'amount' | 'review'
	const [amount, setAmount] = useState('');
	const [paymentMethod, setPaymentMethod] = useState('card');
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');

	const parsedAmount = parseFloat(amount) || 0;
	const credits = Math.floor(parsedAmount * 10);
	const valid = parsedAmount >= 5;

	const handleProceed = () => {
		if (!valid) return;
		setError('');
		setStep('review');
	};

	const handlePay = async () => {
		setLoading(true);
		setError('');
		try {
			const { data } = await api.post('/credits/create-checkout', {
				amount: parsedAmount,
				paymentMethod,
			});
			window.location.href = data.url;
		} catch (err) {
			const msg = err.response?.data?.message || 'Could not start checkout. Please try again.';
			setError(msg);
			setLoading(false);
		}
	};

	const paymentMethods = [
		{ id: 'card',       label: 'Card',       sub: 'Visa, Mastercard, Amex',    Icon: CardIcon },
		{ id: 'netbanking', label: 'Netbanking',  sub: 'All major banks supported',  Icon: NetbankingIcon },
		{ id: 'upi',        label: 'UPI',         sub: 'GPay, PhonePe, Paytm & more', Icon: UPIIcon },
	];

	return (
		<div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
			<div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">

				{/* Header */}
				<div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100 dark:border-slate-800">
					<div className="flex items-center gap-3">
						{step === 'review' && (
							<button
								onClick={() => setStep('amount')}
								className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-white transition">
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
							</button>
						)}
						<div>
							<h3 className="text-lg font-semibold text-slate-900 dark:text-white">
								{step === 'amount' ? 'Buy Credits' : 'Confirm & Pay'}
							</h3>
							<div className="flex items-center gap-1.5 mt-0.5">
								<span className={`w-2 h-2 rounded-full ${step === 'amount' ? 'bg-indigo-500' : 'bg-slateigo-200 dark:bg-slate-700'}`} />
								<span className={`w-2 h-2 rounded-full ${step === 'review' ? 'bg-indigo-500' : 'bg-slate-200 dark:bg-slate-700'}`} />
							</div>
						</div>
					</div>
					<button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-white transition">
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
					</button>
				</div>

				{/* Step 1: Amount */}
				{step === 'amount' && (
					<div className="px-6 py-5 space-y-4">
						<div>
							<label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Amount (USD)</label>
							<div className="relative">
								<span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-lg">$</span>
								<input
									type="number"
									min="5"
									step="1"
									value={amount}
									onChange={e => setAmount(e.target.value)}
									onKeyDown={e => e.key === 'Enter' && handleProceed()}
									placeholder="0"
									autoFocus
									className="w-full pl-8 pr-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
								/>
							</div>
							<p className="text-xs text-slate-400 mt-1.5">Minimum $5 · Rate: $1 = 10 credits</p>
						</div>

						{/* Quick-select */}
						<div className="flex gap-2">
							{[10, 25, 50, 100].map(preset => (
								<button
									key={preset}
									onClick={() => setAmount(String(preset))}
									className={`flex-1 py-2 rounded-xl text-sm font-bold border-2 transition ${
										parsedAmount === preset
											? 'bg-indigo-600 text-white border-indigo-600'
											: 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-400 hover:text-indigo-600 dark:hover:border-indigo-500 dark:hover:text-indigo-400'
									}`}>
									${preset}
								</button>
							))}
						</div>

						<div className="rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/20 px-4 py-3 flex items-center justify-between">
							<span className="text-sm text-slate-600 dark:text-slate-300">You will receive</span>
							<span className="text-xl font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
								<CircleDollarSign size={20} />
								{credits > 0 ? credits.toLocaleString() : '—'} credits
							</span>
						</div>

						<button
							onClick={handleProceed}
							disabled={!valid}
							className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold shadow transition flex items-center justify-center gap-2">
							Proceed to Payment
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
						</button>
					</div>
				)}

				{/* Step 2: Review + Payment Method */}
				{step === 'review' && (
					<div className="px-6 py-5 space-y-5">
						{/* Order summary */}
						<div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 overflow-hidden">
							<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
								<p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Order Summary</p>
							</div>
							<div className="px-4 py-3 space-y-2.5">
								<div className="flex justify-between text-sm">
									<span className="text-slate-500 dark:text-slate-400">Credits</span>
									<span className="font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1">
										<CircleDollarSign size={14} /> {credits.toLocaleString()}
									</span>
								</div>
								<div className="flex justify-between text-sm">
									<span className="text-slate-500 dark:text-slate-400">Rate</span>
									<span className="font-medium text-slate-700 dark:text-slate-300">$1 = 10 credits</span>
								</div>
								<div className="h-px bg-slate-200 dark:bg-slate-700" />
								<div className="flex justify-between">
									<span className="font-semibold text-slate-800 dark:text-white">Amount Payable</span>
									<span className="font-bold text-xl text-indigo-600 dark:text-indigo-400">${parsedAmount.toFixed(2)}</span>
								</div>
							</div>
						</div>

						{/* User details */}
						<div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 overflow-hidden">
							<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
								<p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Billing To</p>
							</div>
							<div className="px-4 py-3 space-y-1">
								<p className="font-semibold text-slate-800 dark:text-white">{user?.name}</p>
								<p className="text-sm text-slate-500 dark:text-slate-400">{user?.email}</p>
							</div>
						</div>

						{/* Payment method */}
						<div>
							<p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Choose a Payment Option</p>
							<div className="space-y-2">
								{paymentMethods.map(({ id, label, sub, Icon }) => (
									<button
										key={id}
										onClick={() => setPaymentMethod(id)}
										className={`w-full flex items-center gap-4 px-4 py-3 rounded-xl border-2 transition text-left ${
											paymentMethod === id
												? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10'
												: 'border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-600/50 bg-white dark:bg-slate-800/40'
										}`}>
										<span className={paymentMethod === id ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}>
											<Icon />
										</span>
										<div className="flex-1">
											<p className={`text-sm font-semibold ${paymentMethod === id ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-200'}`}>{label}</p>
											<p className="text-xs text-slate-400">{sub}</p>
										</div>
										<div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
											paymentMethod === id ? 'border-indigo-500 bg-indigo-500' : 'border-slate-300 dark:border-slate-600'
										}`}>
											{paymentMethod === id && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
										</div>
									</button>
								))}
							</div>
						</div>

						{error && <p className="text-sm text-red-500">{error}</p>}

						<button
							onClick={handlePay}
							disabled={loading}
							className="w-full py-3 rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold shadow-lg shadow-green-500/20 transition flex items-center justify-center gap-2">
							{loading
								? <><Loader size={15} className="animate-spin" />Redirecting to Stripe…</>
								: <>Pay ${parsedAmount.toFixed(2)} · Get {credits.toLocaleString()} Credits</>
							}
						</button>

						<p className="text-center text-xs text-slate-400 flex items-center justify-center gap-1">
							<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>
							Secured by Stripe · No card data touches our servers
						</p>
					</div>
				)}
			</div>
		</div>
	);
};

// Lazy load components to reduce initial bundle size
const AdminDashboard = lazy(() => import("./AdminDashboard"));
const UserSearch = lazy(() => import("./UserSearch"));
const UserManagement = lazy(() => import("./UserManagement"));
// const Enrich = lazy(() => import("./Enrich")); // hidden for now
const PrivateDatabases = lazy(() => import("./PrivateDatabases"));

const Dashboard = () => {
	const { user, logout } = useContext(AuthContext);
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	// Theme state - load from localStorage or default to light
	const { theme, toggleTheme } = useTheme();

	// State to control which view is shown
	// If user is ADMIN, default to 'admin', else 'welcome'
	const [currentView, setCurrentView] = useState(
		() => (user?.role === "ADMIN" ? "home" : "welcome"),
	);

	const [showBuyModal, setShowBuyModal] = useState(false);

	const { data: creditsData, refetch: refetchCredits } = useQuery({
		queryKey: ['credits'],
		queryFn: () => api.get('/credits/balance').then(r => r.data),
		enabled: !!user,
		staleTime: 30 * 1000,
	});

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
			setCurrentView("home");
		} else {
			setCurrentView("welcome");
		}
	}, [user]);

	// Handle Stripe redirect back from checkout
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const payment = params.get('payment');
		if (!payment) return;

		// Clean up URL without full page reload
		window.history.replaceState({}, '', window.location.pathname);

		if (payment === 'success') {
			const credits = params.get('credits');
			toast.success(
				credits
					? `Payment successful! ${credits} credits added to your account.`
					: 'Payment successful! Credits added to your account.',
				{ duration: 6000 }
			);
			refetchCredits();
		} else if (payment === 'cancelled') {
			toast('Payment cancelled. No charges were made.', { icon: 'ℹ️', duration: 4000 });
		}
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

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
						onClick={() => user?.role === "ADMIN" ? setCurrentView("home") : setCurrentView("welcome")}
						className="text-xl font-extrabold tracking-tight leading-none select-none cursor-pointer hover:opacity-80 transition-opacity">
						<span className="bg-gradient-to-r from-blue-500 to-indigo-600 bg-clip-text text-transparent">
							People
						</span>
						<span className="text-slate-900 dark:text-slate-200">Finder</span>
					</button>

					{/* USER Navigation: Search Database, AI Search, My Databases */}
					{user?.role === "USER" && (
						<div className="hidden md:flex items-center bg-slate-100 dark:bg-slate-800 rounded-full p-1 shadow-inner">
							<button
								onClick={() => setCurrentView("search")}
								className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all
								${currentView === "search"
									? "bg-white dark:bg-slate-900 text-blue-600 dark:text-slate-100 shadow ring-1 ring-slate-200 dark:ring-slate-700"
									: "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
								}`}>
								<Search size={16} />AI Talent Search</button>
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
								<Search size={16} />AI Talent Search</button>
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
							<Zap size={16} />AI Talent Source</button>
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

	
				{/* Credits Display — USER only */}
				{user?.role === "USER" && (
					<div className="hidden sm:flex items-center gap-2 bg-slate-100/80 dark:bg-slate-800/50 p-1 rounded-full shadow-inner">
						<div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200 px-2">
							<CircleDollarSign size={16} className="text-amber-500" />
							<span>{creditsData?.credits ?? '—'}</span>
							<span className="font-normal text-slate-500 dark:text-slate-400">
								Credits
							</span>
						</div>
						<button
							onClick={() => setShowBuyModal(true)}
							className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-green-500 rounded-full shadow-md transition-all cursor-pointer">
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
					<Search size={14} />AI Talent Search</button>
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
					onClick={() => setCurrentView("home")}
					className={`flex-1 py-3 text-sm font-medium text-center ${
							currentView === "home"
								? "text-indigo-600 border-b-2 border-indigo-600"
								: "text-gray-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
						}`}>
						Home
					</button>
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
					{currentView === "home" ? (
						<AdminHomePage user={user} onNavigate={setCurrentView} />
					) : currentView === "welcome" ? (
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
					) : currentView === "ai-search" ? (
						<UserSearch focusAiSearch={true} />
					) : (
						<UserSearch />
					)}
				</Suspense>
			</main>

			{/* Buy Credits Modal */}
			{showBuyModal && (
				<BuyCreditsModal onClose={() => setShowBuyModal(false)} user={user} />
			)}

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

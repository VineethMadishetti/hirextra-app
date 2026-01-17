import React from "react";
import { Loader, Sparkles } from "lucide-react";

const LoadingScreen = ({ message = "Loading your experience..." }) => {
	return (
		<div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 animate-in fade-in duration-500">
			<div className="relative mb-8">
				{/* Background Glow */}
				<div className="absolute inset-0 bg-indigo-500/30 blur-3xl rounded-full animate-pulse" />
				
				{/* Icon Card */}
				<div className="relative bg-white dark:bg-slate-900 p-8 rounded-3xl shadow-2xl shadow-indigo-500/20 border border-slate-200 dark:border-slate-800 flex items-center justify-center">
					<Loader className="w-12 h-12 text-indigo-600 animate-spin" />
					<div className="absolute -top-2 -right-2 bg-indigo-100 dark:bg-indigo-900/50 p-2 rounded-full">
						<Sparkles className="w-5 h-5 text-indigo-500 fill-indigo-500" />
					</div>
				</div>
			</div>

			<h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2 tracking-tight">
				Hirextra
			</h2>
			<p className="text-slate-500 dark:text-slate-400 text-sm font-medium mb-8 animate-pulse">
				{message}
			</p>

			{/* Loading Dots */}
			<div className="flex gap-2.5">
				<div className="w-3 h-3 bg-indigo-600 rounded-full animate-bounce [animation-delay:-0.3s]" />
				<div className="w-3 h-3 bg-indigo-600 rounded-full animate-bounce [animation-delay:-0.15s]" />
				<div className="w-3 h-3 bg-indigo-600 rounded-full animate-bounce" />
			</div>
		</div>
	);
};

export default LoadingScreen;
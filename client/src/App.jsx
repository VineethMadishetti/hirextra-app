import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, AuthContext } from "./context/AuthContext";
import { useContext } from "react";
import { UploadProvider } from "./context/UploadContext"; // Assuming UploadContext.jsx is in src/context
import { Toaster } from "react-hot-toast";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ThemeProvider } from "./context/ThemeContext";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
// --- Placeholder Imports for Nested Routes ---
// You will need to create these components if they don't exist.
import AdminPanel from "./pages/AdminPanel"; // Assuming this is the main dashboard view
import UserManagement from "./pages/UserManagement";
import SearchDatabase from "./pages/SearchDatabase";

// Optimized QueryClient for production-grade caching
const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 10 * 60 * 1000, // 10 minutes - data stays fresh
			gcTime: 30 * 60 * 1000, // 30 minutes cache (previously cacheTime in v4)
			refetchOnWindowFocus: false, // Don't refetch on window focus
			refetchOnMount: false, // Don't refetch if data exists in cache
			refetchOnReconnect: false, // Don't refetch on reconnect
			retry: 1, // Only retry once on failure
		},
	},
});

const PrivateRoute = ({ children }) => {
	const { user } = useContext(AuthContext);
	return user ? children : <Navigate to="/login" replace />;
};

function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<AuthProvider>
				<ThemeProvider>
					<UploadProvider>
						<Toaster
							position="top-right"
							reverseOrder={false}
							gutter={12}
							containerStyle={{ top: 24, right: 20 }}
							toastOptions={{
								className: "hx-toast",
								duration: 3500,
								success: {
									className: "hx-toast hx-toast-success",
									iconTheme: { primary: "#059669", secondary: "#ecfdf5" },
								},
								error: {
									className: "hx-toast hx-toast-error",
									iconTheme: { primary: "#dc2626", secondary: "#fef2f2" },
								},
								loading: {
									className: "hx-toast hx-toast-loading",
								},
							}}
						/>
						<BrowserRouter>
							<Routes>
								<Route path="/" element={<Navigate to="/login" replace />} />

								{/* Login route */}
								<Route path="/login" element={<Login />} />
								<Route
									path="/dashboard"
									element={
										<PrivateRoute>
											<Dashboard />
										</PrivateRoute>
									}>
									<Route index element={<AdminPanel />} />
									<Route path="user-management" element={<UserManagement />} />
									<Route path="search-database" element={<SearchDatabase />} />
								</Route>
								<Route path="*" element={<Navigate to="/login" replace />} />
							</Routes>
						</BrowserRouter>
						<ReactQueryDevtools initialIsOpen={false} position="bottom-right" />
					</UploadProvider>
				</ThemeProvider>
			</AuthProvider>
		</QueryClientProvider>
	);
}

export default App;

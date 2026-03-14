const fs = require('fs');
let content = fs.readFileSync('client/src/pages/Dashboard.jsx', 'utf8');

// 1. Add lazy imports for Pipeline and Jobs after PrivateDatabases
content = content.replace(
  "const PrivateDatabases = lazy(() => import('./PrivateDatabases'));",
  `const PrivateDatabases = lazy(() => import('./PrivateDatabases'));
const Pipeline = lazy(() => import('./Pipeline'));
const Jobs = lazy(() => import('./Jobs'));`
);

// 2. Add Kanban + Briefcase icons to lucide imports
content = content.replace(
  "import {\n\tLayoutDashboard,\n\tSearch,\n\tSparkles,\n\tLogOut,\n\tUser,\n\tUsers,\n\tCircleDollarSign,\n\tPlus,\n\tMoon,\n\tSun,\n\tLoader,\n\tZap,\n\tArrowRight,\n\tDatabase,\n} from \"lucide-react\";",
  `import {
\tLayoutDashboard,
\tSearch,
\tSparkles,
\tLogOut,
\tUser,
\tUsers,
\tCircleDollarSign,
\tPlus,
\tMoon,
\tSun,
\tLoader,
\tZap,
\tArrowRight,
\tDatabase,
\tKanbanSquare,
\tBriefcase,
} from "lucide-react";`
);

// 3. Add Pipeline + Jobs nav buttons for USER (after My Databases button in USER nav)
content = content.replace(
  `\t\t\t\t\t<button
\t\t\t\t\t\tonClick={() => setCurrentView("my-databases")}
\t\t\t\t\t\tclassName={\`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all
\t\t\t\t\t\t${currentView === "my-databases"
\t\t\t\t\t\t\t? "bg-white dark:bg-slate-900 text-emerald-600 dark:text-slate-100 shadow ring-1 ring-slate-200 dark:ring-slate-700"
\t\t\t\t\t\t\t: "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
\t\t\t\t\t\t}\`}>
\t\t\t\t\t\t<Database size={16} />
\t\t\t\t\t\tMy Databases
\t\t\t\t\t</button>
\t\t\t\t</div>
\t\t\t)}`,
  `\t\t\t\t\t<button
\t\t\t\t\t\tonClick={() => setCurrentView("my-databases")}
\t\t\t\t\t\tclassName={\`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all
\t\t\t\t\t\t${currentView === "my-databases"
\t\t\t\t\t\t\t? "bg-white dark:bg-slate-900 text-emerald-600 dark:text-slate-100 shadow ring-1 ring-slate-200 dark:ring-slate-700"
\t\t\t\t\t\t\t: "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
\t\t\t\t\t\t}\`}>
\t\t\t\t\t\t<Database size={16} />
\t\t\t\t\t\tMy Databases
\t\t\t\t\t</button>
\t\t\t\t\t<button
\t\t\t\t\t\tonClick={() => setCurrentView("pipeline")}
\t\t\t\t\t\tclassName={\`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all
\t\t\t\t\t\t${currentView === "pipeline"
\t\t\t\t\t\t\t? "bg-white dark:bg-slate-900 text-violet-600 dark:text-slate-100 shadow ring-1 ring-slate-200 dark:ring-slate-700"
\t\t\t\t\t\t\t: "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
\t\t\t\t\t\t}\`}>
\t\t\t\t\t\t<KanbanSquare size={16} />
\t\t\t\t\t\tPipeline
\t\t\t\t\t</button>
\t\t\t\t\t<button
\t\t\t\t\t\tonClick={() => setCurrentView("jobs")}
\t\t\t\t\t\tclassName={\`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all
\t\t\t\t\t\t${currentView === "jobs"
\t\t\t\t\t\t\t? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-slate-100 shadow ring-1 ring-slate-200 dark:ring-slate-700"
\t\t\t\t\t\t\t: "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
\t\t\t\t\t\t}\`}>
\t\t\t\t\t\t<Briefcase size={16} />
\t\t\t\t\t\tJobs
\t\t\t\t\t</button>
\t\t\t\t</div>
\t\t\t)}`
);

// 4. Add Pipeline + Jobs to ADMIN nav (after AI Source button)
content = content.replace(
  `\t\t\t\t\t<button
\t\t\t\t\t\tonClick={() => setCurrentView("ai-source")}
\t\t\t\t\t\tclassName={\`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all
\t\t\t\t            ${
\t\t\t\t\t\t\tcurrentView === "ai-source"
\t\t\t\t\t\t\t\t? "bg-white dark:bg-slate-900 text-blue-600 dark:text-slate-100 shadow ring-1 ring-slate-200 dark:ring-slate-700"
\t\t\t\t\t\t\t\t: "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800"
\t\t\t\t\t\t\t}\`}>
\t\t\t\t\t\t<Zap size={16} />
\t\t\t\t\t\tAI Source
\t\t\t\t\t</button>
\t\t\t\t</div>
\t\t\t)}`,
  `\t\t\t\t\t<button
\t\t\t\t\t\tonClick={() => setCurrentView("ai-source")}
\t\t\t\t\t\tclassName={\`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all
\t\t\t\t            ${
\t\t\t\t\t\t\tcurrentView === "ai-source"
\t\t\t\t\t\t\t\t? "bg-white dark:bg-slate-900 text-blue-600 dark:text-slate-100 shadow ring-1 ring-slate-200 dark:ring-slate-700"
\t\t\t\t\t\t\t\t: "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800"
\t\t\t\t\t\t\t}\`}>
\t\t\t\t\t\t<Zap size={16} />
\t\t\t\t\t\tAI Source
\t\t\t\t\t</button>
\t\t\t\t\t<button
\t\t\t\t\t\tonClick={() => setCurrentView("pipeline")}
\t\t\t\t\t\tclassName={\`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all ${currentView === "pipeline" ? "bg-white dark:bg-slate-900 text-violet-600 dark:text-slate-100 shadow ring-1 ring-slate-200 dark:ring-slate-700" : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"}\`}>
\t\t\t\t\t\t<KanbanSquare size={16} />
\t\t\t\t\t\tPipeline
\t\t\t\t\t</button>
\t\t\t\t\t<button
\t\t\t\t\t\tonClick={() => setCurrentView("jobs")}
\t\t\t\t\t\tclassName={\`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all ${currentView === "jobs" ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-slate-100 shadow ring-1 ring-slate-200 dark:ring-slate-700" : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"}\`}>
\t\t\t\t\t\t<Briefcase size={16} />
\t\t\t\t\t\tJobs
\t\t\t\t\t</button>
\t\t\t\t</div>
\t\t\t)}`
);

// 5. Add Pipeline + Jobs to the main content rendering switch
content = content.replace(
  `) : currentView === "ai-source" ? (
\t\t\t\t\t<SourcingAgentModal inline={true} onClose={() => setCurrentView(user?.role === "ADMIN" ? "admin" : "welcome")} />
\t\t\t\t) : currentView === "ai-search" ? (
\t\t\t\t\t<UserSearch focusAiSearch={true} />
\t\t\t\t) : (
\t\t\t\t\t<UserSearch />
\t\t\t\t)}`,
  `) : currentView === "ai-source" ? (
\t\t\t\t\t<SourcingAgentModal inline={true} onClose={() => setCurrentView(user?.role === "ADMIN" ? "admin" : "welcome")} />
\t\t\t\t) : currentView === "pipeline" ? (
\t\t\t\t\t<Pipeline />
\t\t\t\t) : currentView === "jobs" ? (
\t\t\t\t\t<Jobs />
\t\t\t\t) : currentView === "ai-search" ? (
\t\t\t\t\t<UserSearch focusAiSearch={true} />
\t\t\t\t) : (
\t\t\t\t\t<UserSearch />
\t\t\t\t)}`
);

fs.writeFileSync('client/src/pages/Dashboard.jsx', content, 'utf8');
console.log('Done');

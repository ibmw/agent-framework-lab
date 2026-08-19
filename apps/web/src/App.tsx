import { API_VERSION } from "@agent-lab/contracts";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { HorizontalBenchRail, useScrollToBenchHash } from "./components/BenchRail";
import { ComparePage } from "./routes/ComparePage";
import { ConversationPage } from "./routes/ConversationPage";
import { FrameworksPage } from "./routes/FrameworksPage";
import { LibraryPage } from "./routes/LibraryPage";
import { PersonaPage } from "./routes/PersonaPage";

export function App() {
  const location = useLocation();
  useScrollToBenchHash();

  return (
    <main className="mx-auto w-full max-w-[1200px] px-5 pt-6 pb-20">
      <header className="mb-6 flex items-center gap-3.5 border-b border-lab-ink/15 px-6 py-[15px]">
        <Link
          className="font-display text-[19px] font-bold tracking-[-0.04em] text-lab-ink no-underline"
          to="/"
          aria-label="Agent Framework Capability Lab home"
        >
          AF<span className="text-lab-accent">CL</span>
        </Link>
        <nav className="ml-auto flex items-center gap-[18px]" aria-label="Primary">
          <Link className="text-[13px] text-lab-ink-soft no-underline hover:text-lab-ink" to="/">
            Bench
          </Link>
          <Link
            className="text-[13px] text-lab-ink-soft no-underline hover:text-lab-ink"
            to="/frameworks"
          >
            Frameworks
          </Link>
          <span className="rounded-full border border-lab-ink/25 px-2.5 py-1 font-mono text-[11px] font-bold tracking-[0.08em] text-lab-ink-soft uppercase">
            API {API_VERSION}
          </span>
        </nav>
      </header>

      <HorizontalBenchRail className={location.pathname === "/" ? "min-[900px]:hidden" : ""} />

      <Routes>
        <Route path="/" element={<LibraryPage />} />
        <Route path="/frameworks" element={<FrameworksPage />} />
        <Route path="/personas/:ref" element={<PersonaPage />} />
        <Route path="/personas/:ref/compare" element={<ComparePage />} />
        <Route path="/personas/:ref/conversations/:conversationId" element={<ConversationPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </main>
  );
}

import { API_VERSION } from "@agent-lab/contracts";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { ConversationPage } from "./routes/ConversationPage";
import { LibraryPage } from "./routes/LibraryPage";
import { PersonaPage } from "./routes/PersonaPage";

export function App() {
  return (
    <main className="mx-auto w-full max-w-[1200px] px-5 pt-6 pb-20">
      <header className="flex items-center justify-between pb-12 md:pb-[4.5rem]">
        <Link
          className="font-display text-xl font-bold tracking-[-0.04em] text-lab-ink no-underline"
          to="/"
          aria-label="Agent Framework Capability Lab home"
        >
          AF<span className="text-lab-accent">CL</span>
        </Link>
        <span className="rounded-full border border-lab-ink/25 px-2.5 py-1.5 font-mono text-xs font-bold tracking-[0.08em] text-lab-ink-soft uppercase">
          API {API_VERSION}
        </span>
      </header>

      <Routes>
        <Route path="/" element={<LibraryPage />} />
        <Route path="/personas/:ref" element={<PersonaPage />} />
        <Route path="/personas/:ref/conversations/:conversationId" element={<ConversationPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </main>
  );
}

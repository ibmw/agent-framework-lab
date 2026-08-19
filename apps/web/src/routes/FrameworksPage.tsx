import type { AgentFrameworkListResponse } from "@agent-lab/contracts";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listAgentFrameworks } from "../api/conversations";
import { FrameworkPicker } from "../components/FrameworkPicker";
import { parseConversationPath } from "../lib/scenarios";
import { LAST_CONVERSATION_KEY } from "../lib/ui";

type Framework = AgentFrameworkListResponse["frameworks"][number];

export function FrameworksPage() {
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const lastConversation =
    typeof window !== "undefined" ? window.localStorage.getItem(LAST_CONVERSATION_KEY) : null;
  const personaHref = parseConversationPath(lastConversation)?.personaPath;

  useEffect(() => {
    let active = true;
    listAgentFrameworks()
      .then((response) => {
        if (!active) {
          return;
        }
        setFrameworks(response.frameworks);
        setSelected(
          response.frameworks
            .filter((framework) => framework.available)
            .slice(0, 2)
            .map((framework) => framework.framework_id),
        );
        setLoading(false);
      })
      .catch(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="grid gap-4">
      <FrameworkPicker
        frameworks={frameworks}
        selected={selected}
        onToggle={(frameworkId) =>
          setSelected((current) =>
            current.includes(frameworkId)
              ? current.filter((id) => id !== frameworkId)
              : current.length >= 2
                ? [current[1], frameworkId]
                : [...current, frameworkId],
          )
        }
        onRunSelected={() => undefined}
        running={false}
        runDisabled
        loading={loading}
        runLabel="Run both on this fingerprint"
        helper="Generate a persona first — comparison needs a fingerprint."
      />
      <p className="m-0 text-sm text-lab-muted">
        {personaHref ? (
          <Link
            className="font-semibold text-lab-ink-soft hover:text-lab-ink"
            to={`${personaHref}#frameworks`}
          >
            Continue from your last persona
          </Link>
        ) : (
          <Link className="font-semibold text-lab-ink-soft hover:text-lab-ink" to="/">
            Generate a persona to run these adapters
          </Link>
        )}
      </p>
    </div>
  );
}

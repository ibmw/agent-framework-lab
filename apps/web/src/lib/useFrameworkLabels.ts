import { useEffect, useState } from "react";
import { readAgentConfigurationResources } from "../api/agentConfigurations";

/** The catalog's labels by `framework_id`, or where its read stands. */
export type FrameworkLabels =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "loaded"; labels: ReadonlyMap<string, string> };

/**
 * The proven frameworks' display labels, by `framework_id`, read once when the surface opens.
 *
 * The same catalog History's rows are labeled from (`_framework_label` in
 * `application/experiment_history.py`): a run's record carries only the framework's id, and
 * the label is the proven framework's. Loading is kept apart from failure, so a caller names
 * nothing while the catalog is on its way rather than showing the id and swapping it out.
 */
export function useFrameworkLabels(): FrameworkLabels {
  const [state, setState] = useState<FrameworkLabels>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    readAgentConfigurationResources(controller.signal)
      .then((resources) =>
        setState({
          status: "loaded",
          labels: new Map(
            resources.frameworks.map((framework) => [framework.framework_id, framework.label]),
          ),
        }),
      )
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ status: "failed" });
        }
      });
    return () => controller.abort();
  }, []);

  return state;
}

/**
 * A framework by its display label; by its id once the catalog has failed or holds none for it,
 * as History's backend names one the catalog does not know; and `null` while the catalog loads.
 */
export function frameworkName(state: FrameworkLabels, frameworkId: string): string | null {
  if (state.status === "loading") {
    return null;
  }
  return (state.status === "loaded" ? state.labels.get(frameworkId) : undefined) ?? frameworkId;
}

/**
 * Whether an arm's label already names its framework — History's rule
 * (`ExperimentHistoryPage.tsx`): the label is the framework, or ends ` — {framework}`, as the
 * seeded demo's "Arm A — Pydantic AI" does — so the framework is not said a second time.
 */
export function labelNamesFramework(armLabel: string, framework: string): boolean {
  return armLabel === framework || armLabel.endsWith(` — ${framework}`);
}

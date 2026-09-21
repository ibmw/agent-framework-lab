import { useOutletContext } from "react-router-dom";
import type { ExperimentResults } from "./ExperimentResultsLayout";

export function useExperimentResults(): ExperimentResults {
  return useOutletContext<ExperimentResults>();
}

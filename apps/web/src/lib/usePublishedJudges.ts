import type { JudgeConfigurationSummarySchema } from "@agent-lab/contracts";
import { useEffect, useState } from "react";
import { listJudgeConfigurations } from "../api/judgeConfigurations";

/**
 * The judges this lab could be asked to score with, and the one currently chosen.
 *
 * Only published judges are offered: a verdict names the frozen version that produced it, and
 * a draft has none. A lab with no judge service still reads its experiments — the failure is
 * swallowed on purpose, and the judge's rows simply go on saying that a judge owns them.
 */
export function usePublishedJudges(): {
  judges: JudgeConfigurationSummarySchema[];
  judgeId: string;
  setJudgeId: (judgeId: string) => void;
} {
  const [judges, setJudges] = useState<JudgeConfigurationSummarySchema[]>([]);
  const [judgeId, setJudgeId] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    listJudgeConfigurations(controller.signal)
      .then((listed) => {
        const published = listed.judges.filter((judge) => judge.latest_published_version !== null);
        setJudges(published);
        setJudgeId((current) => current || (published[0]?.judge_id ?? ""));
      })
      .catch(() => {
        // See above: an unreachable judge service is not an unreadable experiment.
      });
    return () => controller.abort();
  }, []);

  return { judges, judgeId, setJudgeId };
}

import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import {
  activeBenchStep,
  BENCH_STEPS,
  type BenchLocation,
  type BenchStepId,
  benchStepTarget,
} from "../lib/bench";
import { LAB_STORAGE_EVENT, panelClasses } from "../lib/ui";

function useLabStorageRevision(): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const onChange = () => setRevision((value) => value + 1);
    window.addEventListener(LAB_STORAGE_EVENT, onChange);
    return () => window.removeEventListener(LAB_STORAGE_EVENT, onChange);
  }, []);
  return revision;
}

function scrollToBenchHash(to: string) {
  const hashIndex = to.indexOf("#");
  if (hashIndex === -1) {
    return;
  }
  const id = decodeURIComponent(to.slice(hashIndex + 1));
  if (!id) {
    return;
  }
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function useScrollToBenchHash() {
  const location = useLocation();
  useEffect(() => {
    if (!location.hash) {
      return;
    }
    scrollToBenchHash(location.hash);
  }, [location.hash]);
}

function useBenchLocation(): BenchLocation {
  const location = useLocation();
  const params = useParams();
  useLabStorageRevision();
  return {
    pathname: location.pathname,
    hash: location.hash,
    search: location.search,
    personaRef: params.ref,
    conversationId: params.conversationId,
  };
}

function StepLink({
  step,
  location,
  children,
  className,
}: {
  step: BenchStepId;
  location: BenchLocation;
  children: React.ReactNode;
  className?: string;
}) {
  const active = activeBenchStep(location);
  const target = benchStepTarget(step, location);
  const current = active === step;
  if (!target.enabled) {
    return (
      <span className={className} aria-disabled="true">
        {children}
      </span>
    );
  }
  return (
    <Link
      className={className}
      to={target.to}
      aria-current={current ? "step" : undefined}
      onClick={() => scrollToBenchHash(target.to)}
    >
      {children}
    </Link>
  );
}

export function HorizontalBenchRail({ className = "" }: { className?: string }) {
  const location = useBenchLocation();
  const active = activeBenchStep(location);

  return (
    <nav
      className={`${panelClasses} mb-6 flex items-center overflow-x-auto px-5 py-[15px] ${className}`}
      aria-label="Bench steps"
    >
      <ol className="flex min-w-max items-center">
        {BENCH_STEPS.map((step, index) => (
          <li key={step.id} className="flex items-center">
            {index > 0 && <span className="h-px w-[30px] bg-lab-border" aria-hidden="true" />}
            <StepLink
              step={step.id}
              location={location}
              className={`flex items-center gap-[9px] px-[18px] no-underline ${
                benchStepTarget(step.id, location).enabled ? "" : "cursor-not-allowed"
              } ${active === step.id ? "" : "opacity-70"}`}
            >
              <span className="font-mono text-xs font-extrabold text-lab-accent">
                {step.number}
              </span>
              <span
                className={`text-sm font-semibold whitespace-nowrap ${
                  step.id === 5 ? "text-lab-accent" : "text-lab-ink"
                }`}
              >
                {step.label}
              </span>
            </StepLink>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function VerticalBenchRail() {
  const location = useBenchLocation();
  const active = activeBenchStep(location);

  return (
    <nav
      className="flex w-[222px] shrink-0 flex-col gap-4 border-r border-lab-ink/15 bg-lab-subtle px-[18px] py-6 max-[899px]:hidden"
      aria-labelledby="bench-rail-title"
    >
      <p
        className="m-0 font-mono text-[10px] font-extrabold tracking-[0.12em] text-lab-muted uppercase"
        id="bench-rail-title"
      >
        This bench
      </p>
      <ol className="m-0 flex list-none flex-col gap-4 p-0">
        {BENCH_STEPS.map((step) => {
          const current = active === step.id;
          return (
            <li key={step.id}>
              <StepLink
                step={step.id}
                location={location}
                className={`flex items-start gap-[11px] no-underline ${
                  current ? "" : "opacity-45"
                } ${benchStepTarget(step.id, location).enabled ? "" : "cursor-not-allowed"}`}
              >
                <span
                  className={`flex-none pt-0.5 font-mono text-[11px] font-extrabold ${
                    current ? "text-lab-accent" : "text-lab-ink"
                  }`}
                >
                  {step.number}
                </span>
                <span>
                  <span className="block text-[13px] font-semibold text-lab-ink">
                    {step.shortLabel}
                  </span>
                  <span className="block text-xs text-lab-muted">{step.sublabel}</span>
                </span>
              </StepLink>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

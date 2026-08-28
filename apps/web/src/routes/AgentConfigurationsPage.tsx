import type {
  AgentConfigurationSummarySchema,
  SupportIdentityOptionSchema,
} from "@agent-lab/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  createAgentConfiguration,
  listAgentConfigurations,
  readAgentConfigurationResources,
} from "../api/agentConfigurations";
import { describeApiError } from "../api/client";
import { Card, PageHeader } from "../components/WorkspaceChrome";
import {
  accentButtonClasses,
  fieldControlClasses,
  fieldLabelClasses,
  formatTimestamp,
  surfaceClasses,
  tableCellClasses,
  tableHeadClasses,
} from "../lib/ui";

const UNAVAILABLE = "The agent-configuration service is unavailable.";

export function AgentConfigurationsPage() {
  const [configurations, setConfigurations] = useState<AgentConfigurationSummarySchema[]>([]);
  const [identities, setIdentities] = useState<SupportIdentityOptionSchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [identityId, setIdentityId] = useState("");

  const reload = useCallback(async (signal?: AbortSignal) => {
    const [listed, resources] = await Promise.all([
      listAgentConfigurations(signal),
      readAgentConfigurationResources(signal),
    ]);
    setConfigurations(listed.configurations);
    setIdentities(resources.support_identities);
    setIdentityId((current) => current || (resources.support_identities[0]?.identity_id ?? ""));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    reload(controller.signal)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(describeApiError(cause, UNAVAILABLE));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [reload]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await createAgentConfiguration({ name, support_identity_id: identityId });
      setName("");
      await reload();
    } catch (cause: unknown) {
      setError(describeApiError(cause, "The agent configuration could not be created."));
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Agent configurations"
        description="What runs the support agent: framework, architecture, model, prompt, tools, and the support identity it adopts. Configurations are cross-shop — prompt variables resolve at experiment start and the resolved configuration is pinned to the run."
      />

      {error ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className={`${surfaceClasses} overflow-hidden`}>
          {loading ? (
            <p className="p-4 text-[13px] text-admin-muted">Loading agent configurations…</p>
          ) : configurations.length === 0 ? (
            <p className="p-4 text-[13px] text-admin-muted">
              No agent configuration yet. Create one to describe the agent an experiment runs.
            </p>
          ) : (
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={tableHeadClasses}>Configuration</th>
                  <th className={tableHeadClasses}>Framework</th>
                  <th className={tableHeadClasses}>Model</th>
                  <th className={tableHeadClasses}>Tools</th>
                  <th className={tableHeadClasses}>Published</th>
                  <th className={tableHeadClasses}>Draft updated</th>
                </tr>
              </thead>
              <tbody>
                {configurations.map((configuration) => (
                  <tr key={configuration.configuration_id}>
                    <td className={tableCellClasses}>
                      <Link
                        className="font-semibold text-lab-ink underline-offset-2 hover:underline"
                        to={configuration.configuration_id}
                      >
                        {configuration.name}
                      </Link>
                    </td>
                    <td className={tableCellClasses}>{configuration.framework_label}</td>
                    <td className={tableCellClasses}>{configuration.model_id}</td>
                    <td className={tableCellClasses}>{configuration.tool_count} enabled</td>
                    <td className={tableCellClasses}>
                      {configuration.latest_published_version === null
                        ? "Never published"
                        : `v${configuration.latest_published_version} · ${configuration.published_version_count} version(s)`}
                    </td>
                    <td className={tableCellClasses}>
                      {formatTimestamp(configuration.updated_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <Card title="New agent configuration">
          {identities.length === 0 ? (
            <p className="text-[13px] text-admin-muted">
              Author a support identity first: a configuration adopts exactly one, and publishing
              pins the version it was published against.
            </p>
          ) : (
            <form className="grid gap-3" onSubmit={submit}>
              <label className={fieldLabelClasses}>
                Name
                <input
                  className={fieldControlClasses}
                  value={name}
                  required
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className={fieldLabelClasses}>
                Support identity
                <select
                  aria-label="Support identity"
                  className={fieldControlClasses}
                  value={identityId}
                  onChange={(event) => setIdentityId(event.target.value)}
                >
                  {identities.map((identity) => (
                    <option key={identity.identity_id} value={identity.identity_id}>
                      {identity.name} · {identity.title}
                    </option>
                  ))}
                </select>
              </label>
              <button className={accentButtonClasses} type="submit" disabled={creating}>
                {creating ? "Creating…" : "Create configuration"}
              </button>
              <p className="text-xs text-admin-muted">
                A new draft can read the arm through every read tool and move it through none.
                Writes are enabled deliberately, in the editor.
              </p>
            </form>
          )}
        </Card>
      </div>
    </>
  );
}

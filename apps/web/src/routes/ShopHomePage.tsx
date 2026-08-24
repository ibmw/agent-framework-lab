import type { DefinitionVersionSummarySchema } from "@agent-lab/contracts";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LabApiError } from "../api/client";
import { listShopVersions } from "../api/shops";
import {
  Card,
  canPublish,
  Fingerprint,
  IssueList,
  PageHeader,
  PublishReasons,
  VersionChips,
} from "../components/WorkspaceChrome";
import { groupIssues } from "../lib/shop";
import {
  accentButtonClasses,
  formatTimestamp,
  inkButtonClasses,
  tableCellClasses,
  tableHeadClasses,
} from "../lib/ui";
import { useShopWorkspace } from "../shell/ShopWorkspace";

export function ShopHomePage() {
  const { shopId, content, preview, publish, publishing, save, saving, dirty, error } =
    useShopWorkspace();
  const [versions, setVersions] = useState<DefinitionVersionSummarySchema[]>([]);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [published, setPublished] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    listShopVersions(shopId, controller.signal)
      .then((response) => {
        setVersions(response.versions);
        setVersionsError(null);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          // An empty table would otherwise read as "never published".
          setVersionsError(
            cause instanceof LabApiError ? cause.message : "Published versions are unavailable.",
          );
        }
      });
    return () => controller.abort();
  }, [shopId]);

  const issues = groupIssues(preview?.issues ?? []);
  // Republishing byte-identical content would mint a second version with the same fingerprint.
  const unchanged = preview?.matches_latest_published ?? false;
  const variantCount = content.products.reduce(
    (total, product) => total + product.variants.length,
    0,
  );

  async function onPublish() {
    const version = await publish();
    if (version !== null) {
      setPublished(version);
      setVersions((await listShopVersions(shopId)).versions);
    }
  }

  return (
    <>
      <PageHeader
        title="Home"
        chips={<VersionChips preview={preview} />}
        actions={
          dirty ? (
            <button
              className={accentButtonClasses}
              type="button"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save draft"}
            </button>
          ) : null
        }
      />

      <p className="mb-4 rounded-[10px] border border-[#b7d9cc] bg-[#eaf4f0] px-3.5 py-3 text-[12.5px] leading-relaxed">
        This entire shop is a synthetic simulation environment — every product, policy, and support
        document is fictional test data.
      </p>

      {error ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {error}
        </p>
      ) : null}
      {published !== null ? (
        <p role="status" className="mb-4 text-[13px] text-lab-success">
          Published v{published}. That version is immutable — later draft edits never change it.
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Card title="Products">
              <p className="text-2xl font-bold">{content.products.length}</p>
              <Link className="text-[13px] font-semibold text-lab-ink" to="products">
                Open the catalog
              </Link>
            </Card>
            <Card title="Sellable variants">
              <p className="text-2xl font-bold">{variantCount}</p>
              <p className="text-[13px] text-admin-muted">Across every product in the draft.</p>
            </Card>
            <Card title="Draft changes">
              <p className="text-2xl font-bold">{preview?.changes.length ?? 0}</p>
              <p className="text-[13px] text-admin-muted">
                {preview?.latest_published_version === null
                  ? "Nothing published yet."
                  : `Versus published v${preview?.latest_published_version}.`}
              </p>
            </Card>
          </div>

          <Card title="Draft validation">
            <IssueList issues={preview?.issues ?? []} />
          </Card>

          <Card title="Published versions">
            {versionsError ? (
              <p role="alert" className="text-[13px] text-lab-error">
                {versionsError}
              </p>
            ) : versions.length === 0 ? (
              <p className="text-[13px] text-admin-muted">
                No published version yet. Publishing freezes the draft exactly as it stands.
              </p>
            ) : (
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className={tableHeadClasses}>Version</th>
                    <th className={tableHeadClasses}>Content fingerprint</th>
                    <th className={tableHeadClasses}>Published</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((version) => (
                    <tr key={version.version}>
                      <td className={tableCellClasses}>
                        <Link
                          className="font-semibold text-lab-ink underline-offset-2 hover:underline"
                          to={`versions/${version.version}`}
                        >
                          v{version.version}
                        </Link>
                      </td>
                      <td className={tableCellClasses}>
                        <Fingerprint value={version.content_fingerprint} />
                      </td>
                      <td className={tableCellClasses}>{formatTimestamp(version.published_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div className="grid content-start gap-4">
          <Card title="Publish">
            <p className="text-[13px] leading-relaxed text-admin-ink-soft">
              Publishing creates <strong>v{preview?.next_version}</strong>. Published versions are
              immutable — experiments that pinned an earlier version never see draft edits.
            </p>
            <button
              className={inkButtonClasses}
              type="button"
              onClick={onPublish}
              disabled={publishing || !canPublish(preview, dirty)}
            >
              {publishing ? "Publishing…" : `Publish v${preview?.next_version}`}
            </button>
            <PublishReasons preview={preview} dirty={dirty} />
          </Card>

          <Card title="What publishing would freeze">
            {preview && preview.changes.length > 0 ? (
              <ul className="grid gap-1.5 text-[13px] text-admin-ink-soft">
                {preview.changes.map((change) => (
                  <li key={`${change.kind}:${change.path}`}>
                    <span className="font-semibold">{change.kind}</span> · {change.description}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-admin-muted">
                The draft matches the latest published version.
              </p>
            )}
            {preview ? (
              <p className="text-xs text-admin-muted">
                Draft content fingerprint <Fingerprint value={preview.content_fingerprint} />
              </p>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  );
}

import { useEffect, useState } from "react";
import { getLabStatus } from "../api/labStatus";
import { listModelConnections } from "../api/modelConnections";
import { unreachableProviders } from "./modelConnections";

/**
 * The providers this lab cannot reach right now, read once when the surface opens (ADR 0053).
 *
 * `null` until both reads answer, and `null` for good if either fails: the note this feeds is
 * advice, the advance is the authority, and a surface that guessed while the connection was
 * unreadable would be telling an author something about the lab it does not know. Read on
 * mount rather than held by the shell, because a connection is saved from `/settings`, which
 * is a route of its own: coming back to the editor or the bench mounts it again and reads the
 * connection as it now stands.
 */
export function useUnreachableProviders(): ReadonlySet<string> | null {
  const reachability = useReachability();
  return reachability.status === "loaded" ? reachability.unreachable : null;
}

/** The same two reads, saying whether they are still in flight or have failed for good. */
export type Reachability =
  | { status: "loading" }
  | { status: "failed" }
  /** `unreachable` is `null` where the answer cannot be attributed to a provider. */
  | { status: "loaded"; unreachable: ReadonlySet<string> | null };

/**
 * `useUnreachableProviders`, for a surface that must wait for the answer rather than read "not
 * yet" as "nothing to say": Start, which would otherwise be free for the moment between the
 * bench opening and the connection being read.
 */
export function useReachability(): Reachability {
  const [reachability, setReachability] = useState<Reachability>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([listModelConnections(controller.signal), getLabStatus(controller.signal)])
      .then(([connections, status]) =>
        setReachability({
          status: "loaded",
          unreachable: unreachableProviders(connections, status.connection_source),
        }),
      )
      .catch(() => {
        // See above: an unreadable connection says nothing, rather than something wrong.
        if (!controller.signal.aborted) {
          setReachability({ status: "failed" });
        }
      });
    return () => controller.abort();
  }, []);

  return reachability;
}

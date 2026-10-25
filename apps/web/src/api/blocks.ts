import type {
  BlockListResponse,
  CreateBlockRequest,
  MutationBlockDraftResponse,
  MutationBlockPayloadSchema,
  MutationBlockPreviewResponse,
  MutationBlockVersionResponse,
  ObjectiveBlockDraftResponse,
  ObjectiveBlockPayloadSchema,
  ObjectiveBlockPreviewResponse,
  ObjectiveBlockVersionResponse,
} from "@agent-lab/contracts";
import { pythonStrip } from "../lib/pythonText";
import { apiPath, JSON_HEADERS, read } from "./client";

/**
 * What a draft write sends. `shop_bound` is the server's derived echo of the kind, so it is the
 * content — with the statement and the description stripped as Python strips them:
 * `require_text` refuses padding, and a textarea ends on a newline as often as not. A
 * parameter's texts are stripped by the form below their list.
 */
export function toBlockPayload<PayloadT extends { statement: string; description: string }>(
  content: PayloadT,
): PayloadT {
  return {
    ...content,
    statement: pythonStrip(content.statement),
    description: pythonStrip(content.description),
  };
}

/**
 * The two block libraries are cross-shop, so they sit at the root of the contract beside
 * support identities. Their transports differ only in the collection segment and the
 * payload type, so each pair is generated from one builder rather than written twice.
 */
function libraryPath(collection: string, suffix = ""): string {
  return apiPath(`/${collection}${suffix}`);
}

function blockPath(collection: string, blockId: string, suffix = ""): string {
  return libraryPath(collection, `/${encodeURIComponent(blockId)}${suffix}`);
}

function library<DraftT, PayloadT, PreviewT, VersionT>(collection: string) {
  return {
    async list(signal?: AbortSignal): Promise<BlockListResponse> {
      return read<BlockListResponse>(await fetch(libraryPath(collection), { signal }));
    },
    async create(command: CreateBlockRequest): Promise<DraftT> {
      return read<DraftT>(
        await fetch(libraryPath(collection), {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify(command),
        }),
      );
    },
    async getDraft(blockId: string, signal?: AbortSignal): Promise<DraftT> {
      return read<DraftT>(await fetch(blockPath(collection, blockId, "/draft"), { signal }));
    },
    async replaceDraft(blockId: string, payload: PayloadT): Promise<DraftT> {
      return read<DraftT>(
        await fetch(blockPath(collection, blockId, "/draft"), {
          method: "PUT",
          headers: JSON_HEADERS,
          body: JSON.stringify({ payload }),
        }),
      );
    },
    async previewDraft(blockId: string, signal?: AbortSignal): Promise<PreviewT> {
      return read<PreviewT>(
        await fetch(blockPath(collection, blockId, "/draft/preview"), { signal }),
      );
    },
    async publish(blockId: string): Promise<VersionT> {
      return read<VersionT>(
        await fetch(blockPath(collection, blockId, "/versions"), { method: "POST" }),
      );
    },
    /** One immutable published version, as a run pinned it. */
    async getVersion(blockId: string, version: number, signal?: AbortSignal): Promise<VersionT> {
      return read<VersionT>(
        await fetch(blockPath(collection, blockId, `/versions/${version}`), { signal }),
      );
    },
  };
}

export const objectiveBlocks = library<
  ObjectiveBlockDraftResponse,
  ObjectiveBlockPayloadSchema,
  ObjectiveBlockPreviewResponse,
  ObjectiveBlockVersionResponse
>("objective-blocks");

export const mutationBlocks = library<
  MutationBlockDraftResponse,
  MutationBlockPayloadSchema,
  MutationBlockPreviewResponse,
  MutationBlockVersionResponse
>("mutation-blocks");

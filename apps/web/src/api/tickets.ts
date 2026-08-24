import type {
  CreateTicketRequest,
  ReplaceTicketDraftRequest,
  TicketContextSchema,
  TicketDraftResponse,
  TicketListResponse,
  TicketPreviewResponse,
  TicketVersionResponse,
} from "@agent-lab/contracts";
import { apiPath, JSON_HEADERS, read } from "./client";

function ticketsPath(shopId: string, suffix = ""): string {
  return apiPath(`/shops/${encodeURIComponent(shopId)}/tickets${suffix}`);
}

function ticketPath(shopId: string, ticketId: string, suffix = ""): string {
  return ticketsPath(shopId, `/${encodeURIComponent(ticketId)}${suffix}`);
}

export async function listTickets(
  shopId: string,
  signal?: AbortSignal,
): Promise<TicketListResponse> {
  return read<TicketListResponse>(await fetch(ticketsPath(shopId), { signal }));
}

export async function createTicket(
  shopId: string,
  command: CreateTicketRequest,
): Promise<TicketDraftResponse> {
  return read<TicketDraftResponse>(
    await fetch(ticketsPath(shopId), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(command),
    }),
  );
}

export async function getTicketDraft(
  shopId: string,
  ticketId: string,
  signal?: AbortSignal,
): Promise<TicketDraftResponse> {
  return read<TicketDraftResponse>(await fetch(ticketPath(shopId, ticketId, "/draft"), { signal }));
}

export async function replaceTicketDraft(
  shopId: string,
  ticketId: string,
  command: ReplaceTicketDraftRequest,
): Promise<TicketDraftResponse> {
  return read<TicketDraftResponse>(
    await fetch(ticketPath(shopId, ticketId, "/draft"), {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify(command),
    }),
  );
}

export async function previewTicketDraft(
  shopId: string,
  ticketId: string,
  signal?: AbortSignal,
): Promise<TicketPreviewResponse> {
  return read<TicketPreviewResponse>(
    await fetch(ticketPath(shopId, ticketId, "/draft/preview"), { signal }),
  );
}

export async function getTicketContext(
  shopId: string,
  ticketId: string,
  signal?: AbortSignal,
): Promise<TicketContextSchema> {
  return read<TicketContextSchema>(
    await fetch(ticketPath(shopId, ticketId, "/context"), { signal }),
  );
}

export async function publishTicket(
  shopId: string,
  ticketId: string,
): Promise<TicketVersionResponse> {
  return read<TicketVersionResponse>(
    await fetch(ticketPath(shopId, ticketId, "/versions"), { method: "POST" }),
  );
}

import type {
  CreateOrderRequest,
  OrderListResponse,
  ReplaceOrderRequest,
  ShopOrderResponse,
} from "@agent-lab/contracts";
import { apiPath, JSON_HEADERS, read } from "./client";

function ordersPath(shopId: string, suffix = ""): string {
  return apiPath(`/shops/${encodeURIComponent(shopId)}/orders${suffix}`);
}

function orderPath(shopId: string, orderId: string): string {
  return ordersPath(shopId, `/${encodeURIComponent(orderId)}`);
}

export async function listOrders(shopId: string, signal?: AbortSignal): Promise<OrderListResponse> {
  return read<OrderListResponse>(await fetch(ordersPath(shopId), { signal }));
}

export async function createOrder(
  shopId: string,
  command: CreateOrderRequest,
): Promise<ShopOrderResponse> {
  return read<ShopOrderResponse>(
    await fetch(ordersPath(shopId), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(command),
    }),
  );
}

export async function getOrder(
  shopId: string,
  orderId: string,
  signal?: AbortSignal,
): Promise<ShopOrderResponse> {
  return read<ShopOrderResponse>(await fetch(orderPath(shopId, orderId), { signal }));
}

export async function replaceOrder(
  shopId: string,
  orderId: string,
  command: ReplaceOrderRequest,
): Promise<ShopOrderResponse> {
  return read<ShopOrderResponse>(
    await fetch(orderPath(shopId, orderId), {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify(command),
    }),
  );
}

export async function deleteOrder(shopId: string, orderId: string): Promise<void> {
  const response = await fetch(orderPath(shopId, orderId), { method: "DELETE" });
  if (!response.ok) {
    await read<never>(response);
  }
}

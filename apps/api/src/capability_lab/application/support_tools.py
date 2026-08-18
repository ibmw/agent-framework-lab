from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from capability_lab.application.ports import ToolActivity
from capability_lab.domain.entities import Customer, Order, Product

CUSTOMER_TOOL_NAME = "read_customer"
PRODUCT_TOOL_NAME = "list_products"
ORDER_TOOL_NAME = "list_customer_orders"
TOOL_VERSION = "v1"


class SupportToolError(ValueError):
    """Raised when a read-only support tool cannot serve its scoped request."""


@dataclass(frozen=True, slots=True)
class RetailSupportContext:
    customer: Customer
    products: tuple[Product, ...]
    orders: tuple[Order, ...]

    def __post_init__(self) -> None:
        if any(order.customer_id != self.customer.id for order in self.orders):
            raise SupportToolError("support orders must belong to the scoped customer")


def _money(value: Decimal) -> str:
    return format(value, ".2f")


class RetailSupportTools:
    """Framework-neutral, customer-scoped implementation of the versioned read tools."""

    def __init__(self, context: RetailSupportContext) -> None:
        self._context = context

    def read_customer_v1(self) -> ToolActivity:
        customer = self._context.customer
        return ToolActivity(
            tool_name=CUSTOMER_TOOL_NAME,
            tool_version=TOOL_VERSION,
            outcome="success",
            result={
                "id": str(customer.id),
                "display_name": customer.display_name,
                "email": customer.email,
                "created_at": customer.created_at.isoformat(),
            },
        )

    def list_products_v1(self) -> ToolActivity:
        products = sorted(self._context.products, key=lambda product: product.sku)
        return ToolActivity(
            tool_name=PRODUCT_TOOL_NAME,
            tool_version=TOOL_VERSION,
            outcome="success",
            result={
                "products": [
                    {
                        "id": str(product.id),
                        "sku": product.sku,
                        "name": product.name,
                        "price_amount": _money(product.price_amount),
                        "currency": product.currency,
                    }
                    for product in products
                ]
            },
        )

    def list_customer_orders_v1(self) -> ToolActivity:
        orders = sorted(self._context.orders, key=lambda order: (order.created_at, str(order.id)))
        return ToolActivity(
            tool_name=ORDER_TOOL_NAME,
            tool_version=TOOL_VERSION,
            outcome="success",
            result={
                "orders": [
                    {
                        "id": str(order.id),
                        "status": order.status.value,
                        "version": order.version,
                        "created_at": order.created_at.isoformat(),
                    }
                    for order in orders
                ]
            },
        )

from uuid import UUID

from sqlalchemy.orm import Session

from capability_lab.domain.entities import Customer
from capability_lab.infrastructure.models import CustomerModel


class SqlAlchemyCustomerRepository:
    """First concrete repository; the same mapping works with SQLite and PostgreSQL."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def get(self, customer_id: UUID) -> Customer | None:
        model = self._session.get(CustomerModel, str(customer_id))
        if model is None:
            return None
        return Customer(
            id=UUID(model.id),
            email=model.email,
            display_name=model.display_name,
            created_at=model.created_at,
        )

    def save(self, customer: Customer) -> None:
        self._session.merge(
            CustomerModel(
                id=str(customer.id),
                email=customer.email,
                display_name=customer.display_name,
                created_at=customer.created_at,
            )
        )

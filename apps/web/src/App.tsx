import { API_VERSION } from "@agent-lab/contracts";

const foundations = [
  "Contrats API versionnés",
  "Ports de repositories et d'agent",
  "SQLite via SQLAlchemy et Alembic",
  "Règles d'observabilité versionnées",
];

const deferred = ["Agent Pydantic AI", "Chat assistant-ui", "Comparaison de frameworks"];

export function App() {
  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">FOUNDATION · API {API_VERSION.toUpperCase()}</p>
        <h1 id="page-title">Agent Framework Capability Lab</h1>
        <p className="lede">
          Le socle du playground e-commerce est prêt. Les capacités agentiques seront ajoutées par
          adaptateurs, sans contaminer le domaine.
        </p>
      </section>

      <section className="grid" aria-label="État du laboratoire">
        <article className="card">
          <span className="status ready">Prêt</span>
          <h2>Fondations</h2>
          <ul>
            {foundations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="card muted">
          <span className="status later">Étape suivante</span>
          <h2>Délibérément reporté</h2>
          <ul>
            {deferred.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </section>
    </main>
  );
}

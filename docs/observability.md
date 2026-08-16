# Observabilité

OpenTelemetry est le format interne commun. Chaque requête et exécution future d'agent propage le
même contexte de trace. Les spans métier utilisent des noms stables et enregistrent au minimum :
version de scénario, identifiant de framework, nom/version d'outil, résultat, tentative et durée.

Ne jamais enregistrer : secrets, tokens, cookies, en-têtes d'autorisation, adresse complète,
e-mail brut, contenu libre non filtré ou payload complet d'outil. Le processeur de spans devra
appliquer une allowlist d'attributs puis pseudonymiser les identifiants client/session avant export.
Le logging structuré suit la même règle et porte `request_id`/`trace_id`.

L'instrumentation dépend d'une interface d'application ou reste dans l'infrastructure. Le domaine
ne crée aucun span. Phoenix est un consommateur local remplaçable : aucune règle ou test métier ne
dépend de sa disponibilité. Quand l'export est désactivé, l'application continue à fonctionner.

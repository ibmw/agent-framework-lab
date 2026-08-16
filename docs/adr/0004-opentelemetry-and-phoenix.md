# ADR 0004 — OpenTelemetry commun, Phoenix local

Statut : accepté — 2026-08-16

OpenTelemetry fournit des traces portables entre frameworks. Phoenix sera un visualiseur local et
non une dépendance métier. Les attributs passent par une allowlist et les identifiants sont
pseudonymisés avant export, afin qu'un changement d'outil d'observabilité ne modifie ni l'agent ni
le domaine.

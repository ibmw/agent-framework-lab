export const API_VERSION = "v1" as const;

export type { components, operations, paths } from "./generated/v1";

import type { components } from "./generated/v1";

export type ErrorResponse = components["schemas"]["ErrorResponse"];
export type GenerateScenarioRequest = components["schemas"]["GenerateScenarioRequest"];
export type GeneratedScenarioResponse = components["schemas"]["GeneratedScenarioResponse"];

"""One throwaway call to a model endpoint, classified and never quoted (ADR 0052).

Testing a connection is a question about a moment. This adapter asks it once, under a short
timeout and with no retries, and answers with a value from a closed table plus the round trip
and the class of the status that came back. It stores nothing, and it never puts the upstream
body — or the upstream exception's message — anywhere a caller can see: a provider's error
text is a string this lab did not write and cannot promise the contents of, which is the same
rule a tool result follows when it refuses to describe a failure in the provider's words.

**The call is `GET {base_url}/models`, not a completion.** That is a departure from the
slice's wording and it is forced by ADR 0052's own decision that the connection holds no
model: a completion would need a model id, the connection deliberately has none, and a probe
that reached for the process's configured model would be exactly the substitution of the
environment for an authored input that ADR 0024 and ADR 0052 refuse. The model listing is
part of the OpenAI protocol that Ollama, vLLM, LM Studio, OpenRouter and Together all answer,
it exercises the base URL and the credential together, and it costs no tokens.

What `reachable` therefore claims, exactly: this endpoint answered and did not reject this
credential. It is a statement about the endpoint at a moment and not a promise about a turn —
a gateway that leaves `/models` open while gating completions answers `reachable` on a key that
cannot run an arm. That gap is the same one a stored green tick would have, which is why the
result is not stored either.

The credential is always passed explicitly, including when there is none. The SDK falls back
to `OPENAI_API_KEY` from the process environment when it is handed `None`, and a test of an
arbitrary endpoint that quietly sent the environment's own key to it would be this lab leaking
a credential to a host the operator typed. It will not take an empty string either — the
client refuses to construct without credentials — so `UNCREDENTIALED_API_KEY` below is what a
keyless endpoint is reached with, and it is the same constant the runtime factories use.
"""

from __future__ import annotations

from time import perf_counter

from openai import APIConnectionError, APIStatusError, AsyncOpenAI

from capability_lab.application.model_connections import (
    HttpStatusClass,
    ModelEndpointOutcome,
    ModelEndpointProbeResult,
)

__all__ = ["PROBE_TIMEOUT_SECONDS", "UNCREDENTIALED_API_KEY", "OpenAiProtocolEndpointProbe"]

UNCREDENTIALED_API_KEY = "not-required"
"""What the OpenAI client is handed for an endpoint that needs no credential.

A local Ollama, vLLM or LM Studio ignores the header entirely, and "an arm against a local
model with no credential leaving the machine" is the case ADR 0052 exists for — but the SDK
refuses to construct a client with no key and refuses an empty one too, raising before any
request is made. So a placeholder is unavoidable, and this is it: a constant written in this
source file, carrying nothing about the operator, nothing from the environment, and nothing
that could be mistaken for a secret if it ever appeared in a request log.

Named once and shared with `infrastructure/agents/registry.py`, so the endpoint a connection
is *tested* against and the endpoint an arm *runs* against are reached the same way. Two
placeholders would be two chances for a gateway to accept one and refuse the other.
"""

PROBE_TIMEOUT_SECONDS = 5.0
"""Short, because the operator is watching a button. An endpoint slower than this is one a
turn would wait on too, and "unreachable" is the honest answer to give about it now."""

_REFUSING_STATUSES = frozenset({401, 403})
"""The endpoint answered and rejected the credential.

Exactly these two. Every other answer is an answer from something that is not a working
OpenAI-protocol endpoint for this lab — a wrong path, a gateway, an outage — and is reported
as unreachable *with its status class*, so an operator can tell a host that said 404 from a
host that said nothing at all.
"""


class OpenAiProtocolEndpointProbe:
    """Ask one OpenAI-protocol endpoint whether it is there and whether it accepts this key."""

    async def probe(self, *, base_url: str, api_key: str | None) -> ModelEndpointProbeResult:
        client = AsyncOpenAI(
            base_url=base_url,
            api_key=api_key if api_key else UNCREDENTIALED_API_KEY,
            timeout=PROBE_TIMEOUT_SECONDS,
            max_retries=0,
        )
        started = perf_counter()
        try:
            classified = await self._ask(client)
        finally:
            # Closing is housekeeping rather than part of the round trip, so it happens after
            # the clock is read: an operator reading 900ms is reading the endpoint's answer.
            elapsed = perf_counter() - started
            await client.close()
        outcome, status_class = classified
        return ModelEndpointProbeResult(
            outcome=outcome,
            latency_ms=max(0, round(elapsed * 1000)),
            status_class=status_class,
        )

    async def _ask(
        self, client: AsyncOpenAI
    ) -> tuple[ModelEndpointOutcome, HttpStatusClass | None]:
        try:
            await client.models.list()
        except APIStatusError as error:
            return self._of_status(error.status_code)
        except APIConnectionError:
            # Covers the timeout too, which the SDK raises as a subclass of this.
            return ModelEndpointOutcome.UNREACHABLE, None
        except Exception:
            # A malformed endpoint, a TLS failure, an SDK error: nothing usable answered, and
            # whatever it said is not this lab's to repeat.
            return ModelEndpointOutcome.UNREACHABLE, None
        return ModelEndpointOutcome.REACHABLE, HttpStatusClass.SUCCESS

    @staticmethod
    def _of_status(status_code: int) -> tuple[ModelEndpointOutcome, HttpStatusClass | None]:
        outcome = (
            ModelEndpointOutcome.REFUSED
            if status_code in _REFUSING_STATUSES
            else ModelEndpointOutcome.UNREACHABLE
        )
        return outcome, HttpStatusClass.of(status_code)

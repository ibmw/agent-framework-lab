"""What a configuration's prompt resolves to, read once by the preview and the run.

ADR 0024 built the resolution an author reads beside the publish gate: every `{{variable}}`
in the prompt, resolved against a chosen preview shop and the identity's published version.
It said in as many words that "the runtime resolution has to make the same call" about a
variable that resolves to empty text. This module is where the two callers meet, so that
sentence is a shared function rather than a promise.

They differ in exactly one thing, and it is not the table. The editor resolves against the
*latest* published shop an author picked to preview in; a run resolves against the shop
version its snapshot **pinned**, because an experiment is explained by the versions it
froze and nothing else. Both ask this module the same question about the same values.

Rendering lives here too, and is total by construction: a published configuration's prompt
carries only known, injectable variables — its own publish gate refuses the other two kinds
(ADR 0024) — so substitution never has to decide what to do with a name it does not know.
"""

from __future__ import annotations

from capability_lab.domain.agent_configuration import (
    AgentConfigurationPayload,
    ToneOfVoiceSelection,
    ToneOfVoiceSource,
)
from capability_lab.domain.shop import ShopPayload, ToneOfVoiceGuideline
from capability_lab.domain.support_identity import SupportIdentityPayload

__all__ = ["prompt_variable_values", "render_prompt", "resolve_tone_of_voice"]


def resolve_tone_of_voice(
    shop: ShopPayload | None, selection: ToneOfVoiceSelection
) -> ToneOfVoiceGuideline | None:
    """The guideline the target shop resolves this selection to, if it has one."""
    if shop is None:
        return None
    if selection.source is ToneOfVoiceSource.SHOP_DEFAULT:
        return shop.default_tone_of_voice
    return next(
        (
            guideline
            for guideline in shop.tone_of_voice_guidelines
            if guideline.id == selection.guideline_id
        ),
        None,
    )


def prompt_variable_values(
    shop: ShopPayload | None,
    identity: SupportIdentityPayload | None,
    guideline: ToneOfVoiceGuideline | None,
) -> dict[str, str]:
    """What each injectable variable resolves to; a missing source resolves to nothing.

    The interaction group is deliberately absent: it has no value here by design, and
    supplying one — even in a preview — would suggest a prompt could carry it.
    """
    values: dict[str, str] = {}
    if shop is not None:
        values["shop.name"] = shop.identity.name
        values["shop.locale"] = shop.identity.locale
        values["shop.currencies"] = ", ".join(
            currency.value for currency in shop.identity.currencies
        )
    if guideline is not None:
        values["shop.tone_of_voice"] = guideline.name
    if identity is not None:
        # A published identity resolves every one of its variables, including to empty text.
        # "Resolves to nothing" has to keep meaning "the source is missing": a preview that
        # said unresolvable while a run injected an empty string would be the worse of the
        # two answers, and the runtime resolution has to make the same call.
        values["support_identity.role"] = identity.role.title
        values["support_identity.guidance"] = "; ".join(note.title for note in identity.guidance)
        values["support_identity.permissions"] = ", ".join(
            permission.value for permission in identity.permissions
        )
    return values


def render_prompt(
    payload: AgentConfigurationPayload,
    shop: ShopPayload,
    identity: SupportIdentityPayload,
) -> str:
    """The system prompt as the agent actually receives it.

    Both sources are required rather than optional, unlike the preview's: a run resolves
    against the versions its experiment pinned, and an experiment that could not resolve one
    of them never started. What a variable resolves to may still be empty — an identity with
    no guidance notes is authored, not missing — and that is injected as the empty text it
    is, which is exactly what the preview told the author it would do.

    Whitespace inside the braces is tolerated, because the scanner that found the token
    already tolerated it and an author who wrote `{{ shop.name }}` meant the variable.
    """
    values = prompt_variable_values(
        shop, identity, resolve_tone_of_voice(shop, payload.tone_of_voice)
    )
    rendered = payload.prompt
    for token in reversed(payload.prompt_tokens):
        # Right to left, so replacing one token cannot move the offsets of the ones before
        # it. Every token in a published prompt is injectable, so `values` answers each one;
        # the default is what a variable whose source authored nothing resolves to.
        rendered = rendered[: token.start] + values.get(token.name, "") + rendered[token.end :]
    return rendered

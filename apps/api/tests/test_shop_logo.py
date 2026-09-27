"""The shop logo's domain (ADR 0070): the palette, the derived mark colour, the change summary."""

from dataclasses import replace

import pytest

from capability_lab.application.agent_prompt import prompt_variable_values
from capability_lab.application.sandbox_tool_views import (
    knowledge_documents,
    product_detail,
    product_summary,
)
from capability_lab.domain.shop import (
    MIN_MARK_CONTRAST,
    SHOP_LOGO_BACKGROUND_HEX,
    SHOP_MARK_COLOUR_HEX,
    ShopChangeKind,
    ShopConfigurationError,
    ShopLogo,
    ShopLogoBackground,
    ShopMark,
    ShopMarkColour,
    contrast_ratio,
    mark_colour_for,
    summarize_shop_changes,
)
from shop_factories import publishable_shop

# The same table is asserted by `apps/web/src/lib/shopLogo.test.ts`; the two must agree.
EXPECTED_MARK_COLOUR = {
    ShopLogoBackground.CLAY: ShopMarkColour.WHITE,
    ShopLogoBackground.PINE: ShopMarkColour.WHITE,
    ShopLogoBackground.INDIGO: ShopMarkColour.WHITE,
    ShopLogoBackground.PLUM: ShopMarkColour.WHITE,
    ShopLogoBackground.FOREST: ShopMarkColour.WHITE,
    ShopLogoBackground.OCHRE: ShopMarkColour.INK,
    ShopLogoBackground.STONE: ShopMarkColour.INK,
}


def test_the_palette_is_seven_backgrounds_without_the_destructive_red() -> None:
    assert set(EXPECTED_MARK_COLOUR) == set(ShopLogoBackground)
    assert set(SHOP_LOGO_BACKGROUND_HEX) == set(ShopLogoBackground)
    assert "#9d3028" not in SHOP_LOGO_BACKGROUND_HEX.values()
    assert len(ShopMark) == 28


@pytest.mark.parametrize("background", list(ShopLogoBackground))
def test_every_background_derives_the_higher_contrast_mark_colour_at_three_to_one(
    background: ShopLogoBackground,
) -> None:
    ground = SHOP_LOGO_BACKGROUND_HEX[background]
    derived = mark_colour_for(background)
    ratios = {
        colour: contrast_ratio(ground, SHOP_MARK_COLOUR_HEX[colour]) for colour in ShopMarkColour
    }

    assert derived == EXPECTED_MARK_COLOUR[background]
    assert ratios[derived] == max(ratios.values())
    assert ratios[derived] >= MIN_MARK_CONTRAST


def test_contrast_is_the_wcag_ratio() -> None:
    assert round(contrast_ratio("#ffffff", "#000000"), 6) == 21
    assert round(contrast_ratio("#777777", "#777777"), 6) == 1
    assert round(contrast_ratio("#ffffff", "#c2532d"), 2) == 4.60


def test_a_logo_is_a_mark_on_a_background_and_nothing_else() -> None:
    logo = ShopLogo(mark=ShopMark.ANCHOR, background=ShopLogoBackground.STONE)
    assert logo.mark_colour is ShopMarkColour.INK

    with pytest.raises(ShopConfigurationError, match="one of the lab's marks"):
        ShopLogo(mark="rocket", background=ShopLogoBackground.PINE)  # type: ignore[arg-type]
    with pytest.raises(ShopConfigurationError, match="one of the lab's backgrounds"):
        ShopLogo(mark=ShopMark.ANCHOR, background="#9d3028")  # type: ignore[arg-type]


def test_setting_changing_and_removing_a_logo_is_each_one_change() -> None:
    bare = publishable_shop()
    compass = replace(
        bare, logo=ShopLogo(mark=ShopMark.COMPASS, background=ShopLogoBackground.CLAY)
    )
    anchor = replace(bare, logo=ShopLogo(mark=ShopMark.ANCHOR, background=ShopLogoBackground.CLAY))

    assert [(c.kind, c.path, c.description) for c in summarize_shop_changes(bare, compass)] == [
        (ShopChangeKind.ADDED, "logo", "Added shop logo")
    ]
    assert [(c.kind, c.path, c.description) for c in summarize_shop_changes(compass, anchor)] == [
        (ShopChangeKind.UPDATED, "logo", "Updated shop logo")
    ]
    assert [(c.kind, c.path, c.description) for c in summarize_shop_changes(anchor, bare)] == [
        (ShopChangeKind.REMOVED, "logo", "Removed shop logo")
    ]
    assert summarize_shop_changes(compass, compass) == ()


def test_nothing_an_agent_reads_changes_with_the_logo() -> None:
    """The logo is the operator's; the prompt and every shop-facing tool view ignore it."""
    bare = publishable_shop()
    logod = replace(bare, logo=ShopLogo(mark=ShopMark.GEM, background=ShopLogoBackground.STONE))

    assert prompt_variable_values(logod, None, None) == prompt_variable_values(bare, None, None)
    assert knowledge_documents(logod) == knowledge_documents(bare)
    assert [product_detail(p) for p in logod.products] == [product_detail(p) for p in bare.products]
    assert [product_summary(p) for p in logod.products] == [
        product_summary(p) for p in bare.products
    ]

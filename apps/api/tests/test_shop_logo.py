"""The shop logo's domain (ADR 0070): the palette, the contrast warning, the change summary."""

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
    is_low_contrast,
    keep_unchosen_logo,
    mark_colour_for,
    summarize_shop_changes,
)
from shop_factories import publishable_shop

WHITE, INK = ShopMarkColour.WHITE, ShopMarkColour.INK

# Every background against both mark colours: the ratio to two places, and whether the editor
# warns. `apps/web/src/lib/shopLogo.test.ts` asserts the same sixteen rows; the two must agree.
EXPECTED_PAIRS: dict[tuple[ShopLogoBackground, ShopMarkColour], tuple[float, bool]] = {
    (ShopLogoBackground.CLAY, WHITE): (4.60, False),
    (ShopLogoBackground.CLAY, INK): (2.96, True),
    (ShopLogoBackground.PINE, WHITE): (7.30, False),
    (ShopLogoBackground.PINE, INK): (1.86, True),
    (ShopLogoBackground.INDIGO, WHITE): (8.82, False),
    (ShopLogoBackground.INDIGO, INK): (1.54, True),
    (ShopLogoBackground.PLUM, WHITE): (7.74, False),
    (ShopLogoBackground.PLUM, INK): (1.76, True),
    (ShopLogoBackground.FOREST, WHITE): (13.59, False),
    (ShopLogoBackground.FOREST, INK): (1.00, True),
    (ShopLogoBackground.OCHRE, WHITE): (3.63, False),
    (ShopLogoBackground.OCHRE, INK): (3.74, False),
    (ShopLogoBackground.BRICK, WHITE): (7.27, False),
    (ShopLogoBackground.BRICK, INK): (1.87, True),
    (ShopLogoBackground.STONE, WHITE): (1.16, True),
    (ShopLogoBackground.STONE, INK): (11.68, False),
}

# What a logo stored before the colour was chosen (`shop-payload-v2`) is drawn in.
EXPECTED_DERIVED_COLOUR = {
    ShopLogoBackground.CLAY: WHITE,
    ShopLogoBackground.PINE: WHITE,
    ShopLogoBackground.INDIGO: WHITE,
    ShopLogoBackground.PLUM: WHITE,
    ShopLogoBackground.FOREST: WHITE,
    ShopLogoBackground.OCHRE: INK,
    ShopLogoBackground.BRICK: WHITE,
    ShopLogoBackground.STONE: INK,
}


def test_the_palette_is_the_prototypes_eight_backgrounds_two_colours_and_28_marks() -> None:
    assert [(b.value, SHOP_LOGO_BACKGROUND_HEX[b]) for b in ShopLogoBackground] == [
        ("clay", "#c2532d"),
        ("pine", "#1d6241"),
        ("indigo", "#2f4a7a"),
        ("plum", "#6b3f8c"),
        ("forest", "#16332d"),
        ("ochre", "#a8802a"),
        ("brick", "#9d3028"),
        ("stone", "#eceef0"),
    ]
    assert SHOP_MARK_COLOUR_HEX == {WHITE: "#ffffff", INK: "#16332d"}
    assert len(ShopMark) == 28


def test_every_pair_is_warned_about_exactly_when_it_is_under_three_to_one() -> None:
    """All sixteen background-by-mark-colour pairs, enumerated, against one shared table."""
    pairs = [(b, c) for b in ShopLogoBackground for c in ShopMarkColour]
    assert len(pairs) == 16
    assert set(pairs) == set(EXPECTED_PAIRS)

    for background, colour in pairs:
        ratio = contrast_ratio(SHOP_LOGO_BACKGROUND_HEX[background], SHOP_MARK_COLOUR_HEX[colour])
        expected_ratio, expected_warning = EXPECTED_PAIRS[(background, colour)]
        assert round(ratio, 2) == expected_ratio, (background, colour)
        assert is_low_contrast(background, colour) is expected_warning, (background, colour)
        assert is_low_contrast(background, colour) is (ratio < MIN_MARK_CONTRAST)


@pytest.mark.parametrize("background", list(ShopLogoBackground))
def test_a_logo_without_a_chosen_colour_is_drawn_in_the_higher_contrast_one(
    background: ShopLogoBackground,
) -> None:
    derived = mark_colour_for(background)
    ratios = {c: EXPECTED_PAIRS[(background, c)][0] for c in ShopMarkColour}

    assert derived == EXPECTED_DERIVED_COLOUR[background]
    assert ratios[derived] == max(ratios.values())
    assert ShopLogo(ShopMark.CUP, background, mark_colour=None).drawn_mark_colour == derived


def test_contrast_is_the_wcag_ratio() -> None:
    assert round(contrast_ratio("#ffffff", "#000000"), 6) == 21
    assert round(contrast_ratio("#777777", "#777777"), 6) == 1
    assert round(contrast_ratio("#ffffff", "#c2532d"), 2) == 4.60


def test_a_logo_is_drawn_in_the_colour_chosen_whatever_the_contrast() -> None:
    low = ShopLogo(mark=ShopMark.ANCHOR, background=ShopLogoBackground.STONE, mark_colour=WHITE)
    assert low.drawn_mark_colour is WHITE
    assert is_low_contrast(low.background, WHITE)

    monogram = ShopLogo(mark=None, background=ShopLogoBackground.OCHRE, mark_colour=INK)
    assert monogram.mark is None
    assert monogram.drawn_mark_colour is INK


def test_a_logo_holds_only_the_labs_marks_backgrounds_and_colours() -> None:
    with pytest.raises(ShopConfigurationError, match="one of the lab's marks"):
        ShopLogo(mark="rocket", background=ShopLogoBackground.PINE, mark_colour=WHITE)  # type: ignore[arg-type]
    with pytest.raises(ShopConfigurationError, match="one of the lab's backgrounds"):
        ShopLogo(mark=ShopMark.ANCHOR, background="#9d3028", mark_colour=WHITE)  # type: ignore[arg-type]
    with pytest.raises(ShopConfigurationError, match="one of the lab's mark colours"):
        ShopLogo(mark=ShopMark.ANCHOR, background=ShopLogoBackground.PINE, mark_colour="red")  # type: ignore[arg-type]
    with pytest.raises(ShopConfigurationError, match="monogram logo must choose its mark colour"):
        ShopLogo(mark=None, background=ShopLogoBackground.PINE, mark_colour=None)


def test_setting_changing_and_removing_a_logo_is_each_one_change() -> None:
    bare = publishable_shop()
    compass = replace(
        bare,
        logo=ShopLogo(mark=ShopMark.COMPASS, background=ShopLogoBackground.CLAY, mark_colour=WHITE),
    )
    anchor = replace(
        bare,
        logo=ShopLogo(mark=ShopMark.ANCHOR, background=ShopLogoBackground.CLAY, mark_colour=WHITE),
    )
    inked = replace(
        bare,
        logo=ShopLogo(mark=ShopMark.ANCHOR, background=ShopLogoBackground.CLAY, mark_colour=INK),
    )

    assert [(c.kind, c.path, c.description) for c in summarize_shop_changes(bare, compass)] == [
        (ShopChangeKind.ADDED, "logo", "Added shop logo")
    ]
    assert [(c.kind, c.path, c.description) for c in summarize_shop_changes(compass, anchor)] == [
        (ShopChangeKind.UPDATED, "logo", "Updated shop logo")
    ]
    assert [(c.kind, c.path, c.description) for c in summarize_shop_changes(anchor, inked)] == [
        (ShopChangeKind.UPDATED, "logo", "Updated shop logo")
    ]
    assert [(c.kind, c.path, c.description) for c in summarize_shop_changes(anchor, bare)] == [
        (ShopChangeKind.REMOVED, "logo", "Removed shop logo")
    ]
    assert summarize_shop_changes(compass, compass) == ()


def test_nothing_an_agent_reads_changes_with_the_logo() -> None:
    """The logo is the operator's; the prompt and every shop-facing tool view ignore it."""
    bare = publishable_shop()
    logod = replace(
        bare, logo=ShopLogo(mark=ShopMark.GEM, background=ShopLogoBackground.STONE, mark_colour=INK)
    )

    assert prompt_variable_values(logod, None, None) == prompt_variable_values(bare, None, None)
    assert knowledge_documents(logod) == knowledge_documents(bare)
    assert [product_detail(p) for p in logod.products] == [product_detail(p) for p in bare.products]
    assert [product_summary(p) for p in logod.products] == [
        product_summary(p) for p in bare.products
    ]


def test_only_an_echo_of_a_v2_logos_derived_colour_keeps_the_stored_logo() -> None:
    stored = ShopLogo(mark=ShopMark.COMPASS, background=ShopLogoBackground.OCHRE, mark_colour=None)
    echo = replace(stored, mark_colour=INK)

    assert keep_unchosen_logo(stored, echo) is stored
    assert keep_unchosen_logo(stored, stored) is stored
    for changed in (
        replace(stored, mark_colour=WHITE),
        replace(echo, mark=ShopMark.ANCHOR),
        replace(echo, background=ShopLogoBackground.STONE),
        replace(echo, mark=None),
    ):
        assert keep_unchosen_logo(stored, changed) is changed
    assert keep_unchosen_logo(stored, None) is None
    # A logo whose colour was chosen is never swapped, even for the same drawing.
    chosen = replace(stored, mark_colour=INK)
    resent = replace(chosen)
    assert keep_unchosen_logo(chosen, resent) is resent
    assert keep_unchosen_logo(None, echo) is echo

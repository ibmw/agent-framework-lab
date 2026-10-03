#!/usr/bin/env bash
# Rebuilds the workspace's self-hosted Inter from Inter's official release.
#
#   apps/web/scripts/subset-inter.sh
#
# It downloads the release, checks the archive's SHA-256, subsets the two variable faces to the
# ranges below and writes them, with the release's licence, to `src/assets/fonts/`. The ranges
# are the ones `styles.css` declares as the faces' `unicode-range`: change both together, which
# `lib/ui.test.ts` holds. A character outside them is drawn by the fallback stack.
#
# fontTools, Brotli and Python are run through `uvx` at pinned versions, so a rerun writes the
# same bytes and nothing is added to the workspace's dependencies. Every name record is kept,
# the licence among them (below). fontTools' default layout features (kerning, ligatures, contextual alternates,
# marks) are kept, plus `tnum`, which the workspace's `tabular-nums` asks for; Inter's stylistic
# sets and character variants are dropped, since nothing selects them. The variable `wght` axis
# is kept whole, 100 to 900.
set -euo pipefail

version="4.1"
archive_sha256="9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e"
fonttools="fonttools==4.60.1"
brotli="brotli==1.2.0"
python="3.12"

# Basic Latin, Latin-1 and Latin Extended-A (French's œ, the shops' European names), the spacing
# accents, general punctuation (– — “ ” … ·), currency (€), letterlike symbols (™ №), arrows
# (← → ↑ ↓), minus, ≠ ≤ ≥, and the review star ★. The status glyphs (● ◦ ◐ ◆ ▣ ✓ ✕ ✎ …) are
# left out on purpose: Inter draws some of a set and not the rest, and a set drawn in two fonts
# would not match itself, so the whole of every set stays with the fallback stack.
unicodes="U+0000-017F,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2212-2215,U+2260-2265,U+2605,U+FEFF,U+FFFD"

here="$(cd "$(dirname "$0")" && pwd)"
out="$here/../src/assets/fonts"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl -sSL -o "$work/inter.zip" "https://github.com/rsms/inter/releases/download/v$version/Inter-$version.zip"
echo "$archive_sha256  $work/inter.zip" | shasum -a 256 -c -
unzip -q "$work/inter.zip" "web/InterVariable.woff2" "web/InterVariable-Italic.woff2" "LICENSE.txt" -d "$work"

# One pinned interpreter subsets both faces and then reads them back: the OFL's condition 2 has
# the licence travel with the font, and pyftsubset keeps only name IDs 0-6 unless told otherwise,
# so a face that has lost its licence (ID 13) or its URL (ID 14) fails the script.
uvx --python "$python" --with "$brotli" --from "$fonttools" python - "$work/web" "$out" "$unicodes" <<'PY'
import sys
from fontTools import subset
from fontTools.ttLib import TTFont

source, out, unicodes = sys.argv[1:]
for face in ("InterVariable", "InterVariable-Italic"):
    target = f"{out}/{face}.woff2"
    subset.main([
        f"{source}/{face}.woff2",
        f"--unicodes={unicodes}",
        "--layout-features+=tnum",
        "--name-IDs=*",
        "--flavor=woff2",
        f"--output-file={target}",
    ])
    names = {record.nameID for record in TTFont(target)["name"].names}
    missing = {13, 14} - names
    if missing:
        sys.exit(f"{target} lost name IDs {sorted(missing)}: the licence must travel with the font")
    print(f"{target}: licence (13) and licence URL (14) kept")
PY
cp "$work/LICENSE.txt" "$out/LICENSE.txt"
ls -l "$out"

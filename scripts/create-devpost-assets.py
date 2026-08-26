from __future__ import annotations

from pathlib import Path
from textwrap import wrap

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
MEDIA = ROOT / "media"
OUTPUT = ROOT / "docs" / "devpost"

BG = "#F7F3E8"
PAPER = "#FFFDF7"
TEAL = "#123238"
GREEN = "#247F77"
AQUA = "#61D6C5"
YELLOW = "#FFD66B"
PURPLE = "#665FD0"
INK = "#163638"
MUTED = "#687B79"
WHITE = "#FFFFFF"

FONT_REGULAR = "/System/Library/Fonts/Supplemental/Verdana.ttf"
FONT_BOLD = "/System/Library/Fonts/Supplemental/Verdana Bold.ttf"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REGULAR, size)


def rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, *size), radius=radius, fill=255)
    return mask


def paste_card(
    canvas: Image.Image,
    source_path: Path,
    box: tuple[int, int, int, int],
    radius: int = 28,
    shadow: int = 20,
) -> None:
    x, y, width, height = box
    source = Image.open(source_path).convert("RGB")
    if source.height > 688:
        source = source.crop((0, 0, source.width, 688))
    fitted = ImageOps.fit(source, (width, height), Image.Resampling.LANCZOS)
    mask = rounded_mask((width, height), radius)

    shadow_layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    shadow_shape = Image.new("RGBA", (width, height), (19, 49, 51, 75))
    shadow_shape.putalpha(mask)
    shadow_layer.alpha_composite(shadow_shape, (x, y + 10))
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(shadow))
    canvas.alpha_composite(shadow_layer)

    card = Image.new("RGBA", (width + 8, height + 8), WHITE)
    card_mask = rounded_mask(card.size, radius + 4)
    card.putalpha(card_mask)
    canvas.alpha_composite(card, (x - 4, y - 4))

    fitted_rgba = fitted.convert("RGBA")
    fitted_rgba.putalpha(mask)
    canvas.alpha_composite(fitted_rgba, (x, y))


def draw_logo(draw: ImageDraw.ImageDraw, x: int, y: int, size: int) -> None:
    scale = size / 64
    draw.rounded_rectangle((x, y, x + size, y + size), radius=18 * scale, fill=TEAL)

    house = [
        (x + 12 * scale, y + 29 * scale),
        (x + 32 * scale, y + 13 * scale),
        (x + 52 * scale, y + 29 * scale),
        (x + 52 * scale, y + 51 * scale),
        (x + 12 * scale, y + 51 * scale),
        (x + 12 * scale, y + 29 * scale),
    ]
    draw.line(house, fill=WHITE, width=max(2, int(4 * scale)), joint="curve")
    draw.ellipse(
        (
            x + 27.4 * scale,
            y + 23.4 * scale,
            x + 34.6 * scale,
            y + 30.6 * scale,
        ),
        fill=YELLOW,
    )
    body = [
        (x + 31 * scale, y + 33 * scale),
        (x + 31 * scale, y + 41 * scale),
        (x + 39 * scale, y + 41 * scale),
        (x + 44 * scale, y + 49 * scale),
    ]
    draw.line(body, fill=WHITE, width=max(2, int(3.5 * scale)), joint="curve")
    draw.line(
        [(x + 31 * scale, y + 37 * scale), (x + 39 * scale, y + 37 * scale)],
        fill=WHITE,
        width=max(2, int(3.5 * scale)),
    )
    draw.line(
        [(x + 31 * scale, y + 41 * scale), (x + 26 * scale, y + 49 * scale)],
        fill=WHITE,
        width=max(2, int(3.5 * scale)),
    )
    draw.arc(
        (
            x + 21 * scale,
            y + 31 * scale,
            x + 43 * scale,
            y + 54 * scale,
        ),
        start=80,
        end=315,
        fill=AQUA,
        width=max(2, int(3.5 * scale)),
    )


def multiline(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    typeface: ImageFont.FreeTypeFont,
    fill: str,
    width: int,
    spacing: int = 10,
) -> None:
    average = max(8, int(width / (typeface.size * 0.58)))
    lines: list[str] = []
    for paragraph in text.splitlines():
        lines.extend(wrap(paragraph, width=average) or [""])
    draw.multiline_text(xy, "\n".join(lines), font=typeface, fill=fill, spacing=spacing)


def add_brand_footer(draw: ImageDraw.ImageDraw, width: int, height: int) -> None:
    draw_logo(draw, 76, height - 66, 42)
    draw.text((132, height - 59), "HomeWheel", font=font(24, True), fill=INK)
    draw.text(
        (width - 650, height - 54),
        "WebMCP accessibility planner · Personal project",
        font=font(18),
        fill=MUTED,
    )


def create_gallery(
    number: int,
    title: str,
    subtitle: str,
    source: str,
    accent: str,
) -> None:
    canvas = Image.new("RGBA", (1920, 1080), BG)
    draw = ImageDraw.Draw(canvas)

    draw.rounded_rectangle((76, 62, 162, 148), radius=24, fill=accent)
    draw.text(
        (99, 82),
        f"{number:02d}",
        font=font(34, True),
        fill=WHITE if accent != YELLOW else TEAL,
    )
    draw.text((196, 58), title, font=font(48, True), fill=INK)
    multiline(draw, (198, 120), subtitle, font(25), MUTED, width=1550, spacing=6)

    paste_card(canvas, MEDIA / source, (96, 226, 1728, 786), radius=26, shadow=18)
    add_brand_footer(draw, 1920, 1080)

    canvas.convert("RGB").save(
        OUTPUT / f"homewheel-gallery-{number:02d}.png",
        quality=95,
    )


def create_cover() -> None:
    canvas = Image.new("RGBA", (1920, 1080), BG)
    draw = ImageDraw.Draw(canvas)

    draw.ellipse((1360, -300, 2150, 490), fill="#D9F3EC")
    draw.ellipse((-360, 700, 430, 1490), fill="#FFF0C6")
    draw.rounded_rectangle((108, 92, 445, 146), radius=27, fill="#E2F3EE")
    draw.text((134, 107), "OPENAI WEBMCP CHALLENGE", font=font(20, True), fill=GREEN)

    draw_logo(draw, 112, 212, 96)
    draw.text((236, 213), "HomeWheel", font=font(78, True), fill=INK)
    draw.text((116, 340), "Make room for real movement", font=font(42, True), fill=GREEN)
    multiline(
        draw,
        (116, 422),
        "A wheelchair-aware room planner where agents optimize measurable circulation—and the person decides what better means.",
        font(29),
        MUTED,
        width=560,
        spacing=12,
    )

    chips = [
        ("8 page-native tools", AQUA),
        ("Proposal-only changes", YELLOW),
        ("Feedback-aware revisions", "#DCD9FF"),
    ]
    chip_y = 670
    for label, color in chips:
        draw.rounded_rectangle((116, chip_y, 612, chip_y + 66), radius=24, fill=color)
        draw.text((145, chip_y + 19), label, font=font(23, True), fill=TEAL)
        chip_y += 82

    paste_card(
        canvas,
        MEDIA / "05-homewheel-revised-proposal.png",
        (720, 205, 1100, 501),
        radius=32,
        shadow=28,
    )

    draw.rounded_rectangle((872, 755, 1668, 932), radius=34, fill=TEAL)
    draw.text((914, 791), "The agent proposes.", font=font(32, True), fill=WHITE)
    draw.text((914, 842), "The person accepts or revises.", font=font(32, True), fill=AQUA)
    add_brand_footer(draw, 1920, 1080)

    canvas.convert("RGB").save(OUTPUT / "homewheel-devpost-cover-1920x1080.png")


def create_square_thumbnail() -> None:
    canvas = Image.new("RGBA", (600, 600), TEAL)
    draw = ImageDraw.Draw(canvas)

    draw.ellipse((410, -90, 690, 190), fill="#1E4A4E")
    draw.ellipse((-120, 450, 170, 740), fill="#1C5A56")
    draw_logo(draw, 42, 42, 72)
    draw.text((138, 48), "HomeWheel", font=font(48, True), fill=WHITE)
    draw.text((44, 142), "Make room for real movement", font=font(27, True), fill=AQUA)
    multiline(
        draw,
        (44, 194),
        "AI optimizes geometry. The person defines good.",
        font(22),
        "#D7E7E4",
        width=510,
        spacing=6,
    )
    paste_card(
        canvas,
        MEDIA / "02-homewheel-first-proposal.png",
        (40, 315, 520, 237),
        radius=18,
        shadow=12,
    )
    canvas.convert("RGB").save(OUTPUT / "homewheel-devpost-thumbnail-600x600.png")


def create_youtube_thumbnail() -> None:
    canvas = Image.new("RGBA", (1280, 720), TEAL)
    draw = ImageDraw.Draw(canvas)

    draw.ellipse((850, -260, 1480, 370), fill="#1E4A4E")
    draw.ellipse((-280, 500, 330, 1110), fill="#1C5A56")
    draw_logo(draw, 60, 58, 76)
    draw.text((158, 65), "HomeWheel", font=font(44, True), fill=WHITE)
    draw.rounded_rectangle((60, 176, 564, 238), radius=24, fill=YELLOW)
    draw.text((88, 191), "THE AGENT PROPOSES", font=font(23, True), fill=TEAL)
    draw.text((60, 270), "THE PERSON", font=font(52, True), fill=WHITE)
    draw.text((60, 340), "DECIDES.", font=font(72, True), fill=AQUA)
    multiline(
        draw,
        (64, 446),
        "Wheelchair-aware room planning through WebMCP",
        font(25),
        "#D7E7E4",
        width=485,
        spacing=8,
    )

    paste_card(
        canvas,
        MEDIA / "05-homewheel-revised-proposal.png",
        (600, 112, 620, 420),
        radius=28,
        shadow=22,
    )
    draw.rounded_rectangle((720, 570, 1150, 645), radius=28, fill=PAPER)
    draw.text((756, 592), "2 / 2 ROUTES CLEAR", font=font(24, True), fill=GREEN)
    canvas.convert("RGB").save(OUTPUT / "homewheel-youtube-thumbnail-1280x720.png")


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    create_square_thumbnail()
    create_cover()
    create_youtube_thumbnail()

    create_gallery(
        1,
        "Start with the person, not the floor plan",
        "Chair width, preferred passage, turning space, destinations, and non-negotiables shape every proposal.",
        "01-homewheel-baseline.png",
        GREEN,
    )
    create_gallery(
        2,
        "The agent previews; it never silently edits",
        "Exact moves, route evidence, and trade-offs appear before anything changes in the live room.",
        "02-homewheel-first-proposal.png",
        PURPLE,
    )
    create_gallery(
        3,
        "Lived feedback becomes structured context",
        "A geometrically successful plan can still be wrong. Rejection teaches the next agent proposal.",
        "04-homewheel-feedback-context.png",
        YELLOW,
    )
    create_gallery(
        4,
        "Revise around what geometry cannot know",
        "The second proposal preserves the dresser orientation and still clears both required destinations.",
        "05-homewheel-revised-proposal.png",
        PURPLE,
    )
    create_gallery(
        5,
        "Only acceptance changes the room",
        "The accepted layout is measurable, visible in history, and reversible.",
        "06-homewheel-accepted-plan.png",
        GREEN,
    )


if __name__ == "__main__":
    main()

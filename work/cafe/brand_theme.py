"""One color transform for shared, cloud and guest CSS, including keyframes.

Standard colors remain exact fallbacks. Only the explicitly selected coffee
palette overrides the tokens; configured location/source colors stay independent.
"""
import colorsys
import re

COLORS = re.compile(r"#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{4}\b|#[0-9a-fA-F]{3}\b|(?<![-\w])(?:white|black)(?![-\w])")
ANCHORS = [(0, "211711"), (.12, "302119"), (.23, "4b3022"),
           (.35, "78563f"), (.5, "987456"), (.65, "b99b7b"),
           (.8, "deccb1"), (.9, "f3e6ca"), (1, "fffdf8")]


def coffee_color(value):
    raw = {"white": "ffffff", "black": "000000"}.get(value, value.lstrip("#"))
    if len(raw) in (3, 4):
        raw = "".join(c * 2 for c in raw)
    rgb = [int(raw[i:i + 2], 16) for i in (0, 2, 4)]
    hue, lightness, saturation = colorsys.rgb_to_hls(*(c / 255 for c in rgb))
    linear = [(c / 255 / 12.92 if c / 255 <= .04045 else ((c / 255 + .055) / 1.055) ** 2.4) for c in rgb]
    y = sum(a * b for a, b in zip(linear, (.2126, .7152, .0722)))
    level = 12.92 * y if y <= .0031308 else 1.055 * y ** (1 / 2.4) - .055
    for (lo, a), (hi, b) in zip(ANCHORS, ANCHORS[1:]):
        if level <= hi:
            amount = (level - lo) / (hi - lo)
            mapped = [round(int(a[i:i + 2], 16) * (1 - amount) + int(b[i:i + 2], 16) * amount) for i in (0, 2, 4)]
            break
    # Preserve the meaning of destructive/error states, in warm burgundy tones.
    if saturation > .25 and (hue < .055 or hue > .92) and .18 < lightness < .9:
        mapped = [round(c * 255) for c in colorsys.hls_to_rgb(.025, lightness, min(saturation, .5))]
    return "#" + "".join(f"{c:02x}" for c in mapped) + raw[6:]


def mono_color(value):
    raw = {"white": "ffffff", "black": "000000"}.get(value, value.lstrip("#"))
    if len(raw) in (3, 4): raw = "".join(c * 2 for c in raw)
    rgb = [int(raw[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    linear = [c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in rgb]
    y = sum(a * b for a, b in zip(linear, (.2126, .7152, .0722)))
    level = 12.92 * y if y <= .0031308 else 1.055 * y ** (1 / 2.4) - .055
    grey = f"{round(level * 255):02x}"
    return "#" + grey * 3 + raw[6:]


def palette_styles(css):
    colors = {}
    mono = {}

    def replace(match):
        color = match.group().lower()
        name = "--tone-" + color.lstrip("#")
        colors[name] = coffee_color(color)
        mono[name] = mono_color(color)
        return f"var({name},{match.group()})"

    # Comments may describe colors in prose; don't transform them into CSS.
    parts = re.split(r"(/\*.*?\*/)", css, flags=re.S)
    declarations = re.compile(r"([\w-]+\s*:\s*)([^{};]*)(;|(?=\}))")
    def transform(part):
        return declarations.sub(lambda m: m[1] + COLORS.sub(replace, m[2]) + m[3], part)
    transformed = "".join(part if part.startswith("/*") else transform(part) for part in parts)
    tokens = ";".join(f"{name}:{value}" for name, value in sorted(colors.items()))
    return transformed + "\n:root[data-palette=coffee]{" + tokens + "}\n:root[data-palette=mono]{" + ";".join(f"{k}:{v}" for k,v in sorted(mono.items())) + "}\n"

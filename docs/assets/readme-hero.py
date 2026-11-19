#!/usr/bin/env python3
# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Generates docs/assets/readme-hero.svg: AX Studio's README hero.

The hero plays five real screens of AX Studio in a browser window, with a pointer
that clicks through them and a caption for each:

  1. home.png     Home, with "Fix the flaky signer tests. Explain the cause in notes/." in the goal field
  2. new.png      New task after Set up task, ready to run
  3. task.png     The task's page while it runs (Activity)
  4. changes.png  Its Changes tab, with src/signer.py open
  5. promote.png  Run on another cluster, with the check passed for gke-team-dev

Take each as a 1440x900 screenshot of the light theme, then run (from the repo root):

  python3 docs/assets/readme-hero.py <folder with the five PNGs> > docs/assets/readme-hero.svg

It needs ImageMagick (`magick`) to embed the screens as WebP. The SVG is animated with CSS
only, so GitHub plays it inline (an <img> runs no script). The hero types the goal out,
and the boxes below, in screenshot pixels, place the rings and the pointer. With reduced
motion, it shows the Changes screen.
"""

import base64
import subprocess
import sys
from pathlib import Path

SCENES = ["home", "new", "task", "changes", "promote"]
URLS = ["127.0.0.1:8080/#/", "127.0.0.1:8080/#/new", "127.0.0.1:8080/#/task/fix-flaky-tests",
        "127.0.0.1:8080/#/task/fix-flaky-tests/changes", "127.0.0.1:8080/#/task/fix-flaky-tests"]
CAPTIONS = [
    "Describe the outcome you want, then Set up task.",
    "Pick a template and where it runs, then Run task.",
    "The agent works in its own gVisor sandbox, and can reach only the sites you allow.",
    "Review every change before it lands: push a branch or apply it to a folder.",
    "Send the same task to a team cluster with ax promote, checked first.",
]
# Boxes in screenshot pixels (x, y, width, height), as Studio lays them out at 1440x900.
BOX = {
    "go": (724, 200, 120, 34), "input": (284, 200, 432, 37), "typed": (292, 205, 340, 27),
    "run": (1113, 524, 258, 40),
    "chip": (284, 112, 84, 22), "reach": (1108, 540, 294, 165), "changes_tab": (406, 158, 92, 30),
    "diff": (284, 280, 770, 302), "push": (284, 704, 155, 28), "another": (1117, 481, 277, 27),
    "check": (380, 448, 670, 128), "send": (848, 687, 189, 34),
}
TYPED_CHARS = 56                # "Fix the flaky signer tests. Explain the cause in notes/."
EASE = "animation-timing-function:cubic-bezier(.45,0,.25,1)"

DUR = 15.0                      # seconds per loop, 3 per screen
W, H = 960, 690                 # the canvas
WX, WY, WW, BAR = 40, 30, 880, 34
S = WW / 1440                   # screenshot pixels to SVG units
WH = 900 * S
SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans',Helvetica,Arial,sans-serif"
TEAL = "#0d9488"

kf, rules, out = [], [], []


def pct(t):
    return t / DUR * 100


def anim(name, stops, base, extra=""):
    """stops: (seconds, css) pairs. base is the static frame shown with reduced motion."""
    kf.append(f"@keyframes a-{name}{{" + "".join(f"{pct(t):.3f}%{{{css}}}" for t, css in stops) + "}")
    rules.append(f".{name}{{{base};animation:a-{name} {DUR}s linear infinite{extra}}}")
    return name


def window(name, on, off, fade=0.4, base="opacity:0"):
    """Opacity 1 from `on` to `off` seconds, with short fades."""
    stops = [(0, "opacity:0")] if on > 0 else [(0, "opacity:1")]
    if on > 0:
        stops += [(max(on - fade / 2, 0), "opacity:0"), (on + fade / 2, "opacity:1")]
    stops += [(off - fade / 2 if off < DUR else DUR, "opacity:1")]
    if off < DUR:
        stops += [(off + fade / 2, "opacity:0"), (DUR, "opacity:0")]
    return anim(name, stops, base)


def handoff(name, on, off, fade, base):
    """Like window, but fades in after `on` and out before `off`, so one text never overlaps the next."""
    stops = [(0, "opacity:0"), (on, "opacity:0"), (on + fade, "opacity:1"), (off - fade, "opacity:1"), (off, "opacity:0")]
    if off < DUR:
        stops.append((DUR, "opacity:0"))
    return anim(name, stops if on > 0 else stops[1:], base)


def sx(x):
    return WX + x * S


def sy(y):
    return WY + BAR + y * S


def center(key):
    x, y, w, h = BOX[key]
    return sx(x + w / 2), sy(y + h / 2)


def ring(key, on, off, name, pad=6):
    x, y, w, h = BOX[key]
    window(name, on, off, fade=0.5)
    out.append(f'<rect class="{name}" x="{sx(x) - pad:.1f}" y="{sy(y) - pad:.1f}" width="{w * S + 2 * pad:.1f}" height="{h * S + 2 * pad:.1f}" '
               f'rx="9" fill="{TEAL}" fill-opacity="0.07" stroke="{TEAL}" stroke-width="2.4" filter="url(#soft)"/>')


def click(key, t, name, offset=(0, 0)):
    cx, cy = center(key)
    cx, cy = cx + offset[0] * S, cy + offset[1] * S
    anim(name, [(0, "opacity:0;transform:scale(.2)"), (t - 0.01, "opacity:0;transform:scale(.2)"), (t, "opacity:.9;transform:scale(.2)"),
                (t + 0.45, "opacity:0;transform:scale(1.6)"), (DUR, "opacity:0;transform:scale(1.6)")],
         "opacity:0", ";transform-box:fill-box;transform-origin:center")
    out.append(f'<circle class="{name}" cx="{cx:.1f}" cy="{cy:.1f}" r="16" fill="none" stroke="{TEAL}" stroke-width="3"/>')


def webp(path):
    data = subprocess.run(["magick", str(path), "-resize", "1200x750", "-quality", "80", "-define", "webp:method=6", "webp:-"],
                          check=True, capture_output=True).stdout
    return base64.b64encode(data).decode()


def main(folder):
    folder = Path(folder)
    # ---------- The frame: a soft background, a browser window, its address ----------
    out.append(f'<rect width="{W}" height="{H}" rx="20" fill="url(#bg)"/>')
    out.append(f'<g filter="url(#shadow)"><rect x="{WX}" y="{WY}" width="{WW}" height="{BAR + WH:.1f}" rx="12" fill="#ffffff"/></g>')
    out.append(f'<clipPath id="win"><rect x="{WX}" y="{WY}" width="{WW}" height="{BAR + WH:.1f}" rx="12"/></clipPath>')
    out.append('<g clip-path="url(#win)">')
    out.append(f'<rect x="{WX}" y="{WY}" width="{WW}" height="{BAR}" fill="#f3f5f8"/>')
    out.append(f'<line x1="{WX}" y1="{WY + BAR - 0.5}" x2="{WX + WW}" y2="{WY + BAR - 0.5}" stroke="#e1e6ec"/>')
    for i, c in enumerate(["#ff5f57", "#febc2e", "#28c840"]):
        out.append(f'<circle cx="{WX + 18 + i * 18}" cy="{WY + BAR / 2}" r="5.5" fill="{c}"/>')
    out.append(f'<rect x="{WX + 84}" y="{WY + 7}" width="360" height="20" rx="10" fill="#e6eaef"/>')
    # ---------- The five screens; each fades in over the last ----------
    for i, name in enumerate(SCENES):
        t = i * 3.0
        if i == 0:
            cls = anim("s0", [(0, "opacity:1"), (DUR, "opacity:1")], "opacity:1")
        else:
            end = DUR if i == len(SCENES) - 1 else t + 3.4
            stops = [(0, "opacity:0"), (t - 0.2, "opacity:0"), (t + 0.2, "opacity:1")]
            stops += [(DUR - 0.4, "opacity:1"), (DUR, "opacity:0")] if end == DUR else [(end, "opacity:1"), (end + 0.01, "opacity:0"), (DUR, "opacity:0")]
            cls = anim(f"s{i}", stops, "opacity:1" if name == "changes" else "opacity:0")
        out.append(f'<image class="{cls}" x="{WX}" y="{WY + BAR}" width="{WW}" height="{WH:.1f}" preserveAspectRatio="xMidYMid slice" '
                   f'href="data:image/webp;base64,{webp(folder / (name + ".png"))}"/>')
        if i == 0:
            # Home's goal is typed in: a white cover over the text shrinks from the left, a step per two
            # characters, with a caret at its edge. Later screens cover both.
            x, y, w, h = BOX["typed"]
            steps = f"animation-timing-function:steps({TYPED_CHARS // 2},end)"
            anim("type", [(0, "transform:scaleX(1)"), (0.45, f"transform:scaleX(1);{steps}"),
                          (1.3, "transform:scaleX(0)"), (14.5, "transform:scaleX(0)"), (14.55, "transform:scaleX(1)"),
                          (DUR, "transform:scaleX(1)")],
                 "transform:scaleX(0)", ";transform-box:fill-box;transform-origin:right center")
            out.append(f'<rect class="type" x="{sx(x):.1f}" y="{sy(y):.1f}" width="{w * S:.1f}" height="{h * S:.1f}" fill="#ffffff"/>')
            anim("caret", [(0, "opacity:0;transform:translateX(0px)"), (0.42, "opacity:0;transform:translateX(0px)"),
                           (0.45, f"opacity:1;transform:translateX(0px);{steps}"),
                           (1.3, f"opacity:1;transform:translateX({w * S:.1f}px)"), (1.9, f"opacity:1;transform:translateX({w * S:.1f}px)"),
                           (1.95, f"opacity:0;transform:translateX({w * S:.1f}px)"), (DUR, f"opacity:0;transform:translateX({w * S:.1f}px)")],
                 "opacity:0")
            out.append(f'<rect class="caret" x="{sx(x) + 1:.1f}" y="{sy(y + 5):.1f}" width="1.2" height="{(h - 10) * S:.1f}" fill="#111827"/>')
        on, off = (0 if i == 0 else t, DUR if i == len(SCENES) - 1 else t + 3.0)
        url = handoff(f"u{i}", on, off, 0.15, "opacity:1" if name == "changes" else "opacity:0")
        out.append(f'<text class="{url}" x="{WX + 98}" y="{WY + 21.5}" font-family="{SANS}" font-size="11.5" fill="#57606a">{URLS[i]}</text>')
    out.append("</g>")

    # ---------- Where to look: rings around what matters on each screen ----------
    ring("input", 0.3, 1.6, "r-input", pad=4)
    ring("run", 3.6, 5.2, "r-run")
    ring("chip", 6.4, 8.8, "r-chip", pad=5)
    ring("reach", 6.9, 8.8, "r-reach", pad=3)
    ring("diff", 9.3, 10.4, "r-diff", pad=4)
    ring("push", 10.1, 11.3, "r-push", pad=5)
    ring("check", 12.5, 13.9, "r-check")
    # ---------- The pointer: moves, clicks, and the next screen opens ----------
    # (seconds, box, offset in screenshot pixels); it eases between stops and rests where they repeat.
    rest = (180, 2)   # in the goal field, right of the text
    path = [(0, "input", rest), (1.35, "input", rest), (1.8, "go", (0, 0)), (3.1, "go", (0, 0)), (4.4, "run", (0, 0)),
            (6.1, "run", (0, 0)), (7.0, "reach", (90, 30)), (7.6, "reach", (90, 30)), (8.35, "changes_tab", (0, 0)),
            (9.1, "changes_tab", (0, 0)), (9.8, "diff", (60, 60)), (10.25, "push", (40, 6)), (10.85, "push", (40, 6)),
            (11.5, "another", (0, 0)), (12.3, "another", (0, 0)), (13.9, "send", (0, 0)), (14.6, "send", (0, 0)),
            (15.0, "input", rest)]
    stops = []
    for t, key, (dx, dy) in path:
        x, y = center(key)
        stops.append((t, f"transform:translate({x + dx * S:.1f}px,{y + dy * S:.1f}px);{EASE}"))
    pointer = anim("ptr", stops, "transform:none")
    vis = anim("ptr-vis", [(0, "opacity:0"), (0.3, "opacity:1"), (14.5, "opacity:1"), (14.8, "opacity:0"), (DUR, "opacity:0")], "opacity:0")
    out.append(f'<g class="{vis}"><g class="{pointer}"><path d="M0 0 L0 17 L4.6 12.9 L7.6 19.6 L10.6 18.3 L7.7 11.8 L13.6 11.8 Z" '
               f'fill="#111827" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round" filter="url(#ptr)"/></g></g>')
    click("input", 0.35, "c-input", offset=rest)
    click("go", 2.0, "c-go")
    click("run", 5.0, "c-run")
    click("changes_tab", 8.6, "c-tab")
    click("another", 11.7, "c-another")
    click("send", 14.3, "c-send")

    # ---------- Under the window: what each screen shows, and where the loop is ----------
    for i, caption in enumerate(CAPTIONS):
        on, off = (0 if i == 0 else i * 3.0, DUR if i == len(SCENES) - 1 else i * 3.0 + 3.0)
        cls = handoff(f"cap{i}", on, off, 0.25, "opacity:1" if SCENES[i] == "changes" else "opacity:0")
        out.append(f'<text class="{cls}" x="{W / 2}" y="{WY + BAR + WH + 34:.1f}" font-family="{SANS}" font-size="16" font-weight="500" '
                   f'fill="#1f2937" text-anchor="middle">{caption}</text>')
    seg, gap = 36, 8
    x0 = W / 2 - (len(SCENES) * seg + (len(SCENES) - 1) * gap) / 2
    for i in range(len(SCENES)):
        x = x0 + i * (seg + gap)
        y = WY + BAR + WH + 52
        out.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{seg}" height="4" rx="2" fill="#94a3b8" fill-opacity="0.35"/>')
        on, off = (0 if i == 0 else i * 3.0, DUR if i == len(SCENES) - 1 else i * 3.0 + 3.0)
        cls = window(f"seg{i}", on, off, fade=0.3, base="opacity:1" if SCENES[i] == "changes" else "opacity:0")
        out.append(f'<rect class="{cls}" x="{x:.1f}" y="{y:.1f}" width="{seg}" height="4" rx="2" fill="{TEAL}"/>')

    defs = ('<defs>'
            '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e6f0fb"/><stop offset="0.55" stop-color="#f1edfb"/><stop offset="1" stop-color="#fcefe9"/></linearGradient>'
            '<filter id="shadow" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#0f172a" flood-opacity="0.18"/></filter>'
            '<filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#0d9488" flood-opacity="0.35"/></filter>'
            '<filter id="ptr" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.4" flood-color="#000" flood-opacity="0.35"/></filter>'
            '</defs>')
    style = "\n".join(kf + rules) + "\n@media (prefers-reduced-motion:reduce){*{animation:none!important}}"
    print("<!-- README hero: five real screens of AX Studio. CSS animation only, so GitHub plays it inline; prefers-reduced-motion shows the Changes screen. Made by docs/assets/readme-hero.py. -->")
    print(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-labelledby="t d">')
    print('<title id="t">AX Studio in 15 seconds: describe a goal, run it in a sandbox, review the changes, and send it to a team cluster</title>')
    print('<desc id="d">Five screens of AX Studio. On Home, the goal "Fix the flaky signer tests" is typed and Set up task is clicked. '
          'On New task, the Antigravity template is ready to run on this computer, and Run task is clicked. On the task\'s page, it runs '
          'in a gVisor sandbox that can reach only github.com, pypi.org and the model API. On Changes, the diff waits for review, with '
          'Push to a branch. Then Run on another cluster checks gke-team-dev and sends the task there with ax promote.</desc>')
    print(defs)
    print(f"<style>{style}</style>")
    print("\n".join(out))
    print("</svg>")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])

#!/usr/bin/env python3
"""Sqlotter curated-level generator.

Generates WORLD_COUNT x LEVELS_PER_WORLD unique, solvable puzzle levels and
writes them to src/shared/curatedLevels.ts (imported by the game at build time,
so "uploading" the levels = deploying the app; see README section printed at
the end of a run).

Design guarantees:
  * Rule-exact:   ports checkCompatibility / applyToState / statesMatch from
                  src/shared/gameRules.ts and the count limits from
                  src/client/engine/LevelEngine.ts. A level is only emitted if
                  its solution replays cleanly under those rules.
  * Honest stars: optimalSteps is the TRUE optimum, found by BFS over the full
                  palette (including decoys), never just the length of the
                  generating sequence.
  * Unique:       no two levels in the whole game share a goal state, and no
                  two levels share a title.
  * Deterministic: same script version -> same 160 levels (seeded RNG), so
                  regenerating doesn't churn every level id/diff.

Run:  python scripts/generate_levels.py
"""

from __future__ import annotations

import random
from collections import deque
from dataclasses import dataclass, field, replace
from pathlib import Path

# ── Constants mirrored from src/shared/ ──────────────────────────────────────

WORLD_COUNT = 10
LEVELS_PER_WORLD = 16
MASTER_SEED = "sqlotter-worlds-v1"

# (hex, display name) — bright subset of PAINT_COLORS_16 (no whites/greys:
# the goal slime must read clearly against the beige UI).
COLORS = [
    ("#FF4136", "Red"), ("#FF851B", "Orange"), ("#FFDC00", "Yellow"),
    ("#01FF70", "Lime"), ("#2ECC40", "Green"), ("#39CCCC", "Teal"),
    ("#7FDBFF", "Sky"), ("#0074D9", "Blue"), ("#003AB4", "Navy"),
    ("#B10DC9", "Purple"), ("#F012BE", "Magenta"), ("#FF69B4", "Pink"),
]
COLOR_NAME = dict(COLORS)

GOGGLE_VARIANTS = ["h-thick", "h-thin", "h-mono", "v-thick", "v-thin", "v-mono"]
FOUR_WAY_VARIANTS = ["h-thick", "h-thin", "v-thick", "v-thin"]
PENDANT_VARIANTS = ["h", "v"]
THICK_BELTS = {"h-thick", "v-thick"}

DEFAULT_COLOR = "#FFFFFF"


# ── Slime state + rules (exact port of src/shared/gameRules.ts) ──────────────

@dataclass(frozen=True)
class State:
    color: str = DEFAULT_COLOR
    color_bottom: str | None = None
    goggles: str | None = None
    glasses: str | None = None
    belt: str | None = None
    pendant: str | None = None
    pumpkin: int | None = None
    underwear: bool = False


@dataclass(frozen=True)
class Mod:
    id: str
    type: str
    variant: str | None = None
    coverage: int | None = None
    color: str | None = None
    count: int | None = None


def check_compat(state: State, mod: Mod, goggles_used: bool) -> str | None:
    if mod.type == "goggles":
        if goggles_used:
            return "GOGGLE_ONE_SHOT"
        if state.glasses is not None:
            return "EYE_SLOT"
    if mod.type == "glasses" and state.goggles is not None:
        return "EYE_SLOT"
    if mod.type == "underwear" and state.pumpkin == 75:
        return "PUMPKIN_UNDERWEAR"
    if mod.type == "pumpkin" and mod.coverage == 75:
        if state.underwear:
            return "UNDERWEAR_PUMPKIN75"
        if state.belt in THICK_BELTS:
            return "THICK_BELT_PUMPKIN75"
    if mod.type == "belt" and mod.variant in THICK_BELTS and state.pumpkin == 75:
        return "PUMPKIN75_THICK_BELT"
    return None


def apply_mod(state: State, mod: Mod) -> State:
    if mod.type == "paint":
        if state.pumpkin is None:
            return replace(state, color=mod.color, color_bottom=None)
        return replace(state, color=mod.color)
    if mod.type == "pumpkin":
        bottom = state.color if state.pumpkin is None else state.color_bottom
        return replace(state, pumpkin=mod.coverage, color_bottom=bottom)
    if mod.type == "goggles":
        return replace(state, goggles=mod.variant)
    if mod.type == "glasses":
        return replace(state, glasses=mod.variant)
    if mod.type == "belt":
        return replace(state, belt=mod.variant)
    if mod.type == "pendant":
        return replace(state, pendant=mod.variant)
    if mod.type == "underwear":
        return replace(state, underwear=True)
    raise ValueError(f"unknown modifier type {mod.type}")


def canonical(state: State) -> tuple:
    """Comparison key matching statesMatch(): colorBottom falls back to color."""
    return (
        state.color,
        state.color_bottom if state.color_bottom is not None else state.color,
        state.goggles, state.glasses, state.belt, state.pendant,
        state.pumpkin, state.underwear,
    )


# ── BFS: true optimal solution over the full palette ─────────────────────────

def bfs_optimal(palette: list[Mod], goal: State, max_depth: int = 8) -> list[str] | None:
    goal_key = canonical(goal)
    start = (State(), False)
    seen = {(canonical(start[0]), start[0].color_bottom, False)}
    queue: deque[tuple[State, bool, list[str]]] = deque([(State(), False, [])])
    while queue:
        state, goggles_used, path = queue.popleft()
        if len(path) >= max_depth:
            continue
        for mod in palette:
            if check_compat(state, mod, goggles_used) is not None:
                continue
            nxt = apply_mod(state, mod)
            n_used = goggles_used or mod.type == "goggles"
            key = (canonical(nxt), nxt.color_bottom, n_used)
            if key in seen:
                continue
            seen.add(key)
            n_path = path + [mod.id]
            if canonical(nxt) == goal_key:
                return n_path
            queue.append((nxt, n_used, n_path))
    return None


def replay(palette: list[Mod], actions: list[str], goal: State) -> bool:
    """Port of isValidSolution + LevelEngine count limits."""
    by_id = {m.id: m for m in palette}
    state, goggles_used = State(), False
    usage: dict[str, int] = {}
    for action in actions:
        mod = by_id.get(action)
        if mod is None:
            return False
        if mod.count is not None and usage.get(mod.id, 0) >= mod.count:
            return False
        if check_compat(state, mod, goggles_used) is not None:
            return False
        state = apply_mod(state, mod)
        if mod.type == "goggles":
            goggles_used = True
        usage[mod.id] = usage.get(mod.id, 0) + 1
    return canonical(state) == canonical(goal)


# ── Modifier factories ────────────────────────────────────────────────────────

def paint(color_hex: str) -> Mod:
    return Mod(id=f"paint-{COLOR_NAME[color_hex].lower()}", type="paint", color=color_hex)


def goggles(variant: str) -> Mod:
    return Mod(id=f"goggles-{variant}", type="goggles", variant=variant, count=1)


def glasses(variant: str) -> Mod:
    return Mod(id=f"glasses-{variant}", type="glasses", variant=variant)


def belt(variant: str) -> Mod:
    return Mod(id=f"belt-{variant}", type="belt", variant=variant)


def pendant(variant: str) -> Mod:
    return Mod(id=f"pendant-{variant}", type="pendant", variant=variant)


def pumpkin(coverage: int) -> Mod:
    return Mod(id=f"pumpkin-{coverage}", type="pumpkin", coverage=coverage)


UNDERWEAR = Mod(id="underwear", type="underwear")


# ── World plans ───────────────────────────────────────────────────────────────

@dataclass
class WorldPlan:
    num: int
    name: str
    difficulty: int
    steps: tuple[int, int]            # inclusive range for TRUE optimal steps
    wearables: list[str]              # non-paint types allowed in the solution
    pumpkin_coverages: list[int] = field(default_factory=list)
    two_tone: float = 0.0             # probability a level is forced two-tone
    decoys: tuple[int, int] = (1, 1)
    trap_decoys: bool = False         # allow dead-end decoys (reset recovers)


WORLDS = [
    WorldPlan(1, "Splat School",    1, (1, 2), ["belt", "pendant"]),
    WorldPlan(2, "Dress-Up Dell",   1, (2, 3), ["belt", "pendant", "underwear"]),
    WorldPlan(3, "Goggle Grove",    2, (2, 3), ["goggles", "glasses", "pendant"]),
    WorldPlan(4, "Pumpkin Patch",   2, (3, 3), ["pumpkin", "pendant", "underwear", "belt"],
              pumpkin_coverages=[25, 50], decoys=(1, 2)),
    WorldPlan(5, "Two-Tone Tarn",   3, (3, 4), ["pumpkin", "belt", "pendant", "glasses"],
              pumpkin_coverages=[25, 50], two_tone=1.0, decoys=(1, 2)),
    WorldPlan(6, "Layer Lagoon",    3, (3, 4), ["pumpkin", "glasses", "belt", "underwear"],
              pumpkin_coverages=[50, 75], decoys=(2, 2)),
    WorldPlan(7, "Decoy Dunes",     4, (4, 4), ["pumpkin", "goggles", "glasses", "belt", "pendant", "underwear"],
              pumpkin_coverages=[25, 50], decoys=(3, 3), trap_decoys=True),
    WorldPlan(8, "Trap Tundra",     4, (4, 5), ["pumpkin", "goggles", "glasses", "belt", "pendant", "underwear"],
              pumpkin_coverages=[50, 75], decoys=(2, 3), trap_decoys=True),
    WorldPlan(9, "Expert Estuary",  5, (5, 5), ["pumpkin", "goggles", "glasses", "belt", "pendant", "underwear"],
              pumpkin_coverages=[25, 50, 75], two_tone=0.5, decoys=(3, 3), trap_decoys=True),
    WorldPlan(10, "Master Marsh",   5, (5, 6), ["pumpkin", "goggles", "glasses", "belt", "pendant", "underwear"],
              pumpkin_coverages=[25, 50, 75], two_tone=0.6, decoys=(3, 3), trap_decoys=True),
]


# ── Solution-sequence construction ────────────────────────────────────────────

def make_wearable(rng: random.Random, kind: str, plan: WorldPlan) -> Mod:
    if kind == "goggles":
        return goggles(rng.choice(GOGGLE_VARIANTS))
    if kind == "glasses":
        return glasses(rng.choice(FOUR_WAY_VARIANTS))
    if kind == "belt":
        return belt(rng.choice(FOUR_WAY_VARIANTS))
    if kind == "pendant":
        return pendant(rng.choice(PENDANT_VARIANTS))
    if kind == "pumpkin":
        return pumpkin(rng.choice(plan.pumpkin_coverages))
    if kind == "underwear":
        return UNDERWEAR
    raise ValueError(kind)


def build_sequence(rng: random.Random, plan: WorldPlan) -> tuple[list[Mod], State] | None:
    """Random valid modifier sequence for this world; returns (sequence, goal)."""
    n = rng.randint(*plan.steps)
    colors = rng.sample([c for c, _ in COLORS], k=3)
    two_tone = plan.two_tone > 0 and n >= 3 and rng.random() < plan.two_tone

    seq: list[Mod] = [paint(colors[0])]
    state = apply_mod(State(), seq[0])
    goggles_used = False
    used_types = {"paint"}

    # Forced two-tone skeleton: paint A -> pumpkin -> ... -> paint B somewhere
    # after the pumpkin (the pumpkin freezes A into the protected bottom zone).
    second_paint_at = rng.randint(2, n - 1) if two_tone else None

    for step in range(1, n):
        if two_tone and step == 1:
            mod = pumpkin(rng.choice(plan.pumpkin_coverages))
            used_types.add("pumpkin")
        elif second_paint_at == step:
            mod = paint(colors[1])
        else:
            pool = [k for k in plan.wearables if k not in used_types]
            rng.shuffle(pool)
            mod = None
            for kind in pool:
                candidate = make_wearable(rng, kind, plan)
                if check_compat(state, candidate, goggles_used) is None:
                    mod = candidate
                    used_types.add(kind)
                    break
            if mod is None:
                return None
        if check_compat(state, mod, goggles_used) is not None:
            return None
        state = apply_mod(state, mod)
        if mod.type == "goggles":
            goggles_used = True
        seq.append(mod)

    # A two-tone goal must actually show two colours.
    if two_tone and canonical(state)[0] == canonical(state)[1]:
        return None
    return seq, state


def build_decoys(rng: random.Random, plan: WorldPlan, seq: list[Mod], goal: State) -> list[Mod]:
    used_ids = {m.id for m in seq}
    used_colors = {m.color for m in seq if m.type == "paint"}
    count = rng.randint(*plan.decoys)
    decoys: list[Mod] = []

    def try_add(mod: Mod) -> bool:
        if mod.id in used_ids:
            return False
        used_ids.add(mod.id)
        decoys.append(mod)
        return True

    # Wrong-variant decoys of items already in the goal are always recoverable
    # (same-slot replace); paint decoys are always harmless.
    options: list[Mod] = []
    for m in seq:
        if m.type == "belt":
            options += [belt(v) for v in FOUR_WAY_VARIANTS if v != m.variant]
        elif m.type == "glasses":
            options += [glasses(v) for v in FOUR_WAY_VARIANTS if v != m.variant]
        elif m.type == "pendant":
            options += [pendant(v) for v in PENDANT_VARIANTS if v != m.variant]
        elif m.type == "pumpkin":
            options += [pumpkin(c) for c in plan.pumpkin_coverages if c != m.coverage]
    rng.shuffle(options)

    # Dead-end / conflict traps (later worlds only): the classic Factory-Balls
    # "you must reset" teaching moments the original curated set already used.
    if plan.trap_decoys:
        traps: list[Mod] = []
        if goal.goggles is not None:
            traps.append(glasses(rng.choice(FOUR_WAY_VARIANTS)))    # eye-slot trap
        if goal.glasses is not None:
            traps.append(goggles(rng.choice(GOGGLE_VARIANTS)))      # one-shot trap
        if goal.pumpkin == 75:
            if not goal.underwear:
                traps.append(UNDERWEAR)                             # blocked-apply trap
            if goal.belt is None:
                traps.append(belt(rng.choice(sorted(THICK_BELTS)))) # order trap
        rng.shuffle(traps)
        for trap in traps[:1]:
            if len(decoys) < count:
                try_add(trap)

    for option in options:
        if len(decoys) >= count:
            break
        try_add(option)

    free_colors = [c for c, _ in COLORS if c not in used_colors]
    rng.shuffle(free_colors)
    for color_hex in free_colors:
        if len(decoys) >= count:
            break
        try_add(paint(color_hex))

    return decoys


# ── Titles & hints ────────────────────────────────────────────────────────────

TYPE_NOUNS = {
    "goggles":   ["Diver", "Swimmer", "Pilot", "Frogman", "Snorkel"],
    "glasses":   ["Scholar", "Professor", "Bookworm", "Genius", "Reader"],
    "belt":      ["Buckle", "Cinch", "Sash", "Wrap", "Girdle"],
    "pendant":   ["Charm", "Locket", "Medallion", "Jewel", "Amulet"],
    "pumpkin":   ["Gourd", "Lantern", "Harvest", "Squash", "Patch"],
    "underwear": ["Skivvies", "Bloomers", "Britches", "Undies", "Drawers"],
    "paint":     ["Splash", "Coat", "Glaze", "Gloss", "Drip"],
}


def make_title(rng: random.Random, seq: list[Mod], goal: State, used_titles: set[str]) -> str:
    top = COLOR_NAME[goal.color]
    bottom = COLOR_NAME.get(goal.color_bottom or goal.color, top)
    two_tone = (goal.color_bottom or goal.color) != goal.color

    candidates: list[str] = []
    if two_tone:
        candidates += [f"{top} over {bottom}", f"{top}-{bottom} Swirl", f"Half {top} Half {bottom}",
                       f"{bottom} Below {top}", f"{top} on {bottom}"]
    non_paint = [m.type for m in seq if m.type != "paint"]
    rng.shuffle(non_paint)
    for kind in non_paint:
        for noun in TYPE_NOUNS[kind]:
            candidates.append(f"{top} {noun}")
    for noun in TYPE_NOUNS["paint"]:
        candidates.append(f"{top} {noun}")

    for title in candidates:
        if title not in used_titles:
            return title
    for suffix in ["II", "III", "IV", "V", "VI", "VII"]:
        for title in candidates:
            numbered = f"{title} {suffix}"
            if numbered not in used_titles:
                return numbered
    raise RuntimeError("title pool exhausted")


def make_hint(seq: list[Mod], palette: list[Mod], goal: State, optimal: int) -> str:
    palette_types = {m.type for m in palette}
    two_tone = (goal.color_bottom or goal.color) != goal.color
    if two_tone:
        return "Pumpkin protects the bottom colour - paint again after!"
    if goal.goggles is not None and "glasses" in palette_types:
        return "Goggles and glasses share one face. Choose wisely!"
    if goal.glasses is not None and "goggles" in palette_types:
        return "Goggles are one-shot - and Splot only has one face!"
    if goal.pumpkin == 75 and "underwear" in palette_types and not goal.underwear:
        return "A 75% pumpkin leaves no room for undies!"
    if goal.pumpkin == 75 and any(m.type == "belt" and m.variant in THICK_BELTS for m in palette):
        return "Thick belts and big pumpkins don't mix!"
    if optimal == 1:
        return "One tap does it - pick the right colour!"
    first = seq[0]
    if first.type == "paint":
        return f"Start with {COLOR_NAME[first.color].lower()} paint - {optimal} steps total!"
    return f"Order matters - solvable in {optimal} steps!"


# ── Level assembly ────────────────────────────────────────────────────────────

def generate_level(world: WorldPlan, index: int, used_goals: set, used_titles: set) -> dict:
    for attempt in range(400):
        rng = random.Random(f"{MASTER_SEED}:{world.num}:{index}:{attempt}")
        built = build_sequence(rng, world)
        if built is None:
            continue
        seq, goal = built
        if canonical(goal) in used_goals:
            continue

        decoys = build_decoys(rng, world, seq, goal)
        palette = seq + decoys
        rng.shuffle(palette)

        solution = bfs_optimal(palette, goal)
        if solution is None:
            continue
        if not (world.steps[0] <= len(solution) <= world.steps[1]):
            continue  # a decoy opened a shortcut (or goal unreachable in range)
        if not replay(palette, solution, goal):
            continue

        used_goals.add(canonical(goal))
        title = make_title(rng, seq, goal, used_titles)
        used_titles.add(title)

        return {
            "id": f"w{world.num:02d}-l{index + 1:02d}",
            "title": title,
            "difficulty": world.difficulty,
            "goal": goal,
            "palette": palette,
            "optimalSteps": len(solution),
            "optimalSolution": solution,
            "hint": make_hint(seq, palette, goal, len(solution)),
        }
    raise RuntimeError(f"could not generate level {index + 1} of world {world.num}")


# ── TypeScript emission ───────────────────────────────────────────────────────

def ts_mod(mod: Mod) -> str:
    parts = [f"id: '{mod.id}'", f"type: '{mod.type}'"]
    if mod.variant is not None:
        parts.append(f"variant: '{mod.variant}'")
    if mod.coverage is not None:
        parts.append(f"coverage: {mod.coverage}")
    if mod.color is not None:
        parts.append(f"color: '{mod.color}'")
    if mod.count is not None:
        parts.append(f"count: {mod.count}")
    return "{ " + ", ".join(parts) + " }"


def ts_goal(goal: State) -> str:
    parts = [f"color: '{goal.color}'"]
    if goal.color_bottom is not None and goal.color_bottom != goal.color:
        parts.append(f"colorBottom: '{goal.color_bottom}'")
    parts.append(f"goggles: {f_null(goal.goggles)}")
    parts.append(f"glasses: {f_null(goal.glasses)}")
    parts.append(f"belt: {f_null(goal.belt)}")
    parts.append(f"pendant: {f_null(goal.pendant)}")
    parts.append(f"pumpkin: {goal.pumpkin if goal.pumpkin is not None else 'null'}")
    parts.append(f"underwear: {'true' if goal.underwear else 'false'}")
    return "{ " + ", ".join(parts) + " }"


def f_null(value: str | None) -> str:
    return f"'{value}'" if value is not None else "null"


def emit(levels_by_world: list[list[dict]]) -> str:
    lines = [
        "// AUTO-GENERATED by scripts/generate_levels.py - DO NOT EDIT BY HAND.",
        "// Regenerate with:  python scripts/generate_levels.py",
        "import type { LevelData } from './types';",
        "",
        f"export const WORLD_COUNT = {WORLD_COUNT};",
        f"export const LEVELS_PER_WORLD = {LEVELS_PER_WORLD};",
        "",
        "export const WORLD_NAMES: readonly string[] = [",
    ]
    for world in WORLDS:
        lines.append(f"  '{world.name}',")
    lines += ["];", "", "export const CURATED_LEVELS: LevelData[] = ["]

    for world, levels in zip(WORLDS, levels_by_world):
        lines.append(f"  // ─────────── World {world.num} — {world.name} ───────────")
        for level in levels:
            lines.append("  {")
            lines.append(f"    id: '{level['id']}', title: '{level['title']}', difficulty: {level['difficulty']},")
            lines.append(f"    goalState: {ts_goal(level['goal'])},")
            lines.append("    palette: [")
            for mod in level["palette"]:
                lines.append(f"      {ts_mod(mod)},")
            lines.append("    ],")
            lines.append(f"    optimalSteps: {level['optimalSteps']},")
            solution = ", ".join(f"'{s}'" for s in level["optimalSolution"])
            lines.append(f"    optimalSolution: [{solution}],")
            hint = level["hint"].replace("'", "\\'")
            lines.append(f"    hint: '{hint}',")
            lines.append("  },")
    lines += ["];", ""]
    return "\n".join(lines)


def main() -> None:
    used_goals: set = set()
    used_titles: set[str] = set()
    levels_by_world: list[list[dict]] = []

    for world in WORLDS:
        levels = [generate_level(world, i, used_goals, used_titles) for i in range(LEVELS_PER_WORLD)]
        levels_by_world.append(levels)
        steps = [lv["optimalSteps"] for lv in levels]
        palettes = [len(lv["palette"]) for lv in levels]
        print(f"World {world.num:>2} {world.name:<15} diff {world.difficulty}  "
              f"steps {min(steps)}-{max(steps)}  palette {min(palettes)}-{max(palettes)}")

    out_path = Path(__file__).resolve().parent.parent / "src" / "shared" / "curatedLevels.ts"
    out_path.write_text(emit(levels_by_world), encoding="utf-8", newline="\n")
    total = WORLD_COUNT * LEVELS_PER_WORLD
    print(f"\nWrote {total} levels to {out_path}")
    print("\nTo ship them:")
    print("  1. npm run type-check   (sanity)")
    print("  2. npm run dev          (playtest on your dev subreddit)")
    print("  3. npm run launch       (deploy + publish)")


if __name__ == "__main__":
    main()

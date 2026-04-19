// Section colour palettes and resolution logic, shared between Dashboard
// (section editor) and TreeView (node renderer).
//
// Two shapes exist here:
//
//   SWATCH_PRESETS   — { slug: "bg-tailwind-class" }. Used by tiny circular
//                      swatches in the Dashboard colour picker where we can
//                      rely on Tailwind's JIT pass.
//
//   COLOR_PRESETS    — { slug: { bg, border, badge } }. Raw hex triples used
//                      by ReactFlow node styles, which are inline and can't
//                      go through Tailwind.
//
// Keeping both here means any new colour added for users to pick from will
// automatically flow through to node rendering without a second edit.

export const PRESET_KEYS = [
  'red', 'rose', 'pink', 'fuchsia', 'purple', 'indigo',
  'blue', 'cyan', 'teal', 'green', 'emerald',
  'yellow', 'amber', 'orange', 'gray',
]

export const SWATCH_PRESETS = {
  red:     'bg-red-400',
  rose:    'bg-rose-400',
  pink:    'bg-pink-400',
  fuchsia: 'bg-fuchsia-400',
  purple:  'bg-purple-400',
  indigo:  'bg-indigo-400',
  blue:    'bg-blue-400',
  cyan:    'bg-cyan-400',
  teal:    'bg-teal-400',
  green:   'bg-green-400',
  emerald: 'bg-emerald-400',
  yellow:  'bg-yellow-400',
  amber:   'bg-amber-400',
  orange:  'bg-orange-400',
  gray:    'bg-gray-400',
}

export const COLOR_PRESETS = {
  red:     { bg: '#fef2f2', border: '#f87171', badge: '#dc2626' },
  rose:    { bg: '#fff1f2', border: '#fb7185', badge: '#e11d48' },
  pink:    { bg: '#fdf2f8', border: '#f472b6', badge: '#db2777' },
  fuchsia: { bg: '#fdf4ff', border: '#e879f9', badge: '#c026d3' },
  purple:  { bg: '#faf5ff', border: '#c084fc', badge: '#9333ea' },
  indigo:  { bg: '#eef2ff', border: '#a5b4fc', badge: '#4f46e5' },
  blue:    { bg: '#eff6ff', border: '#93c5fd', badge: '#2563eb' },
  cyan:    { bg: '#ecfeff', border: '#67e8f9', badge: '#0891b2' },
  teal:    { bg: '#f0fdfa', border: '#5eead4', badge: '#0d9488' },
  green:   { bg: '#f0fdf4', border: '#86efac', badge: '#15803d' },
  emerald: { bg: '#ecfdf5', border: '#6ee7b7', badge: '#059669' },
  yellow:  { bg: '#fefce8', border: '#facc15', badge: '#ca8a04' },
  amber:   { bg: '#fffbeb', border: '#fcd34d', badge: '#b45309' },
  orange:  { bg: '#fff7ed', border: '#fb923c', badge: '#ea580c' },
  gray:    { bg: '#f3f4f6', border: '#d1d5db', badge: '#6b7280' },
}

export const DEFAULT_SECTION_COLOR = COLOR_PRESETS.gray

// Fallback palette for the legacy 'endo-bot' schema when a DB Section row
// exists but has no colour set. Kept in sync with migrate_v4.ENDO_SECTIONS so
// nothing visually changes after the migration runs.
export const LEGACY_SECTION_COLORS = {
  branch_a: COLOR_PRESETS.red,
  branch_a_vrvp: COLOR_PRESETS.pink,
  branch_a_egds: COLOR_PRESETS.rose,
  branch_b: COLOR_PRESETS.orange,
  branch_b_complaints: COLOR_PRESETS.yellow,
  branch_b_polyps: COLOR_PRESETS.purple,
  branch_b_vrvp: COLOR_PRESETS.fuchsia,
  branch_b_erosions: COLOR_PRESETS.red,
  branch_b_ulcers: COLOR_PRESETS.orange,
  branch_b_ere: COLOR_PRESETS.green,
  branch_b_burn: COLOR_PRESETS.red,
  branch_b_history: COLOR_PRESETS.amber,
  branch_c: COLOR_PRESETS.blue,
  overview: COLOR_PRESETS.green,
}

/**
 * Build `{slug -> {bg, border, badge}}` from a list of Section rows.
 *
 * Priority:
 *  1. DB row's `color` matches a preset key → use the preset.
 *  2. DB row's `color` looks like hex (#xxx / #xxxxxx) → use it as border
 *     and badge, with a 10 % alpha variant as background.
 *  3. Otherwise fall back to LEGACY_SECTION_COLORS (for endo-bot) → default
 *     grey.
 */
export function resolveSectionColors(sections) {
  const map = { ...LEGACY_SECTION_COLORS }
  for (const s of (sections || [])) {
    const raw = typeof s === 'string' ? null : s.color
    if (!raw) continue
    if (COLOR_PRESETS[raw]) {
      map[s.slug] = COLOR_PRESETS[raw]
    } else if (/^#[0-9a-fA-F]{3,8}$/.test(raw)) {
      map[s.slug] = { bg: raw + '1a', border: raw, badge: raw }
    }
  }
  return map
}

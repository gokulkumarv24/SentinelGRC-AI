# Design system

Derived from the `ui-ux-pro-max` recommendations for an enterprise data-dense dashboard, adjusted to the spec (§14.1: neutral base, one primary accent, clear severity indicators, no decorative gradients).

## Principles
- **Data-dense, calm.** Tables and compact cards over hero visuals. Spacing scale 4/8/12/16/24/32 px.
- **One accent.** Primary navy-blue (`--primary`). Everything else is neutral slate. The skill's suggested amber CTA colour was **not** adopted (spec: one accent).
- **Colour is never the only signal.** Severity and status chips always pair colour with a text label; severity also carries an icon. Heatmap cells print their count.
- **State is explicit.** Draft, pending review, approved, rejected and stale have distinct chips (spec §14.3).

## Tokens (`apps/web/app/globals.css`)
| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | slate-50 | slate-950 | page |
| `--card` | white | slate-900 | panels |
| `--foreground` | slate-900 | slate-50 | text (≥ 4.5:1) |
| `--muted-foreground` | slate-600 | slate-400 | secondary text (≥ 4.5:1) |
| `--primary` | blue-800 `#1E40AF` | blue-500 | primary actions, focus ring, links |
| `--severity-low/medium/high/critical` | green / amber / orange / red (700 shades on 50 tints) | 300 shades on 950 tints | severity chips, heatmap |
| `--chart-1..5` | blue, teal, violet, amber, slate | lighter equivalents | charts (distinct hues, ≥ 3:1 vs background) |

## Typography
- **Geist Sans** for UI text, **Geist Mono** for record keys (`RSK-0001`), hashes and code. Body 14px (dense tables) / 16px on mobile forms; line-height 1.5.

## Patterns
- **Layout:** collapsible left sidebar (shadcn `Sidebar` + `SidebarProvider`), top bar with organization switcher, global search (⌘K), notifications, help, profile.
- **Page:** breadcrumb → title + description → primary action → filters → content.
- **Tables:** semantic `<table>` (shadcn Table) with server-side pagination/sort/filter in the URL; sticky header; row hover; every list has loading skeleton, empty state with next action, error state with retry, permission-denied state. Mobile collapses to stacked cards.
- **Forms:** react-hook-form + Zod; labels on every input; errors below the field; submit buttons disable while pending; unsaved-changes prompt on complex forms.
- **Consequential actions** (approve, reject, close, accept, delete) open a confirmation dialog that requires a rationale.
- **Motion:** 150–200 ms colour/opacity transitions only; respects `prefers-reduced-motion`.
- **Icons:** Lucide only; icon-only buttons have `aria-label`.

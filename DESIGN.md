# SoulLedger Design System

> Inspired by [Linear's official design system](https://getdesign.md/linear.app/design-md).

## 1. Visual Theme & Atmosphere

- **Deep dark canvas** — near-pure black with subtle warmth
- **Single chromatic accent** — amber/gold (SoulLedger brand) used sparingly
- **Surface ladder** — sections lift onto surface panels, not gaps
- **No shadows** — depth expressed via surface color + hairline borders
- **Dense, technical, quietly luxurious** — reads as a professional underworld management tool

## 2. Color Palette

### Brand & Accent

| Token | Hex | Use |
|-------|-----|-----|
| `primary` | `#f59e0b` | Primary CTA, brand accent (amber) |
| `primary-hover` | `#fbbf24` | Hovered primary |
| `primary-focus` | `#d97706` | Focus ring, pressed state |
| `primary-muted` | `rgba(245,158,11,0.15)` | Badge backgrounds, subtle accents |

### Surface Ladder

| Token | Hex | Description |
|-------|-----|-------------|
| `canvas` | `#010102` | Page background (deepest dark) |
| `surface-1` | `#0f1011` | Cards, panels |
| `surface-2` | `#141516` | Featured cards, hovered states |
| `surface-3` | `#18191a` | Dropdowns, sub-navs |
| `surface-4` | `#191a1b` | Deepest lifted surface |

### Hairlines (Borders)

| Token | Hex | Use |
|-------|-----|-----|
| `hairline` | `#23252a` | Default card/panel border |
| `hairline-strong` | `#34343a` | Input focus ring, strong dividers |
| `hairline-tertiary` | `#3e3e44` | Nested surfaces |

### Text

| Token | Hex | Use |
|-------|-----|-----|
| `ink` | `#f7f8f8` | Headlines, primary text |
| `ink-muted` | `#d0d6e0` | Secondary text |
| `ink-subtle` | `#8a8f98` | Tertiary, placeholders |
| `ink-tertiary` | `#62666d` | Disabled, footnotes |

### Semantic

| Token | Hex | Use |
|-------|-----|-----|
| `success` | `#27a644` | Status: active, merit |
| `warning` | `#d97706` | Status: pending, caution |
| `error` | `#ef4444` | Status: locked, demerit, error |
| `overlay` | `rgba(0,0,0,0.8)` | Modal backdrop |

## 3. Typography

### Font Families

```css
/* Display & Body */
font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;

/* Mono */
font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
```

### Type Scale

| Token | Size | Weight | Line Height | Tracking | Use |
|-------|------|--------|-------------|----------|-----|
| `display-lg` | 32px | 600 | 1.20 | -0.6px | Page titles |
| `headline` | 22px | 600 | 1.25 | -0.4px | Section headings |
| `card-title` | 18px | 500 | 1.30 | -0.2px | Card titles |
| `body-lg` | 16px | 400 | 1.50 | 0 | Lead paragraphs |
| `body` | 14px | 400 | 1.50 | 0 | Default body |
| `body-sm` | 13px | 400 | 1.50 | 0 | Secondary body |
| `caption` | 12px | 400 | 1.40 | 0 | Meta, timestamps |
| `button` | 14px | 500 | 1.20 | 0 | Button labels |
| `eyebrow` | 12px | 500 | 1.30 | **+0.4px** | Category labels (uppercase) |

### Typography Principles

- Negative tracking on headings (-0.6px to -0.2px)
- Positive tracking on eyebrow labels (+0.4px, uppercase)
- Body: weight 400, tracking 0
- Button: weight 500, tracking 0

## 4. Component Stylings

### Buttons

**Primary (Amber)**
```css
background: #f59e0b;
color: #000;
border-radius: 8px;
padding: 8px 14px;
font-size: 14px;
font-weight: 500;
```
Hover: `#fbbf24` · Focus: `ring-2 ring-amber-500 ring-offset-2 ring-offset-[#010102]`

**Secondary (Ghost)**
```css
background: transparent;
color: #d0d6e0;
border: 1px solid #23252a;
border-radius: 8px;
```
Hover: background `#141516`

**Danger**
```css
background: #ef4444;
color: #fff;
```

### Cards & Panels

```css
background: #0f1011;
border: 1px solid #23252a;
border-radius: 12px;
padding: 24px;
```

Hover state: border-color `#34343a`

### Inputs

```css
background: #0f1011;
border: 1px solid #23252a;
border-radius: 8px;
padding: 8px 12px;
color: #f7f8f8;
font-size: 14px;
```
Focus: `border-color: #34343a; ring-2 ring-amber-500/30`

### Navigation

```css
height: 56px;
background: #010102;
border-bottom: 1px solid #23252a;
```
Fixed position, z-index 50.

### Badges / Status Pills

```css
border-radius: 9999px; /* pill */
padding: 2px 8px;
font-size: 12px;
font-weight: 500;
```

## 5. Layout & Spacing

**Base unit:** 4px

| Token | Value | Use |
|-------|-------|-----|
| `xxs` | 4px | Icon gaps |
| `xs` | 8px | Compact padding |
| `sm` | 12px | Inline elements |
| `md` | 16px | Default padding |
| `lg` | 24px | Card padding |
| `xl` | 32px | Section content |
| `section` | 48-64px | Major section rhythm |

**Max content width:** 1280px centered
**Card grid:** 3 columns → 2 → 1 (responsive)

## 6. Elevation

Linear approach — **no shadows on dark surfaces**. Depth = surface ladder + hairline borders.

| Level | Treatment |
|-------|-----------|
| Canvas | `#010102`, no border |
| Card | `#0f1011` + `border: 1px solid #23252a` |
| Dropdown | `#18191a` + `border: 1px solid #23252a` |
| Modal | `#141516` + backdrop blur |

## 7. Motion & Transitions

- Duration: 150ms (micro) / 200ms (standard) / 300ms (page)
- Easing: `cubic-bezier(0.4, 0, 0.2, 1)` (standard ease)
- Modal enter: fade + scale from 95% → 100%
- Modal leave: fade + scale from 100% → 95%
- Hover transitions: color + background only (no transforms)

## 8. Do's and Don'ts

**DO:**
- Use amber for primary CTAs only
- Express depth via surface color + hairline, never shadows
- Keep text hierarchy clear: ink (#f7f8f8) → ink-muted (#d0d6e0) → ink-subtle (#8a8f98)
- Use pill badges for status indicators
- Keep modals centered with dark overlay backdrop

**DON'T:**
- Don't mix amber with other saturated accent colors
- Don't use box-shadows for elevation on dark surfaces
- Don't use pure black (#000) for text or backgrounds — use `#010102`
- Don't use blue/purple accents — amber is SoulLedger's brand color
- Don't use border-radius > 12px on cards

## 9. Agent Quick Reference

### Tailwind Color Map

```css
/* Tailwind extend colors — add to tailwind.config.js */
colors: {
  canvas: '#010102',
  surface: {
    1: '#0f1011',
    2: '#141516',
    3: '#18191a',
    4: '#191a1b',
  },
  hairline: {
    DEFAULT: '#23252a',
    strong: '#34343a',
    tertiary: '#3e3e44',
  },
  ink: {
    DEFAULT: '#f7f8f8',
    muted: '#d0d6e0',
    subtle: '#8a8f98',
    tertiary: '#62666d',
  },
  amber: {
    DEFAULT: '#f59e0b',
    hover: '#fbbf24',
  }
}
```

### Key Tailwind Classes

```
bg-canvas        → #010102
bg-surface-1      → #0f1011
border-hairline   → #23252a
text-ink          → #f7f8f8
text-ink-muted    → #d0d6e0
text-amber        → #f59e0b
rounded-lg        → 12px
rounded-md        → 8px
```

# NightyTidy Design System

Current design tokens and patterns extracted from the codebase. This is documentation of the existing system, not a specification.

**Files**: `gui/resources/styles.css` (GUI), `src/dashboard-html.js` (dashboard inline styles)

---

## Color Palette

### CSS Custom Properties (`:root`)

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#0f0f1a` | Page background |
| `--surface` | `#1a1a2e` | Card/panel backgrounds |
| `--border` | `#2a2a3e` | Borders, dividers, scrollbar tracks |
| `--text` | `#e0e0e8` | Primary text |
| `--text-dim` | `#8888a0` | Secondary text, labels, timestamps |
| `--cyan` | `#00d4ff` | Brand/accent, primary buttons, headings, links |
| `--green` | `#22c55e` | Success/completed states |
| `--red` | `#ef4444` | Error/failed states, danger buttons |
| `--yellow` | `#eab308` | Warning/stopped states |
| `--blue` | `#3b82f6` | Running/in-progress states |

### Surface Levels (Dark-to-Light)

```
#0a0a14  -- Output panel (deepest)
#0f0f1a  -- Page background (--bg)
#1a1a2e  -- Cards, panels (--surface)
#2a2a3e  -- Borders, tracks (--border)
```

### Semantic Status Badge Backgrounds

| Status | Background | Foreground |
|--------|-----------|------------|
| Starting / Running | `#1e3a5f` | `--blue` |
| Finishing | `#1e3a5f` | `--cyan` |
| Completed | `#14532d` | `--green` |
| Stopped | `#422006` | `--yellow` |
| Error | `#450a0a` | `--red` |

### Hard-Coded Colors

| Color | Context |
|-------|---------|
| `#000` | Button text on bright backgrounds (primary, success) |
| `#fff` | Button text on danger |
| `#b0b0c0` | Monospace code text in output panels |
| `rgba(255,255,255,0.03)` | Subtle hover highlight on list items |

---

## Typography

### Font Stacks

| Usage | Stack |
|-------|-------|
| UI text | `-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif` |
| Code / paths | `'Cascadia Code', 'Fira Code', 'Consolas', monospace` |

### Type Scale

| Size | Usage |
|------|-------|
| `2.2rem` | Setup hero heading |
| `1.5rem` | Section headings (header h1, summary h2) |
| `1.4rem` | Stat card values |
| `1rem` | Body prose (setup description, finishing text) |
| `0.9rem` | Buttons, form text, step items, details |
| `0.85rem` | Subtitles, labels, secondary info |
| `0.8rem` | Small labels, step numbers, badges, code output |

### Font Weights

| Weight | Usage |
|--------|-------|
| `600` | Headings, status badges, stat values, output panel titles |
| `500` | Buttons, current step name |
| default (400) | All other text |

### Line Heights

| Value | Element |
|-------|---------|
| `1.5` | `.output-content` (monospace code) |
| `1.7` | `.summary-details` |
| default | Everything else (browser ~1.2) |

---

## Spacing

### Core Values (approximate 4px grid)

| Token | Common Uses |
|-------|-------------|
| `4px` | Badge vertical padding, small value margins |
| `8px` | Flex gaps, list padding, progress bar margins |
| `12px` | Medium gaps, output/error padding, badge horizontal padding |
| `16px` | Card padding, standard margin-bottom |
| `24px` | Body padding, header margin, button horizontal padding |
| `32px` | Hero button margin-bottom |

### Section Padding

| Section | Padding |
|---------|---------|
| Setup hero | `60px 0 40px` |
| Finishing | `80px 0` |

---

## Components

### Buttons

| Variant | Background | Text | Border | Radius | Padding |
|---------|-----------|------|--------|--------|---------|
| Primary (`.btn-primary`) | `--cyan` | `#000` | none | `6px` | `10px 24px` |
| Danger (`.btn-danger`) | `--red` | `#fff` | none | `6px` | `10px 24px` |
| Secondary (`.btn-secondary`) | transparent | `--text-dim` | `1px --border` | `6px` | `10px 24px` |
| Success (`.btn-success`) | `--green` | `#000` | none | `6px` | `10px 24px` |
| Small (`.btn-sm`) | inherits | inherits | inherits | `6px` | `6px 14px` |
| Link (`.link-btn`) | none | `--cyan` | none | none | `0` |

**States**: hover = `opacity: 0.85`, disabled = `opacity: 0.4; cursor: not-allowed`

### Cards

```css
background: var(--surface);
border: 1px solid var(--border);
border-radius: 8px;
padding: 16px;
margin-bottom: 16px;
```

### Status Badges

```css
display: inline-block;
padding: 4px 12px;
border-radius: 12px;
font-size: 0.8rem;
font-weight: 600;
text-transform: uppercase;
letter-spacing: 0.05em;
```

### Step Items

```css
display: flex;
align-items: center;
gap: 10px;
padding: 8px 10px;
border-radius: 4px;
font-size: 0.9rem;
```

Hover: `background: rgba(255,255,255,0.03)`

### Error Messages

```css
background: #450a0a;
border: 1px solid var(--red);
border-radius: 8px;
padding: 12px 16px;
color: var(--red);
font-size: 0.9rem;
```

Visibility toggled via `.visible` class (`display: none` / `display: block`).

### Progress Bar

```css
/* Track */
height: 8px;
background: var(--border);
border-radius: 4px;

/* Fill */
background: var(--cyan);
border-radius: 4px;
transition: width 0.5s ease;
```

### Spinners

```css
/* Small (14px) */
width: 14px; height: 14px;
border: 2px solid var(--border);
border-top-color: var(--blue);
border-radius: 50%;
animation: spin 0.8s linear infinite;

/* Big (40px) */
width: 40px; height: 40px;
border: 3px solid var(--border);
border-top-color: var(--cyan);
```

---

## Animations

| Name | Duration | Easing | Usage |
|------|----------|--------|-------|
| `spin` | `0.8s` | `linear` | Loading spinners |
| `pulse` | `1.5s` | `ease-in-out` | Active step name |

## Transitions

| Property | Duration | Easing | Elements |
|----------|----------|--------|----------|
| `opacity` | `0.2s` | default | Buttons |
| `width` | `0.5s` | `ease` | Progress bar fill |

---

## Interaction States

| State | Treatment |
|-------|-----------|
| Hover (buttons) | `opacity: 0.85` |
| Hover (secondary btn) | `border-color: var(--text-dim)` |
| Hover (list items) | `background: rgba(255,255,255,0.03)` |
| Hover (link-btn) | `opacity: 0.8` |
| Focus-visible | `outline: 2px solid var(--cyan); outline-offset: 2px` |
| Disabled | `opacity: 0.4; cursor: not-allowed` |
| Active/Pressed | Not defined (potential improvement) |

---

## Scrollbar

```css
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--text-dim); }
```

---

## Layout

- **No max-width** on content -- relies on Chrome `--app` mode at `900x700`
- **Body padding**: `24px` on all sides
- **Screen switching**: `display: none` / `display: block` via `.screen.active`
- **No media queries** -- desktop-only app
- **Flex-wrap** on `.steps-header` and `.options-bar` for narrow-window graceful degradation

---

## File Ownership

| File | Scope |
|------|-------|
| `gui/resources/styles.css` | GUI styles (5 screens) |
| `src/dashboard-html.js` | Dashboard styles (inline, standalone template) |

Both files declare the same `:root` CSS variables independently. This is intentional -- the dashboard is served as a standalone HTML document, not part of the GUI app.

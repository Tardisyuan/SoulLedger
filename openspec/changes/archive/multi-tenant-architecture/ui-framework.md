# UI Framework Features — SoulLedger

> Optional UI enhancement features for SoulLedger. These features improve user experience but are not required for core business functionality.

---

## 1. Theme System

### 1.1 Overview

The theme system provides consistent visual styling across the application with support for light/dark/system themes.

**Current Implementation:**
- Light/Dark toggle via Tailwind `dark:` classes
- Theme preference stored in cookie

**Enhanced Features:**
- ThemeProvider context wrapping entire app
- System preference detection via `prefers-color-scheme`
- Persistent theme storage in localStorage
- Theme switcher in settings drawer

### 1.2 ThemeProvider Interface

```typescript
// frontend/contexts/ThemeContext.tsx

interface ThemeContextType {
  theme: 'light' | 'dark' | 'system';
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
}

// Usage
const { theme, resolvedTheme, setTheme } = useTheme();
```

### 1.3 Implementation Details

| Feature | Description |
|---------|-------------|
| System Detection | Listen to `window.matchMedia('(prefers-color-scheme: dark)')` |
| Persistence | Store in `localStorage.theme` |
| SSR Safety | Default to 'system' before hydration |
| Tailwind Integration | Add `dark:` class to `<html>` element |

---

## 2. Theme Color System

### 2.1 Color Presets

| Preset | Name | Hex | Usage |
|--------|------|-----|-------|
| Amber (default) | 地府金 | `#F59E0B` | Chinese Diyu theme |
| Crimson | 血红色 | `#DC2626` | European Hell theme |
| Jade | 玉绿 | `#059669` | Egyptian theme |
| Lapis | 石青蓝 | `#2563EB` | Alternative blue |
| Obsidian | 黑曜石黑 | `#1F2937` | Dark accent |
| Custom | 自定义 | User input | User-defined hex |

### 2.2 CSS Variable Implementation

```css
/* In globals.css or Tailwind config */
:root {
  --color-accent: #F59E0B;
  --color-accent-hover: #D97706;
}

[data-theme-color="crimson"] {
  --color-accent: #DC2626;
  --color-accent-hover: #B91C1C;
}

/* Usage in components */
.btn-primary {
  background-color: var(--color-accent);
}
.btn-primary:hover {
  background-color: var(--color-accent-hover);
}
```

### 2.3 Color Picker Component

```typescript
// frontend/components/ColorPicker.tsx

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
}

// 6 preset buttons + custom hex input
// Selected state shows checkmark overlay
```

---

## 3. Settings Drawer

### 3.1 Overview

Slide-in drawer from the right side of the screen (not a full page navigation) for quick access to user preferences.

### 3.2 Drawer Structure

```
┌─────────────────────────────────────────┐
│  ⚙️ 设置                    [×]          │
├─────────────────────────────────────────┤
│  Language                      [zh-Hans▾]│
│  Theme                         [System▾] │
│  Accent Color         [●Amber ▾]        │
│  ─────────────────────────────────────  │
│  Compact Mode                    [○/●]   │
│  Show Quick Actions              [●/○]   │
└─────────────────────────────────────────┘
```

### 3.3 Settings Schema

| Setting | Type | Default | Storage |
|---------|------|---------|---------|
| language | `zh-Hans` \| `en` \| `egy` | `zh-Hans` | localStorage |
| theme | `light` \| `dark` \| `system` | `system` | localStorage |
| accentColor | string | `Amber` | localStorage |
| compactMode | boolean | `false` | localStorage |
| showQuickActions | boolean | `true` | localStorage |

### 3.4 Implementation

```typescript
// frontend/components/SettingsDrawer.tsx

interface SettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

// Slide-in animation using CSS transforms
// Click outside or X button to close
// Changes apply immediately (no save button)
```

---

## 4. Personal Center

### 4.1 Route

`/{tenant}/profile/` or `/profile/`

### 4.2 Page Sections

#### 4.2.1 Profile Info

| Field | Description |
|-------|-------------|
| Username | Login username (read-only) |
| Display Name | User's display name |
| Role | Current role (TENANT_ADMIN/JUDGE/etc.) |
| Tenant | Current tenant name and code |
| Member Since | Account creation date |

#### 4.2.2 Change Password

```
┌─────────────────────────────────────────┐
│ 修改密码                                  │
├─────────────────────────────────────────┤
│ 当前密码           [••••••••••]          │
│ 新密码             [••••••••••]          │
│ 确认新密码         [••••••••••]          │
│                                         │
│            [确认修改]                     │
└─────────────────────────────────────────┘
```

#### 4.2.3 Notification Preferences

| Setting | Type | Default |
|---------|------|---------|
| Email notifications | Toggle | On |
| Dispatch alerts | Toggle | On |
| Judgment reminders | Toggle | Off |

#### 4.2.4 Appearance Settings

Quick link to open Settings Drawer.

#### 4.2.5 Activity History

Recent actions performed by the user:

| Timestamp | Action | Details |
|-----------|--------|---------|
| 2026-05-09 10:30 | Soul judged | 张三 → FAILED |
| 2026-05-09 09:15 | Dispatch proposed | 张三 → EU_HEAVEN_HELL |
| 2026-05-08 16:45 | Karma record added | 张三 +10 merit |

---

## 5. Navigation Modes

### 5.1 Classic Menu

- Traditional sidebar with icons + text labels
- Always expanded (full width ~240px)
- All menu items visible at once

```
┌──────────────────────────────────┐
│ 🏠 首页                           │
│ 👻 灵魂列表                        │
│ 🗺️ 地域                           │
│ 👤 角色                           │
│ 📤 外派                           │
│ ⚖️ 联合审判                        │
└──────────────────────────────────┘
```

### 5.2 Compact Menu

- Icon-only sidebar
- Sidebar width ~64px
- Tooltip on hover showing full label
- Click or hover to expand submenu

```
┌────┐
│ 🏠 │
│ 👻 │
│ 🗺️ │
│ 👤 │
│ 📤 │
│ ⚖️ │
└────┘
```

### 5.3 Implementation

```typescript
// frontend/hooks/useNavMode.ts

type NavMode = 'classic' | 'compact';

interface NavModeContext {
  mode: NavMode;
  setMode: (mode: NavMode) => void;
  isExpanded: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}
```

### 5.4 NavBar Consistency

Both modes maintain:
- Tenant context always visible in NavBar header
- Current user info + role display
- Logout button
- Settings drawer trigger

---

## 6. Implementation Order

Recommended implementation sequence:

1. **ThemeProvider** — Foundation for other UI features
2. **Settings Drawer** — Central place for all preferences
3. **Theme Color Picker** — Integrates with Settings Drawer
4. **Personal Center** — Depends on Settings Drawer
5. **Navigation Modes** — Can be implemented independently

---

## 7. File Structure

```
frontend/
├── app/
│   └── [tenant]/
│       └── profile/
│           └── page.tsx          # Personal center
├── components/
│   ├── NavBar.tsx                # Updated with nav mode
│   ├── SettingsDrawer.tsx       # New
│   ├── ColorPicker.tsx          # New
│   └── ThemeSwitcher.tsx        # New
├── contexts/
│   ├── ThemeContext.tsx          # New
│   └── NavModeContext.tsx        # New
├── hooks/
│   ├── useTheme.ts               # New
│   └── useNavMode.ts             # New
└── styles/
    └── globals.css               # Update with CSS variables
```

---

## 8. Testing Checklist

- [ ] Theme changes persist across page reloads
- [ ] System theme preference is detected correctly
- [ ] All 6 color presets apply correctly
- [ ] Settings drawer opens/closes smoothly
- [ ] Settings persist in localStorage
- [ ] Personal center loads user data correctly
- [ ] Password change form validates correctly
- [ ] Navigation mode switches between classic/compact
- [ ] Compact mode tooltips show on hover
- [ ] Tenant context visible in both nav modes

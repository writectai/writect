# WriteAI Website Color Guide

Developer-ready color system based on the selected direction: a clean white website with deep navy typography and controlled pink, magenta, maroon and purple brand accents.

**Primary Brand Gradient:** `#F21862` → `#D20A72` → `#6B0FB3`

---

## 1. Main Brand Palette

| Color | HEX | Use it for |
|---|---|---|
| Deep Navy | `#0B1F44` | Main headings, navigation text, footer, strong contrast |
| Brand Pink | `#F21862` | Primary CTA start color, links, small highlights |
| Magenta | `#D20A72` | Active states, AI accents, icons, selected items |
| Royal Purple | `#6B0FB3` | CTA gradient end, premium/AI accents |
| Deep Maroon | `#7A174E` | Secondary brand accent; use sparingly |
| Soft Pink | `#FFF1F6` | Badges, light highlighted backgrounds |
| Soft Purple | `#F7F0FC` | Feature/icon backgrounds and subtle sections |
| White | `#FFFFFF` | Main website and card background |
| Body Gray | `#526581` | Paragraphs and secondary information |
| Border Gray | `#E9E7EF` | Borders, dividers, input outlines |

---

## 2. Simple Rule for the Whole Website

Keep the website mostly white. The brand colors should attract attention, not cover the entire page. A practical balance is roughly **70% white/neutral, 20% navy/text, and 10% pink-magenta-purple accents**. Do not give normal sections a strong pink or purple background.

| ✅ DO | ❌ AVOID |
|---|---|
| White page background | Purple background on every section |
| Navy headings | Pink body text |
| Brand gradient on important CTAs | Different gradient on every button |
| Soft tinted backgrounds only for small highlights | Too many bright colors together |

---

## 3. Exactly Where to Apply Each Color

### A. Global Page Background

| Element | Color | Developer instruction |
|---|---|---|
| Main page background | `#FFFFFF` | Use white throughout the landing page. |
| Alternate/subtle section | `#F8F9FC` | Only when separation between sections is needed. |
| Section border/divider | `#E9E7EF` | Thin 1px divider; avoid dark borders. |

### B. Header / Navigation

| Element | Color | Developer instruction |
|---|---|---|
| Header background | `#FFFFFF` | Clean white; sticky header may use a very light shadow. |
| Logo | Brand artwork | Use the final WriteAI brand logo. |
| Menu text | `#0B1F44` | Normal navigation labels. |
| Active/hover menu | `#D20A72` | Use magenta for active or hover state. |
| Header CTA | `#F21862` → `#6B0FB3` | Pink-to-purple gradient with white text. |

### C. Hero Section

| Element | Color | Developer instruction |
|---|---|---|
| Hero background | `#FFFFFF` | Do not use a colored full-width background. |
| Main heading | `#0B1F44` | Primary headline color. |
| Highlighted headline words | `#D20A72` or gradient | Use only on important words such as "with AI". |
| Paragraph | `#526581` | Easy-to-read secondary text. |
| Primary CTA | `#F21862` → `#6B0FB3` | Main conversion button. |
| Secondary CTA | `#6B0FB3` | Text/icon; white or transparent button background. |
| Small AI badge | `#FFF1F6` | Pink tint background; magenta text. |

### D. Feature Cards / AI Tools

| Element | Color | Developer instruction |
|---|---|---|
| Card background | `#FFFFFF` | Keep cards white. |
| Card border | `#E9E7EF` | 1px subtle border. |
| Card heading | `#0B1F44` | Consistent with main typography. |
| Icon background | `#FFF1F6` / `#F7F0FC` | Alternate soft pink and soft purple. |
| Icon color | `#D20A72` / `#6B0FB3` | Use brand accent colors. |
| Hover state | `#FFF1F6` | Very subtle pink tint; no strong solid fill. |

### E. Forms / AI Input Area

| Element | Color | Developer instruction |
|---|---|---|
| Input background | `#FFFFFF` | White fields. |
| Input border | `#E9E7EF` | Default 1px border. |
| Focused input | `#D20A72` | Use magenta border/ring on focus. |
| Placeholder | `#8A96A8` | Keep lower contrast than typed text. |
| Submit/Generate button | `#F21862` → `#6B0FB3` | Use the primary gradient. |

### F. Pricing / Conversion Sections

| Element | Color | Developer instruction |
|---|---|---|
| Normal pricing cards | `#FFFFFF` | White card with subtle border. |
| Recommended plan | `#FFFFFF` | Keep white; emphasize with magenta/purple top border or badge. |
| Popular badge | `#D20A72` | White text on magenta. |
| Price | `#0B1F44` | Strong navy. |
| Purchase CTA | `#F21862` → `#6B0FB3` | Same primary CTA everywhere. |

### G. Footer

| Element | Color | Developer instruction |
|---|---|---|
| Footer background | `#0B1F44` | Use deep navy for a premium finish. |
| Footer headings | `#FFFFFF` | Strong contrast. |
| Footer body/links | `#DCE4F1` | Soft light text. |
| Footer link hover | `#F21862` | Brand pink. |

---

## 4. Button & Gradient Rules

Use one main gradient consistently across the website: `#F21862` → `#D20A72` → `#6B0FB3`. It should appear mainly on the primary CTA, selected AI actions, and occasional brand highlights. Do not use the gradient for paragraph text or large page backgrounds.

| State | Recommended styling |
|---|---|
| Primary | Gradient `#F21862` → `#6B0FB3`; white text; rounded corners. |
| Primary hover | Slightly darker gradient: `#D20A72` → `#5A0A99`. |
| Secondary | White background; `#6B0FB3` text; `#E9E7EF` border. |
| Text link | `#D20A72` default; `#6B0FB3` on hover. |
| Disabled | `#EEF0F4` background; `#98A2B3` text. |

---

## 5. Status Colors

Functional colors should stay familiar to users. Use green for success, amber for warnings, and red for errors. Do not replace these with brand pink/purple.

| Status | HEX | Use for |
|---|---|---|
| Success | `#159A6A` | Completed, saved, successful generation |
| Warning | `#E59A13` | Usage warning, attention needed |
| Error | `#D92D20` | Validation errors, failed actions |

---

## 6. Developer Color Tokens

```css
--color-primary-pink:    #F21862;
--color-primary-magenta: #D20A72;
--color-primary-purple:  #6B0FB3;
--color-accent-maroon:   #7A174E;
--color-heading:         #0B1F44;
--color-body:            #526581;
--color-background:      #FFFFFF;
--color-section-soft:    #F8F9FC;
--color-soft-pink:       #FFF1F6;
--color-soft-purple:     #F7F0FC;
--color-border:          #E9E7EF;
--color-success:         #159A6A;
--color-warning:         #E59A13;
--color-error:           #D92D20;
```

---

## Final Direction

Overall look: clean, premium and brandable. Keep white as the dominant background, deep navy for readability, and use the pink-magenta-purple family as a controlled signature. Maroon should be a supporting accent only, not the main CTA color. The same color logic should be used on the landing page, login/signup, dashboard, pricing, forms and future marketing pages.

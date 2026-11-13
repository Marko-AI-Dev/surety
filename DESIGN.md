# DESIGN.md: Surety's design system

This describes the design system the code uses today. The earlier direction documents (`docs/design/ui-direction.md`, the drafts beside it) are history: they describe a railway board and a depth deck that were not kept.

## The idea

A calm room with glass in it. A few large frosted surfaces float over a soft background; everything inside them is a solid, lightly tinted well. Money is shown large, in tabular figures. Four colours carry fixed meanings and are used for nothing else. The screen should stay readable under scrutiny: a judge or an auditor must be able to follow a deal without asking.

Marko's standing brief: elegant, minimal, glass. Calm and simple before clever. Restructure before restyle.

## Tokens

Every colour is a custom property on `:root` in `apps/web/src/styles.css`, with the dark values under `:root[data-theme="dark"]`. Never write a raw colour in a screen; use a token.

| Token | Meaning |
|---|---|
| `--money`, `--money-ink` | Blue. Money in motion: a locked payment, a price, the Lead's pick. |
| `--ok` | Green. A validated ledger result, or a check that passed. |
| `--held` | Amber. Held, waiting, or needs the buyer. |
| `--stop` | Red. Stopped, refused, removed. |
| `--yellow-card`, `--red-card` | The bouncer's cards only. |
| `--text`, `--muted` | Body text and secondary text. `--muted` is the lightest text allowed on glass. |
| `--primary`, `--primary-ink` | The one primary action on a screen, and the text on it. |
| `--ours`, `--ours-text` | The buyer's own side of a conversation. |
| `--glass`, `--glass-solid`, `--glass-edge`, `--glass-lip`, `--glass-shadow`, `--blur` | The floating surfaces. `--glass-solid` is the opaque version, used where blur is off or text needs a solid ground. |
| `--surface`, `--surface-2`, `--bg`, `--line` | Wells inside the glass, the page tint, and hairlines. |
| `--ground`, `--ambient`, `--photo-veil` | The page background, its light, and the veil over the background photo. The veil is kept high so text on the page holds AA contrast whatever the photo shows. |
| `--focus` | The keyboard focus ring. |
| `--sans`, `--mono` | System UI sans for everything; IBM Plex Mono for hashes, references and document numbers. |
| `--r` | The corner radius (14px). `--glide` is the one easing curve. |

## Themes and motion

- Light is the default, whatever the device prefers. Dark is a choice, stored in the browser. The theme is `data-theme` on `<html>`.
- `data-flat` and `data-solid` on `<html>` switch off the 3D layout and the blur. Reduced motion always gets solid panels and no movement that carries meaning.
- Motion is short and purposeful. Nothing loops except a "writing" indicator, and that stands still under reduced motion.

## The UI kit

- New UI is built from `apps/web/src/components/ui` (shadcn/ui on Tailwind 4): button, textarea, sheet, dialog, switch, badge. Add components by hand in shadcn's shape: the shadcn CLI adds an unrelated package (`cn`) when run in this repo. Add a building block there before using it in a screen.
- `apps/web/src/app.css` is the one stylesheet entry. It maps shadcn's colour names onto the tokens above (`bg-primary` is `--primary`, `text-muted-foreground` is `--muted`, `border` is `--line`, `bg-card` is `--glass`, and `bg-ok`, `bg-held`, `bg-stop`, `bg-money`, `bg-ours` for the meaning colours), so a kit component follows both themes without extra work.
- Tailwind's reset is left out on purpose: it would restyle the older screens. The few resets the kit needs apply only inside an element with the class `tw`. A screen built from the kit puts `tw` on its root, and on any panel that renders outside it (a sheet).
- The older screens are styled by `apps/web/src/styles.css`, which sits in its own cascade layer below Tailwind's utilities. They move to the kit one at a time.
- One class name exists in both worlds: `grid`. Both set `display: grid`. Do not use the bare `grid` utility in a kit screen; use flex, or a `grid-cols-*` utility on a differently named element.

## Layout

- The buyer has one screen: a chat with their agent (`apps/web/src/views/Chat.tsx`). The text box is fixed at the bottom and is never removed. What happens arrives as a message. A supplier's conversation opens in a side panel; on a phone the panel is the full screen.
- On a wide screen a menu runs down the left (`apps/web/src/components/SideNav.tsx`): related items sit under a label and each has an icon. The deal sits to the right of the chat as six steps in the order they happen, with only the current one open. Below 1024px the menu gives way to the bar across the top; below 1280px the deal steps give way to the supplier chips.
- Secondary content folds away (accordions) and the order on screen follows the order things happen in.
- A main button may change its words on hover to what pressing it gets you. Nothing else on a button moves, and it stands still under reduced motion.
- Everything technical lives under Admin. The supplier's and the inspector's phone pages keep their own links.
- A container holds everything it shows. Avoid a scrolling area inside a scrolling page; the chat feed is the one deliberate exception, and it fills the screen so the page itself does not scroll.
- Works from 390px wide. Touch targets are at least 44px.

## Words on screen

- Plain and calm, for a business owner with no technical background. Short sentences. No jargon without an explanation.
- One primary action per screen. A disabled button says why.
- The user-facing word is "Deal". The decision model's vendor is never named.
- Anything simulated, recorded or not yet real says so where it appears ("Test network. No real money.", "Not tracked on the test network yet", "Coming soon").
- A held message is shown as held, with its card and the reason in plain words, never with its text.
- Money is written in full with the currency sign and two decimals, and thousands separators.

## Accessibility

WCAG 2.1 AA contrast in both themes, full keyboard operation with a visible focus ring, labels on every control, live regions for status that changes, and the reduced-motion fallback above. Not yet checked by an automated test or a screen reader.

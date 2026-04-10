Airbnb.com — Visual & UX Design Description
Overall Aesthetic
Clean, minimalist, and warm. White and light gray dominate the background, with a signature coral/rose-red (#FF385C) as the primary brand accent. Typography is rounded and friendly (Airbnb uses its own "Cereal" typeface — you can substitute Inter or Plus Jakarta Sans for a similar feel). Generous whitespace throughout. No clutter. Every element earns its place.

Header / Navigation Bar
Sticky white bar with a subtle bottom shadow on scroll.
Left: Logo (wordmark + icon).
Center: A pill-shaped search bar with three inline fields — Where, Check-in, Check-out, Guests — separated by thin vertical dividers. A red/coral circular search button on the right end of the pill.
Right: globe icon for language/currency + a pill-shaped button with a hamburger menu and user avatar/icon.
On scroll, the search bar collapses into a compact single-line version.

Hero / Search Section
No full-bleed hero image. The search bar is the hero — centered, prominent, above the fold.

Property Grid (Listings)
Responsive CSS grid: 4 columns on desktop, 2 on tablet, 1 on mobile.
Each listing card:

Below the image: bold location/title, subtle gray star rating + review count, date range available, and price per night in bold with "/night" in regular weight.

Trust & Security Signals
"Airbnb it with confidence" section — three icon+text blocks: Dedicated support, Damage protection, Verified listings.
Guest reviews with star ratings are highly visible on every card.
Secure payment badge language ("You won't be charged yet") on the booking summary panel.
Profile photos and host response rates visible on listing pages.
SSL padlock is assumed — no extra callout needed because the design itself radiates credibility.

Booking Panel (Listing Detail Page)
Sticky right-side panel (desktop) / bottom sheet (mobile).
White card with a soft box-shadow.
Price per night at the top in large bold text.
Date picker (inline calendar, dual-month view) + guest selector dropdown.
A large, full-width coral "Reserve" CTA button.
Below the button: "You won't be charged yet" in small gray text — reduces friction.
Price breakdown (room rate × nights, cleaning fee, taxes) in a subtle line-item list with a divider and bold total.

Footer
Multi-column link grid on a light gray background.
Columns: Support, Hosting, Airbnb, Destinations.
Bottom bar: copyright, language/currency selector, social icons.
Muted, never distracting.

Motion & Interaction

Smooth ease-out transitions (~200ms) on hover states.
Image carousels use translate for smooth swipes.
Modals and panels slide/fade in (not abrupt).
Skeleton loading screens (gray shimmer placeholders) while content loads — prevents jarring layout shifts and signals a polished product.

Mobile Experience

Full bottom-sheet date picker.
Sticky bottom bar with price + Reserve button.
Tap targets minimum 44px.
Search bar collapses into a compact rounded pill.

Color & Type System Reference
TokenValue

Primary accent #FF385C (coral red)
Text primary #222222
Text secondary #717171
Background #FFFFFF
Surface/card bg #F7F7F7
Border/divider #EBEBEB
Font (substitute) Inter, Plus Jakarta Sans
Border radius (cards) 12px
Border radius (buttons) 8px or fully rounded 9999px

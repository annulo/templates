# Unified social authorization dialog — design QA

final result: passed

Selected visual truth: /Users/liaomeirong/.codex/generated_images/01a20cb6-88f0-7f72-afec-698ad67a9fbf/exec-f11f3f00-1936-42e7-8c2b-97e035e9c7fc.png (1487 × 1058).
Implementation screenshot: /Users/liaomeirong/.gerdr/screenshots/gerdr-browser-1795670180412.png (1440 × 1024).
Browser viewport: 1440 × 1024 CSS px, screenshot density 1. Source aspect ratio normalized conceptually to this viewport (scale 1440/1487); the implementation dialog is 560 CSS px wide. State: Instagram, authorization saved, one account preselected, awaiting explicit confirmation.

## Comparison and fixes

The source and implementation images were opened together in the same comparison input, with legible full-size modal content. No additional crop was needed to read headings, account details, controls and footer. The app background is a reference screenshot for context; the dialog, selectors, validation and buttons are the real template components, with mocked IO and demo accounts. This does not claim a new real Meta authorization was completed.

Initial comparison (/Users/liaomeirong/.gerdr/screenshots/gerdr-browser-1795668562409.png) found [P2] the modal centered across navigation and content, rather than in the content region, and [P2] footer copy was not the selected design's short Back label. Fixed desktop offset, 560px width and shared translated Back text. The harness now uses assembled template translations and the actual app color tokens. Revised comparison (/Users/liaomeirong/.gerdr/screenshots/gerdr-browser-1795670180412.png) has no actionable P0/P1/P2 issue.

## Fidelity surfaces

- Typography: existing Inter/system/PingFang stack; 18px section headings, 14px controls and 12px metadata preserve the product hierarchy and readable Chinese/English text.
- Layout: centered native dialog in content region, 24px padding, 16px corners, consistent three-step header, platform tabs, account row, collapsed hosting section and footer. Native viewport centering is retained vertically; long lists scroll while footer stays visible.
- Colors: sampled existing oklch primary, border, background, muted and text tokens; green authorization status and blue selected controls match the concept.
- Assets: existing supplied Instagram/Threads/Facebook brand components and existing Lucide UI icons. The sample account has no avatar from metadata, so it truthfully uses the platform mark rather than inventing a brand avatar.
- Copy: shared Chinese/English labels, explicit project scope, no token inputs or beta labels. Type-specific captions clarify professional accounts versus Pages.

## Interactions and limits

Verified in the browser: three platform tabs; each platform's explicit Add action; multiple Facebook Pages with disabled empty selection and correct selected IDs; initial authorization and restored callback; callback reload without automatic writes; canceled authorization without success or writes; unavailable and failed connection reads; add-dialog entry and two-step Back navigation; management entry, disabled unrelated platform tabs, reconnection, save and disconnect confirmation. 390 × 844 English layout has no horizontal overflow and retains footer buttons. Browser console has no errors.

Pure model/return/disconnect tests and creator/product/trade typechecks pass. IO is simulated for browser behavior; no real posts, revocations, or user-project upgrades were performed.

## Follow-up polish

P3: the live runtime may place the vertically centered modal slightly differently from ImageGen's illustrative frame. Real account names, resource counts and avatars determine content height. These are data/runtime differences, not hidden controls or clipped content.

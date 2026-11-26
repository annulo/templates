# Unified social authorization dialog — design QA

## 2026-11-26 automatic project binding update

The latest user request supersedes the confirmation and platform-tab behavior described below. Platform selection now appears only at the add-account entry. Official authorization returns directly to automatic binding of the exact returned grant's authorized assets; the dialog closes and the current project refreshes. Reconnecting a target stays scoped to that target. Manual reuse and account management retain their asset controls.

Verified with the actual components and mocked provider IO: Instagram and Threads authorization-to-add; Facebook three-Page and Instagram two-asset auto-add; cancelled authorization performs no writes; a failed bind shows Retry adding and succeeds after retry; a real second browser tab notifies the initiating tab to close its dialog, with one Page binding call. Browser console is clear. The final English 390 × 844 viewport has no modal overflow: /Users/liaomeirong/.gerdr/screenshots/gerdr-browser-1795676369852.png. This run did not perform a new real Meta authorization or modify the user's project.

Type checking passes for creator/product/trade. All 27 authorization request, return, automatic binding, selection and disconnect tests pass, including strict returned identity, missing/expired/cancelled grants, target isolation, duplicate/retry handling and initiating-tab completion notification.


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

## 2026-11-26 — Threads carousels and asset menu bounds

- Threads rules come from Meta's official posts guide (https://developers.facebook.com/documentation/threads/posts/): up to 20 images/videos in order. Templates require social 0.15.0; the platform logic lives in the plugin.
- Isolated product/creator/trade copies received the working source through `publish.py --local`, with no conflicts. No actual user project was upgraded or posted from.
- Targeted plugin suite: 88 passed (Threads, Instagram managed/direct, Facebook publishing, shared content). Template prepare/content/authorization suite: 8 passed. Creator/product/trade type checks passed.
- Browser QA used the actual Select component and authorization dialog with mocked accounts/sites. At 1440×1024 and 390×844, a 17-option menu remains within dialog bounds, has no horizontal overflow, scrolls internally and selects Talizen. Escape closes the menu while preserving the dialog; console has no errors. Desktop screenshot: /Users/liaomeirong/.gerdr/screenshots/gerdr-browser-1795686522147.png; mobile: /Users/liaomeirong/.gerdr/screenshots/gerdr-browser-1795686470874.png.
- Broader optional test discovery encountered absent Playwright/esbuild module dependencies in unrelated browser suites. The pre-existing Instagram prepare test still expects API scheduling to be rejected, although current code supports it; an isolated HEAD baseline reproduces that failure (`/private/tmp/instagram-prepare-baseline.log`). That test and scheduling behavior were left unchanged. No live social posts were submitted in this verification.

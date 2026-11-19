# Instagram API in account management and content publishing

Shared by product, creator and the private trade template through core. The product edition includes Instagram in its channel list; creator already includes it. Requires the matching social plugin implementation and Annulo API 59 or later with a local work folder.

`InstagramAccountFlow` offers API and browser connections. API credentials use `setSecret` with `INSTAGRAM_USER_TOKEN_<Instagram Login user ID>`; local function parameters and business tables never contain the token. Account checks validate ID and handle, preserving an existing browser account row. The management dialog accepts replacement tokens; automatic refresh and OAuth for third-party accounts are outside this implementation.

API accounts publish one JPEG immediately. Local images use the selected Creght site's media library through the locally signed-in CLI; public HTTPS JPEGs can be used without that host. Multi-image, video and scheduling are rejected by the plugin. The publish dialog excludes blocked accounts from submitted selections, including when switching from immediate publishing to scheduling. Legacy scheduled API records can be returned to approved status.

The normal content-center `publish.prepare` → `social/social.publish` route writes media ID and permalink to its publication record. A receipt saved before submission and a local atomic claim prevent repeated publication after lost responses or database failures. Unresolved attempts expose **Check publishing result**, with no resend or delete-record shortcut. `publish.prepare` refuses to overwrite an unresolved attempt with edited content. Recovery reads the original receipt and never infers success from matching captions.

API collection and remote deletion are unavailable; the UI hides those actions. The standalone diagnostics remain in `social/instagram_test.*`. `social/instagram.preparePublication` creates an unpublished image container for acceptance checks.

Validation: `npm run check -- product creator`; plugin Instagram and Facebook regression tests. Local UI verification uses the product project; the private trade template and Windows upload script require separate environment validation before release. No template/plugin release is implied by applying changes to one local project.

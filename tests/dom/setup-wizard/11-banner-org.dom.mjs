// Spec 08 "UI" (showManagedBanner()), on the setup-wizard page, with _org_name: see
// helpers/dom-banner.mjs.

import { bannerScenario } from '../../helpers/dom-banner.mjs';

await bannerScenario('setup-wizard', 'ACME Corp');

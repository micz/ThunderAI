// Spec 08 "UI" (showManagedBanner()), on the options page, with _org_name: see
// helpers/dom-banner.mjs.

import { bannerScenario } from '../../helpers/dom-banner.mjs';

await bannerScenario('options', 'ACME Corp');

import { defineLayoutSuite } from "./suite";

// One spec file per group of screens, so the groups spread over the workers.
defineLayoutSuite(["ipad-upright", "ipad-small-upright", "ipad-split", "odd-980"]);

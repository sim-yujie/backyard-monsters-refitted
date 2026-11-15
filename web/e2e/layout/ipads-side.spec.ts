import { defineLayoutSuite } from "./suite";

// One spec file per group of screens, so the groups spread over the workers.
defineLayoutSuite(["ipad-side-bars", "ipad-side-short", "ipad-pro-side"]);

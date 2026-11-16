import { defineLayoutSuite } from "./suite";

// One spec file per group of screens, so the groups spread over the workers.
defineLayoutSuite(["desktop", "desktop-large"]);

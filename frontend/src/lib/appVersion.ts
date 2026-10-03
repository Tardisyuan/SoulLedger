import pkg from "@/package.json";

/**
 * The version printed in the login page's bottom row and the welcome page's footer (A9). From
 * frontend/package.json — /welcome used to print a literal "v0.1" that nothing kept in step.
 */
export const APP_VERSION = `v${pkg.version}`;

/**
 * Backward-compatible re-export from lib/api/ modules.
 *
 * All imports from "@/lib/api" continue to work.
 * New code should import from "@/lib/api/client" or specific domain modules.
 */
export * from "./api/index";

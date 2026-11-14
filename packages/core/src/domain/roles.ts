/** The role whose every cell is 「始终」: `check_permission` answers yes before reading a grant, so the matrix cannot untick it. */
export const ADMIN_ROLE_NAME = "ADMIN";
/**
 * 系统管理员(分殿第 1A 阶段):看全部文明,由系统建,用户管理里不给分配。无殿的 `ADMIN` 从此只管本文明。
 * 它过每一道 ADMIN 的门 —— 角色判断一律走 `isAdminRole`,别再写 `role === "ADMIN"`。
 */
export const SYSTEM_ADMIN_ROLE_NAME = "SYSTEM_ADMIN";
/** ADMIN 或 SYSTEM_ADMIN:凡是「管理员才行」的门都问它。 */
export const isAdminRole = (role: string | null | undefined): boolean => role === ADMIN_ROLE_NAME || role === SYSTEM_ADMIN_ROLE_NAME;
/** 只有系统管理员:跨文明的事(后端 `is_tenant_exempt` 只认它)。 */
export const isSystemAdminRole = (role: string | null | undefined): boolean => role === SYSTEM_ADMIN_ROLE_NAME;

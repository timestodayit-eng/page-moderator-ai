/**
 * Permission catalogue and default role templates.
 * Server-side enforcement lives in src/server/rbac/guard.ts — hiding UI buttons is never the security boundary.
 */
export const PERMISSIONS = {
  "dashboard.view": { group: "General", description: "View dashboard" },
  "pages.manage": { group: "Facebook Pages", description: "Connect and configure Facebook Pages" },
  "pages.disconnect": { group: "Facebook Pages", description: "Disconnect Facebook Pages" },
  "pages.automation": { group: "Facebook Pages", description: "Enable automatic moderation / kill switch" },
  "comments.read": { group: "Moderation", description: "Read comments" },
  "comments.hide": { group: "Moderation", description: "Hide comments" },
  "comments.unhide": { group: "Moderation", description: "Unhide comments" },
  "comments.reply": { group: "Moderation", description: "Send public comment replies" },
  "moderation.approve": { group: "Moderation", description: "Approve or reject AI actions" },
  "agents.configure": { group: "AI", description: "Configure AI agents" },
  "agents.train": { group: "AI", description: "Train AI agents and manage knowledge" },
  "ai.credentials": { group: "AI", description: "Manage AI provider keys (BYOK)" },
  "inbox.manage": { group: "Messenger", description: "Manage Messenger conversations" },
  "inbox.reply": { group: "Messenger", description: "Send Messenger replies" },
  "inbox.all": { group: "Messenger", description: "See all conversations (not only assigned)" },
  "crm.access": { group: "CRM", description: "Access CRM" },
  "crm.all": { group: "CRM", description: "See all leads (not only assigned)" },
  "crm.export": { group: "CRM", description: "Export leads" },
  "analytics.view": { group: "Analytics", description: "View analytics" },
  "team.manage": { group: "Team", description: "Manage team members and roles" },
  "billing.view": { group: "Billing", description: "View billing" },
  "billing.manage": { group: "Billing", description: "Manage subscriptions" },
  "settings.manage": { group: "Settings", description: "Change business settings" },
  "audit.view": { group: "Settings", description: "View workspace audit log" },
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

type RoleTemplate = { key: string; name: string; description: string; rank: number; permissions: PermissionKey[] };

const without = (...ex: PermissionKey[]) => ALL_PERMISSIONS.filter((p) => !ex.includes(p));

export const DEFAULT_ROLES: RoleTemplate[] = [
  { key: "owner", name: "Business Owner", description: "Full control over the organization", rank: 100, permissions: ALL_PERMISSIONS },
  {
    key: "admin",
    name: "Business Admin",
    description: "Manage business operations, Pages, agents, team and settings",
    rank: 80,
    permissions: without("billing.manage"),
  },
  {
    key: "manager",
    name: "Manager",
    description: "Manage operational teams, moderation, inbox and leads",
    rank: 60,
    permissions: [
      "dashboard.view", "comments.read", "comments.hide", "comments.unhide", "comments.reply", "moderation.approve",
      "agents.train", "inbox.manage", "inbox.reply", "inbox.all", "crm.access", "crm.all", "crm.export", "analytics.view",
    ],
  },
  {
    key: "moderator",
    name: "Moderator",
    description: "Review comments, manage moderation queues and approve AI decisions",
    rank: 40,
    permissions: ["dashboard.view", "comments.read", "comments.hide", "comments.unhide", "comments.reply", "moderation.approve", "agents.train"],
  },
  {
    key: "support",
    name: "Customer Support Agent",
    description: "Handle assigned conversations and customer inquiries",
    rank: 30,
    permissions: ["dashboard.view", "inbox.manage", "inbox.reply", "crm.access"],
  },
  {
    key: "crm",
    name: "CRM Agent",
    description: "Manage assigned leads, contacts and follow-ups",
    rank: 30,
    permissions: ["dashboard.view", "crm.access"],
  },
  { key: "viewer", name: "Viewer", description: "Read-only access", rank: 10, permissions: ["dashboard.view", "comments.read", "analytics.view"] },
];

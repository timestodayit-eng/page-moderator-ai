import type { AgentPurpose } from "@/generated/prisma/client";
import { prisma } from "../db";
import { Errors } from "../errors";
import { audit } from "../audit";
import { PROVIDER_MODELS, assertProvider, type Provider } from "../ai/gateway";
import type { WorkspaceContext } from "../rbac/guard";
import { enforceLimit } from "../billing/usage";

export type ActiveAgent = { id: string; versionId: string; purpose: AgentPurpose; instructions: string; provider: Provider; model: string; temperature: number; languages: string[]; tone: string; safetyRules: string; allowedActions: string[]; escalationRules: string; responseConstraints: string; knowledgeSourceIds: string[] };

/** Resolve the agent to use: explicit Page assignment → workspace's active agent of that purpose → null (defaults). */
export async function loadActiveAgent(workspaceId: string, agentId: string | null | undefined, purpose: AgentPurpose): Promise<ActiveAgent | null> {
  const agent = agentId
    ? await prisma.agent.findFirst({ where: { id: agentId, workspaceId, status: "ACTIVE" } })
    : await prisma.agent.findFirst({ where: { workspaceId, purpose, status: "ACTIVE", pageId: null }, orderBy: { updatedAt: "desc" } });
  if (!agent?.activeVersionId) return null;
  const v = await prisma.agentVersion.findUnique({ where: { id: agent.activeVersionId } });
  if (!v) return null;
  return { id: agent.id, versionId: v.id, purpose: agent.purpose, instructions: v.instructions, provider: v.provider as Provider, model: v.model, temperature: v.temperature, languages: v.languages, tone: v.tone, safetyRules: v.safetyRules, allowedActions: v.allowedActions, escalationRules: v.escalationRules, responseConstraints: v.responseConstraints, knowledgeSourceIds: v.knowledgeSourceIds };
}

export type VersionInput = { instructions: string; languages: string[]; tone: string; provider: string; model: string; temperature: number; safetyRules?: string; allowedActions?: string[]; escalationRules?: string; responseConstraints?: string; knowledgeSourceIds?: string[]; changeNote?: string };

function validateVersion(v: VersionInput) {
  const provider = assertProvider(v.provider);
  if (!PROVIDER_MODELS[provider].includes(v.model)) throw Errors.badRequest(`Model ${v.model} is not available for ${provider}`);
  if (v.temperature < 0 || v.temperature > 1.5) throw Errors.badRequest("Temperature must be between 0 and 1.5");
  return provider;
}

export async function createAgent(ctx: WorkspaceContext, input: { name: string; description?: string; purpose: AgentPurpose; pageId?: string | null; version: VersionInput; activate?: boolean }, meta: { ip?: string | null }) {
  validateVersion(input.version);
  const count = await prisma.agent.count({ where: { workspaceId: ctx.workspace.id, status: { not: "ARCHIVED" } } });
  await enforceLimit(ctx.workspace.id, "agents", count + 1);
  if (input.pageId) {
    const page = await prisma.connectedPage.findFirst({ where: { id: input.pageId, workspaceId: ctx.workspace.id } });
    if (!page) throw Errors.notFound("Page");
  }
  if (input.version.knowledgeSourceIds?.length) {
    const n = await prisma.knowledgeSource.count({ where: { id: { in: input.version.knowledgeSourceIds }, workspaceId: ctx.workspace.id } });
    if (n !== input.version.knowledgeSourceIds.length) throw Errors.notFound("Knowledge source");
  }
  return prisma.$transaction(async (tx) => {
    const agent = await tx.agent.create({ data: { workspaceId: ctx.workspace.id, name: input.name.trim(), description: input.description?.trim() ?? "", purpose: input.purpose, pageId: input.pageId ?? null, createdById: ctx.user.id, status: input.activate ? "ACTIVE" : "DRAFT" } });
    const v = await tx.agentVersion.create({ data: { agentId: agent.id, workspaceId: ctx.workspace.id, version: 1, createdById: ctx.user.id, ...versionData(input.version) } });
    await tx.agent.update({ where: { id: agent.id }, data: { activeVersionId: v.id } });
    await audit({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: "agent.created", targetType: "Agent", targetId: agent.id, ip: meta.ip, meta: { name: agent.name, purpose: agent.purpose } }, tx);
    return { ...agent, activeVersionId: v.id };
  });
}

function versionData(v: VersionInput) {
  return { instructions: v.instructions, languages: v.languages, tone: v.tone, provider: v.provider, model: v.model, temperature: v.temperature, safetyRules: v.safetyRules ?? "", allowedActions: v.allowedActions ?? [], escalationRules: v.escalationRules ?? "", responseConstraints: v.responseConstraints ?? "", knowledgeSourceIds: v.knowledgeSourceIds ?? [], changeNote: v.changeNote ?? "" };
}

/** Every configuration change creates a new immutable version; activation is explicit. */
export async function addVersion(ctx: WorkspaceContext, agentId: string, input: VersionInput & { activate?: boolean }, meta: { ip?: string | null }) {
  validateVersion(input);
  const agent = await prisma.agent.findFirst({ where: { id: agentId, workspaceId: ctx.workspace.id } });
  if (!agent) throw Errors.notFound("Agent");
  const last = await prisma.agentVersion.findFirst({ where: { agentId }, orderBy: { version: "desc" } });
  return prisma.$transaction(async (tx) => {
    const v = await tx.agentVersion.create({ data: { agentId, workspaceId: ctx.workspace.id, version: (last?.version ?? 0) + 1, createdById: ctx.user.id, ...versionData(input) } });
    if (input.activate) await tx.agent.update({ where: { id: agentId }, data: { activeVersionId: v.id } });
    await audit({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: "agent.version_created", targetType: "Agent", targetId: agentId, ip: meta.ip, meta: { version: v.version, activated: Boolean(input.activate), changeNote: input.changeNote } }, tx);
    return v;
  });
}

export async function setAgentStatus(ctx: WorkspaceContext, agentId: string, patch: { status?: "DRAFT" | "ACTIVE" | "ARCHIVED"; activeVersionId?: string; name?: string; description?: string; pageId?: string | null }, meta: { ip?: string | null }) {
  const agent = await prisma.agent.findFirst({ where: { id: agentId, workspaceId: ctx.workspace.id } });
  if (!agent) throw Errors.notFound("Agent");
  if (patch.activeVersionId) {
    const v = await prisma.agentVersion.findFirst({ where: { id: patch.activeVersionId, agentId } });
    if (!v) throw Errors.notFound("Version");
  }
  await prisma.$transaction(async (tx) => {
    await tx.agent.update({ where: { id: agentId }, data: { status: patch.status, activeVersionId: patch.activeVersionId, name: patch.name?.trim(), description: patch.description?.trim(), pageId: patch.pageId } });
    if (patch.status === "ARCHIVED") await tx.connectedPage.updateMany({ where: { workspaceId: ctx.workspace.id, OR: [{ moderationAgentId: agentId }, { replyAgentId: agentId }, { messengerAgentId: agentId }] }, data: { moderationAgentId: null } });
    await audit({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: "agent.updated", targetType: "Agent", targetId: agentId, ip: meta.ip, meta: { patch } }, tx);
  });
}

export const AGENT_TEMPLATES: Record<AgentPurpose, { name: string; description: string; instructions: string; tone: string }> = {
  MODERATION: { name: "Comment Moderation Agent", description: "Classifies every incoming comment and recommends keep / review / hide.", tone: "neutral", instructions: "Classify comments for a Bangladeshi overseas-employment business. Treat questions about jobs, visas, salaries and documents as inquiries. Treat accusations against the business as complaints to review, never as abuse. Hide only clear spam, scams, abuse, harassment and hate speech." },
  PUBLIC_REPLY: { name: "Public Reply Agent", description: "Drafts public replies to inquiries and positive comments using approved knowledge.", tone: "warm, professional", instructions: "Reply in the commenter's language (Bengali, Banglish or English). Keep replies to 1–3 sentences. Use only approved knowledge for facts. If information is missing, invite them to call or message the Page. Never promise visas, salaries or timelines." },
  SUPPORT: { name: "Customer Support Agent", description: "Handles Messenger support questions and escalates complaints.", tone: "empathetic, clear", instructions: "Answer support questions step by step using approved knowledge. Acknowledge frustration. Escalate refund, legal or complaint matters to a human." },
  SALES: { name: "Sales Inquiry Agent", description: "Qualifies sales inquiries and collects requirements.", tone: "friendly, persuasive but honest", instructions: "Identify which service the person wants, ask for one detail at a time (destination, trade, experience), and offer the official contact for next steps. Never quote prices that are not in the knowledge base." },
  LEAD_QUALIFICATION: { name: "Lead Qualification Agent", description: "Scores and tags leads from comments and messages.", tone: "neutral", instructions: "Determine intent (apply / inquire / complaint / other), urgency and completeness of information. Output structured fields." },
  COMPLAINT: { name: "Complaint Handling Agent", description: "Drafts calm, accountable responses to complaints for human approval.", tone: "calm, accountable", instructions: "Apologise for the experience without admitting legal liability, ask for a reference or contact detail privately, and promise a follow-up by a named team. Always require human approval." },
  MESSENGER: { name: "Messenger Support Agent", description: "Suggests replies inside the Messenger inbox.", tone: "warm, concise", instructions: "Continue the conversation naturally in the customer's language, answer from approved knowledge, and hand over to a human when asked or when uncertain." },
};

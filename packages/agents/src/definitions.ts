import type { AgentRole, WorkItemState } from "../../shared/src";

export interface AgentDefinition {
  role: AgentRole;
  displayName: string;
  shortName: string;
  owns: string[];
  doesNotOwn: string[];
  requiredOutputs: string[];
  primaryStages: WorkItemState[];
  instructions: string;
}

export const AGENT_DEFINITIONS: AgentDefinition[] = [
  {
    role: "product-delivery-orchestrator",
    displayName: "Product & Delivery Orchestrator",
    shortName: "Product",
    owns: ["Intake", "Priority", "Scope", "Acceptance criteria", "Routing", "Final summary"],
    doesNotOwn: ["Technical architecture", "Implementation", "Independent release approval"],
    requiredOutputs: ["Work Item Brief", "Routing Plan", "Delivery Status", "Final Work Summary", "Follow-up Work Items"],
    primaryStages: ["INTAKE", "CLOSED"],
    instructions: [
      "You are the Product & Delivery Orchestrator for an autonomous software development team.",
      "Convert raw requests into bounded work items with testable acceptance criteria.",
      "Confirm the connected project/repository scope before routing work and avoid mixing context across repos.",
      "Decide routing, scope, risk level, and final closure documentation.",
      "Do not invent technical architecture or approve release readiness."
    ].join("\n")
  },
  {
    role: "rnd-architecture-innovation",
    displayName: "R&D, Architecture & Innovation Agent",
    shortName: "R&D",
    owns: ["Research", "Feasibility", "Architecture options", "Prototype plan", "ADR", "Implementation strategy"],
    doesNotOwn: ["Product priority", "Production code ownership", "Release approval"],
    requiredOutputs: ["Research Brief", "Technical Options Analysis", "Recommended Architecture", "ADR", "Implementation Strategy"],
    primaryStages: ["RND", "CONTRACT"],
    instructions: [
      "You are the R&D, Architecture & Innovation Agent.",
      "Research the best technical direction before production implementation begins.",
      "Proactively use active research, documentation, browser, GitHub, or diagnostics capabilities only when they improve the decision.",
      "Document tradeoffs, rejected alternatives, API/data contracts, security/privacy risks, and performance risks.",
      "Keep recommendations implementable by frontend and backend agents."
    ].join("\n")
  },
  {
    role: "frontend-ux-engineering",
    displayName: "Frontend & UX Engineering Agent",
    shortName: "Frontend",
    owns: ["User flows", "UI states", "Components", "Accessibility", "Responsive behavior", "Frontend tests"],
    doesNotOwn: ["Product priority", "Backend architecture", "Release approval"],
    requiredOutputs: ["Frontend Implementation Plan", "UI State Map", "Component Changes", "Accessibility Notes", "Frontend Test Notes"],
    primaryStages: ["FRONTEND_BUILD"],
    instructions: [
      "You are the Frontend & UX Engineering Agent.",
      "Own user-facing implementation, accessibility, responsive behavior, client validation, and frontend tests.",
      "Use browser and frontend capability packs when UI behavior, accessibility, rendering, or performance needs live verification.",
      "Build only after the build contract is stable. Escalate contract deviations."
    ].join("\n")
  },
  {
    role: "backend-systems-engineering",
    displayName: "Backend & Systems Engineering Agent",
    shortName: "Backend",
    owns: ["APIs", "Services", "Data models", "Migrations", "Integrations", "Auth implementation", "Backend tests"],
    doesNotOwn: ["Product priority", "UI/UX decisions", "Independent release approval"],
    requiredOutputs: ["Backend Implementation Plan", "API Contract", "Data Change Summary", "Migration Notes", "Backend Test Notes"],
    primaryStages: ["BACKEND_BUILD", "INTEGRATION"],
    instructions: [
      "You are the Backend & Systems Engineering Agent.",
      "Own server-side behavior, data, APIs, integrations, jobs, observability hooks, and backend tests.",
      "Use database, API, and documentation capabilities only for the connected project/repository and only when the stage needs them.",
      "Keep implementation aligned with the locked build contract and release policy."
    ].join("\n")
  },
  {
    role: "quality-security-privacy-release",
    displayName: "Quality, Security, Privacy & Release Agent",
    shortName: "Quality",
    owns: ["Verification", "Regression testing", "Performance", "Security review", "Privacy review", "Rollback plan", "Go/no-go"],
    doesNotOwn: ["Product scope", "Main implementation", "Architecture invention"],
    requiredOutputs: ["Test Plan", "Verification Report", "Security Review", "Privacy Review", "Release Checklist", "Rollback Plan", "Go/No-Go"],
    primaryStages: ["VERIFY", "RELEASE", "BLOCKED"],
    instructions: [
      "You are the Quality, Security, Privacy & Release Agent.",
      "Independently prove whether work is correct, safe, performant, private, and ready to release.",
      "Proactively load verification, GitHub, security, browser, and diagnostics capabilities when release readiness cannot be proven from existing artifacts.",
      "Block release when acceptance criteria, security, privacy, rollback, local checks, GitHub Actions, or local/remote sync cannot be proven."
    ].join("\n")
  }
];

export function getAgentDefinition(role: AgentRole): AgentDefinition {
  const definition = AGENT_DEFINITIONS.find((agent) => agent.role === role);
  if (!definition) throw new Error(`Unknown agent role: ${role}`);
  return definition;
}

export function roleForStage(stage: WorkItemState): AgentRole {
  switch (stage) {
    case "INTAKE":
    case "CLOSED":
      return "product-delivery-orchestrator";
    case "RND":
    case "CONTRACT":
      return "rnd-architecture-innovation";
    case "FRONTEND_BUILD":
      return "frontend-ux-engineering";
    case "BACKEND_BUILD":
    case "INTEGRATION":
      return "backend-systems-engineering";
    case "VERIFY":
    case "RELEASE":
    case "BLOCKED":
      return "quality-security-privacy-release";
    case "NEW":
      return "product-delivery-orchestrator";
  }
}

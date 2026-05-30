import { DOC_CONTENT_CORE } from "./docsContentCore";
import { DOC_CONTENT_GUIDES } from "./docsContentGuides";
import { DOC_CONTENT_PLUGINS } from "./docsContentPlugins";
import type { DocsContentEntry, DocsSection } from "./docsContentTypes";

export const SECTIONS: DocsSection[] = [
  { id: "getting-started", label: "Getting Started" },
  { id: "architecture", label: "Architecture" },
  { id: "cli", label: "CLI Reference" },
  { id: "creating-plugins", label: "Creating Plugins" },
  { id: "events", label: "Event Bus" },
  { id: "multi-tenant", label: "Multi-Tenant" },
  { id: "marketplace", label: "Marketplace" },
  { id: "admin", label: "Admin Dashboard" },
  { id: "auth", label: "Auth Plugin" },
  { id: "crm", label: "CRM Plugin" },
  { id: "ticketing", label: "Ticketing Plugin" },
  { id: "lifecycle-hooks", label: "Lifecycle Hooks" },
  { id: "client-loader", label: "Client Loader" },
  { id: "testing", label: "Testing" },
  { id: "deployment", label: "Deployment" },
];

export const CONTENT: Record<string, DocsContentEntry> = {
  ...DOC_CONTENT_CORE,
  ...DOC_CONTENT_PLUGINS,
  ...DOC_CONTENT_GUIDES,
};

import { describe, expect, it } from "vitest";

import { oauthProviderEnum } from "../packages/plugin-auth-social/src/index.ts";
import { contactStatusEnum, dealStageEnum } from "../packages/plugin-crm/src/index.ts";
import { ticketPriorityEnum, ticketStatusEnum } from "../packages/plugin-ticketing/src/index.ts";

describe("published plugin schema exports", () => {
  it.each([
    [oauthProviderEnum, "oauth_provider", ["google", "github", "gitlab"]],
    [contactStatusEnum, "crm_contact_status", ["lead", "prospect", "client", "churned"]],
    [dealStageEnum, "crm_deal_stage", ["new", "qualified", "proposal", "negotiation", "won", "lost"]],
    [ticketStatusEnum, "ticket_status", ["open", "in_progress", "waiting", "resolved", "closed"]],
    [ticketPriorityEnum, "ticket_priority", ["low", "medium", "high", "urgent"]],
  ])("exports %s for Drizzle migration discovery", (schemaEnum, enumName, enumValues) => {
    expect(schemaEnum.enumName).toBe(enumName);
    expect(schemaEnum.enumValues).toEqual(enumValues);
  });
});

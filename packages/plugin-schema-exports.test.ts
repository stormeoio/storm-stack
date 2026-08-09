import { describe, expect, it } from "vitest";

import { oauthProviderEnum } from "./plugin-auth-social/src/index";
import { contactStatusEnum, dealStageEnum } from "./plugin-crm/src/index";
import { ticketPriorityEnum, ticketStatusEnum } from "./plugin-ticketing/src/index";

describe("published plugin schema exports", () => {
  it.each([
    [oauthProviderEnum, "oauth_provider", ["google", "github", "gitlab"]],
    [contactStatusEnum, "crm_contact_status", ["lead", "prospect", "client", "churned"]],
    [dealStageEnum, "crm_deal_stage", ["new", "qualified", "proposal", "negotiation", "won", "lost"]],
    [ticketStatusEnum, "ticket_status", ["open", "in_progress", "waiting", "resolved", "closed"]],
    [ticketPriorityEnum, "ticket_priority", ["low", "medium", "high", "urgent"]],
  ] as const)("exports %s for Drizzle migration discovery", (schemaEnum, enumName, enumValues) => {
    expect(schemaEnum.enumName).toBe(enumName);
    expect(schemaEnum.enumValues).toEqual(enumValues);
  });
});

import { z } from "zod";
import { callMcpTool } from "./mcp.js";

/**
 * Store policy / FAQ lookups over the Storefront MCP's
 * `search_shop_policies_and_faqs` tool, so the adviser answers delivery /
 * returns / warranty questions from real store data rather than inventing them
 * (Guardrail §11.8). On a hit the tool returns a JSON array of {question, answer}
 * in content[].text; on a miss it returns a plain "unable to find" string (which
 * parses to nothing) — both degrade to an empty list.
 */

export interface PolicyAnswer {
  question: string;
  answer: string;
}

export interface FaqClient {
  searchPolicies(query: string, context?: string): Promise<PolicyAnswer[]>;
}

const faqSchema = z.array(z.object({ question: z.string(), answer: z.string() }).passthrough());

export interface StorefrontFaqConfig {
  mcpUrl: string;
}

export function createStorefrontFaqClient(
  config: StorefrontFaqConfig,
  fetchImpl: typeof fetch = fetch,
): FaqClient {
  return {
    async searchPolicies(query, context) {
      const args: Record<string, unknown> = { query };
      if (context) args.context = context;
      let structured: unknown;
      try {
        structured = await callMcpTool(
          { url: config.mcpUrl, fetchImpl },
          "search_shop_policies_and_faqs",
          args,
        );
      } catch {
        return []; // degrade: the adviser asks/answers without policy grounding
      }
      const parsed = faqSchema.safeParse(structured);
      return parsed.success ? parsed.data : [];
    },
  };
}

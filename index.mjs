import "dotenv/config";
import fs from "fs";

import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import OpenAI from "openai";
import { observeOpenAI } from "@langfuse/openai";

const sdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()],
});

sdk.start();

const openai = observeOpenAI(new OpenAI(), {
  generationName: "lead-qualifier-hybrid-v3"
});

const companies = JSON.parse(
  fs.readFileSync("./data/companies.json", "utf8")
);

function classifyCompany(company) {
  const text = `${company.industry} ${company.product}`.toLowerCase();

  const travelSignal =
    text.includes("travel") ||
    text.includes("hospitality") ||
    text.includes("hotel");

  const b2bSignal =
    company.business_model === "B2B";

  const apiSignal =
    company.uses_api === true ||
    text.includes("api") ||
    text.includes("integration") ||
    text.includes("infrastructure");

  const signalCount =
    Number(travelSignal) +
    Number(b2bSignal) +
    Number(apiSignal);

  let segment;
  let nextAction;

  if (signalCount === 3) {
    segment = "high-potential";
    nextAction = "sales_follow_up";
  } else if (signalCount === 2) {
    segment = "medium-potential";
    nextAction = "nurture";
  } else {
    segment = "low-potential";
    nextAction = "ignore";
  }

  return {
    signals: {
      travel: travelSignal,
      b2b: b2bSignal,
      api: apiSignal
    },
    signalCount,
    segment,
    nextAction
  };
}

let correct = 0;

for (const company of companies) {
  const expectedSegment = company.expected_segment;

  const inputCompany = { ...company };
  delete inputCompany.expected_segment;

  const deterministic = classifyCompany(inputCompany);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,

    messages: [
      {
        role: "system",
        content: `
You are a GTM lead qualification assistant.

The segment has already been calculated using deterministic business rules.

Your job is only to:
1. assign a fit_score consistent with the segment
2. explain the reasoning in maximum 25 words

Score ranges:
- high-potential: 70-100
- medium-potential: 40-69
- low-potential: 0-39

Base your reasoning only on the data provided.
`
      },
      {
        role: "user",
        content: JSON.stringify({
          company: inputCompany,
          deterministic_segment: deterministic.segment,
          signals: deterministic.signals
        })
      }
    ],

    response_format: {
      type: "json_schema",
      json_schema: {
        name: "lead_qualification_reasoning",
        strict: true,
        schema: {
          type: "object",
          properties: {
            fit_score: {
              type: "integer",
              minimum: 0,
              maximum: 100
            },
            reason: {
              type: "string"
            }
          },
          required: [
            "fit_score",
            "reason"
          ],
          additionalProperties: false
        }
      }
    }
  });

  const aiResult = JSON.parse(
    response.choices[0].message.content
  );

  const result = {
    fit_score: aiResult.fit_score,
    segment: deterministic.segment,
    reason: aiResult.reason,
    next_action: deterministic.nextAction
  };

  const isCorrect =
    result.segment === expectedSegment;

  if (isCorrect) {
    correct++;
  }

  console.log(
    `${company.company_name}: ${result.segment} | expected: ${expectedSegment} | ${isCorrect ? "OK" : "MISS"}`
  );
}

const accuracy =
  (correct / companies.length) * 100;

console.log("\n----------------------");
console.log(`Correct: ${correct}/${companies.length}`);
console.log(`Accuracy: ${accuracy.toFixed(1)}%`);
console.log("----------------------");

await sdk.shutdown();
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
  generationName: "lead-qualifier-dataset-test"
});

const companies = JSON.parse(
  fs.readFileSync("./data/companies.json", "utf8")
);

let correct = 0;

for (const company of companies) {
  const expectedSegment = company.expected_segment;

  const inputCompany = { ...company };
  delete inputCompany.expected_segment;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",

    messages: [
  {
    role: "system",
    content: `
You are a GTM lead qualification assistant.

Evaluate companies for a B2B SaaS company selling API infrastructure
to travel companies.

Use these three core fit signals:

1. The company operates in travel, hospitality, or travel technology.
2. The company has a B2B business model.
3. The company uses APIs, integrations, or provides technical infrastructure.

Classification rules:

- high-potential: all three core signals are present
- medium-potential: exactly two core signals are present
- low-potential: zero or one core signal is present

Company size and region can influence the fit_score,
but they must not change the segment classification.

Base the evaluation only on the data provided.
The reason must be concise, maximum 25 words.
`
  },
  {
    role: "user",
    content: JSON.stringify(inputCompany)
  }
], 

    response_format: {
      type: "json_schema",
      json_schema: {
        name: "lead_qualification",
        strict: true,
        schema: {
          type: "object",
          properties: {
            fit_score: {
              type: "integer",
              minimum: 0,
              maximum: 100
            },
            segment: {
              type: "string",
              enum: [
                "low-potential",
                "medium-potential",
                "high-potential"
              ]
            },
            reason: {
              type: "string"
            },
            next_action: {
              type: "string",
              enum: [
                "ignore",
                "nurture",
                "sales_follow_up"
              ]
            }
          },
          required: [
            "fit_score",
            "segment",
            "reason",
            "next_action"
          ],
          additionalProperties: false
        }
      }
    }
  });

  const result = JSON.parse(
    response.choices[0].message.content
  );

  const isCorrect = result.segment === expectedSegment;

  if (isCorrect) {
    correct++;
  }

  console.log(
    `${company.company_name}: ${result.segment} | expected: ${expectedSegment} | ${isCorrect ? "OK" : "MISS"}`
  );
}

const accuracy = (correct / companies.length) * 100;

console.log("\n----------------------");
console.log(`Correct: ${correct}/${companies.length}`);
console.log(`Accuracy: ${accuracy.toFixed(1)}%`);
console.log("----------------------");

await sdk.shutdown();
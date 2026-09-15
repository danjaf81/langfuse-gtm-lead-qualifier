import "dotenv/config";

import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { LangfuseClient } from "@langfuse/client";
import OpenAI from "openai";
import { observeOpenAI } from "@langfuse/openai";


// --------------------------------------------------
// LANGFUSE / OPENTELEMETRY SETUP
// --------------------------------------------------

const otelSdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()],
});

otelSdk.start();

const langfuse = new LangfuseClient();


// --------------------------------------------------
// PROMPT MANAGEMENT
// --------------------------------------------------

const langfusePrompt = await langfuse.prompt.get(
  "gtm-lead-qualifier",
  {
    type: "text",
    label: "production",
  }
);

const systemPrompt = langfusePrompt.compile({});

const openai = observeOpenAI(new OpenAI(), {
  langfusePrompt,
});


// --------------------------------------------------
// DETERMINISTIC BUSINESS LOGIC
// --------------------------------------------------

function classifyCompany(company) {
  const text =
    `${company.industry} ${company.product}`.toLowerCase();

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
      api: apiSignal,
    },
    signalCount,
    segment,
    nextAction,
  };
}


// --------------------------------------------------
// AI TASK
// --------------------------------------------------

async function qualifyCompany(company) {
  const deterministic = classifyCompany(company);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,

    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: JSON.stringify({
          company,
          deterministic_segment: deterministic.segment,
          signals: deterministic.signals,
        }),
      },
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
              maximum: 100,
            },

            reason: {
              type: "string",
            },
          },

          required: [
            "fit_score",
            "reason",
          ],

          additionalProperties: false,
        },
      },
    },
  });

  const aiResult = JSON.parse(
    response.choices[0].message.content
  );

  return {
    fit_score: aiResult.fit_score,
    segment: deterministic.segment,
    reason: aiResult.reason,
    next_action: deterministic.nextAction,
  };
}


// --------------------------------------------------
// EVALUATOR 1
// SEGMENT ACCURACY
// --------------------------------------------------

const segmentAccuracy = async ({
  output,
  expectedOutput,
}) => {
  const correct =
    output.segment === expectedOutput.segment;

  return {
    name: "segment_accuracy",
    value: correct ? 1 : 0,

    comment: correct
      ? "Segment matches expected output"
      : `Expected ${expectedOutput.segment}, got ${output.segment}`,
  };
};


// --------------------------------------------------
// EVALUATOR 2
// FIT SCORE / SEGMENT CONSISTENCY
// --------------------------------------------------

const scoreRangeConsistency = async ({
  output,
}) => {
  const ranges = {
    "low-potential": [0, 39],
    "medium-potential": [40, 69],
    "high-potential": [70, 100],
  };

  const [min, max] = ranges[output.segment];

  const valid =
    output.fit_score >= min &&
    output.fit_score <= max;

  return {
    name: "score_range_consistency",
    value: valid ? 1 : 0,

    comment: valid
      ? `${output.fit_score} is valid for ${output.segment}`
      : `${output.fit_score} is outside expected range ${min}-${max}`,
  };
};


// --------------------------------------------------
// EVALUATOR 3
// REASON MAXIMUM 25 WORDS
// --------------------------------------------------

const reasonWordLimit = async ({
  output,
}) => {
  const wordCount = output.reason
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;

  const valid =
    wordCount > 0 &&
    wordCount <= 25;

  return {
    name: "reason_word_limit",
    value: valid ? 1 : 0,

    comment: valid
      ? `${wordCount} words — within 25-word limit`
      : `${wordCount} words — exceeds 25-word limit`,
  };
};


// --------------------------------------------------
// RUN EXPERIMENT
// --------------------------------------------------

async function main() {
  const dataset = await langfuse.dataset.get(
    "gtm-lead-qualification"
  );

  const result = await dataset.runExperiment({
    name: "GTM Lead Qualifier",

    runName: "hybrid-v3-quality-evals",

    description:
      "Hybrid GTM qualification evaluated for segmentation accuracy, score consistency and concise reasoning.",

    task: async (item) => {
      return qualifyCompany(item.input);
    },

    evaluators: [
      segmentAccuracy,
      scoreRangeConsistency,
      reasonWordLimit,
    ],
  });

  console.log(
    await result.format()
  );
}


// --------------------------------------------------
// EXECUTION
// --------------------------------------------------

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await otelSdk.shutdown();
  });
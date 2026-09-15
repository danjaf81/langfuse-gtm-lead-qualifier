import "dotenv/config";

import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { LangfuseClient } from "@langfuse/client";
import OpenAI from "openai";
import { observeOpenAI } from "@langfuse/openai";


// --------------------------------------------------
// SETUP
// --------------------------------------------------

const otelSdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()],
});

otelSdk.start();

const langfuse = new LangfuseClient();

// Client separato per l'evaluator LLM.
// Non serve osservarlo come parte del workflow principale.
const judgeOpenAI = new OpenAI();


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
// CREATE QUALIFIER FOR A SPECIFIC PROMPT VERSION
// --------------------------------------------------

function createQualifier(langfusePrompt) {
  const systemPrompt = langfusePrompt.compile({});

  const openai = observeOpenAI(new OpenAI(), {
    langfusePrompt,
  });

  return async function qualifyCompany(company) {
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
// SCORE RANGE
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
      : `${output.fit_score} is outside range ${min}-${max}`,
  };
};


// --------------------------------------------------
// EVALUATOR 3
// WORD LIMIT
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
      ? `${wordCount} words`
      : `${wordCount} words — over limit`,
  };
};


// --------------------------------------------------
// EVALUATOR 4
// LLM-AS-A-JUDGE: REASON QUALITY
// --------------------------------------------------

const reasonQuality = async ({
  input,
  output,
}) => {
  const response =
    await judgeOpenAI.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,

      messages: [
        {
          role: "system",
          content: `
You are evaluating the quality of a GTM lead qualification explanation.

Score the reason using four criteria.

Give 1 point for each criterion satisfied:

1. The explanation is grounded only in the supplied company data.
2. It references concrete company-specific signals rather than generic language.
3. It clearly connects those signals to the assigned GTM fit.
4. It is concise and useful to a sales or GTM professional.

Total score must be an integer from 0 to 4.

Be strict. A generic explanation should not receive full marks.
`,
        },

        {
          role: "user",
          content: JSON.stringify({
            company: input,
            result: output,
          }),
        },
      ],

      response_format: {
        type: "json_schema",

        json_schema: {
          name: "reason_quality_evaluation",
          strict: true,

          schema: {
            type: "object",

            properties: {
              score: {
                type: "integer",
                minimum: 0,
                maximum: 4,
              },

              comment: {
                type: "string",
              },
            },

            required: [
              "score",
              "comment",
            ],

            additionalProperties: false,
          },
        },
      },
    });

  const evaluation = JSON.parse(
    response.choices[0].message.content
  );

  return {
    name: "reason_quality",

    // normalizziamo da 0-4 a 0-1
    value: evaluation.score / 4,

    comment:
      `${evaluation.score}/4 — ${evaluation.comment}`,
  };
};


// --------------------------------------------------
// RUN ONE PROMPT VERSION
// --------------------------------------------------

async function runPromptVersion(
  dataset,
  version,
  runName
) {
  const prompt = await langfuse.prompt.get(
    "gtm-lead-qualifier",
    {
      type: "text",
      version,
    }
  );

  const qualifyCompany =
    createQualifier(prompt);

  console.log(
    `\nRunning prompt v${version}...`
  );

  const result = await dataset.runExperiment({
    name: "GTM Lead Qualifier Prompt Comparison",

    runName,

    description:
      `Evaluation of gtm-lead-qualifier prompt version ${version}.`,

    metadata: {
      prompt_version: version,
      model: "gpt-4o-mini",
    },

    task: async (item) => {
      return qualifyCompany(item.input);
    },

    evaluators: [
      segmentAccuracy,
      scoreRangeConsistency,
      reasonWordLimit,
      reasonQuality,
    ],
  });

  console.log(
    await result.format()
  );
}


// --------------------------------------------------
// MAIN
// --------------------------------------------------

async function main() {
  const dataset = await langfuse.dataset.get(
    "gtm-lead-qualification"
  );

  await runPromptVersion(
    dataset,
    1,
    "prompt-v1-baseline"
  );

  await runPromptVersion(
    dataset,
    2,
    "prompt-v2-candidate"
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
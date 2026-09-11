import "dotenv/config";

import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import OpenAI from "openai";
import { observeOpenAI } from "@langfuse/openai";

const sdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()],
});

sdk.start();

const openai = observeOpenAI(new OpenAI(), {
  generationName: "first-langfuse-test"
});

const response = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [
    {
      role: "user",
      content: "Classify this company as low, medium or high potential lead: a B2B SaaS company selling API infrastructure to travel companies."
    }
  ]
});

console.log(response.choices[0].message.content);

await sdk.shutdown();
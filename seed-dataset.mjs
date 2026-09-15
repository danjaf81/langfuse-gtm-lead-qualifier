import "dotenv/config";
import fs from "fs";
import { LangfuseClient } from "@langfuse/client";

const langfuse = new LangfuseClient();

const datasetName = "gtm-lead-qualification";

const companies = JSON.parse(
  fs.readFileSync("./data/companies.json", "utf8")
);

await langfuse.api.datasets.create({
  name: datasetName,
  description:
    "Benchmark dataset for a GTM lead qualification workflow using deterministic business rules and LLM reasoning.",
});

for (const company of companies) {
  const {
    expected_segment,
    ...companyInput
  } = company;

  await langfuse.dataset.createItem({
    datasetName,
    input: companyInput,
    expectedOutput: {
      segment: expected_segment,
    },
    metadata: {
      company_name: company.company_name,
    },
  });

  console.log(
    `Added ${company.company_name} → ${expected_segment}`
  );
}

console.log(
  `\nDataset "${datasetName}" created with ${companies.length} items.`
);
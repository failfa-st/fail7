import { Agent } from "@hyv/core";
import { ModelMessage } from "@hyv/core";
import { createInstruction, GPTModelAdapter } from "@hyv/openai";
import { minify } from "@hyv/utils";
import { storyTemplate, suggestionTemplate } from "./templates.js";

export const agent = new Agent(
  new GPTModelAdapter({
    model: "gpt-4",
    temperature: 0.6,
    maxTokens: 1024,
    systemInstruction: createInstruction(
      "GitHub Pull Request Reviewer",
      minify`
      Review the Pull-Request {{diff}} (line by line).
      consider {{title+body}}.
      Think about each line with high precision.
      **Check for faulty implementation or common errors!**
      Propose best practices and efficiency!
      You can use the {{suggestionTemplate}} for GitHub suggestions.
      Add comments and/or suggestions (consider multi-line).
      Decide if this can be merged (very strict).
      `,
      {
        letsGetThatMerged: "boolean",
        thoughts: "very detailed, thoughtful and elaborative string",
        review: "General review comment",
        comments: [
          {
            path: "relative path to file",
            start_line: "number (start)",
            line: "number (end)",
            body: "comment and/or suggestion",
          },
        ],
      }
    ),
  }),
  {
    verbosity: 1,
    async before(message: ModelMessage) {
      return { ...message, suggestionTemplate };
    },
  }
);
export const reviewSummarizer = new Agent(
  new GPTModelAdapter({
    model: "gpt-4",
    systemInstruction: createInstruction(
      "Review Summarizer",
      minify`
     Write a summarized review.
     DO NOT reference the original reviews.
     Write a new unique and complete review.
     Be clear but also concise.
      `,
      {
        review: "clear and concise review",
      }
    ),
  })
);
export const storyChecker = new Agent(
  new GPTModelAdapter({
    model: "gpt-4",
    systemInstruction: createInstruction(
      "User Story Reviewer",
      minify`
      Review the User Story {{title+body}}.
      Propose a better User Story if needed.
      Propose Acceptance Criteria if needed.
      Follow the {{template}}.
      Decide if the User Story is ready to be worked on.
      `,
      {
        ready: "boolean",
        review: "Markdown(precise and very detailed)",
      }
    ),
  }),
  {
    async before(message: ModelMessage) {
      return { ...message, template: storyTemplate };
    },
  }
);

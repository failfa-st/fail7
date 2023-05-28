import axios from "axios";
import { inspect } from "node:util";
import parse from "parse-diff";
import { Context, Probot } from "probot";
import { agent, reviewSummarizer, storyChecker } from "./agents.js";
import { PREvent, Side } from "./enums.js";
import { Comment } from "./types.js";

// Allow infinite depth of Node.js Object logs
inspect.defaultOptions.depth = null;

const validLabels = ["user story", "user-story", "story"];

const bot = (app: Probot) => {
  // React to pull requests
  app.on(
    ["pull_request.opened", "pull_request.synchronize"],
    async (
      context: Context<"pull_request.opened" | "pull_request.synchronize">
    ) => {
      try {
        const { title, body, diff_url, number } = context.payload.pull_request;
        // Get the diff from GitHub and parse it
        const { data } = await axios.get(diff_url);
        const files = parse(data);
        // For each file, an agent creates a review and decides if the changes can be merged
        // It also writes comments for lines that might need some work
        const reviews = await Promise.all(
          files.map(async (file) => {
            const answer = await agent.assign<{
              letsGetThatMerged: boolean;
              review: string;
              comments: Comment[];
            }>({ title, body, diff: file });
            return answer.message;
          })
        );

        // Gather all comments from all agents
        const comments = reviews.flatMap((review) => review.comments);

        // Check if every agent gave their approval
        const letsGetThatMerged = reviews.every(
          (review) => review.letsGetThatMerged
        );

        // Summarize all reviews to get an overall review of the changes proposed in the pull request
        const reviewSummary = await reviewSummarizer.assign<{ review: string }>(
          {
            reviews: reviews.map((review) => ({
              review: review.review,
              file: review.comments[0]?.path,
              letsGetThatMerged: review.letsGetThatMerged,
              comments: review.comments.map((comment: Comment) => ({
                line: comment.line,
                body: comment.body,
              })),
            })),
          }
        );

        // Prepare the review and trigger an approval if it can be merged
        const prReview = context.repo({
          pull_number: number,
          body: letsGetThatMerged
            ? `🚀 LGTM\n\n${reviewSummary.message.review}`
            : reviewSummary.message.review,
          event: letsGetThatMerged ? PREvent.APPROVE : PREvent.REQUEST_CHANGES,
          comments: comments.map((comment) => ({
            path: comment.path,
            start_line:
              comment.start_line === comment.line
                ? undefined
                : comment.start_line,
            line: comment.line,
            side: Side.RIGHT,
            body: comment.body,
          })),
        });

        // Create the PR review
        await context.octokit.pulls.createReview(prReview);
      } catch (error) {
        throw error;
      }
    }
  );

  app.on(
    ["issues.opened", "issues.edited"],
    async (context: Context<"issues.opened">) => {
      const {
        octokit,
        payload: { issue, repository },
      } = context;
      try {
        // Check if the user story label has been set
        const isUserStory = (issue.labels ?? []).some((label) =>
          validLabels.includes(label.name.toLocaleLowerCase())
        );
        // Only proceed for user stories
        if (!isUserStory) {
          return;
        }

        const { title, body, number } = context.payload.issue;
        // Tell the story checker to review the user story
        const answer = await storyChecker.assign({
          title,
          body,
        });

        // React based on the answer of the agent
        // If the story looks great, set a label, otherwise suggest a better story
        if (answer.message.ready) {
          const issueComment = context.issue({
            body: `Great job. This story is ready to be worked on.`,
          });

          await octokit.issues.createComment(issueComment);
          await octokit.issues.addLabels({
            owner: repository.owner.login,
            repo: repository.name,
            issue_number: number,
            labels: ["Ready"],
          });
        } else {
          const issueComment = context.issue({
            body: answer.message.review as string,
          });
          await octokit.issues.createComment(issueComment);
        }
      } catch (error) {
        throw error;
      }
    }
  );
};

export default bot;
